/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the people in the voice channel
 *
 * A clip of a voice call is a clip of a conversation, and what a player wants
 * from it is control over who is how loud, plus a way to see who was talking
 * when. Neither of those is a separate audio track, and that is worth being
 * blunt about: Discord decodes and mixes the call inside its native voice
 * module, so the renderer never holds a MediaStream per person, and the
 * loopback Chromium hands out is already one mixed signal. No browser API takes
 * that apart again. Literal per-person files mean routing each one through a
 * virtual cable and capturing it as an extra mixer channel.
 *
 * What is real is this:
 *
 *   - every person's level can be moved while the clip is being recorded, on
 *     Discord's own per-user volume, so the mix that lands in the file is the
 *     one that was set
 *   - every person's voice activity can be followed as it happens, which is
 *     what draws one track per person under the studio timeline
 */

import { Logger } from "@utils/Logger";
import { FluxDispatcher, MediaEngineStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

const logger = new Logger("Clipper", "#f0b132");

/** Activity samples per second. Five is smooth enough to read as a waveform. */
export const VOICE_HZ = 5;

const BUCKET_MS = 1000 / VOICE_HZ;

/** Tracks kept per clip, and samples per track: a cap on the metadata file. */
const MAX_TRACKS = 10;
const MAX_SAMPLES = 3000;

/** Someone in the voice channel, as the panel needs them. */
export interface VoicePerson {
    id: string;
    name: string;
    avatar: string;
    self: boolean;
}

/** One person's activity over a clip, one byte per 1/VOICE_HZ second. */
export interface VoiceTrack {
    id: string;
    name: string;
    /** Their avatar, so the render can show who is talking. May be empty. */
    avatar?: string;
    levels: Uint8Array;
}

/** The same track as it is stored, with the samples base64'd. */
export interface VoiceTrackMeta {
    id: string;
    name: string;
    avatar?: string;
    levels: string;
}

/**
 * One person's own audio, saved as a file of its own beside the clip.
 *
 * The activity lanes above say *when* somebody talked; this says where their
 * voice actually is. It is what makes a mute exact: their track is simply not
 * connected, and nothing has to be filtered back out of anybody else's.
 */
export interface VoiceFileMeta {
    id: string;
    name: string;
    /** File name, inside the `voices` folder next to the clip. */
    file: string;
    /** Seconds from the clip's start to this file's first audio. Signed. */
    offset: number;
}

/**
 * Per-person levels kept on a project, as linear gains. 1 is untouched.
 *
 * Keyed by user id rather than by name: two people can share a display name,
 * and a name changes between the recording and the edit.
 */
export type VoiceLevels = Record<string, number>;

interface VoiceEngine {
    on(event: string, listener: (...args: any[]) => void): unknown;
    off?(event: string, listener: (...args: any[]) => void): unknown;
    removeListener?(event: string, listener: (...args: any[]) => void): unknown;
}

function engine(): VoiceEngine | null {
    try {
        return (MediaEngineStore as any)?.getMediaEngine?.() ?? null;
    } catch (e) {
        logger.warn("Could not reach the media engine", e);
        return null;
    }
}

function currentVoiceChannel(): string | undefined {
    try {
        return SelectedChannelStore.getVoiceChannelId() ?? undefined;
    } catch {
        return undefined;
    }
}

/** Somebody's display name, or a short stand-in when the store has no user. */
export function nameOf(userId: string): string {
    try {
        const user = UserStore.getUser(userId) as any;
        return user?.globalName || user?.username || `User ${userId.slice(-4)}`;
    } catch {
        return `User ${userId.slice(-4)}`;
    }
}

/**
 * Someone's avatar, at a size the render can draw without it looking soft.
 *
 * 128 rather than the panel's 32: the same URL is what the speaker badge is
 * painted from, and a 32px image blown up to a badge on a 1080p frame is mush.
 */
function avatarOf(userId: string, size = 128): string {
    try {
        return (UserStore.getUser(userId) as any)?.getAvatarURL?.(undefined, size) ?? "";
    } catch {
        return "";
    }
}

/**
 * Everyone in the voice channel, this client included.
 *
 * Ordered by name so the panel does not reshuffle itself every time someone
 * mutes, and self last: your own slider does nothing, and showing it disabled
 * says why, where leaving it out would just look like a bug.
 */
export function voiceParticipants(): VoicePerson[] {
    const channelId = currentVoiceChannel();
    if (!channelId) return [];

    let ids: string[] = [];
    try {
        ids = Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {});
    } catch (e) {
        logger.warn("Could not read the voice channel members", e);
        return [];
    }

    let me = "";
    try {
        me = UserStore.getCurrentUser()?.id ?? "";
    } catch {
        me = "";
    }

    const people = ids.map(id => ({ id, name: nameOf(id), avatar: avatarOf(id, 32), self: id === me }));

    return people.sort((a, b) => {
        if (a.self !== b.self) return a.self ? 1 : -1;
        return a.name.localeCompare(b.name);
    });
}

