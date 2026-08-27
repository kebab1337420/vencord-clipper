/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - putting a clip back together out of its separate tracks
 *
 * A clip's own soundtrack is whole-machine loopback: the game, the music and
 * every voice in the call already mixed together. That is the whole reason a
 * mute was ever hard - there is no arithmetic that takes one voice back out of
 * a mix.
 *
 * The call does not only exist in there. Every participant is also recorded on
 * a track of their own - by Discord's clip engine, which writes one per person
 * into the file itself, or by `voiceRecord.ts` into files beside it - and this
 * is where the two halves meet:
 *
 *      bed  ──┬── direct  x (1 - m) ───────────────┐
 *             └── lowpass x m ───────────────┐     ├── knee ── out
 *      alice ──────── x m x gain x boost ────┤     │
 *      bob   ──────── x m x gain x boost ────┘─────┘
 *
 * `m` is "somebody who has been turned down is talking right now", read from
 * that person's own recording rather than guessed from an activity envelope. It
 * is zero for almost all of a clip, and while it is zero nothing happens at all:
 * the bed plays exactly as recorded and the separate tracks are silent, so a
 * clip with nobody muted sounds like the file.
 *
 * While it is one, the bed keeps only what a voice cannot reach - the sub-bass
 * under 45Hz, so impacts and engines and music bottom carry on - and everybody
 * who was *not* turned down comes back in full band from their own track. The
 * muted person is simply not connected. They are not filtered, not ducked, not
 * estimated: their samples never enter the sum.
 *
 * Measured on a seven-person clip, muting one person leaves them 47 to 70dB
 * under the level they had in the bed - which is to say under the game's own
 * noise - while the people left come back 1 to 3dB *over* the level the bed had
 * for them, which is deliberate and is what `RETURN_BOOST` is for.
 *
 * Three things have to be measured for that to hold, and all three are measured
 * per clip rather than assumed:
 *
 *  - *When*. The bed reaches this plugin through the machine's output device
 *    and the engine's tracks do not, so the same word sits at two different
 *    places on the two clocks - 200ms apart on a real clip, and the other way
 *    round for the microphone, which is in the bed early rather than late. A
 *    notch opened 200ms off cuts silence and leaves the word, and a track added
 *    back 200ms off says a sentence the bed has already finished saying. It is
 *    measured sentence by sentence and settled by the median, because a whole
 *    track is mostly silence and silence matches at any offset.
 *  - *How loud*. A track is tapped before the client's per-user volume and
 *    before whatever the machine does on the way to the loopback, so a voice
 *    added back at its own level can come back at twice the one it had.
 *  - *How quiet counts as talking*. Not the same answer for the two jobs. A
 *    level is read from moments somebody is properly speaking; a mute has to
 *    cover everything of theirs that can be heard at all, which is a threshold
 *    seven times lower and a window a third of a second longer at the tail.
 *
 * And one thing has to be assumed rather than measured. A track answers for the
 * span it covers and for nothing outside it, and the bed outlives the tracks by
 * about a second at the end of every clip. Silence there is not evidence of
 * silence, so the notch is held open past the last sample of anybody who was
 * turned down - which is why the end of a clip does not hand the muted voice
 * back at the moment it is most listened to.
 */

import { Logger } from "@utils/Logger";

import { loadVoiceTrack } from "./clips";
import { hasVoiceTracks, readNativeAudio } from "./nativeTracks";
import { type VoiceFileMeta, voiceGainOf, type VoiceLevels } from "./voice";
import { cascade } from "./voiceBand";
import type { MixTarget, VoiceMix } from "./voiceMix";

const logger = new Logger("Clipper");

/** Envelope resolution, in points per second. 20ms is finer than a syllable. */
const ENV_HZ = 50;

/**
 * Below this RMS a hop is not speech worth measuring against the bed.
 *
 * A measuring threshold, not a listening one: it decides where a track is loud
 * enough to say how loud that person is in the bed, and being generous there
 * would have a murmur set the level for a shout.
 */
const ENV_FLOOR = 0.015;

/**
 * Where the mute window opens, which is far below where a voice is measured.
 *
 * These two used to be one number, and the fragments left over in a mute were
 * that. A track's quiet moments sit at 0.00000 and the two people who never
 * spoke measure -91 dB and -66 dB, so anything a track holds at all is that
 * person; measured on a real clip, 0.015 left 2% of somebody's speech energy
 * outside their own mute window - the tail of a sentence, a murmur, a word
 * said off-mic - and every bit of that was audible, because the bed around it
 * had just been cut away. At 0.002 it is 0.04%, and the window is open 23% of
 * the clip rather than 16%.
 */
const GATE_FLOOR = 0.002;

/**
 * How far the mute window is opened either side of the speech that caused it.
 *
 * Ahead for the attack, behind for the tail, and the tail is the long one: a
 * voice reaches the bed through the output device and a track through the
 * network, the two clocks are lined up to the nearest 20ms and no closer, and
 * what a word leaves behind it in a room is longer than what it announces.
 */
const PAD_AHEAD = 0.12;
const PAD_BEHIND = 0.35;

/**
 * The band every measurement is taken in.
 *
 * Speech and nothing else. A level read across the whole spectrum is mostly the
 * game's bass, which is what made a voice look four times louder in the bed
 * than in its own track and brought it back that much too loud.
 */
