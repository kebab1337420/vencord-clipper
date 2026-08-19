/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - settings definition
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { KeybindInput } from "./components/KeybindInput";
import { SaveDirectoryInput } from "./components/SaveDirectoryInput";

export const enum Container {
    WebmVp9 = "webm-vp9",
    WebmVp8 = "webm-vp8",
    Mp4H264 = "mp4-h264"
}

export const settings = definePluginSettings({
    autoStart: {
        type: OptionType.BOOLEAN,
        description: "Start the capture buffer as soon as Discord launches (asks for a source once)",
        default: false
    },
    clipLength: {
        type: OptionType.SLIDER,
        description: "Clip length in seconds (how far back the buffer keeps footage)",
        markers: [10, 15, 30, 60, 90, 120, 180, 300],
        default: 30,
        stickToMarkers: true
    },
    fps: {
        type: OptionType.SELECT,
        description: "Capture frame rate",
        options: [
            { label: "24 FPS", value: 24 },
            { label: "30 FPS", value: 30, default: true },
            { label: "60 FPS", value: 60 },
            { label: "120 FPS", value: 120 }
        ]
    },
    resolution: {
        type: OptionType.SELECT,
        description: "Capture resolution (height). 'Source' keeps the native size",
        options: [
            { label: "Source", value: 0, default: true },
            { label: "2160p", value: 2160 },
            { label: "1440p", value: 1440 },
            { label: "1080p", value: 1080 },
            { label: "720p", value: 720 },
            { label: "480p", value: 480 }
        ]
    },
    videoBitrate: {
        type: OptionType.SLIDER,
        description: "Video quality in Mbps (higher = better image, bigger file)",
        markers: [1, 2, 4, 6, 8, 12, 16, 24, 32, 50],
        default: 8,
        stickToMarkers: true
    },
    audioBitrate: {
        type: OptionType.SLIDER,
        description: "Audio quality in kbps",
        markers: [64, 96, 128, 160, 192, 256, 320],
        default: 128,
        stickToMarkers: true
    },
    container: {
        type: OptionType.SELECT,
        description: "Container / codec. VP9 is the safest, MP4 needs a recent Discord build",
        options: [
            { label: "WebM (VP9) - recommended", value: Container.WebmVp9, default: true },
            { label: "WebM (VP8) - fastest, larger files", value: Container.WebmVp8 },
            { label: "MP4 (H.264) - best compatibility", value: Container.Mp4H264 }
        ]
    },
    includeMic: {
        type: OptionType.BOOLEAN,
        description: "Mix your microphone into the clip audio",
        default: false
    },
    saveDirectory: {
        type: OptionType.CUSTOM,
        default: ""
    },
    saveDirectoryInput: {
        type: OptionType.COMPONENT,
        component: SaveDirectoryInput
    },
    notifications: {
        type: OptionType.BOOLEAN,
        description: "Show a desktop notification when a clip is saved",
        default: true
    },
    panelButton: {
        type: OptionType.BOOLEAN,
        description: "Show a Clipper button next to the mic / deafen buttons",
        default: true,
        restartNeeded: true
    },
    // Remembered capture source, set from the picker. Hidden from the settings UI.
    sourceId: {
        type: OptionType.CUSTOM,
        default: ""
    },
    sourceName: {
        type: OptionType.CUSTOM,
        default: ""
    },
    globalKeybinds: {
        type: OptionType.BOOLEAN,
        description: "Register the keybinds system-wide, so they also fire while you are in a game. Turn off to keep them Discord-only",
        default: true
    },
    saveKeybind: {
        type: OptionType.COMPONENT,
        default: "alt+F10",
        component: () => (
            <KeybindInput
                title="Save clip keybind"
                note="Saves the buffered footage to a file. Registered system-wide, so it fires from inside a game too. Avoid Ctrl+R and Ctrl+Shift+R: Electron reloads the client on those before the plugin sees them."
                value={settings.store.saveKeybind}
                onChange={v => (settings.store.saveKeybind = v)}
            />
        )
    },
    toggleKeybind: {
        type: OptionType.COMPONENT,
        default: "alt+F9",
        component: () => (
            <KeybindInput
                title="Start / stop capture keybind"
                note="Starts the rolling buffer or stops it. Registered system-wide too."
                value={settings.store.toggleKeybind}
                onChange={v => (settings.store.toggleKeybind = v)}
            />
        )
    }
});

/** Resolves the configured container to a list of mime types, best first. */
export function mimeCandidates(container: string): string[] {
    switch (container) {
        case Container.Mp4H264:
            return [
                "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
                "video/mp4;codecs=avc1,opus",
                "video/mp4"
            ];
        case Container.WebmVp8:
            return ["video/webm;codecs=vp8,opus", "video/webm"];
        case Container.WebmVp9:
        default:
            return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    }
}

export function extensionFor(mimeType: string): string {
    return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}
