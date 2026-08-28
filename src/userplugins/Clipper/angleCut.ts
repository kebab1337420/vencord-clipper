/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - cutting between everybody's angle instead of tiling them
 *
 * ./multipov gets four people to save the same ten seconds, and ./angles pulls
 * their clips back off the channel onto one shot. What the studio could then do
 * with them was put them all on screen at once - a grid, or one in the corner of
 * another - which is a way of showing that four angles exist rather than a way
 * of watching the moment. Nobody edits like that. An edit cuts: the person the
 * kill is happening to while it lands, then the one watching it happen, then
 * back for the aftermath.
 *
 * So this decides who is on screen, second by second, and turns one shot with
 * angles hanging off it into a run of shots that cut between them.
 *
 * What it decides on is sound, for the same reason ./gameAudio listens: it is
 * what the recordings actually have in common. Whoever the fight is happening to
 * is the loudest of the four, because the shots landing near them are in their
 * capture and thirty metres away in everybody else's - and their own reaction is
 * in their microphone. Every angle is scored against its own normal rather than
 * against the others, so the person with their volume up is not simply on screen
 * the whole time.
 *
 * That normal is measured over half a minute either side of the shot rather than
 * over the shot itself, and the difference is the whole detector. Measured over
 * the shot, an angle that is loud from beginning to end averages out to exactly
 * its own average - a flat score of one - and loses to a quiet angle with a
 * single footstep in it. The person the fight is happening to is precisely the
 * one who is loud from beginning to end, so the first version of this reliably
 * cut to everybody except them.
 *
 * Two rules on top of that, which are what makes it read as an edit rather than
 * as a level meter:
 *
 *   - a shot has a floor and a ceiling. Under the floor it is a flicker between
 *     angles; over the ceiling it stops being a multi-angle edit at all.
 *   - after somebody's peak the cut goes to whoever else has something to show,
 *     rather than back to whoever is loudest. That is the reaction shot, and it
 *     is the reason to have four angles in the first place.
 *
 * Nothing here is clever about the timeline: it produces ordinary segments
 * pointing at ordinary sources, so any of them can be trimmed, reordered or
 * thrown away by hand afterwards like anything else on it.
 */

import { DEFAULT_EFFECTS, newId, type Segment } from "./studio";

/** One angle, lined up against the shot being cut. */
export interface AngleTrack {
    sourceId: string;
    /**
     * Seconds to add to the base shot's clock to reach the same instant here.
     *
     * The number `alignTo` works out, or the one set by hand on the slider: the
     * angles were saved by different clients seconds or minutes apart.
     */
    offset: number;
    /** How loud this file is over its whole length, `hz` readings a second. */
    envelope: Float32Array;
    hz: number;
}

interface AngleCutOptions {
    /** Shortest a shot may be, in seconds. */
    minShot: number;
    /** And longest, before the edit cuts away from whatever is happening. */
    maxShot: number;
    /**
     * How much better another angle has to look before it takes the screen.
     *
     * Straight "whoever is loudest" cuts on every footstep. This is the margin
     * that makes a cut mean something happened somewhere else.
     */
    bias: number;
    /**
     * How far above its own normal an angle has to go to count as a peak.
     *
     * An envelope is a plain amplitude and not decibels, so this is a multiple
     * rather than a jump: twice as loud as this angle usually is, and a little
     * over. Set near 1 it fires on every shot and the edit becomes a rota.
     */
    peak: number;
}

const DEFAULT_ANGLE_CUT: AngleCutOptions = {
    minShot: 1.6,
    maxShot: 6,
    bias: 1.25,
    peak: 2.2
};

/**
 * How fast the edit cuts, as somebody editing thinks of it.
 *
 * A pace rather than two numbers, because "how long is a shot" is the only
 * decision worth putting in front of anybody: everything else here is a
 * property of the footage rather than a taste.
 */
export const ANGLE_PACES: Record<string, { minShot: number; maxShot: number; }> = {
    fast: { minShot: 1.1, maxShot: 3.5 },
    normal: { minShot: 1.6, maxShot: 6 },
    slow: { minShot: 2.6, maxShot: 9 }
};

/** How often the angles are compared, in seconds. Well under one shot. */
const STEP = 0.2;

/** The window each reading is smoothed over, so one crack is not a shot. */
const SMOOTH = 0.6;

/**
 * How far either side of the shot an angle's own normal is measured.
 *
 * Wide enough that the shot itself barely moves it, which is the point: the
 * question is how loud this angle is *for once*, and a normal measured over the
 * same seconds being scored cannot answer it. Clamped to the file by `meanOf`,
 * so a short clip simply uses all of itself.
 */
