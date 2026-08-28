/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the evidence board the auto-marker reads
 *
 * The automatic marker used to have exactly one thing to go on: how loud the
 * people in the call were. That is a bad proxy for a good moment. Somebody
 * swearing at their own bad play is the loudest second of most evenings and the
 * least worth keeping, and the ace that nobody comments on is silent.
 *
 * So the loudness is demoted to one voice among several, and the others are
 * detectors that look at the game itself: the shape of the sound coming out of
 * it (./gameAudio), what the picture is doing (./gameVideo), and, for the games
 * that will say so outright, the game's own account of what just happened
 * (./gameEvents). In VR, where the first three have very little to work with,
 * there is a fourth that watches the player rather than the game (./vr). This
 * module is the board they all pin to, and nothing more -
 * it holds no opinion about what a moment is. ./highlights reads the total and
 * decides.
 *
 * Two shapes of evidence, because the detectors are not alike:
 *
 *   - a level is a thing that is true right now and stops being true - people
 *     talking, the screen busy. Reported over and over, and forgotten a second
 *     after the last report, so a detector that dies stops counting rather than
 *     holding its last reading forever.
 *   - an event is a thing that happened at an instant - a shot, a kill, a red
 *     flash. It fades over the next few seconds, which is what lets a burst of
 *     small ones add up to a firefight while a single one goes nowhere.
 *
 * A few kinds are not evidence but testimony: the game said, in so many words,
 * that you got a kill. Those are marked certain, and ./highlights acts on them
 * at once instead of waiting to see whether the rest of the board agrees.
 */

import { Logger } from "@utils/Logger";

const logger = new Logger("Clipper");

/**
 * What each kind of evidence is worth.
 *
 * The bar in ./highlights is a little over 2, so the scale reads: a kill the
 * game itself reported clears it alone, damage plus a screen that is moving
 * clears it together, and either of those by itself does not.
 *
 * The two kinds that come from listening rather than looking - the room, and
 * the game's own sound - are off unless somebody asks for them, and report
 * nothing at all while they are off. Their weights below are what they are
 * worth once turned back on.
 *
 * The two that come from a headset are deliberately small. Together, at their
 * absolute hardest, they do not reach the bar: the player's own body is
 * corroboration for something else that was seen, never a reason of its own.
 * Somebody who plays a rhythm game swings their arms for the whole song, and a
 * detector that marked on that would mark on all of it.
 */
const WEIGHTS: Record<string, number> = {
    /** People in the call, already scored in ./highlights' own units. */
    voices: 1,

    /** Broadband cracks out of the game: gunfire, explosions, hits. */
    gunfire: 0.85,
    /** The game got much louder than it has been. */
    swell: 0.7,

    /** The picture is moving far more than it has been. */
    action: 1,
    /** A red wash over the screen: damage, in most shooters. */
    damage: 1.1,
    /** The colour fell out of the picture: a death or knocked-down screen. */
    greyout: 1.2,
    /** The picture went dark: a death, a round end, a loading screen. */
    blackout: 0.9,

    /** Both hands going far faster than a gesture. Only ever reported in VR. */
    hands: 1.1,
    /** And the head whipping round to follow something. */
    turn: 0.7,

    /** The game said so. */
    kill: 2.6,
    death: 2.2,
    multikill: 4,
    objective: 2.6,
    roundwin: 2.2
};

/** The kinds that are the game talking rather than a guess about it. */
const CERTAIN = new Set(["kill", "death", "multikill", "objective", "roundwin"]);

/** How long an event still counts for, and how it fades over that. */
const EVENT_LIFE_MS = 5000;

/** A level not reported again inside this is dropped. */
const STALE_MS = 1200;

/**
 * The most any one kind of event can contribute at once.
 *
 * A long firefight is a hundred onsets, and without this it would out-score
 * everything else put together for the rest of the round. Levels are not capped
 * here: they are bounded by whoever reports them, and the room's own score is
 * deliberately allowed to run past this - it is measured against a bar that
 * rises with it.
 */
const KIND_CAP = 2.6;

interface Level {
    value: number;
    at: number;
    note: string;
}

