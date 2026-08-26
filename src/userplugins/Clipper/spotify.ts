/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - Spotify, seen from the recording side
 *
 * Music is the one thing every clip has too much of. It sits in the same
 * loopback stream as the game and the call - Windows hands out one mix and no
 * browser API takes it apart again - so a clip with the music too loud is a
 * clip that stays that way, and turning it down afterwards means turning
 * everything down with it.
 *
 * It can be turned down *before* it goes in, though. Windows keeps every
 * application's audio session apart one step earlier than the mix, which is
 * what its own volume mixer shows, and lowering Spotify's session lowers what
 * reaches both the speakers and the capture. That is the honest description of
 * this slider: it is Spotify's volume, not a track in the clip. Moving it
 * changes what the next clip records and what is in your headphones right now,
 * because those are the same signal.
 *
 * Detection comes from the same place rather than from Discord's Spotify
 * connection: a session on the endpoint means the application is playing
 * through this machine, which is the question that matters here. The linked
 * account says what the track is called, which is a nicer thing to know and a
 * worse thing to record against - it is set from whichever device is playing,
 * including a phone in another room that this machine cannot hear at all.
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";

import type { AppAudioSession } from "./appVolume";

const logger = new Logger("Clipper", "#f0b132");

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

/** Process name as Windows reports it, without the extension. */
const SPOTIFY = "Spotify";

/** How often the session list is read while something is watching. */
const POLL_MS = 400;

/**
 * How long a peak keeps counting as "playing".
 *
 * A quiet passage, the gap between two tracks and the moment the meter is read
 * between two buffers all give a peak of zero, and a row that blinked out on
 * every one of them would be unreadable.
 */
const HOLD_MS = 2_000;

/** Below this a peak is the meter's own noise floor rather than a sound. */
const SILENCE = 0.002;

/** How long a slider is allowed to settle before the volume is written. */
const WRITE_MS = 80;

export interface SpotifyAudio {
    /** Spotify has an audio session on the output: it is running and connected to it. */
    present: boolean;
    /** It has made a sound recently. See HOLD_MS. */
    playing: boolean;
    /** Its own volume in the Windows mixer, 0 to 1. */
    volume: number;
    muted: boolean;
    /** Loudest sample of the last read, 0 to 1. */
    peak: number;
}

const SILENT: SpotifyAudio = { present: false, playing: false, volume: 1, muted: false, peak: 0 };

let state: SpotifyAudio = SILENT;
let heardAt = 0;

const listeners = new Set<(state: SpotifyAudio) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let reading = false;

/** Set while a slider is being dragged, so a poll does not fight the drag. */
let writing: { level: number; muted: boolean; at: number; } | null = null;
let write: ReturnType<typeof setTimeout> | null = null;

export function spotifyAudio(): SpotifyAudio {
    return state;
}

/**
 * Watches Spotify's audio session for as long as anyone is listening.
 *
 * Nothing polls while the answer is not on screen: reading the sessions costs a
 * PowerShell round trip, and the helper behind it shuts itself down a minute
 * after the last one, so a closed settings panel costs nothing at all.
 */
export function watchSpotify(listener: (state: SpotifyAudio) => void): () => void {
    listeners.add(listener);
    listener(state);

    if (!timer) {
        void poll();
        timer = setInterval(() => void poll(), POLL_MS);
    }

    return () => {
        listeners.delete(listener);

        if (listeners.size || !timer) return;

        clearInterval(timer);
        timer = null;
    };
}

async function poll(): Promise<void> {
    // One read at a time: a machine where the helper takes longer than the
    // interval would otherwise queue reads until it fell over.
    if (reading) return;
    reading = true;

    try {
        apply(await Native.listAppAudio());
    } catch (e) {
        logger.warn("Could not read the application volumes", e);
        publish(SILENT);
    } finally {
        reading = false;
    }
}

function apply(sessions: AppAudioSession[]): void {
    const mine = sessions.filter(s => s.process.toLowerCase() === SPOTIFY.toLowerCase());

    if (!mine.length) {
        heardAt = 0;
        publish(SILENT);

        return;
    }

    // Spotify is several processes and any of them can hold the session - the
    // renderers, the one playing. Loudest wins for the meter, and the volume is
    // read off the loudest too, since that is the one being listened to.
    const loudest = mine.reduce((best, s) => (s.peak > best.peak ? s : best), mine[0]);
    const now = Date.now();

    if (loudest.peak > SILENCE) heardAt = now;

    // A level written a moment ago has not necessarily come back yet: while a
    // slider is being dragged the local value is the truth, not the poll's.
    const held = writing && now - writing.at < WRITE_MS * 4 ? writing : null;

    publish({
        present: true,
        playing: !!heardAt && now - heardAt < HOLD_MS,
        volume: held ? held.level : loudest.volume,
        muted: held ? held.muted : mine.every(s => s.muted),
        peak: loudest.peak
    });
}

function publish(next: SpotifyAudio): void {
    const same = state.present === next.present
        && state.playing === next.playing
        && state.muted === next.muted
        && Math.abs(state.volume - next.volume) < 0.001
        && Math.abs(state.peak - next.peak) < 0.005;

    if (same) return;

    state = next;
    for (const listener of listeners) {
        try {
            listener(next);
        } catch (e) {
            logger.warn("A Spotify listener threw", e);
        }
    }
}

/**
 * Sets Spotify's volume, 0 to 1.
 *
 * Answers on screen immediately and writes shortly after: a drag is fifty
 * events, and each write is a round trip to a PowerShell holding COM objects.
 * The last position of the slider is the one that lands.
 */
export function setSpotifyVolume(level: number): void {
    const clamped = Math.min(1, Math.max(0, level));

    writing = { level: clamped, muted: state.muted, at: Date.now() };
    publish({ ...state, volume: clamped });

    schedule(() => Native.setAppAudioVolume(SPOTIFY, clamped));
}

export function setSpotifyMuted(muted: boolean): void {
    writing = { level: state.volume, muted, at: Date.now() };
    publish({ ...state, muted });

    schedule(() => Native.setAppAudioMuted(SPOTIFY, muted));
}

function schedule(run: () => Promise<number>): void {
    if (write) clearTimeout(write);

    write = setTimeout(() => {
        write = null;

        // Kept until the next poll has had time to come back with it, so the
        // slider does not jump back to the old value in between.
        if (writing) writing = { ...writing, at: Date.now() };

        run().catch(e => logger.warn("Could not set Spotify's volume", e));
    }, WRITE_MS);
}

/** Drops the helper process behind the readings. Called when the plugin stops. */
export function stopSpotifyWatch(): void {
    if (timer) clearInterval(timer);
    timer = null;

    if (write) clearTimeout(write);
    write = null;

    listeners.clear();
    state = SILENT;
    heardAt = 0;

    Native.releaseAppAudio().catch(() => void 0);
}
