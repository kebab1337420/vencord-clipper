/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - listening to the game rather than to the people playing it
 *
 * The captured source's sound is already in the mixer, behind an analyser that
 * existed to draw a level bar. Read as a spectrum instead of as one number, it
 * says a good deal about what is happening on screen, because the sounds a game
 * makes at its loud moments do not look like the sounds a room makes.
 *
 * A gunshot, an explosion, a hit marker: all of them are a crack. The energy
 * arrives across the whole spectrum at once - deep in the bass and up in the
 * highs in the same instant - and it arrives from nothing. A voice cannot do
 * that. Speech lives in a band from about 300 Hz to 3.4 kHz, rises and falls
 * over syllables rather than in a single frame, and has very little above 4 kHz
 * to give. So a jump that is simultaneously low and high, and that is not
 * carried by the speech band, is the game and not the call.
 *
 * That distinction matters here more than it sounds, because there is only one
 * loopback stream and everything is inside it: the game, the people in the
 * voice channel, and whatever music is playing. Nothing in the browser splits
 * them apart. The shape of the sound is the only separation available, and when
 * the call is known to be talking the bar is raised further still rather than
 * trusted.
 *
 * Everything here is a guess, and it is scored as one - a handful of onsets is
 * worth less on ./signals' board than one thing a game says outright.
 *
 * And it is off unless asked for. The separation described above is the best
 * that can be done from one mixed stream, and in a call it is not good enough:
 * a room of people laughing and talking over each other puts enough through as
 * gunfire to mark the evening every ninety seconds. `gameAudioWatch` starts
 * off for that reason, and is worth turning on for a quiet call or for playing
 * alone, where the only thing in the stream is the game.
 */

import { Logger } from "@utils/Logger";

import { signals } from "./signals";

const logger = new Logger("Clipper");

/** How often the spectrum is read. An onset is over inside 50 ms. */
const TICK_MS = 50;

/** The bands, in hertz. Deliberately disjoint: they are compared to each other. */
const LOW = [60, 250] as const;
const VOICE = [300, 3400] as const;
const HIGH = [4000, 10_000] as const;

/** How fast each band's own normal follows it, per tick. */
const RISE = 0.02;

/*
 * Everything below is a distance rather than a ratio, and that is not a style
 * choice. The analyser hands back decibels mapped onto 0..255 - about 70 dB
 * across the whole range - so the numbers here are already logarithmic, and
 * multiplying one is not "twice as loud" but a jump that gets larger the louder
 * the game already is. Read as ratios, the detector went progressively deafer
 * the more there was to hear, which is the opposite of the point. One unit of
 * the 0..1 scale used here is 70 dB, so 0.1 is about 7 dB.
 */

/** The rise over a band's own normal that counts as an attack: about 7 dB. */
const JUMP = 0.1;

/** And how much more is wanted while the call is talking over the loopback. */
const BUSY_EXTRA = 0.05;

/** A band under this has nothing in it worth calling a sound. */
const FLOOR = 0.25;

/**
 * How far under the speech band the highs may sit and still be a crack.
 *
 * A voice puts twenty to thirty decibels less into 4-10 kHz than it puts into
 * the middle; a gunshot puts nearly as much up there as anywhere else. Anything
 * further down than this is somebody talking.
 */
const HIGH_GAP = 0.2;

/** Two onsets closer than this are one sound arriving. */
const ONSET_GAP_MS = 110;

/** The game being louder than usual, and where that saturates: 6 dB to 17 dB. */
const SWELL = 0.09;
const SWELL_TOP = 0.25;

interface GameAudioHooks {
    /** The captured source's spectrum, or null when nothing is wired up. */
    spectrum(): { bins: Uint8Array; hz: number; } | null;
    /** Whether somebody in the call is talking right now. */
    busy(): boolean;
}