/** Packs samples for the metadata file: one byte each, base64'd. */
function encodeLevels(levels: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < levels.length; i++) binary += String.fromCharCode(levels[i]);

    try {
        return btoa(binary);
    } catch (e) {
        logger.warn("Could not encode a voice track", e);
        return "";
    }
}

function decodeLevels(encoded: string): Uint8Array {
    try {
        const binary = atob(encoded);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);

        return out;
    } catch {
        return new Uint8Array();
    }
}

export function toMeta(track: VoiceTrack): VoiceTrackMeta {
    return {
        id: track.id,
        name: track.name,
        ...(track.avatar ? { avatar: track.avatar } : {}),
        levels: encodeLevels(track.levels)
    };
}

export function fromMeta(meta: VoiceTrackMeta): VoiceTrack {
    return {
        id: meta.id,
        name: meta.name,
        ...(meta.avatar ? { avatar: meta.avatar } : {}),
        levels: decodeLevels(meta.levels)
    };
}

/**
 * Who was talking, and how loudly, over the last few minutes.
 *
 * A rolling window like the video buffer, and for the same reason: a clip is
 * saved after the fact, so the activity has to have been kept all along. Two
 * sources feed it, because neither is guaranteed on its own - the engine's
 * VoiceActivity gives a level per user when it is emitted at all, and the
 * SPEAKING dispatch gives a plain yes or no. The louder of the two wins, so a
 * client that only ever reports one of them still draws a usable track.
 */
class VoiceActivityBuffer {
    /** userId -> bucket index (absolute, from the epoch) -> level 0-255. */
    private levels = new Map<string, Map<number, number>>();
    private names = new Map<string, string>();
    private avatars = new Map<string, string>();

    private keepMs = 120_000;
    private running = false;

    /** Whoever the SPEAKING dispatch says is talking right now. */
    private speaking = new Set<string>();
    private ticker: ReturnType<typeof setInterval> | null = null;

    /** When the speaking set was last checked against the channel members. */
    private sweptAt = 0;

    private onActivity = (userId: string, level: number) => {
        if (typeof userId !== "string" || !Number.isFinite(level)) return;

        // The engine's scale is not documented and has been seen both as 0-1 and
        // as a percentage, so it is read as whichever it looks like.
        this.write(userId, level > 1.5 ? level * 2.55 : level * 255);
    };

    private onSpeaking = (event: any) => {
        const userId = event?.userId;
        if (typeof userId !== "string") return;

        if (Number(event?.speakingFlags ?? 0)) this.speaking.add(userId);
        else this.speaking.delete(userId);
    };

    get active(): boolean {
        return this.running;
    }

    /** Starts following the call. `keepSeconds` matches the video buffer. */
    start(keepSeconds: number): void {
        this.keepMs = Math.max(30, keepSeconds + 10) * 1000;
        if (this.running) return;

        this.running = true;
        this.levels.clear();
        this.names.clear();
        this.avatars.clear();
        this.speaking.clear();

        try {
            engine()?.on("VoiceActivity", this.onActivity);
        } catch (e) {
            logger.warn("Could not follow the voice activity", e);
        }

        try {
            FluxDispatcher.subscribe("SPEAKING" as any, this.onSpeaking);
        } catch (e) {
            logger.warn("Could not follow who is speaking", e);
        }

        // A held note is one event, not one per bucket, so the floor a speaking
        // user gets has to be written on a clock rather than on arrival.
        this.ticker = setInterval(() => {
            this.sweepSpeaking();
            for (const userId of this.speaking) this.write(userId, 0);
            this.forget();
        }, BUCKET_MS);
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;

        const media = engine();
        try {
            (media?.off ?? media?.removeListener)?.call(media, "VoiceActivity", this.onActivity);
        } catch (e) {
            logger.warn("Could not stop following the voice activity", e);
        }

        try {
            FluxDispatcher.unsubscribe("SPEAKING" as any, this.onSpeaking);
        } catch (e) {
            logger.warn("Could not stop following who is speaking", e);
        }

        if (this.ticker) clearInterval(this.ticker);
        this.ticker = null;

        this.levels.clear();
        this.names.clear();
        this.avatars.clear();
        this.speaking.clear();
    }

