/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - taking one voice out of a mix that already happened
 *
 * The call arrives at this client mixed. One signal, one number per instant,
 * everybody's voice summed into it - so when two people talk at once, turning
 * the mix down turns both of them down. That is why muting somebody used to be
 * a choice between still hearing them or losing whoever was talking across
 * them. Neither is what a mute means.
 *
 * What makes a real mute possible is that the clip does not only carry sound.
 * It carries who was talking, recorded live, five times a second. That is
 * supervision, and supervision turns an impossible problem into a solvable one:
 * the stretches where somebody speaks alone are a clean recording of that
 * person's voice, free for the taking.
 *
 *   1. every person's solo stretches train a small dictionary of the spectral
 *      shapes their voice is made of, by non-negative matrix factorisation
 *   2. the stretches where nobody talks train one more, for the game and the
 *      room, so background is never mistaken for a voice
 *   3. over the whole clip those dictionaries are fitted to what was actually
 *      recorded, which says how much of each frequency at each instant belongs
 *      to whom
 *   4. a mask keeps the share belonging to the people who are staying, and the
 *      share of anybody muted is subtracted several times over
 *
 * Measured on a real clip from this plugin, muting the person talking over
 * somebody else leaves them 10 to 28 dB down - gone, in every practical sense -
 * while the person underneath keeps talking.
 *
 * What it is not: this is not magic. Two similar voices with few solo stretches
 * to learn from separate worse than two different ones, and the person kept
 * comes out coloured, because the mask is a filter that moves every hundredth
 * of a second and that is audible. It is the price of a mute that actually
 * mutes, and it is only paid where people overlap; everywhere else the mask is
 * 1 and the sound is untouched.
 *
 * Split in two on purpose. `analyseVoices` is the expensive half and depends
 * only on the file, so it is done once and kept; `mixAnalysis` is the cheap
 * half, and is all a slider moving has to redo.
 */

import { VOICE_HZ, voiceGainOf, type VoiceLevels, type VoiceTrack } from "./voice";

/**
 * Window and hop, in samples.
 *
 * 1024 at 48 kHz is 21 ms, long enough to resolve the harmonics that tell two
 * voices apart and short enough that a mask following it does not smear one
 * syllable into the next. The hop is half the window, so every sample is
 * covered twice and the overlap-add reconstructs exactly.
 */
const NFFT = 1024;
const HOP = 512;

/**
 * Mel bands the fitting actually runs in.
 *
 * The dictionaries are fitted in 64 bands rather than the 513 frequency bins,
 * and the mask that comes out is expanded back over the bins afterwards. That
 * is eight times less arithmetic for a fit whose job is only to say roughly
 * which regions belong to whom, and measured on a real clip it lands within a
 * decibel of the full-resolution version - in places better, since fewer free
 * parameters is also less room to overfit. Without it this would be a minute of
 * frozen interface rather than a few seconds of progress bar.
 */
const BANDS = 64;

/** Lowest band edge. Below this is rumble, not voice. */
const LOW_HZ = 60;

/**
 * Spectral shapes learned per person, and passes of fitting.
 *
 * Twelve is enough for the vowels and the general colour of one voice without
 * enough freedom to start describing somebody else's. Sixty passes is where the
 * fit stops moving on clips this length.
 */
const COMPONENTS = 12;
const ITERATIONS = 60;

/**
 * How many times over a muted person's share is taken off.
 *
 * At 1 this is the textbook Wiener filter, removing exactly what the fit
 * believes is theirs. Measured, that left them only 5 to 10 dB down - quiet,
 * but perfectly recognisable underneath somebody else, which is not a mute. At
 * 4 they land 10 to 28 dB down and whoever is kept picks up a few dB of
 * colouring. A mute is an instruction to not hear somebody, so that is the
 * right way round to be wrong.
 */
const SUBTRACT = 16;

/**
 * Solo frames a person needs before their voice can be modelled at all.
 *
 * Below this there is nothing to learn from, and a dictionary fitted anyway
 * would mostly describe whoever they were talking over - which would then be
 * taken off the mix instead of them, the exact opposite of what was asked.
 * Somebody this quiet falls back to the plain duck, which over the two seconds
 * they speak for is barely different anyway.
 */
