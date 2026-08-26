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

import { ClipSoundInput } from "./components/ClipSoundInput";
import { KeybindInput } from "./components/KeybindInput";
import { SaveDirectoryInput } from "./components/SaveDirectoryInput";
import { SettingsSection } from "./components/SettingsSection";
import { UpdateStatus } from "./components/UpdateStatus";

export const enum Container {
    WebmVp9 = "webm-vp9",
    WebmVp8 = "webm-vp8",
    Mp4H264 = "mp4-h264"
}

export const settings = definePluginSettings({
    /*
     * Capture and audio settings live in the clip studio and in the source
     * picker, which is where they are actually needed. Kept here as stored
     * values only, so the panel does not show the same knobs twice.
     */
    autoStart: {
        type: OptionType.BOOLEAN,
        description: "Start the capture buffer as soon as Discord launches, on the remembered source (the primary screen when none was picked)",
        default: false
    },
    clipLength: {
        type: OptionType.CUSTOM,
        default: 30
    },
    fps: {
        type: OptionType.CUSTOM,
        default: 30
    },
    resolution: {
        type: OptionType.CUSTOM,
        default: 0
    },
    videoBitrate: {
        type: OptionType.CUSTOM,
        default: 8
    },
    container: {
        type: OptionType.CUSTOM,
        default: Container.Mp4H264
    },
    /*
     * Containers whose encoder failed on this client, against the build they
     * failed on: `{ build, mimes }`. Read and written by ./recorder, which is
     * where the reasoning lives.
     */
    brokenEncoders: {
        type: OptionType.CUSTOM,
        default: {}
    },
    /*
     * Containers whose encoder works here only on a capture redrawn into a
     * canvas, against the build that needed it: `{ build, mimes }`. Same shape
     * and same owner as the list above.
     */
    relayEncoders: {
        type: OptionType.CUSTOM,
        default: {}
    },
    includeMic: {
        type: OptionType.CUSTOM,
        default: false
    },
    micGate: {
        type: OptionType.BOOLEAN,
        description: "Record the microphone only while Discord would be transmitting it: above the input sensitivity, and never while you are muted in Discord. Off records everything the microphone hears, the room and the speakers included",
        default: true
    },
    audioBitrate: {
        type: OptionType.CUSTOM,
        default: 128
    },
    // Per-channel levels of the recording mix. Edited through the studio mixer.
    audioMixer: {
        type: OptionType.CUSTOM,
        // Left empty on purpose: `readMixer` fills in every missing level, and
        // importing the defaults here would close a cycle with ./mixer.
        default: {}
    },
    /**
     * Sounds and pictures kept for reuse across montages.
     *
     * Paths, not bytes: a sound effect lives wherever the user keeps it, and
     * copying a megabyte of samples into the settings file for every entry
     * would be both slow to read and impossible to keep in sync with the file
     * itself. Validated by ./assets, which is also where the shape lives.
     */
    assetLibrary: {
        type: OptionType.CUSTOM,
        default: {}
    },
    clipsSection: {
        type: OptionType.COMPONENT,
        component: () => (
            <SettingsSection
                title="Clips"
                note="Where the files land, and what happens once one is written."
            />
        )
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
    clipSound: {
        type: OptionType.BOOLEAN,
        description: "Play a sound the moment a clip is taken. It is the only feedback that reaches you inside a fullscreen game, and it is kept out of the clip itself: the recording mutes the machine's own sound for exactly as long as the tone lasts",
        default: true
    },
    // Absolute path of a custom clip sound. Empty means the built-in blip.
    clipSoundPath: {
        type: OptionType.CUSTOM,
        default: ""
    },
    clipSoundVolume: {
        type: OptionType.CUSTOM,
        default: 70
    },
    clipSoundInput: {
        type: OptionType.COMPONENT,
        component: ClipSoundInput
    },
    interfaceSection: {
        type: OptionType.COMPONENT,
        component: () => (
            <SettingsSection title="Interface" />
        )
    },
    nativeEngine: {
        type: OptionType.BOOLEAN,
        description: "Record through Discord's own clip engine when it can (needs the Clips experiment and a window as the source). It keeps one audio track per person in the file instead of one mixed track, which is the only way a mute can remove somebody and leave the others talking. The plugin's own buffer keeps running underneath, so a clip is never lost if the engine refuses",
        default: true
    },
    panelButton: {
        type: OptionType.BOOLEAN,
        description: "Show the floating Clipper button above the account panel (left click: pick a source, right click: start / stop / save)",
        default: true
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
    keybindsSection: {
        type: OptionType.COMPONENT,
        component: () => (
            <SettingsSection
                title="Keybinds"
                note="Registered with the OS, so they fire from inside a game."
            />
        )
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
    },
    markKeybind: {
        type: OptionType.COMPONENT,
        default: "alt+F11",
        component: () => (
            <KeybindInput
                title="Drop a marker keybind"
                note="Notes the moment without saving anything. Every marker inside the clip you save afterwards shows up on the studio timeline, so you can find the play again without scrubbing for it."
                value={settings.store.markKeybind}
                onChange={v => (settings.store.markKeybind = v)}
            />
        )
    },
    updatesSection: {
        type: OptionType.COMPONENT,
        component: () => (
            <SettingsSection
                title="Updates"
                note="The plugin is installed as a finished bundle, so it checks for a newer one itself."
            />
        )
    },
    updateStatus: {
        type: OptionType.COMPONENT,
        component: UpdateStatus
    },
    updateCheck: {
        type: OptionType.BOOLEAN,
        description: "Look for a newer Clipper release when Discord starts. Nothing is downloaded by the check itself",
        default: true
    },
    updateAutomatic: {
        type: OptionType.BOOLEAN,
        description: "Install a newer release as soon as the check finds one, instead of asking first. It still only takes effect on the next Discord restart",
        default: false
    }
});

/**
 * Mime type to record in, or an empty string when the client can encode none.
 *
 * The configured container comes first, then the others: MP4 recording needs a
 * recent Chromium, and a client too old for it should still be able to clip
 * rather than fail to arm the buffer at all.
 */
export function pickMimeType(container: string): string {
    return mimeTypeChain(container)[0] ?? "";
}

/**
 * Every mime type this client says it can take, the configured one first.
 *
 * `isTypeSupported` is a claim, not a guarantee: a Chromium that answers yes to
 * H.264 still fails at the first frame when the hardware encoder behind it is
 * broken, which a driver or a client update is enough to do. The buffer keeps
 * the whole list so a dead encoder costs the clip its container rather than
 * costing the user their buffer.
 */
export function mimeTypeChain(container: string): string[] {
    const others = [Container.Mp4H264, Container.WebmVp9, Container.WebmVp8].filter(c => c !== container);
    const candidates = [...new Set([container, ...others].flatMap(mimeCandidates))];

    return candidates.filter(t => MediaRecorder.isTypeSupported(t));
}

/** Resolves the configured container to a list of mime types, best first. */
function mimeCandidates(container: string): string[] {
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