    /**
     * Drops anyone who left the channel while the dispatch had them speaking.
     *
     * SPEAKING only ever says started or stopped, and leaving a call mid-word
     * sends no stop. Without this the ticker keeps writing that person a floor
     * for the rest of the session, which both draws a lane for someone who is
     * not there and pushes a real speaker out of the ten a clip carries.
     */
    private sweepSpeaking(): void {
        if (!this.speaking.size) return;

        const now = Date.now();
        if (now - this.sweptAt < 1000) return;
        this.sweptAt = now;

        const channelId = currentVoiceChannel();
        if (!channelId) {
            this.speaking.clear();
            return;
        }

        let states: Record<string, unknown>;
        try {
            states = (VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {}) as Record<string, unknown>;
        } catch {
            // The store is the only thing that knows; leave the set alone
            // rather than silence someone who is still talking.
            return;
        }

        for (const userId of this.speaking) {
            if (!(userId in states)) this.speaking.delete(userId);
        }
    }

    /**
     * Notes a level for now.
     *
     * A speaking user is worth a visible floor even when no level arrived: the
     * track is read as "who was talking", and a flat line for someone who was
     * plainly audible would be a lie.
     */
    private write(userId: string, level: number) {
        if (!this.running) return;

        const floor = this.speaking.has(userId) ? 70 : 0;
        const value = Math.min(255, Math.max(floor, Math.round(level)));
        if (!value) return;

        let track = this.levels.get(userId);
        if (!track) {
            // A busy channel over a long buffer is still bounded: three times
            // what a clip can carry, so nobody is missing when the time comes.
            if (this.levels.size >= MAX_TRACKS * 3) return;

            track = new Map();
            this.levels.set(userId, track);
        }

        const bucket = Math.floor(Date.now() / BUCKET_MS);
        track.set(bucket, Math.max(track.get(bucket) ?? 0, value));

        if (!this.names.has(userId)) {
            this.names.set(userId, nameOf(userId));
            this.avatars.set(userId, avatarOf(userId));
        }
    }

    /**
     * How loud somebody is right now, from 0 to 1.
     *
     * What the mixer's voice meters read. The bucket before the current one
     * counts too: a bucket that has only just opened is empty for a fraction of
     * a second, and a meter that blinks out between two syllables reads as a
     * broken meter rather than as a pause.
     */
    levelNow(userId: string): number {
        const track = this.levels.get(userId);
        if (!track) return 0;

        const bucket = Math.floor(Date.now() / BUCKET_MS);

        return Math.max(track.get(bucket) ?? 0, track.get(bucket - 1) ?? 0) / 255;
    }

    /**
     * Everybody's level right now, 0 to 1, without asking whose it is.
     *
     * The same reading `levelNow` gives for one person. The highlight watcher
     * counts voices rather than following any of them, so handing it the raw
     * levels saves it a lookup per participant per tick.
     */
    levelsNow(): number[] {
        const bucket = Math.floor(Date.now() / BUCKET_MS);
        const levels: number[] = [];

        for (const track of this.levels.values()) {
            levels.push(Math.max(track.get(bucket) ?? 0, track.get(bucket - 1) ?? 0) / 255);
        }

        return levels;
    }

    /** Drops what has rolled out of the window, so the maps stay bounded. */
    private forget() {
        const oldest = Math.floor((Date.now() - this.keepMs) / BUCKET_MS);

        for (const [userId, track] of this.levels) {
            for (const bucket of track.keys()) {
                if (bucket < oldest) track.delete(bucket);
            }

            if (!track.size) {
                this.levels.delete(userId);
                this.names.delete(userId);
                this.avatars.delete(userId);
            }
        }
    }

