/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - GIF89a, written by hand
 *
 * A clip is a video, and a video posted in a chat is a player somebody has to
 * press. A GIF plays itself, loops, and survives being reposted anywhere, which
 * is why the three-second reaction bit of a clip wants to be one.
 *
 * Nothing in the browser writes GIFs, so this does: a palette chosen by median
 * cut over the frames themselves, the LZW the format has always used, and the
 * one trick that decides whether a screen recording comes out at two megabytes
 * or twenty - every pixel that did not change since the previous frame is
 * written as transparent, and transparent runs cost almost nothing once LZW has
 * seen a few of them. On game footage, where the HUD and the map never move,
 * that is most of the picture.
 *
 * There is no dithering. Banding on a gradient is the honest cost of 256
 * colours, and dithering trades it for noise that differs every frame, which
 * defeats the frame differencing above and doubles the file.
 */

/** Highest palette size the format allows once transparency takes an index. */
const MAX_COLORS = 255;

/** Colour precision the histogram works at: 5 bits per channel, 32768 cells. */
const BITS = 5;
const CELLS = 1 << (BITS * 3);

/** A byte sink that grows, because the size is not known until the end. */
class Bytes {
    private data = new Uint8Array(1 << 16);
    private length = 0;

    byte(value: number): void {
        if (this.length === this.data.length) {
            const grown = new Uint8Array(this.data.length * 2);
            grown.set(this.data);
            this.data = grown;
        }

        this.data[this.length++] = value & 0xff;
    }

    short(value: number): void {
        this.byte(value);
        this.byte(value >> 8);
    }

    string(value: string): void {
        for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i));
    }

    bytes(values: ArrayLike<number>): void {
        for (let i = 0; i < values.length; i++) this.byte(values[i]);
    }

    take(): Uint8Array {
        return this.data.subarray(0, this.length);
    }
}

/**
 * The GIF sub-block stream: codes packed low bit first, then cut into blocks of
 * at most 255 bytes, each one introduced by its own length.
 */
class Blocks {
    private block = new Uint8Array(255);
    private filled = 0;
    private bits = 0;
    private held = 0;

    constructor(private readonly out: Bytes) { }

    write(code: number, width: number): void {
        this.held |= code << this.bits;
        this.bits += width;

        while (this.bits >= 8) {
            this.push(this.held & 0xff);
            this.held >>= 8;
            this.bits -= 8;
        }
    }

    /** Flushes the last partial byte and closes the stream with an empty block. */
    end(): void {
        if (this.bits > 0) this.push(this.held & 0xff);
        if (this.filled > 0) this.flush();

        this.out.byte(0);
    }

    private push(value: number): void {
        this.block[this.filled++] = value;
        if (this.filled === 255) this.flush();
    }

    private flush(): void {
        this.out.byte(this.filled);
        this.out.bytes(this.block.subarray(0, this.filled));
        this.filled = 0;
    }
}

/**
 * LZW as the format defines it, straight onto the block stream.
 *
 * The whole difficulty is the code width, because it is never written down: the
 * decoder works it out from how big its own table has grown, and if the two ever
 * disagree by a single bit the rest of the file is noise. So this tracks the
 * decoder's table rather than its own - `mirror` is what the decoder will hold
 * once it has read the code just written, which is one behind this side, since
 * the decoder cannot add an entry until it has seen the code that follows it.
 * The end-of-information code is subject to the same rule, and getting that one
 * wrong only shows up on the rare frame that crosses a power of two on its very
 * last code.
 */
function compress(indices: Uint8Array, minCodeSize: number, out: Bytes): void {
    const blocks = new Blocks(out);

    const clear = 1 << minCodeSize;
    const end = clear + 1;

    let width = minCodeSize + 1;
    let next = end + 1;
    let mirror = end;
    let table = new Map<number, number>();

    const emit = (code: number) => {
        blocks.write(code, width);

        mirror++;
        if (mirror >= 1 << width && width < 12) width++;
    };

    const restart = () => {
        blocks.write(clear, width);

        table = new Map();
        next = end + 1;
        width = minCodeSize + 1;
        mirror = end;
    };

    blocks.write(clear, width);

    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const value = indices[i];
        const key = (prefix << 8) | value;

        const known = table.get(key);
        if (known !== undefined) {
            prefix = known;
            continue;
        }

        emit(prefix);

        // 4096 is as far as the code width goes, so a table that full can only
        // be thrown away and rebuilt from the next pixel on.
        if (next < 4096) table.set(key, next++);
        else restart();

        prefix = value;
    }

    emit(prefix);
    blocks.write(end, width);
    blocks.end();
}