const BAND_LO = 200;
const BAND_HI = 4000;

/**
 * Where the voice is taken to live.
 *
 * Only the bottom is kept now. `voiceBand.ts` also lets everything above 12kHz
 * back through, on the grounds that a game's air is up there and a voice is
 * not - and on a real clip that is simply false: while one person spoke, the
 * bed above 12kHz measured 34dB over a quiet room and sat 4.7dB louder than
 * everything left under 45Hz. That band is their sibilance, and with the whole
 * middle of the bed cut away there was nothing left to mask it. It is the
 * whistle a mute used to leave behind. The game loses nothing worth having:
 * with nobody talking the same band is 22dB under the bed's own middle.
 */
const LOW_HZ = 45;
const SECTIONS = 4;

/**
 * How much louder than the bed the voices come back while the notch is open.
 *
 * Not a correction: the match already puts each track at the level the bed had
 * for it, and measured on a real clip the people left come back within a dB of
 * that. It is there because the moment does not sound the same any more. The
 * game, the music and the room have just been cut away to hide one person, and
 * a voice that used to sit on top of all that is suddenly alone and dry, which
 * reads as further away rather than as louder. This pays that back.
 *
 * The muted person pays for it too, at a fifth of the rate: 1.6 puts the others
 * 1 to 2.7dB over their own recorded level and moves a mute from -51 to -47dB,
 * which is still far under the game's noise floor.
 */
const RETURN_BOOST = 1.6;

/**
 * How the ceiling reads the bed, and how far down it is allowed to push.
 *
 * The two clocks are lined up to the nearest 20ms and no closer, so at the
 * attack of a word the track can be loud at a hop where the bed is not yet -
 * and a ceiling read at that one hop concluded the voice was 10dB too hot and
 * took the front off it. Reading the loudest hop within 60ms answers the
 * question that was meant ("was the bed ever this loud around here") instead of
 * one about alignment, and the floor stops any single hop being gutted: it took
 * the worst hop of a rebuild from 0.09 to 0.60.
 */
const CEIL_SPAN = 3;
const CEIL_FLOOR = 0.6;

/**
 * Where the output starts being bent back rather than clipped.
 *
 * The bed of a loud clip already touches full scale, so voices added on top of
 * a boost can cross it. It is rare - 86 samples of a 10 second clip at the
 * worst measured setting - and a soft knee costs nothing anywhere else: the
 * levels either side of it come back identical to three decimals.
 */
const LIMIT_KNEE = 0.95;

/**
 * Envelope points the notch takes to close where a track runs out.
 *
 * It finishes on the track's last point rather than starting there, so nothing
 * of the bed is left uncovered at the seam - and it is short, because the hop
 * either side of that seam can be a loud one and a long fade hands most of it
 * back. Measured over the second past the end of the tracks: full bed before,
 * 43dB down after.
 */
const HOLD_EDGE = 3;

/**
 * How far from anybody's voice a seam in the notch has to land.
 *
 * A seam is the 20ms where the bed is fading out and the tracks are fading in,
 * and for those 20ms the same voice is present twice: once through the machine
 * and once through the network, a few milliseconds apart. Two copies of one
 * voice at a small offset do not add up, they comb - and measured on a real
 * clip a seam that landed inside a word took 17dB out of the person who was
 * still talking. That is the stutter: not the muted person coming back, the
 * other one dropping out for a fiftieth of a second every time the window
 * moves.
 *
 * It cannot be crossfaded away, because the cancellation is what the crossfade
 * *is*. So the seams are moved instead: while anybody who was kept is talking,
 * the notch holds whatever its strongest claim over that stretch was, and it is
 * only allowed to move once they have been quiet for this long either side. Two
 * hops of clearance is enough to leave the crossfade room, and costs a few
 * percent of the clip: measured, the notch went from open 24-54% of a clip to
 * 35-60%, and what is given up in those extra moments is the game underneath
 * somebody's sentence rather than the sentence.
 */
const SEAM_CLEAR = 0.06;

/** How far a track may be rescaled to sit at the level it has in the bed. */
const MATCH_MIN = 0.2;
const MATCH_MAX = 4;

/** Hops of speech a track needs before it is measured rather than assumed. */
const MATCH_HOPS = 15;

/** How far the two clocks are allowed to be apart, in envelope points. */
const MAX_LAG = 25;

/** How well a stretch has to match the bed before its alignment counts. */
const LAG_FIT = 0.25;

/**
 * The shortest run of speech worth measuring an alignment on, in points.
 *
 * One number for a whole track is the wrong shape of answer. A track is mostly
 * silence, and silence matches the bed's silence at every offset equally well,
 * so the score over a whole clip is decided by how the quiet parts happen to
 * line up rather than by the voice. Measured on a real seven-person clip, the
 * microphone's own track came out +160ms that way while its one sentence
 * plainly sat at -60ms - and a track re-injected 220ms out replays a tail the
 * bed has already played, which is heard as the end of the sentence twice.
 *
 * So each sentence is measured on its own and the middle answer wins: a run
 * this long or longer is scored, the ones that match well enough to be trusted
 * vote, and the winner is the median weighted by how well each matched. On the
 * same clip every run of speech in the call agreed on +210ms measured directly
 * against the bed, against whole-clip readings of 0.34 to 0.58 that put one
 * track 360ms away from that.
 */
