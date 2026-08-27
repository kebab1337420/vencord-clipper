/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - sounds dropped on the timeline
 *
 * A music bed, a meme sting, a voice-over: a file that plays over the montage
 * rather than being part of it. The video segments decide what is seen and how
 * long the timeline runs; these sit on their own lane, anywhere in project time,
 * with their own level and their own fades.
 *
 * They are decoded once into an `AudioBuffer` and kept that way. That costs
 * memory - a three minute track is about thirty megabytes as float samples - and
 * buys the two things the editor needs: a waveform that can be drawn without
 * touching a decoder again, and sample-accurate scheduling, which an element
 * playing back in real time cannot give.
 */

import { Logger } from "@utils/Logger";

const logger = new Logger("Clipper", "#f0b132");

/** Bars in a decoded waveform. Fixed, so a lane redraws without re-reducing. */
export const PEAKS = 900;

/** A decoded sound available to the timeline. */
export interface AudioSource {
    id: string;
    /** Shown on the lane: the file's own name. */
    name: string;
    /** Object URL, so the file can be handed back to an element if needed. */
    url: string;
    /** Absolute path it was read from, so a saved project can find it again. */
    path?: string;
    duration: number;
    buffer: AudioBuffer;
    /** Peak envelope, 0..1, `PEAKS` long. */
    peaks: number[];
}

/** One placement of a sound on the timeline. */
export interface AudioClip {
    id: string;
    sourceId: string;
    /** Project time at which the clip begins, in seconds. */
    at: number;
    /** Range taken out of the file, in seconds. */
    from: number;
    to: number;
    /** Linear gain, 1 being the file untouched. */
    gain: number;
    fadeIn: number;
    fadeOut: number;
    muted: boolean;
}

export function clipLengthOf(clip: AudioClip): number {
    return Math.max(0, clip.to - clip.from);
}

export function clipEnd(clip: AudioClip): number {
    return clip.at + clipLengthOf(clip);
}

/**
 * Reduces a decoded buffer to a fixed number of bars.
 *
 * The peak of each bin rather than its average: a waveform is read for "where
 * does the drop land", and averaging a transient into a long bin hides exactly
 * the landmark the eye is looking for. Channels are folded together because the
 * lane is one row tall.
 */
function envelope(buffer: AudioBuffer): number[] {
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));

    const per = buffer.length / PEAKS;
    const peaks: number[] = [];

    for (let i = 0; i < PEAKS; i++) {
        const from = Math.floor(i * per);
        const to = Math.min(buffer.length, Math.max(from + 1, Math.floor((i + 1) * per)));

        let peak = 0;
        for (const data of channels) {
            for (let j = from; j < to; j++) {
                const value = Math.abs(data[j]);
                if (value > peak) peak = value;
            }
        }

        peaks.push(Math.min(1, peak));
    }

    return peaks;
}

/**
 * Decodes a file into a timeline source.
 *
 * The context is only borrowed for the decode: `decodeAudioData` resamples to
 * the context's own rate, which is what makes every source line up in the mix
 * later without a single resampler of our own.
 */
export async function decodeSource(ctx: BaseAudioContext, id: string, name: string, data: ArrayBuffer, url: string, path?: string): Promise<AudioSource> {
    // Decoded from a copy: `decodeAudioData` detaches the buffer it is given,
    // and the caller still owns the bytes it read off disk.
    const buffer = await ctx.decodeAudioData(data.slice(0));

    return { id, name, url, path, duration: buffer.duration, buffer, peaks: envelope(buffer) };
}

/**
 * The end of the montage, when the sounds have to go with it.
 *
 * A music bed does not know the picture is about to finish, so left to itself
 * it either plays on over a preview that has stopped or is cut off mid-note by
 * the recorder closing. Handing the schedule the montage's own ending settles
 * both: nothing is heard past `at`, and the fade the montage finishes on is
 * applied to the sounds too, so the music lands on silence at the same instant
 * the picture does.
 */
export interface Ending {
    /** Project time the montage finishes at, in seconds. */
    at: number;
    /** Seconds of fade it finishes on; 0 for a hard ending. */
    fade: number;
}

/**
 * A sound scheduled on a graph, with the handle needed to stop it early.
 *
 * Kept as a pair rather than as the node alone because a node that has been
 * started cannot be asked whether it is still running, and stopping one twice
 * throws.
 */
interface Scheduled {
    node: AudioBufferSourceNode;
    stopped: boolean;
}

/**
 * Plays the sounds of a stretch of project time onto a graph.
 *
 * `origin` is the context time that corresponds to `from` in project time, so
 * the same code serves the render - where the clock is the render's own - and
 * the preview, where it is the moment the user pressed play. Every clip that
 * overlaps the window is scheduled, including one that started before it: it
 * simply enters part way in.
 *
 * The returned function stops everything it started, which is what a seek, a
 * pause or the end of a segment needs.
 */
