/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - turning a piece of a clip into a GIF that will actually send
 *
 * Two jobs. Getting frames out of a clip, which is a matter of seeking a hidden
 * video and drawing each stop onto a canvas; and getting the result under
 * Discord's attachment limit, which is a matter of giving something up.
 *
 * The order things are given up in is the whole design. Resolution goes last,
 * because a GIF that is too small to read is worth nothing. Frame rate goes
 * first: a clip at 10 fps still reads as motion, and halving the frames halves
 * the file almost exactly. Colours go second, because the frame differencing in
 * the encoder means a smaller palette also makes more pixels count as unchanged,
 * so it pays twice.
 *
 * Every step is measured rather than estimated - the encoder is cheap enough to
 * run again, and the alternative is a guess that comes back over the limit after
 * the user has already waited.
 */

import { Logger } from "@utils/Logger";

import { loadClipUrl, probeRange, writeClipCopy } from "./clips";
import { encodeGif } from "./gif";
import { seekVideo as seek } from "./utils";

const logger = new Logger("Clipper");

/** Frames grabbed per second, and the widest a GIF is made before shrinking. */
const DEFAULT_FPS = 12;
const DEFAULT_WIDTH = 480;

/** Longest piece worth making a GIF of, whatever was asked for. */
const MAX_SECONDS = 15;

export interface GifRequest {
    /** Seconds into the clip, or the beginning. */
    from?: number;
    /** Seconds into the clip, or as far as `MAX_SECONDS` allows. */
    to?: number;
    fps?: number;
    width?: number;
    /** Size to come in under, in bytes. Ignored when it cannot be met. */
    limit?: number;
    /** Called with a line describing what is happening, for a busy UI. */
    onProgress?(step: string): void;
}

interface GifResult {
    blob: Blob;
    width: number;
    fps: number;
    colors: number;
    /** Whether it came in under the limit that was asked for. */
    fits: boolean;
}

/**
 * Each rung of the ladder, roughest last.
 *
 * `every` drops frames, `colors` shrinks the palette, `scale` is applied to the
 * grabbed frames and only enters at the bottom.
 */
const LADDER: Array<{ every: number; colors: number; scale: number; }> = [
    { every: 1, colors: 128, scale: 1 },
    { every: 2, colors: 96, scale: 1 },
    { every: 2, colors: 48, scale: 1 },
    { every: 3, colors: 48, scale: .75 },
    { every: 3, colors: 32, scale: .55 }
];

/** Loads a clip, takes the asked-for piece of it, and returns a GIF of it. */
export async function clipToGif(name: string, request: GifRequest = {}): Promise<GifResult> {
    const url = await loadClipUrl(name);

    try {
        return await urlToGif(url, request);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** The same, on a blob URL the caller owns. */
async function urlToGif(url: string, request: GifRequest = {}): Promise<GifResult> {
    const { limit = 0, onProgress } = request;

    onProgress?.("Reading the clip");

    const frames = await grabFrames(url, request);
    if (!frames.length) throw new Error("Nothing could be read out of that clip");

    const fps = request.fps || DEFAULT_FPS;

    let last: GifResult | null = null;

    for (const rung of LADDER) {
        onProgress?.(last ? "Too big - trying again smaller" : "Encoding");

        const picked = rung.every === 1 ? frames : frames.filter((_, i) => i % rung.every === 0);
        const scaled = rung.scale === 1 ? picked : rescale(picked, rung.scale);
        const rate = fps / rung.every;

        const blob = encodeGif(scaled, { delay: 1000 / rate, colors: rung.colors });

        last = {
            blob,
            width: scaled[0].width,
            fps: rate,
            colors: rung.colors,
            fits: !limit || blob.size <= limit
        };

        if (last.fits) break;

        logger.info(`GIF at ${last.width}px / ${rate}fps / ${rung.colors} colours came out at ${blob.size} bytes`);
    }

    return last!;
}

/** Writes a GIF next to the clips and returns the file name it landed on. */
export async function saveGif(clipName: string, blob: Blob): Promise<string> {
    const stem = clipName.replace(/\.(webm|mp4)$/i, "");
    const path = await writeClipCopy(blob, `${stem}.gif`);

    return path.split(/[\\/]/).pop() || `${stem}.gif`;
}

/**
 * Pulls frames out of a clip by seeking to each one in turn.
 *
 * Seeking rather than playing: a played video hands over whatever frames the
 * compositor felt like producing, which on a busy machine is not the frames
 * that were asked for and never at even spacing. Seeking is slower and exact,
 * and exact is what keeps a GIF from stuttering.
 */
async function grabFrames(url: string, { from, to, fps = DEFAULT_FPS, width = DEFAULT_WIDTH, onProgress }: GifRequest): Promise<ImageData[]> {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.preload = "auto";

    await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("That clip could not be decoded"));
    });

    // A live-recorded container has no duration in its header, and a rolling
    // buffer's first cluster rarely starts at zero.
    const range = await probeRange(video);

    /*
     * Backwards from the end when nothing was asked for.
     *
     * A clip ends at the moment the key was pressed, which is the moment worth
     * looping; the first fifteen seconds of a thirty second clip are the run-up
     * to it.
     */
    const stop = Math.min(range.end, to ?? range.end);
    const start = Math.max(range.start, from ?? stop - MAX_SECONDS);
    const end = Math.min(stop, start + MAX_SECONDS);

    const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = height;

    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error("No 2D canvas available");

    const step = 1 / fps;
    const total = Math.max(1, Math.floor((end - start) / step));
    const frames: ImageData[] = [];

    // Released whichever way this ends: a clip that fails to decode halfway
    // through otherwise leaves its decoder holding the whole file.
    try {
        for (let i = 0; i < total; i++) {
            const at = start + i * step;

            await seek(video, at);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));

            if (i % 10 === 0) onProgress?.(`Reading the clip (${i + 1}/${total})`);
        }
    } finally {
        video.src = "";
    }

    return frames;
}

/** Redraws every frame smaller, through a canvas, since ImageData cannot scale. */
function rescale(frames: ImageData[], scale: number): ImageData[] {
    const width = Math.max(1, Math.round(frames[0].width * scale));
    const height = Math.max(1, Math.round(frames[0].height * scale));

    const source = document.createElement("canvas");
    source.width = frames[0].width;
    source.height = frames[0].height;

    const target = document.createElement("canvas");
    target.width = width;
    target.height = height;

    const from = source.getContext("2d", { alpha: false });
    const into = target.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!from || !into) return frames;

    into.imageSmoothingQuality = "high";

    return frames.map(frame => {
        from.putImageData(frame, 0, 0);
        into.drawImage(source, 0, 0, width, height);

        return into.getImageData(0, 0, width, height);
    });
}
