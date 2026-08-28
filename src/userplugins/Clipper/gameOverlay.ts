/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - what goes over the game, from this side
 *
 * Three things, all in windows the main process owns: the editor the keybind
 * opens (./studioOverlay), the clip played in a corner (./overlayWindow) and
 * the line of text that says a clip was written. This side reads the settings,
 * decides what to open on which clip, and says once - rather than every time -
 * when the platform cannot put a window over a game at all.
 *
 * Nothing here is opened by a save. A save puts up a line of text and nothing
 * else: a video starting by itself over a game is in the way however good the
 * clip is, and the editor takes the mouse, which mid-game is worse. Both only
 * ever happen because the keybind was pressed.
 *
 * The editor's buttons come back the other way. The main process queues them,
 * this module long-polls for them exactly as it polls for keybinds, hands them
 * to ./overlayEdit and puts the answer back in the editor's status line.
 */

import type { PluginNative } from "@utils/types";
import { Toasts } from "@webpack/common";

import { readMeta } from "./library";
import { runOverlayAction } from "./overlayEdit";
// Type only, so nothing of the main process modules reaches the renderer bundle.
import type { OverlayCorner } from "./overlayWindow";
import { logger, recorder } from "./recorder";
import { settings } from "./settings";
import type { StudioAction } from "./studioOverlay";
import { formatKeybind } from "./utils";

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

/** Widths in pixels behind the three sizes offered in the settings. */
const WIDTHS: Record<string, number> = { small: 320, medium: 420, large: 560 };

/** The same three sizes for the editor, which is worked in and so is bigger. */
const EDITOR_WIDTHS: Record<string, number> = { small: 560, medium: 720, large: 900 };

function look() {
    const { overlayCorner, overlaySize, overlayVolume, overlaySeconds } = settings.store;

    return {
        // A stored value the settings panel wrote; the main process clamps it
        // back to a corner it knows either way.
        corner: overlayCorner as OverlayCorner,
        width: WIDTHS[overlaySize] ?? WIDTHS.medium,
        volume: overlayVolume,
        seconds: overlaySeconds
    };
}

function editorLook() {
    const { overlaySize, overlayVolume } = settings.store;

    return {
        width: EDITOR_WIDTHS[overlaySize] ?? EDITOR_WIDTHS.medium,
        volume: overlayVolume
    };
}

/** Said once per session: a platform limit is not news the second time. */
let warned = false;

function warnOnce(message: string): void {
    if (warned) return;
    warned = true;

    logger.warn(message);
    Toasts.show({
        id: Toasts.genId(),
        message: `Clipper: ${message}`,
        type: Toasts.Type.FAILURE
    });
}

const UNSUPPORTED = "the game overlay needs Windows, macOS or X11 - it cannot place a window over anything here";

function nothingSaved(): void {
    Toasts.show({
        id: Toasts.genId(),
        message: "Clipper: no clip has been saved yet",
        type: Toasts.Type.MESSAGE
    });
}

/** Plays a clip over whatever is on screen. Asked for, never offered. */
export async function showGameOverlay(name: string): Promise<void> {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;
    if (!name) return;

    try {
        const shown = await Native.showClipOverlay(settings.store.saveDirectory, name, look());
        if (!shown) warnOnce(UNSUPPORTED);
    } catch (e) {
        logger.warn("Could not show the clip over the game", e);
    }
}

/** Plays the last clip in a corner: the toolbox entry, not the keybind. */
export async function watchLastClip(): Promise<void> {
    const clip = recorder.lastClip;
    if (!clip) {
        nothingSaved();
        return;
    }

    await showGameOverlay(clip.name);
}

/**
 * Opens the editor over the game, on a clip.
 *
 * The markers come from the library when the clip has been tagged, and from the
 * recorder when it was saved a moment ago and nothing has read the file back
 * yet; they are the ticks under the scrub bar.
 */
export async function openClipEditor(name: string): Promise<void> {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;
    if (!name) return;

    let markers: number[] = [];
    try {
        markers = (await readMeta())[name]?.markers ?? [];
    } catch (e) {
        logger.warn("Could not read the markers of that clip", e);
    }

    if (!markers.length && recorder.lastClip?.name === name) markers = recorder.lastClip.markers ?? [];

    try {
        const shown = await Native.openStudioOverlay(settings.store.saveDirectory, name, markers, editorLook());
        if (!shown) {
            warnOnce(UNSUPPORTED);
            return;
        }

        startPump();
    } catch (e) {
        logger.warn("Could not open the editor over the game", e);
    }
}