export function scheduleClips(
    ctx: BaseAudioContext,
    destination: AudioNode,
    clips: AudioClip[],
    sources: Map<string, AudioSource>,
    origin: number,
    from: number,
    to: number,
    ending?: Ending,
    duck?: DuckCurve | null
): () => void {
    const running: Scheduled[] = [];

    // The window never reaches past the last frame, whatever the caller asked
    // for: a preview is scheduled an hour ahead and would otherwise keep a bed
    // playing over a montage that has finished.
    const until = ending ? Math.min(to, ending.at) : to;

    /*
     * The montage's own fade is a stage of its own rather than more ramps on
     * each clip's gain.
     *
     * Written onto the clip gains it would fight the clip's own fade out - two
     * ramps on one AudioParam, and the later one wins outright - so a sound
     * that fades over two seconds under a montage that fades over one would
     * lose its own fade. A node in series multiplies instead, which is what
     * two fades over the same moment should do.
     */
    let out = destination;
    let tail: GainNode | null = null;

    if (ending && ending.fade > 0 && ending.at > from) {
        tail = ctx.createGain();
        const closes = origin + (ending.at - from);
        const opens = Math.max(origin, closes - ending.fade);

        tail.gain.setValueAtTime(1, opens);
        tail.gain.linearRampToValueAtTime(0, closes);
        tail.connect(destination);

        out = tail;
    }

    /*
     * The bed steps aside while somebody talks.
     *
     * Written as one stage in front of everything on the lane rather than onto
     * each clip's own gain: the curve is about the montage, not about any one
     * sound, and a sting dropped over a sentence should duck exactly as much as
     * the music under it does.
     */
    let sidechain: GainNode | null = null;
    if (duck && duck.gains.length) {
        sidechain = ctx.createGain();

        const step = 1 / duck.hz;
        sidechain.gain.setValueAtTime(duck.gains[0], origin);

        for (let i = 1; i < duck.gains.length; i++) {
            const when = origin + (duck.from + i * step - from);
            if (when <= origin) continue;
            if (when > origin + (until - from) + step) break;

            sidechain.gain.linearRampToValueAtTime(duck.gains[i], when);
        }

        sidechain.connect(out);
        out = sidechain;
    }

    for (const clip of clips) {
        if (clip.muted) continue;

        const source = sources.get(clip.sourceId);
        const length = clipLengthOf(clip);
        if (!source || length <= 0) continue;

        const start = clip.at;
        const end = clip.at + length;
        if (end <= from || start >= until) continue;

        // A clip already running when the window opens enters part way in.
        const skipped = Math.max(0, from - start);
        const offset = clip.from + skipped;
        const duration = Math.min(length - skipped, until - Math.max(start, from));
        if (duration <= 0) continue;

        const when = origin + Math.max(0, start - from);

        try {
            const node = ctx.createBufferSource();
            node.buffer = source.buffer;

            const gain = ctx.createGain();
            const level = Math.max(0, clip.gain);

            /*
             * Fades are written as ramps on the schedule rather than applied per
             * frame: the graph runs on the audio thread, so a fade set here is
             * sample accurate even while the main thread is busy painting.
             *
             * The fade in is measured from the clip's own start, so a clip
             * entered part way in is already past it.
             */
            const fadeIn = Math.max(0, Math.min(clip.fadeIn - skipped, duration));
            const fadeOut = Math.max(0, Math.min(clip.fadeOut, duration - fadeIn));

            gain.gain.setValueAtTime(fadeIn > 0 ? 0 : level, when);
            if (fadeIn > 0) gain.gain.linearRampToValueAtTime(level, when + fadeIn);
            if (fadeOut > 0) {
                gain.gain.setValueAtTime(level, when + duration - fadeOut);
                gain.gain.linearRampToValueAtTime(0, when + duration);
            }

            node.connect(gain);
            gain.connect(out);

            node.start(when, Math.max(0, offset), duration);

            const entry: Scheduled = { node, stopped: false };
            node.onended = () => { entry.stopped = true; };
            running.push(entry);
        } catch (e) {
            logger.warn(`Could not schedule the sound "${source.name}"`, e);
        }
    }

    return () => {
        for (const entry of running) {
            if (entry.stopped) continue;

            entry.stopped = true;
            try {
                entry.node.stop();
            } catch {
                // Already finished between the check and the call; nothing to do.
            }
        }

        // The stages outlive the sources they were built for: the preview
        // reschedules on every scrub, and a node left connected to the
        // destination stays on the graph for as long as the studio is open.
        sidechain?.disconnect();
        tail?.disconnect();
    };
}

