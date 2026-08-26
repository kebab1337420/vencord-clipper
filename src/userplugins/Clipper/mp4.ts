/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - fragmented MP4 timeline repair and cutting
 *
 * The MP4 counterpart of ./webm, for the same reason: the rolling buffer saves
 * the init segment plus whatever fragments are still in memory, and those carry
 * absolute decode times counted from the moment the capture started. A buffer
 * that has been running for seven minutes therefore writes a clip whose first
 * fragment claims to start at 7:00, which players read as the duration.
 *
 * A fragmented MP4 makes this cheaper to fix than WebM does: `trun` data offsets
 * are relative to their own `moof`, so dropping leading fragments moves nothing
 * that is referenced by position. Only each track's `tfdt` has to be rewritten,
 * and it keeps its byte width, so no box size changes either.
 *
 * The same machinery cuts a clip down to a range without going near an encoder:
 * a fragment is a self-contained unit, so keeping a run of them and rebasing the
 * result is a lossless trim, at the cost of landing on fragment boundaries.
 */

const NON_SYNC = 0x00010000;

/** Largest hole, in milliseconds, that still counts as continuous footage. */
const MAX_GAP = 3000;

interface Box {
    type: string;
    /** Absolute offset of the box header. */
    start: number;
    /** Absolute offset of the payload. */
    body: number;
    /** Absolute offset one past the box. */
    end: number;
}

function typeOf(data: Uint8Array, pos: number): string {
    return String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]);
}

/**
 * Reads the box header at `pos`, or null when there is not one.
 *
 * A size of 1 means the real size sits in a 64 bit field after the type, and 0
 * means the box runs to the end of its parent - which MediaRecorder does not
 * emit, but a file that has been through another tool might.
 */
function readBox(view: DataView, data: Uint8Array, pos: number, limit: number): Box | null {
    if (pos + 8 > limit) return null;

    const size = view.getUint32(pos);
    const type = typeOf(data, pos + 4);

    if (size === 1) {
        if (pos + 16 > limit) return null;

        const large = Number(view.getBigUint64(pos + 8));
        if (large < 16 || pos + large > limit) return null;

        return { type, start: pos, body: pos + 16, end: pos + large };
    }

    if (size === 0) return { type, start: pos, body: pos + 8, end: limit };
    if (size < 8 || pos + size > limit) return null;

    return { type, start: pos, body: pos + 8, end: pos + size };
}

function children(view: DataView, data: Uint8Array, from: number, to: number): Box[] {
    const found: Box[] = [];

    for (let pos = from; pos < to;) {
        const box = readBox(view, data, pos, to);
        if (!box || box.end <= pos) break;

        found.push(box);
        pos = box.end;
    }

    return found;
}

function find(boxes: Box[], type: string): Box | undefined {
    return boxes.find(b => b.type === type);
}

interface TrackInfo {
    /** Ticks per second, for turning decode times into milliseconds. */
    timescale: number;
    video: boolean;
}

/**
 * Timescale and kind of every track, read from the init segment.
 *
 * The timescale is what makes a gap between two fragments comparable to the
 * buffer's window, and the kind is what keeps the keyframe test on the video
 * track: every audio frame is a sync sample, so testing whichever track comes
 * first would call every fragment decodable.
 */
function readTracks(view: DataView, data: Uint8Array, moov: Box): Map<number, TrackInfo> {
    const tracks = new Map<number, TrackInfo>();

    for (const trak of children(view, data, moov.body, moov.end)) {
        if (trak.type !== "trak") continue;

        const parts = children(view, data, trak.body, trak.end);

        const tkhd = find(parts, "tkhd");
        const mdia = find(parts, "mdia");
        if (!tkhd || !mdia) continue;

        // Version 1 widens the two timestamps before the track id from 4 bytes
        // to 8; the flags byte the version sits in comes first either way.
        const wide = data[tkhd.body] === 1;
        const id = view.getUint32(tkhd.body + 4 + (wide ? 16 : 8));

        const inner = children(view, data, mdia.body, mdia.end);

        const mdhd = find(inner, "mdhd");
        const hdlr = find(inner, "hdlr");
        if (!mdhd) continue;

        const mdhdWide = data[mdhd.body] === 1;
        const timescale = view.getUint32(mdhd.body + 4 + (mdhdWide ? 16 : 8));

        tracks.set(id, {
            timescale: timescale || 1000,
            // Four bytes of version and flags, four reserved, then the handler.
            video: !!hdlr && typeOf(data, hdlr.body + 8) === "vide"
        });
    }

    return tracks;
}

