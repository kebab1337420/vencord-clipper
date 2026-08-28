/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { boxes, descend, find } from "../src/userplugins/Clipper/boxes.ts";
import { ascii, box, concat, sized, u32, u64, zeros } from "./mp4box.ts";

/** The walk takes a view of the same bytes it takes. */
function walk(data: Uint8Array, from = 0, to = data.length) {
    return boxes(data, new DataView(data.buffer, data.byteOffset, data.byteLength), from, to);
}

test("walks siblings and reports each payload's extent", () => {
    const data = concat(box("ftyp", ascii("isom")), box("moov", ascii("abcd")), box("mdat", zeros(6)));

    assert.deepEqual(walk(data).map(b => b.type), ["ftyp", "moov", "mdat"]);

    const [ftyp] = walk(data);
    assert.equal(ftyp.start, 8);
    assert.equal(ftyp.end, 12);
    assert.equal(new TextDecoder().decode(data.subarray(ftyp.start, ftyp.end)), "isom");
});

test("stops at a box that runs past the end rather than reading into the next", () => {
    // A recording cut off mid-write ends exactly like this, and the readers all
    // walk one before they know whether the file is whole.
    const data = concat(box("ftyp", ascii("isom")), sized("mdat", 4096, zeros(8)));

    assert.deepEqual(walk(data).map(b => b.type), ["ftyp"]);
});

test("stops at a size smaller than the header it claims", () => {
    // Size 4 is inside the header: honouring it would leave the cursor where it
    // was and the walk would never end.
    assert.deepEqual(walk(concat(sized("free", 4), box("moov"))), []);
});

test("steps over a 64 bit size", () => {
    const big = box("free");
    const payload = zeros(8);
    // Size 1 means the real size follows the type, as a 64 bit field.
    const wide = concat(u32(1), ascii("mdat"), u64(BigInt(16 + payload.length)), payload);

    const walked = walk(concat(wide, big));

    assert.deepEqual(walked.map(b => b.type), ["mdat", "free"]);
    // The payload starts past the 16 byte header, not the 8 byte one.
    assert.equal(walked[0].start, 16);
    assert.equal(walked[0].end, 24);
});

test("refuses a 64 bit size no offset arithmetic could survive", () => {
    const data = concat(u32(1), ascii("mdat"), u64(0xffffffffffffffffn), zeros(8));

    assert.deepEqual(walk(data), []);
});

test("a size of zero runs to the end of the parent", () => {
    // The last box of a stream is allowed to say so instead of a
    // length, which is how a writer that does not know the size yet writes it.
    const data = concat(box("ftyp", ascii("isom")), concat(u32(0), ascii("mdat"), zeros(12)));

    const walked = walk(data);

    assert.deepEqual(walked.map(b => b.type), ["ftyp", "mdat"]);
    assert.equal(walked[1].end, data.length);
});

test("walks only between the offsets it is given", () => {
    const inner = concat(box("mdhd", zeros(4)), box("hdlr", zeros(4)));
    const data = box("mdia", inner);

    const [mdia] = walk(data);
    assert.deepEqual(walk(data, mdia.start, mdia.end).map(b => b.type), ["mdhd", "hdlr"]);
});

test("find picks the first box of a type, and undefined when there is none", () => {
    const data = concat(box("free"), box("moov", ascii("one")), box("moov", ascii("two")));
    const walked = walk(data);

    const first = find(walked, "moov")!;
    assert.equal(new TextDecoder().decode(data.subarray(first.start, first.end)), "one");
    assert.equal(find(walked, "mdat"), undefined);
});

test("descend follows a chain of single children", () => {
    const data = box("trak", box("mdia", box("minf", box("stbl", ascii("here")))));
    const view = new DataView(data.buffer);
    const [trak] = walk(data);

    const stbl = descend(data, view, trak, ["mdia", "minf", "stbl"])!;
    assert.equal(new TextDecoder().decode(data.subarray(stbl.start, stbl.end)), "here");

    assert.equal(descend(data, view, trak, ["mdia", "nope", "stbl"]), undefined);
    // An empty path is the box itself, which is what makes the walk composable.
    assert.deepEqual(descend(data, view, trak, []), trak);
});
