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
import { VrBindings } from "./components/VrBindings";

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
    followGame: {
        type: OptionType.BOOLEAN,
        description: "While a game is running, record the screen it is on instead of the picked source - a game in exclusive fullscreen cannot be captured as a window, and only a screen carries the system sound",
        default: true
    },
    autoHighlight: {
        type: OptionType.BOOLEAN,
        description: "Drop a marker by itself when something happens: gunfire out of the game, the screen going red or dark, a kill the game reported, the call going off alongside any of it. The call's own noise no longer marks anything by itself - see the setting below - because the loudest second of an evening is usually somebody swearing at a bad play",
        default: true
    },
    voiceHighlights: {
        type: OptionType.BOOLEAN,
        description: "Let how loud the call is count towards a marker at all. Off, and it counts for nothing while it is: the loudest second of most evenings is somebody swearing at their own bad play, and marking every one of those buried the moments worth keeping. Turn it on for a call worth clipping for its own sake, or where nothing below can read what is being played",
        default: false
    },
    highlightSensitivity: {
        type: OptionType.SELECT,
        description: "How much has to happen before a marker drops by itself",
        options: [
            { label: "Strict - only the call properly going off", value: "strict" },
            { label: "Normal", value: "normal", default: true },
            { label: "Loose - a hint of it is enough", value: "loose" }
        ]
    },
    gameAudioWatch: {
        type: OptionType.BOOLEAN,
        description: "Listen to the game itself: gunfire, explosions and hits arrive across the whole spectrum at once, which a voice cannot do. Off, because the separation is not good enough in practice - there is one loopback stream and the call is inside it, so a room of people laughing puts enough through as gunfire to mark all evening. Worth turning on for a quiet call, or for playing alone",
        default: false
    },
    gameVideoWatch: {
        type: OptionType.BOOLEAN,
        description: "And watch the picture: how much it is moving, a red wash for damage, the colour draining for a death screen, a cut to black. Measured on a 64x36 copy of the frame six times a second, so the cost is negligible",
        default: true
    },
    gameIntegrations: {
        type: OptionType.BOOLEAN,
        description: "Let games report what happened outright, where they offer a supported way to. Counter-Strike 2 needs a config file written into its own cfg folder and a listener on 127.0.0.1 for it to post to; League of Legends is read from the server it already runs on 127.0.0.1:2999. Nothing leaves the machine, and a kill the game reported is worth more than every guess put together",
        default: false
    },
    autoHighlightSave: {
        type: OptionType.BOOLEAN,
        description: "And save a clip of those moments without being asked. At most one every two minutes",
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
    overlayNotice: {
        type: OptionType.BOOLEAN,
        description: "Say what the plugin just did over the game, for a couple of seconds - a clip saved, or somebody in the call asking for everyone's angle. A line of text, no video, and clicks go through it. Only while Discord is not the window in front. Watching the clip itself is the keybind below, and never happens on its own",
        default: true
    },
    overlayCorner: {
        type: OptionType.SELECT,
        description: "Which corner the notice and the clip appear in, on the screen your pointer is on",
        options: [
            { label: "Bottom right", value: "bottom-right", default: true },
            { label: "Bottom left", value: "bottom-left" },
            { label: "Top right", value: "top-right" },
            { label: "Top left", value: "top-left" }
        ]
    },
    overlaySize: {
        type: OptionType.SELECT,
        description: "How big the clip window is when you call it up",
        options: [
            { label: "Small (320px)", value: "small" },
            { label: "Medium (420px)", value: "medium", default: true },
            { label: "Large (560px)", value: "large" }
        ]
    },
    overlaySeconds: {
        type: OptionType.SLIDER,
        description: "Seconds of the clip to play, counted back from its end - the moment you saved is the one at the end of the buffer. 0 plays the whole thing",
        markers: [0, 5, 10, 15, 20, 30, 45, 60],
        default: 10,
        stickToMarkers: true
    },
    overlayVolume: {
        type: OptionType.SLIDER,
        description: "How loud that window is. Muted by default, since the game is already making noise - and a browser only ever allows sound here after a click, so this is a request rather than a promise",
        markers: [0, 10, 25, 50, 75, 100],
        default: 0,
        stickToMarkers: false
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
    povKeybind: {
        type: OptionType.COMPONENT,
        default: "alt+F12",
        component: () => (
            <KeybindInput
                title="Clip everyone's angle keybind"
                note="Saves your own clip and posts a message in the call's chat asking everyone else running Clipper to save theirs. The message is plain text and says what it does, so the people without the plugin see the same thing you sent."
                value={settings.store.povKeybind}
                onChange={v => (settings.store.povKeybind = v)}
            />
        )
    },
    replayKeybind: {
        type: OptionType.COMPONENT,
        default: "alt+F8",
        component: () => (
            <KeybindInput
                title="Clip editor keybind"
                note="Opens the clip you saved last in an editor over the game, and hands it the mouse: watch it, pick a range out of it, cut it, send it, delete it or take it to the full studio. A second press gives the mouse back to the game and closes it, and so does Escape."
                value={settings.store.replayKeybind}
                onChange={v => (settings.store.replayKeybind = v)}
            />
        )
    },
    povRequests: {
        type: OptionType.BOOLEAN,
        description: "Save your own clip when somebody else in your call asks for everyone's angle. Only from people in the call you are currently in, only while your buffer is already running, and at most one every ten seconds - so it can never write a clip you could not have saved yourself a second earlier. You are told over the game when it happens, or in Discord when you are looking at it",
        default: true
    },
    povCleanup: {
        type: OptionType.BOOLEAN,
        description: "Delete your own request message a few seconds after sending it. The message is only how the request reaches the other clients - everyone running Clipper is told over their game instead - so this keeps the channel from filling up with them. Turn it off to leave them in the chat",
        default: true
    },
    /*
     * Written by VRinstaller.bat, never shown, and the only thing that decides
     * whether any of the VR settings below appear at all.
     *
     * Most people have no headset, and a section about SteamVR in the middle of
     * their settings is noise they have to read past every time they come here
     * to change the buffer length. So the VR side is opt-in from outside
     * Discord: run the installer and it appears, run it again with -Uninstall
     * and it goes away. Nothing about the capture changes either way.
     */
    vrInstalled: {
        type: OptionType.BOOLEAN,
        description: "Whether the SteamVR side of the plugin has been installed",
        default: false,
        hidden: true
    },
    vrSection: {
        type: OptionType.COMPONENT,
        hidden: () => !settings.store.vrInstalled,
        component: () => (
            <SettingsSection
                title="VR"
                note="Somebody in a headset cannot see Discord, cannot see the overlay and cannot reach the keyboard."
            />
        )
    },
    vrControls: {
        hidden: () => !settings.store.vrInstalled,
        type: OptionType.BOOLEAN,
        description: "Let the clip controls be worked from a VR controller. Attaches to SteamVR whenever it is running and lets go when it stops, so it costs nothing on the days you are not in VR - and it never starts SteamVR itself. The actions are the same ones the keybinds fire, and they are bound in SteamVR's own binding panel, next to the bindings for every game",
        default: false
    },
    vrBindings: {
        type: OptionType.COMPONENT,
        hidden: () => !settings.store.vrInstalled,
        component: VrBindings
    },
    vrPanel: {
        hidden: () => !settings.store.vrInstalled,
        type: OptionType.BOOLEAN,
        description: "And draw the plugin's notices inside the headset. A small card a metre in front of you saying what a button just did and how a clip ended up, for a few seconds - because every other way the plugin has of telling you is a toast on a monitor you cannot see. It needs nothing installed and no graphics card time: the picture is drawn in Discord and handed to SteamVR's compositor as it is",
        default: true
    },
    vrMotionWatch: {
        hidden: () => !settings.store.vrInstalled,
        type: OptionType.BOOLEAN,
        description: "And let where your hands are count towards a marker. No VR game reports its kills, and what the picture watcher sees in VR is a distorted one-eye mirror window, so both of the usual detectors are nearly blind here - but a hand moving at five metres a second is not something that happens while you sit still. It is corroboration only: on its own it never marks anything, however hard you swing",
        default: true
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