interface Fired {
    kind: string;
    note: string;
    at: number;
}

export interface Reading {
    /** The board's total, in the same units as ./highlights' bar. */
    value: number;
    /** Every kind contributing, biggest first, for the marker's reason. */
    notes: string[];
}

/** What a detector calls itself, for `watching()`. */
type Detector = "audio" | "video" | "events" | "vr";

class SignalBus {
    private levels = new Map<string, Level>();
    private events: Fired[] = [];
    private certain: Fired[] = [];
    private running = new Set<Detector>();

    /** Says a detector is up, so the score knows what it is being told. */
    claim(detector: Detector): void {
        this.running.add(detector);
    }

    release(detector: Detector): void {
        this.running.delete(detector);
    }

    /**
     * Whether anything is actually reading the game right now.
     *
     * ./highlights scales the call's shouting back when this is true: with a
     * real account of the game available, a raised voice is corroboration and
     * not a reason of its own.
     */
    watching(): boolean {
        return this.running.size > 0;
    }

    /** Reports something that is true at this moment, 0 upwards. */
    report(kind: string, value: number, note: string): void {
        if (!(kind in WEIGHTS)) return;

        if (value <= 0) {
            this.levels.delete(kind);
            return;
        }

        this.levels.set(kind, { value, at: Date.now(), note });
    }

    /** Reports something that happened at this moment. */
    fire(kind: string, note: string): void {
        if (!(kind in WEIGHTS)) return;

        const event: Fired = { kind, note, at: Date.now() };

        if (CERTAIN.has(kind)) {
            logger.info(`Signal: ${note}`);

            // Bounded: a client that stopped polling for a minute must not come
            // back to a queue of markers to drop all at once.
            this.certain.push(event);
            if (this.certain.length > 4) this.certain.shift();
        }

        this.events.push(event);
        if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    }

    /**
     * Takes the oldest thing the game said outright, if there is one.
     *
     * Taken rather than read: it is acted on once, and a marker that has already
     * been dropped for it must not be dropped again on the next tick.
     */
    claimCertain(): string | null {
        const event = this.certain.shift();
        if (!event) return null;

        // Stale by the time anybody looked: the moment is a minute gone and a
        // marker there would point at nothing.
        if (Date.now() - event.at > EVENT_LIFE_MS * 2) return null;

        return event.note;
    }

    /** The whole board, totalled. */
    read(): Reading {
        const now = Date.now();
        const scores = new Map<string, { value: number; note: string; }>();

        for (const [kind, level] of this.levels) {
            if (now - level.at > STALE_MS) {
                this.levels.delete(kind);
                continue;
            }

            scores.set(kind, { value: level.value * WEIGHTS[kind], note: level.note });
        }

        // Oldest first, so the sweep can stop at the first live one.
        let alive = 0;
        for (; alive < this.events.length; alive++) {
            if (now - this.events[alive].at < EVENT_LIFE_MS) break;
        }
        if (alive) this.events.splice(0, alive);

        // Tracked apart from the running total: the note wanted is the one
        // belonging to the strongest single event of its kind, and comparing
        // against the total would hand it to the first one to arrive for ever.
        const loudest = new Map<string, number>();

        for (const event of this.events) {
            const fade = 1 - (now - event.at) / EVENT_LIFE_MS;
            const one = WEIGHTS[event.kind] * fade;
            const got = scores.get(event.kind);
            const best = loudest.get(event.kind) ?? 0;

            if (one > best) loudest.set(event.kind, one);

            scores.set(event.kind, {
                value: Math.min(KIND_CAP, (got?.value ?? 0) + one),
                note: one > best ? event.note : got?.note ?? event.note
            });
        }

        let value = 0;
        for (const score of scores.values()) value += score.value;

        const ranked = [...scores.values()].sort((a, b) => b.value - a.value);

        return { value, notes: ranked.map(s => s.note) };
    }

    /** Forgets everything. Called when the watcher starts or stops. */
    clear(): void {
        this.levels.clear();
        this.events = [];
        this.certain = [];
    }
}

export const signals = new SignalBus();