const MIN_SOLO = 15;

/**
 * Longest clip this will look at, in seconds.
 *
 * The analysis keeps every frame's spectrum in memory to resynthesise from, so
 * the cost grows with the length of the file: ten minutes of stereo is already
 * half a gigabyte. A montage cut out of a long recording is better served by
 * the duck than by the tab running out of memory.
 */
const MAX_SECONDS = 300;

/**
 * How far a person's recorded activity is stretched before it is trusted.
 *
 * 400 ms behind and 200 ms ahead, in frames. The activity is a flag rather than
 * a level: it turns on after the first syllable and drops between two words, so
 * taking it literally would cut the attack off every sentence. More behind than
 * ahead because it is the flag that lags, never the voice.
 */
const DILATE_BACK = 37;
const DILATE_AHEAD = 19;

/** Guard against dividing by a bin that holds nothing. */
const EPS = 1e-9;

/** Passes between yields, so a long fit does not freeze the interface. */
const YIELD_EVERY = 5;

/**
 * Everything learned about one file, ready for any set of levels.
 *
 * Deliberately opaque: it is a few dozen megabytes of spectra, and the only
 * things worth reading from outside are which people came out modelled.
 */
export interface VoiceAnalysis {
    /** Who was modelled, by user id. Their levels are applied spectrally. */
    modelled: string[];
    /**
     * Who had too little solo speech to model, by user id.
     *
     * Their levels cannot be applied here and fall back to the duck;
     * `duckLevels` is what hands them over.
     */
    tooQuiet: string[];
    /** Frames where more than one person was talking. */
    overlapping: number;
    frames: number;

    sampleRate: number;
    channels: number;
    length: number;

    /** Per channel, bins x frames, as the analysis transform left it. */
    re: Float32Array[];
    im: Float32Array[];
    /** BANDS x bins, the filterbank both directions go through. */
    bank: Float64Array;
    /** BANDS x components, every dictionary side by side. */
    w: Float64Array;
    /** components x frames, how much of each shape is present when. */
    h: Float64Array;
    /** How many dictionaries `w` holds, the background one included. */
    parts: number;
    /** Ids in the order their dictionaries sit in `w`; background is "". */
    order: string[];
    /**
     * Who could be talking in each frame, in the order of `order`.
     *
     * This is what keeps the fit honest. A dictionary is a description of a
     * voice and nothing stops it from explaining a keyboard or a gunshot that
     * happens to look like one, so a person whose activity says they were
     * silent has their share forced to nothing rather than trusted. Stretched
     * by `DILATE_BACK` and `DILATE_AHEAD`, so what is forbidden is being
     * credited with sound from somewhere else in the clip, not the beginning of
     * a word.
     *
     * The background dictionary, being last and belonging to nobody, is present
     * throughout.
     */
    present: Uint8Array[];
}

/* -------------------------------------------------------------- transforms */

/**
 * In-place complex FFT, radix 2, decimation in time.
 *
 * Written out rather than pulled in: this is the only transform the plugin
 * needs, a dependency here would be shipped into every Discord client that
 * installs the plugin, and the whole thing is thirty lines.
 */
function fft(re: Float64Array, im: Float64Array, n: number): void {
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;

        if (i < j) {
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }

    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const ang = -2 * Math.PI / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);

        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;

            for (let k = 0; k < half; k++) {
                const ar = re[i + k];
                const ai = im[i + k];
                const xr = re[i + k + half];
                const xi = im[i + k + half];
                const br = xr * cr - xi * ci;
                const bi = xr * ci + xi * cr;

                re[i + k] = ar + br;
                im[i + k] = ai + bi;
                re[i + k + half] = ar - br;
                im[i + k + half] = ai - bi;

                const nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
}

/** Periodic Hann, the window that makes overlap-add at half a hop exact. */
function hann(n: number): Float64Array {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    return w;
}

/**
 * Triangular mel filterbank, as a flat BANDS x bins matrix.
 *
 * Rows are normalised to sum to one, so a band carries the average of its bins
 * rather than a total that grows with how wide the band happens to be.
 */
