/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - making a clip small enough to send
 *
 * A clip is recorded at whatever bitrate looks good, and Discord takes ten
 * megabytes. The usual answer is to trim until it fits, which throws away the
 * part of the moment that did not fit rather than the part nobody would miss.
 *
 * So the clip is re-encoded instead, at a bitrate worked out from the limit and
 * the length: the whole moment, softer. There is no ffmpeg here and none is
 * wanted - the machine already has a hardware encoder, MediaRecorder is how the
 * buffer reaches it, and the same path takes a clip back through it. The cost is
 * that it happens in real time, because a MediaRecorder timestamps what it is
 * given by the wall clock and playing the source faster would only produce a
 * clip that is faster.
 *
 * Resolution comes down only when the bitrate has been cut so far that leaving
 * the resolution alone would spend it all on macroblocks.
 */

import { Logger } from "@utils/Logger";

import { probeRange } from "./clips";

const logger = new Logger("Clipper");

/** Headroom against the limit, for container overhead and a bitrate that drifts. */
const MARGIN = .92;

/** What the audio is given, and the least the video is left with. */
const AUDIO_BITS = 96_000;
const MIN_VIDEO_BITS = 250_000;

/**
 * Bits per pixel per frame the encoder is assumed to want.
 *
 * Below this the picture goes to blocks and blur, so the resolution comes down
 * until the budget is back above it. It is deliberately pessimistic: coming out
 * softer than necessary is recoverable, coming out over the limit is not.
 */
const BITS_PER_PIXEL = .07;

/** Attempts to make: the first is calculated, the second is the same with less. */
const TRIES = 2;

export interface ShrinkRequest {
    /** Size to come in under, in bytes. */
    limit: number;
    fps?: number;
    onProgress?(step: string): void;
}

export interface ShrinkResult {
    blob: Blob;
    mimeType: string;
    width: number;
    height: number;
    bitrate: number;
    fits: boolean;
}

/** Containers to try, best first: an MP4 plays everywhere a WebM might not. */
const CONTAINERS = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
];

function container(): string {
    return CONTAINERS.find(type => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
}

/**
 * Re-encodes a clip until it fits, and returns the smallest attempt either way.
 *
 * The caller owns the URL, which must be same-origin - a blob URL from the clip
 * folder is, and that is the only thing this is ever handed.
 */
export async function shrinkVideo(url: string, { limit, fps = 30, onProgress }: ShrinkRequest): Promise<ShrinkResult> {
    const video = document.createElement("video");
    video.src = url;
    video.preload = "auto";

    await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("That clip could not be decoded"));
    });

    const range = await probeRange(video);
    const seconds = Math.max(1, range.end - range.start);

    const type = container();

    /*
     * One audio graph for every attempt.
     *
     * A media element can be the source of exactly one node for as long as it
     * exists - not one per context, one ever - so a second attempt that built
     * its own would come back silent. The element's sound leaves through this
     * node instead of the speakers, which is also what keeps the re-encode from
     * playing out loud.
     */
    const audio = new AudioContext();
    let sink: MediaStreamAudioDestinationNode | null = null;

    try {
        sink = audio.createMediaStreamDestination();
        audio.createMediaElementSource(video).connect(sink);
    } catch (e) {
        logger.warn("Re-encoding without sound", e);
        sink = null;
        video.muted = true;
    }

    let best: ShrinkResult | null = null;
    let squeeze = 1;

    // Held open across the attempts and closed whichever way this ends: an
    // AudioContext that leaks takes the video element and its decoder with it,
    // and a few failed sends are enough to notice.
    try {
        for (let attempt = 0; attempt < TRIES; attempt++) {
            const budget = (limit * 8 * MARGIN * squeeze) / seconds;
            const bitrate = Math.max(MIN_VIDEO_BITS, Math.round(budget - AUDIO_BITS));

            // How much picture that bitrate can carry, expressed as a fraction
            // of the clip's own width.
            const carried = bitrate / (video.videoWidth * video.videoHeight * fps * BITS_PER_PIXEL);
            const scale = Math.min(1, Math.max(.35, Math.sqrt(carried)));

            const width = even(video.videoWidth * scale);
            const height = even(video.videoHeight * scale);

            onProgress?.(attempt
                ? `Still too big - re-encoding at ${width}p wide`
                : `Re-encoding at ${Math.round(bitrate / 1000)} kbps (about ${Math.ceil(seconds)}s)`);

            const blob = await transcode(video, { width, height, fps, bitrate, type, seconds, sink, from: range.start });

            best = { blob, mimeType: type, width, height, bitrate, fits: blob.size <= limit };
            logger.info(`Re-encode came out at ${blob.size} bytes for a ${limit} byte limit`);

            if (best.fits) break;

            // Aim at what the last attempt actually achieved rather than at the
            // limit again: the encoder overshot, so ask for less than it
            // overshot by.
            squeeze *= Math.min(.8, (limit / blob.size) * MARGIN);
        }
    } finally {
        void audio.close();
        video.src = "";
    }

    return best!;
}

