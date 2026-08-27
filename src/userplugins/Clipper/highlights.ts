/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - moments that mark themselves
 *
 * A marker only exists when somebody remembers to press the key, and the
 * moments actually worth keeping are the ones where nobody is thinking about
 * keybinds: the whole call shouting at once, or one player yelling at their own
 * screen. Everything needed to notice that is already being measured - the
 * per-person levels the activity buffer keeps for the studio's voice lanes, and
 * the microphone's own meter from the mixer - so this is a watcher over those
 * rather than any new audio plumbing.
 *
 * What counts as a moment is deliberately relative. A loud group is loud all
 * evening, and a fixed threshold would either mark them every ten seconds or
 * never mark a quiet one at all, so the bar is what the last minute sounded
 * like: a moment is a jump above the room's own normal, held long enough not to
 * be a door slamming, and then nothing for a while so one burst of laughter
 * lands one marker rather than six.
 */

import { Logger } from "@utils/Logger";

import { MIC_CHANNEL } from "./mixer";
import { voiceActivity } from "./voice";

const logger = new Logger("Clipper");

/** How often the room is measured. Two ticks per activity bucket. */
const TICK_MS = 100;

/** A voice below this is background, not somebody making a point. */
const VOICE_FLOOR = 0.35;

/** How long a jump has to hold before it is a moment, in ticks. */
const HOLD_TICKS = 10;

/** Nothing else is marked for this long afterwards. */
const COOLDOWN_MS = 20_000;

/**
 * How fast the baseline follows the room, as a share of each tick.
 *
 * Slow enough that a burst does not raise the bar it is being measured
 * against - a minute of ordinary talking is roughly what it averages over.
 */
const BASELINE_RISE = 0.0015;

/** The jump over the baseline that counts, and the floor under it. */
const JUMP = 1.6;
const MIN_SCORE = 1.2;

export interface HighlightHooks {
    /** Level of one of the recorder's own channels, 0 to 1. */
    channelLevel(id: string): number;
    /** Called once per moment, with what was heard. */
    onHighlight(reason: string): void;
}

/**
 * Watches the call and the microphone for a moment worth a marker.
 *
 * Started with the buffer and stopped with it: outside a recording there is
 * nothing to mark, and the levels it reads only exist while the mixer runs.
 */
class HighlightWatcher {
    private timer: ReturnType<typeof setInterval> | null = null;
    private hooks: HighlightHooks | null = null;

    /** What the room usually sounds like, in the same units as the score. */
    private baseline = MIN_SCORE;
    private held = 0;
    private quietUntil = 0;

    get active(): boolean {
        return this.timer !== null;
    }

    start(hooks: HighlightHooks): void {
        this.stop();

        this.hooks = hooks;
        this.baseline = MIN_SCORE;
        this.held = 0;

        // A buffer that has just armed has no history to compare against, and
        // the first seconds of a capture are somebody alt-tabbing back into
        // their game, which is not a highlight.
        this.quietUntil = Date.now() + COOLDOWN_MS;

        this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);

        this.timer = null;
        this.hooks = null;
        this.held = 0;
    }

    /**
     * How lively the room is right now.
     *
     * People are counted rather than summed into an average: three friends
     * talking over each other is the thing being detected, and an average would
     * read that as quieter than one person alone with an open microphone. Your
     * own voice is read off the mixer instead of the call, because the loudest
     * moment of a solo game has nobody else in it.
     */
    private score(): { value: number; voices: number; mic: number; } {
        const { hooks } = this;
        if (!hooks) return { value: 0, voices: 0, mic: 0 };

        let voices = 0;
        let loudest = 0;

        for (const level of voiceActivity.levelsNow()) {
            if (level < VOICE_FLOOR) continue;

            voices++;
            loudest = Math.max(loudest, level);
        }

        const mic = hooks.channelLevel(MIC_CHANNEL);

        return { value: voices + loudest + mic * 1.5, voices, mic };
    }

    private tick(): void {
        const { hooks } = this;
        if (!hooks) return;

        const { value, voices, mic } = this.score();
        const bar = Math.max(MIN_SCORE, this.baseline * JUMP);

        // The baseline only ever drifts towards what is being heard, so a long
        // shouting match slowly becomes this room's normal instead of marking
        // itself forever.
        this.baseline += (value - this.baseline) * BASELINE_RISE;

        if (value < bar) {
            this.held = 0;
            return;
        }

        this.held++;
        if (this.held < HOLD_TICKS) return;

        this.held = 0;

        const now = Date.now();
        if (now < this.quietUntil) return;

        this.quietUntil = now + COOLDOWN_MS;

        const reason = voices > 1
            ? `${voices} people talking at once`
            : mic > 0.4 ? "you got loud" : "the call got loud";

        logger.info(`Highlight: ${reason}`);
        hooks.onHighlight(reason);
    }
}

export const highlights = new HighlightWatcher();