function melBank(bins: number, sampleRate: number): Float64Array {
    const toMel = (f: number) => 2595 * Math.log10(1 + f / 700);
    const toHz = (m: number) => 700 * (10 ** (m / 2595) - 1);

    const low = toMel(LOW_HZ);
    const high = toMel(sampleRate / 2);

    const edges = new Float64Array(BANDS + 2);
    for (let i = 0; i < edges.length; i++) edges[i] = toHz(low + (high - low) * i / (BANDS + 1));

    const bank = new Float64Array(BANDS * bins);
    const nyquist = sampleRate / 2;

    for (let m = 0; m < BANDS; m++) {
        const l = edges[m];
        const c = edges[m + 1];
        const r = edges[m + 2];

        let sum = 0;
        for (let b = 0; b < bins; b++) {
            const f = b * nyquist / (bins - 1);
            const rise = (f - l) / Math.max(c - l, EPS);
            const fall = (r - f) / Math.max(r - c, EPS);
            const v = Math.max(0, Math.min(rise, fall));

            bank[m * bins + b] = v;
            sum += v;
        }

        if (sum > EPS) for (let b = 0; b < bins; b++) bank[m * bins + b] /= sum;
    }

    return bank;
}

/* --------------------------------------------------------------------- NMF */

/**
 * A reproducible stream of small positive numbers.
 *
 * The factorisation has to start somewhere, and starting from a constant does
 * not work: the updates are multiplicative, so every component would be
 * identical and stay identical. `Math.random` would do, except that then the
 * same clip separates slightly differently every time it is opened, and a
 * result that moves cannot be checked against a measurement.
 */
function seeded(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff + 0.1;
    };
}

/** out = w * h, w being BANDS x components and h components x frames. */
function product(w: Float64Array, h: Float64Array, out: Float64Array, components: number, frames: number): void {
    out.fill(0);

    for (let r = 0; r < BANDS; r++) {
        const to = r * frames;

        for (let k = 0; k < components; k++) {
            const weight = w[r * components + k];
            if (weight <= EPS) continue;

            const from = k * frames;
            for (let t = 0; t < frames; t++) out[to + t] += weight * h[from + t];
        }
    }
}

function updateH(w: Float64Array, h: Float64Array, ratio: Float64Array, components: number, frames: number): void {
    for (let k = 0; k < components; k++) {
        let column = 0;
        for (let r = 0; r < BANDS; r++) column += w[r * components + k];
        if (column <= EPS) continue;

        const at = k * frames;
        for (let t = 0; t < frames; t++) {
            let sum = 0;
            for (let r = 0; r < BANDS; r++) sum += w[r * components + k] * ratio[r * frames + t];
            h[at + t] *= sum / column;
        }
    }
}

function updateW(w: Float64Array, h: Float64Array, ratio: Float64Array, components: number, frames: number, from = 0): void {
    for (let k = from; k < components; k++) {
        let row = 0;
        for (let t = 0; t < frames; t++) row += h[k * frames + t];
        if (row <= EPS) continue;

        for (let r = 0; r < BANDS; r++) {
            let sum = 0;
            for (let t = 0; t < frames; t++) sum += ratio[r * frames + t] * h[k * frames + t];
            w[r * components + k] *= sum / row;
        }
    }
}

/**
 * Learns a dictionary from a set of frames, optionally next to known ones.
 *
 * Multiplicative updates on the Kullback-Leibler divergence, the usual choice
 * for magnitude spectra: it counts a quiet band being wrong as heavily as a
 * loud one, and a voice lives in the quiet bands as much as anywhere. The
 * columns are renormalised each pass so the scale ends up in the activations
 * instead of drifting into the dictionary.
 *
 * `known` is a dictionary for sound that is already accounted for - people who
 * have been modelled already and are talking in these frames too. It is placed
 * alongside and left alone: its activations still move, so it can take back
 * whatever part of the sound belongs to it, and what the new columns are left
 * holding is the rest. That is what makes somebody learnable who is never once
 * alone in the whole clip.
 */
