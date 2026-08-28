/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - putting the plugin's picture and the engine's tracks in one file
 *
 * Two recordings of the same moment, each holding half of what a clip needs.
 *
 * Discord's clip engine reads its capture id as a window handle. A screen id
 * does not convert to one - the native log answers `creating session with
 * (RsVideoOptions { source: Window(HWND(0x0)), ... })` and turns its own
 * capture off a fifth of a second later - so on a screen it writes the call
 * with one AAC track per person and no picture at all. The plugin's own buffer
 * has the picture, and one soundtrack with everybody already mixed into it.
 *
 * So neither file is the clip. This one puts them together without re-encoding
 * anything: the plugin's video track, the plugin's mixed soundtrack, and then
 * every per-person track the engine wrote, copied across sample for sample.
 *
 * The order matters and is not cosmetic. A player takes the first enabled audio
 * track and ignores the rest, so the mixed one goes first and stays enabled -
 * the clip plays like any other clip, everywhere, with the game and every voice
 * in it. The per-person tracks follow with `track_enabled` cleared, which keeps
 * them out of playback and out of nobody's way, and the studio reads them
 * straight out of the file to mute one person and leave the rest talking. They
 * carry their `handler_name` across unchanged, because that is what
 * `nativeTracks.ts` matches on.
 *
 * The plugin records a fragmented MP4 (`moof`/`trun`, no sample tables) and the
 * engine writes a plain one, so the output is built from scratch as a plain
 * MP4: `ftyp`, `mdat`, `moov` - moov last, so every chunk offset is known
 * before it is written.
 */

import { Logger } from "@utils/Logger";

import { type Box, boxes, descend, find, handlerName, NON_SYNC } from "./boxes";

const logger = new Logger("Clipper");

/** Movie timescale of the file written out. Milliseconds, for legibility. */
const MOVIE_TIMESCALE = 1000;

interface Sample {
    /** Offset of the sample's bytes inside the file it came from. */
    at: number;
    size: number;
    /** In the track's own timescale. */
    duration: number;
    sync: boolean;
    /** Composition offset, in the track's own timescale. */
    cts: number;
    /** When the sample is decoded, in the track's own timescale. */
    decode: number;
}

interface Track {
    kind: "vide" | "soun";
    timescale: number;
    /** The whole `stsd` box, copied over as it stands. */
    stsd: Uint8Array;
    /** What the track is called, which for a native clip names its owner. */
    handler: string;
    /** Whether a player should play it. Cleared on the per-person tracks. */
    enabled: boolean;
    /** Seconds of silence in front of the first sample, written as an edit. */
    offset: number;
    width: number;
    height: number;
    samples: Sample[];
    /** The file the samples' offsets point into. */
    source: Uint8Array;
}

/** The four bytes of a `hdlr` that say what the track carries. */
function handlerType(view: DataView, hdlr: Box): string {
    return String.fromCharCode(
        view.getUint8(hdlr.start + 8), view.getUint8(hdlr.start + 9),
        view.getUint8(hdlr.start + 10), view.getUint8(hdlr.start + 11)
    );
}

/* ------------------------------------------------------------------ reading */

interface Defaults {
    duration: number;
    size: number;
    flags: number;
}

/**
 * Reads a fragmented MP4 - what the plugin's MediaRecorder writes.
 *
 * The sample tables are empty and everything real is in the `moof` runs, so the
 * samples are gathered by walking those in file order.
 */
