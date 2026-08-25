/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - one audio track per person, taken before the mix
 *
 * The rest of this plugin is written around a hard fact: the call arrives
 * mixed, so a slider that turns one person down has nothing to turn down. That
 * fact is true on the official desktop client and only there. It is worth
 * spelling out why, because the difference decides what this module can do.
 *
 *   - Discord desktop ships `discord_voice`, a native module. Opus decoding,
 *     per-user volume and the sum into one signal all happen in C++, and the
 *     result goes straight to the output device. The renderer is never handed a
 *     MediaStream for the call, so there is nothing to tap.
 *
 *   - Vesktop, Equibop and the browser run the web client, which has no native
 *     module and therefore does voice over WebRTC. The SFU forwards every
 *     speaker as their own RTP stream, so the peer connection ends up with one
 *     audio receiver per person and the mixing happens in the renderer, after
 *     the point this module reads. One `MediaStreamTrack` per person, live.
 *
 * So this module patches `RTCPeerConnection`, keeps every audio receiver the
 * client opens, and hands them out as taps. On desktop it finds nothing and
 * says so; nothing else in the plugin has to care which client it is on.
 *
 * Naming the taps is the interesting half. WebRTC gives no user id: a receiver
 * carries an SSRC, and the mapping from SSRC to person lives in voice gateway
 * traffic this plugin does not read. Rather than reach into Discord internals
 * that change every other release, the taps are named by watching them. The
 * client already tells us who is speaking, through the same SPEAKING dispatch
 * the activity tracks are built from; a tap that is loud exactly when one
 * person is marked speaking, and quiet the rest of the time, is that person.
 * Correlation over a handful of seconds settles it, and it costs one analyser
 * per tap.
 *
 * A tap stays anonymous until its owner has spoken enough to be told apart.
 * That is not a gap worth papering over: somebody who never speaks has no voice
 * to separate either.
 */

import { Logger } from "@utils/Logger";
import { FluxDispatcher, UserStore } from "@webpack/common";

const logger = new Logger("Clipper", "#f0b132");

/** Matches the activity tracks, so the two timelines line up bucket for bucket. */
const SAMPLE_HZ = 5;
const SAMPLE_MS = 1000 / SAMPLE_HZ;

/** How much history the matcher looks at. Long enough to cover a few turns. */
const HISTORY = SAMPLE_HZ * 30;

/**
 * How sure the matcher has to be before it puts a name on a tap.
 *
 * Correlation between "this track is loud" and "this person is marked speaking"
 * is high for the right pairing and near zero for the wrong one, so the gate can
 * sit well above noise without losing real matches.
 */
const MATCH_FLOOR = 0.45;

/** And how far ahead of the runner-up, so two people talking in lockstep abstain. */
const MATCH_MARGIN = 0.12;

export interface VoiceTap {
    /** Stable for the life of the receiver. */
    id: string;
    /** The person this tap belongs to, once the matcher is sure. */
    userId?: string;
    /** Their display name, for a slider label. */
    name?: string;
    /** The person's audio, before the client mixes it with anybody else's. */
    stream: MediaStream;
    track: MediaStreamTrack;
    /** How confident the naming is, 0 to 1. Undefined while still anonymous. */
    confidence?: number;
}

interface Tracked {
    tap: VoiceTap;
    /** Kept so the track is not garbage collected and keeps flowing. */
    keepAlive: HTMLAudioElement;
    analyser: AnalyserNode;
    source: MediaStreamAudioSourceNode;
    // Spelled out rather than left as a bare `Float32Array`, whose buffer is
    // `ArrayBufferLike` in this TS version and so will not go into
    // `getFloatTimeDomainData`, which wants one backed by a plain ArrayBuffer.
    frame: Float32Array<ArrayBuffer>;
    /** Rolling loudness, newest last, one entry per sample tick. */
    energy: number[];
    dead: boolean;
}

let nativePeerConnection: typeof RTCPeerConnection | null = null;
let installed = false;

const tracked = new Map<string, Tracked>();
const speaking = new Set<string>();
/** userId -> rolling 0/1 speaking history, aligned with every tap's energy. */
const speech = new Map<string, number[]>();

let ctx: AudioContext | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let counter = 0;

function audioContext(): AudioContext {
    if (!ctx || ctx.state === "closed") ctx = new AudioContext();
    // Chromium starts a context suspended when the page has never been touched.
    if (ctx.state === "suspended") ctx.resume().catch(() => void 0);

    return ctx;
}

/** Every receiver currently open, named where the matcher could name it. */
export function voiceTaps(): VoiceTap[] {
    return [...tracked.values()].filter(t => !t.dead).map(t => t.tap);
}

