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
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { createRoot, Toasts } from "@webpack/common";

import { ClipperChatButton, ClipperIcon } from "./components/ClipperChatButton";
import { ClipperOverlay } from "./components/ClipperOverlay";
import { encoderSummary, probeEncoders } from "./encoders";
import { gameAudioReport } from "./gameAudio";
import { gameEventReport, stopGameEvents, syncGameEvents } from "./gameEvents";
import { hideGameOverlay, toggleGameOverlay, watchLastClip } from "./gameOverlay";
import { gameVideo } from "./gameVideo";
import { runShortcut, startGlobalKeybinds, stopGlobalKeybinds, syncGlobalKeybinds } from "./globalKeybinds";
import { micReport } from "./micInput";
import { SYSTEM_CHANNEL } from "./mixer";
import { installPovRequests, requestPov, uninstallPovRequests } from "./multipov";
import { logger, recorder } from "./recorder";
import { settings } from "./settings";
import { toast } from "./toasts";
import { checkAtLaunch, checkNow } from "./updater";
import { isTypingTarget, keybindMatches, keybindsSuspended, parseKeybind } from "./utils";
import { installVoiceTaps, probeVoiceTaps, uninstallVoiceTaps } from "./voiceTaps";
import { stopVr, syncVr, vrReport } from "./vr";

/*
 * In-client fallback. The same binds are registered with the OS (see
 * ./globalKeybinds), which normally swallows the key before Discord sees it;
 * this listener covers the binds the OS refused and the ones with no
 * accelerator, and `runShortcut` drops the duplicate when both paths fire.
 */
function onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;

    // A picker is open and the user is pressing the very bind it is replacing:
    // that keystroke belongs to the picker, not to the recorder.
    if (keybindsSuspended()) return;

    const { saveKeybind, toggleKeybind, markKeybind, povKeybind, replayKeybind } = settings.store;

    for (const [bind, action] of [
        [saveKeybind, "save"],
        [toggleKeybind, "toggle"],
        [markKeybind, "mark"],
        [povKeybind, "pov"],
        [replayKeybind, "replay"]
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

/**
 * Settings that something outside the settings panel has to be told about, and
 * what to tell.
 *
 * The keybinds go to the OS-level registration. The highlight watcher listens
 * to the call, and has to start or stop the moment it is asked to rather than at
 * the next start of the buffer - somebody who turns it on mid-game means now.
 */
const WATCHED: Array<readonly [string, () => void]> = [
    ["saveKeybind", () => void syncGlobalKeybinds()],
    ["toggleKeybind", () => void syncGlobalKeybinds()],
    ["markKeybind", () => void syncGlobalKeybinds()],
    ["povKeybind", () => void syncGlobalKeybinds()],
    ["replayKeybind", () => void syncGlobalKeybinds()],
    ["globalKeybinds", () => void syncGlobalKeybinds()],
    ["autoHighlight", () => recorder.syncHighlights()],
    ["gameAudioWatch", () => recorder.restartHighlights()],
    ["gameVideoWatch", () => recorder.restartHighlights()],
    ["gameIntegrations", () => void syncGameEvents()],
    ["vrControls", () => void syncVr()]
];

/**
 * Kept so the listeners can be dropped again on stop(): toggling the plugin off
 * and on otherwise stacks a new set on every start, and each settings change
 * then re-registers the binds once per stacked listener.
 */
const settingsWatchers: Array<() => void> = [];

function watchSettings() {
    unwatchSettings();

    for (const [name, act] of WATCHED) {
        const path = `plugins.Clipper.${name}` as any;
        const listener = () => {
            try {
                act();
            } catch (e) {
                logger.warn(`Could not act on a change to ${name}`, e);
            }
        };

        SettingsStore.addChangeListener(path, listener);
        settingsWatchers.push(() => SettingsStore.removeChangeListener(path, listener));
    }
}

function unwatchSettings() {
    for (const drop of settingsWatchers.splice(0)) {
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

        // A throw inside this root unmounts all of it, and nothing remounts it:
        // the panel button, the replay card and the studio would be gone for
        // the rest of the session while the recorder went on buffering behind
        // them. The boundary keeps the root alive and puts the reason on screen
        // instead of leaving an empty corner.
        overlayRoot.render(
            <ErrorBoundary message="Clipper's overlay could not be rendered. Reload the client to bring it back.">
                <ClipperOverlay />
            </ErrorBoundary>
        );
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
        "Clip everyone's angle": () => void requestPov(),
        "Edit the last clip over the game": () => void toggleGameOverlay(),
        "Watch the last clip over the game": () => void watchLastClip(),
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

                toast(summary, reports.some(r => r.ok) ? Toasts.Type.MESSAGE : Toasts.Type.FAILURE, 12000);
            })();
        },
        "Check for a new Clipper version": () => void checkNow(),
        "Check what is watching the game": () => {
            void (async () => {
                const report = [
                    settings.store.gameAudioWatch
                        ? gameAudioReport(recorder.channelSpectrum(SYSTEM_CHANNEL))
                        : "The game's sound is not being listened to: the call is in the same stream, so it stays off unless turned on.",
                    gameVideo.active ? "The picture is being watched." : "The picture is not being watched - start the clip buffer, or turn it on in the settings.",
                    await gameEventReport(),
                    // Empty unless the VR side is installed, and dropped
                    // below rather than printed as a blank line.
                    await vrReport(),
                    settings.store.voiceHighlights
                        ? "The call can mark a moment on its own."
                        : "How loud the call is counts for nothing."
                ].filter(Boolean).join("\n");

                logger.info(`Game watchers\n${report}`);

                toast(report, Toasts.Type.MESSAGE, 12000);
            })();
        },
        "Check per-person voice audio": () => {
            const report = probeVoiceTaps();
            logger.info(report);
            toast(report, Toasts.Type.MESSAGE, 8000);
        },
        "Check the microphone": () => {
            void (async () => {
                const report = await micReport();

                logger.info(`Microphone check\n${report}`);

                toast(report, Toasts.Type.MESSAGE, 12000);
            })();
        }
    },

    start() {
        migrateReloadKeybinds();

        // Before anything else opens a connection: a call already running when
        // the patch lands is invisible to it.
        installVoiceTaps();
        installPovRequests();

        logger.info("started", {
            source: settings.store.sourceName || "(none, will use the primary screen)"
        });

        window.addEventListener("keydown", onKeyDown, true);
        void startGlobalKeybinds();

        // Not tied to the buffer, unlike the other watchers: the point of the
        // controller binds is being able to start the buffer while wearing a
        // headset, which cannot work if they only exist once it is running.
        void syncVr();
        watchSettings();
        mountOverlay();

        if (settings.store.autoStart) recorder.start();

        // Not awaited: an unreachable GitHub must cost the launch nothing.
        void checkAtLaunch();
    },

    stop() {
        window.removeEventListener("keydown", onKeyDown, true);
        unwatchSettings();
        stopGlobalKeybinds();
        stopGameEvents();
        stopVr();
        hideGameOverlay();
        unmountOverlay();
        recorder.stop();
        uninstallVoiceTaps();
        uninstallPovRequests();
    }
});
