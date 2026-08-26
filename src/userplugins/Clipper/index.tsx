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
import { createRoot, Toasts } from "@webpack/common";

import { ClipperChatButton, ClipperIcon } from "./components/ClipperChatButton";
import { ClipperOverlay } from "./components/ClipperOverlay";
import { encoderSummary, probeEncoders } from "./encoders";
import { runShortcut, startGlobalKeybinds, stopGlobalKeybinds, syncGlobalKeybinds } from "./globalKeybinds";
import { micReport } from "./micInput";
import { logger, recorder } from "./recorder";
import { settings } from "./settings";
import { stopSpotifyWatch } from "./spotify";
import { checkAtLaunch, checkNow } from "./updater";
import { isTypingTarget, keybindMatches, parseKeybind } from "./utils";
import { installVoiceTaps, probeVoiceTaps, uninstallVoiceTaps } from "./voiceTaps";

/*
 * In-client fallback. The same binds are registered with the OS (see
 * ./globalKeybinds), which normally swallows the key before Discord sees it;
 * this listener covers the binds the OS refused and the ones with no
 * accelerator, and `runShortcut` drops the duplicate when both paths fire.
 */
function onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;

    const { saveKeybind, toggleKeybind, markKeybind } = settings.store;

    for (const [bind, action] of [
        [saveKeybind, "save"],
        [toggleKeybind, "toggle"],
        [markKeybind, "mark"]
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
const KEYBIND_SETTINGS = ["saveKeybind", "toggleKeybind", "markKeybind", "globalKeybinds"] as const;

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
    authors: [{ name: "yeslife", id: 0n }],
    settings,

    chatBarButton: {
        icon: ClipperIcon,
        render: ClipperChatButton
    },

    toolboxActions: {
        "Start / stop clip buffer": () => recorder.toggle(),
        "Save clip": () => recorder.save(),
        "Drop a marker": () => recorder.mark(),
        "Choose capture source": () => recorder.chooseSource(),
        "Open the clip studio": () => recorder.openStudio(),
        "Check the video encoders": () => {
            void (async () => {
                const reports = await probeEncoders();
                const summary = encoderSummary(reports);

                logger.info(`Encoder probe\n${summary}`);

                // A container that has just encoded is not broken, whatever it
                // did the last time the buffer armed: let the next start try it.
                if (reports.some(r => r.ok)) recorder.retryEncoders();

                Toasts.show({
                    id: Toasts.genId(),
                    message: summary,
                    type: reports.some(r => r.ok) ? Toasts.Type.MESSAGE : Toasts.Type.FAILURE,
                    options: { duration: 12000, position: Toasts.Position.BOTTOM }
                });
            })();
        },
        "Check for a new Clipper version": () => void checkNow(),
        "Check per-person voice audio": () => {
            const report = probeVoiceTaps();
            logger.info(report);
            Toasts.show({
                id: Toasts.genId(),
                message: report,
                type: Toasts.Type.MESSAGE,
                options: { duration: 8000, position: Toasts.Position.BOTTOM }
            });
        },
        "Check the microphone": () => {
            void (async () => {
                const report = await micReport();

                logger.info(`Microphone check\n${report}`);

                Toasts.show({
                    id: Toasts.genId(),
                    message: report,
                    type: Toasts.Type.MESSAGE,
                    options: { duration: 12000, position: Toasts.Position.BOTTOM }
                });
            })();
        }
    },

    start() {
        migrateReloadKeybinds();

        // Before anything else opens a connection: a call already running when
        // the patch lands is invisible to it.
        installVoiceTaps();

        logger.info("started", {
            source: settings.store.sourceName || "(none, will use the primary screen)"
        });

        window.addEventListener("keydown", onKeyDown, true);
        void startGlobalKeybinds();
        watchKeybindSettings();
        mountOverlay();

        if (settings.store.autoStart) recorder.start();

        // Not awaited: an unreachable GitHub must cost the launch nothing.
        void checkAtLaunch();
    },

    stop() {
        window.removeEventListener("keydown", onKeyDown, true);
        unwatchKeybindSettings();
        stopGlobalKeybinds();
        unmountOverlay();
        recorder.stop();
        uninstallVoiceTaps();
        stopSpotifyWatch();
    }
});