/**
 * A one-line summary of what the tap layer can see, for the log and the UI.
 *
 * Written to be readable by somebody deciding whether per-person sliders will
 * work for them, which is the first question anybody asks.
 */
export function probeVoiceTaps(): string {
    if (!installed) return "Voice taps are not installed.";
    if (!nativePeerConnection) return "This client has no WebRTC: per-person audio is not reachable (official Discord desktop).";

    const all = voiceTaps();
    if (!all.length) return "WebRTC is in use, but no voice receiver is open. Join a call, and rejoin it if you were already in one.";

    const named = all.filter(t => t.userId);
    return `${all.length} voice receiver(s) open, ${named.length} matched to a person: ${named.map(t => t.name).join(", ") || "none yet"}.`;
}

function nameOf(userId: string): string {
    try {
        const user = UserStore.getUser(userId) as any;
        return user?.globalName || user?.username || `User ${userId.slice(-4)}`;
    } catch {
        return `User ${userId.slice(-4)}`;
    }
}

const onSpeaking = (event: any) => {
    const userId = event?.userId;
    if (typeof userId !== "string") return;

    if (Number(event?.speakingFlags ?? 0)) speaking.add(userId);
    else speaking.delete(userId);
};

/**
 * Starts a tap on one incoming audio track.
 *
 * The keep-alive element is not decoration. A remote track that is only wired
 * into Web Audio and never played by a media element is allowed to deliver
 * silence in Chromium, and does. Playing it at zero volume keeps the pipeline
 * pulling without adding a second copy of the call to the speakers.
 */
function register(track: MediaStreamTrack) {
    if (track.kind !== "audio" || track.readyState === "ended") return;

    const id = `tap-${++counter}`;

    try {
        const context = audioContext();
        const own = new MediaStream([track]);

        const keepAlive = new Audio();
        keepAlive.srcObject = own;
        keepAlive.volume = 0;
        keepAlive.autoplay = true;
        keepAlive.play().catch(() => void 0);

        const source = context.createMediaStreamSource(own);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const entry: Tracked = {
            tap: { id, stream: own, track },
            keepAlive,
            analyser,
            source,
            frame: new Float32Array(analyser.fftSize),
            energy: [],
            dead: false
        };

        tracked.set(id, entry);
        track.addEventListener("ended", () => drop(id));

        logger.info(`Voice tap opened (${id}), ${tracked.size} open in total`);
    } catch (e) {
        logger.warn("Could not open a voice tap", e);
    }
}

function drop(id: string) {
    const entry = tracked.get(id);
    if (!entry) return;

    entry.dead = true;
    try {
        entry.source.disconnect();
        entry.keepAlive.srcObject = null;
        entry.keepAlive.pause();
    } catch (e) {
        logger.warn("Could not close a voice tap cleanly", e);
    }

    tracked.delete(id);
}

/** Loudness of one tap right now, as a plain RMS over the latest frame. */
function loudness(entry: Tracked): number {
    entry.analyser.getFloatTimeDomainData(entry.frame);

    let sum = 0;
    for (let i = 0; i < entry.frame.length; i++) sum += entry.frame[i] * entry.frame[i];

    return Math.sqrt(sum / entry.frame.length);
}

function push(history: number[], value: number) {
    history.push(value);
    if (history.length > HISTORY) history.shift();
}

/**
 * Pearson correlation, on the overlapping tail of two histories.
 *
 * Zero when either side never moves, which is the case that matters: a tap that
 * was silent throughout, or a person who never spoke, must not match anything
 * rather than match everything.
 */
function correlation(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n < SAMPLE_HZ * 3) return 0;

    const left = a.slice(a.length - n);
    const right = b.slice(b.length - n);

    let meanA = 0;
    let meanB = 0;
    for (let i = 0; i < n; i++) {
        meanA += left[i];
        meanB += right[i];
    }
    meanA /= n;
    meanB /= n;

    let cov = 0;
    let varA = 0;
    let varB = 0;
    for (let i = 0; i < n; i++) {
        const da = left[i] - meanA;
        const db = right[i] - meanB;
        cov += da * db;
        varA += da * da;
        varB += db * db;
    }

    if (varA <= 0 || varB <= 0) return 0;

    return cov / Math.sqrt(varA * varB);
}

/**
 * Puts a name on every tap it can, and leaves the rest anonymous.
 *
 * Greedy and one to one: the best pairing in the whole table is taken first,
 * then both sides are struck out and the next best is taken, so two taps can
 * never claim the same person. A pairing has to clear the floor and beat the
 * runner-up for that tap, which is what keeps two people who only ever talk at
 * the same time from being swapped.
 */
