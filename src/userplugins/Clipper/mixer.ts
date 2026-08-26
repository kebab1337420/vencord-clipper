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
 *
 * The people in a voice call are the exception, and they get channels here too.
 * Their sound is inside that one loopback stream like everything else, but it is
 * also recorded once per person on the side (`voiceRecord.ts`, or Discord's own
 * clip engine), so a level set here is not a filter applied to a mix: it is the
 * level that person's own track is added back at when the clip is put together.
 * That is why they are stored by user id rather than by device.
 */

import { Logger } from "@utils/Logger";

import { settings } from "./settings";
import type { VoiceLevels } from "./voice";

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
    /** Shown on the slider: "Second mic", "Line in", "Loopback cable". */
    label: string;
    /** `MediaDeviceInfo.deviceId` of the input to open. */
    deviceId: string;
}

export interface MixerConfig {
    system: MixerLevel;
    mic: MixerLevel;
    extras: MixerChannel[];
    /**
     * A level per person in the call, keyed by their user id.
     *
     * Only the people who have been touched are in here: everybody else is at
     * one, and writing a row for each of them would grow with every call.
     */
    voices: Record<string, MixerLevel>;
}

export const SYSTEM_CHANNEL = "system";
export const MIC_CHANNEL = "mic";

export const DEFAULT_MIXER: MixerConfig = {
    system: { gain: 1, muted: false },
    mic: { gain: 1, muted: false },
    extras: [],
    voices: {}
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
    const voices: Record<string, MixerLevel> = {};

    for (const [userId, value] of Object.entries((raw?.voices ?? {}) as Record<string, unknown>)) {
        if (!/^\d+$/.test(userId)) continue;
        voices[userId] = level(value, { gain: 1, muted: false });
    }

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
            })),
        voices
    };
}

export function writeMixer(next: MixerConfig): void {
    // Assigned whole: the settings store only notices a new value on the key.
    settings.store.audioMixer = {
        system: { ...next.system },
        mic: { ...next.mic },
        extras: next.extras.map(e => ({ ...e })),
        voices: Object.fromEntries(Object.entries(next.voices ?? {}).map(([id, level]) => [id, { ...level }]))
    };
}

/** Effective linear gain of a channel, mute included. */
export function gainOf(level: MixerLevel): number {
    return level.muted ? 0 : clampGain(level.gain);
}

/**
 * The per-person levels a clip should be saved with.
 *
 * The shape the studio and the render already speak: a linear gain per user id,
 * where one is untouched and zero is left out of the mix entirely. Untouched
 * people are left out of the record so that a clip taken with nobody turned
 * down carries no levels at all and takes the fast path through the mix.
 */
export function voiceLevelsFrom(mixer: MixerConfig): VoiceLevels {
    const levels: VoiceLevels = {};

    for (const [userId, level] of Object.entries(mixer.voices ?? {})) {
        const gain = gainOf(level);
        if (gain !== 1) levels[userId] = gain;
    }

    return levels;
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
