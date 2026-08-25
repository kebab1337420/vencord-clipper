/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the separated soundtrack of one file, kept around
 *
 * `laneMix.ts` is arithmetic and knows nothing about caching. This is the part
 * that fetches the bytes, decodes them, and remembers the result, because the
 * expensive half of a separation describes the recording rather than what the
 * user asked for: the same analysis serves every set of levels, every segment
 * cut out of that file, the preview and the render.
 *
 * Two caches, because the two halves cost very different things. The analysis
 * is seconds of arithmetic and tens of megabytes, so two of them are kept and
 * the oldest is dropped. The mix is a fraction of a second and one buffer, so a
 * few are kept - enough that pulling a slider back to where it was is instant.
 */

import { Logger } from "@utils/Logger";

import { forgetLaneMixes, laneMixFor, nativeLaneMixFor } from "./laneMix";
import { type VoiceFileMeta, type VoiceLevels, voiceLevelsTouched, type VoiceTrack } from "./voice";

const logger = new Logger("Clipper");

/** Rebuilt soundtracks kept in memory. Each is one clip's worth of samples. */
const MAX_MIXES = 4;

export interface VoiceMix {
    sourceId: string;
    /** The clip's sound with everyone's level applied to their own voice. */
    buffer: AudioBuffer;
    /**
     * The levels separation could not apply, for the duck to finish.
     *
     * Undefined when there is nothing left to do, which is the usual case.
     */
    duck?: VoiceLevels;
    /** Who came out modelled, and who was too quiet to model. */
    modelled: string[];
    tooQuiet: string[];
    /**
     * Whether the mix came from the file's own per-person tracks.
     *
     * Worth saying out loud because the two paths are not the same promise.
     * Separation is an estimate that colours what it keeps; this is arithmetic
     * on tracks that were never mixed in the first place, and a muted person is
     * simply absent from it.
     */
    exact?: boolean;
}

interface Cached<T> {
    key: string;
    value: T;
}

const mixes: Cached<VoiceMix>[] = [];

function remember<T>(cache: Cached<T>[], key: string, value: T, cap: number): T {
    cache.unshift({ key, value });
    while (cache.length > cap) cache.pop();
    return value;
}

function recall<T>(cache: Cached<T>[], key: string): T | undefined {
    const at = cache.findIndex(entry => entry.key === key);
    if (at < 0) return undefined;

    // Moved to the front so the cap drops what has not been asked for lately
    // rather than what happens to be oldest.
    const [entry] = cache.splice(at, 1);
    cache.unshift(entry);

    return entry.value;
}

/** The levels a mix was built for, as a key that only changes when they do. */
function signature(levels: VoiceLevels | undefined): string {
    return Object.entries(levels ?? {})
        .map(([id, level]) => `${id}=${level}`)
        .sort()
        .join(",");
}

/**
 * Everything the caller has to know to ask for a separation.
 *
 * A subset of `StudioSource` on purpose: this module has no business knowing
 * what a timeline is, and the render passes the same shape from a different
 * place.
 */
export interface MixTarget {
    id: string;
    url: string;
    voices: VoiceTrack[];
    /**
     * The per-person recordings saved beside this file, where it has any.
     *
     * The clip's own soundtrack has the whole call mixed into it; these are the
     * same people recorded one at a time, which is what makes a mute a matter of
     * leaving a term out of a sum rather than of filtering a mix.
     */
    tracks?: VoiceFileMeta[];
}

/**
 * The separated soundtrack of one file, built or recalled.
 *
 * Null when there is nothing separation can do about these levels - nobody
 * muted, one person in the call, a clip too long to hold in memory, or a
 * recording where nobody ever speaks alone. In every one of those the duck is
 * the right answer and the caller already has it.
 */
export async function voiceMixFor(
    target: MixTarget,
    levels: VoiceLevels | undefined,
    ctx: BaseAudioContext,
    onProgress?: (done: number) => void
): Promise<VoiceMix | null> {
    /*
     * A clip nobody has turned anybody down in is already correct.
     *
     * Its first soundtrack is what a player plays and what the render records,
     * and it holds the call as it was heard. Rebuilding it would mean reading
     * the file, decoding a track per person and rendering the sum of them, all
     * to land back on the sound that was already there. The rebuild exists for
     * the one thing that soundtrack cannot do, which is leave somebody out.
     */
    if (!voiceLevelsTouched(levels)) return null;

    const key = `${target.id}:${signature(levels)}`;

    const ready = recall(mixes, key);
    if (ready) return ready;

    /*
     * The file's own tracks first, wherever it has them.
     *
     * This is the whole answer to what separation was an approximation of: a
     * clip written by Discord's engine keeps one track per person, so a muted
     * voice is one this never touches rather than one it has to remove. No
     * estimate, no colouring, no duck left over - and the others carry on
     * talking through it, which is the one thing a single mixed signal can
     * never do.
     */
    try {
        const mix = await nativeLaneMixFor(target, levels, ctx, onProgress);
        if (mix) return remember(mixes, key, mix, MAX_MIXES);
    } catch (e) {
        logger.warn(`Could not rebuild "${target.id}" from the tracks inside it`, e);
    }

    /*
     * Then the tracks recorded beside it, for the clients the engine leaves
     * nothing behind on.
     */
    try {
        const mix = await laneMixFor(target, levels, ctx, onProgress);
        if (mix) return remember(mixes, key, mix, MAX_MIXES);
    } catch (e) {
        logger.warn(`Could not rebuild "${target.id}" from its separate voice tracks`, e);
    }

    /*
     * Nothing but one mixed soundtrack in this file, so there is nothing to
     * rebuild and the caller falls back to the mixer's own rule.
     *
     * There used to be a third path here: learn each voice from the moments
     * that person spoke alone and subtract it everywhere else. On paper it is
     * the right answer for a recording that was mixed before it reached this
     * client. In practice it made the sound stutter wherever two people
     * overlapped and left the muted person audible underneath anyway, which is
     * both of the things it was meant to fix. An estimate that fails at exactly
     * the moments it exists for is not worth the seconds it costs, so it was
     * deleted rather than left switched off.
     */
    return null;
}

/** Drops everything held. Called when the studio closes. */
export function forgetVoiceMixes(): void {
    mixes.length = 0;
    forgetLaneMixes();
}