/** Encoder dimensions want to be even; odd ones are quietly rounded anyway. */
function even(value: number): number {
    return Math.max(2, Math.round(value / 2) * 2);
}

interface Pass {
    width: number;
    height: number;
    fps: number;
    bitrate: number;
    type: string;
    /** How long the clip runs, which is also how long this pass may take. */
    seconds: number;
    /** Where the clip's sound comes out, or null when it has none. */
    sink: MediaStreamAudioDestinationNode | null;
    from: number;
}

/**
 * Plays the clip once, through a canvas and back into a MediaRecorder.
 *
 * Everything is torn down through `finish`, once, whichever of the four ways
 * out happens first: the clip ending, the recorder stopping, the encoder
 * failing, or the whole thing running past its own length.
 */
async function transcode(video: HTMLVideoElement, { width, height, fps, bitrate, type, seconds, sink, from }: Pass): Promise<Blob> {
    await seek(video, from);

    return new Promise<Blob>((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return reject(new Error("No 2D canvas available"));

        const stream = canvas.captureStream(fps);
        if (sink) for (const track of sink.stream.getAudioTracks()) stream.addTrack(track);

        const recorder = new MediaRecorder(stream, {
            mimeType: type,
            videoBitsPerSecond: bitrate,
            audioBitsPerSecond: AUDIO_BITS
        });

        const parts: Blob[] = [];
        recorder.ondataavailable = e => { if (e.data.size) parts.push(e.data); };

        let frame = 0;
        let guard = 0;

        const finish = (error?: Error) => {
            cancelAnimationFrame(frame);
            clearTimeout(guard);

            video.onended = null;
            video.pause();
            for (const track of stream.getVideoTracks()) track.stop();

            if (error) reject(error);
            else resolve(new Blob(parts, { type }));
        };

        recorder.onstop = () => finish();
        recorder.onerror = e => finish((e as unknown as { error?: Error; }).error ?? new Error("The encoder gave up"));

        const stop = () => {
            if (recorder.state !== "inactive") recorder.stop();
            else finish();
        };

        const draw = () => {
            ctx.drawImage(video, 0, 0, width, height);
            if (!video.ended) frame = requestAnimationFrame(draw);
        };

        // A clip whose container lies about its length would otherwise never
        // reach `ended`, and the promise would sit there forever.
        guard = window.setTimeout(stop, (seconds + 5) * 1000);

        video.onended = stop;

        void video.play().then(() => {
            recorder.start(1000);
            draw();
        }).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
    });
}

/** Seeks and waits, giving up rather than hanging on a frame that never lands. */
function seek(video: HTMLVideoElement, at: number): Promise<void> {
    return new Promise<void>(resolve => {
        if (Math.abs(video.currentTime - at) < .05) return resolve();

        let done = false;

        const settle = () => {
            if (done) return;

            done = true;
            clearTimeout(timer);
            video.removeEventListener("seeked", settle);
            resolve();
        };

        const timer = setTimeout(settle, 2000);
        video.addEventListener("seeked", settle);
        video.currentTime = at;
    });
}
