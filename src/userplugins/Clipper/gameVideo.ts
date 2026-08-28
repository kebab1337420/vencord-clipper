/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - watching the picture
 *
 * The other half of reading a game without being told anything about it. Sound
 * says something happened; the picture says what kind of thing, and catches the
 * moments that make no noise at all.
 *
 * Four things are measured, and they were chosen because they mean roughly the
 * same in every game rather than because they are clever:
 *
 *   - how much the frame changed since the last one. A fight is the screen
 *     moving far more than it has been moving.
 *   - how red it is. Nearly every shooter washes the screen red when you are
 *     hit, and nothing else on a normal frame does that.
 *   - how much colour is left in it. Death screens, knocked-down screens and
 *     spectator fades pull the saturation out of the picture and leave the
 *     brightness roughly alone, which is a very unusual thing for a frame to do.
 *   - how dark it is. A cut to black is a death, a round end or a load.
 *
 * Everything is measured on a 64x36 copy of the frame, sampled six times a
 * second. That is 2304 pixels: enough for all four of those to be obvious, and
 * little enough that the cost is nothing next to the encoder already running on
 * the same picture. Nothing here reads text, and deliberately so - kill feeds
 * are the obvious idea and they are a font, a colour and a position per game,
 * broken by every update, for an answer the game itself will often just tell us
 * (./gameEvents).
 *
 * Like ./gameAudio this is all inference, and ./signals scores it as such.
 */

import { Logger } from "@utils/Logger";

import { signals } from "./signals";

const logger = new Logger("Clipper");

/** How often a frame is looked at. */
const TICK_MS = 166;

/** The size everything is measured at. */
const WIDTH = 64;
const HEIGHT = 36;

/** How fast each measure's own normal follows it, per frame. */
const RISE = 0.04;

/** Frames to watch before anything is believed. */
const SETTLE = 30;

/** Motion this far over its normal is a fight, and where that saturates. */
const ACTION_JUMP = 1.8;
const ACTION_TOP = 4;

/** A red wash: this much redder than normal, and red at all. */
const RED_JUMP = 0.05;
const RED_FLOOR = 0.04;

/** Colour falling to this share of normal, on a picture that had colour. */
const GREY_DROP = 0.5;
const GREY_FLOOR = 0.08;

/** Brightness falling to this share of normal is a cut to black. */
const DARK_DROP = 0.25;

/** Per-kind quiet, so one death screen is one event and not twenty. */
const EVENT_GAP_MS = 4000;

/** How long to leave it after failing to get hold of the picture. */
const ATTACH_RETRY_MS = 3000;

interface GameVideoHooks {
    /** The video being captured, or null when nothing is being captured. */
    track(): MediaStreamTrack | null;
}

interface Frame {
    luma: number;
    motion: number;
    colour: number;
    red: number;
}

class GameVideoWatcher {
    private timer: ReturnType<typeof setInterval> | null = null;
    private hooks: GameVideoHooks | null = null;

    private video: HTMLVideoElement | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private track: MediaStreamTrack | null = null;
    private starting = false;

    /** When another attempt at attaching is allowed, after one failed. */
    private attachAfter = 0;

    /** The previous frame's luma, to difference against. */
    private previous: Float32Array | null = null;

    private avg = { luma: 0, motion: 0, colour: 0, red: 0 };
    private seen = 0;
    private lastEvent = new Map<string, number>();

    get active(): boolean {
        return this.timer !== null;
    }

    start(hooks: GameVideoHooks): void {
        this.stop();

        this.hooks = hooks;
        this.avg = { luma: 0, motion: 0, colour: 0, red: 0 };
        this.seen = 0;
        this.previous = null;
        this.attachAfter = 0;
        this.lastEvent.clear();

        this.timer = setInterval(() => this.tick(), TICK_MS);
        signals.claim("video");
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;

        this.hooks = null;
        this.drop();
        signals.release("video");
    }

    /** Lets go of the video element, leaving the track itself alone. */
    private drop(): void {
        try {
            this.video?.pause();
        } catch {
            // Already gone.
        }

        if (this.video) this.video.srcObject = null;

        this.video = null;
        this.canvas = null;
        this.ctx = null;
        this.track = null;
        this.previous = null;
        this.seen = 0;
    }