const LAG_SPAN = 8;

/** One person's own recording, before anything has been measured about it. */
interface RawLane {
    userId: string;
    name: string;
    /** Seconds from the clip's start to this track's first sample. Signed. */
    offset: number;
    buffer: AudioBuffer;
}

interface Lane extends RawLane {
    /** Rescaling that puts it at the loudness it has inside the bed. */
    gain: number;
    /** Speech loudness on the clip's clock, one point per `ENV_HZ`. */
    rms: Float32Array;
    /** Where a mute has to hold: the same, gated and padded either side. */
    gate: Float32Array;
}

interface Held {
    key: string;
    /**
     * The clip's own soundtrack, or null when the file holds only the voices.
     *
     * Null is what a clip written by the engine alone looks like: there is no
     * mixed bed to notch, so the answer is the sum of the tracks themselves.
     */
    bed: AudioBuffer | null;
    /** Where the bed starts on the clip's clock, in seconds. */
    bedOffset: number;
    /** The bed's speech loudness, against which the tracks are measured. */
    bedEnvelope: Float32Array;
    lanes: Lane[];
    points: number;
}

/**
 * The decoded tracks of the file being worked on, kept for the next slider.
 *
 * One clip's worth: a decode is the whole recording in memory at 32 bits a
 * sample per person, and moving between clips in the library is not what has to
 * be instant. Moving a level is, and that reads back from here.
 */
let held: Held | null = null;

/** Clips already known to have no separate tracks, so they are asked once. */
const bare = new Set<string>();

/**
 * The decode currently running, so two callers wait on one of them.
 *
 * The cache above only answers once a decode has finished, and a decode is
 * seconds of work on every track of the clip. A slider released while a render
 * is starting reaches here twice, and without this both of them would decode
 * the same files and hold two copies of them at once.
 */
let loading: { key: string; work: Promise<Held | null>; } | null = null;

/**
 * Speech-band RMS per hop of one channel, on the clip's clock.
 *
 * The band is one pole each way rather than a proper filter: what it is for is
 * deciding when somebody talks and how loud they are next to the same voice in
 * the bed, and for both of those a rolloff is as good as a wall.
 */
function envelopeOf(buffer: AudioBuffer, offset: number, points: number): Float32Array {
    const out = new Float32Array(points);
    const rate = buffer.sampleRate;
    const hop = Math.max(1, Math.round(rate / ENV_HZ));
    const data = buffer.getChannelData(0);

    const lowCoeff = Math.exp((-2 * Math.PI * BAND_HI) / rate);
    const highCoeff = Math.exp((-2 * Math.PI * BAND_LO) / rate);

    let low = 0;
    let high = 0;

    // Where this track's first sample sits on the clip's clock.
    let at = Math.round(offset * ENV_HZ);

    let sum = 0;
    let taken = 0;

    for (let i = 0; i < data.length; i++) {
        low = lowCoeff * low + (1 - lowCoeff) * data[i];
        high = highCoeff * high + (1 - highCoeff) * low;

        const value = low - high;
        sum += value * value;

        if (++taken < hop) continue;

        if (at >= 0 && at < points) out[at] = Math.sqrt(sum / hop);

        at++;
        sum = 0;
        taken = 0;

        if (at >= points) break;
    }

    return out;
}

/** Turns loudness into a 0/1 gate, opened either side of every loud hop. */
function gateOf(rms: Float32Array, floor: number, ahead: number, behind: number): Float32Array {
    const gate = new Float32Array(rms.length);
    const before = Math.round(ahead * ENV_HZ);
    const after = Math.round(behind * ENV_HZ);

    for (let i = 0; i < rms.length; i++) {
        if (rms[i] < floor) continue;

        const from = Math.max(0, i - before);
        const to = Math.min(rms.length - 1, i + after);

        for (let j = from; j <= to; j++) gate[j] = 1;
    }

    return gate;
}

/** The window a mute opens: everything that person can be heard in. */
function muteGate(rms: Float32Array): Float32Array {
    return gateOf(rms, GATE_FLOOR, PAD_AHEAD, PAD_BEHIND);
}

/**
 * The window a person is measured in: only where they are properly talking.
 *
 * Deliberately the narrower of the two. The mute window is generous because
 * missing a syllable is audible; this one decides which moments are somebody
 * on their own, and being generous there would call an overlap a solo and set
 * that person's level from somebody else's voice.
 */
function speechGate(rms: Float32Array): Float32Array {
    return gateOf(rms, ENV_FLOOR, 0.18, 0.18);
}

/**
 * How alike two envelopes are with the lane held `lag` points later.
 *
 * `from` and `to` bound the lane, not the bed, so one sentence can be scored
 * without the silence around it having a say. Whatever falls off the bed's
 * ends at that offset is left out.
 */
