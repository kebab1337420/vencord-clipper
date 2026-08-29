/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the last clip, from the attach menu
 *
 * The clip that is worth posting is nearly always the one that was just saved,
 * and posting it meant leaving the conversation: open the studio or the folder,
 * find the newest file by its timestamp, drag it back. This puts it one entry
 * down from the + on the message box, next to uploading a file, which is where
 * somebody about to post a video already has their hand.
 *
 * It attaches rather than sends, like everything else in ./send: the caption
 * and the channel stay the user's, and a clip too big for the account is
 * re-encoded down to the limit on the way instead of being refused.
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu, PermissionsBits, PermissionStore, Toasts } from "@webpack/common";

import { CLIPS_AVAILABLE, listClips } from "./clips";
import { ClipperIcon } from "./components/ClipperChatButton";
import { logger, recorder } from "./recorder";
import { sendClipFitted } from "./send";
import { toast } from "./toasts";

/**
 * Newest clip in the folder, as of the last time it was asked for.
 *
 * The listing crosses IPC and the menu is built synchronously, so it cannot be
 * read while the entry is being drawn. It is read on the click instead, and
 * this only holds the answer between one click and the next.
 */
let newest: string | null = null;
/** Whether a listing is already in flight, so a double click asks once. */
let looking = false;

async function refreshNewest(): Promise<string | null> {
    if (!CLIPS_AVAILABLE || looking) return newest;

    looking = true;
    try {
        const clips = await listClips();
        newest = clips[0]?.name ?? null;
    } catch (e) {
        logger.warn("Could not look up the last clip", e);
    } finally {
        looking = false;
    }

    return newest;
}

/**
 * Attaches the newest clip there is.
 *
 * The folder is the authority rather than this session's last save: a render
 * out of the studio, or a clip taken before the client was restarted, is just
 * as much the last clip as one saved a minute ago. What was saved here is the
 * fallback for a folder that cannot be listed at all.
 */
async function sendLastClip(): Promise<void> {
    const name = (await refreshNewest()) ?? recorder.lastClip?.name ?? null;

    if (!name) {
        toast("No clip saved yet", Toasts.Type.FAILURE);
        return;
    }

    // A clip that fits is attached in one step and says nothing; only the
    // re-encode is slow enough to be worth narrating.
    await sendClipFitted(name, step => toast(step, Toasts.Type.MESSAGE));
}

/** The entry itself, added to the menu behind the + on the message box. */
export const attachMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!CLIPS_AVAILABLE) return;

    const channel = (props as { channel?: any; })?.channel;

    // Nothing is offered where it would only fail: a guild channel the account
    // may not post files in refuses the upload after the fact, which reads as
    // the plugin being broken.
    if (channel?.guild_id && !(
        PermissionStore.can(PermissionsBits.ATTACH_FILES, channel)
        && PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel)
    )) return;

    children.push(
        <Menu.MenuItem
            id="vc-clipper-send-last"
            label="Send the last clip"
            iconLeft={ClipperIcon}
            leadingAccessory={{
                type: "icon",
                icon: ClipperIcon
            }}
            action={() => void sendLastClip()}
        />
    );
};
