/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - WebM timeline repair
 *
 * The rolling buffer saves the container header plus whatever clusters are
 * still in memory. Cluster timecodes are absolute, counted from the moment the
 * capture started, so a buffer that has been running for seven minutes writes
 * clips whose first cluster sits at 7:00. Players take the last timecode as the
 * duration, which is how a 15s clip ends up claiming to be seven minutes long,
 * with nothing to show for the first six and a half.
 *
 * Rewriting each cluster's Timecode element so the first kept one starts at 0
 * fixes the duration, the seek bar and the players that refuse the file
 * outright. Timecodes inside a cluster's blocks are relative to the cluster, so
 * they need no change, and the rewritten integer keeps its original byte width -
 * EBML unsigned integers may be padded - which means no size or offset in the
 * file moves.
 *
 * The same machinery cuts a clip down to a range without going near an encoder:
 * a cluster opening on a keyframe is a self-contained unit, so keeping a run of
 * them and rebasing the result is a lossless trim, at the cost of landing on
 * cluster boundaries.
 */

const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];
const TRACKS_ID = [0x16, 0x54, 0xae, 0x6b];
const TRACK_ENTRY_ID = 0xae;
const TRACK_NUMBER_ID = 0xd7;
const TRACK_TYPE_ID = 0x83;
const TRACK_TYPE_VIDEO = 1;
const TIMECODE_ID = 0xe7;
const SIMPLE_BLOCK_ID = 0xa3;
const BLOCK_GROUP_ID = 0xa0;

/** Byte width an EBML variable-size integer announces in its first byte. */
function vintLength(first: number): number {
    for (let i = 0; i < 8; i++) if (first & (0x80 >> i)) return i + 1;
    return 0;
}

interface Vint {
    /** Value with the length marker cleared. */
    value: number;
    length: number;
    /** True when every value bit is set, which EBML uses for "unknown size". */
    unknown: boolean;
}

function readVint(data: Uint8Array, pos: number): Vint | null {
    if (pos >= data.length) return null;

    const length = vintLength(data[pos]);
    if (!length || pos + length > data.length) return null;

    let value = data[pos] & (0xff >> length);
    let allOnes = value === (0xff >> length);

    for (let i = 1; i < length; i++) {
        value = value * 256 + data[pos + i];
        if (data[pos + i] !== 0xff) allOnes = false;
    }

    return { value, length, unknown: allOnes };
}

function readUint(data: Uint8Array, pos: number, length: number): number {
    let value = 0;
    for (let i = 0; i < length; i++) value = value * 256 + data[pos + i];
    return value;
}

function writeUint(data: Uint8Array, pos: number, length: number, value: number) {
    let left = Math.max(0, Math.round(value));

    for (let i = length - 1; i >= 0; i--) {
        data[pos + i] = left % 256;
        left = Math.floor(left / 256);
    }
}

interface Cluster {
    offset: number;
    /** Absolute offset one past the cluster. */
    end: number;
    /** Absolute position of the Timecode element's payload. */
    timecodeAt: number;
    timecodeLength: number;
    timecode: number;
    /** True when the first video block in the cluster is a keyframe. */
    keyframe: boolean;
}

/**
 * Reads a cluster header at `offset`, or null when this is not one.
 *
 * Live clusters carry an unknown size, so their end cannot be read from the
 * header and the scan below looks for the next cluster id instead. Everything
 * needed here - the timecode and the first block's keyframe flag - sits in the
 * first bytes anyway.
 */