function learn(v: Float64Array, frames: number, iterations = ITERATIONS, known?: Float64Array): Float64Array {
    const next = seeded(12345);

    const fixed = known ? known.length / BANDS : 0;
    const components = fixed + COMPONENTS;

    const w = new Float64Array(BANDS * components);
    for (let r = 0; r < BANDS; r++) {
        for (let k = 0; k < fixed; k++) w[r * components + k] = known![r * fixed + k];
        for (let k = fixed; k < components; k++) w[r * components + k] = next();
    }

    const h = new Float64Array(components * frames);
    for (let i = 0; i < h.length; i++) h[i] = next();

    const wh = new Float64Array(BANDS * frames);
    const ratio = new Float64Array(BANDS * frames);

    for (let pass = 0; pass < iterations; pass++) {
        product(w, h, wh, components, frames);
        for (let i = 0; i < ratio.length; i++) ratio[i] = v[i] / (wh[i] + EPS);
        updateH(w, h, ratio, components, frames);

        product(w, h, wh, components, frames);
        for (let i = 0; i < ratio.length; i++) ratio[i] = v[i] / (wh[i] + EPS);
        updateW(w, h, ratio, components, frames, fixed);

        for (let k = fixed; k < components; k++) {
            let sum = 0;
            for (let r = 0; r < BANDS; r++) sum += w[r * components + k];
            if (sum > EPS) for (let r = 0; r < BANDS; r++) w[r * components + k] /= sum;
        }
    }

    // Only the new columns are anybody's business: the caller already has the
    // ones it passed in.
    const learned = new Float64Array(BANDS * COMPONENTS);
    for (let r = 0; r < BANDS; r++) {
        for (let k = 0; k < COMPONENTS; k++) learned[r * COMPONENTS + k] = w[r * components + fixed + k];
    }

    return learned;
}

/** Lets the browser paint between stages of a long job. */
const breathe = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Fits the assembled dictionaries to the whole clip. Only activations move.
 *
 * The dictionaries stay frozen because they are the answer: they were learned
 * where the ground truth was known, and letting them drift here would let one
 * person's shapes wander towards whatever they were being heard over.
 */
async function fitAll(
    w: Float64Array, components: number, v: Float64Array, frames: number,
    onProgress?: (done: number) => void
): Promise<Float64Array> {
    const next = seeded(6789);

    const h = new Float64Array(components * frames);
    for (let i = 0; i < h.length; i++) h[i] = next();

    const wh = new Float64Array(BANDS * frames);
    const ratio = new Float64Array(BANDS * frames);

    for (let pass = 0; pass < ITERATIONS; pass++) {
        product(w, h, wh, components, frames);
        for (let i = 0; i < ratio.length; i++) ratio[i] = v[i] / (wh[i] + EPS);
        updateH(w, h, ratio, components, frames);

        if (pass % YIELD_EVERY === YIELD_EVERY - 1) {
            onProgress?.((pass + 1) / ITERATIONS);
            await breathe();
        }
    }

    return h;
}

/** Lays several dictionaries side by side, as the fitting wants them. */
function assemble(dictionaries: Float64Array[]): Float64Array {
    const components = dictionaries.length * COMPONENTS;
    const w = new Float64Array(BANDS * components);

    for (let m = 0; m < BANDS; m++) {
        for (let p = 0; p < dictionaries.length; p++) {
            for (let k = 0; k < COMPONENTS; k++) {
                w[m * components + p * COMPONENTS + k] = dictionaries[p][m * COMPONENTS + k];
            }
        }
    }

    return w;
}

/**
 * Passes spent learning what is left over once the voices are accounted for.
 *
 * Half the usual, because this dictionary has an easier job: it does not have
 * to tell anything apart, only to be able to hold whatever the voices could not
 * explain. Spending the full count here would add a second to every clip for a
 * result that sounds the same.
 */
const RESIDUAL_ITERATIONS = 30;

/**
 * Frames the residual dictionary is learned from at most.
 *
 * Learning is linear in the number of frames and a long clip has tens of
 * thousands of them, which is minutes of arithmetic for a dictionary that only
 * has to describe a room. Every nth frame describes the same room.
 */
const RESIDUAL_FRAMES = 2000;

