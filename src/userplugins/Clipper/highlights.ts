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
 * keybinds. This is the watcher that drops one without being asked, and the
 * judge of what the detectors have found.
 *
 * It began as a loudness meter over the call, and that was the wrong
 * instrument. People shouting is a proxy for something happening, and a poor
 * one in both directions: the loudest second of most evenings is one person
 * swearing at their own bad play, and the ace nobody comments on is silent. It
 * marked all evening, and what it marked was rarely worth keeping.
 *
 * So nothing is marked on sound any more. Not the room, and not the game's own
 * sound either, which was tried and is the same mistake wearing a better
 * argument: there is one loopback stream and the call is inside it, so a
 * detector listening for gunfire hears the laughter too and nothing in the
 * browser can separate them. Both of them heard a good evening and marked it
 * every ninety seconds.
 *
 * What is left are the detectors that cannot hear: what the picture is doing
 * (./gameVideo), and, where the game publishes one, its own account of what
 * happened (./gameEvents). Those are the two that are wrong about a room
 * enjoying itself, which is the whole point.
 *
 * `voiceHighlights` puts the room back and `gameAudioWatch` puts the game's
 * sound back, for a quiet call, or for somebody playing alone, or for anybody
 * who would rather have the misses than the silence.
 *
 * The bar itself stays relative. A loud group is loud all evening, and a fixed
 * threshold would either mark them every ten seconds or never mark a quiet
 * group at all, so the bar is what the last minute has been like: a moment is a
 * jump above this room's own normal, held for two seconds so a door slamming is
 * not one, and then nothing for a while so one burst of laughter lands one
 * marker rather than six. `highlightSensitivity` moves the whole thing for a
 * call that is quieter or rowdier than most.
 *
 * The exception is a game saying outright that something happened. There is
 * nothing to corroborate and nothing to wait for, so those mark at once.
 */

import { Logger } from "@utils/Logger";

import { gameAudio } from "./gameAudio";
import { syncGameEvents } from "./gameEvents";
import { gameVideo } from "./gameVideo";
import { MIC_CHANNEL, SYSTEM_CHANNEL } from "./mixer";
import { settings } from "./settings";
import { signals } from "./signals";
import { voiceActivity } from "./voice";

const logger = new Logger("Clipper");

/** How often the board is added up. Two ticks per activity bucket. */
const TICK_MS = 100;

/** A voice below this is background, not somebody making a point. */
const VOICE_FLOOR = 0.45;

/**
 * How much time above the bar makes a moment, counted in ticks.
 *
 * Two seconds of it, and because a dip takes two ticks off rather than one (see
 * `HOLD_DECAY`) a patchy moment has to run three or four seconds to get there.
 * That is the intended shape: something that only half holds up has to last
 * longer to earn a marker.
 */
const HOLD_TICKS = 20;

/**
 * What a tick under the bar takes off that hold, rather than resetting it.
 *
 * Speech has gaps in it, and the levels are smoothed over a fifth of a second,
 * so a real two-second moment dips below the bar once or twice on its way past.
 * Wiping the count on every dip meant the loud moments that lasted were the
 * ones least likely to be caught.
 */
const HOLD_DECAY = 2;

/** Nothing else is marked for this long afterwards. */
const COOLDOWN_MS = 45_000;

/** And for this long after something a game reported itself. */
const CERTAIN_COOLDOWN_MS = 12_000;

/**
 * How fast the baseline follows the room, as a share of each tick.
 *
 * Slow enough that a burst does not raise the bar it is being measured
 * against - a minute of ordinary talking is roughly what it averages over.
 */
const BASELINE_RISE = 0.0015;

/**
 * The jump over the baseline that counts, and the floor under it.
 *
 * The floor is what the picture has to reach on its own, now that nothing is
 * listening by default: damage plus a screen that is moving gets there, and a
 * screen that is merely moving does not. A game reporting a kill outright never
 * comes through here at all - see `claimCertain`.
 */
const JUMP = 1.9;
const MIN_SCORE = 2.1;

/** What your own microphone is worth, on top of counting as a person. */
const MIC_WEIGHT = 1.5;

