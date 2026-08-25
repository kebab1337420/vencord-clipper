/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the per-person audio tracks inside a native clip
 *
 * A clip written by Discord's own engine is not one soundtrack. It is one
 * track per person in the call, tagged with their user id, plus the call mixed
 * together, and a plugin clip carries its own soundtrack in front of both:
 *
 *     handler_name=SoundHandler              the plugin's own bed: game + call
 *     handler_name=0:all                     the same call, mixed together
 *     handler_name=618793332050755597:voice  one person, alone in their track
 *     handler_name=556486254326186014:voice  another, alone in theirs
 *
 * `0:all` is worth being careful about, because its name says the machine and
 * its contents say the call. Over the frames of a real clip where nobody spoke
 * it sits at 0.0007 while the bed - the same moments, with the game running -
 * sits at 0.0159, and it peaks with each voice track in turn. There is no
 * desktop audio in it at all. Summing it alongside the per-person tracks is
 * therefore a second copy of everybody, the muted person included, which is
 * exactly how a mute can be applied perfectly and still be heard.
 *
 * What that leaves is arithmetic rather than estimation: every person is in a
 * track of their own, so muting somebody is a sum with one term left out. That
 * is the difference between this file and any attempt to unmix one track.
 *
 * The engine writes a plain MP4 - `moov` with a real sample table, not the
 * fragmented layout `mp4.ts` handles - and every audio track in it is AAC,
 * 48 kHz, continuous from its first frame to its last. So each track comes out
 * of here as a concatenation of its AAC frames with an ADTS header in front of
 * each one, which `decodeAudioData` takes as it stands, plus the offset its
 * edit list asks for.
 */

import { Logger } from "@utils/Logger";

const logger = new Logger("Clipper");

/** AAC sample rates, by the index an ADTS header carries. */
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export interface NativeTrack {
    /** Discord's user id, or an empty string for a track that has no owner. */
    userId: string;
    /**
     * What the track carries: `voice`, `all`, `soundboard`, or `bed`.
     *
     * `bed` is this plugin's own soundtrack rather than the engine's - the one
     * a player plays, with the game in it - and is told apart by having no
     * owner in front of its name at all.
     */
    kind: string;
    /** Where the track starts inside the clip, in seconds. */
    offset: number;
    /** The track's AAC frames, each behind an ADTS header. */
    adts: Uint8Array;
}

interface Box {
    type: string;
    start: number;
    end: number;
}

function boxes(data: Uint8Array, view: DataView, from: number, to: number): Box[] {
    const found: Box[] = [];

    for (let at = from; at + 8 <= to;) {
        let size = view.getUint32(at);
        let header = 8;

        if (size === 1) {
            if (at + 16 > to) break;

            // 64 bit sizes only matter for `mdat`, which is never walked into,
            // but a box has to be stepped over correctly all the same.
            const big = view.getBigUint64(at + 8);
            if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;

            size = Number(big);
            header = 16;
        } else if (size === 0) {
            size = to - at;
        }

        if (size < header || at + size > to) break;

        found.push({
            type: String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]),
            start: at + header,
            end: at + size
        });

        at += size;
    }

    return found;
}

function find(list: Box[], type: string): Box | undefined {
    return list.find(box => box.type === type);
}

/** Walks a chain of single children, which is how every path in `moov` reads. */
function descend(data: Uint8Array, view: DataView, box: Box, path: string[]): Box | undefined {
    let current: Box | undefined = box;

    for (const type of path) {
        if (!current) return undefined;
        current = find(boxes(data, view, current.start, current.end), type);
    }

    return current;
}

/**
 * The name an MP4 handler box carries, which is where Discord writes the id.
 *
 * The box is a version byte, three flags, four reserved words and then the
 * name - as a C string on what ffmpeg writes, so a trailing NUL is dropped
 * rather than being handed on as part of the id.
 */
function handlerName(data: Uint8Array, hdlr: Box): string {
    const at = hdlr.start + 24;
    if (at >= hdlr.end) return "";

    let { end } = hdlr;
    if (data[end - 1] === 0) end--;

    return new TextDecoder().decode(data.subarray(at, end));
}

