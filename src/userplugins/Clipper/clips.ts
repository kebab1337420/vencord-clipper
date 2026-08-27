/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - clip folder access
 *
 * Everything the studio needs from disk: listing what is saved, loading a clip
 * or an outside video back into a blob URL, renaming, deleting, revealing, and
 * writing a rendered copy back next to the others.
 *
 * Nothing here re-encodes; cutting and rendering live in ./studio, which drives
 * a canvas and a single MediaRecorder over the whole timeline.
 */

import type { PluginNative } from "@utils/types";

import type { StoredClip } from "./native";
import { logger } from "./recorder";
import { extensionFor, settings } from "./settings";

export type { StoredClip };

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

/** False in a browser / web build, where there is no clip folder to read. */
export const CLIPS_AVAILABLE = IS_DISCORD_DESKTOP || IS_VESKTOP;

export async function listClips(): Promise<StoredClip[]> {
    if (!CLIPS_AVAILABLE) return [];

    try {
        return await Native.listClips(settings.store.saveDirectory);
    } catch (e) {
        logger.warn("Could not list clips", e);
        return [];
    }
}

/**
 * Loads a clip into an object URL for the `<video>` element.
 *
 * The bytes travel over IPC because Discord's CSP blocks `file://` media, so a
 * long clip is briefly held twice in memory. Callers must revoke the URL.
 */
export async function loadClipUrl(name: string): Promise<string> {
    const data = await Native.readClip(settings.store.saveDirectory, name);

    // The view rather than the buffer behind it: a Uint8Array is not always
    // the whole of what it sits on, and a Blob given the buffer would take
    // everything around it too.
    return URL.createObjectURL(new Blob([data as BlobPart], { type: typeOfClip(name) }));
}

/** Media type a clip's name implies. WebM is the fallback, as it always was. */
export function typeOfClip(name: string): string {
    const lower = name.toLowerCase();

    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".gif")) return "image/gif";

    return "video/webm";
}

/**
 * Loads a clip as a File, ready to be attached to a message.
 *
 * A File rather than a Blob because Discord's upload path reads the name off it
 * and would otherwise attach the clip as "blob".
 */
export async function loadClipFile(name: string): Promise<File> {
    const data = await Native.readClip(settings.store.saveDirectory, name);

    return new File([data as BlobPart], name, { type: typeOfClip(name) });
}

/**
 * Loads a clip's thumbnail, or null when it has none.
 *
 * Clips saved before thumbnails existed have no sidecar, and neither do clips
 * whose still could not be decoded, so the caller must have a placeholder.
 * Callers must revoke the URL.
 */
export async function loadThumbUrl(clip: StoredClip): Promise<string | null> {
    if (!clip.thumb) return null;

    try {
        const data = await Native.readClip(settings.store.saveDirectory, clip.thumb);
        return URL.createObjectURL(new Blob([data as BlobPart], { type: "image/jpeg" }));
    } catch (e) {
        logger.warn("Could not read a clip thumbnail", e);
        return null;
    }
}

/** One person's own audio, out of the `voices` folder beside the clips. */
export function loadVoiceTrack(file: string): Promise<Uint8Array> {
    return Native.readVoiceTrack(settings.store.saveDirectory, file);
}

export function deleteClip(name: string): Promise<void> {
    return Native.deleteClip(settings.store.saveDirectory, name);
}

export function renameClip(name: string, next: string): Promise<string> {
    return Native.renameClip(settings.store.saveDirectory, name, next);
}

export function revealClip(name: string): Promise<void> {
    return Native.revealClip(settings.store.saveDirectory, name);
}

/** Writes an edited clip next to the others, never over an existing file. */
export function writeClipCopy(blob: Blob, name: string): Promise<string> {
    return blob.arrayBuffer().then(buf => writeClipBytes(new Uint8Array(buf), name));
}

/**
 * The bytes of a clip, as they are on disk.
 *
 * For work that only ever hands them to a parser or straight back to a writer:
 * wrapping them in a `Blob` first and reading them out again is a copy of the
 * whole clip each way.
 */
export function readClipBytes(name: string): Promise<Uint8Array> {
    return Native.readClip(settings.store.saveDirectory, name);
}

/** Writes a clip that is already a byte array, never over an existing file. */
export function writeClipBytes(data: Uint8Array, name: string): Promise<string> {
    return Native.saveClip(settings.store.saveDirectory, name, data, true);
}

/**
 * Duration of a MediaRecorder file.
 *
 * Live-recorded WebM carries no duration in its header, so `video.duration` is
 * Infinity until the whole file has been walked. Seeking far past the end forces
 * Chromium to do that walk; `seekable` then holds the real range, including the
 * non-zero start the rolling buffer leaves behind when it drops old clusters.
 */
