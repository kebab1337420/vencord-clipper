/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - sending a clip to the channel that is open
 *
 * Saving a clip and posting it are almost always the same intention, and the
 * gap between them is a file picker, a folder to find again and a drag. This
 * puts the clip in the message box instead: the upload is not sent, it is
 * attached, so the caption and the channel are still the user's to change.
 *
 * A clip that is too big to send is the other half of the same gap. Discord's
 * answer is to refuse it, which leaves the moment on disk, so this one re-encodes
 * it down to the limit first - or, when what is wanted is the three seconds
 * everyone will quote back, turns it into a GIF instead.
 */

import { getCurrentChannel } from "@utils/discord";
import { DraftType, Toasts, UploadHandler } from "@webpack/common";

import { CLIPS_AVAILABLE, loadClipFile, readClipBytes, typeOfClip } from "./clips";
import { clipToGif, type GifRequest, saveGif } from "./gifExport";
import { logger } from "./recorder";
import { trimBytes } from "./repair";
import { shrinkVideo } from "./shrink";
import { formatBytes } from "./utils";

/**
 * Largest attachment a plain account may send.
 *
 * Nitro raises it, and the client knows the real number, but reading it out of
 * the store is fragile and being wrong the safe way costs nothing: the check
 * only decides whether to warn, the upload is attempted either way.
 */
export const FREE_LIMIT = 10 * 1024 * 1024;

function attach(file: File): boolean {
    const channel = getCurrentChannel();
    if (!channel) {
        toast("Open a channel first", Toasts.Type.FAILURE);
        return false;
    }

    if (file.size > FREE_LIMIT) {
        toast(`That clip is ${formatBytes(file.size)}; Discord may refuse it`, Toasts.Type.MESSAGE);
    }

    UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage);
    return true;
}

/** A step of a long job, for a caller that has somewhere to show it. */
export type Progress = (step: string) => void;

function toast(message: string, type: string) {
    Toasts.show({ id: Toasts.genId(), message, type });
}

/**
 * Attaches part of a clip, leaving the file on disk alone.
 *
 * The handles in the overlay over the game are a selection rather than an edit:
 * what lands in the message box is the range that was picked, and the clip in
 * the library is still the whole thing. The cut is lossless and happens in
 * memory, so nothing is written and nothing is re-encoded.
 */
export async function sendClipRange(name: string, from: number, to: number): Promise<boolean> {
    if (!CLIPS_AVAILABLE) {
        toast("Clips are only readable in the desktop client", Toasts.Type.FAILURE);
        return false;
    }

    try {
        const type = typeOfClip(name);
        const data = await readClipBytes(name);
        const cut = trimBytes(data, type, from, to);

        // Nothing back: the range covers the clip, or this container is not one
        // the parser knows. Either way the whole file is the right answer.
        if (!cut) return attach(new File([data as BlobPart], name, { type }));

        const stem = name.replace(/\.[^.]+$/, "");
        const extension = name.split(".").pop() || "webm";

        return attach(new File([cut as BlobPart], `${stem}-cut.${extension}`, { type }));
    } catch (e) {
        logger.error("Could not attach the selection", e);
        toast("Could not read that clip", Toasts.Type.FAILURE);
        return false;
    }
}

/**
 * Attaches a clip, making it fit first when it does not.
 *
 * The re-encode runs in real time, so the size is checked before anything is
 * started: most clips are already small enough and the only honest thing to do
 * with those is attach them untouched.
 */
export async function sendClipFitted(name: string, onProgress?: Progress): Promise<boolean> {
    if (!CLIPS_AVAILABLE) {
        toast("Clips are only readable in the desktop client", Toasts.Type.FAILURE);
        return false;
    }

    try {
        const file = await loadClipFile(name);
        if (file.size <= FREE_LIMIT) return attach(file);

        onProgress?.("Too big to send - re-encoding");

        const url = URL.createObjectURL(file);
        try {
            const result = await shrinkVideo(url, { limit: FREE_LIMIT, onProgress });
            const stem = name.replace(/\.(webm|mp4)$/i, "");
            const ext = result.mimeType.startsWith("video/mp4") ? "mp4" : "webm";

            if (!result.fits) {
                toast(`Smallest this clip goes is ${formatBytes(result.blob.size)}`, Toasts.Type.MESSAGE);
            }

            return attach(new File([result.blob], `${stem}-small.${ext}`, { type: result.mimeType }));
        } finally {
            URL.revokeObjectURL(url);
        }
    } catch (e) {
        logger.error("Could not fit the clip", e);
        toast("Could not re-encode that clip", Toasts.Type.FAILURE);
        return false;
    }
}

/**
 * Turns part of a clip into a GIF, keeps it next to the clips, and attaches it.
 *
 * Both, rather than either: a GIF is made to be posted, and one that only landed
 * in the message box is gone the moment the box is cleared.
 */
export async function sendClipGif(name: string, request: GifRequest = {}): Promise<boolean> {
    if (!CLIPS_AVAILABLE) {
        toast("Clips are only readable in the desktop client", Toasts.Type.FAILURE);
        return false;
    }

    try {
        const result = await clipToGif(name, { limit: FREE_LIMIT, ...request });
        const saved = await saveGif(name, result.blob);

        toast(
            `GIF ready: ${result.width}px, ${result.fps}fps, ${formatBytes(result.blob.size)}`,
            result.fits ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
        );

        return attach(new File([result.blob], saved, { type: typeOfClip(saved) }));
    } catch (e) {
        logger.error("Could not make a GIF", e);
        toast("Could not make a GIF of that clip", Toasts.Type.FAILURE);
        return false;
    }
}