/** The sample entries of one track, as [offset, size] pairs into the file. */
function samples(data: Uint8Array, view: DataView, stbl: Box): Array<[number, number]> {
    const stsz = find(boxes(data, view, stbl.start, stbl.end), "stsz");
    const stsc = find(boxes(data, view, stbl.start, stbl.end), "stsc");
    const stco = find(boxes(data, view, stbl.start, stbl.end), "stco")
        ?? find(boxes(data, view, stbl.start, stbl.end), "co64");

    if (!stsz || !stsc || !stco) return [];

    const uniform = view.getUint32(stsz.start + 4);
    const count = view.getUint32(stsz.start + 8);
    const sizes = new Uint32Array(count);

    for (let i = 0; i < count; i++) {
        sizes[i] = uniform || view.getUint32(stsz.start + 12 + i * 4);
    }

    const chunks = view.getUint32(stco.start + 4);
    const wide = stco.type === "co64";
    const offsets = new Float64Array(chunks);

    for (let i = 0; i < chunks; i++) {
        offsets[i] = wide
            ? Number(view.getBigUint64(stco.start + 8 + i * 8))
            : view.getUint32(stco.start + 8 + i * 4);
    }

    // stsc says "from chunk N on, each chunk holds this many samples", so it is
    // read as runs rather than per chunk.
    const runs = view.getUint32(stsc.start + 4);
    const perChunk = new Uint32Array(chunks);

    for (let i = 0; i < runs; i++) {
        const first = view.getUint32(stsc.start + 8 + i * 12) - 1;
        const held = view.getUint32(stsc.start + 12 + i * 12);
        const until = i + 1 < runs ? view.getUint32(stsc.start + 8 + (i + 1) * 12) - 1 : chunks;

        for (let c = Math.max(0, first); c < Math.min(chunks, until); c++) perChunk[c] = held;
    }

    const found: Array<[number, number]> = [];

    for (let c = 0, sample = 0; c < chunks && sample < count; c++) {
        let at = offsets[c];

        for (let i = 0; i < perChunk[c] && sample < count; i++, sample++) {
            found.push([at, sizes[sample]]);
            at += sizes[sample];
        }
    }

    return found;
}

/**
 * The three fields an ADTS header needs, out of the AudioSpecificConfig.
 *
 * The config lives inside the `esds` descriptor, itself inside the `mp4a`
 * sample entry. Rather than walking the descriptor's length-prefixed tags -
 * which are variable width and worth nothing here - the box is scanned for the
 * tag that carries it: what follows five bytes of decoder configuration is the
 * two bytes that hold the profile, the sample rate index and the channel count.
 */
function aacConfig(data: Uint8Array, view: DataView, stsd: Box): { profile: number; rate: number; channels: number; } | null {
    for (let at = stsd.start; at + 8 <= stsd.end; at++) {
        if (data[at + 4] !== 0x65 || data[at + 5] !== 0x73 || data[at + 6] !== 0x64 || data[at + 7] !== 0x73) continue;

        const end = Math.min(stsd.end, at + view.getUint32(at));

        /*
         * 0x05 tags the config, and what follows it is a descriptor length -
         * variable width, high bit set on every byte but the last. ffmpeg
         * writes it padded to four bytes (`80 80 80 05`), so reading the byte
         * after the tag as the length gives zero and finds nothing.
         */
        for (let scan = at + 8; scan + 4 < end; scan++) {
            if (data[scan] !== 0x05) continue;

            let at2 = scan + 1;
            let length = 0;

            for (let i = 0; i < 4 && at2 < end; i++) {
                const byte = data[at2++];
                length = (length << 7) | (byte & 0x7f);
                if (!(byte & 0x80)) break;
            }

            if (length < 2 || at2 + 1 >= end) continue;

            const first = data[at2];
            const second = data[at2 + 1];

            const profile = first >> 3;
            const rate = ((first & 0x07) << 1) | (second >> 7);
            const channels = (second >> 3) & 0x0f;

            if (profile >= 1 && profile <= 4 && rate < RATES.length && channels >= 1) {
                return { profile, rate, channels };
            }
        }
    }

    return null;
}

/** Wraps every AAC frame of a track in the header a bare stream needs. */
function toAdts(data: Uint8Array, entries: Array<[number, number]>, config: { profile: number; rate: number; channels: number; }): Uint8Array {
    let total = 0;
    for (const [, size] of entries) total += size + 7;

    const out = new Uint8Array(total);
    let at = 0;

    for (const [offset, size] of entries) {
        const length = size + 7;

        out[at] = 0xff;
        out[at + 1] = 0xf1; // MPEG-4, no CRC.
        out[at + 2] = ((config.profile - 1) << 6) | (config.rate << 2) | ((config.channels >> 2) & 1);
        out[at + 3] = ((config.channels & 3) << 6) | ((length >> 11) & 0x03);
        out[at + 4] = (length >> 3) & 0xff;
        out[at + 5] = ((length & 0x07) << 5) | 0x1f;
        out[at + 6] = 0xfc;

        out.set(data.subarray(offset, offset + size), at + 7);
        at += length;
    }

    return out;
}

/**
 * Where a track's first sample belongs on the clip's clock.
 *
 * The engine starts the call's tracks after the picture - the voice tracks of
 * a real clip begin 0.694s in - and says so with an empty edit at the front of
 * the edit list. Ignoring it plays everybody early by that much, which on a
 * clip is the difference between a laugh landing on the joke and landing on
 * the silence after it.
 */