/**
 * What one raised voice is worth once something is actually reading the game.
 *
 * Not zero: somebody reacting is real evidence, and it is usually the first to
 * arrive. Just not enough on its own any more - at this weight a shout needs
 * about a burst of gunfire or a busy screen alongside it, which is exactly the
 * difference between the moment and the bad play being sworn at.
 */
const HUMAN_DAMPING = 0.7;

/** Under this many people, the room is only corroboration. */
const CROWD = 2;

/** What each setting multiplies the bar by. */
const SENSITIVITY: Record<string, number> = { loose: 0.75, normal: 1, strict: 1.4 };

function sensitivity(): number {
    return SENSITIVITY[settings.store.highlightSensitivity as string] ?? 1;
}

interface HighlightHooks {
    /** Level of one of the recorder's own channels, 0 to 1. */
    channelLevel(id: string): number;
    /** Frequency bins of one of those channels, for ./gameAudio. */
    channelSpectrum(id: string): { bins: Uint8Array; hz: number; } | null;
    /** The video being captured, for ./gameVideo. */
    videoTrack(): MediaStreamTrack | null;
    /** Called once per moment, with what was heard or seen. */
    onHighlight(reason: string): void;
}

/**
 * Watches the call, the game and the capture for a moment worth a marker.
 *
 * Started with the buffer and stopped with it: outside a recording there is
 * nothing to mark, and most of what it reads only exists while the mixer runs.
 */
class HighlightWatcher {
    private timer: ReturnType<typeof setInterval> | null = null;
    private hooks: HighlightHooks | null = null;

    /**
     * What the evening usually scores, in the same units as the bar.
     *
     * Started at the reading that puts the bar exactly on its floor rather than
     * at the floor itself: the bar is this times `JUMP`, so starting it at
     * `MIN_SCORE` opened every recording with a bar of nearly four, and the
     * first minute of every buffer - which is a minute of real play - could not
     * mark anything at all while it drifted back down.
     */
    private baseline = MIN_SCORE / JUMP;
    private held = 0;
    private quietUntil = 0;

    /** The same, for the things a game reported: shorter, and its own clock. */
    private certainUntil = 0;

    get active(): boolean {
        return this.timer !== null;
    }

    start(hooks: HighlightHooks): void {
        this.stop();

        this.hooks = hooks;
        this.baseline = MIN_SCORE / JUMP;
        this.held = 0;

        // A buffer that has just armed has no history to compare against, and
        // the first seconds of a capture are somebody alt-tabbing back into
        // their game, which is not a highlight.
        this.quietUntil = Date.now() + COOLDOWN_MS;

        // No warm-up for those: a game reporting a kill is right about it from
        // the first second, whatever the room has been doing.
        this.certainUntil = 0;

        signals.clear();

        if (settings.store.gameAudioWatch) {
            gameAudio.start({
                spectrum: () => hooks.channelSpectrum(SYSTEM_CHANNEL),
                busy: () => this.talking()
            });
        }

        if (settings.store.gameVideoWatch) {
            gameVideo.start({ track: () => hooks.videoTrack() });
        }

        // Not awaited: it writes a file and opens a socket, and the watcher must
        // be running before either of those finishes.
        void syncGameEvents().catch(e => logger.warn("Could not start the game integrations", e));

        // Worth saying out loud: with the room demoted and nothing reading the
        // game, there is no longer anything that can reach the bar.
        if (!settings.store.voiceHighlights && !settings.store.gameAudioWatch
            && !settings.store.gameVideoWatch && !settings.store.gameIntegrations) {
            logger.warn("Automatic markers are on, but nothing is watching: turn on a game detector, or `voiceHighlights` to mark on the call alone");
        }

        this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);

        this.timer = null;
        this.hooks = null;
        this.held = 0;

        gameAudio.stop();
        gameVideo.stop();
        signals.clear();

