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

import { type AudioClip, type AudioSource, type Ending, scheduleClips } from "./audio";
import { logger } from "./recorder";
import { pickMimeType, settings } from "./settings";
import { speakingAt, voiceDuckAt, type VoiceFileMeta, type VoiceLevels, voiceLevelsTouched, type VoiceTrack } from "./voice";
import { createVoiceBand, type VoiceBand } from "./voiceBand";
import { type VoiceMix, voiceMixFor } from "./voiceMix";

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
    /**
     * Frame size of the file, when it has been probed.
     *
     * Only used to decide whether a render would resize anything: a timeline
     * that outputs the source's own size and changes nothing else can be cut
     * out of the container instead of being decoded and encoded again.
     */
    width?: number;
    height?: number;
    /**
     * Who was talking in this file, as it was recorded.
     *
     * Carried on the source rather than on the project because it describes the
     * file: two segments cut out of the same clip read the same tracks, and a
     * second clip dropped on the timeline brings its own.
     */
    voices?: VoiceTrack[];
    /** The per-person recordings saved beside this file, where it has any. */
    tracks?: VoiceFileMeta[];
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
    /**
     * Whether a speed change leaves the pitch alone.
     *
     * Chromium corrects the pitch by default, which keeps a voice sounding like
     * itself at 2x. Turning it off gives the chipmunk, which is the point of the
     * effect half the time. Undefined means the default, so projects saved
     * before this existed keep sounding the way they did.
     */
    pitch?: boolean;
    effects: Effects;
}

/**
 * A picture available to the montage, decoded once.
 *
 * Held outside the project for the same reason the sounds are: the project is
 * written to local storage on every keystroke, and a decoded bitmap neither
 * survives `JSON.stringify` nor belongs anywhere near it.
 */
export interface ImageSource {
    id: string;
    name: string;
    /** Object URL. The owner revokes it, not the renderer. */
    url: string;
    /** Absolute path, when it came off disk, so a saved project reopens it. */
    path?: string;
    width: number;
    height: number;
    /** What the painter draws. A video element is a valid draw source too. */
    image: HTMLImageElement | HTMLVideoElement;
    /**
     * The same element again when the source moves, so the painter can drive it.
     *
     * Kept as its own field rather than found by testing the tag: playback is
     * driven every frame, and a type guard per overlay per frame is noise in
     * the one loop that has to stay cheap.
     */
    video?: HTMLVideoElement;
    /**
     * The overlay's own soundtrack, decoded, when it has one.
     *
     * Decoded rather than routed off the element: an element can only ever have
     * one MediaElementAudioSourceNode and it stays tied to the context that
     * made it, so routing it into a render - which builds and closes a context
     * of its own each time - would leave the preview silent for good after the
     * first export. A buffer belongs to nobody and can be scheduled twice.
     */
    audio?: AudioBuffer;
}

/**
 * A picture placed on the montage.
 *
 * Everything positional is a fraction of the frame rather than a pixel count:
 * the same project renders at 720p and at 1080p, and an overlay pinned to a
 * pixel would move between the two. The height follows the picture's own
 * aspect ratio, so there is one size handle instead of two and an overlay
 * cannot be squashed by accident.
 */
export interface Overlay {
    id: string;
    sourceId: string;
    /** Project time, in seconds. */
    from: number;
    to: number;
    /** Centre of the picture, 0..1 across and down the frame. */
    x: number;
    y: number;
    /** Width as a fraction of the frame width. */
    scale: number;
    opacity: number;
    /** Degrees, clockwise. */
    rotation: number;
    /** Seconds of fade at each end of the placement. */
    fadeIn: number;
    fadeOut: number;
    /**
     * Level of the overlay's own sound, 1 being the file untouched.
     *
     * Ignored by a still picture, and by a clip that carries no audio track.
     */
    volume: number;
}

export const DEFAULT_OVERLAY: Omit<Overlay, "id" | "sourceId" | "from" | "to"> = {
    x: 0.5,
    y: 0.5,
    scale: 0.3,
    opacity: 1,
    rotation: 0,
    fadeIn: 0,
    fadeOut: 0,
    volume: 1
};

/** How long a picture stays on screen when it is dropped on the timeline. */
export const OVERLAY_SECONDS = 3;

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
    /**
     * Sounds laid over the montage: music, a sting, a voice-over.
     *
     * They live in project time rather than inside a segment, so one track can
     * run across a cut. Optional, because a project saved before they existed
     * has none and must still open.
     */
    audioClips?: AudioClip[];
    /**
     * Pictures laid over the montage.
     *
     * In project time like the sounds and the captions, so one can span a cut.
     * Optional, because a project saved before they existed has none and must
     * still open.
     */
    overlays?: Overlay[];
    captions: Caption[];
    captionStyle: CaptionStyle;
    /** Output height; the width follows the 16:9 frame unless one is set. */
    height: number;
    /** Output width, for a source that is not 16:9. */
    width?: number;
    fps: number;
    /** Keep the mixed audio in the render. */
    audio: boolean;
    /**
     * Per-person levels, by user id, applied to the footage's own sound.
     *
     * See `voiceDuckAt`: the call is one mixed signal by the time it reaches
     * this client, so a person turned down here ducks the mix wherever they are
     * the one talking. Absent means nobody was touched and nothing is applied.
     */
    voiceLevels?: VoiceLevels;
    /** Draw the avatar of whoever is talking in the corner of the frame. */
    showSpeakers?: boolean;
}