    /**
     * The window between two instants, as one dense track per person.
     *
     * Quiet people are left out rather than drawn as an empty lane: someone who
     * never opened their mic during the clip is not part of it.
     */
    slice(fromMs: number, toMs: number): VoiceTrack[] {
        const first = Math.floor(fromMs / BUCKET_MS);
        const count = Math.max(0, Math.min(MAX_SAMPLES, Math.ceil((toMs - fromMs) / BUCKET_MS)));
        if (!count) return [];

        const tracks: { track: VoiceTrack; total: number; }[] = [];

        for (const [userId, buckets] of this.levels) {
            const levels = new Uint8Array(count);
            let total = 0;

            for (let i = 0; i < count; i++) {
                const value = buckets.get(first + i) ?? 0;
                levels[i] = value;
                total += value;
            }

            if (!total) continue;

            tracks.push({
                track: {
                    id: userId,
                    name: this.names.get(userId) ?? nameOf(userId),
                    avatar: this.avatars.get(userId) || avatarOf(userId),
                    levels
                },
                total
            });
        }

        // Loudest first, and only as many as the metadata file will carry.
        return tracks
            .sort((a, b) => b.total - a.total)
            .slice(0, MAX_TRACKS)
            .map(t => t.track);
    }
}

export const voiceActivity = new VoiceActivityBuffer();

/** Drops the samples a repair or a cut took off the front of a clip. */
export function shiftTracks(tracks: VoiceTrack[], bySeconds: number): VoiceTrack[] {
    const drop = Math.round(bySeconds * VOICE_HZ);
    if (drop <= 0) return tracks;

    return tracks
        .map(t => ({ ...t, levels: t.levels.slice(drop) }))
        .filter(t => t.levels.length > 0);
}

/**
 * Someone's level at an instant of the clip, as 0..1.
 *
 * The peak over a window rather than a single sample: the samples are 200ms
 * apart, and reading one makes a badge blink out between two syllables of the
 * same word. `back` and `ahead` are in samples and let the window be
 * asymmetric, which is what the duck needs - it has to be in place before the
 * word starts and stay there through the gap before the next one.
 */
function levelAt(track: VoiceTrack, seconds: number, back = 1, ahead = 1): number {
    const { levels } = track;
    if (!levels.length) return 0;

    const centre = Math.round(seconds * VOICE_HZ);
    let peak = 0;

    for (let i = centre - back; i <= centre + ahead; i++) {
        if (i < 0 || i >= levels.length) continue;
        if (levels[i] > peak) peak = levels[i];
    }

    return peak / 255;
}

/**
 * Samples of hold the duck keeps after someone stops.
 *
 * 600ms behind and 200ms ahead. Without the hold the gain snaps back to 1 in
 * every gap between two words, which is both audible as a pumping and useless:
 * half of what a muted person says lands in one of those gaps.
 */
const DUCK_BACK = 3;
const DUCK_AHEAD = 1;

/**
 * How far down a mute may take the speech band when the person has no track.
 *
 * This used to be zero, and zero was the wrong instruction. On a recording that
 * arrived mixed, a mute at zero cuts everything a voice can reach for as long
 * as the muted person is audible at all - measured across real clips, between a
 * quarter and three fifths of the running time - so muting one person in a
 * seven-person call handed back a clip whose game, music and other voices were
 * hollowed out for most of its length. What was asked for was one voice gone,
 * not the clip gone.
 *
 * So the floor moved off zero, and a mute on a mixed recording is a hard dip
 * rather than a cut: 15dB out of the band that carries the words, held only
 * while that person is audible, which puts them under a game's own noise
 * without emptying the moment around them. It is not the mute that a track per
 * person gives, and nothing done to one mixed signal can be: two people talking
 * at once are the same samples. That mute is `nativeClips.ts`, and where its
 * tracks exist none of this runs at all.
 *
 * The number is the honest half of a trade rather than a tuning. Below about
 * -20dB the rest of the clip starts to sound gutted again, and above about
 * -10dB the muted person can still be followed.
 */
const MUTE_FLOOR = 0.18;

