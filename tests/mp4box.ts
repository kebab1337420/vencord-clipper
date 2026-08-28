/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - building MP4s to read back
 *
 * The three readers under test walk real files byte by byte, so testing them
 * against a hand-written buffer is testing the reader against the same
 * assumptions that wrote it. These builders take the other side: they write
 * what the specification says a box holds, at the offsets it says, and the
 * tests then assert on what the readers make of it.
 *
 * Only what the readers actually look at is filled in. A `tkhd` here carries
 * its version, its two timestamps and its track id and stops, because that is
 * where the track id lives and nothing under test reads past it. A file built
 * this way would not play; it is not meant to.
 */

const encoder = new TextEncoder();

/** A box: four bytes of size, four of type, then the payload. */
export function box(type: string, ...parts: Uint8Array[]): Uint8Array {
    const body = concat(...parts);
    const out = new Uint8Array(8 + body.length);

    new DataView(out.buffer).setUint32(0, out.length);
    out.set(encoder.encode(type), 4);
    out.set(body, 8);

    return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));

    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }

    return out;
}

export function u32(...values: number[]): Uint8Array {
    const out = new Uint8Array(values.length * 4);
    const view = new DataView(out.buffer);

    values.forEach((value, i) => view.setUint32(i * 4, value >>> 0));
    return out;
}

export function u64(value: bigint): Uint8Array {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setBigUint64(0, value);
    return out;
}

/**
 * A version-and-flags word.
 *
 * The version is the top byte of the four, not the bottom one: a box written
 * with a plain 1 there reads back as version 0 with a flag set, which is the
 * mistake this exists to stop the tests from making silently.
 */
export function version(value: number): Uint8Array {
    return u32(value << 24);
}

export function zeros(count: number): Uint8Array {
    return new Uint8Array(count);
}

export function ascii(text: string): Uint8Array {
    return encoder.encode(text);
}

/** A box with an explicit size field, for testing a walk over a bad one. */
export function sized(type: string, size: number, ...parts: Uint8Array[]): Uint8Array {
    const built = box(type, ...parts);
    new DataView(built.buffer).setUint32(0, size >>> 0);
    return built;
}

/**
 * A track declaration: an id, a timescale and a handler.
 *
 * `hdlr`'s trailing name is what tells one speaker's audio track from another's
 * in a native clip, so it is written the way a writer does - the name, then a
 * NUL, then whatever the writer felt like leaving behind, here a second string
 * the reader must not run into.
 */
export function trak(id: number, handler: "vide" | "soun", name: string, timescale = 1000): Uint8Array {
    return box(
        "trak",
        // version 0, flags, creation, modification, then the id.
        box("tkhd", u32(0, 0, 0, id)),
        box(
            "mdia",
            box("mdhd", u32(0, 0, 0, timescale)),
            box("hdlr", u32(0, 0), ascii(handler), zeros(12), ascii(name), zeros(1), ascii("junk"))
        )
    );
}

/** A `trak` whose `tkhd` and `mdhd` use the wide version 1 layout. */
export function wideTrak(id: number, handler: "vide" | "soun", name: string, timescale = 1000): Uint8Array {
    return box(
        "trak",
        box("tkhd", concat(version(1), u64(0n), u64(0n), u32(id))),
        box(
            "mdia",
            box("mdhd", concat(version(1), u64(0n), u64(0n), u32(timescale))),
            box("hdlr", u32(0, 0), ascii(handler), zeros(12), ascii(name), zeros(1))
        )
    );
}

/** Marks the first sample of a fragment as a delta frame rather than a keyframe. */
export const NON_SYNC = 0x00010000;

export interface TrackFragment {
    id: number;
    /** In the track's own timescale. */
    decodeTime: number;
    sync?: boolean;
    /** Writes the decode time as a 64 bit field, as a long recording does. */
    wide?: boolean;
}

/**
 * One fragment: a `moof` describing each track, then the media it describes.
 *
 * The `trun` carries only the first-sample-flags field, which is what
 * MediaRecorder writes and what the keyframe test reads.
 */
export function fragment(tracks: TrackFragment[], payload = 16): Uint8Array {
    const trafs = tracks.map(({ id, decodeTime, sync = true, wide = false }) => box(
        "traf",
        // No optional fields and no default sample flags.
        box("tfhd", u32(0, id)),
        wide
            ? box("tfdt", concat(version(1), u64(BigInt(decodeTime))))
            : box("tfdt", u32(0, decodeTime)),
        // 0x000004: first-sample-flags-present.
        box("trun", u32(0x000004, 1, sync ? 0 : NON_SYNC))
    ));

    return concat(box("moof", ...trafs), box("mdat", zeros(payload)));
}

/** A whole fragmented MP4: an init segment and a run of fragments. */
export function file(tracks: Uint8Array[], fragments: Uint8Array[]): Uint8Array {
    return concat(box("ftyp", ascii("isom"), u32(0)), box("moov", ...tracks), ...fragments);
}

/** Reads a `tfdt` decode time back out, for asserting on a rebase. */
export function decodeTimes(data: Uint8Array): number[] {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const found: number[] = [];

    for (let at = 0; at + 8 <= data.length; at++) {
        if (String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]) !== "tfdt") continue;

        const version = data[at + 4];
        found.push(version === 1 ? Number(view.getBigUint64(at + 8)) : view.getUint32(at + 8));
    }

    return found;
}
