/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { lengthMp4, probeAudioTracks, rebaseMp4, trimMp4 } from "../src/userplugins/Clipper/mp4.ts";
import { ascii, box, concat, decodeTimes, file, fragment, trak, wideTrak, zeros } from "./mp4box.ts";

/** The one video track every timing test measures against. */
const VIDEO = trak(1, "vide", "VideoHandler");

/** Not an MP4 at all, which every reader has to answer for without throwing. */
const GARBAGE = concat(ascii("not an mp4 at all"), zeros(64));

/** Counts `moof` boxes, which is how many fragments a result kept. */
function fragments(data: Uint8Array): number {
    let count = 0;

    for (let at = 0; at + 4 <= data.length; at++) {
        if (String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]) === "moof") count++;
    }

    return count;
}

test("lengthMp4 measures from the first fragment to the last", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 0 }]),
        fragment([{ id: 1, decodeTime: 1000 }]),
        fragment([{ id: 1, decodeTime: 2500 }])
    ]);

    // Measured to the start of the last fragment, so the last one's own
    // contents are not counted - that is the documented approximation.
    assert.equal(lengthMp4(data), 2.5);
});

test("lengthMp4 reads the length in the track's own timescale", () => {
    const data = file([trak(1, "vide", "VideoHandler", 90000)], [
        fragment([{ id: 1, decodeTime: 0 }]),
        fragment([{ id: 1, decodeTime: 180000 }])
    ]);

    assert.equal(lengthMp4(data), 2);
});

test("lengthMp4 ignores a buffer that never started at zero", () => {
    // A ring buffer's oldest fragment carries whatever time the recording was
    // at, so the length is a difference and never the last value.
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 600_000 }]),
        fragment([{ id: 1, decodeTime: 604_000 }])
    ]);

    assert.equal(lengthMp4(data), 4);
});

test("lengthMp4 answers zero for what it cannot read", () => {
    assert.equal(lengthMp4(GARBAGE), 0);
    // A `moov` with no fragments behind it is not a fragmented MP4 either.
    assert.equal(lengthMp4(file([VIDEO], [])), 0);
});

test("rebaseMp4 leaves a file that already starts at zero alone", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 0 }]),
        fragment([{ id: 1, decodeTime: 1000 }])
    ]);

    // Null is the caller's signal to keep the original bytes, not an error.
    assert.equal(rebaseMp4(data), null);
});

test("rebaseMp4 pulls a buffer's times back to zero", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 600_000 }]),
        fragment([{ id: 1, decodeTime: 601_000 }]),
        fragment([{ id: 1, decodeTime: 602_000 }])
    ]);

    const out = rebaseMp4(data)!;

    assert.notEqual(out, null);
    assert.deepEqual(decodeTimes(out), [0, 1000, 2000]);
    assert.equal(fragments(out), 3);
});

test("rebaseMp4 rebases a 64 bit decode time in place, at its own width", () => {
    // A long recording overflows 32 bits of ticks, and a value rewritten into
    // the wrong width would move every box after it.
    const data = file([trak(1, "vide", "VideoHandler", 90000)], [
        fragment([{ id: 1, decodeTime: 5_000_000_000, wide: true }]),
        fragment([{ id: 1, decodeTime: 5_000_090_000, wide: true }])
    ]);

    const out = rebaseMp4(data)!;

    assert.deepEqual(decodeTimes(out), [0, 90000]);
    assert.equal(out.length, data.length);
});

test("rebaseMp4 drops the leading fragments before the first keyframe", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 0, sync: false }]),
        fragment([{ id: 1, decodeTime: 500 }]),
        fragment([{ id: 1, decodeTime: 1000 }]),
        fragment([{ id: 1, decodeTime: 1500 }])
    ]);

    const out = rebaseMp4(data)!;

    // The delta frame at the head has nothing to decode against, so it goes and
    // the keyframe behind it becomes the clip's zero.
    assert.equal(fragments(out), 3);
    assert.deepEqual(decodeTimes(out), [0, 500, 1000]);
});

test("rebaseMp4 keeps a blocky opening rather than throwing away most of the clip", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 600_000, sync: false }]),
        fragment([{ id: 1, decodeTime: 600_500, sync: false }]),
        fragment([{ id: 1, decodeTime: 601_000, sync: false }]),
        fragment([{ id: 1, decodeTime: 601_500 }])
    ]);

    const out = rebaseMp4(data)!;

    // Three quarters of the footage to reach a keyframe is past
    // MAX_KEYFRAME_SKIP: the user asked for the footage, not for a clean
    // first frame.
    assert.equal(fragments(out), 4);
    assert.deepEqual(decodeTimes(out), [0, 500, 1000, 1500]);
});

test("rebaseMp4 keeps only the run after a gap in the recording", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 0 }]),
        fragment([{ id: 1, decodeTime: 1000 }]),
        // The recorder was stopped and started again here; the two halves do
        // not belong to the same clip.
        fragment([{ id: 1, decodeTime: 20_000 }]),
        fragment([{ id: 1, decodeTime: 21_000 }])
    ]);

    const out = rebaseMp4(data)!;

    assert.equal(fragments(out), 2);
    assert.deepEqual(decodeTimes(out), [0, 1000]);
});

