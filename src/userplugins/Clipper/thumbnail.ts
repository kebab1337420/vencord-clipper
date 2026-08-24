/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - clip thumbnails
 *
 * A still written next to every clip as it is produced, so the library can show
 * fifty clips without opening fifty decoders. Its own module because both ends
 * of the plugin write them - the recorder when a clip is saved, the studio when
 * one is rendered or converted - and because importing either from the other
 * would close a cycle.
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";

import { settings } from "./settings";
import { thumbNameFor } from "./utils";

const logger = new Logger("Clipper", "#f0b132");

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

/** Width of a stored thumbnail: enough for the library list at 2x. */
const THUMB_WIDTH = 320;

/**
 * How long a still is waited for.
 *
 * A live-recorded clip carries no duration, so its seeks can be refused outright
 * and the wait would run to the end of the timeout every single time. Short,
 * because whatever has already been decoded is good enough for a 320px still.
 */
const READY_MS = 2500;

/**
 * Writes a still from a clip next to it, as a JPEG sidecar.
 *
 * Failure is not worth reporting: the library falls back to a placeholder, and
 * a clip without a picture is not a clip that was lost.
 */
export async function writeThumbnail(blob: Blob, name: string): Promise<void> {
    if (!(IS_DISCORD_DESKTOP || IS_VESKTOP)) return;

    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");

    try {
        video.muted = true;
        video.preload = "auto";
        video.src = url;

        await frameReady(video);

        const width = Math.min(THUMB_WIDTH, video.videoWidth || THUMB_WIDTH);
        const height = Math.round(width * (video.videoHeight || 9) / (video.videoWidth || 16));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.max(1, height);

        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.72));
        if (!jpeg) return;

        await Native.saveClip(
            settings.store.saveDirectory,
            thumbNameFor(name),
            new Uint8Array(await jpeg.arrayBuffer()),
            false
        );
    } catch (e) {
        logger.warn("Could not write the clip thumbnail", e);
    } finally {
        // pause + removeAttribute rather than src = "": an empty src makes
        // Chromium resolve the page URL and fetch the app before giving up.
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
    }
}

/**
 * Waits for a frame worth showing.
 *
 * A second in, so a clip that opens on a fade is not represented by black, but
 * whatever has been decoded is taken if the seek does not land in time.
 */
function frameReady(video: HTMLVideoElement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (error?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
        };

        const timer = setTimeout(() => settle(video.readyState >= 2 ? undefined : new Error("timed out")), READY_MS);

        video.onerror = () => settle(new Error("the clip could not be decoded"));
        video.onseeked = () => settle();
        video.onloadeddata = () => {
            try {
                video.currentTime = 1;
            } catch {
                settle();
            }
        };
    });
}