/**
 * The same, for somebody who has been muted outright.
 *
 * 600ms behind and 400ms ahead. Wider than the duck because the flag is not a
 * reliable edge: `SPEAKING` turns on after the first syllable and drops in the
 * gaps between words, so a window cut to the flag leaves the start of a word,
 * the tail of one, and a breath or a laugh between two of them audible - which
 * is precisely what a mute is meant to prevent.
 *
 * It was 400ms and 200ms, chosen to spend as little of the clip as possible,
 * and then 800ms and 400ms after that let a muted person through at the edges
 * of their own words. What decides the width is what a mute costs while it is
 * open, and that changed: it used to be silence, so every extra sample was a
 * hole in the clip and the window was fought over. It is now the speech band
 * alone - the game plays on through it - so the cost of being early is that
 * everyone sounds muffled for a moment rather than that the clip stops.
 *
 * Which is why the back edge came in and the front edge did not. Coming out
 * late is somebody's last syllable in the clip; going in late is a fraction of
 * a second of muffled game. They are not the same mistake.
 */
const MUTE_BACK = 3;
const MUTE_AHEAD = 2;

/**
 * How far either side a mute looks for the speech a gap sits between.
 *
 * 1.6s behind and 1.2s ahead. The window above is a hold around a moment the
 * lane calls speech; this is the answer to the moments it does not. A lane
 * drops to zero between two words, at a breath, under a laugh, wherever the
 * speaking flag lags the voice - and every one of those gaps let a mute close
 * and the next syllable through in the clear. Widening the hold to cover them
 * would hold the notch open past the end of the sentence as well, which spends
 * the game's sound on silence.
 *
 * So the gap is closed from both sides instead: the notch stays shut only where
 * the person can be heard *before* this instant and again *after* it, which is
 * the definition of being in the middle of talking. Outside their speech one of
 * the two sides is silent and nothing changes, so the edges stay exactly as
 * tight as the hold makes them.
 */
const HOLD_BACK = 8;
const HOLD_AHEAD = 6;

/**
 * Whether a muted person can be heard at an instant, gaps included.
 *
 * The one rule, in one place: the duck reads it to decide whether to shut, and
 * `mutedFraction` reads it to say what that costs. They were two copies of the
 * same window once, and the price shown next to a mute stopped matching the
 * mute the moment either of them moved.
 */
function silencedAt(track: VoiceTrack, seconds: number): boolean {
    if (levelAt(track, seconds, MUTE_BACK, MUTE_AHEAD) > 0) return true;

    return levelAt(track, seconds, HOLD_BACK, 0) > 0 && levelAt(track, seconds, 0, HOLD_AHEAD) > 0;
}

/**
 * How much of a clip a mute would dip, from 0 to 1.
 *
 * Shown in the panel next to anyone set to zero, because a mute on a mixed
 * recording has a price and the person paying it should see it before they
 * render. Muting somebody who talks all the way through a clip keeps the notch
 * open for most of it, and every other voice is dulled for as long as it is;
 * muting somebody who chips in twice costs almost nothing. The number is also what makes the window checkable rather than a
 * matter of opinion - a mute that reads 90% is a window that is too wide, not
 * a duck that has landed in the wrong place, and those are opposite repairs.
 */
export function mutedFraction(track: VoiceTrack): number {
    const count = track.levels.length;
    if (!count) return 0;

    let covered = 0;
    for (let i = 0; i < count; i++) {
        if (silencedAt(track, i / VOICE_HZ)) covered++;
    }

    return covered / count;
}

/** A person's level on a project, 1 when they were never touched. */
export function voiceGainOf(levels: VoiceLevels | undefined, userId: string): number {
    const value = Number(levels?.[userId]);
    return Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1;
}

