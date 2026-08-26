/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - walking the boxes of an MP4
 *
 * Three files here read MP4s, for three unrelated reasons: `mux.ts` puts two
 * recordings into one file, `nativeTracks.ts` pulls one person's audio out of
 * a native clip, and `mp4.ts` repairs a fragmented recording. The first two
 * were each carrying their own copy of the same twenty lines - the walk over a
 * box list, the lookup by type, the descent down a path - and the copies had
 * drifted: one of them stepped over a 64 bit size without checking that the
 * size fit in a number, and read four bytes past the end of a truncated box.
 *
 * They live here instead, in the careful version. `mp4.ts` keeps its own: it
 * scans while it rewrites and needs the header offset of every box, which is
 * a different walk rather than the same one with a flag.
 */

export interface Box {
    type: string;
    /** First byte of the payload, past the size and type. */
    start: number;
    /** One past the last byte of the box. */
    end: number;
}

/** Every box between two offsets, stopping at the first one that does not fit. */
export function boxes(data: Uint8Array, view: DataView, from: number, to: number): Box[] {
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

export function find(list: Box[], type: string): Box | undefined {
    return list.find(box => box.type === type);
}

/** Walks a chain of single children, e.g. `mdia/minf/stbl`. */
export function descend(data: Uint8Array, view: DataView, box: Box, path: string[]): Box | undefined {
    let current: Box | undefined = box;

    for (const type of path) {
        if (!current) return undefined;
        current = find(boxes(data, view, current.start, current.end), type);
    }

    return current;
}