function correlate(
    bed: Float32Array,
    lane: Float32Array,
    lag: number,
    from = 0,
    to = lane.length
): number {
    let count = 0;
    let bedMean = 0;
    let laneMean = 0;

    for (let i = from; i < to; i++) {
        const at = i - lag;
        if (at < 0 || at >= bed.length) continue;

        bedMean += bed[at];
        laneMean += lane[i];
        count++;
    }

    if (count < 8) return -1;

    bedMean /= count;
    laneMean /= count;

    let bedVar = 0;
    let laneVar = 0;
    let joint = 0;

    for (let i = from; i < to; i++) {
        const at = i - lag;
        if (at < 0 || at >= bed.length) continue;

        const a = bed[at] - bedMean;
        const b = lane[i] - laneMean;

        bedVar += a * a;
        laneVar += b * b;
        joint += a * b;
    }

    if (bedVar <= 0 || laneVar <= 0) return -1;

    return joint / Math.sqrt(bedVar * laneVar);
}

/** Where a stretch of an envelope sits best against the bed's. */
function bestLag(
    bed: Float32Array,
    lane: Float32Array,
    from = 0,
    to = lane.length
): { lag: number; fit: number; } {
    let lag = 0;
    let fit = -1;

    for (let candidate = -MAX_LAG; candidate <= MAX_LAG; candidate++) {
        const score = correlate(bed, lane, candidate, from, to);

        if (score > fit) {
            fit = score;
            lag = candidate;
        }
    }

    return { lag, fit };
}

/**
 * The offset this track's sentences agree on, rather than the one its silence
 * likes. `fit` is how well the sentence that won matched, and is -1 when none
 * of them was long enough or sure enough to vote.
 *
 * The vote is a median weighted by fit rather than a plain one. Two sentences
 * that disagree have no middle, and a plain median would then be settled by
 * which way the sort ran: a stretch matched at 0.90 and a scrap matched at 0.30
 * would hand the clip to the scrap half the time. Weighted, the sure one wins
 * without a lone outlier being able to drag a well-measured track anywhere,
 * which is what a mean would allow.
 */
function sentenceLag(bed: Float32Array, lane: Float32Array): { lag: number; fit: number; } {
    const votes: { lag: number; fit: number; }[] = [];

    for (let i = 0; i < lane.length; i++) {
        if (lane[i] < ENV_FLOOR) continue;

        let end = i;
        while (end + 1 < lane.length && lane[end + 1] >= ENV_FLOOR) end++;

        if (end + 1 - i >= LAG_SPAN) {
            const scored = bestLag(bed, lane, i, end + 1);
            if (scored.fit >= LAG_FIT) votes.push(scored);
        }

        i = end;
    }

    if (!votes.length) return { lag: 0, fit: -1 };

    votes.sort((a, b) => a.lag - b.lag);

    let total = 0;
    for (const vote of votes) total += vote.fit;

    let seen = 0;

    for (const vote of votes) {
        seen += vote.fit;
        if (seen * 2 >= total) return vote;
    }

    return votes[votes.length - 1];
}

/** The same envelope moved `by` points later, or earlier when negative. */
function shiftBy(rms: Float32Array, by: number): Float32Array {
    if (!by) return rms;

    const out = new Float32Array(rms.length);

    if (by > 0) out.set(rms.subarray(0, rms.length - by), by);
    else out.set(rms.subarray(-by), 0);

    return out;
}

/**
 * How much to rescale a track so it sits where the bed has it.
 *
 * Measured over the hops where this person is not merely gated but actually
 * loud, and alone in being so - the only place the bed can be attributed to one
 * voice. The middle ratio rather than the ratio of the sums: a hop where the
 * bed carries an explosion and the track carries a breath would otherwise pull
 * the whole measurement with it.
 */
function matchGain(bed: Float32Array, lane: Float32Array, alone: Float32Array, floor: number): number {
    const ratios: number[] = [];

    for (let i = 0; i < alone.length; i++) {
        // A hop where the bed sits under its own floor says nothing about how
        // loud this person is in it. Counted, it would enter as a ratio of zero
        // and drag the median down with it.
        if (!alone[i] || lane[i] <= 0 || bed[i] <= floor) continue;

        ratios.push((bed[i] - floor) / lane[i]);
    }

    if (ratios.length < MATCH_HOPS) return 1;

    ratios.sort((a, b) => a - b);

    return Math.min(MATCH_MAX, Math.max(MATCH_MIN, ratios[ratios.length >> 1]));
}

/**
 * Decodes one track, consuming the bytes it is given.
 *
 * `decodeAudioData` detaches the buffer it is handed, so it never gets a view
 * onto a buffer anything else still holds: a track carved out of a larger read
 * is copied out first. A view that already spans a buffer of its own is passed
 * straight through, and every caller here hands one over - a track built frame
 * by frame by `nativeTracks.ts`, a file read off disk, a clip read back over
 * its own URL. That last one is the whole recording, so the copy this skips was
 * a second few hundred megabytes for no reader at all.
 */
async function decode(ctx: BaseAudioContext, data: Uint8Array): Promise<AudioBuffer> {
    const whole = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
    const own = whole ? data : data.slice();

    return await ctx.decodeAudioData(own.buffer as ArrayBuffer);
}

/** Schedules one buffer where its offset puts it on the clip's clock. */
function place(ctx: OfflineAudioContext, buffer: AudioBuffer, offset: number): AudioBufferSourceNode {
    const node = ctx.createBufferSource();
    node.buffer = buffer;

    // A negative offset is a track that began before the clip did, so it starts
    // at zero and plays from that far into itself.
    if (offset >= 0) node.start(offset);
    else node.start(0, -offset);

    return node;
}

