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
    const type = name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "video/webm";

    // The IPC copy is a plain Uint8Array; hand its buffer to the Blob directly.
    return URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type }));
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
    return blob.arrayBuffer().then(buf => Native.saveClip(settings.store.saveDirectory, name, new Uint8Array(buf), true));
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

    return { name, url: URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type })) };
}

/** `clip-....webm` becomes `clip-....-edit.webm` for a studio render. */
export function renderName(name: string, mimeType: string): string {
    const stem = (name || "timeline").replace(/\.(webm|mp4)$/i, "");
    return `${stem}-edit.${extensionFor(mimeType)}`;
}