function match() {
    const taps = [...tracked.values()].filter(t => !t.dead);
    if (!taps.length || !speech.size) return;

    const scores: Array<{ tap: Tracked; userId: string; score: number; }> = [];

    for (const tap of taps) {
        for (const [userId, history] of speech) {
            scores.push({ tap, userId, score: correlation(tap.energy, history) });
        }
    }

    scores.sort((a, b) => b.score - a.score);

    const takenTaps = new Set<Tracked>();
    const takenUsers = new Set<string>();

    for (const entry of scores) {
        if (entry.score < MATCH_FLOOR) break;
        if (takenTaps.has(entry.tap) || takenUsers.has(entry.userId)) continue;

        // The runner-up for this same tap, ignoring people already spoken for.
        const rival = scores.find(
            other => other.tap === entry.tap && other.userId !== entry.userId && !takenUsers.has(other.userId)
        );
        if (rival && entry.score - rival.score < MATCH_MARGIN) continue;

        takenTaps.add(entry.tap);
        takenUsers.add(entry.userId);

        if (entry.tap.tap.userId !== entry.userId) {
            logger.info(`Voice tap ${entry.tap.tap.id} matched to ${nameOf(entry.userId)} (${entry.score.toFixed(2)})`);
        }

        entry.tap.tap.userId = entry.userId;
        entry.tap.tap.name = nameOf(entry.userId);
        entry.tap.tap.confidence = entry.score;
    }
}

function tick() {
    for (const entry of tracked.values()) {
        if (entry.dead) continue;
        push(entry.energy, loudness(entry));
    }

    // Everybody seen speaking keeps a history, including the stretches where
    // they are silent: a run of zeroes is what makes the correlation mean
    // anything. A person who has never spoken has no row at all.
    for (const userId of speaking) if (!speech.has(userId)) speech.set(userId, []);

    for (const [userId, history] of speech) {
        push(history, speaking.has(userId) ? 1 : 0);

        // A full window with nothing in it is somebody who has left the call:
        // a row of zeroes correlates with nothing, so all it can still do is
        // sit in the matcher as a candidate that will never win.
        if (history.length >= HISTORY && !history.some(Boolean)) speech.delete(userId);
    }

    match();
}

/**
 * Wraps `RTCPeerConnection` so every connection the client opens is watched.
 *
 * Transparent on purpose: the wrapper hands back a real connection and keeps the
 * prototype, so nothing Discord does with it can tell the difference. Anything
 * thrown while observing is swallowed, because breaking the constructor breaks
 * voice for the whole client.
 */
function patch() {
    const native = window.RTCPeerConnection;
    if (typeof native !== "function") {
        logger.info("No WebRTC on this client: per-person audio is not reachable");
        return;
    }

    nativePeerConnection = native;

    const wrapper = function (this: any, ...args: any[]) {
        const pc = new (native as any)(...args);

        try {
            pc.addEventListener("track", (event: RTCTrackEvent) => {
                try {
                    if (event.track?.kind === "audio") register(event.track);
                } catch (e) {
                    logger.warn("Could not handle an incoming track", e);
                }
            });
        } catch (e) {
            logger.warn("Could not observe a peer connection", e);
        }

        return pc;
    } as unknown as typeof RTCPeerConnection;

    wrapper.prototype = native.prototype;
    Object.setPrototypeOf(wrapper, native);

    window.RTCPeerConnection = wrapper;
    (window as any).webkitRTCPeerConnection = wrapper;
}

/**
 * Installs the tap layer.
 *
 * Call it as early as the plugin starts: a connection opened before the patch is
 * in place is invisible to it, so somebody already sitting in a call has to
 * rejoin once. That is the whole cost of not hooking Discord internals.
 */
export function installVoiceTaps(): void {
    if (installed) return;
    installed = true;

    patch();

    try {
        FluxDispatcher.subscribe("SPEAKING" as any, onSpeaking);
    } catch (e) {
        logger.warn("Could not follow who is speaking", e);
    }

    ticker = setInterval(tick, SAMPLE_MS);
    logger.info("Voice taps installed");
}

export function uninstallVoiceTaps(): void {
    if (!installed) return;
    installed = false;

    if (ticker) clearInterval(ticker);
    ticker = null;

    try {
        FluxDispatcher.unsubscribe("SPEAKING" as any, onSpeaking);
    } catch (e) {
        logger.warn("Could not stop following who is speaking", e);
    }

    for (const id of [...tracked.keys()]) drop(id);
    speech.clear();
    speaking.clear();

    if (nativePeerConnection) {
        window.RTCPeerConnection = nativePeerConnection;
        (window as any).webkitRTCPeerConnection = nativePeerConnection;
    }

    ctx?.close().catch(() => void 0);
    ctx = null;
}