function readFragmented(data: Uint8Array): Track[] {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const top = boxes(data, view, 0, data.length);

    const moov = find(top, "moov");
    if (!moov) return [];

    const inside = boxes(data, view, moov.start, moov.end);

    /** Per-track defaults from `trex`, used wherever a run leaves a field out. */
    const trex = new Map<number, Defaults>();
    const mvex = find(inside, "mvex");

    if (mvex) {
        for (const box of boxes(data, view, mvex.start, mvex.end)) {
            if (box.type !== "trex") continue;

            trex.set(view.getUint32(box.start + 4), {
                duration: view.getUint32(box.start + 12),
                size: view.getUint32(box.start + 16),
                flags: view.getUint32(box.start + 20)
            });
        }
    }

    const tracks = new Map<number, Track>();

    for (const trak of inside.filter(box => box.type === "trak")) {
        const walk = boxes(data, view, trak.start, trak.end);

        const tkhd = find(walk, "tkhd");
        const mdia = find(walk, "mdia");
        if (!tkhd || !mdia) continue;

        const parts = boxes(data, view, mdia.start, mdia.end);
        const mdhd = find(parts, "mdhd");
        const hdlr = find(parts, "hdlr");
        const stbl = descend(data, view, mdia, ["minf", "stbl"]);
        const stsd = stbl && find(boxes(data, view, stbl.start, stbl.end), "stsd");
        if (!mdhd || !hdlr || !stsd) continue;

        const version = view.getUint8(tkhd.start);
        const trackId = version === 1 ? view.getUint32(tkhd.start + 20) : view.getUint32(tkhd.start + 12);

        // A version 1 header widens creation time, modification time and
        // duration to 64 bits, which moves everything after them by twelve
        // bytes.
        const widthAt = version === 1 ? tkhd.start + 88 : tkhd.start + 76;

        const kind = handlerType(view, hdlr);
        if (kind !== "vide" && kind !== "soun") continue;

        tracks.set(trackId, {
            kind,
            timescale: view.getUint8(mdhd.start) === 1
                ? view.getUint32(mdhd.start + 20)
                : view.getUint32(mdhd.start + 12),
            stsd: data.subarray(stsd.start - 8, stsd.end),
            handler: handlerName(data, hdlr),
            enabled: true,
            offset: 0,
            width: view.getUint16(widthAt),
            height: view.getUint16(widthAt + 4),
            samples: [],
            source: data
        });
    }

    for (const moof of top.filter(box => box.type === "moof")) {
        // `moof` offsets are measured from the first byte of the box, which is
        // eight before its payload.
        const anchor = moof.start - 8;

        for (const traf of boxes(data, view, moof.start, moof.end).filter(box => box.type === "traf")) {
            const parts = boxes(data, view, traf.start, traf.end);
            const tfhd = find(parts, "tfhd");
            if (!tfhd) continue;

            const tfhdFlags = view.getUint32(tfhd.start) & 0xffffff;
            const trackId = view.getUint32(tfhd.start + 4);

            const track = tracks.get(trackId);
            if (!track) continue;

            // A screen capture only hands the recorder a frame when something
            // moves, so the runs are not back to back: the fragment says where
            // it lands on the timeline and the gap in front of it is the still
            // picture. Without reading that, every pause collapses and the
            // video ends up shorter than its own soundtrack.
            const tfdt = find(parts, "tfdt");
            let time = tfdt
                ? (view.getUint8(tfdt.start) === 1 ? Number(view.getBigUint64(tfdt.start + 4)) : view.getUint32(tfdt.start + 4))
                : endOf(track);

            let at = tfhd.start + 8;
            let base = anchor;

            if (tfhdFlags & 0x000001) {
                base = Number(view.getBigUint64(at));
                at += 8;
            }
            if (tfhdFlags & 0x000002) at += 4;

            const fallback = trex.get(trackId) ?? { duration: 0, size: 0, flags: 0 };

            let defaultDuration = fallback.duration;
            let defaultSize = fallback.size;
            let defaultFlags = fallback.flags;

            if (tfhdFlags & 0x000008) {
                defaultDuration = view.getUint32(at);
                at += 4;
            }
            if (tfhdFlags & 0x000010) {
                defaultSize = view.getUint32(at);
                at += 4;
            }
            if (tfhdFlags & 0x000020) {
                defaultFlags = view.getUint32(at);
                at += 4;
            }

            for (const trun of parts.filter(box => box.type === "trun")) {
                const trunFlags = view.getUint32(trun.start) & 0xffffff;
                const count = view.getUint32(trun.start + 4);

                let read = trun.start + 8;
                let offset = base;

                if (trunFlags & 0x000001) {
                    offset = base + view.getInt32(read);
                    read += 4;
                }

                let firstFlags: number | null = null;
                if (trunFlags & 0x000004) {
                    firstFlags = view.getUint32(read);
                    read += 4;
                }

                for (let i = 0; i < count; i++) {
                    let duration = defaultDuration;
                    let size = defaultSize;
                    let flags = i === 0 && firstFlags != null ? firstFlags : defaultFlags;
                    let cts = 0;

                    if (trunFlags & 0x000100) {
                        duration = view.getUint32(read);
                        read += 4;
                    }
                    if (trunFlags & 0x000200) {
                        size = view.getUint32(read);
                        read += 4;
                    }
                    if (trunFlags & 0x000400) {
                        flags = view.getUint32(read);
                        read += 4;
                    }
                    if (trunFlags & 0x000800) {
                        // Signed since version 1 of the box, and a negative
                        // offset read as unsigned puts a frame hours away.
                        cts = view.getUint8(trun.start) === 0 ? view.getUint32(read) : view.getInt32(read);
                        read += 4;
                    }

                    track.samples.push({
                        at: offset,
                        size,
                        duration,
                        sync: track.kind === "soun" || !(flags & NON_SYNC),
                        cts,
                        decode: time
                    });

                    offset += size;
                    time += duration;
                }
            }
        }
    }

    const found = [...tracks.values()].filter(track => track.samples.length > 0);
    for (const track of found) spreadGaps(track);

    return found;
}

