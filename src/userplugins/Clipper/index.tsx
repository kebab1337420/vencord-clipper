/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper
 * Shadowplay-style clipping inside Discord: a rolling buffer of the last N
 * seconds that you dump to a file with a keybind or the chat bar button.
 */

import { SettingsStore } from "@api/Settings";
import definePlugin from "@utils/types";
import { createRoot } from "@webpack/common";

import { ClipperChatButton, ClipperIcon } from "./components/ClipperChatButton";
import { ClipperOverlay } from "./components/ClipperOverlay";
import { runShortcut, startGlobalKeybinds, stopGlobalKeybinds, syncGlobalKeybinds } from "./globalKeybinds";
import { logger, recorder } from "./recorder";
import { settings } from "./settings";
import { isTypingTarget, keybindMatches, parseKeybind } from "./utils";

/*
 * In-client fallback. The same binds are registered with the OS (see
 * ./globalKeybinds), which normally swallows the key before Discord sees it;
 * this listener covers the binds the OS refused and the ones with no
 * accelerator, and `runShortcut` drops the duplicate when both paths fire.
 */
function onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;

    const { saveKeybind, toggleKeybind } = settings.store;

    for (const [bind, action] of [
        [saveKeybind, "save"],
        [toggleKeybind, "toggle"]
    ] as const) {
        if (!keybindMatches(bind, e)) continue;

        // A bare key must not fire while the user is writing a message.
        const parsed = parseKeybind(bind)!;
        const bare = !parsed.ctrl && !parsed.shift && !parsed.alt && !parsed.meta;
        if (bare && isTypingTarget()) continue;

        e.preventDefault();
        e.stopPropagation();
        runShortcut(action);
        return;
    }
}

/** Keeps the OS-level binds in sync with what the settings hold. */
const KEYBIND_SETTINGS = ["saveKeybind", "toggleKeybind", "globalKeybinds"] as const;

/**
 * Kept so the listeners can be dropped again on stop(): toggling the plugin off
 * and on otherwise stacks a new set on every start, and each settings change
 * then re-registers the binds once per stacked listener.
 */
const keybindWatchers: Array<() => void> = [];

function watchKeybindSettings() {
    unwatchKeybindSettings();

    for (const name of KEYBIND_SETTINGS) {
        const path = `plugins.Clipper.${name}` as any;
        const listener = () => void syncGlobalKeybinds();

        SettingsStore.addChangeListener(path, listener);
        keybindWatchers.push(() => SettingsStore.removeChangeListener(path, listener));
    }
}

function unwatchKeybindSettings() {
    for (const drop of keybindWatchers.splice(0)) {
        try {
            drop();
        } catch (e) {
            logger.warn("Could not drop a settings listener", e);
        }
    }
}

/**
 * Chromium reloads the client on Ctrl+R / Ctrl+Shift+R before any DOM listener
 * runs, so those binds can never reach the plugin. Move anyone still on the old
 * defaults over to the new ones.
 */
function migrateReloadKeybinds() {
    if (settings.store.toggleKeybind === "ctrl+shift+KeyR") settings.store.toggleKeybind = "alt+F9";
    if (settings.store.saveKeybind === "ctrl+shift+KeyS") settings.store.saveKeybind = "alt+F10";
}

/*
 * The overlay lives in its own React root attached to <body>, outside Discord's
 * tree. Patching the account panel put the plugin inside Discord's render, so
 * any error here reloaded the whole client; here it cannot.
 */
let overlayRoot: { render(node: any): void; unmount(): void; } | null = null;
let overlayElement: HTMLElement | null = null;

function mountOverlay() {
    try {
        unmountOverlay();

        overlayElement = document.createElement("div");
        overlayElement.id = "vc-clipper-overlay";
        document.body.appendChild(overlayElement);

        overlayRoot = createRoot(overlayElement);
        overlayRoot.render(<ClipperOverlay />);
    } catch (e) {
        logger.error("Could not mount the overlay", e);
    }
}

function unmountOverlay() {
    try {
        overlayRoot?.unmount();
    } catch (e) {
        logger.warn("Overlay unmount failed", e);
    }
    overlayRoot = null;
    overlayElement?.remove();
    overlayElement = null;
}

export default definePlugin({
    name: "Clipper",
    description: "Keeps the last seconds of a captured source in memory and saves them to a clip on a keybind, with configurable length, FPS, resolution and bitrate.",
    authors: [{ name: "Alaric", id: 0n }],
    settings,

    chatBarButton: {
        icon: ClipperIcon,
        render: ClipperChatButton
    },

    toolboxActions: {
        "Start / stop clip buffer": () => recorder.toggle(),
        "Save clip": () => recorder.save(),
        "Choose capture source": () => recorder.chooseSource(),
        "Open the clip studio": () => recorder.openStudio()
    },

    start() {
        migrateReloadKeybinds();
        logger.info("started", {
            source: settings.store.sourceName || "(none, will use the primary screen)"
        });

        window.addEventListener("keydown", onKeyDown, true);
        void startGlobalKeybinds();
        watchKeybindSettings();
        mountOverlay();

        if (settings.store.autoStart) recorder.start();
    },

    stop() {
        window.removeEventListener("keydown", onKeyDown, true);
        unwatchKeybindSettings();
        stopGlobalKeybinds();
        unmountOverlay();
        recorder.stop();
    }
});