export interface RenderOptions {
    onProgress?(ratio: number): void;
    cancelled?(): boolean;
    /**
     * The decoded sounds the timeline refers to.
     *
     * Decoding happens where the files are dropped rather than here: the editor
     * needs the samples anyway to draw a waveform, and decoding a music bed a
     * second time at render would cost seconds of silence before the first
     * frame.
     */
    sounds?: AudioSource[];
    /** The decoded pictures the overlays refer to, for the same reason. */
    images?: ImageSource[];
    /**
     * Container to encode into, when it must not follow the settings.
     *
     * Converting an old WebM clip to MP4 is the case that needs it: the point of
     * the operation is the container, so it cannot be read from a setting the
     * user may have left on WebM.
     */
    mimeType?: string;
}

function rate(speed: number): number {
    return Math.min(4, Math.max(0.25, speed || 1));
}

/** Rendered length of one segment, its speed included. */
export function segmentLength(segment: Segment): number {
    return Math.max(0, segment.to - segment.from) / rate(segment.speed);
}

/**
 * Where the montage finishes, and how it gets there.
 *
 * The sounds need both: a bed must not outlive the last frame, and when the
 * montage ends on a fade the music has to fade with it rather than be cut off
 * by the recorder closing. The last segment's own fade is in source time, so it
 * is divided by the speed to say how long it takes to watch.
 */
export function projectEnding(project: Project): Ending {
    const at = projectLength(project);
    const last = project.segments[project.segments.length - 1];
    if (!last) return { at, fade: 0 };

    return { at, fade: Math.max(0, Math.min(at, last.effects.fadeOut / rate(last.speed))) };
}

/**
 * How long the whole timeline runs.
 *
 * The segments decide, and a sound reaching past the last of them does not
 * extend the render: the montage is what is being watched, and a music bed left
 * hanging past the last frame would add seconds of black. It is cut off with the
 * picture instead.
 */
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

/** Slack on a boundary test, so a seam does not leave a sliver behind. */
const EPSILON = 1e-4;

/**
 * Where a point in project time lands once `[from, to]` has been taken out.
 *
 * Anything before the cut stays where it is, anything after it slides back by
 * the length removed, and anything inside collapses onto the seam.
 */
function shifted(at: number, from: number, to: number): number {
    if (at <= from) return at;
    if (at >= to) return at - (to - from);
    return from;
}

/**
 * Removes a range of project time from the whole timeline.
 *
 * The editor's other way of shortening a montage is trimming a segment's in and
 * out points, which only reaches the ends of a take; the dead minute in the
 * middle of a clip needs the range itself to disappear and everything after it
 * to close up. A segment the cut lands inside is split in two around it, one it
 * swallows whole is dropped, and one it clips is trimmed on that side.
 *
 * Captions, overlays and sounds live in project time, so they are moved with the
 * picture rather than left pointing at the frame that used to be there. A sound
 * the cut falls inside is split the same way a segment is, so a music bed keeps
 * playing across the seam instead of jumping a phrase.
 */
export function cutRange(project: Project, from: number, to: number): Project {
    const start = Math.max(0, Math.min(from, to));
    const end = Math.max(from, to);
    const span = end - start;

    // Below a couple of frames there is nothing to remove, and closing up a
    // zero-length hole would only churn every id on the timeline.
    if (span < 0.05) return project;

    const segments: Segment[] = [];
    let elapsed = 0;

    for (const item of project.segments) {
        const length = segmentLength(item);
        const head = elapsed;
        const tail = elapsed + length;
        elapsed = tail;

        if (tail <= start + EPSILON || head >= end - EPSILON) {
            segments.push(item);
            continue;
        }

        if (head >= start - EPSILON && tail <= end + EPSILON) continue;

        // Project seconds are source seconds divided by the speed, so both edges
        // of the hole have to be scaled back up before they mean anything to the
        // file the segment is cut out of.
        const speed = rate(item.speed);

        const before: Segment | null = start > head
            ? { ...item, to: item.from + (start - head) * speed, effects: { ...item.effects } }
            : null;

        const after: Segment | null = end < tail
            ? { ...item, id: before ? newId() : item.id, from: item.from + (end - head) * speed, effects: { ...item.effects } }
            : null;

        if (before && segmentLength(before) >= 0.05) segments.push(before);
        if (after && segmentLength(after) >= 0.05) segments.push(after);
    }

    const captions = project.captions
        .map(c => ({ ...c, from: shifted(c.from, start, end), to: shifted(c.to, start, end) }))
        .filter(c => c.to - c.from >= 0.05);

    const overlays = (project.overlays ?? [])
        .map(o => ({ ...o, from: shifted(o.from, start, end), to: shifted(o.to, start, end) }))
        .filter(o => o.to - o.from >= 0.05);

    const audioClips: AudioClip[] = [];

    for (const clip of project.audioClips ?? []) {
        const head = clip.at;
        const tail = clip.at + Math.max(0, clip.to - clip.from);

        if (tail <= start + EPSILON || head >= end - EPSILON) {
            audioClips.push(head >= end - EPSILON ? { ...clip, at: clip.at - span } : clip);
            continue;
        }

        if (head >= start - EPSILON && tail <= end + EPSILON) continue;

        const before: AudioClip | null = start > head
            ? { ...clip, to: clip.from + (start - head) }
            : null;

        // Whatever is left of the clip after the hole now begins on the seam.
        const after: AudioClip | null = end < tail
            ? { ...clip, id: before ? newId() : clip.id, at: start, from: clip.from + (end - head) }
            : null;

        if (before && before.to - before.from >= 0.05) audioClips.push(before);
        if (after && after.to - after.from >= 0.05) audioClips.push(after);
    }

    return { ...project, segments, captions, overlays, audioClips };
}