test("rebaseMp4 gives every track its own zero", () => {
    // Video and audio do not share a timescale, so one base rebased against
    // the other's ticks would drift the sound off the picture.
    const data = file([VIDEO, trak(2, "soun", "SoundHandler", 48000)], [
        fragment([{ id: 1, decodeTime: 600_000 }, { id: 2, decodeTime: 28_800_000 }]),
        fragment([{ id: 1, decodeTime: 601_000 }, { id: 2, decodeTime: 28_848_000 }])
    ]);

    const out = rebaseMp4(data)!;

    assert.deepEqual(decodeTimes(out), [0, 0, 1000, 48000]);
});

test("rebaseMp4 zeroes a track that only appears part way in", () => {
    // A speaker who joins mid-recording brings a track that is absent from the
    // first fragment, and it has to start from where it does appear.
    const data = file([VIDEO, trak(2, "soun", "SoundHandler")], [
        fragment([{ id: 1, decodeTime: 600_000 }]),
        fragment([{ id: 1, decodeTime: 601_000 }, { id: 2, decodeTime: 601_000 }]),
        fragment([{ id: 1, decodeTime: 602_000 }, { id: 2, decodeTime: 602_000 }])
    ]);

    const out = rebaseMp4(data)!;

    assert.deepEqual(decodeTimes(out), [0, 1000, 0, 2000, 1000]);
});

test("rebaseMp4 refuses what is not a fragmented MP4", () => {
    assert.equal(rebaseMp4(GARBAGE), null);
    assert.equal(rebaseMp4(file([VIDEO], [])), null);
});

test("trimMp4 keeps the fragments a range covers", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 0 }]),
        fragment([{ id: 1, decodeTime: 1000 }]),
        fragment([{ id: 1, decodeTime: 2000 }]),
        fragment([{ id: 1, decodeTime: 3000 }]),
        fragment([{ id: 1, decodeTime: 4000 }])
    ]);

    const out = trimMp4(data, 1000, 2500)!;

    // The cut lands on fragment boundaries, so the result is never shorter than
    // what was asked for - here 1000 to 2000, kept whole.
    assert.equal(fragments(out), 2);
    assert.deepEqual(decodeTimes(out), [0, 1000]);
});

test("trimMp4 asks its range in clip time, not in capture time", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 600_000 }]),
        fragment([{ id: 1, decodeTime: 601_000 }]),
        fragment([{ id: 1, decodeTime: 602_000 }])
    ]);

    const out = trimMp4(data, 1000, 1500)!;

    assert.equal(fragments(out), 1);
    assert.deepEqual(decodeTimes(out), [0]);
});

test("trimMp4 backs the start up to the last keyframe before it", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 0 }]),
        fragment([{ id: 1, decodeTime: 1000, sync: false }]),
        fragment([{ id: 1, decodeTime: 2000, sync: false }]),
        fragment([{ id: 1, decodeTime: 3000 }]),
        fragment([{ id: 1, decodeTime: 4000 }])
    ]);

    // Asked for 2500, but the only keyframe at or before it is the very first
    // fragment: starting anywhere else decodes into garbage.
    const out = trimMp4(data, 2500, 3500)!;

    assert.equal(fragments(out), 4);
    assert.deepEqual(decodeTimes(out), [0, 1000, 2000, 3000]);
});

test("trimMp4 leaves the bytes alone when the range is the whole file", () => {
    const data = file([VIDEO], [
        fragment([{ id: 1, decodeTime: 0 }]),
        fragment([{ id: 1, decodeTime: 1000 }])
    ]);

    assert.equal(trimMp4(data, 0, 9999), null);
    assert.equal(trimMp4(GARBAGE, 0, 1000), null);
});

test("probeAudioTracks names every audio track and skips the video one", () => {
    const data = file([
        VIDEO,
        trak(2, "soun", "user-1234"),
        trak(3, "soun", "user-5678")
    ], [fragment([{ id: 1, decodeTime: 0 }])]);

    assert.deepEqual(probeAudioTracks(data), [
        { id: 2, handler: "user-1234" },
        { id: 3, handler: "user-5678" }
    ]);
});

test("probeAudioTracks stops the handler name at its terminator", () => {
    // Writers pad the box after the NUL, and reading to the end of the box
    // would hand a speaker key with whatever follows glued onto it.
    const data = file([trak(1, "soun", "SoundHandler")], [fragment([{ id: 1, decodeTime: 0 }])]);

    assert.deepEqual(probeAudioTracks(data), [{ id: 1, handler: "SoundHandler" }]);
});

test("probeAudioTracks reads a track id out of the wide header too", () => {
    const data = file([wideTrak(7, "soun", "user-9")], [fragment([{ id: 7, decodeTime: 0 }])]);

    assert.deepEqual(probeAudioTracks(data), [{ id: 7, handler: "user-9" }]);
});

test("probeAudioTracks answers an empty list for a file with no sound", () => {
    // Empty and null mean different things here: this file has no audio, and
    // null below means the file cannot be spoken for at all.
    assert.deepEqual(probeAudioTracks(file([VIDEO], [fragment([{ id: 1, decodeTime: 0 }])])), []);
    assert.equal(probeAudioTracks(GARBAGE), null);
});

test("probeAudioTracks skips a track missing the boxes it would be read from", () => {
    const half = box("trak", box("tkhd", zeros(16)));
    const data = file([VIDEO, half, trak(3, "soun", "user-3")], [fragment([{ id: 1, decodeTime: 0 }])]);

    assert.deepEqual(probeAudioTracks(data), [{ id: 3, handler: "user-3" }]);
});