/* ---------------------------------------------------------------- analysis */

/**
 * True when this clip could be separated at all.
 *
 * Two people and some activity recorded, and short enough to hold in memory.
 * With one person a mute is simply silence, which the duck already does
 * perfectly and instantly.
 */
export function canSeparate(buffer: AudioBuffer, tracks: VoiceTrack[]): boolean {
    return tracks.length >= 2 && buffer.duration > 1 && buffer.duration <= MAX_SECONDS;
}

/**
 * Learns who is who in one file.
 *
 * Independent of the levels on purpose. This is the several seconds of
 * arithmetic, and it describes the recording rather than what anybody wants
 * done to it, so moving a slider afterwards costs only `mixAnalysis`.
 *
 * Returns null when there is nothing to learn - one voice, or a clip where
 * everybody talks at once from beginning to end. The caller falls back to the
 * duck, which is what happened before any of this existed.
 */
export async function analyseVoices(
    buffer: AudioBuffer,
    tracks: VoiceTrack[],
    onProgress?: (done: number) => void
): Promise<VoiceAnalysis | null> {
    const { sampleRate, length, numberOfChannels } = buffer;
    const bins = NFFT / 2 + 1;
    const frames = Math.floor((length - NFFT) / HOP) + 1;

    if (frames < MIN_SOLO * 2) return null;

    /* ---- one transform, kept ---- */

    const channels: Float32Array[] = [];
    for (let c = 0; c < numberOfChannels; c++) channels.push(buffer.getChannelData(c));

    const window = hann(NFFT);
    const re = new Float64Array(NFFT);
    const im = new Float64Array(NFFT);

    const specRe: Float32Array[] = [];
    const specIm: Float32Array[] = [];
    for (let c = 0; c < numberOfChannels; c++) {
        specRe.push(new Float32Array(bins * frames));
        specIm.push(new Float32Array(bins * frames));
    }

    /*
     * The fit runs on the mono sum.
     *
     * Which frequencies belong to whom is a fact about the call, not about
     * which side of the stereo image a voice landed on, so fitting each channel
     * would be twice the work for the same answer. The sum is taken in the
     * frequency domain, where it is free: the transform is linear, so adding
     * the spectra is adding the channels.
     */
    const banded = new Float64Array(BANDS * frames);
    const bank = melBank(bins, sampleRate);

    for (let t = 0; t < frames; t++) {
        const at = t * HOP;

        for (let c = 0; c < numberOfChannels; c++) {
            const channel = channels[c];
            for (let i = 0; i < NFFT; i++) {
                re[i] = channel[at + i] * window[i];
                im[i] = 0;
            }

            fft(re, im, NFFT);

            const outRe = specRe[c];
            const outIm = specIm[c];
            for (let b = 0; b < bins; b++) {
                outRe[b * frames + t] = re[b];
                outIm[b * frames + t] = im[b];
            }
        }

        for (let m = 0; m < BANDS; m++) {
            let sum = 0;

            for (let b = 0; b < bins; b++) {
                const weight = bank[m * bins + b];
                if (weight <= EPS) continue;

                let sumRe = 0;
                let sumIm = 0;
                for (let c = 0; c < numberOfChannels; c++) {
                    sumRe += specRe[c][b * frames + t];
                    sumIm += specIm[c][b * frames + t];
                }

                sum += weight * Math.hypot(sumRe, sumIm) / numberOfChannels;
            }

            banded[m * frames + t] = sum;
        }

        if ((t & 255) === 255) {
            onProgress?.(0.2 * (t + 1) / frames);
            await breathe();
        }
    }

    onProgress?.(0.2);
    await breathe();

    /* ---- who was talking, frame by frame ---- */

    const speaking: Uint8Array[] = [];
    const counts = new Uint8Array(frames);

    for (const track of tracks) {
        const row = new Uint8Array(frames);

        for (let t = 0; t < frames; t++) {
            // The middle of the window is the instant the frame describes.
            const bucket = Math.floor((t * HOP + NFFT / 2) / sampleRate * VOICE_HZ);
            if (bucket < track.levels.length && track.levels[bucket] > 0) {
                row[t] = 1;
                counts[t]++;
            }
        }

        speaking.push(row);
    }

    let overlapping = 0;
    for (let t = 0; t < frames; t++) if (counts[t] > 1) overlapping++;

    const dilate = (row: Uint8Array): Uint8Array => {
        const wide = new Uint8Array(frames);

        for (let t = 0; t < frames; t++) {
            if (!row[t]) continue;

            const from = Math.max(0, t - DILATE_AHEAD);
            const to = Math.min(frames - 1, t + DILATE_BACK);
            for (let i = from; i <= to; i++) wide[i] = 1;
        }

        return wide;
    };

    /* ---- a dictionary each, plus one for everything else ---- */

    const take = (pick: (t: number) => boolean): { v: Float64Array; n: number; } => {
        const rows: number[] = [];
        for (let t = 0; t < frames; t++) if (pick(t)) rows.push(t);

        const v = new Float64Array(BANDS * rows.length);
        for (let m = 0; m < BANDS; m++) {
            for (let i = 0; i < rows.length; i++) v[m * rows.length + i] = banded[m * frames + rows[i]];
        }

        return { v, n: rows.length };
    };

    const modelled: string[] = [];
    const tooQuiet: string[] = [];
    const dictionaries: Float64Array[] = [];
    const present: Uint8Array[] = [];

    /*
     * Learned in rounds rather than in one pass down the list.
     *
     * The first round takes whoever is alone somewhere in the clip, which is
     * the clean case. On a real call that is often one person and no more: a
     * mic left open, or somebody with no noise gate, reads as speaking from the
     * first second to the last, and then nobody else is ever technically alone.
     * A single pass gives up there, and the feature turns itself off on exactly
     * the calls it was wanted for.
     *
     * So each round widens what counts as alone. Once somebody has a dictionary
     * their voice is accounted for, and a frame whose only other speaker is
     * them is as good as a solo frame for the person being learned: `learn`
     * holds the known dictionary beside the new one and lets it take its own
     * sound back, leaving the new columns holding the rest. Two or three rounds
     * usually reach everybody.
     */
    const done = new Uint8Array(tracks.length);

    for (let round = 0; round < tracks.length; round++) {
        let learned = 0;

        for (let i = 0; i < tracks.length; i++) {
            if (done[i]) continue;

            const row = speaking[i];
            const clear = take(t => {
                if (row[t] !== 1) return false;

                for (let j = 0; j < tracks.length; j++) {
                    if (j !== i && !done[j] && speaking[j][t] === 1) return false;
                }

                return true;
            });

            if (clear.n < MIN_SOLO) continue;

            dictionaries.push(learn(clear.v, clear.n, ITERATIONS, round === 0 ? undefined : assemble(dictionaries)));
            modelled.push(tracks[i].id);
            present.push(dilate(row));
            done[i] = 1;
            learned++;

            onProgress?.(0.2 + 0.3 * modelled.length / tracks.length);
            await breathe();
        }

        if (!learned) break;
    }

    for (let i = 0; i < tracks.length; i++) if (!done[i]) tooQuiet.push(tracks[i].id);

    if (!modelled.length) return null;

    /*
     * The rest of the sound - the game, the room, a keyboard - gets a
     * dictionary too, and it is not optional. Without one the fit has no way to
     * explain that sound except with somebody's voice, so muting them takes the
     * game down with them: where a muted person talks on their own there is
     * then nothing left to keep, and the clip goes completely silent. That is
     * exactly what it sounded like, and it is the whole reason this branch
     * exists.
     *
     * The easy case is a clip with a gap in the conversation, where the frames
     * nobody speaks in are a clean recording of the background. A busy call has
     * no such gap - somebody is always talking - so the background is taken
     * from what the voices could not account for: the dictionaries learned
     * above are fitted to the whole clip, and whatever is left over is, by
     * definition, not any of these people.
     */
    const quiet = take(t => counts[t] === 0);
    const order = [...modelled];

    if (quiet.n >= MIN_SOLO) {
        dictionaries.push(learn(quiet.v, quiet.n));
    } else {
        const voiceW = assemble(dictionaries);
        const voiceComponents = dictionaries.length * COMPONENTS;
        const voiceH = await fitAll(voiceW, voiceComponents, banded, frames);

        const explained = new Float64Array(BANDS * frames);
        product(voiceW, voiceH, explained, voiceComponents, frames);

        const stride = Math.max(1, Math.ceil(frames / RESIDUAL_FRAMES));
        const kept = Math.ceil(frames / stride);

        const residual = new Float64Array(BANDS * kept);
        for (let m = 0; m < BANDS; m++) {
            for (let t = 0, at = 0; t < frames; t += stride, at++) {
                residual[m * kept + at] = Math.max(0, banded[m * frames + t] - explained[m * frames + t]);
            }
        }

        dictionaries.push(learn(residual, kept, RESIDUAL_ITERATIONS));

        onProgress?.(0.5);
        await breathe();
    }

    order.push("");
    present.push(new Uint8Array(frames).fill(1));

    /* ---- fit all of them to the clip at once ---- */

    const parts = dictionaries.length;
    const components = parts * COMPONENTS;
    const w = assemble(dictionaries);

    const h = await fitAll(w, components, banded, frames, done => onProgress?.(0.5 + 0.5 * done));

    onProgress?.(1);

    return {
        modelled, tooQuiet, overlapping, frames,
        sampleRate, channels: numberOfChannels, length,
        re: specRe, im: specIm, bank, w, h, parts, order, present
    };
}