/*
 * Where the beats are in a music bed.
 *
 * Energy flux, which is the plainest onset detector there is: the loudness of
 * each short frame against the one before it, and every rise that stands out
 * from its neighbourhood is an onset. It finds drum hits reliably, which is
 * what a montage is cut on; it is not a tempo tracker and does not pretend to
 * be one - nothing here needs to know the time signature, only where the hits
 * land.
 */
const FLUX_FRAME = 1024;
const FLUX_HOP = 512;

/** Shortest gap between two beats, in seconds. Faster than this is a roll. */
const BEAT_GAP = 0.12;

/** How far either side an onset has to stand out to be counted. */
const FLUX_WINDOW = 16;

/** How much above its neighbourhood, as a multiple of the local average. */
const FLUX_OVER = 1.4;

export function beatsOf(buffer: AudioBuffer): number[] {
    const samples = buffer.getChannelData(0);
    const frames = Math.floor(Math.max(0, samples.length - FLUX_FRAME) / FLUX_HOP) + 1;
    if (frames < 4) return [];

    const flux = new Float32Array(frames);
    let previous = 0;

    for (let i = 0; i < frames; i++) {
        const start = i * FLUX_HOP;
        let energy = 0;

        for (let j = 0; j < FLUX_FRAME; j++) {
            const sample = samples[start + j];
            energy += sample * sample;
        }

        energy = Math.sqrt(energy / FLUX_FRAME);

        // Only the rises: a note ending is not something to cut on.
        flux[i] = Math.max(0, energy - previous);
        previous = energy;
    }

    const beats: number[] = [];
    const perFrame = FLUX_HOP / buffer.sampleRate;
    let last = -BEAT_GAP;

    for (let i = 1; i < frames - 1; i++) {
        const value = flux[i];
        if (value <= 0 || value < flux[i - 1] || value < flux[i + 1]) continue;

        let around = 0;
        let count = 0;

        for (let j = Math.max(0, i - FLUX_WINDOW); j <= Math.min(frames - 1, i + FLUX_WINDOW); j++) {
            around += flux[j];
            count++;
        }

        if (!count || value < (around / count) * FLUX_OVER) continue;

        const at = i * perFrame;
        if (at - last < BEAT_GAP) continue;

        last = at;
        beats.push(at);
    }

    return beats;
}

/**
 * A gain to apply to the sound lane over a stretch of project time.
 *
 * Sampled rather than described, because what drives it is the voice activity
 * of the clip, which is itself a series of samples. The caller builds it; this
 * file only knows how to play it.
 */
export interface DuckCurve {
    /** Project time of the first sample, in seconds. */
    from: number;
    /** Samples per second. */
    hz: number;
    /** Gain at each sample, 0..1. */
    gains: Float32Array;
}

/*
 * Playing a sound faster is resampling it, and resampling it moves its pitch.
 *
 * An element has `preservesPitch` for exactly this, and that is what a segment
 * playing its own recording uses. A soundtrack rebuilt from the separate voice
 * tracks is not an element - it is a buffer on the graph, and the only speed
 * control a buffer source has is `playbackRate`, which is the resampling. So
 * the buffer itself is stretched to the length the speed asks for, and played
 * back untouched.
 *
 * Overlap-add, on grains long enough to hold a pitch period of a voice and
 * crossfaded so the seams do not click. It is the same family of trick the
 * browser runs on an element, and on speech at the speeds an editor uses - half
 * to double - it is close enough that the two sound alike.
 */
const GRAIN_S = 0.08;
const OVERLAP_S = 0.02;

/** The last stretch, so playing a segment again does not recompute it. */
let stretched: { from: AudioBuffer; rate: number; buffer: AudioBuffer; } | null = null;

/**
 * The same audio at `rate` speed, with its pitch left where it was.
 *
 * Hands back the buffer untouched at ordinary speed, so the caller can always
 * play the result at a rate of 1.
 */