/**
 * The keybind: opens the editor on the last clip, or closes the open one.
 *
 * Closing it is what gives the pointer back to the game, so one key does both
 * ways of the same thing.
 */
export async function toggleGameOverlay(): Promise<void> {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    try {
        if (await Native.studioOverlayUp()) {
            hideGameOverlay();
            return;
        }
    } catch (e) {
        logger.warn("Could not ask whether the editor is open", e);
    }

    const clip = recorder.lastClip;
    if (!clip) {
        nothingSaved();
        return;
    }

    await openClipEditor(clip.name);
}

/**
 * Takes the clip playing in the corner down, and nothing else.
 *
 * For the replay card: dismissing it in Discord means the clip it was about is
 * done with, not that an editor somebody opened over their game should shut.
 */
export function hideClipPlayback(): void {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    Native.hideClipOverlay().catch(e => logger.warn("Could not take the clip overlay down", e));
}

/** Takes down everything this plugin has over the game, editor included. */
export function hideGameOverlay(): void {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    stopPump();

    Native.hideClipOverlay().catch(e => logger.warn("Could not take the clip overlay down", e));
    Native.closeStudioOverlay().catch(e => logger.warn("Could not close the editor over the game", e));
    Native.dropOverlayWaiters().catch(() => undefined);
}

/*
 * The editor's buttons, coming back.
 *
 * Same shape as the keybind pump in ./globalKeybinds: each call parks in the
 * main process until the editor asks for something, so an open editor nobody is
 * touching costs nothing. The loop only runs while the editor is up.
 */

/** Bumped on every stop, so a loop left over from a previous editor exits. */
let generation = 0;
let running = false;

function startPump(): void {
    if (running) return;

    running = true;
    void pump(++generation);
}

function stopPump(): void {
    generation++;
    running = false;
}

async function pump(mine: number): Promise<void> {
    while (mine === generation) {
        let action: StudioAction | null = null;

        try {
            action = await Native.waitForOverlayAction();
        } catch (e) {
            logger.warn("The overlay editor listener failed", e);
            break;
        }

        if (mine !== generation) return;

        if (!action) {
            // A timeout with the window gone is the editor having been closed
            // from the page or by the keybind, and the end of the loop.
            try {
                if (!await Native.studioOverlayUp()) break;
            } catch {
                break;
            }

            continue;
        }

        const outcome = await runOverlayAction(action);

        try {
            await Native.answerOverlayAction(outcome.ok, outcome.message, outcome.close);
        } catch (e) {
            logger.warn("Could not answer the overlay editor", e);
        }

        if (mine !== generation) return;

        // The editor takes itself down a moment after an answer that says so,
        // and there is nothing left to poll for once it has.
        if (outcome.close) {
            stopPump();
            return;
        }

        // A cut replaces the file the editor was showing, so it reopens on what
        // is now there rather than on a name that no longer exists.
        if (outcome.next) await openClipEditor(outcome.next);
    }

    if (mine === generation) running = false;
}

/**
 * Puts one line of text over the game, for a couple of seconds.
 *
 * Deliberately never a video: this is somebody in the middle of a game who
 * wants to know something happened, not somebody wanting to watch anything.
 * The main process drops it while the client is the window in front, so it is
 * only ever seen by somebody who cannot see Discord - which is the whole of
 * the reason it exists.
 */
export function notifyOverlay(title: string, note: string): void {
    if (!settings.store.overlayNotice) return;
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    Native.notifyClipSaved(title, note, settings.store.overlayCorner)
        .catch(e => logger.warn("Could not put a notice over the game", e));
}

/** Says that a clip was written. */
export function notifySaved(name: string): void {
    // The clip name when there is no bind to name: "Unbound to edit it" is what
    // formatting an empty bind would otherwise put on screen.
    const bind = settings.store.replayKeybind;

    notifyOverlay("Clip saved", bind ? `${formatKeybind(bind)} to edit it` : name);
}