/** Measures each track against the bed: when it really happened, and how loud. */
function prepare(
    bed: AudioBuffer | null,
    bedOffset: number,
    raw: RawLane[],
    points: number
): { lanes: Lane[]; bedEnvelope: Float32Array; } {
    const bedEnvelope = bed ? envelopeOf(bed, bedOffset, points) : new Float32Array(points);
    // `offset` is carried here rather than written back onto `lane`: what was
    // handed in describes the file and is read again on the next clip.
    const measured = raw.map(lane => ({
        lane,
        offset: lane.offset,
        rms: envelopeOf(lane.buffer, lane.offset, points)
    }));

    if (!bed) {
        // Nothing to line up against and nothing to match: every track in a
        // file like this came off the same clock at the same level.
        return {
            bedEnvelope,
            lanes: measured.map(entry => ({
                ...entry.lane,
                offset: entry.offset,
                gain: 1,
                rms: entry.rms,
                gate: muteGate(entry.rms)
            }))
        };
    }

    /*
     * The whole call against the bed first.
     *
     * One person on their own is a weak thing to align on - two of the seven in
     * a real clip never speak at all - while everybody summed is the same
     * signal the bed carries, and lands within a point of it.
     */
    const total = new Float32Array(points);
    for (const entry of measured) {
        for (let i = 0; i < points; i++) total[i] += entry.rms[i];
    }

    const clip = bestLag(bedEnvelope, total);

    for (const entry of measured) {
        /*
         * Then each track on its own, sentence by sentence.
         *
         * Worth the second pass because the paths genuinely differ: the people
         * in the call arrive through the machine's output device and are late
         * in the bed, while the microphone is mixed in directly and is early.
         * One number for both would be wrong for both.
         *
         * A track nobody could measure - two of seven never speak in a real
         * clip - keeps the whole call's offset, which is at least the right
         * answer for the people it was measured on.
         */
        const spoken = sentenceLag(bedEnvelope, entry.rms);

        /*
         * Three rungs, and each one is only taken when the one above it had
         * nothing to say.
         *
         * Somebody who only ever drops a word in has no run long enough to
         * measure, and the whole call's offset is the wrong answer for them if
         * they are the microphone - it has the opposite sign, 360ms out on a
         * real clip. Their own track read whole is a poor measurement, but it
         * is a measurement of the right path, so it goes in between.
         */
        const whole = spoken.fit >= LAG_FIT ? spoken : bestLag(bedEnvelope, entry.rms);
        const lag = whole.fit >= LAG_FIT ? whole.lag : clip.lag;

        entry.rms = shiftBy(entry.rms, -lag);
        entry.offset = entry.lane.offset - lag / ENV_HZ;
    }

    /*
     * Two windows per person, and they are not the same shape.
     *
     * `speech` is where somebody is properly talking, and it is what the bed's
     * own floor and every level match are read against. `gate` is where they
     * can be heard at all, which is wider at both ends and far lower, and it is
     * what a mute opens.
     */
    const speech = measured.map(entry => speechGate(entry.rms));
    const gates = measured.map(entry => muteGate(entry.rms));

    /*
     * How many people are talking at each instant, counted once.
     *
     * Both questions below are asked of it - "is anybody talking" for the floor,
     * "is anybody else talking" for each person - and asking every gate again
     * per person made the second one cost the square of the call.
     */
    const talking = new Uint8Array(points);
    for (const gate of speech) {
        for (let i = 0; i < points; i++) if (gate[i]) talking[i]++;
    }

    // What the bed holds while nobody is talking: the game, the music, the
    // room. Taken off the top before a voice is measured against it.
    let quiet = 0;
    let floor = 0;

    for (let i = 0; i < points; i++) {
        if (talking[i]) continue;

        floor += bedEnvelope[i];
        quiet++;
    }

    floor = quiet ? floor / quiet : 0;

    const lanes = measured.map((entry, index) => {
        const alone = new Float32Array(points);

        // Alone means nobody else: their own gate is taken back off the count
        // rather than compared against every other one again.
        const mine = speech[index];

        for (let i = 0; i < points; i++) {
            alone[i] = entry.rms[i] >= ENV_FLOOR && talking[i] === (mine[i] ? 1 : 0) ? 1 : 0;
        }

        return {
            ...entry.lane,
            offset: entry.offset,
            gain: matchGain(bedEnvelope, entry.rms, alone, floor),
            rms: entry.rms,
            gate: gates[index]
        };
    });

    return { lanes, bedEnvelope };
}

/** Decodes a file's tracks once, or hands back the ones already decoded. */
async function heldFor(
    key: string,
    load: () => Promise<{ bed: AudioBuffer | null; bedOffset: number; raw: RawLane[]; } | null>
): Promise<Held | null> {
    if (held?.key === key) return held;
    if (bare.has(key)) return null;
    if (loading?.key === key) return await loading.work;

    const work = decodeInto(key, load);
    loading = { key, work };

    try {
        return await work;
    } finally {
        if (loading?.work === work) loading = null;
    }
}

