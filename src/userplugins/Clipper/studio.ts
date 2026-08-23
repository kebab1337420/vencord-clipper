/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - studio render engine
 *
 * A very small video editor. A project is a list of segments played one after
 * the other, each one a range of some video file with its own speed, volume and
 * effects, plus captions laid over the result.
 *
 * There is no encoder in the plugin, so rendering works the way trimming does:
 * everything is painted into one canvas and mixed into one WebAudio graph, and a
 * single MediaRecorder records both for the whole run. That keeps one continuous
 * video track across the timeline - starting a recorder per segment would
 * produce files that cannot be concatenated - at the price of running in real
 * time, which is why the caller gets progress.
 *
 * Because the frames come from playback, an MP4 dropped on the timeline plays
 * through the same path as a clip: whatever Chromium can decode can be edited
 * here, and the render always comes back out in the configured container.
 */

import { logger } from "./recorder";
import { mimeCandidates, settings } from "./settings";

export interface Effects {
    /** Percentages, 100 being untouched. */
    brightness: number;
    contrast: number;
    saturate: number;
    /** 0..100, how much colour is drained. */
    grayscale: number;
    /** Blur radius in pixels. */
    blur: number;
    /** 1 fills the frame, 1.5 crops a third off each edge. */
    zoom: number;
    /** Seconds of fade at the start and end of the segment. */
    fadeIn: number;
    fadeOut: number;
    /** Mirrors the image, for footage recorded from a front camera. */
    flip: boolean;
}

export const DEFAULT_EFFECTS: Effects = {
    brightness: 100,
    contrast: 100,
    saturate: 100,
    grayscale: 0,
    blur: 0,
    zoom: 1,
    fadeIn: 0,
    fadeOut: 0,
    flip: false
};

/**
 * Where a source came from, so a saved project can be opened again.
 *
 * Object URLs die with the page, so a restored timeline has to fetch the bytes
 * a second time: from the clip folder by name, or from disk by absolute path.
 */
export type SourceOrigin =
    | { kind: "clip"; name: string; }
    | { kind: "file"; path: string; };

/** A file on the timeline. Several segments may share one. */
export interface StudioSource {
    id: string;
    /** Shown in the UI; the clip's file name, or the imported file's. */
    name: string;
    /** Object URL. The owner revokes it, not the renderer. */
    url: string;
    origin?: SourceOrigin;
}

export interface Segment {
    id: string;
    sourceId: string;
    /** Range inside the source, in seconds. */
    from: number;
    to: number;
    /** Playback rate, which is also how much shorter the segment renders. */
    speed: number;
    /** 0..1, 0 being a muted segment. */
    volume: number;
    effects: Effects;
}

export interface Caption {
    id: string;
    /** Project time, in seconds, not source time. */
    from: number;
    to: number;
    text: string;
}

export interface CaptionStyle {
    /** Height of the text as a fraction of the frame height. */
    size: number;
    color: string;
    /** Outline colour; the box behind the text when `background` is on. */
    outline: string;
    background: boolean;
    /** Vertical anchor, 0 at the top, 1 at the bottom. */
    position: number;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
    size: 0.06,
    color: "#ffffff",
    outline: "#000000",
    background: false,
    position: 0.88
};

export interface Project {
    segments: Segment[];
    captions: Caption[];
    captionStyle: CaptionStyle;
    /** Output height; the width follows the 16:9 frame. */
    height: number;
    fps: number;
    /** Keep the mixed audio in the render. */
    audio: boolean;
}

export interface RenderOptions {
    onProgress?(ratio: number): void;
    cancelled?(): boolean;
}

function rate(speed: number): number {
    return Math.min(4, Math.max(0.25, speed || 1));
}

/** Rendered length of one segment, its speed included. */
export function segmentLength(segment: Segment): number {
    return Math.max(0, segment.to - segment.from) / rate(segment.speed);
}

export function projectLength(project: Project): number {
    return project.segments.reduce((total, s) => total + segmentLength(s), 0);
}

/** Project time at which a segment starts, for the caption editor. */
export function segmentStart(project: Project, index: number): number {
    return project.segments.slice(0, index).reduce((total, s) => total + segmentLength(s), 0);
}

export function newId(): string {
    return Math.random().toString(36).slice(2, 10);
}