/**
 * Throws away everything outside `[from, to]`.
 *
 * Two cuts rather than its own walk, and the tail goes first so the head's
 * coordinates are still the ones the caller measured.
 */
export function keepRange(project: Project, from: number, to: number): Project {
    const start = Math.max(0, Math.min(from, to));
    const end = Math.max(from, to);

    return cutRange(cutRange(project, end, projectLength(project)), 0, start);
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

/**
 * Where an overlay lands in a frame, in pixels.
 *
 * Exported because the editor needs the same answer the painter uses: dragging
 * a picture on the preview is a hit test against this box, and computing it
 * twice is how a handle ends up half a picture away from the picture.
 */
export function overlayBox(overlay: Overlay, source: ImageSource, width: number, height: number) {
    const ratio = source.height / Math.max(1, source.width);
    const w = Math.max(2, overlay.scale * width);
    const h = Math.max(2, w * ratio);

    return { x: overlay.x * width - w / 2, y: overlay.y * height - h / 2, w, h };
}

/** Opacity of an overlay at a project time, its fades included. */
function overlayAlpha(overlay: Overlay, now: number): number {
    let alpha = Math.min(1, Math.max(0, overlay.opacity));

    if (overlay.fadeIn > 0) alpha = Math.min(alpha, (now - overlay.from) / overlay.fadeIn);
    if (overlay.fadeOut > 0) alpha = Math.min(alpha, (overlay.to - now) / overlay.fadeOut);

    return Math.min(1, Math.max(0, alpha));
}

/** Drift, in seconds, small enough that correcting it costs more than it fixes. */
const OVERLAY_SLACK = 0.05;

/** Drift, in seconds, past which only a seek can catch an overlay up. */
const OVERLAY_DRIFT = 0.75;

/** Hardest the playback rate is bent to close a gap, as a fraction of it. */
const OVERLAY_CATCHUP = 0.15;

/**
 * Shortest signed distance from where an overlay should be to where it is.
 *
 * Signed and wrapped, because the element loops: at the seam its own time is
 * near zero while the montage still asks for the end of the clip, and a plain
 * subtraction reads that as a whole clip of drift and seeks on every pass.
 */
function overlayDrift(current: number, wanted: number, length: number): number {
    let delta = current - wanted;
    if (length <= 0) return delta;

    delta %= length;
    if (delta > length / 2) delta -= length;
    else if (delta < -length / 2) delta += length;

    return delta;
}

/** Seeks without demanding frame accuracy where the browser offers the choice. */
function seekOverlay(video: HTMLVideoElement, to: number): void {
    const fast = (video as HTMLVideoElement & { fastSeek?: (time: number) => void; }).fastSeek;

    if (typeof fast === "function") fast.call(video, to);
    else video.currentTime = to;
}

/**
 * Puts the moving overlays where the montage is, before anything is drawn.
 *
 * A video overlay is played rather than decoded: the render paints a canvas in
 * real time and captures it, so an element that is playing while the canvas is
 * painted lands in the file frame for frame. What this does is keep that
 * playback tied to project time instead of to when the element happened to
 * start - an overlay is paused when its placement is not on screen, looped by
 * the modulo when it is shorter than the placement, and pulled back into line
 * when it has drifted.
 *
 * How it is pulled back is the whole point. Seeking an H.264 overlay restarts
 * decoding at the keyframe before the target, which shows as a hitch and a jump
 * - the "choppy MP4" - and doing it every time the element is a frame or two
 * out means doing it constantly. So a small gap is closed by the playback rate
 * instead: behind the montage the element runs a touch faster, ahead of it a
 * touch slower, and it is back in step within a second or two without dropping
 * a single frame. Only a gap too wide for that, a scrub or a fresh placement,
 * is worth a seek.
 *
 * `playing` is the montage's own state. A paused preview is being scrubbed, and
 * an overlay left running under a still frame is both wrong on screen and drift
 * being manufactured for the next correction to clean up.
 */
function syncOverlayMedia(overlays: Overlay[], images: Map<string, ImageSource>, now: number, playing: boolean): void {
    for (const overlay of overlays) {
        const video = images.get(overlay.sourceId)?.video;
        if (!video) continue;

        if (now < overlay.from || now > overlay.to) {
            if (!video.paused) video.pause();
            if (video.playbackRate !== 1) video.playbackRate = 1;
            continue;
        }

        const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        const wanted = length ? (now - overlay.from) % length : now - overlay.from;

        // `readyState` first: seeking an element that has no metadata yet is
        // how a placement ends up stuck on its first frame.
        const ready = video.readyState >= 1;
        const drift = ready ? overlayDrift(video.currentTime, wanted, length) : 0;

        if (!playing) {
            if (!video.paused) video.pause();
            if (video.playbackRate !== 1) video.playbackRate = 1;
            if (ready && Math.abs(drift) > OVERLAY_SLACK && !video.seeking) seekOverlay(video, wanted);
            continue;
        }

        if (ready && Math.abs(drift) > OVERLAY_DRIFT) {
            if (video.playbackRate !== 1) video.playbackRate = 1;
            if (!video.seeking) seekOverlay(video, wanted);
        } else if (ready && Math.abs(drift) > OVERLAY_SLACK) {
            const nudge = Math.max(-OVERLAY_CATCHUP, Math.min(OVERLAY_CATCHUP, -drift / 2));
            const rate = 1 + nudge;

            // Written only when it actually moves: assigning the rate every
            // frame makes Chromium re-run its resampler for nothing.
            if (Math.abs(video.playbackRate - rate) > 0.005) video.playbackRate = rate;
        } else if (video.playbackRate !== 1) {
            video.playbackRate = 1;
        }

        // Autoplay can refuse until the page has been interacted with, and the
        // next frame simply asks again.
        if (video.paused) void video.play().catch(() => undefined);
    }
}

/**
 * Draws the pictures showing at a project time.
 *
 * On a cleared filter and a full alpha: the video was drawn under whatever
 * effects the segment carries, and an overlay inheriting the segment's blur or
 * its fade to black would be a bug rather than a feature - a logo is a logo
 * whatever is happening to the footage behind it.
 */
function drawOverlays(ctx: CanvasRenderingContext2D, width: number, height: number, overlays: Overlay[], images: Map<string, ImageSource>, now: number): void {
    for (const overlay of overlays) {
        if (now < overlay.from || now > overlay.to) continue;

        const source = images.get(overlay.sourceId);
        if (!source) continue;

        const alpha = overlayAlpha(overlay, now);
        if (alpha <= 0) continue;

        const box = overlayBox(overlay, source, width, height);

        ctx.save();
        ctx.filter = "none";
        ctx.globalAlpha = alpha;

        if (overlay.rotation) {
            // Rotated about its own centre, which is where the user put it.
            ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
            ctx.rotate((overlay.rotation * Math.PI) / 180);
            ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2));
        }

        try {
            ctx.drawImage(source.image, box.x, box.y, box.w, box.h);
        } catch (e) {
            // A picture that failed to decode is still in the list; drawing it
            // throws once per frame, and the render must not die of it.
            logger.warn("Could not draw an overlay", e);
        }

        ctx.restore();
    }
}