/** Mean level of one band, 0 to 1. */
function band(bins: Uint8Array, hz: number, range: readonly [number, number]): number {
    const from = Math.max(0, Math.floor(range[0] / hz));
    const to = Math.min(bins.length - 1, Math.ceil(range[1] / hz));
    if (to <= from) return 0;

    let sum = 0;
    for (let i = from; i <= to; i++) sum += bins[i];

    return sum / ((to - from + 1) * 255);
}

class GameAudioWatcher {
    private timer: ReturnType<typeof setInterval> | null = null;
    private hooks: GameAudioHooks | null = null;

    /** What each band usually reads, in its own units. */
    private avg = { low: 0, voice: 0, high: 0 };
    private ready = 0;
    private lastOnset = 0;

    get active(): boolean {
        return this.timer !== null;
    }

    start(hooks: GameAudioHooks): void {
        this.stop();

        this.hooks = hooks;
        this.avg = { low: 0, voice: 0, high: 0 };
        this.ready = 0;
        this.lastOnset = 0;

        this.timer = setInterval(() => this.tick(), TICK_MS);
        signals.claim("audio");
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);

        this.timer = null;
        this.hooks = null;
        signals.release("audio");
    }

    private tick(): void {
        const spectrum = this.hooks?.spectrum();
        if (!spectrum) return;

        const { bins, hz } = spectrum;
        if (!bins.length || !hz) return;

        const low = band(bins, hz, LOW);
        const voice = band(bins, hz, VOICE);
        const high = band(bins, hz, HIGH);

        const { avg } = this;

        // The first seconds are somebody alt-tabbing into a game, and the
        // averages are still at zero, which makes everything a jump.
        const settled = this.ready++ > 40;

        const busy = this.hooks!.busy();
        const bar = JUMP + (busy ? BUSY_EXTRA : 0);

        const attack = settled
            && low > FLOOR && high > FLOOR
            && low - avg.low > bar
            && high - avg.high > bar
            // Not a shout: a voice puts its energy in the middle band, and a
            // crack puts nearly as much of it above where a voice reaches.
            && high > voice - HIGH_GAP;

        const now = Date.now();

        if (attack && now - this.lastOnset > ONSET_GAP_MS) {
            this.lastOnset = now;
            signals.fire("gunfire", "shots in the game");
        }

        // The whole thing much louder than it has been - an explosion, a crowd,
        // a finisher. Not while the call is talking: their voices are in this
        // same stream, and a room getting loud is already scored elsewhere.
        const total = (low + voice + high) / 3;
        const normal = (avg.low + avg.voice + avg.high) / 3;

        if (settled && !busy && normal > FLOOR / 2 && total - normal > SWELL) {
            const over = (total - normal - SWELL) / (SWELL_TOP - SWELL);
            signals.report("swell", Math.min(1, Math.max(0, over)), "the game got loud");
        } else {
            signals.report("swell", 0, "");
        }

        // Updated after the comparison, so a loud frame is never measured
        // against a normal it has already moved.
        avg.low += (low - avg.low) * RISE;
        avg.voice += (voice - avg.voice) * RISE;
        avg.high += (high - avg.high) * RISE;
    }
}

export const gameAudio = new GameAudioWatcher();

/** One line saying what the detector can currently hear, for the toolbox. */
export function gameAudioReport(spectrum: { bins: Uint8Array; hz: number; } | null): string {
    if (!spectrum) return "No captured sound to listen to - start the clip buffer first.";

    const { bins, hz } = spectrum;
    const low = band(bins, hz, LOW);
    const voice = band(bins, hz, VOICE);
    const high = band(bins, hz, HIGH);

    logger.info(`Game audio: low ${low.toFixed(3)}, voice ${voice.toFixed(3)}, high ${high.toFixed(3)}`);

    return `Listening in steps of ${Math.round(hz)} Hz: bass ${Math.round(low * 100)}%, voice ${Math.round(voice * 100)}%, treble ${Math.round(high * 100)}%.`;
}