        // The game feeds are deliberately left running. They belong to the
        // setting rather than to the buffer, and putting the listener down
        // between two clips would mean writing Counter-Strike's config again on
        // a port it will not be posting to - see `startFeeds`.
    }

    /** Whether anybody in the call is talking right now. */
    private talking(): boolean {
        for (const level of voiceActivity.levelsNow()) {
            if (level >= VOICE_FLOOR) return true;
        }

        return false;
    }

    /**
     * How lively the room is right now.
     *
     * People are counted rather than summed into an average: three friends
     * talking over each other is the thing being detected, and an average would
     * read that as quieter than one person alone with an open microphone. Your
     * own voice is read off the mixer instead of the call, because the loudest
     * moment of a solo game has nobody else in it - and it counts as a person
     * in its own right, so that one player alone can still reach the bar.
     */
    private room(): { value: number; people: number; note: string; } {
        const { hooks } = this;
        if (!hooks) return { value: 0, people: 0, note: "" };

        let voices = 0;
        let loudest = 0;

        for (const level of voiceActivity.levelsNow()) {
            if (level < VOICE_FLOOR) continue;

            voices++;
            loudest = Math.max(loudest, level);
        }

        const mic = hooks.channelLevel(MIC_CHANNEL);
        const mine = mic >= VOICE_FLOOR ? 1 : 0;
        const value = voices + loudest + mine + mic * MIC_WEIGHT;

        const note = voices > 1
            ? `${voices} people talking at once`
            : mine ? "you got loud" : "the call got loud";

        return { value, people: voices + mine, note };
    }

    /**
     * What the room is worth on the board.
     *
     * Nothing, unless the setting says the call may mark a moment by itself.
     * Weighing it down was tried first and it was the wrong shape of fix: a
     * quarter of the evidence for something that happens constantly still adds
     * up, and it only took one busy screen alongside it to mark the laughing
     * rather than the play. It is not weighed down now, it is simply not
     * evidence.
     *
     * With the setting on it is scored the way it always was, except that one
     * person on their own is scaled back while a detector is reading the game -
     * several people going at once never was the false positive.
     */
    private voiceScore(room: { value: number; people: number; }): number {
        if (!settings.store.voiceHighlights) return 0;

        const alone = signals.watching() && room.people < CROWD;
        return alone ? room.value * HUMAN_DAMPING : room.value;
    }

    private tick(): void {
        const { hooks } = this;
        if (!hooks) return;

        const now = Date.now();

        // A game said so. Nothing to weigh up and nothing to wait two seconds
        // for, so this jumps the whole queue - it only has to not be the third
        // one in ten seconds.
        const certain = signals.claimCertain();
        if (certain && now >= this.certainUntil) {
            this.held = 0;
            this.certainUntil = now + CERTAIN_COOLDOWN_MS;

            // Kept from cutting the room's own cooldown short, only extended.
            this.quietUntil = Math.max(this.quietUntil, now + CERTAIN_COOLDOWN_MS);

            logger.info(`Highlight: ${certain}`);
            hooks.onHighlight(certain);
            return;
        }

        const room = this.room();

        signals.report("voices", this.voiceScore(room), room.note);

        const { value, notes } = signals.read();
        const bar = Math.max(MIN_SCORE, this.baseline * JUMP) * sensitivity();

        // The baseline only ever drifts towards what is being heard, so a long
        // shouting match slowly becomes this room's normal instead of marking
        // itself forever.
        this.baseline += (value - this.baseline) * BASELINE_RISE;

        if (value < bar) {
            this.held = Math.max(0, this.held - HOLD_DECAY);
            return;
        }

        this.held++;
        if (this.held < HOLD_TICKS) return;

        this.held = 0;
        if (now < this.quietUntil) return;

        this.quietUntil = now + COOLDOWN_MS;
        this.certainUntil = Math.max(this.certainUntil, now + CERTAIN_COOLDOWN_MS);

        // The two biggest contributors, which is usually the thing and the
        // reaction to it: "shots in the game, and 3 people talking at once".
        const reason = notes.filter(Boolean).slice(0, 2).join(", and ") || "something happened";

        logger.info(`Highlight: ${reason}`);
        hooks.onHighlight(reason);
    }
}

export const highlights = new HighlightWatcher();