/** An avatar decoded once and drawn on every frame, by user id. */
export type AvatarCache = Map<string, CanvasImageSource>;

/**
 * Draws the people talking right now, stacked down the top-left corner.
 *
 * Avatar plus name rather than either alone: a clip of a call is watched by
 * people who were not in it, and a face with no name tells them nothing while a
 * name with no face is missed at a glance. Whoever has no avatar loaded yet
 * gets their initial on a disc, so a badge never collapses to a blank hole.
 */
function drawSpeakers(ctx: CanvasRenderingContext2D, width: number, height: number, speakers: VoiceTrack[], avatars: AvatarCache | undefined): void {
    if (!speakers.length) return;

    // Everything is a fraction of the frame so a badge lands in the same place
    // on a 720p render and on the preview surface above it.
    const size = Math.max(18, Math.round(height * 0.075));
    const pad = Math.round(height * 0.028);
    const gap = Math.round(size * 0.28);
    const font = Math.max(11, Math.round(size * 0.42));

    ctx.save();
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${font}px "gg sans", "Segoe UI", system-ui, sans-serif`;

    // Four at most: past that the badges are a second video, not a label.
    let y = pad;

    for (const speaker of speakers.slice(0, 4)) {
        const centre = y + size / 2;
        const name = speaker.name.slice(0, 22);
        const text = ctx.measureText(name).width;
        const box = size + gap * 0.5 + text + gap;

        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.beginPath();
        ctx.roundRect(pad, y, Math.min(width - pad * 2, box), size, size / 2);
        ctx.fill();

        const image = avatars?.get(speaker.id);

        ctx.save();
        ctx.beginPath();
        ctx.arc(pad + size / 2, centre, size / 2 - 2, 0, Math.PI * 2);
        ctx.clip();

        if (image) {
            ctx.drawImage(image, pad + 2, y + 2, size - 4, size - 4);
        } else {
            ctx.fillStyle = "#5865f2";
            ctx.fillRect(pad + 2, y + 2, size - 4, size - 4);
            ctx.fillStyle = "#ffffff";
            ctx.textAlign = "center";
            ctx.fillText((name[0] || "?").toUpperCase(), pad + size / 2, centre);
            ctx.textAlign = "left";
        }

        ctx.restore();

        // A ring in Discord's speaking green, the same cue as in the call.
        ctx.strokeStyle = "#23a55a";
        ctx.lineWidth = Math.max(2, size * 0.07);
        ctx.beginPath();
        ctx.arc(pad + size / 2, centre, size / 2 - 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(name, pad + size + gap * 0.5, centre + 1);

        y += size + Math.round(size * 0.18);
    }

    ctx.restore();
}

/** What the frame under the playhead is, beyond the pixels the element holds. */
export interface Frame {
    segment: Segment;
    /** Project time at the segment's in point, so captions can be placed. */
    startsAt: number;
    captions: Caption[];
    style: CaptionStyle;
    /** The pictures on the montage, and the bitmaps they refer to. */
    overlays?: Overlay[];
    images?: Map<string, ImageSource>;
    /** The voice tracks of the file under the playhead, for the badges. */
    voices?: VoiceTrack[];
    voiceLevels?: VoiceLevels;
    avatars?: AvatarCache;
    showSpeakers?: boolean;
}

/**
 * Paints one frame of the timeline: the source, its effects, its captions.
 *
 * The render and the preview both go through here on purpose. They used to
 * disagree - the preview was the bare element, so it showed neither the effects
 * nor the captions and a caption could only be placed blind - and the only way
 * two painters stay identical is to be one painter.
 */
export function paintFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement | null, width: number, height: number, frame: Frame | null): void {
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    if (!frame || !video || !video.videoWidth) return;

    const { segment, startsAt, captions, style } = frame;
    const { effects } = segment;

    const played = Math.max(0, video.currentTime - segment.from);
    const left = Math.max(0, segment.to - video.currentTime);

    let alpha = 1;
    if (effects.fadeIn > 0) alpha = Math.min(alpha, played / effects.fadeIn);
    if (effects.fadeOut > 0) alpha = Math.min(alpha, left / effects.fadeOut);

    ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
    ctx.filter = filterFor(effects);

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

    const now = startsAt + played / rate(segment.speed);

    /*
     * Pictures first, then captions on top of them.
     *
     * A caption is text meant to be read and a picture is decoration; when the
     * two land in the same corner the text has to win, or the montage loses the
     * only part of itself that carries words.
     */
    if (frame.overlays?.length && frame.images?.size) {
        syncOverlayMedia(frame.overlays, frame.images, now, !video.paused && !video.ended);
        drawOverlays(ctx, width, height, frame.overlays, frame.images, now);
    }

    ctx.filter = "none";
    ctx.globalAlpha = 1;

    // Captions overlapping in time stack upwards instead of printing on top of
    // each other.
    let stack = 0;

    for (const caption of captions) {
        if (now < caption.from || now > caption.to || !caption.text.trim()) continue;

        stack += drawCaption(ctx, caption.text, style, width, height, stack);
    }

    /*
     * The badges are placed on source time, not project time: the tracks were
     * recorded against the file, so a segment that starts a minute in has to
     * read a minute in, whatever the montage did with it.
     */
    if (frame.showSpeakers && frame.voices?.length) {
        drawSpeakers(ctx, width, height, speakingAt(frame.voices, frame.voiceLevels, video.currentTime), frame.avatars);
    }
}

/**
 * Guard on a soundtrack looped under a very long placement.
 *
 * A two second sting stretched across a ten minute montage is three hundred
 * scheduled nodes, which is fine; a fifty millisecond one is twelve thousand,
 * which is not. The cap is high enough that nothing a person places by hand
 * reaches it.
 */
const MAX_OVERLAY_LOOPS = 400;

/**
 * Turns the overlays' own soundtracks into clips on the sound timeline.
 *
 * A video overlay is drawn by playing a muted element and capturing the canvas,
 * so its sound has to come from somewhere else. Rather than a second scheduler
 * for it, each placement is expressed as the sound clips it amounts to: the
 * volume slider is a clip gain, the placement's fades are the clip's fades, and
 * a placement longer than the file becomes one clip per loop. Everything the
 * sound timeline already does - trimming, the montage's ending, stopping on a
 * seek - then applies to it for free.
 */
export function overlaySounds(
    overlays: Overlay[],
    images: Map<string, ImageSource>
): { clips: AudioClip[]; sources: Map<string, AudioSource>; } {
    const clips: AudioClip[] = [];
    const sources = new Map<string, AudioSource>();

    for (const overlay of overlays) {
        const source = images.get(overlay.sourceId);
        const buffer = source?.audio;
        if (!source || !buffer) continue;

        const level = overlay.volume ?? 1;
        const span = Math.max(0, overlay.to - overlay.from);
        const length = buffer.duration;
        if (level <= 0 || span <= 0 || length <= 0) continue;

        if (!sources.has(source.id)) {
            sources.set(source.id, {
                id: source.id,
                name: source.name,
                url: source.url,
                ...(source.path ? { path: source.path } : {}),
                duration: length,
                buffer,
                // Never drawn as a waveform: these are not on the sound shelf.
                peaks: []
            });
        }

        const loops = Math.min(MAX_OVERLAY_LOOPS, Math.ceil(span / length));

        for (let pass = 0; pass < loops; pass++) {
            const at = overlay.from + pass * length;
            const to = Math.min(length, span - pass * length);
            if (to <= 0) break;

            const last = pass === loops - 1;

            clips.push({
                id: `${overlay.id}#${pass}`,
                sourceId: source.id,
                at,
                from: 0,
                to,
                gain: level,
                // The placement's fades belong to its ends, not to every loop.
                fadeIn: pass === 0 ? overlay.fadeIn : 0,
                fadeOut: last ? overlay.fadeOut : 0,
                muted: false
            });
        }
    }

    return { clips, sources };
}