function editOffset(data: Uint8Array, view: DataView, trak: Box, movieTimescale: number): number {
    const elst = descend(data, view, trak, ["edts", "elst"]);
    if (!elst || !movieTimescale) return 0;

    const version = data[elst.start];
    const count = view.getUint32(elst.start + 4);

    let at = elst.start + 8;
    let offset = 0;

    for (let i = 0; i < count; i++) {
        // Version 1 widens both fields to 64 bits, so the media time sits at a
        // different place in the entry depending on it.
        const duration = version === 1 ? Number(view.getBigUint64(at)) : view.getUint32(at);
        const media = version === 1 ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4);

        // An empty edit - media time -1 - is silence of its own duration.
        if (media < 0) offset += duration / movieTimescale;

        at += version === 1 ? 20 : 12;
    }

    return offset;
}

/**
 * The audio tracks of a native clip, one per person plus the machine's own.
 *
 * Empty for anything this does not apply to: a clip recorded through the
 * plugin's own buffer, a fragmented MP4, a WebM, a file whose audio is one
 * mixed track like every clip written before the native engine was wired in.
 * The caller treats that as "no separation available" and carries on.
 */
export function readNativeAudio(data: Uint8Array): NativeTrack[] {
    try {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const top = boxes(data, view, 0, data.length);

        const moov = find(top, "moov");
        if (!moov) return [];

        const inside = boxes(data, view, moov.start, moov.end);
        const mvhd = find(inside, "mvhd");
        if (!mvhd) return [];

        const movieTimescale = data[mvhd.start] === 1
            ? view.getUint32(mvhd.start + 20)
            : view.getUint32(mvhd.start + 12);

        const found: NativeTrack[] = [];

        for (const trak of inside.filter(box => box.type === "trak")) {
            const mdia = descend(data, view, trak, ["mdia"]);
            const hdlr = mdia && find(boxes(data, view, mdia.start, mdia.end), "hdlr");
            const stbl = descend(data, view, trak, ["mdia", "minf", "stbl"]);
            if (!mdia || !hdlr || !stbl) continue;

            // The handler's type, four bytes in, says what the track carries.
            const kind = String.fromCharCode(data[hdlr.start + 8], data[hdlr.start + 9], data[hdlr.start + 10], data[hdlr.start + 11]);
            if (kind !== "soun") continue;

            /*
             * The engine names a track for who it belongs to and what it
             * carries, `842...:voice`. Anything without that - `SoundHandler`,
             * whatever else an encoder writes - is not the engine's: on a
             * plugin clip it is the plugin's own soundtrack, muxed in front of
             * the call's, and it is the bed everything else is rebuilt over.
             */
            const name = handlerName(data, hdlr);
            const colon = name.lastIndexOf(":");

            const owner = colon > 0 ? name.slice(0, colon) : "";
            const carries = colon > 0 ? name.slice(colon + 1) : "bed";

            const config = aacConfig(data, view, find(boxes(data, view, stbl.start, stbl.end), "stsd")!);
            if (!config) continue;

            const entries = samples(data, view, stbl);
            if (!entries.length) continue;

            found.push({
                // "0" owns `0:all`, which is the call mixed together rather
                // than anybody in particular, so it is left without an owner
                // and never mixed in beside the tracks it is made of.
                userId: /^\d{5,}$/.test(owner) ? owner : "",
                kind: carries,
                offset: editOffset(data, view, trak, movieTimescale),
                adts: toAdts(data, entries, config)
            });
        }

        return found;
    } catch (e) {
        logger.warn("Could not read the audio tracks of this clip", e);
        return [];
    }
}

/** Whether a clip carries a voice track of its own for more than one person. */
export function hasVoiceTracks(tracks: NativeTrack[]): boolean {
    return tracks.filter(track => track.userId && track.kind === "voice").length > 0;
}

/**
 * Whether a clip has any picture in it at all.
 *
 * Worth asking, because the clip engine will happily write a file with none.
 * It reads the capture id as a window handle, and a screen does not convert:
 * `creating session with (RsVideoOptions { source: Window(HWND(0x0)), ... })`
 * is what the native log shows for `screen:0:0`. It then turns its own capture
 * off two hundred milliseconds later and saves the call audio on its own, so
 * the write succeeds, the per-person tracks are all there, and the only thing
 * missing is the video.
 */
export function hasVideoTrack(data: Uint8Array): boolean {
    try {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

        const moov = find(boxes(data, view, 0, data.length), "moov");
        if (!moov) return false;

        for (const trak of boxes(data, view, moov.start, moov.end).filter(box => box.type === "trak")) {
            const mdia = descend(data, view, trak, ["mdia"]);
            const hdlr = mdia && find(boxes(data, view, mdia.start, mdia.end), "hdlr");
            if (!hdlr) continue;

            const kind = String.fromCharCode(data[hdlr.start + 8], data[hdlr.start + 9], data[hdlr.start + 10], data[hdlr.start + 11]);
            if (kind === "vide") return true;
        }

        return false;
    } catch (e) {
        // Unreadable is not the same as pictureless, and throwing away a clip
        // over a box walk that went wrong would be the worse mistake.
        logger.warn("Could not tell whether this clip has a picture", e);
        return true;
    }
}