interface TrackFragment {
    trackId: number;
    /** Absolute offset of the `tfdt` payload's decode time. */
    at: number;
    /** 4 or 8, kept so the rewritten value stays the same width. */
    width: number;
    decodeTime: bigint;
    /** True when this track's first sample in the fragment is a sync sample. */
    sync: boolean;
}

interface Fragment {
    /** Absolute offset of the `moof`. */
    offset: number;
    /** Absolute offset one past the fragment's media data. */
    end: number;
    tracks: TrackFragment[];
}

/** Bytes the optional `tfhd` fields take, in the order the flags list them. */
const TFHD_FIELDS: Array<[number, number]> = [
    [0x000001, 8],
    [0x000002, 4],
    [0x000008, 4],
    [0x000010, 4]
];

/** `default_sample_flags`, or null when the fragment does not carry one. */
function defaultSampleFlags(view: DataView, tfhd: Box): number | null {
    const flags = view.getUint32(tfhd.body) & 0xffffff;
    if (!(flags & 0x000020)) return null;

    let pos = tfhd.body + 8;
    for (const [bit, size] of TFHD_FIELDS) if (flags & bit) pos += size;

    return pos + 4 <= tfhd.end ? view.getUint32(pos) : null;
}

/**
 * Sample flags of the first sample a `trun` describes, or null when it says
 * nothing about them and the `tfhd` default applies.
 */
function firstSampleFlags(view: DataView, trun: Box): number | null {
    const flags = view.getUint32(trun.body) & 0xffffff;

    let pos = trun.body + 8;
    if (flags & 0x000001) pos += 4;

    // A fragment that opens on a keyframe says so here: this is the field
    // MediaRecorder writes, the per-sample table below is the general case.
    if (flags & 0x000004) return pos + 4 <= trun.end ? view.getUint32(pos) : null;

    if (!(flags & 0x000400)) return null;

    if (flags & 0x000100) pos += 4;
    if (flags & 0x000200) pos += 4;

    return pos + 4 <= trun.end ? view.getUint32(pos) : null;
}

/** Reads one `traf`, or null when it carries no decode time to rebase. */
function readTrackFragment(view: DataView, data: Uint8Array, traf: Box): TrackFragment | null {
    const parts = children(view, data, traf.body, traf.end);

    const tfhd = find(parts, "tfhd");
    const tfdt = find(parts, "tfdt");
    if (!tfhd || !tfdt) return null;

    const wide = data[tfdt.body] === 1;
    const at = tfdt.body + 4;
    const width = wide ? 8 : 4;
    if (at + width > tfdt.end) return null;

    const trun = find(parts, "trun");
    const flags = (trun && firstSampleFlags(view, trun)) ?? defaultSampleFlags(view, tfhd);

    return {
        trackId: view.getUint32(tfhd.body + 4),
        at,
        width,
        decodeTime: wide ? view.getBigUint64(at) : BigInt(view.getUint32(at)),
        // Nothing said about the flags means nothing marks the sample as a
        // delta frame, which is the encoder saying it stands on its own.
        sync: flags === null || (flags & NON_SYNC) === 0
    };
}

interface Scan {
    view: DataView;
    tracks: Map<number, TrackInfo>;
    videoTrack: number;
    fragments: Fragment[];
    /** Absolute offset where the fragments start; everything before is the header. */
    head: number;
}

/**
 * Walks a fragmented MP4 into its init segment and its fragments.
 *
 * Returns null for anything that is not one, which is the caller's signal to
 * leave the bytes alone rather than to guess.
 */
function scan(data: Uint8Array): Scan | null {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const top = children(view, data, 0, data.length);
    const moov = find(top, "moov");
    if (!moov) return null;

    const tracks = readTracks(view, data, moov);

    let videoTrack = 0;
    for (const [id, info] of tracks) if (info.video) videoTrack = id;

    const fragments: Fragment[] = [];

    // Where the media stops: anything past it is an index (`mfra`) whose offsets
    // a cut would invalidate, so it is left out of every fragment's extent.
    let mediaEnd = 0;
    for (const box of top) if (box.type === "moof" || box.type === "mdat") mediaEnd = box.end;

    for (const box of top) {
        if (box.type !== "moof") continue;

        const parts: TrackFragment[] = [];
        for (const traf of children(view, data, box.body, box.end)) {
            if (traf.type !== "traf") continue;

            const fragment = readTrackFragment(view, data, traf);
            if (fragment) parts.push(fragment);
        }

        if (parts.length) fragments.push({ offset: box.start, end: mediaEnd, tracks: parts });
    }

    if (!fragments.length) return null;

    // Each fragment runs up to the next one; the last one up to the end of the
    // media. Filled in afterwards because it needs the fragment that follows.
    for (let i = 0; i < fragments.length - 1; i++) fragments[i].end = fragments[i + 1].offset;

    return { view, tracks, videoTrack, fragments, head: fragments[0].offset };
}