/** Where a track's samples have reached so far, for a fragment that leaves its start out. */
function endOf(track: Track): number {
    const last = track.samples[track.samples.length - 1];
    return last ? last.decode + last.duration : 0;
}

/**
 * Stretches each sample to reach the next one.
 *
 * A plain MP4 has no way to say "nothing here": a sample table is a run of
 * durations laid end to end. So a gap between two fragments becomes part of the
 * frame in front of it, which is what a still picture is anyway.
 */
function spreadGaps(track: Track): void {
    for (let i = 0; i < track.samples.length - 1; i++) {
        const gap = track.samples[i + 1].decode - track.samples[i].decode;
        if (gap > track.samples[i].duration) track.samples[i].duration = gap;
    }
}

/** Reads a plain MP4 - what the clip engine writes - keeping audio only. */
function readPlainAudio(data: Uint8Array): Track[] {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const moov = find(boxes(data, view, 0, data.length), "moov");
    if (!moov) return [];

    const inside = boxes(data, view, moov.start, moov.end);
    const mvhd = find(inside, "mvhd");
    if (!mvhd) return [];

    const movieTimescale = view.getUint8(mvhd.start) === 1
        ? view.getUint32(mvhd.start + 20)
        : view.getUint32(mvhd.start + 12);

    const found: Track[] = [];

    for (const trak of inside.filter(box => box.type === "trak")) {
        const mdia = find(boxes(data, view, trak.start, trak.end), "mdia");
        if (!mdia) continue;

        const parts = boxes(data, view, mdia.start, mdia.end);
        const mdhd = find(parts, "mdhd");
        const hdlr = find(parts, "hdlr");
        const stbl = descend(data, view, mdia, ["minf", "stbl"]);
        if (!mdhd || !hdlr || !stbl) continue;
        if (handlerType(view, hdlr) !== "soun") continue;

        const tables = boxes(data, view, stbl.start, stbl.end);
        const stsd = find(tables, "stsd");
        const stts = find(tables, "stts");
        const stsz = find(tables, "stsz");
        const stsc = find(tables, "stsc");
        const stco = find(tables, "stco") ?? find(tables, "co64");
        if (!stsd || !stts || !stsz || !stsc || !stco) continue;

        // Sizes.
        const uniform = view.getUint32(stsz.start + 4);
        const count = view.getUint32(stsz.start + 8);
        const sizes: number[] = [];

        for (let i = 0; i < count; i++) {
            sizes.push(uniform || view.getUint32(stsz.start + 12 + i * 4));
        }

        // Durations, run-length encoded in the file.
        const durations: number[] = [];
        const runs = view.getUint32(stts.start + 4);

        for (let i = 0; i < runs; i++) {
            const times = view.getUint32(stts.start + 8 + i * 8);
            const each = view.getUint32(stts.start + 12 + i * 8);
            for (let j = 0; j < times && durations.length < count; j++) durations.push(each);
        }

        while (durations.length < count) durations.push(durations[durations.length - 1] ?? 0);

        // Where each sample sits, walked chunk by chunk.
        const chunkOffsets: number[] = [];
        const chunks = view.getUint32(stco.start + 4);
        const wide = stco.type === "co64";

        for (let i = 0; i < chunks; i++) {
            chunkOffsets.push(wide
                ? Number(view.getBigUint64(stco.start + 8 + i * 8))
                : view.getUint32(stco.start + 8 + i * 4));
        }

        const groups: Array<{ first: number; per: number; }> = [];
        const entries = view.getUint32(stsc.start + 4);

        for (let i = 0; i < entries; i++) {
            groups.push({
                first: view.getUint32(stsc.start + 8 + i * 12),
                per: view.getUint32(stsc.start + 12 + i * 12)
            });
        }

        const samples: Sample[] = [];
        let index = 0;
        let clock = 0;

        for (let chunk = 0; chunk < chunkOffsets.length && index < count; chunk++) {
            let per = 0;
            for (const group of groups) {
                if (chunk + 1 >= group.first) per = group.per;
            }

            let at = chunkOffsets[chunk];

            for (let i = 0; i < per && index < count; i++, index++) {
                samples.push({ at, size: sizes[index], duration: durations[index], sync: true, cts: 0, decode: clock });
                clock += durations[index];
                at += sizes[index];
            }
        }

        if (!samples.length) continue;

        /*
         * The engine starts each person's track where their audio actually
         * begins, and says so with an empty edit in front of it. Dropping that
         * would slide one voice against the others by however late they joined.
         */
        let offset = 0;
        const elst = descend(data, view, trak, ["edts", "elst"]);

        if (elst) {
            const version = view.getUint8(elst.start);
            const listed = view.getUint32(elst.start + 4);
            let read = elst.start + 8;

            for (let i = 0; i < listed; i++) {
                const duration = version === 1 ? Number(view.getBigUint64(read)) : view.getUint32(read);
                const media = version === 1
                    ? Number(view.getBigInt64(read + 8))
                    : view.getInt32(read + (version === 1 ? 8 : 4));

                // An empty edit - media time -1 - is a gap of its own duration.
                if (media === -1) offset += duration / movieTimescale;

                read += version === 1 ? 20 : 12;
            }
        }

        found.push({
            kind: "soun",
            timescale: view.getUint8(mdhd.start) === 1
                ? view.getUint32(mdhd.start + 20)
                : view.getUint32(mdhd.start + 12),
            stsd: data.subarray(stsd.start - 8, stsd.end),
            handler: handlerName(data, hdlr),

            // Kept out of playback: a player takes the first enabled audio
            // track and no more, and these are for the studio to read.
            enabled: false,
            offset,
            width: 0,
            height: 0,
            samples,
            source: data
        });
    }

    return found;
}

