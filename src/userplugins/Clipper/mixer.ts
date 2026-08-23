/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - audio mixer model
 *
 * What ends up in a clip is a mix, and until now it was a mix nobody could
 * balance: the captured source's audio and the microphone went in at whatever
 * level they came out at. This module holds the levels, and the recorder builds
 * one gain stage per channel from them, live enough that a slider moved during a
 * recording is heard in the next chunk.
 *
 * A word on what a channel can be. Chromium hands out one loopback stream for
 * the captured source, and that stream is already mixed: the game, the people
 * talking in the voice channel and whatever music is playing all arrive
 * together, and no browser API splits them apart again. Splitting them is
 * therefore a routing job on the machine, not a plugin one - send an app to a
 * virtual cable (VB-CABLE, Voicemeeter) and the cable shows up as an input
 * device, which is exactly what an extra channel here captures. So:
 *
 *   - "System sound" is the captured source: game, voice chat, music, all of it
 *   - "Microphone" is your own voice, on Discord's device and processing
 *   - every extra channel is an input device you point at, one slider each
 */

import { Logger } from "@utils/Logger";

import { settings } from "./settings";

const logger = new Logger("Clipper", "#f0b132");

/** A level, as a linear gain. 1 is untouched, 2 is twice as loud. */
export interface MixerLevel {
    gain: number;
    muted: boolean;
}

/** An input device added to the mix, on top of the source and the microphone. */
export interface MixerChannel extends MixerLevel {
    /** Stable id, used as the channel key in the recorder's graph. */
    id: string;
    /** Shown on the slider: "Spotify", "Game", "Second mic". */
    label: string;
    /** `MediaDeviceInfo.deviceId` of the input to open. */
    deviceId: string;
}

export interface MixerConfig {
    system: MixerLevel;
    mic: MixerLevel;
    extras: MixerChannel[];
}

export const SYSTEM_CHANNEL = "system";
export const MIC_CHANNEL = "mic";

export const DEFAULT_MIXER: MixerConfig = {
    system: { gain: 1, muted: false },
    mic: { gain: 1, muted: false },
    extras: []
};

/** Clamped to something an encoder can take without clipping into noise. */
export function clampGain(value: unknown): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;

    return Math.min(3, Math.max(0, Math.round(number * 100) / 100));
}

function level(value: unknown, fallback: MixerLevel): MixerLevel {
    const raw = value as Partial<MixerLevel> | undefined;

    return { gain: clampGain(raw?.gain ?? fallback.gain), muted: raw?.muted === true };
}

/**
 * The mixer as it is stored, with every field checked.
 *
 * The setting is a free-form custom value, so it may have been written by an
 * older version or edited by hand; a bad number here would reach a `GainNode` as
 * NaN and silence the whole clip.
 */
export function readMixer(): MixerConfig {
    const raw = settings.store.audioMixer as Partial<MixerConfig> | undefined;

    const extras = Array.isArray(raw?.extras) ? raw.extras : [];

    return {
        system: level(raw?.system, DEFAULT_MIXER.system),
        mic: level(raw?.mic, DEFAULT_MIXER.mic),
        extras: extras
            .filter(e => e && typeof e.deviceId === "string" && e.deviceId)
            .map((e, i) => ({
                id: typeof e.id === "string" && e.id ? e.id : `extra-${i}`,
                label: (typeof e.label === "string" && e.label.trim()) || "Extra input",
                deviceId: e.deviceId,
                ...level(e, { gain: 1, muted: false })
            }))
    };
}

export function writeMixer(next: MixerConfig): void {
    // Assigned whole: the settings store only notices a new value on the key.
    settings.store.audioMixer = {
        system: { ...next.system },
        mic: { ...next.mic },
        extras: next.extras.map(e => ({ ...e }))
    };
}

/** Effective linear gain of a channel, mute included. */
export function gainOf(level: MixerLevel): number {
    return level.muted ? 0 : clampGain(level.gain);
}

export function newChannelId(): string {
    return `extra-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Input devices that can be added as a channel.
 *
 * Labels are only handed out once the page holds a microphone permission, which
 * Discord normally has; without it the list is still usable, just anonymous.
 */
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(d => d.kind === "audioinput" && d.deviceId);
    } catch (e) {
        logger.warn("Could not list the input devices", e);
        return [];
    }
}