/** One cell of the histogram: a 5-5-5 colour and how often it was seen. */
interface Cell {
    color: number;
    count: number;
}

/** A group of cells that will collapse into a single palette entry. */
interface Box {
    cells: Cell[];
    count: number;
}

function channel(color: number, shift: number): number {
    return (color >> shift) & ((1 << BITS) - 1);
}

/** Splits the box with the widest spread until there are enough of them. */
function medianCut(cells: Cell[], want: number): Box[] {
    const boxes: Box[] = [{ cells, count: cells.reduce((n, c) => n + c.count, 0) }];

    while (boxes.length < want) {
        // The busiest box that can still be cut: splitting a box nobody's
        // pixels land in buys nothing.
        let target = -1;
        let best = 0;

        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].cells.length > 1 && boxes[i].count > best) {
                best = boxes[i].count;
                target = i;
            }
        }

        if (target < 0) break;

        const box = boxes[target];

        // Cut along whichever channel the colours are most spread over, so the
        // split separates colours that actually look different.
        let shift = 0;
        let widest = -1;

        for (const at of [0, BITS, BITS * 2]) {
            let low = 1 << BITS;
            let high = -1;

            for (const cell of box.cells) {
                const value = channel(cell.color, at);
                if (value < low) low = value;
                if (value > high) high = value;
            }

            if (high - low > widest) {
                widest = high - low;
                shift = at;
            }
        }

        box.cells.sort((a, b) => channel(a.color, shift) - channel(b.color, shift));

        /*
         * The median by pixel count, not by cell count: half the picture on
         * each side, rather than half the distinct colours.
         *
         * The loop always takes at least one cell - a box is only ever picked
         * for splitting when it holds more than one - so both sides come out
         * non-empty without a guard for it.
         */
        let seen = 0;
        let split = 0;
        for (; split < box.cells.length - 1 && seen * 2 < box.count; split++) seen += box.cells[split].count;

        const left = box.cells.slice(0, split);
        const right = box.cells.slice(split);

        boxes[target] = { cells: left, count: seen };
        boxes.push({ cells: right, count: box.count - seen });
    }

    return boxes;
}

/** The palette, as flat 8-bit RGB, one entry per box. */
function paletteOf(boxes: Box[]): Uint8Array {
    const palette = new Uint8Array(boxes.length * 3);

    boxes.forEach((box, i) => {
        let r = 0;
        let g = 0;
        let b = 0;

        for (const cell of box.cells) {
            r += channel(cell.color, BITS * 2) * cell.count;
            g += channel(cell.color, BITS) * cell.count;
            b += channel(cell.color, 0) * cell.count;
        }

        const total = box.count || 1;

        // Back out of 5 bits into 8 by repeating the top bits, which keeps
        // white at 255 instead of landing it on 248.
        const wide = (value: number) => {
            const v = Math.round(value / total) & 0x1f;
            return (v << 3) | (v >> 2);
        };

        palette[i * 3] = wide(r);
        palette[i * 3 + 1] = wide(g);
        palette[i * 3 + 2] = wide(b);
    });

    return palette;
}

/** Palette lookup for every colour that turns up, worked out once each. */
class Nearest {
    private readonly cache = new Int16Array(CELLS).fill(-1);

    constructor(private readonly palette: Uint8Array) { }