/* ------------------------------------------------------------------ writing */

function u16(value: number): Uint8Array {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value);
    return out;
}

function u32(value: number): Uint8Array {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value >>> 0);
    return out;
}

function i32(value: number): Uint8Array {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setInt32(0, value);
    return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));

    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }

    return out;
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
    const body = concat(parts);
    const out = new Uint8Array(8 + body.length);

    new DataView(out.buffer).setUint32(0, out.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);

    return out;
}

function full(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
    return box(type, new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...parts);
}

/** A run of 32-bit values, written in one pass rather than box by box. */
function words(values: number[]): Uint8Array {
    const out = new Uint8Array(values.length * 4);
    const view = new DataView(out.buffer);

    for (let i = 0; i < values.length; i++) view.setUint32(i * 4, values[i] >>> 0);

    return out;
}

/** The identity matrix every track header carries. */
const MATRIX = words([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]);

function trackDuration(track: Track): number {
    return track.samples.reduce((sum, sample) => sum + sample.duration, 0);
}

function timeToSample(track: Track): Uint8Array {
    const runs: Array<[number, number]> = [];

    for (const { duration } of track.samples) {
        const last = runs[runs.length - 1];
        if (last && last[1] === duration) last[0]++;
        else runs.push([1, duration]);
    }

    return full("stts", 0, 0, u32(runs.length), words(runs.flat()));
}

