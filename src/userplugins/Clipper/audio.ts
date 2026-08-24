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
    ending?: Ending
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
    if (ending && ending.fade > 0 && ending.at > from) {
        const tail = ctx.createGain();
        const closes = origin + (ending.at - from);
        const opens = Math.max(origin, closes - ending.fade);

        tail.gain.setValueAtTime(1, opens);
        tail.gain.linearRampToValueAtTime(0, closes);
        tail.connect(destination);

        out = tail;
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
    };
}
