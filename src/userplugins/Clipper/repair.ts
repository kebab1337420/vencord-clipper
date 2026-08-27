/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - clip timeline repair and lossless cutting
 *
 * A clip cut out of the rolling buffer is the container header plus a tail of
 * whatever was still in memory, and both containers timestamp that tail from
 * the moment the capture started rather than from the start of the clip. The
 * parsers live in ./webm and ./mp4; this picks the one that matches.
 *
 * They also cut, which is the same operation with a range: keep a run of
 * fragments or clusters and rebase it. No decoder, no encoder, no quality lost,
 * and it takes as long as a memory copy rather than as long as the clip.
 */

import { lengthMp4, rebaseMp4, trimMp4 } from "./mp4";
import { lengthWebm, rebaseWebm, trimWebm } from "./webm";

interface Parser {
    rebase(data: Uint8Array): Uint8Array | null;
    trim(data: Uint8Array, fromMs: number, toMs: number): Uint8Array | null;
    length(data: Uint8Array): number;
}

const WEBM: Parser = { rebase: rebaseWebm, trim: trimWebm, length: lengthWebm };
const MP4: Parser = { rebase: rebaseMp4, trim: trimMp4, length: lengthMp4 };

function parserFor(mimeType: string): Parser | null {
    // Audio-only WebM too: the per-person voice buffers are assembled exactly
    // like the main one, out of a header and a run of live clusters, and they
    // need the same rebase for the same reason.
    if (mimeType.startsWith("video/webm") || mimeType.startsWith("audio/webm")) return WEBM;
    if (mimeType.startsWith("video/mp4")) return MP4;

    return null;
}

/**
 * The same repair, on bytes that are already in hand.
 *
 * Null when there was nothing to rebase, so a caller holding the original can
 * keep it rather than being handed a copy of what it already has.
 */
export function repairBytes(data: Uint8Array, mimeType: string): Uint8Array | null {
    const parser = parserFor(mimeType);

    return parser ? parser.rebase(data) : null;
}

/**
 * Cuts a clip down to a range, losslessly, on the nearest keyframe boundary.
 *
 * Null means the container is not one this understands, or that the range
 * already covers the whole clip, so a caller holding the original can keep it
 * rather than being handed a copy of what it already has.
 */
export function trimBytes(data: Uint8Array, mimeType: string, from: number, to: number): Uint8Array | null {
    const parser = parserFor(mimeType);
    if (!parser || !(to > from)) return null;

    return parser.trim(data, Math.max(0, from) * 1000, to * 1000);
}

/**
 * Length of a clip in seconds, read from the container rather than a decoder.
 *
 * Short by up to one timeslice, since it measures to the start of the last
 * fragment: enough to bound a trim, not to label the clip.
 */
export function lengthBytes(data: Uint8Array, mimeType: string): number {
    const parser = parserFor(mimeType);

    return parser ? parser.length(data) : 0;
}