/** The body of `heldFor`, once it has decided that a decode has to happen. */
async function decodeInto(
    key: string,
    load: () => Promise<{ bed: AudioBuffer | null; bedOffset: number; raw: RawLane[]; } | null>
): Promise<Held | null> {
    const found = await load();

    if (!found?.raw.length) {
        bare.add(key);
        return null;
    }

    const { bed, bedOffset, raw } = found;

    const points = bed
        ? Math.max(1, Math.ceil((bedOffset + bed.duration) * ENV_HZ))
        : Math.max(1, ...raw.map(lane => Math.ceil((lane.offset + lane.buffer.duration) * ENV_HZ)));

    const { lanes, bedEnvelope } = prepare(bed, bedOffset, raw, points);

    logger.info(
        `"${key}" rebuilt from ${lanes.length} separate track(s): `
        + lanes.map(lane => `${lane.name} x${lane.gain.toFixed(2)} @${(lane.offset * 1000).toFixed(0)}ms`).join(", ")
    );

    held = { key, bed, bedOffset, bedEnvelope, lanes, points };
    return held;
}

/**
 * Bends anything over the knee back under full scale, in place.
 *
 * A hard clip on a voice is a crackle on every peak of it; this is the same
 * curve a limiter's knee is, without the time constants, because what it has to
 * catch is a handful of samples rather than a sustained overload.
 */
function limit(buffer: AudioBuffer): void {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);

        for (let i = 0; i < data.length; i++) {
            const level = Math.abs(data[i]);
            if (level <= LIMIT_KNEE) continue;

            const room = 1 - LIMIT_KNEE;
            data[i] = Math.sign(data[i]) * (1 - room * Math.exp(-(level - LIMIT_KNEE) / room));
        }
    }
}

