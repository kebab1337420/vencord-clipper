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
 */

import { getCurrentChannel } from "@utils/discord";
import { DraftType, Toasts, UploadHandler } from "@webpack/common";

import { CLIPS_AVAILABLE, loadClipFile } from "./clips";
import { logger } from "./recorder";
import { formatBytes } from "./utils";

/**
 * Largest attachment a plain account may send.
 *
 * Nitro raises it, and the client knows the real number, but reading it out of
 * the store is fragile and being wrong the safe way costs nothing: the check
 * only decides whether to warn, the upload is attempted either way.
 */
const FREE_LIMIT = 10 * 1024 * 1024;

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

/** Attaches a saved clip, by name, to the channel that is open. */
export async function sendClip(name: string): Promise<boolean> {
    if (!CLIPS_AVAILABLE) {
        toast("Clips are only readable in the desktop client", Toasts.Type.FAILURE);
        return false;
    }

    try {
        return attach(await loadClipFile(name));
    } catch (e) {
        logger.error("Could not attach the clip", e);
        toast("Could not read that clip", Toasts.Type.FAILURE);
        return false;
    }
}

function toast(message: string, type: string) {
    Toasts.show({ id: Toasts.genId(), message, type });
}