/** Overlay files that are played rather than decoded to a single bitmap. */
const MOVING_OVERLAY = /\.(mp4|webm)$/i;

/**
 * Prepares a video overlay.
 *
 * Muted and looping, and never appended to the document: an element only has to
 * be decodable to be drawn onto a canvas, and one left in the tree would be a
 * second copy of the footage sitting behind the studio. `loadeddata` rather
 * than `loadedmetadata`, so the first frame the painter asks for exists.
 *
 * The element itself stays muted even when the clip has sound. What is heard is
 * the decoded buffer scheduled on the sound timeline - see `overlaySounds` -
 * and leaving the element audible as well would play the whole thing twice,
 * once at the volume the slider says and once at full.
 */
async function decodeVideoOverlay(id: string, name: string, url: string, ctx?: BaseAudioContext, path?: string): Promise<ImageSource> {
    const video = document.createElement("video");

    video.src = url;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";

    await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error(`Could not read ${name} as a clip.`));
    });

    return {
        id,
        name,
        url,
        ...(path ? { path } : {}),
        width: video.videoWidth || 1,
        height: video.videoHeight || 1,
        image: video,
        video,
        ...(ctx ? { audio: await decodeOverlayAudio(name, url, ctx) } : {})
    };
}

/**
 * Reads a video overlay's audio track, or nothing when it has none.
 *
 * Silent clips are the common case - a reaction GIF exported as MP4, a screen
 * grab with no sound - and `decodeAudioData` rejects on them exactly as it does
 * on a file it cannot read at all. Neither is worth failing the import over, so
 * both come back as an overlay that simply has no sound.
 */