    /**
     * Points a video element at the capture.
     *
     * The same track the encoder is on, which costs one more decode of frames
     * already being decoded rather than a second capture of the screen.
     */
    private async attach(track: MediaStreamTrack): Promise<void> {
        if (this.starting) return;
        this.starting = true;

        try {
            const video = document.createElement("video");
            video.srcObject = new MediaStream([track]);
            video.muted = true;
            video.playsInline = true;

            await video.play();

            // Stopped while it was starting.
            if (!this.timer) {
                video.srcObject = null;
                return;
            }

            const canvas = document.createElement("canvas");
            canvas.width = WIDTH;
            canvas.height = HEIGHT;

            const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
            if (!ctx) {
                video.srcObject = null;
                logger.warn("This client would not give a canvas to read the capture with");
                return;
            }

            this.video = video;
            this.canvas = canvas;
            this.ctx = ctx;
            this.track = track;
        } catch (e) {
            logger.warn("Could not watch the captured picture", e);
        } finally {
            this.starting = false;
        }
    }

    /** Measures one frame, or null when there is nothing drawable yet. */
    private measure(): Frame | null {
        const { video, canvas, ctx } = this;
        if (!video || !canvas || !ctx) return null;
        if (!video.videoWidth || !video.videoHeight) return null;

        ctx.drawImage(video, 0, 0, WIDTH, HEIGHT);

        let pixels: Uint8ClampedArray;
        try {
            pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
        } catch (e) {
            // A tainted canvas: nothing here can work, so stop trying.
            logger.warn("The captured picture cannot be read back", e);
            this.stop();
            return null;
        }

        const count = WIDTH * HEIGHT;
        const had = this.previous !== null;
        const luma = this.previous ?? new Float32Array(count);

        let sumLuma = 0;
        let sumColour = 0;
        let sumRed = 0;
        let motion = 0;

        for (let i = 0; i < count; i++) {
            const r = pixels[i * 4] / 255;
            const g = pixels[i * 4 + 1] / 255;
            const b = pixels[i * 4 + 2] / 255;

            const y = 0.299 * r + 0.587 * g + 0.114 * b;
            const top = Math.max(r, g, b);
            const bottom = Math.min(r, g, b);

            sumLuma += y;
            sumColour += top > 0.02 ? (top - bottom) / top : 0;
            sumRed += Math.max(0, r - (g + b) / 2);

            if (had) motion += Math.abs(y - luma[i]);
            luma[i] = y;
        }

        this.previous = luma;

        return {
            luma: sumLuma / count,
            motion: had ? motion / count : 0,
            colour: sumColour / count,
            red: sumRed / count
        };
    }

    /** Fires an event unless the same one just fired. */
    private once(kind: string, note: string): void {
        const now = Date.now();
        if (now - (this.lastEvent.get(kind) ?? 0) < EVENT_GAP_MS) return;

        this.lastEvent.set(kind, now);
        signals.fire(kind, note);
    }

    private tick(): void {
        const wanted = this.hooks?.track() ?? null;

        // The capture stopped, or was rebuilt onto another track - which happens
        // whenever the encoder falls back to drawing through a canvas.
        if (!wanted || wanted.readyState !== "live") {
            if (this.video) this.drop();
            signals.report("action", 0, "");
            return;
        }

        if (wanted !== this.track) {
            const now = Date.now();
            if (now < this.attachAfter) return;

            // A client that will not play the capture into a video element will
            // not do it in a sixth of a second either, and retrying at the tick
            // rate would fill the console with the same warning.
            this.attachAfter = now + ATTACH_RETRY_MS;

            this.drop();
            void this.attach(wanted);
            return;
        }

        const frame = this.measure();
        if (!frame) return;

        const { avg } = this;
        const settled = this.seen++ > SETTLE;

        if (settled) {
            // Motion, as a share of how much this picture normally moves. A
            // menu sits near zero and a fight is several times its own normal,
            // so the ratio travels across games where the raw number does not.
            const ratio = frame.motion / Math.max(0.002, avg.motion);
            const over = (ratio - ACTION_JUMP) / (ACTION_TOP - ACTION_JUMP);

            signals.report("action", Math.min(1, Math.max(0, over)), "a lot happening on screen");

            if (frame.red > RED_FLOOR && frame.red > avg.red + RED_JUMP) {
                this.once("damage", "the screen went red");
            }

            // Colour gone while the brightness stayed: a death or knocked-down
            // screen. A cut to black takes the colour with it, and is its own
            // event, so it is excluded here rather than reported as both.
            if (avg.colour > GREY_FLOOR && frame.colour < avg.colour * GREY_DROP && frame.luma > avg.luma * DARK_DROP) {
                this.once("greyout", "the screen went grey");
            }

            if (avg.luma > 0.12 && frame.luma < avg.luma * DARK_DROP) {
                this.once("blackout", "the screen went dark");
            }
        }

        avg.luma += (frame.luma - avg.luma) * RISE;
        avg.motion += (frame.motion - avg.motion) * RISE;
        avg.colour += (frame.colour - avg.colour) * RISE;
        avg.red += (frame.red - avg.red) * RISE;
    }
}

export const gameVideo = new GameVideoWatcher();