function sampleTable(track: Track, offsets: number[]): Uint8Array {
    const parts: Uint8Array[] = [track.stsd, timeToSample(track)];

    // Composition offsets, only when the encoder actually reordered anything.
    if (track.samples.some(sample => sample.cts !== 0)) {
        const entries: Uint8Array[] = [];
        for (const sample of track.samples) entries.push(u32(1), i32(sample.cts));

        parts.push(full("ctts", 1, 0, u32(track.samples.length), concat(entries)));
    }

    if (track.kind === "vide") {
        const sync: number[] = [];
        track.samples.forEach((sample, i) => {
            if (sample.sync) sync.push(i + 1);
        });

        // A track with no keyframe at all is not seekable, and claiming every
        // frame is one is worse than saying nothing.
        if (sync.length && sync.length < track.samples.length) {
            parts.push(full("stss", 0, 0, u32(sync.length), words(sync)));
        }
    }

    parts.push(
        // One sample per chunk: the offsets are already per-sample, and the
        // table stays a single entry instead of a mapping to get wrong.
        full("stsc", 0, 0, u32(1), words([1, 1, 1])),
        full("stsz", 0, 0, u32(0), u32(track.samples.length), words(track.samples.map(s => s.size))),
        full("stco", 0, 0, u32(offsets.length), words(offsets))
    );

    return box("stbl", ...parts);
}