    of(r: number, g: number, b: number): number {
        const key = ((r >> 3) << (BITS * 2)) | ((g >> 3) << BITS) | (b >> 3);
        const known = this.cache[key];
        if (known >= 0) return known;

        let best = 0;
        let closest = Infinity;

        for (let i = 0; i < this.palette.length; i += 3) {
            const dr = r - this.palette[i];
            const dg = g - this.palette[i + 1];
            const db = b - this.palette[i + 2];

            // Weighted the way the eye is: green carries most of the luminance,
            // so a green that is off reads as wrong far sooner than a blue.
            const distance = dr * dr * 3 + dg * dg * 6 + db * db;
            if (distance < closest) {
                closest = distance;
                best = i / 3;
            }
        }

        this.cache[key] = best;
        return best;
    }
}

interface GifOptions {
    /** Milliseconds each frame is held. */
    delay: number;
    /** Palette size, capped at 255 so transparency keeps an index. */
    colors?: number;
}

/**
 * Writes a looping GIF from frames that must all be the same size.
 *
 * The palette is built once, over every frame, rather than per frame: a palette
 * that shifts between frames makes flat areas crawl, and a shared one is what
 * lets a pixel be called unchanged at all.
 */
export function encodeGif(frames: ImageData[], { delay, colors = 128 }: GifOptions): Blob {
    if (!frames.length) throw new Error("A GIF needs at least one frame");

    const { width, height } = frames[0];
    const pixels = width * height;

    // Histogram over every frame, at 5 bits a channel. Reading every pixel of
    // every frame is affordable here and picking a palette off a sample is how
    // a rare but bright thing - a killfeed, a muzzle flash - loses its colour.
    const counts = new Uint32Array(CELLS);
    for (const frame of frames) {
        const { data } = frame;
        for (let i = 0; i < data.length; i += 4) {
            counts[((data[i] >> 3) << (BITS * 2)) | ((data[i + 1] >> 3) << BITS) | (data[i + 2] >> 3)]++;
        }
    }

    const cells: Cell[] = [];
    for (let color = 0; color < CELLS; color++) if (counts[color]) cells.push({ color, count: counts[color] });

    const palette = paletteOf(medianCut(cells, Math.max(2, Math.min(MAX_COLORS, colors))));
    const nearest = new Nearest(palette);

    const used = palette.length / 3;
    const transparent = used;

    // The colour table is a power of two, and everything past the palette is
    // left black - the decoder only ever reads the indices actually written.
    let bits = 1;
    while (1 << bits < used + 1) bits++;

    const table = new Uint8Array((1 << bits) * 3);
    table.set(palette);

    const out = new Bytes();

    out.string("GIF89a");
    out.short(width);
    out.short(height);
    out.byte(0x80 | 0x70 | (bits - 1));
    out.byte(0);
    out.byte(0);
    out.bytes(table);

    // The only way to say "loop forever", and it is an Netscape extension
    // rather than part of the format proper.
    out.string("\x21\xFF\x0B" + "NETSCAPE2.0");
    out.byte(3);
    out.byte(1);
    out.short(0);
    out.byte(0);

    const minCodeSize = Math.max(2, bits);

    let previous: Uint8Array | null = null;

    for (const frame of frames) {
        const { data } = frame;
        const indices = new Uint8Array(pixels);

        for (let p = 0; p < pixels; p++) {
            const i = p * 4;
            indices[p] = nearest.of(data[i], data[i + 1], data[i + 2]);
        }

        const written = new Uint8Array(indices);
        if (previous) {
            for (let p = 0; p < pixels; p++) if (indices[p] === previous[p]) written[p] = transparent;
        }

        // Graphic control: hold for `delay`, leave the frame on screen so the
        // transparent pixels keep showing what was underneath.
        out.byte(0x21);
        out.byte(0xf9);
        out.byte(4);
        out.byte((1 << 2) | (previous ? 1 : 0));
        out.short(Math.max(2, Math.round(delay / 10)));
        out.byte(transparent);
        out.byte(0);

        out.byte(0x2c);
        out.short(0);
        out.short(0);
        out.short(width);
        out.short(height);
        out.byte(0);

        out.byte(minCodeSize);
        compress(written, minCodeSize, out);

        previous = indices;
    }

    out.byte(0x3b);

    return new Blob([out.take() as unknown as ArrayBuffer], { type: "image/gif" });
}