/**
 * How loud the speech band in the clip should be at an instant, so that the
 * per-person levels are heard in the file.
 *
 * A level, not a master volume. What it drives is the notch in `voiceBand.ts`,
 * which reaches the band a voice lives in and nothing else: the game, the
 * music and the low end play through it untouched. Multiplying it into the
 * segment's own gain instead - which is what this used to do - is how a single
 * muted person turned a clip into ten seconds of silence.
 *
 * The honest version of this would be one track per person, and there is none:
 * Discord mixes the call inside its voice module and the loopback Chromium
 * hands out is already one signal. What *is* known, sample by sample, is who
 * was talking - which is enough to duck the whole mix while a given person is
 * one of the people making the noise, and nothing more than that. Nobody
 * touched means a flat 1, so a clip whose panel was never opened is
 * bit-for-bit what it always was.
 *
 * Two rules, because a mute and a slider are different instructions:
 *
 *   - a mute is a hard dip, not a cut. Wherever the muted person is heard, the
 *     speech band drops to `MUTE_FLOOR` and no further, so they go under the
 *     game rather than taking it with them. See the note on that number for
 *     what it costs either way.
 *   - a partial level is proportional. Each speaker's share of an instant is
 *     their level over the total heard, so the shares add up to one: someone
 *     talking alone owns the moment, two at once pull half each.
 *
 * The floor is the reason this is the fallback and not the answer. Two people
 * talking at once are the same samples, and no filter separates them, so the
 * notch that takes one voice out takes the other's clarity with it - and a
 * notch deep enough to make the mute absolute takes the whole clip's middle
 * with it for as long as the muted person keeps talking. Muting exactly, with
 * the rest of the call left alone, is a job for a recording with a track per
 * person - `nativeClips.ts` - not for anything that can be done to one mixed
 * signal after the fact.
 *
 * So what is left to get right here is *how much* of the call a mute takes with
 * it, and that is `MUTE_FLOOR` for the depth and `MUTE_BACK` and `MUTE_AHEAD`
 * for the width. All three are deliberately small; see the notes on them for
 * the measurements.
 *
 * Worth knowing while reading the numbers: the engine's per-user levels do not
 * arrive on every client, and where they do not every sample is the flat
 * SPEAKING floor. On those clients "how loudly" does not exist - only who, and
 * that is why every rule here is about who is talking rather than how much.
 */
export function voiceDuckAt(
    tracks: VoiceTrack[],
    levels: VoiceLevels | undefined,
    seconds: number
): number {
    if (!tracks.length || !levels) return 1;

    /*
     * The muted people first, on their own window, and the deepest dip wins.
     *
     * A pass of its own because the two rules read different windows, and
     * because no share of an instant averages down to the floor: a person
     * muted while three others talk would come out barely touched under the
     * proportional rule, which is not what a mute says. Whoever is muted sets
     * the depth for the instant, and everyone else's share is left out of it.
     */
    for (const track of tracks) {
        if (voiceGainOf(levels, track.id) !== 0) continue;

        if (!silencedAt(track, seconds)) continue;

        /*
         * No exception for "but somebody else was talking too".
         *
         * There was one, behind a setting, and it made the mute useless: on one
         * mixed signal the only way to keep the other voice is to keep the
         * muted one under it, so the setting turned every overlapping moment -
         * which is most of a conversation - into the muted person still being
         * heard. The floor pays for that differently: whoever talks across them
         * loses 15dB of the band they share for those instants and keeps the
         * rest, instead of losing all of it.
         */
        return MUTE_FLOOR;
    }

    const heard: { id: string; level: number; }[] = [];
    let total = 0;

    for (const track of tracks) {
        const level = levelAt(track, seconds, DUCK_BACK, DUCK_AHEAD);
        if (level <= 0) continue;

        heard.push({ id: track.id, level });
        total += level;
    }

    if (!heard.length || total <= 0) return 1;

    let gain = 1;
    for (const { id, level } of heard) gain += (level / total) * (voiceGainOf(levels, id) - 1);

    // Floored like a mute is, and for the same reason: a slider pulled to
    // nothing on somebody who owns the moment is a mute in all but name, and it
    // has no more right to empty the clip than one.
    return Math.min(2, Math.max(MUTE_FLOOR, gain));
}

/** True when any person on the project has been moved off 1. */
export function voiceLevelsTouched(levels: VoiceLevels | undefined): boolean {
    return !!levels && Object.values(levels).some(v => Number.isFinite(v) && v !== 1);
}

/** Who is audible at an instant, loudest first, silenced people left out. */
export function speakingAt(tracks: VoiceTrack[], levels: VoiceLevels | undefined, seconds: number, floor = 0.12): VoiceTrack[] {
    return tracks
        .map(track => ({ track, level: levelAt(track, seconds) }))
        .filter(({ track, level }) => level >= floor && voiceGainOf(levels, track.id) > 0)
        .sort((a, b) => b.level - a.level)
        .map(({ track }) => track);
}