function readCluster(data: Uint8Array, offset: number, videoTrack: number): Cluster | null {
    const size = readVint(data, offset + CLUSTER_ID.length);
    if (!size) return null;

    let pos = offset + CLUSTER_ID.length + size.length;
    if (data[pos] !== TIMECODE_ID) return null;

    const timecodeSize = readVint(data, pos + 1);
    if (!timecodeSize || timecodeSize.value < 1 || timecodeSize.value > 8) return null;

    const timecodeAt = pos + 1 + timecodeSize.length;
    const cluster: Cluster = {
        offset,
        // Filled in by the scan once the next cluster is known.
        end: data.length,
        timecodeAt,
        timecodeLength: timecodeSize.value,
        timecode: readUint(data, timecodeAt, timecodeSize.value),
        keyframe: false
    };

    // Walk the cluster's children until the first block of the video track. The
    // audio blocks that may come first are useless here: every Opus packet is
    // flagged as a keyframe, so reading whichever block comes first would call
    // every cluster decodable.
    pos = timecodeAt + timecodeSize.value;

    for (let i = 0; i < 64 && pos < data.length; i++) {
        const id = data[pos];

        // A BlockGroup only ever holds non-keyframes in a MediaRecorder file, so
        // reaching one means the cluster does not open on a keyframe.
        if (id === BLOCK_GROUP_ID) break;

        const elementSize = readVint(data, pos + 1);
        if (!elementSize || elementSize.unknown) break;

        if (id === SIMPLE_BLOCK_ID) {
            const track = readVint(data, pos + 1 + elementSize.length);
            if (!track) break;

            if (track.value === videoTrack) {
                // Track number, a 16 bit relative timecode, then the flags byte.
                cluster.keyframe = (data[pos + 1 + elementSize.length + track.length + 2] & 0x80) !== 0;
                break;
            }
        }

        pos += 1 + elementSize.length + elementSize.value;
    }

    return cluster;
}

/**
 * Track number of the video track, from the Tracks element in the header.
 *
 * Falls back to 1, which is what MediaRecorder writes, when the header cannot be
 * read: worst case the keyframe flag comes from the audio track again, which is
 * how this behaved before.
 */
function findVideoTrack(data: Uint8Array): number {
    let tracks = -1;

    for (let pos = 0; pos + 8 < data.length && pos < 1 << 20; pos++) {
        if (data[pos] === TRACKS_ID[0] && data[pos + 1] === TRACKS_ID[1]
            && data[pos + 2] === TRACKS_ID[2] && data[pos + 3] === TRACKS_ID[3]) {
            tracks = pos;
            break;
        }
    }

    if (tracks < 0) return 1;

    const tracksSize = readVint(data, tracks + TRACKS_ID.length);
    if (!tracksSize || tracksSize.unknown) return 1;

    let pos = tracks + TRACKS_ID.length + tracksSize.length;
    const end = Math.min(data.length, pos + tracksSize.value);

    while (pos < end) {
        const entrySize = readVint(data, pos + 1);
        if (!entrySize || entrySize.unknown) break;

        const body = pos + 1 + entrySize.length;
        const bodyEnd = Math.min(end, body + entrySize.value);

        if (data[pos] === TRACK_ENTRY_ID) {
            let number = -1;
            let type = -1;

            for (let child = body; child < bodyEnd;) {
                const childSize = readVint(data, child + 1);
                if (!childSize || childSize.unknown) break;

                const value = readUint(data, child + 1 + childSize.length, childSize.value);
                if (data[child] === TRACK_NUMBER_ID) number = value;
                if (data[child] === TRACK_TYPE_ID) type = value;

                child += 1 + childSize.length + childSize.value;
            }

            if (type === TRACK_TYPE_VIDEO && number > 0) return number;
        }

        pos = bodyEnd;
    }

    return 1;
}

function isClusterId(data: Uint8Array, pos: number): boolean {
    return data[pos] === CLUSTER_ID[0]
        && data[pos + 1] === CLUSTER_ID[1]
        && data[pos + 2] === CLUSTER_ID[2]
        && data[pos + 3] === CLUSTER_ID[3];
}

/**
 * Largest hole, in milliseconds, that still counts as continuous footage.
 *
 * The buffer prunes by age, so its oldest cluster is at most one timeslice older
 * than the window. Anything further back is a leftover from a capture that was
 * paused or starved - a source that stopped producing frames, a minimised
 * window - and dragging it into the clip is what produces the seven minute
 * files with nothing in them.
 */
const MAX_GAP = 3000;

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

/**
 * Index of the first cluster to keep: the start of the last continuous run,
 * moved forward to a keyframe so the clip can be decoded from its first frame.
 */
function firstKeptCluster(clusters: Cluster[]): number {
    let run = clusters.length - 1;

    while (run > 0 && clusters[run].timecode - clusters[run - 1].timecode <= MAX_GAP) run--;

    let start = run;
    while (start < clusters.length - 1 && !clusters[start].keyframe) start++;

    // The keyframe search only pays for itself while it stays a correction.
    const span = clusters.length - run;
    if (span > 1 && (start - run) / span > MAX_KEYFRAME_SKIP) return run;

    return start;
}