export function stretchToRate(ctx: BaseAudioContext, buffer: AudioBuffer, rate: number): AudioBuffer {
    if (!Number.isFinite(rate) || Math.abs(rate - 1) < 0.01) return buffer;
    if (stretched && stretched.from === buffer && stretched.rate === rate) return stretched.buffer;

    const { sampleRate, numberOfChannels } = buffer;
    const length = Math.max(1, Math.round(buffer.length / rate));

    const grain = Math.max(2, Math.round(GRAIN_S * sampleRate));
    const overlap = Math.max(1, Math.min(grain >> 1, Math.round(OVERLAP_S * sampleRate)));
    const hopOut = grain - overlap;
    const hopIn = hopOut * rate;

    let out: AudioBuffer;
    try {
        out = ctx.createBuffer(numberOfChannels, length, sampleRate);
    } catch (e) {
        // A speed that asks for more memory than there is: better the wrong
        // pitch than no soundtrack.
        logger.warn("Could not stretch the soundtrack, playing it resampled", e);
        return buffer;
    }

    for (let channel = 0; channel < numberOfChannels; channel++) {
        const source = buffer.getChannelData(channel);
        const target = out.getChannelData(channel);

        for (let index = 0; ; index++) {
            const at = index * hopOut;
            if (at >= length) break;

            const read = Math.round(index * hopIn);
            const span = Math.min(grain, length - at, source.length - read);
            if (span <= 0) break;

            // The head of every grain but the first is faded in over what the
            // previous one left there, which is faded out by the same ramp.
            const blend = index ? Math.min(overlap, span) : 0;

            for (let i = 0; i < blend; i++) {
                const mix = i / blend;
                target[at + i] = target[at + i] * (1 - mix) + source[read + i] * mix;
            }

            for (let i = blend; i < span; i++) target[at + i] = source[read + i];
        }
    }

    stretched = { from: buffer, rate, buffer: out };
    return out;
}

/** How often the envelope used for lining two angles up is sampled. */
const ENVELOPE_HZ = 25;

/** Furthest two angles of the same moment are assumed to be apart. */
const MAX_LAG_S = 30;

/**
 * The loudness of a recording over time, as one number per step.
 *
 * Everything two angles of the same moment have in common is in here: the same
 * shout, the same explosion, at the same instant of the world, whatever each
 * client's clock said about it. Downmixed, because one person's game is in
 * stereo and another's is not.
 */
export function envelopeOf(buffer: AudioBuffer, hz = ENVELOPE_HZ): Float32Array {
    const step = Math.max(1, Math.round(buffer.sampleRate / hz));
    const count = Math.floor(buffer.length / step);
    const out = new Float32Array(count);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);

        for (let i = 0; i < count; i++) {
            const from = i * step;
            let sum = 0;

            for (let at = from; at < from + step; at++) sum += data[at] * data[at];

            out[i] += sum / step;
        }
    }

    const channels = Math.max(1, buffer.numberOfChannels);
    for (let i = 0; i < count; i++) out[i] = Math.sqrt(out[i] / channels);

    return out;
}

/**
 * How far one angle sits behind another, in seconds.
 *
 * Two people clipping the same moment start their buffers at different
 * instants, and their files are the same event minutes apart as far as any
 * timeline is concerned. The sound is what they share, so the second envelope
 * is slid over the first and the lag that lines them up best is the answer.
 *
 * Correlated on the envelope rather than the waveform: a phase-accurate match
 * would need the same microphone in the same room, while the shape of the
 * loudness survives two different mixes of the same call. Null when nothing
 * correlates well enough to act on - a clip of a different moment entirely
 * should move nothing.
 */
export function alignTo(reference: AudioBuffer, other: AudioBuffer, hz = ENVELOPE_HZ): number | null {
    const a = envelopeOf(reference, hz);
    const b = envelopeOf(other, hz);
    if (a.length < hz || b.length < hz) return null;

    const centre = (data: Float32Array): { values: Float32Array; energy: number; } => {
        let mean = 0;
        for (const value of data) mean += value;
        mean /= data.length;

        const values = new Float32Array(data.length);
        let energy = 0;

        for (let i = 0; i < data.length; i++) {
            values[i] = data[i] - mean;
            energy += values[i] * values[i];
        }

        return { values, energy };
    };

    const first = centre(a);
    const second = centre(b);
    if (!first.energy || !second.energy) return null;

    const span = Math.round(MAX_LAG_S * hz);
    let best = 0;
    let score = -Infinity;

    for (let lag = -span; lag <= span; lag++) {
        const from = Math.max(0, -lag);
        const to = Math.min(a.length, b.length - lag);

        // Too little overlap to mean anything: a match on half a second of two
        // long recordings is a coincidence, not an alignment.
        if (to - from < hz) continue;

        let sum = 0;
        let left = 0;
        let right = 0;

        for (let i = from; i < to; i++) {
            const x = first.values[i];
            const y = second.values[i + lag];

            sum += x * y;
            left += x * x;
            right += y * y;
        }

        const norm = Math.sqrt(left * right);
        if (!norm) continue;

        const value = sum / norm;
        if (value > score) {
            score = value;
            best = lag;
        }
    }

    // Below this the two recordings have nothing audible in common, and moving
    // one of them would be guessing.
    if (score < 0.35) return null;

    return best / hz;
}
