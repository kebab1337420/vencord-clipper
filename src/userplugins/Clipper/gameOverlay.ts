/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the clip played over the game, from this side
 *
 * The windows themselves live in the main process (see ./overlayWindow); this
 * reads the settings, decides what to show and says once, rather than every
 * time, when the platform cannot do it at all.
 *
 * A clip only ever plays because the keybind was pressed. A save puts up a line
 * of text and nothing else: a video starting by itself over a game is in the
 * way, however good the clip is.
 */

import type { PluginNative } from "@utils/types";
import { Toasts } from "@webpack/common";

// Type only, so nothing of the main process module reaches the renderer bundle.
import type { OverlayCorner } from "./overlayWindow";
import { logger, recorder } from "./recorder";
import { settings } from "./settings";
import { formatKeybind } from "./utils";

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

/** Widths in pixels behind the three sizes offered in the settings. */
const WIDTHS: Record<string, number> = { small: 320, medium: 420, large: 560 };

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

/** The keybind: puts the last clip up, or takes down what is up. */
export async function toggleGameOverlay(): Promise<void> {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    const clip = recorder.lastClip;
    if (!clip) {
        Toasts.show({
            id: Toasts.genId(),
            message: "Clipper: no clip has been saved yet",
            type: Toasts.Type.MESSAGE
        });
        return;
    }

    try {
        const shown = await Native.toggleClipOverlay(settings.store.saveDirectory, clip.name, look());
        if (!shown && !warned) {
            // False also means "it was up and is now down", so the platform is
            // asked rather than assumed.
            const { overlay } = await Native.getPlatformInfo();
            if (!overlay) warnOnce(UNSUPPORTED);
        }
    } catch (e) {
        logger.warn("Could not toggle the clip over the game", e);
    }
}

/** Takes the overlay down, wherever it was asked from. */
export function hideGameOverlay(): void {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    Native.hideClipOverlay().catch(e => logger.warn("Could not take the clip overlay down", e));
}

/**
 * Says that a clip was written, over the game, for a couple of seconds.
 *
 * Deliberately not the clip itself: this is somebody in the middle of a game
 * who wants to know the save worked, not somebody wanting to watch anything.
 * The main process drops it when the client is the window in front.
 */
export function notifySaved(name: string): void {
    if (!settings.store.overlayNotice) return;
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    // The clip name when there is no bind to name: "Unbound to watch it" is
    // what formatting an empty bind would otherwise put on screen.
    const bind = settings.store.replayKeybind;
    const note = bind ? `${formatKeybind(bind)} to watch it` : name;

    Native.notifyClipSaved("Clip saved", note, settings.store.overlayCorner)
        .catch(e => logger.warn("Could not say that the clip was saved", e));
}