/** The clip's sound as the levels ask for it, rendered out of its tracks. */
async function render(
    id: string,
    found: Held,
    levels: VoiceLevels | undefined,
    roster: string[],
    onProgress?: (done: number) => void
): Promise<VoiceMix | null> {
    const { bed, bedOffset, bedEnvelope, lanes, points } = found;

    onProgress?.(0.5);

    /*
     * Where the bed has to be opened, and by whom.
     *
     * Anybody whose level was moved at all opens it the whole way over their own
     * speech, rather than by how far they were moved. Half-opening looks like
     * the gentler answer and is not: the notch is one window shared by everybody
     * in the clip, so opening it halfway leaves half of the bed - which is half
     * of every voice in it, the one being turned down included - under a rebuild
     * that then adds the others back on top of that. The level lands
     * approximately, exactly at 0 and 1 and nowhere else. Opened the whole way
     * the bed hands its speech over completely and each person is heard at the
     * level that was asked for, which is also the only way a level above 1 can
     * be heard at all: their copy in the bed has to go before a louder one can
     * take its place.
     */
    const notch = new Float32Array(points);
    let touched = false;

    for (const lane of lanes) {
        const weight = voiceGainOf(levels, lane.userId) === 1 ? 0 : 1;
        if (weight <= 0) continue;

        touched = true;
        for (let i = 0; i < points; i++) notch[i] = Math.max(notch[i], weight * lane.gate[i]);

        /*
         * Past the end of their own track the notch is held open rather than
         * left shut.
         *
         * The bed and the tracks do not stop together. The engine drops the
         * last second of every track it writes, because the newest frames of a
         * save are still being encoded, and the bed is whole-machine loopback
         * that runs on to the end - measured on one clip: video 9.95s, tracks
         * 9.91s, bed 10.94s. Over that last second the gate is zero for the
         * only reason that there is nothing left to gate, so the bed played in
         * full and handed back the very voice that was muted, at the one moment
         * a clip is most listened to. There is no way to know whether they are
         * talking there, so it is taken that they are.
         */
        const from = Math.round(lane.offset * ENV_HZ);
        const to = Math.round((lane.offset + lane.buffer.duration) * ENV_HZ);

        for (let i = 0; i < points; i++) {
            // Positive outside the track, and already positive `HOLD_EDGE`
            // points before each end so the close lands on the seam rather
            // than starting there.
            const away = Math.max(from + HOLD_EDGE - i, i - (to - HOLD_EDGE));
            if (away <= 0) continue;

            notch[i] = Math.max(notch[i], weight * Math.min(1, away / HOLD_EDGE));
        }
    }

    // Nobody turned down: the file is the answer, untouched, and building a
    // second copy of it would only cost a decode and a render.
    if (!touched) return null;

    const kept = lanes.filter(lane => voiceGainOf(levels, lane.userId) > 0);
    const dropped = lanes.filter(lane => voiceGainOf(levels, lane.userId) <= 0);

    /*
     * Nobody's sentence gets a seam in the middle of it.
     *
     * Every stretch where somebody who was kept is talking is held at one
     * value: the strongest the notch wanted anywhere in that stretch. The
     * window can only change while they are quiet, which is where a 20ms
     * crossfade has nothing of theirs to cancel.
     *
     * It only ever raises the notch, so a mute cannot be weakened by this - the
     * cost is paid in bed, not in cover.
     */
    if (bed) {
        const busy = new Uint8Array(points);

        for (const lane of kept) {
            const talking = gateOf(lane.rms, ENV_FLOOR, SEAM_CLEAR, SEAM_CLEAR);
            for (let i = 0; i < points; i++) if (talking[i]) busy[i] = 1;
        }

        for (let i = 0; i < points; i++) {
            if (!busy[i]) continue;

            let end = i;
            while (end + 1 < points && busy[end + 1]) end++;

            let held = 0;
            for (let j = i; j <= end; j++) held = Math.max(held, notch[j]);
            for (let j = i; j <= end; j++) notch[j] = held;

            i = end;
        }
    }

    /*
     * A ceiling on what comes back, so a rebuilt moment is never louder than
     * the recorded one.
     *
     * The match is one number for a whole clip and a voice is not: the same
     * person is compressed on the way to the bed and is not in their own track,
     * so a shout can come back several dB hot. This is measured at every hop
     * against what the bed actually held there.
     */
    const ceiling = new Float32Array(points).fill(1);

    /*
     * What the loudest level asked for, so the ceiling does not undo it.
     *
     * The ceiling holds a rebuilt moment to what the bed held there, which is
     * the right answer while the levels only take away. Somebody pushed above 1
     * is asking for the opposite, and against a ceiling that knows nothing
     * about it the slider would move and nothing would be heard.
     */
    let asked = 1;
    for (const lane of kept) asked = Math.max(asked, voiceGainOf(levels, lane.userId));

    if (bed) {
        for (let i = 0; i < points; i++) {
            let want = 0;

            // `RETURN_BOOST` included: what the ceiling has to hold back is
            // the level that will really be added, not the one before the
            // boost. Left out, the ceiling never fires - measured on a real
            // clip it stayed wide open through a shout and the render peaked
            // at 1.98, which the knee then bent back over 461 samples.
            for (const lane of kept) {
                want += lane.rms[i] * voiceGainOf(levels, lane.userId) * lane.gain * RETURN_BOOST;
            }
            if (want <= 0) continue;

            let room = 0;

            for (let at = Math.max(0, i - CEIL_SPAN); at <= Math.min(points - 1, i + CEIL_SPAN); at++) {
                room = Math.max(room, bedEnvelope[at]);
            }

            const allow = room * asked;

            if (want > allow) ceiling[i] = Math.max(CEIL_FLOOR, allow / want);
        }
    }

    const rate = bed?.sampleRate ?? lanes[0].buffer.sampleRate;
    const channels = Math.max(2, bed?.numberOfChannels ?? 1);

    const length = bed
        ? Math.round(bedOffset * rate) + bed.length
        : lanes.reduce((end, lane) => Math.max(end, Math.round(lane.offset * rate) + lane.buffer.length), 0);

    const offline = new OfflineAudioContext(channels, Math.max(1, length), rate);
    const duration = length / rate;

    const sum = offline.createGain();
    sum.connect(offline.destination);

    /*
     * The whole envelope is written in one go.
     *
     * `setValueCurveAtTime` interpolates between the points, so a gate that
     * flips between two 20ms points arrives as a 20ms ramp rather than a step,
     * which is what keeps every open and close from being a click.
     */
    const open = new Float32Array(points);
    const shut = new Float32Array(points);

    for (let i = 0; i < points; i++) {
        open[i] = notch[i];
        shut[i] = 1 - notch[i];
    }

    if (bed) {
        const split = offline.createGain();
        const direct = offline.createGain();
        const low = offline.createGain();

        const lowpass = cascade(offline, "lowpass", LOW_HZ, SECTIONS);

        split.connect(direct);
        split.connect(lowpass.input);
        lowpass.output.connect(low);

        direct.connect(sum);
        low.connect(sum);

        direct.gain.setValueCurveAtTime(shut, 0, duration);
        low.gain.setValueCurveAtTime(open, 0, duration);

        place(offline, bed, bedOffset).connect(split);
    }

    for (const lane of kept) {
        const level = voiceGainOf(levels, lane.userId);
        const gain = offline.createGain();
        const curve = new Float32Array(points);

        for (let i = 0; i < points; i++) {
            // Only while the notch is open: outside those moments this person is
            // already in the bed, and adding them again would double them. With
            // no bed there is nothing to double and they play throughout.
            const window = bed ? notch[i] * ceiling[i] * RETURN_BOOST : 1;
            curve[i] = window * level * lane.gain;
        }

        gain.gain.setValueCurveAtTime(curve, 0, duration);
        gain.connect(sum);

        place(offline, lane.buffer, lane.offset).connect(gain);
    }

    onProgress?.(0.9);

    const buffer = await offline.startRendering();

    limit(buffer);

    if (dropped.length) {
        logger.info(
            `Rebuilt "${id}" without ${dropped.map(lane => lane.name).join(", ")}`
            + `, keeping ${kept.map(lane => lane.name).join(", ") || "nobody"}`
        );
    }

    /*
     * Anybody in the call this could not rebuild is handed back to the duck.
     *
     * A rebuilt segment switches the speech-band notch over to `duck`, so
     * whoever is not named there is turned down by nothing at all: a person
     * whose track never reached the file - a client the engine wrote nothing
     * for, a tap that started late, a track that would not decode - would show
     * as muted in the panel and be heard in full in the render. They cannot be
     * taken out of the bed on their own, but the band notch can still dig where
     * they speak, which is what a mute was before any of this existed.
     */
    const missing = roster.filter(
        person => !lanes.some(lane => lane.userId === person) && voiceGainOf(levels, person) !== 1
    );

    const duck: VoiceLevels = {};
    for (const person of missing) duck[person] = voiceGainOf(levels, person);

    if (missing.length) {
        logger.warn(`"${id}" has no track for ${missing.join(", ")}: their level is left to the duck`);
    }

    return {
        sourceId: id,
        buffer,
        duck: missing.length ? duck : undefined,
        // Everybody with a track of their own, muted or not: the panel uses this
        // to say whose level is exact rather than approximated, and a mute is
        // the most exact of the lot.
        modelled: lanes.map(lane => lane.userId),
        tooQuiet: missing,
        exact: true
    };
}