export async function probeRange(video: HTMLVideoElement): Promise<{ start: number; end: number; }> {
    if (!Number.isFinite(video.duration)) {
        await new Promise<void>(resolve => {
            let done = false;
            const settle = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                video.removeEventListener("durationchange", onChange);
                resolve();
            };

            const onChange = () => {
                if (Number.isFinite(video.duration)) settle();
            };

            const timer = setTimeout(settle, 4000);
            video.addEventListener("durationchange", onChange);

            try {
                video.currentTime = 1e101;
            } catch {
                settle();
            }
        });
    }

    const start = video.seekable.length ? video.seekable.start(0) : 0;
    const end = video.seekable.length
        ? video.seekable.end(video.seekable.length - 1)
        : (Number.isFinite(video.duration) ? video.duration : 0);

    try {
        video.currentTime = start;
    } catch {
        // Not seekable yet; the caller seeks again before playing anyway.
    }

    return { start, end: Math.max(end, start) };
}

/** Writes the frame currently shown as a PNG next to the clips. */
export async function saveFrame(video: HTMLVideoElement, name: string): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx || !canvas.width) throw new Error("The clip has no frame to save");

    ctx.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode the frame");

    return writeClipCopy(blob, name);
}

/** `clip-....webm` at 12.4s becomes `clip-....-12s.png`. */
export function frameName(name: string, at: number): string {
    return `${name.replace(/\.(webm|mp4)$/i, "")}-${Math.round(at)}s.png`;
}

/**
 * Asks the main process for videos to drop on the studio timeline.
 *
 * Returns absolute paths: the bytes are only read once the user confirms, so
 * cancelling the dialog costs nothing.
 */
export async function pickVideoFiles(): Promise<string[]> {
    if (!CLIPS_AVAILABLE) return [];

    try {
        return await Native.pickVideoFiles();
    } catch (e) {
        logger.warn("Could not open the video picker", e);
        return [];
    }
}

const IMPORT_TYPES: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/mp4",
    webm: "video/webm",
    mkv: "video/webm"
};

/** Loads an outside video into an object URL. The caller revokes it. */
export async function loadVideoFile(path: string): Promise<{ name: string; url: string; }> {
    const data = await Native.readVideoFile(path);
    const name = path.split(/[\\/]/).pop() || "video";
    const type = IMPORT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "video/mp4";

    return { name, url: URL.createObjectURL(new Blob([data as BlobPart], { type })) };
}

/** Opens the OS picker for sounds to lay over a montage. */
export async function pickAudioFiles(): Promise<string[]> {
    if (!CLIPS_AVAILABLE) return [];

    try {
        return await Native.pickAudioFiles();
    } catch (e) {
        logger.warn("Could not open the sound picker", e);
        return [];
    }
}

const SOUND_TYPES: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    webm: "audio/webm"
};

/**
 * Loads a sound off disk, as bytes and as an object URL.
 *
 * Both, because they answer different questions: the bytes go to the decoder
 * that produces the waveform and the samples the render schedules, and the URL
 * is what lets the file be handed to an element for a quick listen without
 * decoding it a second time. The caller revokes the URL.
 */
export async function loadAudioFile(path: string): Promise<{ name: string; url: string; data: ArrayBuffer; }> {
    const bytes = await Native.readAudioFile(path);
    const name = path.split(/[\\/]/).pop() || "sound";
    const type = SOUND_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "audio/mpeg";

    // One buffer, shared: the Blob keeps the bytes alive for the URL while the
    // decoder gets the same ones. Exactly the span the read handed over rather
    // than whatever the view sits on, and its own buffer either way, because
    // decodeAudioData detaches what it is given.
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    return { name, url: URL.createObjectURL(new Blob([data], { type })), data };
}

export async function pickImageFiles(): Promise<string[]> {
    if (!CLIPS_AVAILABLE) return [];

    try {
        return await Native.pickImageFiles();
    } catch (e) {
        logger.warn("Could not open the picture picker", e);
        return [];
    }
}

const IMAGE_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    bmp: "image/bmp",
    mp4: "video/mp4",
    webm: "video/webm"
};

/**
 * Loads a picture off disk as an object URL.
 *
 * Only the URL, unlike a sound: nothing here needs the bytes again once the
 * bitmap exists, and an `<img>` fed a blob URL decodes on the compositor
 * thread rather than blocking the one painting the preview. The caller
 * revokes it.
 */
export async function loadImageFile(path: string): Promise<{ name: string; url: string; }> {
    const bytes = await Native.readImageFile(path);
    const name = path.split(/[\\/]/).pop() || "picture";
    const type = IMAGE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "image/png";

    return { name, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type })) };
}

/** `clip-....webm` becomes `clip-....-edit.webm` for a studio render. */
export function renderName(name: string, mimeType: string): string {
    const stem = (name || "timeline").replace(/\.(webm|mp4)$/i, "");
    return `${stem}-edit.${extensionFor(mimeType)}`;
}