function filterFor(effects: Effects): string {
    const parts: string[] = [];

    if (effects.brightness !== 100) parts.push(`brightness(${effects.brightness}%)`);
    if (effects.contrast !== 100) parts.push(`contrast(${effects.contrast}%)`);
    if (effects.saturate !== 100) parts.push(`saturate(${effects.saturate}%)`);
    if (effects.grayscale > 0) parts.push(`grayscale(${effects.grayscale}%)`);
    if (effects.blur > 0) parts.push(`blur(${effects.blur}px)`);

    return parts.join(" ") || "none";
}

/**
 * Where a frame lands inside the output.
 *
 * The timeline mixes sources of different shapes - a 16:9 clip next to a phone
 * recording - so each one is fitted inside the frame rather than stretched, and
 * the zoom crops into the source instead of scaling the drawing, which keeps the
 * letterboxing untouched.
 */
function fitted(video: HTMLVideoElement, width: number, height: number, zoom: number) {
    const vw = video.videoWidth || width;
    const vh = video.videoHeight || height;

    const crop = Math.max(1, zoom);
    const sw = vw / crop;
    const sh = vh / crop;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;

    const scale = Math.min(width / sw, height / sh);
    const dw = sw * scale;
    const dh = sh * scale;

    return { sx, sy, sw, sh, dx: (width - dw) / 2, dy: (height - dh) / 2, dw, dh };
}

/** Splits a caption on its own newlines, then on width. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
    const lines: string[] = [];

    for (const paragraph of text.split("\n")) {
        let line = "";

        for (const word of paragraph.split(/\s+/)) {
            if (!word) continue;

            const next = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(next).width > max) {
                lines.push(line);
                line = word;
            } else {
                line = next;
            }
        }

        lines.push(line);
    }

    return lines.length > 1 ? lines.filter(Boolean) : lines;
}

/**
 * Draws one caption and answers how tall it came out.
 *
 * The height is what lets several captions overlapping in time stack instead of
 * printing on top of each other: the caller feeds the running total back in as
 * `offset`, pushing each new block above the previous one.
 */