/** Decode time of a fragment in milliseconds, read off the track that matters. */
function timeOf(fragment: Fragment, tracks: Map<number, TrackInfo>, videoTrack: number): number {
    const track = fragment.tracks.find(t => t.trackId === videoTrack) ?? fragment.tracks[0];
    if (!track) return 0;

    const info = tracks.get(track.trackId);
    return Number(track.decodeTime) * 1000 / (info?.timescale || 1000);
}

/** True when the fragment can be decoded without the ones before it. */
function isSync(fragment: Fragment, videoTrack: number): boolean {
    const track = fragment.tracks.find(t => t.trackId === videoTrack) ?? fragment.tracks[0];
    return !track || track.sync;
}

/**
 * Fraction of a run the search for a keyframe is allowed to throw away.
 *
 * A clip has to start on a keyframe or its first second decodes into garbage,
 * so the repair moves the start forward to one. When the encoder places them
 * far apart that move is not a correction, it is the clip: a ten second buffer
 * whose first keyframe sits six seconds in comes back as a four second file.
 * Past this fraction the run is kept whole instead, on the grounds that a
 * briefly blocky opening is worth more than the footage the user asked for.
 */
const MAX_KEYFRAME_SKIP = 0.35;

/** Index of the first fragment to keep: the last continuous run, from a keyframe. */
function firstKept({ fragments, tracks, videoTrack }: Scan): number {
    let run = fragments.length - 1;

    while (run > 0 && timeOf(fragments[run], tracks, videoTrack) - timeOf(fragments[run - 1], tracks, videoTrack) <= MAX_GAP) {
        run--;
    }

    let start = run;
    while (start < fragments.length - 1 && !isSync(fragments[start], videoTrack)) start++;

    // The keyframe search only pays for itself while it stays a correction.
    const span = fragments.length - run;
    if (span > 1 && (start - run) / span > MAX_KEYFRAME_SKIP) return run;

    return start;
}

function writeUint(view: DataView, at: number, width: number, value: bigint) {
    const clamped = value < 0n ? 0n : value;

    if (width === 8) view.setBigUint64(at, clamped);
    else view.setUint32(at, Number(clamped & 0xffffffffn));
}

/**
 * Copies the header plus one run of fragments, rebased so the run starts at zero.
 *
 * Every track keeps its own base: they do not share a timescale, and an audio
 * track rebased against the video track's time would drift.
 */
function emit(data: Uint8Array, scanned: Scan, from: number, to: number): Uint8Array {
    const { fragments, head } = scanned;
    const kept = fragments.slice(from, to + 1);

    const bases = new Map<number, bigint>();
    for (const track of kept[0].tracks) bases.set(track.trackId, track.decodeTime);

    const body = data.subarray(kept[0].offset, kept[kept.length - 1].end);
    const out = new Uint8Array(head + body.length);
    out.set(data.subarray(0, head), 0);
    out.set(body, head);

    const outView = new DataView(out.buffer);
    const shift = head - kept[0].offset;

    for (const fragment of kept) {
        for (const track of fragment.tracks) {
            // A track that only appears further into the buffer has no base of
            // its own; the first fragment it does appear in becomes its zero.
            let base = bases.get(track.trackId);
            if (base === undefined) {
                base = track.decodeTime;
                bases.set(track.trackId, base);
            }

            writeUint(outView, track.at + shift, track.width, track.decodeTime - base);
        }
    }

    return out;
}

/**
 * Rebases a fragmented MP4 so it starts at zero.
 *
 * Leading fragments are dropped until one that opens on a keyframe, because a
 * clip starting on a delta frame is the "broken clip" case: the decoder has
 * nothing to build its first frames from.
 *
 * Returns null when the data is not a fragmented MP4, or when it already starts
 * at zero, in which case the caller keeps the original bytes.
 */
export function rebaseMp4(data: Uint8Array): Uint8Array | null {
    const scanned = scan(data);
    if (!scanned) return null;

    const { fragments } = scanned;
    const start = firstKept(scanned);

    const zeroed = start === 0 && fragments[0].tracks.every(t => t.decodeTime === 0n);
    if (zeroed) return null;

    return emit(data, scanned, start, fragments.length - 1);
}