async function decodeOverlayAudio(name: string, url: string, ctx: BaseAudioContext): Promise<AudioBuffer | undefined> {
    try {
        const data = await (await fetch(url)).arrayBuffer();
        return await ctx.decodeAudioData(data);
    } catch (e) {
        logger.debug(`No usable sound in the overlay "${name}"`, e);
        return undefined;
    }
}

/**
 * Decodes a picture into a source the painter can use.
 *
 * `decode()` rather than the `load` event: it resolves once the bitmap is
 * actually ready to be drawn, where `load` only promises the bytes arrived.
 * The difference shows up as a first frame with a blank overlay on it.
 *
 * A GIF needs nothing special. An `<img>` holding an animated one advances by
 * itself, and `drawImage` takes whichever frame it is showing - which is the
 * right one, because the render paints in real time.
 */
export async function decodeImage(id: string, name: string, url: string, ctx?: BaseAudioContext, path?: string): Promise<ImageSource> {
    if (MOVING_OVERLAY.test(name)) return decodeVideoOverlay(id, name, url, ctx, path);

    const image = new Image();
    image.src = url;

    await image.decode();

    const width = image.naturalWidth || 1;
    const height = image.naturalHeight || 1;

    return { id, name, url, ...(path ? { path } : {}), width, height, image };
}

/**
 * Decodes the avatars a set of tracks refers to, once.
 *
 * `crossOrigin` is not optional here: an image drawn from another origin without
 * it taints the canvas, and a tainted canvas cannot be captured - the render
 * would fail at `captureStream` with a security error rather than anywhere near
 * the line that caused it. Discord's CDN answers with a permissive
 * `Access-Control-Allow-Origin`, and anything that does not simply never
 * resolves into the cache and falls back to the initial disc.
 */
export async function loadAvatars(tracks: VoiceTrack[]): Promise<AvatarCache> {
    const cache: AvatarCache = new Map();

    await Promise.all(tracks.map(async track => {
        if (!track.avatar) return;

        try {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.src = track.avatar;

            await image.decode();
            cache.set(track.id, image);
        } catch (e) {
            logger.warn("Could not load a speaker avatar", e);
        }
    }));

    return cache;
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

/**
 * Waits for a source to be decodable, and says so when it is not.
 *
 * A plain `loadeddata` wait treats an unreadable file as a slow one: it times
 * out in silence, the render starts on a source that will never produce a
 * frame, and the failure only surfaces seconds later as a playback error.
 * Watching `error` turns that into an immediate failure that names the file.
 */
function loadVideo(video: HTMLVideoElement, name: string, timeout = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
        let done = false;

        const settle = (error?: Error) => {
            if (done) return;
            done = true;

            clearTimeout(timer);
            video.removeEventListener("loadeddata", onLoaded);
            video.removeEventListener("error", onError);

            if (error) reject(error);
            else resolve();
        };

        const onLoaded = () => settle();
        const onError = () => settle(new Error(`"${name}" could not be decoded`));
        const timer = setTimeout(() => settle(new Error(`"${name}" took too long to load`)), timeout);

        video.addEventListener("loadeddata", onLoaded);
        video.addEventListener("error", onError);
        video.load();
    });
}

/** Frees an element's decoder now rather than whenever it is collected. */
function release(video: HTMLVideoElement) {
    video.pause();
    video.removeAttribute("src");
    video.load();
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
    /**
     * The notch the per-person levels ride, sitting before the segment's gain.
     *
     * Two different jobs, and they were the same node once, which is how a mute
     * came to silence a whole clip: the gain is the segment's volume and the
     * switch that drops the footage's sound, so anything written to it applies
     * to the game, the music and the call alike. The notch only reaches the
     * speech band. See `voiceBand.ts`.
     */
    band: VoiceBand;
}