function drawCaption(ctx: CanvasRenderingContext2D, text: string, style: CaptionStyle, width: number, height: number, offset = 0): number {
    const size = Math.max(12, Math.round(height * style.size));

    ctx.save();
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.font = `600 ${size}px "gg sans", "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const lines = wrap(ctx, text, width * 0.9);
    const step = size * 1.2;
    const block = step * (lines.length - 1) + size * 1.35;
    const bottom = height * style.position - offset;
    const top = bottom - step * (lines.length - 1);

    if (style.background) {
        const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
        const pad = size * 0.35;

        ctx.fillStyle = style.outline;
        ctx.globalAlpha = 0.6;
        ctx.fillRect((width - widest) / 2 - pad, top - size - pad * 0.6, widest + pad * 2, step * (lines.length - 1) + size + pad * 1.4);
        ctx.globalAlpha = 1;
    } else {
        // An outline is what keeps text readable over bright footage.
        ctx.lineWidth = Math.max(2, size * 0.14);
        ctx.strokeStyle = style.outline;
        ctx.lineJoin = "round";
        lines.forEach((line, i) => ctx.strokeText(line, width / 2, top + step * i));
    }

    ctx.fillStyle = style.color;
    lines.forEach((line, i) => ctx.fillText(line, width / 2, top + step * i));
    ctx.restore();

    return block;
}

function waitFor(video: HTMLVideoElement, event: string, timeout = 8000): Promise<void> {
    return new Promise(resolve => {
        let done = false;
        const settle = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            video.removeEventListener(event, settle);
            resolve();
        };

        const timer = setTimeout(settle, timeout);
        video.addEventListener(event, settle);
    });
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
    const target = Math.max(0, time);
    if (Math.abs(video.currentTime - target) < 0.02) return;

    const seeked = waitFor(video, "seeked", 5000);
    video.currentTime = target;
    await seeked;
}

interface Loaded {
    video: HTMLVideoElement;
    gain: GainNode;
}

/**
 * One element and one audio node per source.
 *
 * `createMediaElementSource` may be called once per element for the lifetime of
 * a context, so both are built here and shared by every segment cutting into the
 * same file.
 */
async function loadSources(project: Project, sources: StudioSource[], ctx: AudioContext, dest: MediaStreamAudioDestinationNode): Promise<Map<string, Loaded>> {
    const needed = new Set(project.segments.map(s => s.sourceId));
    const loaded = new Map<string, Loaded>();

    for (const source of sources) {
        if (!needed.has(source.id)) continue;

        const video = document.createElement("video");
        video.src = source.url;
        video.preload = "auto";
        video.playsInline = true;
        // Muting here would silence the graph too; the element's output already
        // goes to the mix rather than the speakers once it is wired up.
        video.volume = 1;

        const ready = waitFor(video, "loadeddata");
        video.load();
        await ready;

        const gain = ctx.createGain();
        gain.gain.value = 0;

        try {
            ctx.createMediaElementSource(video).connect(gain);
            gain.connect(dest);
        } catch (e) {
            logger.warn("Could not route the audio of a timeline source", e);
        }

        loaded.set(source.id, { video, gain });
    }

    return loaded;
}

/**
 * Renders the whole project into a single file.
 *
 * Segments are played in order into a canvas that never stops being captured, so
 * the output is one continuous take. The canvas is painted black while the next
 * segment seeks, which is what hides the seek: a paused element keeps showing
 * its last frame, and that frame belongs to the segment that just ended.
 */
export async function renderProject(project: Project, sources: StudioSource[], options: RenderOptions = {}): Promise<Blob> {
    const total = projectLength(project);
    if (!project.segments.length || total <= 0) throw new Error("The timeline is empty");

    const height = Math.max(2, Math.round((project.height || 720) / 2) * 2);
    const width = Math.round((height * 16 / 9) / 2) * 2;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("This client cannot render the timeline");

    // Checked before anything is opened: there is nothing to clean up yet.
    const mimeType = renderMimeType();
    if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error("No supported encoder for the configured container");

    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();

    let loaded: Map<string, Loaded>;
    try {
        loaded = await loadSources(project, sources, audioCtx, dest);
        if (!loaded.size) throw new Error("None of the timeline sources could be loaded");
    } catch (e) {
        // An audio context holds a hardware handle and Chromium caps how many a
        // page may open, so a failed setup must not leave one behind: a few
        // failed renders would otherwise make every later one impossible.
        audioCtx.close().catch(() => void 0);
        throw e;
    }

    const stream = new MediaStream([
        ...canvas.captureStream(project.fps || 30).getVideoTracks(),
        ...(project.audio ? dest.stream.getAudioTracks() : [])
    ]);

    const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: settings.store.videoBitrate * 1_000_000,
        audioBitsPerSecond: settings.store.audioBitrate * 1000
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = e => void (e.data.size && chunks.push(e.data));

    /*
     * An encoder that gives up is otherwise invisible: playback keeps running to
     * the end of the timeline and the caller gets a truncated file with no
     * explanation. Held in an object because the value is written from a
     * callback, which the compiler cannot see.
     */
    const failure: { error: Error | null; } = { error: null };
    recorder.onerror = (event: Event) => {
        const raised = (event as unknown as { error?: unknown; }).error;

        failure.error = raised instanceof Error ? raised : new Error("The encoder failed during the render");
        logger.error("The render recorder failed", event);
    };

    const stopped = new Promise<void>(resolve => {
        recorder.onstop = () => resolve();
    });

    // Painted by the loop below, swapped by the segment driver. The filter comes
    // along because it only changes with the segment, not with the frame.
    let current: { video: HTMLVideoElement; segment: Segment; filter: string; } | null = null;
    let elapsed = 0;
    let frame = 0;
    let started = false;

    const draw = () => {
        ctx.filter = "none";
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);

        if (current) {
            const { video, segment, filter } = current;
            const { effects } = segment;

            const played = Math.max(0, video.currentTime - segment.from);
            const left = Math.max(0, segment.to - video.currentTime);

            let alpha = 1;
            if (effects.fadeIn > 0) alpha = Math.min(alpha, played / effects.fadeIn);
            if (effects.fadeOut > 0) alpha = Math.min(alpha, left / effects.fadeOut);

            ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
            ctx.filter = filter;

            const box = fitted(video, width, height, effects.zoom);

            if (effects.flip) {
                ctx.save();
                ctx.translate(width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(video, box.sx, box.sy, box.sw, box.sh, width - box.dx - box.dw, box.dy, box.dw, box.dh);
                ctx.restore();
            } else {
                ctx.drawImage(video, box.sx, box.sy, box.sw, box.sh, box.dx, box.dy, box.dw, box.dh);
            }

            // Captions overlapping in time stack upwards instead of printing on
            // top of each other.
            const now = elapsed + played / rate(segment.speed);
            let stack = 0;

            for (const caption of project.captions) {
                if (now < caption.from || now > caption.to || !caption.text.trim()) continue;

                stack += drawCaption(ctx, caption.text, project.captionStyle, width, height, stack);
            }
        }
    };

    /*
     * The capture stream only takes one frame per output frame, so painting on
     * every refresh of a 144 Hz screen would burn several times the work on
     * frames nobody encodes. One millisecond of slack keeps a frame from being
     * skipped when a refresh lands a hair early.
     */
    const frameGap = 1000 / Math.max(1, project.fps || 30) - 1;
    let painted = 0;

    const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        if (now - painted < frameGap) return;

        painted = now;
        draw();
    };

    frame = requestAnimationFrame(loop);

    try {
        for (const segment of project.segments) {
            if (options.cancelled?.()) throw new Error("Render cancelled");

            const entry = loaded.get(segment.sourceId);
            const length = segmentLength(segment);
            if (!entry || length <= 0) continue;

            const { video, gain } = entry;

            current = null;
            await seekTo(video, segment.from);

            video.playbackRate = rate(segment.speed);
            gain.gain.value = project.audio ? Math.min(1, Math.max(0, segment.volume)) : 0;
            current = { video, segment, filter: filterFor(segment.effects) };

            /*
             * Recording starts on the first real frame, not before the first
             * seek: loading and seeking a large source takes long enough that a
             * recorder started earlier would encode a black opening every time.
             */
            if (!started) {
                started = true;
                draw();
                recorder.start(1000);
            }

            await video.play();

            await new Promise<void>((resolve, reject) => {
                const tick = () => {
                    if (options.cancelled?.()) {
                        cleanup();
                        reject(new Error("Render cancelled"));
                        return;
                    }

                    if (failure.error) {
                        cleanup();
                        reject(failure.error);
                        return;
                    }

                    const played = Math.max(0, video.currentTime - segment.from);
                    options.onProgress?.(Math.min(1, (elapsed + played / rate(segment.speed)) / total));

                    if (video.currentTime >= segment.to || video.ended) {
                        cleanup();
                        resolve();
                        return;
                    }

                    tickFrame = requestAnimationFrame(tick);
                };

                const onError = () => {
                    cleanup();
                    reject(new Error("Playback failed on a timeline source"));
                };

                const cleanup = () => {
                    cancelAnimationFrame(tickFrame);
                    video.removeEventListener("error", onError);
                };

                video.addEventListener("error", onError);
                let tickFrame = requestAnimationFrame(tick);
            });

            video.pause();
            gain.gain.value = 0;
            elapsed += length;
        }
    } finally {
        current = null;
        cancelAnimationFrame(frame);

        for (const { video, gain } of loaded.values()) {
            video.pause();
            gain.gain.value = 0;
        }

        if (started) {
            try {
                if (recorder.state !== "inactive") recorder.stop();
            } catch (e) {
                logger.warn("Could not stop the render recorder", e);
            }

            // Only worth waiting on a recorder that was actually started: `onstop`
            // never fires on one that never ran, and the wait would never end.
            await stopped.catch(() => void 0);
        }

        audioCtx.close().catch(() => void 0);

        // Frees the decoders now rather than whenever the elements are collected.
        for (const { video } of loaded.values()) {
            video.removeAttribute("src");
            video.load();
        }
    }

    if (failure.error) throw failure.error;

    const blob = new Blob(chunks, { type: mimeType });
    if (!blob.size) throw new Error("The render produced an empty file");

    return blob;
}

/**
 * Rough size of the render, in bytes.
 *
 * The encoder is told a bitrate and roughly holds it, so length times bitrate is
 * close enough to warn about a montage that will not fit anywhere.
 */
export function estimatedSize(project: Project): number {
    const video = settings.store.videoBitrate * 1_000_000;
    const audio = project.audio ? settings.store.audioBitrate * 1000 : 0;

    return Math.round(projectLength(project) * (video + audio) / 8);
}

/** Mime type the render will produce, for naming the file before it exists. */
export function renderMimeType(): string {
    return mimeCandidates(settings.store.container).find(t => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
}
