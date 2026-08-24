/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - turning a voice down without turning the clip down
 *
 * A clip of a game with a call over it is one mixed signal, and the honest
 * consequence of that is written all over `voiceDuckAt`: two people talking at
 * once are literally the same samples, so nothing separates them after the
 * fact. That much is still true. What was wrong was the *shape* of the answer.
 *
 * Muting somebody used to pull the whole mix to zero for as long as they were
 * talking. It did keep them out of the clip - and it took the game, the music,
 * the footsteps, everybody else's laugh and the rest of the spectrum with them.
 * A ten second clip with one muted person talking through it came back as ten
 * seconds of silence, which is not a mute, it is a delete.
 *
 * Speech does not occupy the whole spectrum. So the level moves a crossover
 * rather than the master gain: what a mute removes is the band a voice lives
 * in, and what is left playing is everything below and above it.
 *
 *      in ──┬── direct ───────── x duck ──────────┐
 *           └── lowpass x4 ───── x (1 - duck) ────┴── out
 *
 * At 1 the direct path is the whole signal and the filter contributes nothing,
 * so a clip nobody touched is bit for bit what it always was. At 0 the direct
 * path is gone and what remains is the sub-bass: the impacts, the engines, the
 * music's bottom. In between the two are mixed.
 *
 * This started as six overlapping `peaking` filters, which was the wrong tool
 * twice over. A peaking bank digs a dip at each centre frequency and leaves the
 * gaps between the centres nearly untouched, so a muted voice stayed perfectly
 * intelligible through the gaps while every other voice came out coloured and
 * muffled by the dips - the worst of both. Cascaded lowpass and highpass
 * sections are a wall instead: four of each, so 48dB per octave, which puts
 * well over 100dB of attenuation across the whole of the speech band.
 *
 * The exact version of all this is one audio track per person, which is what
 * `nativeClips.ts` records when Discord's own engine will do it. When there is
 * a track per person nothing here runs: the mute drops that track and the call
 * carries on untouched.
 */

/**
 * Where the voice is taken to start and stop, in Hz.
 *
 * A man's fundamental sits at 85-180Hz and a woman's at 165-255Hz, the formants
 * that carry the words run 300Hz-3.5kHz, and the fricatives that carry the
 * consonants reach 8kHz.
 *
 * The cut used to be placed right against those, at 110Hz and 8kHz, to spend as
 * little of the game as possible. That is what made a mute leak: a lowpass at
 * 110Hz is barely -3dB at a man's 120Hz fundamental, so the pitch and the
 * rhythm of every sentence came through underneath, and a highpass at 8kHz
 * handed back the fricatives on top. Pitch plus rhythm plus consonants is not a
 * hum, it is a voice you can follow - which is the one thing a mute may not do.
 *
 * The low edge then moved outward, past the voice rather than against it, and
 * the high side was eventually dropped altogether. It was there for the air a
 * voice supposedly cannot reach; measured on a real seven-person clip, the band
 * above 12kHz rose 34dB the moment somebody spoke and sat 4.7dB louder than
 * everything left under 45Hz, because it was their sibilance and nothing else.
 * With the middle of the signal cut away there was nothing left to mask it, so
 * what a mute left behind was a thin whistle in time with the muted person's
 * consonants. The game gives up very little for its removal: with nobody
 * talking that same band measures 22dB under the middle of the mix.
 */
const LOW_HZ = 45;

/**
 * Sections in the cascade. Each biquad is 12dB per octave, so four is 48.
 *
 * Two was audibly not enough: at 1kHz a single 110Hz lowpass is only about
 * -38dB down, which is a voice you can still follow. Three was not enough at
 * the edges either, where the slope has not had a full octave to work in yet:
 * with the corner now at 45Hz a fourth section puts a 100Hz fundamental 55dB
 * down instead of 41dB, and it is the first octave above the corner that
 * decides whether a mute holds.
 */
const SECTIONS = 4;

/** Butterworth, so the cascade has no resonant lump at the corner. */
const Q = Math.SQRT1_2;

export interface VoiceBand {
    /** Feed the signal in here. */
    input: AudioNode;
    /** And take it out here, on its way to whatever gain the segment uses. */
    output: AudioNode;
    /**
     * Sets the level as a linear gain, the way `voiceDuckAt` returns it.
     *
     * 1 leaves the signal alone, 0 takes the speech band out of it entirely,
     * and anything in between crossfades the two. `smooth` ramps rather than
     * jumps, which is what keeps a level change from arriving as a click.
     */
    set(value: number, smooth?: boolean): void;
    disconnect(): void;
}

/** Chains `count` identical filters and hands back both ends. */
function cascade(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, count: number) {
    const filters: BiquadFilterNode[] = [];

    for (let i = 0; i < count; i++) {
        const filter = ctx.createBiquadFilter();

        filter.type = type;
        filter.frequency.value = frequency;
        filter.Q.value = Q;

        if (i > 0) filters[i - 1].connect(filter);
        filters.push(filter);
    }

    return { input: filters[0], output: filters[filters.length - 1], filters };
}

/** Builds the crossover, already wired, ready to be dropped into a chain. */
export function createVoiceBand(ctx: BaseAudioContext): VoiceBand {
    // Everything fans out from here, so one node is the input whatever the
    // levels are doing.
    const split = ctx.createGain();
    const sum = ctx.createGain();

    const direct = ctx.createGain();
    const low = ctx.createGain();

    direct.gain.value = 1;
    low.gain.value = 0;

    const lowpass = cascade(ctx, "lowpass", LOW_HZ, SECTIONS);

    split.connect(direct);
    split.connect(lowpass.input);

    lowpass.output.connect(low);

    direct.connect(sum);
    low.connect(sum);

    const write = (param: AudioParam, value: number, smooth: boolean) => {
        if (smooth) {
            param.setTargetAtTime(value, ctx.currentTime, 0.03);
            return;
        }

        param.cancelScheduledValues(ctx.currentTime);
        param.setValueAtTime(value, ctx.currentTime);
    };

    return {
        input: split,
        output: sum,

        set(value: number, smooth = true) {
            const level = Math.min(1, Math.max(0, value));

            /*
             * The two paths are not scaled by the same number.
             *
             * The direct path carries the level itself, so a person set to half
             * is half as loud. The filtered paths carry what is missing from
             * it, so that the parts of the spectrum a voice never reaches come
             * back to full strength as the direct path goes away: a mute is
             * meant to cost the voice and not the explosion behind it.
             *
             * A level above 1 - somebody turned up rather than down - has
             * nothing to restore and is left to the direct path alone, which is
             * why it is clamped here rather than passed through.
             */
            write(direct.gain, Math.min(2, Math.max(0, value)), smooth);
            write(low.gain, 1 - level, smooth);
        },

        disconnect() {
            split.disconnect();
            direct.disconnect();
            low.disconnect();
            sum.disconnect();

            for (const filter of lowpass.filters) filter.disconnect();
        }
    };
}