/**
 * The clip's sound rebuilt out of the tracks Discord's engine wrote into it.
 *
 * This is what a clip taken on this plugin actually has: the engine records
 * every participant on a track of their own - the microphone included - and
 * `mux.ts` carries them into the saved file behind the plugin's own soundtrack.
 * Null for a file with none, which is every clip written before that was wired
 * in and every clip taken outside a call.
 */
export async function nativeLaneMixFor(
    target: MixTarget,
    levels: VoiceLevels | undefined,
    ctx: BaseAudioContext,
    onProgress?: (done: number) => void
): Promise<VoiceMix | null> {
    const named = new Map(target.voices.map(voice => [voice.id, voice.name]));

    const found = await heldFor(`${target.id}:native`, async () => {
        const data = new Uint8Array(await (await fetch(target.url)).arrayBuffer());
        const tracks = readNativeAudio(data);

        if (!hasVoiceTracks(tracks)) return null;

        const decoded = async (track: typeof tracks[number]): Promise<AudioBuffer | null> => {
            try {
                return await decode(ctx, track.adts);
            } catch (e) {
                logger.warn(`Could not decode the ${track.userId || track.kind} track of "${target.id}"`, e);
                return null;
            }
        };

        /*
         * `0:all` is skipped on purpose, and it is the reason a mute used to do
         * nothing at all.
         *
         * It is not the desktop, whatever its name suggests: measured over the
         * frames of a real clip where nobody speaks it sits at 0.0007 against
         * the bed's 0.0159, and it peaks with each voice track in turn. It is
         * the call mixed together - which is to say a second copy of everybody,
         * the muted person included, and it used to be summed in at full level
         * under the mix that had just left them out.
         */
        const voices = tracks.filter(track => !!track.userId && track.kind === "voice");
        const beds = tracks.filter(track => track.kind === "bed");

        // All of them at once: a call of seven used to decode seven files' worth
        // of AAC one after another before the studio could draw anything, and no
        // track needs another one to be read.
        const [bedBuffers, lanes] = await Promise.all([
            Promise.all(beds.map(decoded)),
            Promise.all(voices.map(async (track): Promise<RawLane | null> => {
                const buffer = await decoded(track);
                if (!buffer) return null;

                const userId = track.userId as string;

                return { userId, name: named.get(userId) || userId, offset: track.offset, buffer };
            }))
        ]);

        // The first bed that could be read, as before: a file carries one, and
        // the others are only ever there when the first would not decode.
        const at = bedBuffers.findIndex(buffer => buffer !== null);

        return {
            bed: at < 0 ? null : bedBuffers[at],
            bedOffset: at < 0 ? 0 : beds[at].offset,
            raw: lanes.filter((lane): lane is RawLane => lane !== null)
        };
    });

    if (!found) return null;

    return await render(target.id, found, levels, [...named.keys()], onProgress);
}

/**
 * The same, out of the files `voiceRecord.ts` saved beside the clip.
 *
 * What covers the clients the engine does not: the tracks are recorded by the
 * plugin itself, from the audio receivers the client opens, and land in a
 * `voices` folder next to the clip rather than inside it.
 */
export async function laneMixFor(
    target: MixTarget,
    levels: VoiceLevels | undefined,
    ctx: BaseAudioContext,
    onProgress?: (done: number) => void
): Promise<VoiceMix | null> {
    const metas = target.tracks;
    if (!metas?.length) return null;

    const found = await heldFor(`${target.id}:lanes`, async () => {
        /*
         * The bed and every voice at once rather than one after another.
         *
         * They were read and decoded in a queue, which on a call of five people
         * meant six reads end to end before the first sample could be looked
         * at. Nothing here depends on anything else here, and they all end up
         * in memory together in any case, so the only thing the queue was
         * buying was the wait.
         */
        const readBed = async () => decode(ctx, new Uint8Array(await (await fetch(target.url)).arrayBuffer()));

        const readLane = async (meta: VoiceFileMeta): Promise<RawLane | null> => {
            try {
                return {
                    userId: meta.id,
                    name: meta.name,
                    offset: meta.offset,
                    buffer: await decode(ctx, await loadVoiceTrack(meta.file))
                };
            } catch (e) {
                // One unreadable track is one person missing from the mix,
                // rather than a clip that cannot be put together at all.
                logger.warn(`Could not decode the voice track "${meta.file}"`, e);
                return null;
            }
        };

        const [bed, lanes] = await Promise.all([readBed(), Promise.all(metas.map(readLane))]);

        return { bed, bedOffset: 0, raw: lanes.filter((lane): lane is RawLane => lane !== null) };
    });

    if (!found) return null;

    return await render(target.id, found, levels, target.voices.map(voice => voice.id), onProgress);
}

/** Drops the decoded tracks. Called when the studio closes. */
export function forgetLaneMixes(): void {
    held = null;
    bare.clear();
}
