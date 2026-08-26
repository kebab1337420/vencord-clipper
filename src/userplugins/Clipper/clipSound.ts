/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the sound a clip makes
 *
 * A keybind pressed inside a game gives nothing back. The toast is behind the
 * fullscreen window, the desktop notification is behind it too, and the only
 * way to know the clip was taken is to alt-tab out and look - which is the one
 * thing nobody does in the middle of the play they just clipped. A short sound
 * is the piece of feedback that reaches the player where they actually are.
 *
 * The catch is that the plugin records the machine's own output: the "system
 * sound" channel is a loopback of everything the speakers play, so a sound
 * played at the moment of a clip is a sound recorded into the buffer. It lands
 * on the tail of the clip being written right then, and it sits in the rolling
 * buffer for the whole clip length afterwards, so the next clip taken within
 * that window has it somewhere in the middle. Watching a clip back and hearing
 * the notification for it is exactly what this must not do.
 *
 * So the sound is never simply played. The recorder is asked to hold the system
 * channel at zero for as long as the sound lasts, and the sound itself starts a
 * few milliseconds after that request so the gain ramp is already down when the
 * first sample arrives. The window is measured from the sound's own length
 * rather than guessed, because every millisecond of it is game audio the clip
 * does not get.
 *
 * The microphone is deliberately left alone. It is the user's own voice at the
 * moment they clipped, which is often the reason they clipped, and Discord's
 * echo cancellation already keeps the speakers out of it.
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";

import { settings } from "./settings";

const logger = new Logger("Clipper", "#f0b132");

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

/** Silence taken before the sound starts, so the duck's ramp lands first. */
const LEAD_SECONDS = 0.04;
/** Silence held past the end, for the speaker's own ring-out. */
const TAIL_SECONDS = 0.12;
/** Length of the built-in blip, its ramps included. */
const BUILT_IN_SECONDS = 0.2;

/**
 * Ceiling on a custom sound.
 *
 * Not a limit on the file but on how long the mix is willing to stay muted for
 * it: point this at a ten second airhorn and every clip loses ten seconds of
 * game audio off its tail. Anything past this plays cut off.
 */
const MAX_SECONDS = 5;

export const DEFAULT_CLIP_SOUND_VOLUME = 70;

/** Silences the recording mix for this many milliseconds. Implemented by the recorder. */
export type Duck = (ms: number) => void;

let audio: AudioContext | null = null;

/** The decoded custom sound, or `null` when the built-in one is to be used. */
let loaded: { path: string; buffer: AudioBuffer | null; } | null = null;
let loading: { path: string; done: Promise<AudioBuffer | null>; } | null = null;

/**
 * The context the feedback plays on, kept for the session.
 *
 * Its own, not the recorder's: the recorder's context is a mixing graph whose
 * destination is the file, and anything connected there would be recorded
 * rather than heard, which is precisely backwards.
 */
function context(): AudioContext {
    return audio ??= new AudioContext();
}

/** The configured volume as a linear gain, 0 to 1. */
export function clipSoundVolume(): number {
    const raw = Number(settings.store.clipSoundVolume ?? DEFAULT_CLIP_SOUND_VOLUME);
    if (!Number.isFinite(raw)) return DEFAULT_CLIP_SOUND_VOLUME / 100;

    return Math.min(1, Math.max(0, raw / 100));
}

/**
 * Plays the clip sound and keeps it out of the recording.
 *
 * `duck` is the recorder's, and is handed the window to stay silent for. It is
 * optional so the settings panel can try the sound with nothing recording, but
 * a preview taken while the buffer runs passes it too - a test is as audible to
 * the loopback as the real thing.
 */
export async function playClipSound(duck?: Duck): Promise<void> {
    if (!settings.store.clipSound) return;

    const volume = clipSoundVolume();
    if (volume <= 0) return;

    try {
        const ctx = context();

        // A context built before the window was ever clicked starts suspended.
        // A clip is always a keypress, so this resume is one the policy allows.
        if (ctx.state === "suspended") await ctx.resume();

        const custom = await sample(String(settings.store.clipSoundPath || ""));
        const seconds = custom ? Math.min(custom.duration, MAX_SECONDS) : BUILT_IN_SECONDS;

        duck?.(Math.ceil((LEAD_SECONDS + seconds + TAIL_SECONDS) * 1000));

        const at = ctx.currentTime + LEAD_SECONDS;
        if (custom) playSample(ctx, custom, volume, at);
        else blip(ctx, volume, at);
    } catch (e) {
        logger.warn("Could not play the clip sound", e);
    }
}

/** Drops the decoded sound, so the next clip reads the file again. */
export function forgetClipSound(): void {
    loaded = null;
    loading = null;
}

/**
 * The decoded custom sound for a path, or `null` for the built-in blip.
 *
 * Cached including the failure: this runs on every single clip, and a file that
 * has been moved or deleted must cost one warning rather than a disk read and a
 * decode attempt every time.
 */
async function sample(path: string): Promise<AudioBuffer | null> {
    if (!path) return null;
    if (loaded?.path === path) return loaded.buffer;
    if (loading?.path === path) return await loading.done;

    const done = read(path);
    loading = { path, done };

    try {
        const buffer = await done;
        loaded = { path, buffer };

        return buffer;
    } finally {
        if (loading?.path === path) loading = null;
    }
}

async function read(path: string): Promise<AudioBuffer | null> {
    try {
        const bytes = await Native.readAudioFile(path);

        return await context().decodeAudioData(bytes.buffer as ArrayBuffer);
    } catch (e) {
        logger.warn(`Could not load the clip sound at ${path}; using the built-in one`, e);

        return null;
    }
}

function playSample(ctx: AudioContext, buffer: AudioBuffer, volume: number, at: number): void {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = volume;

    source.connect(gain);
    gain.connect(ctx.destination);

    source.start(at);
    if (buffer.duration > MAX_SECONDS) source.stop(at + MAX_SECONDS);

    source.onended = () => {
        try {
            source.disconnect();
            gain.disconnect();
        } catch {
            // The context was closed under it; there is nothing left to unwire.
        }
    };
}

/**
 * The built-in sound: two short sine notes, a fourth apart, rising.
 *
 * Synthesised rather than shipped as a file. It keeps the bundle free of a
 * sample the plugin would have to carry and license, and two hundred
 * milliseconds of sine is one thing a recording of one never is: exactly as
 * loud as it was asked to be, on every machine.
 */
function blip(ctx: AudioContext, volume: number, at: number): void {
    const notes = [
        { hz: 987.77, from: 0, lasts: 0.09 },
        { hz: 1318.51, from: 0.075, lasts: 0.12 }
    ];

    for (const note of notes) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = note.hz;

        const gain = ctx.createGain();
        const start = at + note.from;

        // Ramped, never set: a square edge on a sine is a click, and a click is
        // the one thing a notification sound is not allowed to be.
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.35), start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + note.lasts);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + note.lasts + 0.02);

        osc.onended = () => {
            try {
                osc.disconnect();
                gain.disconnect();
            } catch {
                // Same as above: the context went away first.
            }
        };
    }
}