/* --------------------------------------------------------------------- mix */

/**
 * True when the levels ask for something only separation can give.
 *
 * Nothing is rebuilt for sliders alone: a partial level is a share of an
 * instant, which the duck works out exactly and for free. It is the mute that
 * cannot be done by turning the mix down, so the mute is what pays for this.
 */
export function needsSeparation(analysis: VoiceAnalysis, levels: VoiceLevels | undefined): boolean {
    if (!levels) return false;
    return analysis.modelled.some(id => voiceGainOf(levels, id) === 0);
}

/**
 * The levels the duck still has to handle after separation.
 *
 * Whoever was modelled has had their level applied to the samples already, so
 * ducking them a second time would take them down twice. Whoever was too quiet
 * to model keeps their level here and is handled the old way - which, for
 * somebody who says two words, is very nearly the same thing.
 */
export function duckLevels(analysis: VoiceAnalysis, levels: VoiceLevels | undefined): VoiceLevels | undefined {
    if (!levels || !analysis.tooQuiet.length) return undefined;

    const rest: VoiceLevels = {};
    for (const id of analysis.tooQuiet) {
        const gain = voiceGainOf(levels, id);
        if (gain !== 1) rest[id] = gain;
    }

    return Object.keys(rest).length ? rest : undefined;
}