/**
 * Cuts a fragmented MP4 down to a range, without re-encoding anything.
 *
 * The cut lands on fragment boundaries: the kept run opens on the last keyframe
 * at or before `fromMs`, so the result is never a fraction of a second shorter
 * than asked, only a fraction longer. Nothing is decoded, so this is instant and
 * lossless whatever the length of the clip.
 *
 * Returns null when the data is not a fragmented MP4 or when the range covers
 * the whole of it, in which case the caller keeps the original bytes.
 */
export function trimMp4(data: Uint8Array, fromMs: number, toMs: number): Uint8Array | null {
    const scanned = scan(data);
    if (!scanned) return null;

    const { fragments, tracks, videoTrack } = scanned;
    const at = (i: number) => timeOf(fragments[i], tracks, videoTrack);

    // Whatever the buffer left in front of the first fragment is the clip's own
    // zero; the caller asks for a range in clip time, not in capture time.
    const zero = at(0);

    let start = 0;
    for (let i = 0; i < fragments.length; i++) {
        if (at(i) - zero <= fromMs && isSync(fragments[i], videoTrack)) start = i;
    }

    let end = start;
    for (let i = start; i < fragments.length; i++) {
        if (at(i) - zero <= toMs) end = i;
    }

    if (start === 0 && end === fragments.length - 1) return null;

    return emit(data, scanned, start, end);
}

/** An audio track a file declares, and the name its handler carries. */
interface AudioTrack {
    id: number;
    /**
     * The `hdlr` box's trailing name.
     *
     * Ordinary encoders write something generic here - `SoundHandler` - and
     * Discord's clip recorder writes the key it recorded the speaker under, so
     * this is what tells one person's track from another's.
     */
    handler: string;
}

/**
 * The trailing name of a `hdlr` box.
 *
 * Four bytes of version and flags, four pre-defined, the four-character handler
 * type and twelve reserved come first; the name is the rest. Writers terminate
 * it with a NUL, and a reader should not assume what follows that is printable.
 */
function handlerName(data: Uint8Array, hdlr: Box): string {
    let out = "";

    for (let pos = hdlr.body + 24; pos < hdlr.end; pos++) {
        const byte = data[pos];
        if (!byte) break;

        out += String.fromCharCode(byte);
    }

    return out;
}

/**
 * Every audio track a file declares, with the handler name each carries.
 *
 * This exists to answer one question from the file rather than from a guess.
 * Discord's clip recorder keeps a separate audio track per speaker while it
 * records - its own logs say so, `RecordAudioForUser ... audio track for key` -
 * and its exporter demuxes those tracks back out and mixes them down. Whether
 * the mixdown has already happened by the time a clip lands on disc decides
 * whether a person can ever be turned down after the fact, and counting the
 * tracks in a saved file is the whole of that question.
 *
 * Null when there is no readable `moov`, which means the file is not one this
 * can speak for rather than that it has no audio.
 */
export function probeAudioTracks(data: Uint8Array): AudioTrack[] | null {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const moov = find(children(view, data, 0, data.length), "moov");
    if (!moov) return null;

    const found: AudioTrack[] = [];

    for (const trak of children(view, data, moov.body, moov.end)) {
        if (trak.type !== "trak") continue;

        const parts = children(view, data, trak.body, trak.end);

        const tkhd = find(parts, "tkhd");
        const mdia = find(parts, "mdia");
        if (!tkhd || !mdia) continue;

        const hdlr = find(children(view, data, mdia.body, mdia.end), "hdlr");
        if (!hdlr || typeOf(data, hdlr.body + 8) !== "soun") continue;

        // Version 1 widens the two timestamps before the track id from 4 bytes
        // to 8, exactly as it does everywhere else in this file.
        const wide = data[tkhd.body] === 1;

        found.push({
            id: view.getUint32(tkhd.body + 4 + (wide ? 16 : 8)),
            handler: handlerName(data, hdlr)
        });
    }

    return found;
}

/**
 * Length of a fragmented MP4 in seconds, or 0 when it cannot be read.
 *
 * Measured to the start of the last fragment, so it is short by whatever that
 * one holds - a timeslice at most. Good enough to bound a trim slider, not to
 * label the clip.
 */
export function lengthMp4(data: Uint8Array): number {
    const scanned = scan(data);
    if (!scanned) return 0;

    const { fragments, tracks, videoTrack } = scanned;
    const last = fragments.length - 1;

    return Math.max(0, timeOf(fragments[last], tracks, videoTrack) - timeOf(fragments[0], tracks, videoTrack)) / 1000;
}