/**
 * Forces a gain to a value, ramps included.
 *
 * `setTargetAtTime` never ends on its own: it is an event on the parameter's
 * timeline, and assigning `.value` afterwards does not remove it - the target
 * keeps pulling the gain back. Every hard set of a ducked gain has to clear the
 * timeline first, or a muted segment quietly fades back in.
 */
function setGain(ctx: AudioContext, gain: GainNode, value: number): void {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(value, ctx.currentTime);
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

    try {
        for (const source of sources) {
            if (!needed.has(source.id)) continue;

            const video = document.createElement("video");
            video.src = source.url;
            video.preload = "auto";
            video.playsInline = true;
            // Muting here would silence the graph too; the element's output already
            // goes to the mix rather than the speakers once it is wired up.
            video.volume = 1;

            try {
                await loadVideo(video, source.name);
            } catch (e) {
                release(video);
                throw e;
            }

            const gain = ctx.createGain();
            gain.gain.value = 0;

            const band = createVoiceBand(ctx);

            try {
                ctx.createMediaElementSource(video).connect(band.input);
                band.output.connect(gain);
                gain.connect(dest);
            } catch (e) {
                logger.warn("Could not route the audio of a timeline source", e);
            }

            loaded.set(source.id, { video, gain, band });
        }
    } catch (e) {
        // Every element built so far holds a decoder until it is collected, and
        // the caller only knows to close the audio context: a source that fails
        // to load halfway through must not leave the earlier ones behind.
        for (const { video } of loaded.values()) release(video);
        throw e;
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
    const width = Math.max(2, Math.round((project.width || height * 16 / 9) / 2) * 2);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("This client cannot render the timeline");

    // Checked before anything is opened: there is nothing to clean up yet.
    const mimeType = options.mimeType || renderMimeType();
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

    const sounds = new Map((options.sounds ?? []).map(sound => [sound.id, sound]));
    const clips = (project.audioClips ?? []).filter(c => sounds.has(c.sourceId));

    const images = new Map((options.images ?? []).map(image => [image.id, image]));
    const overlays = (project.overlays ?? []).filter(o => images.has(o.sourceId));

    // The overlays' own soundtracks join the timeline as clips, so the one
    // scheduler below covers both.
    const fromOverlays = overlaySounds(overlays, images);
    for (const [id, source] of fromOverlays.sources) sounds.set(id, source);
    clips.push(...fromOverlays.clips);

    const voicesBySource = new Map(sources.filter(s => s.voices?.length).map(s => [s.id, s.voices!]));
    const showSpeakers = project.showSpeakers !== false && voicesBySource.size > 0;
    const ducking = voiceLevelsTouched(project.voiceLevels) && voicesBySource.size > 0;

    /*
     * Anybody muted is taken out of the recording before a frame is drawn.
     *
     * The duck can only turn the whole mix down, so a mute used to cost
     * everyone talking at that moment; `voiceMixFor` rebuilds the file's sound
     * with each person's level applied to their own voice instead. It is
     * usually already in memory, having been built while the user was listening
     * to the preview, and when it cannot be built at all it answers null and
     * the duck below carries on exactly as it did.
     */
    const mixes = new Map<string, VoiceMix>();

    /*
     * Only where a level was moved, which `voiceMixFor` decides for itself.
     *
     * The clip's own soundtrack already holds the call as it was heard, so a
     * montage nobody has muted anybody in is recorded straight off the element
     * and this loop costs nothing. Where somebody is turned down the rebuild is
     * usually already in memory, having been built while the user was listening
     * to the preview, and when the file has no separate tracks to rebuild from
     * it answers null and the duck below carries on as it did.
     */
    for (const source of sources) {
        if (!loaded.has(source.id)) continue;

        const mix = await voiceMixFor(
            { id: source.id, url: source.url, voices: source.voices ?? [], tracks: source.tracks },
            project.voiceLevels,
            audioCtx
        );

        if (mix) mixes.set(source.id, mix);
    }

    /*
     * Avatars are decoded before the recorder is armed.
     *
     * They come off the network, and a badge that pops in three seconds into the
     * file because its image was still loading is worse than no badge at all.
     */
    const avatars = showSpeakers
        ? await loadAvatars([...voicesBySource.values()].flat()).catch(() => new Map() as AvatarCache)
        : undefined;

    /*
     * The output keeps an audio track when there is anything at all to put on
     * it. `project.audio` only speaks for the footage's own sound, so a montage
     * with the game muted and a music bed over it is a real case, and dropping
     * the track would silence the one thing the user did want.
     */
    const stream = new MediaStream([
        ...canvas.captureStream(project.fps || 30).getVideoTracks(),
        ...(project.audio || clips.length ? dest.stream.getAudioTracks() : [])
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

    // Swapped by the segment driver, painted by the loop below.
    let current: { video: HTMLVideoElement; frame: Frame; } | null = null;
    let elapsed = 0;
    let frame = 0;
    let started = false;

    const draw = () => paintFrame(ctx, current?.video ?? null, width, height, current?.frame ?? null);

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

            const { video, gain, band } = entry;

            current = null;
            await seekTo(video, segment.from);

            // Set before the rate: Chromium reads it when the rate changes.
            (video as HTMLVideoElement & { preservesPitch?: boolean; }).preservesPitch = segment.pitch !== false;
            video.playbackRate = rate(segment.speed);
            const base = project.audio ? Math.min(1, Math.max(0, segment.volume)) : 0;
            const voices = voicesBySource.get(segment.sourceId) ?? [];

            /*
             * With a separated soundtrack the element's own output is dropped
             * entirely and the rebuilt samples are played in its place. The
             * picture still comes from the element, so the two have to stay
             * lined up: the buffer is started at the frame the element is
             * actually on, at the same rate, once playback has really begun.
             */
            const mix = mixes.get(segment.sourceId);
            const replacing = Boolean(mix) && base > 0;

            // Silenced only when something is going to take its place. The two
            // conditions have to be the same one, or a segment ends up with the
            // element off and no buffer playing, which is a silent clip.
            setGain(audioCtx, gain, replacing ? 0 : base);

            // Flat at the start of every segment: the notch is left wherever
            // the last one's duck ended, and a segment with nobody muted would
            // otherwise open with the previous segment's hole still in it.
            band.set(1, false);
            current = {
                video,
                frame: {
                    segment,
                    startsAt: elapsed,
                    captions: project.captions,
                    style: project.captionStyle,
                    overlays,
                    images,
                    voices,
                    voiceLevels: project.voiceLevels,
                    avatars,
                    showSpeakers
                }
            };

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

            /*
             * The sounds of this stretch are scheduled once playback is actually
             * running, and the clock is read at that moment.
             *
             * Scheduling the whole timeline up front would drift: the render
             * pauses between segments while the next source seeks, so context
             * time and project time only agree inside a segment. Re-anchoring at
             * each one keeps a music bed lined up with the picture across a cut,
             * at the cost of restarting it there.
             */
            let voiceGain: GainNode | null = null;
            let voiceBand: VoiceBand | null = null;
            let voiceSource: AudioBufferSourceNode | null = null;

            if (replacing) {
                try {
                    voiceGain = audioCtx.createGain();
                    voiceGain.gain.value = base;
                    voiceGain.connect(dest);

                    voiceBand = createVoiceBand(audioCtx);
                    voiceBand.output.connect(voiceGain);

                    voiceSource = audioCtx.createBufferSource();
                    voiceSource.buffer = mix!.buffer;
                    voiceSource.playbackRate.value = rate(segment.speed);
                    voiceSource.connect(voiceBand.input);
                    voiceSource.start(audioCtx.currentTime, Math.max(0, video.currentTime));
                } catch (e) {
                    // Whatever went wrong, the one outcome that is not allowed
                    // is a segment with no sound at all: the element goes back
                    // to carrying it, ducked the way it was before any of this.
                    logger.warn("Could not play the separated sound, falling back to the recording", e);

                    voiceSource?.disconnect();
                    voiceBand?.disconnect();
                    voiceGain?.disconnect();
                    voiceSource = null;
                    voiceBand = null;
                    voiceGain = null;

                    setGain(audioCtx, gain, base);
                }
            }

            const last = segment === project.segments[project.segments.length - 1];

            const stopSounds = clips.length
                ? scheduleClips(
                    audioCtx, dest, clips, sounds, audioCtx.currentTime, elapsed, elapsed + length,
                    last ? projectEnding(project) : undefined
                )
                : null;

            try {
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

                        /*
                         * The per-person duck is followed frame by frame rather
                         * than scheduled ahead: playback is what drives this
                         * render, so the only clock that agrees with the picture
                         * is the element's own. `setTargetAtTime` does the
                         * smoothing, which is what keeps a level change from
                         * arriving as a click.
                         *
                         * On a separated segment this rides the rebuilt
                         * soundtrack instead of the element, and it only has
                         * the people separation could not model left to handle -
                         * usually nobody, in which case `mix.duck` is undefined
                         * and the duck sits flat at 1.
                         */
                        if (base > 0 && ducking) {
                            const level = voiceDuckAt(
                                voices,
                                voiceBand ? mix!.duck : project.voiceLevels,
                                video.currentTime
                            );

                            /*
                             * On the notch, not on the gain.
                             *
                             * The segment's own volume stays where it was put:
                             * what a per-person level moves is the speech band
                             * and nothing else, so a muted person digs a hole
                             * where their voice is and the game carries on
                             * through it at full level.
                             */
                            (voiceBand ?? band).set(level);
                        }

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
            } finally {
                stopSounds?.();

                try {
                    voiceSource?.stop();
                } catch {
                    // Already ended on its own, which is the normal case for a
                    // segment that ran to the end of the buffer.
                }

                voiceSource?.disconnect();
                voiceBand?.disconnect();
                voiceGain?.disconnect();
            }

            video.pause();
            setGain(audioCtx, gain, 0);
            elapsed += length;
        }
    } finally {
        current = null;
        cancelAnimationFrame(frame);

        for (const { video, gain } of loaded.values()) {
            video.pause();
            setGain(audioCtx, gain, 0);
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

        for (const { video } of loaded.values()) release(video);
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

    // A montage with the footage muted and a music bed over it still has an
    // audio track, and the render's own rule for keeping one is exactly this.
    const audio = project.audio || project.audioClips?.length
        ? settings.store.audioBitrate * 1000
        : 0;

    return Math.round(projectLength(project) * (video + audio) / 8);
}

/** Mime type the render will produce, for naming the file before it exists. */
function renderMimeType(): string {
    return pickMimeType(settings.store.container) || "video/webm";
}