/**
 * Rebuilds the clip's sound with everyone's level applied to their own voice.
 *
 * The mask is worked out once from the fit and applied to every channel, so a
 * stereo clip keeps its image instead of having each side filtered into a
 * slightly different shape.
 */
export async function mixAnalysis(
    analysis: VoiceAnalysis,
    levels: VoiceLevels | undefined,
    ctx: BaseAudioContext,
    onProgress?: (done: number) => void
): Promise<AudioBuffer> {
    const { frames, parts, w, h, bank, sampleRate, channels, length } = analysis;
    const bins = NFFT / 2 + 1;
    const components = parts * COMPONENTS;

    /*
     * The mask, in bands.
     *
     * `wanted` is what should survive: each person's share scaled by their
     * level, plus all of the background, which nobody asked to lose. `total` is
     * everything present, except that a muted person is counted several times
     * over so that what is theirs comes off harder than an exact estimate
     * would. Both are squared, which is the Wiener form and measured a little
     * cleaner than the plain ratio.
     *
     * Only the people whose activity puts them in the frame are counted at all,
     * and that gate is what turns a good separation into a mute. Where a muted
     * person is the only one talking, nothing is left to keep and the mask is
     * exactly zero rather than merely small - measured, that is the difference
     * between them being 16 dB down and being absent. Where they are not
     * talking, their dictionary cannot be charged for the game audio, so the
     * rest of the clip comes through untouched instead of a couple of decibels
     * darker.
     */
    const gains = analysis.order.map(id => (id ? Math.max(0, voiceGainOf(levels, id)) : 1));
    const bandMask = new Float64Array(BANDS * frames);
    const energy = new Float64Array(parts);
    const { present } = analysis;

    for (let m = 0; m < BANDS; m++) {
        for (let t = 0; t < frames; t++) {
            for (let p = 0; p < parts; p++) {
                if (!present[p][t]) {
                    energy[p] = 0;
                    continue;
                }

                let sum = 0;
                for (let k = 0; k < COMPONENTS; k++) {
                    sum += w[m * components + p * COMPONENTS + k] * h[(p * COMPONENTS + k) * frames + t];
                }
                energy[p] = sum * sum;
            }

            let wanted = 0;
            let total = 0;
            for (let p = 0; p < parts; p++) {
                wanted += gains[p] * energy[p];
                total += (gains[p] === 0 ? SUBTRACT : 1) * energy[p];
            }

            bandMask[m * frames + t] = total > EPS ? wanted / total : 1;
        }
    }

    onProgress?.(0.2);
    await breathe();

    /*
     * Stretched back over the bins.
     *
     * The bank's rows sum to one across the bins of a band, not across the
     * bands touching a bin, so what lands on each bin has to be divided by the
     * weight it actually received. A bin no band reaches - under 60 Hz, or
     * right at Nyquist - is left alone at 1 rather than zeroed.
     */
    const mask = new Float64Array(bins * frames);
    const cover = new Float64Array(bins);

    for (let m = 0; m < BANDS; m++) {
        for (let b = 0; b < bins; b++) {
            const weight = bank[m * bins + b];
            if (weight <= EPS) continue;

            cover[b] += weight;
            for (let t = 0; t < frames; t++) mask[b * frames + t] += weight * bandMask[m * frames + t];
        }
    }

    for (let b = 0; b < bins; b++) {
        const at = b * frames;

        if (cover[b] <= EPS) {
            for (let t = 0; t < frames; t++) mask[at + t] = 1;
            continue;
        }

        for (let t = 0; t < frames; t++) mask[at + t] = Math.min(1, mask[at + t] / cover[b]);
    }

    onProgress?.(0.3);
    await breathe();

    /* ---- back to samples ---- */

    const window = hann(NFFT);
    const re = new Float64Array(NFFT);
    const im = new Float64Array(NFFT);

    const norm = new Float64Array(length + NFFT);
    for (let t = 0; t < frames; t++) {
        const at = t * HOP;
        for (let i = 0; i < NFFT; i++) norm[at + i] += window[i] * window[i];
    }

    const out = ctx.createBuffer(channels, length, sampleRate);

    for (let c = 0; c < channels; c++) {
        const acc = new Float64Array(length + NFFT);
        const inRe = analysis.re[c];
        const inIm = analysis.im[c];

        for (let t = 0; t < frames; t++) {
            for (let b = 0; b < bins; b++) {
                const scale = mask[b * frames + t];
                const vr = inRe[b * frames + t] * scale;
                const vi = inIm[b * frames + t] * scale;

                // An inverse transform is a forward one on the conjugate,
                // divided by the length, so the sign flips here rather than in
                // a second pass over the array.
                re[b] = vr;
                im[b] = -vi;

                // The upper half of a real signal's spectrum mirrors the lower.
                if (b > 0 && b < bins - 1) {
                    re[NFFT - b] = vr;
                    im[NFFT - b] = vi;
                }
            }

            fft(re, im, NFFT);

            const at = t * HOP;
            for (let i = 0; i < NFFT; i++) acc[at + i] += (re[i] / NFFT) * window[i];
        }

        const channel = out.getChannelData(c);
        for (let i = 0; i < length; i++) {
            // The last half-window has nothing overlapping it to reconstruct
            // from, so it stays at zero rather than being divided by almost
            // nothing and turned into a burst of noise.
            channel[i] = norm[i] > 1e-6 ? acc[i] / norm[i] : 0;
        }

        onProgress?.(0.3 + 0.7 * (c + 1) / channels);
        await breathe();
    }

    onProgress?.(1);

    return out;
}