function trackBox(track: Track, id: number, offsets: number[]): Uint8Array {
    const media = trackDuration(track);
    const seconds = media / track.timescale;
    const movie = Math.round((seconds + track.offset) * MOVIE_TIMESCALE);

    const header = full("tkhd", 0, track.enabled ? 0x7 : 0x0,
        u32(0), u32(0), u32(id), u32(0), u32(movie),
        u32(0), u32(0),
        u16(0), u16(0),
        u16(track.kind === "soun" ? 0x0100 : 0), u16(0),
        MATRIX,
        u32(track.width << 16), u32(track.height << 16));

    const parts: Uint8Array[] = [header];

    /*
     * A leading gap, written the way the format spells one: an empty edit of
     * the gap's length, then the media itself.
     */
    if (track.offset > 0) {
        const gap = Math.round(track.offset * MOVIE_TIMESCALE);

        parts.push(box("edts", full("elst", 0, 0, u32(2),
            u32(gap), i32(-1), u32(0x00010000),
            u32(Math.round(seconds * MOVIE_TIMESCALE)), i32(0), u32(0x00010000))));
    }

    const handler = new TextEncoder().encode(track.handler);

    parts.push(box("mdia",
        full("mdhd", 0, 0, u32(0), u32(0), u32(track.timescale), u32(media), u16(0x55c4), u16(0)),
        full("hdlr", 0, 0,
            u32(0),
            new Uint8Array([...track.kind].map(c => c.charCodeAt(0))),
            new Uint8Array(12),
            handler, new Uint8Array(1)),
        box("minf",
            track.kind === "vide"
                ? full("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0))
                : full("smhd", 0, 0, u16(0), u16(0)),
            box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
            sampleTable(track, offsets))));

    return box("trak", ...parts);
}

/* -------------------------------------------------------------------- muxing */

/**
 * One MP4 out of the plugin's picture and the engine's per-person sound.
 *
 * `video` is the plugin's own clip, fragmented, with its mixed soundtrack.
 * `native` is what the clip engine wrote: no picture, one AAC track per person.
 * Returns null when either file is not what it should be, which leaves the
 * caller with the plugin's clip exactly as it was.
 */
export function muxNativeAudio(video: Uint8Array, native: Uint8Array): Uint8Array | null {
    try {
        const own = readFragmented(video);
        const picture = own.find(track => track.kind === "vide");

        if (!picture) {
            logger.warn("The plugin's clip has no video track to mux the call into");
            return null;
        }

        const voices = readPlainAudio(native);
        if (!voices.length) {
            logger.warn("The native clip has no audio tracks to mux in");
            return null;
        }

        /*
         * Two recordings, two clocks, one moment.
         *
         * Both were stopped by the same save, so they end together and that is
         * the only landmark they share - their starts are wherever each buffer
         * happened to begin. So the call is slid to land on the end of the
         * picture. A native clip that reaches further back than the plugin's
         * buffer gets its head dropped rather than a negative gap, which the
         * format cannot express anyway.
         */
        const ends = Math.max(...voices.map(track => track.offset + trackDuration(track) / track.timescale));
        const shift = trackDuration(picture) / picture.timescale - ends;

        for (const track of voices) {
            let start = track.offset + shift;
            if (start >= 0) {
                track.offset = start;
                continue;
            }

            // Whole samples only, so the remainder stays as the track's gap.
            while (track.samples.length && start < 0) {
                start += track.samples[0].duration / track.timescale;
                track.samples.shift();
            }

            track.offset = Math.max(0, start);
        }

        const tracks = [picture, ...own.filter(track => track.kind === "soun"), ...voices]
            .filter(track => track.samples.length > 0);

        /*
         * `mdat` first, `moov` last, which is how the engine's own files are
         * laid out: every chunk offset is then known before a single box of the
         * table is written, so nothing has to be patched afterwards.
         */
        const ftyp = box("ftyp",
            new Uint8Array([..."isom"].map(c => c.charCodeAt(0))),
            u32(512),
            new Uint8Array([..."isomiso2avc1mp41"].map(c => c.charCodeAt(0))));

        const payload = tracks.reduce(
            (sum, track) => sum + track.samples.reduce((bytes, sample) => bytes + sample.size, 0),
            0
        );

        const mdatAt = ftyp.length;
        const mediaAt = mdatAt + 8;
        const offsets: number[][] = [];

        /*
         * Where every sample lands in the finished file, worked out before a
         * byte is moved.
         *
         * The chunk table needs those offsets and nothing else about the
         * payload, and the sizes are all already known, so the tables can be
         * written first and the samples copied once, straight into the file.
         */
        let at = 0;

        for (const track of tracks) {
            const where: number[] = [];

            for (const sample of track.samples) {
                where.push(mediaAt + at);
                at += sample.size;
            }

            offsets.push(where);
        }

        const longest = tracks.reduce(
            (most, track) => Math.max(most, track.offset + trackDuration(track) / track.timescale),
            0
        );

        const moov = box("moov",
            full("mvhd", 0, 0,
                u32(0), u32(0), u32(MOVIE_TIMESCALE), u32(Math.round(longest * MOVIE_TIMESCALE)),
                u32(0x00010000), u16(0x0100), u16(0),
                u32(0), u32(0),
                MATRIX,
                new Uint8Array(24),
                u32(tracks.length + 1)),
            ...tracks.map((track, i) => trackBox(track, i + 1, offsets[i])));

        /*
         * One buffer for the whole file.
         *
         * The payload used to be gathered into an array of its own, copied into
         * an `mdat` with a header written on the front of it, and copied a
         * third time as the boxes were concatenated - three allocations the
         * size of the recording, on a file that is written exactly once, for a
         * clip that runs to hundreds of megabytes.
         */
        const out = new Uint8Array(mediaAt + payload + moov.length);

        out.set(ftyp, 0);
        new DataView(out.buffer).setUint32(mdatAt, 8 + payload);
        for (let i = 0; i < 4; i++) out[mdatAt + 4 + i] = "mdat".charCodeAt(i);

        let writeAt = mediaAt;

        for (const track of tracks) {
            for (const sample of track.samples) {
                out.set(track.source.subarray(sample.at, sample.at + sample.size), writeAt);
                writeAt += sample.size;
            }
        }

        out.set(moov, mediaAt + payload);

        logger.info(`Muxed the call into the clip: ${tracks.length} tracks, ${Math.round(longest)}s`);

        return out;
    } catch (e) {
        logger.error("Could not mux the native call audio into the clip", e);
        return null;
    }
}