/**
 * Walks a live WebM into its header and its clusters.
 *
 * Returns null for anything that does not look like one, which is the caller's
 * signal to leave the bytes alone rather than to guess.
 */
function scanClusters(data: Uint8Array): Cluster[] | null {
    const clusters: Cluster[] = [];
    const videoTrack = findVideoTrack(data);

    for (let pos = 0; pos + 8 < data.length; pos++) {
        if (!isClusterId(data, pos)) continue;

        const cluster = readCluster(data, pos, videoTrack);
        if (!cluster) continue;

        // Each cluster runs up to the next one: live clusters have no size, so
        // this is the only thing that says where one ends.
        const previous = clusters[clusters.length - 1];
        if (previous) previous.end = pos;

        clusters.push(cluster);

        // Nothing else in this cluster can be a cluster header, but the scan
        // still has to walk it byte by byte: live clusters have no size.
        pos += CLUSTER_ID.length;
    }

    return clusters.length ? clusters : null;
}

/**
 * Copies the header plus one run of clusters, rebased so the run starts at zero.
 */
function emit(data: Uint8Array, clusters: Cluster[], from: number, to: number): Uint8Array {
    const head = clusters[0].offset;
    const kept = clusters.slice(from, to + 1);
    const base = kept[0].timecode;

    const body = data.subarray(kept[0].offset, kept[kept.length - 1].end);
    const out = new Uint8Array(head + body.length);
    out.set(data.subarray(0, head), 0);
    out.set(body, head);

    const shift = head - kept[0].offset;

    for (const cluster of kept) {
        writeUint(out, cluster.timecodeAt + shift, cluster.timecodeLength, Math.max(0, cluster.timecode - base));
    }

    return out;
}

/**
 * Cuts a live WebM down to a range, without re-encoding anything.
 *
 * The cut lands on cluster boundaries: the kept run opens on the last keyframe
 * cluster at or before `fromMs`, so the result is never a fraction of a second
 * shorter than asked, only a fraction longer. Nothing is decoded, so this is
 * instant and lossless whatever the length of the clip.
 *
 * Returns null when the data is not a live WebM or when the range covers the
 * whole of it, in which case the caller keeps the original bytes.
 */
export function trimWebm(data: Uint8Array, fromMs: number, toMs: number): Uint8Array | null {
    const clusters = scanClusters(data);
    if (!clusters) return null;

    // Whatever the buffer left in front of the first cluster is the clip's own
    // zero; the caller asks for a range in clip time, not in capture time.
    const zero = clusters[0].timecode;

    let start = 0;
    for (let i = 0; i < clusters.length; i++) {
        if (clusters[i].timecode - zero <= fromMs && clusters[i].keyframe) start = i;
    }

    let end = start;
    for (let i = start; i < clusters.length; i++) {
        if (clusters[i].timecode - zero <= toMs) end = i;
    }

    if (start === 0 && end === clusters.length - 1) return null;

    return emit(data, clusters, start, end);
}

/**
 * Length of a live WebM in seconds, or 0 when it cannot be read.
 *
 * Measured to the start of the last cluster, so it is short by whatever that one
 * holds - a timeslice at most. Good enough to bound a trim slider, not to label
 * the clip.
 */
export function lengthWebm(data: Uint8Array): number {
    const clusters = scanClusters(data);
    if (!clusters) return 0;

    return Math.max(0, clusters[clusters.length - 1].timecode - clusters[0].timecode) / 1000;
}

/**
 * Rebases a live WebM so it starts at zero.
 *
 * Leading clusters are dropped until one that starts on a keyframe, because a
 * clip that opens on a delta frame is exactly the "broken clip" case: the
 * decoder has nothing to build the first frames from and players show garbage,
 * a black screen, or refuse the file.
 *
 * Returns null when the data does not look like a live WebM, in which case the
 * caller keeps the original bytes.
 */
export function rebaseWebm(data: Uint8Array): Uint8Array | null {
    const clusters = scanClusters(data);
    if (!clusters) return null;

    const start = firstKeptCluster(clusters);

    // Already one contiguous run starting at zero: nothing to repair.
    if (clusters[start].timecode === 0 && start === 0) return null;

    return emit(data, clusters, start, clusters.length - 1);
}
