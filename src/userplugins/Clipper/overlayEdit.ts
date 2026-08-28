/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - doing what the overlay editor asked for
 *
 * The editor over the game is a page in a window of its own: it can play a clip
 * and pick a range out of it, and that is the end of what it can do by itself.
 * Cutting needs the library, sending needs Discord's uploader and the studio is
 * a React tree in this client, so its buttons come back here and this module is
 * what actually runs them.
 *
 * One function per button, all with the same answer: what to put in the status
 * line, whether the editor should go away, and which clip it should reopen on
 * when the file it was showing is no longer the right one.
 */

import type { PluginNative } from "@utils/types";

import { deleteClip, readClipBytes, typeOfClip, writeClipBytes } from "./clips";
import { dropMeta, readMeta, setMeta } from "./library";
import { logger, recorder } from "./recorder";
import { trimBytes } from "./repair";
import { sendClipRange } from "./send";
import type { StudioAction } from "./studioOverlay";
import { errorMessage } from "./utils";

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

/** What the editor is told once the button it sent has been dealt with. */
interface Outcome {
    ok: boolean;
    /** One line for the status bar under the buttons. */
    message: string;
    /** Whether the editor should close: what it was showing has moved on. */
    close: boolean;
    /** A clip to reopen the editor on, when the cut replaced the one it had. */
    next?: string;
}

/**
 * Cuts the clip down to the selection.
 *
 * Container-level, so it is a copy rather than a re-encode and the footage kept
 * is the same bytes. The cut is written next to the original and the original
 * goes to the trash - the same trash the library deletes into, so a cut that
 * took too much is undoable from the desktop rather than only regrettable.
 */
async function cut(action: StudioAction): Promise<Outcome> {
    const { clip, from, to } = action;

    // Bytes the whole way: read once, cut in place, write what came back. A
    // clip is hundreds of megabytes and every Blob in between is a copy of it.
    const data = await readClipBytes(clip);
    const trimmed = trimBytes(data, typeOfClip(clip), from, to);

    // Nothing came back: the parser found nothing to take off, which for a
    // selection already covering the clip is the right answer.
    if (!trimmed) return { ok: false, message: "Nothing could be cut off that clip", close: false };

    const stem = clip.replace(/\.[^.]+$/, "");
    const extension = clip.split(".").pop() || "webm";

    const path = await writeClipBytes(trimmed, `${stem}-cut.${extension}`);
    const saved = path.split(/[\\/]/).pop() || clip;

    // The markers move with the footage. The cut lands on the keyframe at or
    // before the in point, so a marker can end up a keyframe early; near enough
    // to find the play again, which is all they are for.
    const meta = (await readMeta())[clip];
    const markers = (meta?.markers ?? [])
        .map(at => at - from)
        .filter(at => at >= 0 && at <= to - from);

    await setMeta(saved, {
        game: meta?.game ?? "",
        tags: meta?.tags,
        markers,
        taggedAt: Date.now()
    });

    // Only once the replacement is safely on disk.
    try {
        await deleteClip(clip);
        await dropMeta(clip);
        recorder.forgetSaved(clip);
    } catch (e) {
        logger.warn("Could not remove the clip that was cut", e);
    }

    return { ok: true, message: `Cut to ${Math.round(to - from)}s`, close: false, next: saved };
}

/** Puts the selection in the message box of the channel that is open. */
async function send(action: StudioAction): Promise<Outcome> {
    const sent = await sendClipRange(action.clip, action.from, action.to);

    // Deliberately not stealing the focus: whoever is playing decides when to
    // go and press send, and the upload waits in the box until they do.
    return sent
        ? { ok: true, message: "Attached in Discord - alt-tab to send it", close: false }
        : { ok: false, message: "Could not attach it - open a channel first", close: false };
}

/** Throws the clip away, wholesale. The editor has nothing left to show. */
async function drop(action: StudioAction): Promise<Outcome> {
    await deleteClip(action.clip);
    await dropMeta(action.clip);
    recorder.forgetSaved(action.clip);

    return { ok: true, message: "Clip deleted", close: true };
}

/** Hands the clip to the real studio, and the screen back to Discord. */
async function open(action: StudioAction): Promise<Outcome> {
    // The studio is a window of the client, so the client has to be in front of
    // the game before opening it is worth anything.
    await Native.focusClient();
    recorder.openStudio(action.clip);

    return { ok: true, message: "Opening the studio in Discord", close: true };
}

const DOERS: Record<StudioAction["kind"], (action: StudioAction) => Promise<Outcome>> = {
    cut,
    send,
    delete: drop,
    open
};

/**
 * Runs one thing the editor asked for.
 *
 * Never throws: the editor is a window over a game, and the only useful thing
 * to do with a failure there is to write it in the status line.
 */
export async function runOverlayAction(action: StudioAction): Promise<Outcome> {
    if (!action.clip) return { ok: false, message: "That clip is gone", close: true };

    try {
        return await DOERS[action.kind](action);
    } catch (e) {
        logger.error(`Overlay editor could not ${action.kind} the clip`, e);
        return { ok: false, message: errorMessage(e), close: false };
    }
}