const NORMAL_WINDOW = 30;

/** Below this share of its own normal, an angle has nothing to show. */
const DEAD = 0.4;

/** Guard for the divisions: an envelope of pure silence is a real input. */
const EPSILON = 1e-6;

/** Loudness of one angle at one instant, against its own normal. -1 is absent. */
type Score = number;

/** Mean of an envelope over a window of the file, in that file's own seconds. */
function meanOf(track: AngleTrack, from: number, to: number): number {
    const first = Math.max(0, Math.round(from * track.hz));
    const last = Math.min(track.envelope.length - 1, Math.round(to * track.hz));
    if (last < first) return -1;

    let sum = 0;
    for (let i = first; i <= last; i++) sum += track.envelope[i];

    return sum / (last - first + 1);
}

/** How long a track's file runs, as far as its envelope says. */
function lengthOf(track: AngleTrack): number {
    return track.envelope.length / Math.max(1, track.hz);
}

/**
 * Every angle's loudness at every step of the shot, against its own normal.
 *
 * Against its own normal and not against the others, because the angles are
 * four different microphones at four different settings: the comparison that
 * means something is "louder than this person usually is", which is the same
 * thing ./gameAudio does to a single stream over time.
 */
function readTracks(tracks: AngleTrack[], from: number, to: number, steps: number): Score[][] {
    const normals = tracks.map(track =>
        Math.max(EPSILON, meanOf(track,
            from + track.offset - NORMAL_WINDOW,
            to + track.offset + NORMAL_WINDOW)));

    const rows: Score[][] = [];

    for (let step = 0; step < steps; step++) {
        const at = from + step * STEP;
        const row: Score[] = [];

        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const middle = at + track.offset;

            // The angle does not cover this instant: their buffer started later
            // or ran out earlier, and there is nothing there to cut to.
            if (middle < 0 || middle > lengthOf(track)) {
                row.push(-1);
                continue;
            }

            const mean = meanOf(track, middle - SMOOTH / 2, middle + SMOOTH / 2);
            row.push(mean < 0 ? -1 : mean / normals[i]);
        }

        rows.push(row);
    }

    return rows;
}

/** Mean score of one angle across a run of steps, or -1 if it drops out of it. */
function over(rows: Score[][], index: number, from: number, to: number): number {
    let sum = 0;
    let count = 0;

    for (let step = from; step < to && step < rows.length; step++) {
        const score = rows[step][index];
        if (score < 0) return -1;

        sum += score;
        count++;
    }

    return count ? sum / count : -1;
}

interface Shot {
    track: number;
    from: number;
    to: number;
}

/**
 * Who is on screen, from the start of the shot to the end of it.
 *
 * Walked a shot at a time rather than a step at a time: the question is never
 * "who is loudest now" but "who is worth the next two seconds", and asking it
 * that way is what stops the edit strobing between two angles trading the lead
 * every quarter of a second.
 */
function pickShots(rows: Score[][], options: AngleCutOptions): Shot[] {
    const shots: Shot[] = [];
    const minSteps = Math.max(1, Math.round(options.minShot / STEP));
    const maxSteps = Math.max(minSteps, Math.round(options.maxShot / STEP));

    let step = 0;
    let holder = -1;

    /** Whether the shot just ended on somebody's peak, which wants a reaction. */
    let afterPeak = false;

    while (step < rows.length) {
        const window = Math.min(minSteps, rows.length - step);
        const scores = rows[step].map((unused, i) => over(rows, i, step, step + window));

        let pick = -1;
        let best = -1;

        for (let i = 0; i < scores.length; i++) {
            // The angle already on screen has to be beaten by a margin - and
            // the one that just peaked is passed over entirely, so the cut goes
            // to somebody watching it rather than back to the same picture.
            if (i === holder && afterPeak) continue;

            const worth = i === holder ? scores[i] * options.bias : scores[i];
            if (worth > best) {
                best = worth;
                pick = i;
            }
        }

        // Nobody covers this stretch: hold whoever is on, or the base angle if
        // nothing has started yet.
        if (pick < 0 || best < 0) pick = holder < 0 ? 0 : holder;

        // A reaction shot is worth cutting to while it is quiet, but not when
        // there is nothing on it at all.
        if (afterPeak && holder >= 0 && scores[pick] >= 0 && scores[pick] < DEAD) pick = holder;

        // Whatever came out of all that has to actually be there. The base
        // angle is the one the shot was cut from, so it always is, and falling
        // back to it is what keeps the edit the same length as the shot it
        // replaced rather than a few clamped seconds shorter.
        if (over(rows, pick, step, step + window) < 0) pick = 0;

        let end = step + window;
        let peaked = false;

        // The whole of the opening window, not only its first reading: at a
        // shot and a half a second, a peak landing anywhere but the first fifth
        // of it would otherwise never call for a reaction shot at all.
        for (let s = step; s < end && s < rows.length; s++) {
            if (rows[s][pick] >= options.peak) peaked = true;
        }

        // Stay on this angle while it is still the one to be on, up to the
        // ceiling: a fight does not want cutting away from every two seconds.
        while (end < rows.length && end - step < maxSteps) {
            // Never past the ceiling, which is a ceiling rather than the point
            // at which one more whole window is added on top of it.
            const next = Math.min(minSteps, rows.length - end, maxSteps - (end - step));
            if (next <= 0) break;

            const mine = over(rows, pick, end, end + next);
            if (mine < 0) break;

            let rival = -1;
            for (let i = 0; i < rows[end].length; i++) {
                if (i !== pick) rival = Math.max(rival, over(rows, i, end, end + next));
            }

            if (rival > mine * options.bias) break;

            for (let s = end; s < end + next && s < rows.length; s++) {
                if (rows[s][pick] >= options.peak) peaked = true;
            }

            end += next;
        }

        const last = shots[shots.length - 1];

        // Same angle as the shot before it is one shot, not two cuts to the
        // same picture. Happens when a hold was broken by an angle dropping out.
        if (last && last.track === pick) last.to = end;
        else shots.push({ track: pick, from: step, to: end });

        holder = pick;
        afterPeak = peaked;
        step = end;
    }

    // A sliver at the end is not a shot. It goes to whoever was on before it.
    const tail = shots[shots.length - 1];
    if (shots.length > 1 && tail && (tail.to - tail.from) * STEP < options.minShot / 2) {
        shots[shots.length - 2].to = tail.to;
        shots.pop();
    }

    return shots;
}

/**
 * Turns one shot with angles on it into a run of shots that cut between them.
 *
 * The base segment is the first track, at offset zero: it is the one whose clock
 * everything else was lined up against. What comes back replaces it on the
 * timeline in order, and each piece is an ordinary segment, so the caller can
 * trim them, drop one, or undo the whole thing in a single step.
 *
 * The segment comes back unchanged when there is nothing to decide - one angle,
 * no sound to read, or a shot too short to hold two of anything.
 */
export function cutBetweenAngles(base: Segment, tracks: AngleTrack[], options: Partial<AngleCutOptions> = {}): Segment[] {
    const settings = { ...DEFAULT_ANGLE_CUT, ...options };
    const from = Math.min(base.from, base.to);
    const to = Math.max(base.from, base.to);
    const length = to - from;

    if (tracks.length < 2 || length < settings.minShot * 2) return [base];

    const steps = Math.floor(length / STEP);
    if (steps < 2) return [base];

    const rows = readTracks(tracks, from, to, steps);
    const shots = pickShots(rows, settings);
    if (shots.length < 2) return [base];

    return shots.map((shot, i) => {
        const track = tracks[shot.track];
        const first = i === 0;
        const finish = i === shots.length - 1;

        // The last shot runs to the end of the range rather than to the end of
        // its own steps, so a length that did not divide evenly is not lost.
        const start = Math.max(0, from + shot.from * STEP + track.offset);
        const end = Math.min(lengthOf(track), (finish ? to : from + shot.to * STEP) + track.offset);

        const segment: Segment = {
            id: newId(),
            sourceId: track.sourceId,
            from: start,
            to: Math.max(start + STEP, end),
            speed: base.speed,
            volume: base.volume,
            ...(base.pitch === undefined ? {} : { pitch: base.pitch }),
            effects: {
                ...(base.effects ?? DEFAULT_EFFECTS),
                // The fades belong to the edit, not to every piece of it.
                fadeIn: first ? base.effects?.fadeIn ?? 0 : 0,
                fadeOut: finish ? base.effects?.fadeOut ?? 0 : 0
            },
            ...(base.fill ? { fill: true } : {})
        };

        // A moving framing was set on the base angle's own frames, so it means
        // nothing on somebody else's capture and is left off there.
        if (shot.track === 0 && base.moves?.length) segment.moves = base.moves;

        return segment;
    });
}
