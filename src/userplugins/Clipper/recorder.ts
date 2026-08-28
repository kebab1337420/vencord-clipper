/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - rolling capture buffer
 *
 * A MediaRecorder runs continuously with a 1s timeslice. Chunks older than the
 * configured clip length are dropped, so memory stays bounded while the last
 * N seconds are always available for saving.
 */

import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";
import { FluxDispatcher, Toasts, UserStore } from "@webpack/common";

import { type ChatLine, chatLog, shiftChat } from "./chat";
import { playClipSound } from "./clipSound";
import { runningGame, watchRunningGame } from "./game";
import { highlights } from "./highlights";
import { dropMeta, tagSavedClip } from "./library";
import { MicInput } from "./micInput";
import { gainOf, MIC_CHANNEL, type MixerLevel, readMixer, SYSTEM_CHANNEL, voiceLevelsFrom } from "./mixer";
import { probeAudioTracks } from "./mp4";
import { muxNativeAudio } from "./mux";
import type { CaptureSource } from "./native";
import { arm, canRecord, disarm, engineTornDown, goLiveActive, nativeAvailability, saveNativeClip, setRecordUser, watchRecording } from "./nativeClips";
import { hasVideoTrack } from "./nativeTracks";
import { lengthBytes, repairBytes, trimBytes } from "./repair";
import { Container, extensionFor, mimeTypeChain, settings } from "./settings";
import { writeThumbnail } from "./thumbnail";
import { toast } from "./toasts";
import { errorMessage, formatBytes, TIMESLICE, timestampName } from "./utils";
import { shiftTracks, toMeta, voiceActivity, type VoiceFileMeta, voiceParticipants,type VoiceTrack } from "./voice";
import { voiceBuffers } from "./voiceRecord";

export const logger = new Logger("Clipper", "#f0b132");

export type RecorderState = "idle" | "starting" | "recording" | "saving";

/**
 * How often the consent poll re-reads the call, in milliseconds.
 *
 * A backstop rather than the mechanism: `VOICE_STATE_UPDATES` does the real
 * work now, and this only catches an event that never arrived. It was three
 * seconds when it was the only path, and three seconds of somebody's first
 * sentence is the part of a clip most likely to be worth keeping.
 */
const CONSENT_MS = 1000;

/** A slice of the buffer picked by hand, as epoch milliseconds. */
interface ClipWindow {
    from: number;
    to: number;
}

/**
 * The buffer handed over as something playable, written nowhere.
 *
 * `start` is the instant the footage begins at, which is what turns a position
 * in the player back into a window of the buffer, and the markers are already
 * relative to it so the preview can draw them without doing that sum again.
 */
export interface BufferPreview {
    blob: Blob;
    mimeType: string;
    start: number;
    end: number;
    marks: number[];
}

interface TimedChunk {
    blob: Blob;
    /** Timestamp (ms) at which the chunk was handed to us. */
    at: number;
}

/** How often the client's memory is looked at while the buffer runs. */
const MEMORY_WATCH_MS = 60_000;

/**
 * How much the client has to have grown, in megabytes, to earn another line.
 *
 * A high water mark rather than a reading a minute: the point of the log is a
 * shape over hours, and a client that breathes twenty megabytes either way says
 * nothing worth a line.
 */
const MEMORY_STEP_MB = 128;

/**
 * A single process this big is the one about to take the client down with it.
 *
 * Well under what a 64-bit process can address, and well over anything a client
 * that is merely busy reaches: the crashes this watches for arrive with one
 * process far out ahead of the rest.
 */
const MEMORY_WARN_MB = 2_000;

/** How long an automatic highlight save waits before it may fire again. */
const AUTO_SAVE_MS = 120_000;

/** How much of the buffer an automatic save keeps, in seconds. */
const AUTO_SAVE_SECONDS = 30;

type Listener = (state: RecorderState) => void;

/**
 * Containers whose encoder failed on this client.
 *
 * `MediaRecorder.isTypeSupported` speaks for the build, not for the machine: a
 * Chromium that claims H.264 still dies on the first frame when the encoder
 * behind it is broken, and a client or driver update is enough to break it.
 * What failed once fails again, so it is skipped from then on rather than
 * costing a dead buffer at every start.
 *
 * Remembered on disk rather than for the session, and against the client's own
 * build string. Launching again is not new information, and a buffer that
 * announced the same broken encoder at every single launch read as a plugin
 * that could not encode rather than as a client that cannot. A client or
 * Chromium update changes that string, and every container is tried again from
 * scratch - so does starting the buffer by hand, which is what somebody who has
 * just changed a driver does.
 */
const brokenEncoders = new Set<string>();
let brokenLoaded = false;

/** Client and Chromium in one line: an update to either can bring an encoder back. */
function clientBuild(): string {
    return navigator.userAgent;
}

function knownBroken(): Set<string> {
    if (brokenLoaded) return brokenEncoders;
    brokenLoaded = true;

    const stored = settings.store.brokenEncoders as { build?: string; mimes?: string[]; } | undefined;
    if (stored?.build === clientBuild()) for (const mime of stored.mimes ?? []) brokenEncoders.add(mime);

    return brokenEncoders;
}

function rememberBroken(mime: string): void {
    knownBroken().add(mime);
    settings.store.brokenEncoders = { build: clientBuild(), mimes: [...brokenEncoders] };
}

function forgetBroken(): void {
    brokenLoaded = true;
    brokenEncoders.clear();
    settings.store.brokenEncoders = { build: clientBuild(), mimes: [] };
    forgetRelayOnly();
}

/**
 * Containers whose encoder only works on a capture redrawn into a canvas.
 *
 * A hardware H.264 encoder handed the compositor's own frames is the
 * arrangement that dies with `EncodingError - The given encoder configuration
 * is not supported by the encoder`, while the same encoder takes a canvas
 * without a word. Once the canvas has been shown to work here, going the direct
 * way again at the next launch buys nothing: it costs a dead encoder, a red
 * line in the console and the first seconds of the buffer, every single time.
 *
 * Remembered against the client build like the broken list above, so a client
 * or driver update tries the direct way once more - and cleared with it when
 * the user starts the buffer by hand.
 */
const relayEncoders = new Set<string>();
let relayLoaded = false;

function knownRelayOnly(): Set<string> {
    if (relayLoaded) return relayEncoders;
    relayLoaded = true;

    const stored = settings.store.relayEncoders as { build?: string; mimes?: string[]; } | undefined;
    if (stored?.build === clientBuild()) for (const mime of stored.mimes ?? []) relayEncoders.add(mime);

    return relayEncoders;
}

function rememberRelayOnly(mime: string): void {
    knownRelayOnly().add(mime);
    settings.store.relayEncoders = { build: clientBuild(), mimes: [...relayEncoders] };
}

function forgetRelayOnly(): void {
    relayLoaded = true;
    relayEncoders.clear();
    settings.store.relayEncoders = { build: clientBuild(), mimes: [] };
}

/** H.264 encoders take an even width and an even height, and nothing else. */
function evenSize(n: number): number {
    return Math.max(2, Math.round(n / 2) * 2);
}

/*
 * Where the mix is held, in dBFS, and where it is allowed to peak.
 *
 * Nothing in a Web Audio graph is bounded. Every channel below has its own gain
 * and they are all added together, so two sources that each sit just under full
 * scale come out of the sum above it, and the encoder is handed a signal it
 * cannot represent. Measured on clips this plugin had already written: true
 * peaks between +1.3 and +3.0 dBFS on every one of them, with the loudness
 * range untouched - so the sound was never squashed, it was clipped, and every
 * player and every re-encode after that flattened the tops off it.
 *
 * A decibel of headroom and a ceiling two below full scale. The gap between the
 * two is for the codec: a lossy encoder reconstructs a waveform that overshoots
 * the samples it was given, by a decibel or two on this material, and a mix
 * mastered exactly to zero comes back out of Opus above it.
 */
const HEADROOM_DB = -1;
const CEILING_DB = -2;

/** Decibels to the linear gain a Web Audio node wants. */
function fromDb(db: number): number {
    return Math.pow(10, db / 20);
}

/**
 * The last stage every channel is summed into, here and in the studio render.
 *
 * A safety net and not an effect: the ceiling is two decibels under full scale
 * on a signal that runs at around -12 LUFS, so it is doing nothing at all for
 * the great majority of any clip and only ever catches the peaks that would
 * otherwise have been clipped flat. That is the opposite of what a compressor
 * on a mix bus is normally for, and it is why the ratio is a wall rather than
 * a slope: anything gentler leaves part of the overshoot in place.
 *
 * The node costs about six milliseconds of latency, which is a fifth of a frame
 * at 30 FPS and far below anything anybody can hear against a picture.
 */
export function buildMixBus(ctx: BaseAudioContext, destination: AudioNode): AudioNode {
    const master = ctx.createGain();
    master.gain.value = fromDb(HEADROOM_DB);

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = CEILING_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    master.connect(limiter);
    limiter.connect(destination);

    return master;
}

/** What the last save produced, enough to cut it down or send it somewhere. */
export interface SavedClip {
    name: string;
    path: string;
    blob: Blob;
    mimeType: string;
    /** Marker offsets in seconds, already relative to this clip's start. */
    markers: number[];
    /** Who was talking during it, on the same clock as the markers. */
    voices: VoiceTrack[];
    /** What the chat said during it, on that clock too. */
    chat?: ChatLine[];
}

class ClipRecorder {
    /** Whether a save has already said out loud that the engine would not write. */
    private nativeSaveWarned = false;
    /** Saves in a row the engine answered with nothing at all. */
    private nativeFailures = 0;

    /** Whether Discord's own clip engine is armed alongside our buffer. */
    private native = false;

    /**
     * The engine's own clip, when it came back with the call but no picture.
     *
     * Set by `saveNative` and consumed by the save that follows it, which is
     * the one that has the picture: on a screen capture the engine records
     * every voice separately and no video at all, so the two halves are muxed
     * into one file rather than one of them being thrown away.
     */
    private nativeAudio: Uint8Array | null = null;
    /** Who the native engine has already been told it may record. */
    private consented = new Set<string>();
    /** Poll that keeps that set level with the voice channel. */
    private consentTicker: ReturnType<typeof setInterval> | null = null;
    /**
     * The same, on the client's own word rather than on a timer.
     *
     * The poll alone leaves a window: somebody joins, and until the next tick
     * the engine has not been told it may record them, so whatever they say in
     * that gap is in no track and cannot be muted or lifted afterwards. The
     * store fires the moment the voice state changes, which closes the window
     * to as near nothing as this side can get. The poll stays underneath it,
     * because a missed event is silent and a missed tick is not.
     */
    private onVoiceStates = () => this.grantConsent();
    /** Whether the subscription above is currently attached. */
    private consentBound = false;
    /** Poll that writes down what the client is holding. See `watchMemory`. */
    private memoryTicker: ReturnType<typeof setInterval> | null = null;
    private stream: MediaStream | null = null;
    /** Discord's microphone, gated the way Discord gates it. See ./micInput. */
    private mic: MicInput | null = null;
    /** Loopback opened separately when the captured source carried no sound. */
    private systemStream: MediaStream | null = null;
    private audioCtx: AudioContext | null = null;
    private destination: MediaStreamAudioDestinationNode | null = null;
    /** What the channels are summed into, in front of the destination. */
    private bus: AudioNode | null = null;
    private recorder: MediaRecorder | null = null;

    /** Extra input devices opened for the mix, kept so they can be stopped. */
    private extraStreams: MediaStream[] = [];

    /** Live gain stage and meter of every channel in the mix, by channel id. */
    private channels = new Map<string, { gain: GainNode; meter: AnalyserNode; factor: number; data: Uint8Array<ArrayBuffer>; freq: Uint8Array<ArrayBuffer>; }>();

    /** Set while the clip sound is playing, so it is not recorded. See duckSystem(). */
    private duckTimer: ReturnType<typeof setTimeout> | null = null;
    private duckedUntil = 0;

    /**
     * The source the running capture is on, which is not always the picked one.
     *
     * A game moves the capture onto a screen for as long as it runs, and the
     * native engine has to be pointed at what is really being recorded rather
     * than at what the settings remember.
     */
    private activeSource: CaptureSource | null = null;

    /** Drops the running-game listener; set only while the buffer runs. */
    private gameWatch: (() => void) | null = null;

    /**
     * Set when the source was picked by hand, so a game does not overrule it.
     *
     * Somebody who picks a window in the middle of a game means that window.
     * A game *starting* clears it again: that is a new context, and following
     * it is the whole point of the setting.
     */
    private pickedByHand = false;

    /** Not before this instant does a highlight save another clip by itself. */
    private autoSaveAfter = 0;

    /** First chunk emitted by the recorder: holds the container header. */
    private header: Blob | null = null;
    private chunks: TimedChunk[] = [];

    /**
     * Moments marked by the user, as epoch ms.
     *
     * Kept in wall-clock rather than as offsets because the buffer's start moves
     * with every prune; they are turned into offsets once, at save time, when
     * the clip's own start is finally known.
     */
    private marks: number[] = [];

    /**
     * The clip written by the last save, kept whole.
     *
     * It is what "keep the last N seconds" cuts down, and reading it back off
     * the disk to do that would be slower and could race a rename. Dropped on
     * the next save, so at most one clip is held.
     */
    private lastSaved: SavedClip | null = null;

    /**
     * Bumped by every cleanup, so a `start()` still awaiting its stream knows the
     * user stopped the buffer in the meantime and drops what it acquired instead
     * of arming a recorder nobody asked for.
     */
    private generation = 0;

    /**
     * Resolved by the next chunk, used to flush the recorder before a save.
     *
     * A list rather than a slot: a preview opened while a save is running waits
     * on the same chunk, and a single slot would leave the first of them parked
     * until its own timeout instead of waking it with the chunk it asked for.
     */
    private nextChunk: Array<() => void> = [];

    /**
     * The containers left to try, best first, and where in that list we are.
     *
     * An encoder that fails takes its own container out of the running and the
     * next one is armed on the same capture, so a broken H.264 costs the clip
     * its container instead of costing the user their buffer.
     */
    private mimeChain: string[] = [];
    private mimeIndex = 0;

    /** The stream being encoded, kept so a failed encoder can be re-armed on it. */
    private recordStream: MediaStream | null = null;

    /**
     * Tears down the canvas the capture is being redrawn into, when there is
     * one. Doubles as the record of having already tried that, so a container
     * gets the canvas once and not once per candidate.
     */
    private relay: (() => void) | null = null;

    private listeners = new Set<Listener>();

    state: RecorderState = "idle";
    mimeType = "";

    get isRecording() {
        return this.state === "recording";
    }

    /**
     * Seconds currently held in the buffer.
     *
     * Measured from the oldest kept chunk rather than from the start of the
     * capture, so it stays honest right after a prune and while the buffer is
     * still filling up.
     */
    get bufferedSeconds() {
        const oldest = this.chunks[0];
        if (!oldest) return 0;

        // A chunk handed over at T covers the timeslice that ends at T.
        const span = (Date.now() - oldest.at + TIMESLICE) / 1000;
        return Math.min(span, settings.store.clipLength);
    }

    get bufferedBytes() {
        return this.chunks.reduce((sum, c) => sum + c.blob.size, 0) + (this.header?.size ?? 0);
    }

    /** Markers currently inside the buffer, for the overlay's counter. */
    get markCount() {
        return this.marks.length;
    }

    /** The clip written by the last save, or null when none was written yet. */
    get lastClip(): SavedClip | null {
        return this.lastSaved;
    }

    /**
     * Instant at which the footage still in the buffer begins.
     *
     * A chunk handed over at T covers the timeslice that ends at T, so the
     * oldest one starts a timeslice before it was handed over.
     */
    private get bufferStart() {
        const oldest = this.chunks[0];
        return oldest ? oldest.at - TIMESLICE : Date.now();
    }

    /**
     * Notes the moment, without writing anything.
     *
     * The point is that marking is free: the player hits the key when something
     * happens and keeps playing, and the marks that are still in the buffer when
     * a clip is finally saved are written next to it.
     */
    mark(): void {
        if (!this.isRecording) {
            toast("Clip buffer is not running", Toasts.Type.FAILURE);
            return;
        }

        this.marks.push(Date.now());
        this.prune();

        const at = Math.max(0, Math.round((Date.now() - this.bufferStart) / 1000));
        toast(`Marker at ${at}s (${this.marks.length} in the buffer)`, Toasts.Type.MESSAGE);
    }

    /**
     * A marker nobody pressed a key for, from the highlight watcher.
     *
     * Silent on purpose: the player is in a game, there is one of these every
     * couple of minutes at most, and a toast for each is noise on top of the
     * moment it is trying to catch. The overlay's counter is where they show up.
     */
    private markAuto(reason: string): void {
        if (!this.isRecording) return;

        this.marks.push(Date.now());
        this.prune();

        logger.info(`Marked by itself - ${reason} (${this.marks.length} in the buffer)`);

        if (!settings.store.autoHighlightSave) return;

        // Rarer than the markers by a long way: a marker costs nothing and a
        // clip costs a file, so a lively evening must not fill the folder.
        const now = Date.now();
        if (now < this.autoSaveAfter) return;

        this.autoSaveAfter = now + AUTO_SAVE_MS;

        toast(`Saving a clip: ${reason}`, Toasts.Type.MESSAGE);
        void this.save(Math.min(AUTO_SAVE_SECONDS, settings.store.clipLength));
    }

    /**
     * Puts the highlight watcher where the setting and the buffer say it should
     * be, whenever either of them moves.
     *
     * Called from `start` and from the settings listener, because a watcher that
     * is only ever armed on `start` leaves somebody who turns the setting on
     * mid-game waiting for the next stop and start before anything is marked.
     */
    restartHighlights(): void {
        if (!highlights.active) return;

        // Which detectors run is decided when the watcher starts, so a setting
        // that turns one on or off has to take it down and put it back up.
        highlights.stop();
        this.syncHighlights();
    }

    syncHighlights(): void {
        // Not `isRecording`, which is false for the few seconds a save takes:
        // stopping the watcher there would leave it stopped, since the state
        // going back to "recording" afterwards passes through nothing that
        // would start it again.
        const running = this.state === "recording" || this.state === "saving";
        const want = running && settings.store.autoHighlight;
        if (want === highlights.active) return;

        if (!want) {
            highlights.stop();
            return;
        }

        highlights.start({
            channelLevel: id => this.channelLevel(id),
            channelSpectrum: id => this.channelSpectrum(id),
            videoTrack: () => this.videoTrack,
            onHighlight: reason => this.markAuto(reason)
        });
    }

    subscribe(listener: Listener) {
        this.listeners.add(listener);
        return () => void this.listeners.delete(listener);
    }

    private setState(state: RecorderState) {
        this.state = state;
        for (const listener of this.listeners) listener(state);
    }

    /**
     * @param retry Try the containers remembered as broken here again. Set when
     * the user started the buffer themselves, which is what somebody who has
     * just updated a driver does; never on the automatic start at launch.
     */
    async start(retry = false): Promise<boolean> {
        if (this.state !== "idle") return this.isRecording;

        if (retry) forgetBroken();

        this.setState("starting");
        const mine = this.generation;

        try {
            const { fps, resolution, container } = settings.store;

            const { stream, source } = await acquireStream(fps, resolution, !this.pickedByHand);

            // Stopped while the source was being acquired: drop what we just got.
            if (mine !== this.generation) {
                stream.getTracks().forEach(t => t.stop());
                return false;
            }

            this.stream = stream;
            this.activeSource = source;

            const [videoTrack] = stream.getVideoTracks();
            if (!videoTrack) throw new Error("The picked source returned no video track");

            // User stopped the capture from Discord's / the OS' own UI.
            videoTrack.addEventListener("ended", () => this.stop());

            const audioTrack = await this.buildMixedAudio(stream);

            // Same again, this time with the mic stream and the audio graph to drop.
            if (mine !== this.generation) {
                this.cleanup();
                return false;
            }

            const tracks = [videoTrack, audioTrack].filter(Boolean) as MediaStreamTrack[];
            const recordStream = new MediaStream(tracks);

            /*
             * The containers this client will take, minus the ones already known
             * to be broken here: a client whose H.264 encoder fails does it every
             * time, and retrying it on every start would cost a dead buffer and a
             * toast before the fallback each time.
             */
            this.recordStream = recordStream;
            this.mimeChain = mimeTypeChain(container).filter(t => !knownBroken().has(t));
            this.mimeIndex = 0;

            // Everything is broken, which is not the same as nothing being
            // supported: better to try the whole list again than to refuse.
            if (!this.mimeChain.length) this.mimeChain = mimeTypeChain(container);

            /*
             * Onto the canvas before anything is armed, when the direct way is
             * known to fail here: what died once dies again, and it dies after
             * the buffer has started, so the retry costs the first seconds of
             * footage on top of the noise.
             */
            const direct = this.mimeChain[this.mimeIndex];
            if (direct && knownRelayOnly().has(direct)) {
                const relayed = await this.buildRelay();

                if (mine !== this.generation) {
                    this.cleanup();
                    return false;
                }

                if (relayed) {
                    this.recordStream = relayed;
                    logger.info(`Arming ${direct} through a canvas, which is what worked here last time`);
                }
            }

            if (!this.armEncoder()) throw new Error("This client can encode neither MP4 nor WebM");

            // The call is followed on the same window as the footage: a clip is
            // saved after the fact, so who was talking has to have been kept all
            // along or the tracks stop where the save began.
            voiceActivity.start(settings.store.clipLength);

            // And what the call was typing, which is half of why a moment was
            // funny and is not in the picture at all.
            chatLog.start(settings.store.clipLength);

            // And the call itself, one buffer per person, on the same window.
            // Best effort: a client with no reachable per-person audio simply
            // records nothing here and the clip keeps its mixed soundtrack.
            voiceBuffers.start();

            // The microphone joins them, so the person recording is not the one
            // person a mute can silence.
            const me = UserStore.getCurrentUser();
            if (this.mic && me?.id) voiceBuffers.attach(this.mic.track, me.id, (me as any).globalName || me.username || "You");

            this.setState("recording");
            toast(`Clip buffer running - last ${settings.store.clipLength}s kept`, Toasts.Type.SUCCESS);

            // A game launched after the buffer moves the capture onto its screen.
            this.followGame();
            this.watchMemory();

            // And the room is listened to, so the moments nobody had a free hand
            // to mark get marked anyway.
            this.syncHighlights();

            // Last, and never awaited into the result: the native engine is a
            // bonus track layout, not a condition for the buffer to run.
            void this.armNative();
            return true;
        } catch (e) {
            this.cleanup();
            this.setState("idle");

            logger.error("Failed to start capture", e);
            toast(`Could not start the clip buffer: ${errorMessage(e)}`, Toasts.Type.FAILURE);
            return false;
        }
    }

    /**
     * Wires one gain stage per audio channel into a single track.
     *
     * Everything goes through the graph, even a lone system channel: the point
     * is that the levels stay reachable while the buffer runs, so a slider moved
     * mid-game is heard in the next chunk instead of in the next recording.
     */
    private async buildMixedAudio(display: MediaStream): Promise<MediaStreamTrack | undefined> {
        const mixer = readMixer();
        const { includeMic } = settings.store;

        let displayTracks = display.getAudioTracks();

        // A window capture never carries sound. Rather than record a clip whose
        // only audio is the microphone hearing the speakers, the machine's
        // output is opened on its own and mixed in as the system channel.
        if (!displayTracks.length && !mixer.system.muted) {
            this.systemStream = await captureSystemAudio();
            if (this.systemStream) displayTracks = this.systemStream.getAudioTracks();
        }

        if (!displayTracks.length && !includeMic && !mixer.extras.length) return undefined;

        this.audioCtx = new AudioContext();
        this.destination = this.audioCtx.createMediaStreamDestination();
        this.bus = buildMixBus(this.audioCtx, this.destination);

        let systemSource: MediaStreamAudioSourceNode | null = null;

        if (displayTracks.length) {
            systemSource = this.audioCtx.createMediaStreamSource(new MediaStream(displayTracks));
            this.connectChannel(SYSTEM_CHANNEL, systemSource, gainOf(mixer.system));
        }

        if (includeMic) {
            try {
                // The system sound goes in as a reference, never as signal: the
                // gate raises its threshold while the speakers are loud, which
                // is the only defence against the game coming back in through
                // the microphone. See ./micInput.
                this.mic = await MicInput.open(this.audioCtx, systemSource);

                // Discord's input volume slider is not part of the track, so it
                // is folded into the channel's own level rather than lost.
                if (this.mic) this.connectChannel(MIC_CHANNEL, this.mic.node, gainOf(mixer.mic), this.mic.volume);
            } catch (e) {
                logger.warn("Microphone unavailable, recording without it", e);
            }
        }

        for (const extra of mixer.extras) {
            try {
                // Deliberately raw: an extra channel is usually a virtual cable
                // carrying an application's output, and echo cancellation or
                // noise suppression on music is destructive.
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: { exact: extra.deviceId },
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });

                this.extraStreams.push(stream);

                if (stream.getAudioTracks().length) {
                    this.connectChannel(extra.id, this.audioCtx.createMediaStreamSource(stream), gainOf(extra));
                }
            } catch (e) {
                logger.warn(`Could not open the audio channel "${extra.label}"`, e);
                toast(`Audio channel "${extra.label}" is unavailable`, Toasts.Type.FAILURE);
            }
        }

        if (!this.channels.size) {
            this.audioCtx.close().catch(() => void 0);
            this.audioCtx = null;
            this.destination = null;
            this.bus = null;

            return displayTracks[0];
        }

        return this.destination.stream.getAudioTracks()[0];
    }

    /**
     * Adds one source to the mix behind its own gain stage and meter.
     *
     * `factor` is a level that belongs to the device rather than to the slider -
     * Discord's own input volume - so the slider keeps meaning what it says when
     * it is moved later.
     */
    private connectChannel(id: string, source: AudioNode, level: number, factor = 1) {
        const { audioCtx: ctx, bus } = this;
        if (!ctx || !bus) return;

        const gain = ctx.createGain();
        gain.gain.value = level * factor;

        const meter = ctx.createAnalyser();

        // A small window is all a bar in a settings panel needs. The captured
        // source is the exception: ./gameAudio reads its spectrum to tell a
        // gunshot from somebody talking, and at 256 the bands it compares are
        // three bins wide. 1024 puts a step at roughly 47 Hz, which separates
        // them properly and costs nothing next to the encoder.
        meter.fftSize = id === SYSTEM_CHANNEL ? 1024 : 256;

        source.connect(gain);
        gain.connect(bus);
        gain.connect(meter);

        this.channels.set(id, {
            gain,
            meter,
            factor,
            data: new Uint8Array(meter.fftSize),
            freq: new Uint8Array(meter.frequencyBinCount)
        });
    }

    /** Channels currently wired up, in the order they were added. */
    get audioChannels(): string[] {
        return [...this.channels.keys()];
    }

    /** Applies a level to a running mix. No-op when nothing is recording. */
    setChannelLevel(id: string, level: MixerLevel) {
        const channel = this.channels.get(id);
        if (!channel || !this.audioCtx) return;

        const target = gainOf(level) * channel.factor;

        // Ramped rather than set: a gain jump on a live graph is an audible click
        // in the clip that is being buffered right now.
        try {
            channel.gain.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.02);
        } catch {
            channel.gain.gain.value = target;
        }
    }

    /**
     * Holds the machine's own output out of the mix for `ms`.
     *
     * For the clip sound, and only for it. The system channel is a loopback of
     * everything the speakers play, so the notification tone would otherwise be
     * recorded onto the end of the clip it announces and sit in the rolling
     * buffer for the whole clip length after that. The cost is that fraction of
     * a second of game audio, which is why the window comes from the sound's
     * own length rather than from a fixed guess.
     *
     * Overlapping calls extend the silence rather than cutting it short: two
     * clips in quick succession are two tones, and the second one must not be
     * let through by the first one's timer.
     */
    duckSystem(ms: number): void {
        const channel = this.channels.get(SYSTEM_CHANNEL);
        if (!channel || !this.audioCtx || ms <= 0) return;

        this.duckedUntil = Math.max(this.duckedUntil, Date.now() + ms);

        try {
            // Fast, but still a ramp: dropping a live gain to zero on an edge is
            // an audible click in the clip that is being buffered right now.
            channel.gain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.005);
        } catch {
            channel.gain.gain.value = 0;
        }

        if (this.duckTimer != null) clearTimeout(this.duckTimer);

        this.duckTimer = setTimeout(() => {
            this.duckTimer = null;
            this.duckedUntil = 0;

            // Read back rather than remembered: the slider may have moved while
            // the channel was down, and the mixer's value is the current truth.
            this.setChannelLevel(SYSTEM_CHANNEL, readMixer().system);
        }, Math.max(0, this.duckedUntil - Date.now()));
    }

    /**
     * Rough loudness of a channel, 0 to 1, for a level meter.
     *
     * Read after the gain stage, so a muted channel reads zero and the bar shows
     * what is actually going into the clip.
     */
    channelLevel(id: string): number {
        const channel = this.channels.get(id);
        if (!channel) return 0;

        channel.meter.getByteTimeDomainData(channel.data);

        let sum = 0;
        for (const sample of channel.data) {
            const centred = (sample - 128) / 128;
            sum += centred * centred;
        }

        // A quiet voice sits near 0.05 RMS, so the bar is scaled to make the
        // useful range visible rather than a sliver at the far left.
        return Math.min(1, Math.sqrt(sum / channel.data.length) * 3);
    }

    /**
     * A channel's spectrum, and how many hertz one step of it covers.
     *
     * For ./gameAudio, which tells the game apart from the room by the shape of
     * the sound rather than by its level. The buffer is reused between calls,
     * so it is read on the spot and not kept.
     */
    channelSpectrum(id: string): { bins: Uint8Array; hz: number; } | null {
        const channel = this.channels.get(id);
        if (!channel || !this.audioCtx) return null;

        channel.meter.getByteFrequencyData(channel.freq);

        return { bins: channel.freq, hz: this.audioCtx.sampleRate / channel.meter.fftSize };
    }

    /** The picture being recorded, for ./gameVideo. Null when nothing is. */
    get videoTrack(): MediaStreamTrack | null {
        return this.recordStream?.getVideoTracks()[0] ?? null;
    }

    private onChunk(blob: Blob) {
        const notify = this.nextChunk;
        this.nextChunk = [];

        if (blob.size) {
            // The very first chunk carries the container header; every later save
            // reuses it.
            if (!this.header) {
                this.header = blob;
            } else {
                this.chunks.push({ blob, at: Date.now() });
                this.prune();
            }
        }

        for (const resolve of notify) resolve();
    }

    /**
     * Asks the recorder for whatever it holds and waits for that chunk, so a save
     * ends on "now" instead of on the last full timeslice. Gives up quickly: a
     * stalled recorder must not block the save.
     */
    private async flush(): Promise<void> {
        const { recorder } = this;
        if (!recorder || recorder.state !== "recording") return;

        await new Promise<void>(resolve => {
            let done = false;
            const settle = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve();
            };

            const timer = setTimeout(() => {
                this.nextChunk = this.nextChunk.filter(waiting => waiting !== settle);
                settle();
            }, 500);

            this.nextChunk.push(settle);

            try {
                recorder.requestData();
            } catch (e) {
                logger.warn("Could not flush the recorder", e);
                settle();
            }
        });
    }

    /**
     * The buffered chunks handed over after `at`, oldest first.
     *
     * Never empty: a window shorter than one timeslice still has to write
     * something, and the last chunk is the closest thing to it.
     */
    private chunksSince(at: number): TimedChunk[] {
        const kept = this.chunks.filter(c => c.at > at);
        return kept.length ? kept : this.chunks.slice(-1);
    }

    /**
     * The buffered chunks overlapping a window, oldest first.
     *
     * A chunk handed over at T covers the timeslice ending at T, so one is in
     * the window as soon as any part of it is. Never empty for the same reason
     * as `chunksSince`: a save has to write something.
     */
    private chunksIn(from: number, to: number): TimedChunk[] {
        const kept = this.chunks.filter(c => c.at > from && c.at - TIMESLICE < to);
        return kept.length ? kept : this.chunks.slice(-1);
    }

    private prune() {
        // Keep one extra timeslice so the clip is never shorter than asked for.
        const cutoff = Date.now() - (settings.store.clipLength * 1000 + TIMESLICE);
        while (this.chunks.length && this.chunks[0].at < cutoff) this.chunks.shift();

        /*
         * A mark whose footage has been dropped points at nothing.
         *
         * Measured against the oldest chunk only while there is one. With none
         * in hand - the first timeslice after arming, and again after every
         * encoder swap - the buffer starts, by definition, now, and a mark taken
         * a moment ago would be thrown out for sitting behind footage that has
         * not been dropped so much as not yet arrived. That is the case somebody
         * marking the instant they start the buffer lands in every time, and it
         * announced itself as "0 in the buffer" right after they pressed the key.
         */
        const oldest = this.chunks[0];
        const floor = oldest ? oldest.at - TIMESLICE : cutoff;

        if (this.marks.length) this.marks = this.marks.filter(m => m >= floor);
    }

    /**
     * Arms the best encoder still standing on the stream being captured.
     *
     * Walks down the chain rather than trusting the first name: a container that
     * `isTypeSupported` accepts can still refuse to be constructed, and that
     * refusal is the same information as a failure at the first frame.
     */
    private armEncoder(): boolean {
        while (this.mimeIndex < this.mimeChain.length) {
            if (this.tryEncoder(this.mimeChain[this.mimeIndex])) return true;

            rememberBroken(this.mimeChain[this.mimeIndex]);
            this.mimeIndex++;
        }

        return false;
    }

    private tryEncoder(mime: string): boolean {
        const stream = this.recordStream;
        if (!stream) return false;

        const { videoBitrate, audioBitrate } = settings.store;

        /*
         * One keyframe per timeslice.
         *
         * Without it the encoder places keyframes where it likes, which on
         * Chromium's H.264 is several seconds apart. A clip cut out of the
         * buffer has to start on one - everything before the first keyframe
         * is undecodable and gets dropped by the repair - so a buffer asked
         * for ten seconds was handing back three. Chromium reads this option
         * from Chrome 111; older builds ignore it and fall back on the guard
         * in the repair.
         */
        const options: MediaRecorderOptions & { videoKeyFrameIntervalDuration?: number; } = {
            mimeType: mime,
            videoBitsPerSecond: videoBitrate * 1_000_000,
            audioBitsPerSecond: audioBitrate * 1000,
            videoKeyFrameIntervalDuration: TIMESLICE
        };

        let recorder: MediaRecorder;
        try {
            recorder = new MediaRecorder(stream, options);
        } catch (e) {
            logger.warn(`This client would not open a ${mime} encoder`, e);
            return false;
        }

        // The bytes already held were written by the encoder being replaced, in
        // a container the new one knows nothing about: a clip assembled from
        // both is unplayable, so the buffer starts again from here.
        this.recorder = recorder;
        this.mimeType = mime;
        this.header = null;
        this.chunks = [];

        recorder.ondataavailable = e => this.onChunk(e.data);
        recorder.onerror = e => this.onEncoderFailure(e);

        try {
            recorder.start(TIMESLICE);
        } catch (e) {
            logger.warn(`The ${mime} encoder would not start`, e);
            this.recorder = null;
            return false;
        }

        return true;
    }

    /**
     * What to do when the encoder gives up mid-capture.
     *
     * It used to stop the buffer outright, which is how a broken H.264 encoder
     * read from the outside as "the clip buffer will not run any more": the
     * capture was fine, the picture was arriving, and the only thing wrong was
     * the encoder Chromium had just said it supported. The capture is worth more
     * than the container, so the next one in the chain takes over on the same
     * stream and the buffer keeps running.
     */
    private onEncoderFailure(event: Event): void {
        const raised = (event as unknown as { error?: { name?: string; message?: string; }; }).error;
        const detail = [raised?.name, raised?.message].filter(Boolean).join(" - ");
        const failed = this.mimeType;

        // The capture outliving the encoder is what the fallbacks below are
        // for, and they turn this into a container change nobody has to act on.
        // Shouting about it in red read as a plugin that had just broken.
        const captureAlive = this.recordStream?.getVideoTracks()[0]?.readyState === "live";
        const report = captureAlive ? logger.warn : logger.error;

        report.call(logger, `The ${failed} encoder failed${detail ? `: ${detail}` : ""}`, event);

        // The failed encoder is unhooked first: its last chunk arrives after
        // the stop, and by then the next container in the chain may already be
        // running, which would read those bytes as its own header.
        const failing = this.recorder;
        if (failing) {
            failing.ondataavailable = null;
            failing.onerror = null;
        }

        try {
            if (failing && failing.state !== "inactive") failing.stop();
        } catch {
            // An encoder that has already given up throws on being stopped,
            // which is not something the fallback below needs to know about.
        }

        this.recorder = null;

        // Nothing to fall back onto while the capture itself is gone: the
        // picture is what the buffer is for, and without it there is no clip to
        // keep whatever the container.
        if (!captureAlive) {
            toast(`Clip buffer stopped: the ${extensionFor(failed).toUpperCase()} encoder failed${detail ? ` (${detail})` : ""}`, Toasts.Type.FAILURE);
            this.stop();
            return;
        }

        /*
         * H.264 is worth one more try before the clip loses its container.
         *
         * The frames a screen capture hands over are the compositor's own, and
         * a hardware H.264 encoder reading them where they lie is exactly the
         * arrangement that fails on some drivers and after some client updates
         * - while the same encoder takes a canvas without a word. So the
         * capture is redrawn into one, at a size that is fixed and even, and
         * the container is tried again on that before being written off. It
         * costs one drawImage per frame, and only on a client that has already
         * failed the direct way.
         *
         * Only MP4 is worth that: it is the container Discord plays with sound,
         * and the only one the engine's per-person tracks can be muxed into.
         */
        if (failed.startsWith("video/mp4") && !this.relay) {
            void this.retryOnCanvas(failed, detail);
            return;
        }

        this.demote(failed, detail);
    }

    /**
     * Redraws the capture into a canvas and arms the same container on that.
     *
     * Falls through to the next container when the canvas cannot be built or
     * when the encoder refuses it too, which is the same outcome as before this
     * existed.
     */
    private async retryOnCanvas(mime: string, detail: string): Promise<void> {
        const mine = this.generation;
        const relayed = await this.buildRelay();

        /*
         * Stopped while the canvas was starting: this buffer is not ours to arm,
         * and the canvas goes with it.
         *
         * cleanup() ran to completion before buildRelay() returned, so the
         * stopper it installed was written over a null that nobody will call
         * again - and the draw loop behind it would go on painting a stopped
         * capture, every frame, for the rest of the session.
         */
        if (mine !== this.generation) {
            this.relay?.();
            this.relay = null;
            relayed?.getTracks().forEach(t => t.stop());
            return;
        }

        if (relayed) {
            this.recordStream = relayed;

            if (this.tryEncoder(mime)) {
                // The footage they pointed at was written by the dead encoder.
                this.marks = [];

                rememberRelayOnly(mime);
                logger.info(`The ${mime} encoder took the capture through a canvas`);
                return;
            }
        }

        this.demote(mime, detail);
    }

    /**
     * The capture, redrawn into a canvas of its own at a fixed even size.
     *
     * Returns the canvas' stream with the same soundtrack attached, or null
     * when this client will not play a capture into a video element at all.
     */
    private async buildRelay(): Promise<MediaStream | null> {
        const source = this.recordStream;
        const [track] = source?.getVideoTracks() ?? [];
        if (!source || !track) return null;

        const live = track.getSettings();
        const width = evenSize(live.width || 1280);
        const height = evenSize(live.height || 720);
        const fps = settings.store.fps || 30;

        const video = document.createElement("video");
        video.srcObject = new MediaStream([track]);
        video.muted = true;
        video.playsInline = true;

        try {
            await video.play();
        } catch (e) {
            logger.warn("This client would not play the capture into a canvas", e);
            return null;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) {
            // Playing since the await above, and nothing else will stop it: the
            // stopper that does is installed at the end of this function, which
            // this returns before reaching.
            video.pause();
            video.srcObject = null;
            return null;
        }

        let stopped = false;
        let drawn = 0;

        // A source that changes size mid-capture is drawn to fit rather than
        // resizing the canvas: a frame size moving under the encoder is one of
        // the things that kills it.
        const draw = () => {
            if (stopped) return;

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            drawn++;
        };

        // Per source frame where the client offers it, so nothing is drawn
        // twice and nothing is missed; on a timer otherwise.
        const perFrame = (video as HTMLVideoElement & {
            requestVideoFrameCallback?(callback: () => void): number;
        }).requestVideoFrameCallback?.bind(video);

        let ticker = 0;
        const onTimer = () => { ticker = window.setInterval(draw, Math.max(1, Math.round(1000 / fps))); };

        if (perFrame) {
            const step = () => {
                if (stopped) return;
                draw();
                perFrame(step);
            };

            perFrame(step);

            // This video element is never in the document, and a client that
            // declines to call back for one that is not on screen would leave
            // the canvas on its first frame forever. Half a second without one
            // is that client, and the timer takes over.
            setTimeout(() => {
                if (!stopped && drawn < 2 && !ticker) onTimer();
            }, 500);
        } else {
            onTimer();
        }

        // One frame before the encoder is armed, so the first chunk is picture
        // rather than an empty canvas.
        draw();

        const relayed = canvas.captureStream(fps);
        for (const audio of source.getAudioTracks()) relayed.addTrack(audio);

        this.relay = () => {
            stopped = true;
            if (ticker) clearInterval(ticker);

            video.pause();
            video.srcObject = null;
        };

        return relayed;
    }

    /** Takes a container out of the running and arms the next one on the same capture. */
    private demote(failed: string, detail: string): void {
        rememberBroken(failed);
        this.mimeIndex++;

        if (!this.armEncoder()) {
            toast(`Clip buffer stopped: the ${extensionFor(failed).toUpperCase()} encoder failed${detail ? ` (${detail})` : ""}`, Toasts.Type.FAILURE);
            this.stop();
            return;
        }

        // The footage they pointed at was written by the encoder that just died.
        this.marks = [];

        logger.info(`The buffer carried on as ${this.mimeType}`);

        // Falling from one MP4 candidate to the next is not news: the clip is
        // still an MP4 and nothing the user asked for has changed. Losing the
        // container is, and it is said once, here, rather than at every launch.
        if (extensionFor(failed) !== extensionFor(this.mimeType)) {
            toast(
                `This client's ${extensionFor(failed).toUpperCase()} encoder failed${detail ? ` (${detail})` : ""} - the buffer carried on as ${extensionFor(this.mimeType).toUpperCase()}`,
                Toasts.Type.MESSAGE
            );
        }
    }

    stop() {
        if (this.state === "idle") return;

        this.cleanup();
        this.setState("idle");
        this.pickedByHand = false;
        toast("Clip buffer stopped", Toasts.Type.MESSAGE);
    }

    /**
     * Moves the capture onto a game's screen when one starts.
     *
     * Only when one starts. A game closing leaves a screen capture running,
     * which records the desktop perfectly well, whereas restarting there would
     * throw away the buffer holding the last minute of the game that just
     * ended - which is the footage somebody who has just quit a match wants.
     */
    private followGame(): void {
        this.gameWatch?.();
        this.gameWatch = null;

        if (!settings.store.followGame) return;

        this.gameWatch = watchRunningGame(game => {
            if (!game || !settings.store.followGame) return;
            if (this.state !== "recording") return;

            // Already on a screen: a second game, or Discord noticing the same
            // one under another name, is not worth cutting the buffer for.
            if (this.activeSource?.id.startsWith("screen:")) return;

            logger.info(`${game} started, moving the capture onto its screen`);
            this.pickedByHand = false;

            // Out of the store's own dispatch: the restart drops this listener.
            queueMicrotask(() => void this.restart());
        });
    }

    /**
     * Writes down what the client is holding while the buffer runs.
     *
     * Discord's renderer has been dying on `CrRendererMain` with
     * `EXCEPTION_BREAKPOINT`, and once with `E0000008`, which is the code
     * Chromium raises when an allocation fails: the client reloads itself and
     * takes the console with it, so the only account of the hours before a
     * crash is what reached `renderer_js.log`.
     *
     * The number that has to be in there is the per-process working set, not
     * the JavaScript heap. This watch used to be a heap watch and it saw
     * nothing: through the reloads the heap sat flat at 269 MB of a 4 GB limit
     * while the renderer's working set walked from 502 MB to 719 MB, because a
     * capture pipeline holds its frames, its surfaces and its encoder state
     * outside the heap entirely. Worse, the process figures were only ever
     * appended to a line that fired on a new heap peak, so on a flat heap they
     * were never sampled at all.
     *
     * So: every process, every minute, from the main process, and a line only
     * when the client as a whole has taken another `MEMORY_STEP_MB`. Each line
     * names the process that has grown most since the buffer was armed and how
     * fast, which is what tells a renderer leak apart from a GPU one or a media
     * helper one - and those three are fixed in three different places.
     */
    private watchMemory(): void {
        this.stopMemoryWatch();

        // Electron only: `app.getAppMetrics` has no equivalent on the web.
        if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

        /** Each process as it stood on the first sample, to measure growth from. */
        const first = new Map<string, number>();

        let startedAt = 0;

        /** The client total behind the last line written, so only growth talks. */
        let reported = 0;

        this.memoryTicker = setInterval(() => {
            void (async () => {
                let processes: Array<{ type: string; mb: number; }>;

                try {
                    processes = await Native.getMemoryReport();
                } catch {
                    return;
                }

                if (!processes.length) return;

                const at = Date.now();
                const total = processes.reduce((sum, p) => sum + p.mb, 0);

                if (!startedAt) {
                    startedAt = at;
                    for (const p of processes) first.set(p.type, p.mb);
                }

                // A process that has appeared since the first sample counts as
                // having grown from nothing, which is exactly what it did.
                const grown = processes
                    .map(p => ({ type: p.type, mb: p.mb, grew: p.mb - (first.get(p.type) ?? 0) }))
                    .sort((a, b) => b.grew - a.grew)[0];

                const swollen = processes.find(p => p.mb >= MEMORY_WARN_MB);

                // Growth, or a process already big enough to end the session.
                if (!swollen && total < reported + MEMORY_STEP_MB) return;
                reported = total;

                const hours = Math.max(MEMORY_WATCH_MS / 3_600_000, (at - startedAt) / 3_600_000);
                const biggest = processes.slice(0, 5).map(p => `${p.type} ${p.mb}MB`).join(", ");
                const worst = grown && grown.grew > 0
                    ? `, ${grown.type} up ${grown.grew}MB since arming (${Math.round(grown.grew / hours)}MB/h)`
                    : "";

                const line = `Client memory: ${total}MB over ${processes.length} processes`
                    + `${jsHeap()}, clip buffer holding ${formatBytes(this.bufferedBytes)}`
                    + ` | ${biggest}${worst}`;

                if (swollen) logger.warn(`${line} - ${swollen.type} is the one about to go, a reload is what comes next`);
                else logger.info(line);
            })();
        }, MEMORY_WATCH_MS);
    }

    private stopMemoryWatch(): void {
        if (this.memoryTicker) clearInterval(this.memoryTicker);
        this.memoryTicker = null;
    }

    private cleanup() {
        // Any start() still waiting on a stream is now stale.
        this.generation++;

        this.stopMemoryWatch();

        // Detached before the stop, because stopping is what makes the encoder
        // hand over its last chunk. Dropping the reference is not enough: the
        // recorder holds the handler, and a chunk arriving after this would be
        // taken for the header of whatever runs next.
        const going = this.recorder;
        if (going) {
            going.ondataavailable = null;
            going.onerror = null;
        }

        try {
            if (going && going.state !== "inactive") going.stop();
        } catch (e) {
            logger.warn("Error stopping recorder", e);
        }

        for (const resolve of this.nextChunk.splice(0)) resolve();

        voiceActivity.stop();
        voiceBuffers.stop();
        chatLog.stop();

        if (this.consentTicker) clearInterval(this.consentTicker);
        this.consentTicker = null;
        this.consented.clear();

        if (this.consentBound) {
            FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES" as any, this.onVoiceStates);
            this.consentBound = false;
        }

        if (this.native) {
            disarm();
            this.native = false;
        }

        this.recorder = null;
        this.header = null;
        this.chunks = [];
        this.marks = [];

        // The next buffer is a new evening: a stop and a start within two
        // minutes of an automatic clip should not swallow its first highlight.
        this.autoSaveAfter = 0;

        this.relay?.();
        this.relay = null;

        this.recordStream?.getTracks().forEach(t => t.stop());
        this.recordStream = null;

        this.stream?.getTracks().forEach(t => t.stop());
        this.mic?.stop();
        this.systemStream?.getTracks().forEach(t => t.stop());
        this.extraStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
        this.audioCtx?.close().catch(() => void 0);

        // The graph it would put the level back on is gone, but the timer would
        // still be pending: a buffer stopped mid-tone must not leave one behind.
        if (this.duckTimer != null) clearTimeout(this.duckTimer);
        this.duckTimer = null;
        this.duckedUntil = 0;

        highlights.stop();

        this.gameWatch?.();
        this.gameWatch = null;
        this.activeSource = null;

        this.channels.clear();
        this.extraStreams = [];
        this.mic = null;
        this.stream = this.systemStream = null;
        this.audioCtx = null;
        this.destination = null;
        this.bus = null;
    }

    /**
     * The buffer as it stands, playable, written nowhere.
     *
     * The same assembly a save does, minus the file: the fragments are glued to
     * the header and the timeline is rebased so the result starts at zero. It
     * exists so that "save the last thirty seconds" can become "save that bit,
     * the one I am looking at" - the buffer is watched before it is written,
     * and what is written is a window picked in the player rather than a guess
     * made from a keypress.
     */
    async preview(): Promise<BufferPreview | null> {
        if (!this.isRecording || !this.header || !this.chunks.length) return null;

        await this.flush();
        this.prune();

        const { chunks } = this;
        if (!chunks.length) return null;

        const start = chunks[0].at - TIMESLICE;
        const raw = new Blob([this.header, ...chunks.map(c => c.blob)], { type: this.mimeType });

        let blob = raw;
        let cutOff = 0;

        try {
            // One read of the buffer: the repair and the two lengths that say
            // what it took off all work on those same bytes.
            const bytes = new Uint8Array(await raw.arrayBuffer());
            const fixed = repairBytes(bytes, this.mimeType);

            // Whatever the repair took off the front moves the markers with it,
            // and moves the instant the footage begins at by exactly as much.
            if (fixed) {
                blob = new Blob([fixed as BlobPart], { type: this.mimeType });
                cutOff = droppedBytes(bytes, fixed, this.mimeType);
            }
        } catch (e) {
            logger.warn("Could not rebase the preview's timeline, playing it as recorded", e);
        }

        return {
            blob,
            mimeType: this.mimeType,
            start: start + cutOff * 1000,
            end: Date.now(),
            marks: this.marks.map(m => (m - start) / 1000 - cutOff).filter(m => m >= 0)
        };
    }

    /**
     * Writes the buffered footage to disk. Capture keeps running.
     *
     * @param seconds How much of the tail to keep, or nothing for the whole
     * buffer. Asking for less writes the shorter clip directly rather than
     * writing the long one and cutting it afterwards, which is a full copy of
     * footage nobody wanted.
     * @param window A slice picked in the preview, which wins over `seconds`.
     * Cut at chunk boundaries, so the edges land within a timeslice of what was
     * asked for - the container is only cut where it can be cut.
     */
    async save(seconds?: number, window?: ClipWindow): Promise<void> {
        if (this.state === "saving") return;

        if (!this.isRecording) {
            toast("Clip buffer is not running", Toasts.Type.FAILURE);
            return;
        }
        if (!this.header || !this.chunks.length) {
            toast("Nothing buffered yet, give it a second", Toasts.Type.FAILURE);
            return;
        }

        // Before the sound rather than after it: a window picked in the preview
        // can have rolled out of the buffer while it was being watched, and a
        // clip that is never written should not be announced as one that was.
        // The buffer is checked again below, once the flush and the prune have
        // moved it, but by then this has caught the ordinary case.
        if (window && window.to <= this.bufferStart) {
            toast("That part of the buffer has already rolled past", Toasts.Type.FAILURE);
            return;
        }

        /*
         * Told out loud, before anything is written.
         *
         * A save takes as long as it takes - the engine, the flush, the repair,
         * the mux - and feedback that arrives after all that has stopped being
         * feedback. This fires on the keypress instead, and hands the recorder
         * the window to mute the loopback for, so the sound stays out of the
         * clip it is announcing. Never awaited: the file does not wait on a
         * notification tone.
         */
        void playClipSound(ms => this.duckSystem(ms));

        this.setState("saving");
        const mine = this.generation;

        try {
            /*
             * The native engine first, when it is running.
             *
             * It is the only path that can put one audio track per person in
             * the file, which is what lets the studio drop a voice instead of
             * ducking the whole montage. Everything below it stays as the
             * fallback: our own buffer has been filling all along, so an engine
             * that refuses at the last moment costs the layout, not the clip.
             *
             * Not for a window picked in the preview: the engine saves its own
             * last N seconds and has no way to be pointed at a moment further
             * back, so it would answer a precise request with a different clip
             * and report success.
             */
            if (this.native && !window) {
                try {
                    if (await this.saveNative(seconds)) return;
                } catch (e) {
                    /*
                     * The whole of the engine's answer goes to the log, and one
                     * sentence goes on screen.
                     *
                     * What the engine says when it refuses is a muxer error, a
                     * verdict, an event name and an attempt count, and it used
                     * to be shown verbatim to somebody who had just pressed a
                     * key to save a clip - four lines of diagnostics over a
                     * game, about a clip that was in fact saved. What they need
                     * to know is what they lost, which is the track per person.
                     */
                    logger.error(
                        engineTornDown()
                            ? "The native clip engine has no capture for this source and would not hand over its per-person audio either, falling back to the plugin's own buffer"
                            : "The native clip engine could not save, falling back to the plugin's own buffer",
                        e
                    );

                    if (!this.nativeSaveWarned) {
                        this.nativeSaveWarned = true;
                        toast("Clip saved with mixed sound: the clip engine would not write this one", Toasts.Type.MESSAGE);
                    }

                    /*
                     * A dead capture is not a reason to stop asking.
                     *
                     * This used to disarm the moment the engine tore its
                     * capture down, on the grounds that the answer for this
                     * source would not change. The answer does not change, and
                     * the answer is worth having: with no capture the engine
                     * still records a track per person, and a pictureless file
                     * full of those tracks is exactly what `saveNative` folds
                     * into the plugin's own clip. Disarming there is what left
                     * every clip on a machine capturing a screen with one mixed
                     * soundtrack and a mute that could only duck.
                     *
                     * What is worth giving up on is an engine that answers
                     * nothing at all. Two of those in a row and the arming goes,
                     * because an arming left standing keeps the helper process
                     * alive and keeps this plugin's shield over the engine's
                     * teardown calls - both of them held for a buffer nothing
                     * will ever read.
                     */
                    if (++this.nativeFailures >= 2) {
                        logger.info("Leaving the native clip engine out for the rest of this buffer: it has answered two saves in a row with nothing.");
                        disarm();
                        this.native = false;
                    }
                }
            }

            // Flush whatever the recorder holds so the clip ends on "now".
            await this.flush();
            this.prune();

            if (mine !== this.generation) {
                toast("Clip buffer stopped before the clip could be saved", Toasts.Type.FAILURE);
                return;
            }

            /*
             * The tail that was asked for, which is the whole buffer by default.
             *
             * Older chunks are simply left out: they are self-contained
             * fragments, and the repair below rebases what is left onto zero
             * exactly as it does for a full save.
             *
             * A window is checked against the buffer first. It points at the
             * buffer as it stood when the preview opened, and the buffer has
             * been rolling since - `prune` drops whatever falls off the back of
             * it - so left alone the "never empty" fallback in `chunksIn` would
             * quietly write the newest second instead of the moment that was
             * asked for.
             */
            let picked = window;
            if (picked) {
                const oldest = this.bufferStart;

                if (picked.to <= oldest) {
                    toast("That part of the buffer has already rolled past", Toasts.Type.FAILURE);
                    return;
                }

                if (picked.from < oldest) {
                    toast("The start of that window has rolled past - saved what is left of it", Toasts.Type.MESSAGE);
                    picked = { from: oldest, to: picked.to };
                }
            }

            const kept = picked
                ? this.chunksIn(picked.from, picked.to)
                : seconds ? this.chunksSince(Date.now() - seconds * 1000) : this.chunks;

            const raw = new Blob([this.header, ...kept.map(c => c.blob)], { type: this.mimeType });
            const name = `${timestampName()}.${extensionFor(this.mimeType)}`;

            // Read before the write, because the buffer keeps moving underneath.
            const start = kept[0].at - TIMESLICE;
            const end = picked ? Math.min(picked.to, kept[kept.length - 1].at) : Date.now();
            const length = Math.round((end - start) / 1000);
            /*
             * Only the markers that fall inside what is being written.
             *
             * Clamping the older ones to zero, as this used to, put a tick on
             * the first frame of every trimmed clip - one per marker dropped -
             * and a window that ends before the buffer does would otherwise
             * carry ticks past its own last frame.
             */
            const markers = this.marks
                .filter(m => m >= start && m <= end)
                .map(m => (m - start) / 1000);
            const voices = voiceActivity.slice(start, end);
            const said = chatLog.slice(start, end);

            /*
             * One read of the buffer, and everything after it works on those
             * same bytes: the repair, the measurement of what it dropped, the
             * call muxed back in, the write. A clip is hundreds of megabytes,
             * and each of those steps used to copy the whole of it again.
             *
             * The repair is what the read is for. Cluster timecodes are
             * absolute, so the chunks that were kept still carry the time
             * elapsed since the buffer started: without it the clip claims to
             * last as long as the whole session.
             */
            let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(await raw.arrayBuffer());
            let cutOff = 0;

            try {
                const fixed = repairBytes(bytes, this.mimeType);

                // The repair drops everything before the first keyframe, which
                // on a WebM is up to a few seconds. The markers were measured
                // from the start of the buffer, so they move by exactly what it
                // took off - otherwise every one of them points seconds early.
                if (fixed) {
                    cutOff = droppedBytes(bytes, fixed, this.mimeType);
                    bytes = fixed;
                }
            } catch (e) {
                logger.warn("Could not rebase the clip timeline, saving it as recorded", e);
            }

            const offsets = shift(markers, cutOff);
            const lanes = shiftTracks(voices, cutOff);
            const chat = shiftChat(said, cutOff);

            /*
             * The call, put back into the clip it belongs to.
             *
             * `saveNative` leaves its file here when the engine recorded the
             * voices and no picture, which is what a screen capture always
             * gives. Muxing them costs no re-encode - the picture and the mixed
             * soundtrack are copied out of this clip, the per-person tracks out
             * of the engine's - and it is the difference between a mute that
             * drops one voice and a duck that takes the whole call with it.
             */
            bytes = this.muxNative(bytes);

            const blob = new Blob([bytes as BlobPart], { type: this.mimeType });
            const path = await writeClip(bytes, name, blob);
            const saved = path.split(/[\\/]/).pop() || name;

            this.lastSaved = { name: saved, path, blob, mimeType: this.mimeType, markers: offsets, voices: lanes, chat };

            // The call, kept apart. `cutOff` is what the repair took off the
            // front, so this is the instant the saved footage really begins.
            const tracks = await this.saveVoices(saved, start + cutOff * 1000, end);

            // File the clip under whatever is running now: after the save, the
            // player may already have alt-tabbed away.
            await tagSavedClip(path, offsets, lanes.map(toMeta), tracks, voiceLevelsFrom(readMixer()), chat);

            // Best effort and off the critical path: the library falls back to a
            // placeholder for a clip that has no picture.
            void writeThumbnail(blob, saved);

            if (settings.store.notifications) {
                showNotification({
                    title: "Clip saved",
                    body: `${length}s - ${formatBytes(blob.size)}\n${path}`,
                    onClick: () => copy(path)
                });
            } else {
                toast(`Clip saved (${length}s, ${formatBytes(blob.size)})`, Toasts.Type.SUCCESS);
            }
        } catch (e) {
            logger.error("Failed to save clip", e);
            toast(`Failed to save the clip: ${errorMessage(e)}`, Toasts.Type.FAILURE);
        } finally {
            // Belongs to the save that asked for it, so it never carries over
            // into the next one - a save that gave up early leaves it behind.
            this.nativeAudio = null;

            // The buffer may have been stopped while the file was being written;
            // in that case "saving" must fall back to idle, not to "recording".
            // Cast: TS still narrows `state` from the guard at the top of save(),
            // but setState() has moved it since.
            if ((this.state as RecorderState) === "saving") this.setState(this.recorder ? "recording" : "idle");
        }
    }

    /**
     * Writes each person's own audio next to the clip that was just saved.
     *
     * Never allowed to fail the save: the clip is already on disk by the time
     * this runs, and a folder that refuses a write, a decoder that chokes on a
     * lane or a client with no reachable per-person audio all mean the same
     * thing here - a clip whose voices are only inside its mixed soundtrack,
     * which is what every clip was until now.
     */
    private async saveVoices(clip: string, from: number, to: number): Promise<VoiceFileMeta[]> {
        if (!voiceBuffers.active) return [];

        try {
            // The window the clip covers, not the one ending now: a clip picked
            // out of the buffer ends in the past, and harvesting to now would
            // give every person a track running past the last frame.
            const harvested = await voiceBuffers.harvest(from, to);

            // One round trip per person, all in flight together: they are
            // separate files with nothing to say to each other, and the toast
            // that says the clip is saved waits for the last of them.
            const saved = await Promise.all(harvested.map(async lane => {
                try {
                    const data = new Uint8Array(await lane.blob.arrayBuffer());
                    const path = await Native.saveVoiceTrack(settings.store.saveDirectory, clip, lane.userId, data);
                    if (!path) return null;

                    return {
                        id: lane.userId,
                        name: lane.name,
                        file: path.split(/[\\/]/).pop() || "",
                        offset: lane.offset
                    };
                } catch (e) {
                    logger.warn(`Could not save the voice track for ${lane.name}`, e);
                    return null;
                }
            }));

            const written = saved.filter((meta): meta is VoiceFileMeta => meta !== null);

            if (written.length) logger.info(`Saved ${written.length} voice track(s) beside ${clip}`);

            return written.filter(t => t.file);
        } catch (e) {
            logger.warn("Could not save the per-person voice tracks", e);
            return [];
        }
    }

    /**
     * Points Discord's own clip engine at the same source we are recording.
     *
     * Best effort throughout: the engine is an experiment, it only takes a
     * window as a source, and none of that is worth a failed start - the
     * plugin's own buffer is already running by the time this is called, so
     * every branch that gives up here simply leaves the clip mixed.
     */
    private async armNative(): Promise<void> {
        if (!settings.store.nativeEngine) return;

        const { clipLength, resolution, fps } = settings.store;

        // What is being recorded, which is the picked window until a game moves
        // the capture onto a screen. The engine only takes windows, so following
        // a game is one of the ways it declines below - and declining is right:
        // it would otherwise record the window the game is hiding.
        const sourceId = this.activeSource?.id ?? settings.store.sourceId;
        const sourceName = this.activeSource?.name ?? settings.store.sourceName;

        /*
         * Said out loud, every time, whichever way it goes.
         *
         * The two paths do not produce the same clip - one keeps a track per
         * person and one hands back a single mixed soundtrack - and which one
         * you got is not visible until you are in the studio wondering why a
         * mute takes everybody with it. A line in the corner when the buffer
         * starts is the difference between a limitation and a mystery.
         */
        const availability = nativeAvailability();
        if (!availability.available) {
            logger.info(`Not using the native clip engine: ${availability.reason}`);
            toast(`Recording mixed sound: ${availability.reason}`, Toasts.Type.MESSAGE);
            return;
        }
        if (!canRecord(sourceId)) {
            logger.info(`Not using the native clip engine: it cannot record ${sourceId}.`);
            toast("Recording mixed sound: the clip engine cannot record this source", Toasts.Type.MESSAGE);
            return;
        }
        if (goLiveActive()) {
            logger.info("Not using the native clip engine: a Go Live stream has the capture.");
            toast("Recording mixed sound: the clip engine will not record while you are streaming", Toasts.Type.MESSAGE);
            return;
        }

        // Listening from before it is armed: on a quick machine the engine
        // reports itself ready from inside the call that arms it, and a watch
        // opened afterwards has already missed it.
        const watch = watchRecording();

        if (!arm({ sourceId, seconds: clipLength, resolution, frameRate: fps, applicationName: sourceName || "Clipper" })) {
            watch.stop();
            toast("Recording mixed sound: the clip engine would not take this source", Toasts.Type.MESSAGE);
            return;
        }

        const verdict = await watch.settled;
        if (!verdict.recording) {
            logger.warn(`The native clip engine would not start: ${verdict.reason}`);
            toast(`Recording mixed sound: ${verdict.reason}`, Toasts.Type.MESSAGE);
            disarm();
            return;
        }

        /*
         * The engine records nobody until it is told to.
         *
         * Consent, not a mixer level: somebody left out here is absent from the
         * file and no amount of editing afterwards brings them back. Yourself
         * included - your own microphone is a track like anybody else's, and
         * leaving it out is how a clip comes back with everyone but you in it.
         *
         * And it has to be kept up, not set once. The buffer is armed when the
         * capture starts, which is routinely before the call fills up - people
         * join, leave, come back - and anybody who arrives after this moment
         * would otherwise never be consented and simply not be in the clip.
         * A poll rather than a subscription because the failure mode of a
         * missed unsubscribe is a listener firing over a disarmed engine, and
         * every id here is already recorded: telling the engine twice is free.
         */
        this.consented.clear();
        this.grantConsent();

        if (!this.consentBound) {
            FluxDispatcher.subscribe("VOICE_STATE_UPDATES" as any, this.onVoiceStates);
            this.consentBound = true;
        }

        this.consentTicker ??= setInterval(() => this.grantConsent(), CONSENT_MS);

        this.native = true;
        this.nativeSaveWarned = false;
        this.nativeFailures = 0;

        /*
         * The same message either way, because the difference does not concern
         * anybody watching.
         *
         * The engine only announces itself on the out-of-process path, which is
         * not the one in use, so `confirmed` is false on every ordinary run -
         * including the runs that produced clips with a track per person. What
         * does arrive, and quickly, is `clips-init-failure`, and that is handled
         * above. So an expired wait means nothing went wrong, and saying "it
         * never confirmed" out loud only taught the user to distrust a buffer
         * that was working. The count of tracks in the saved clip is the honest
         * report, and `saveNative` gives it.
         */
        logger.info(`The native clip engine is recording alongside the plugin's buffer (${verdict.confirmed ? "confirmed by the engine" : "no ready event, which is normal on this path"}).`);
        toast("Native engine on - one sound track per person in the call", Toasts.Type.SUCCESS);
    }

    /** Lets the native engine record anybody in the call it has not been told about yet. */
    private grantConsent(): void {
        if (!settings.store.nativeEngine) return;

        const present = new Set<string>();

        for (const person of voiceParticipants()) {
            present.add(person.id);
            if (this.consented.has(person.id)) continue;

            setRecordUser(person.id, true);
            this.consented.add(person.id);
        }

        // Forgotten as they leave, rather than only when the buffer stops. This
        // set exists to keep the engine from being told twice, and somebody who
        // leaves and comes back is a fresh arrival as far as the engine is
        // concerned while still being an old acquaintance here - so they would
        // never be told about again. That is the exact case the poll is for.
        for (const id of this.consented) if (!present.has(id)) this.consented.delete(id);
    }

    /**
     * Folds the engine's per-person tracks into the clip that has the picture.
     *
     * Best effort from end to end: anything unexpected in either file leaves
     * the clip exactly as it was, with one mixed soundtrack, which is what
     * every clip looked like before the native engine existed.
     */
    private muxNative(clip: Uint8Array): Uint8Array {
        const native = this.nativeAudio;
        this.nativeAudio = null;

        if (!native) return clip;

        /*
         * Only an MP4 can hold the engine's tracks: they are AAC, and putting
         * them in a WebM would mean re-encoding the very thing that is worth
         * copying byte for byte.
         */
        if (!this.mimeType.startsWith("video/mp4")) {
            logger.warn(`Cannot mux the call into a ${this.mimeType} clip; the container has to be MP4 for a track per person.`);

            // Telling somebody already set to MP4 to switch to MP4 is how this
            // read as the plugin ignoring its own setting. The container is
            // what it is because the encoder behind it failed here.
            const asked = settings.store.container === Container.Mp4H264;

            toast(
                asked
                    ? "The call was recorded one track per person, but this client's MP4 encoder failed and only an MP4 can hold them - the clip keeps one mixed track"
                    : "The call was recorded one track per person, but only an MP4 clip can hold it - switch the container to MP4",
                Toasts.Type.MESSAGE
            );
            return clip;
        }

        try {
            const muxed = muxNativeAudio(clip, native);

            return muxed || clip;
        } catch (e) {
            logger.error("Could not mux the call into the clip", e);
            return clip;
        }
    }

    /**
     * Writes the clip through the native engine instead of our own buffer.
     *
     * Returns false when it produced nothing usable, which leaves save() to
     * carry on down its own path. Everything after the write - markers, who was
     * talking, the thumbnail, the library entry - is the same work save() does,
     * on a different clock: the engine hands back the length it managed, and
     * the clip therefore ends now and starts that far back.
     */
    private async saveNative(want?: number): Promise<boolean> {
        const name = `${timestampName()}.mp4`;
        const path = await Native.reserveClipPath(settings.store.saveDirectory, name);

        // The engine holds the same window we do, so asking for more than the
        // buffer is worth is asking for footage nobody kept.
        const wanted = Math.min(want || settings.store.clipLength, settings.store.clipLength);
        const reported = await saveNativeClip(path, wanted, { application: "Clipper" });

        // The engine answers in milliseconds, but older builds answered in
        // seconds and the buffer is capped well under 600s either way, so the
        // magnitude is a safe way to tell which one this is.
        const seconds = reported > 600 ? reported / 1000 : reported;

        /*
         * Zero means the engine had nothing buffered, and it is not a detail.
         *
         * The clip still comes out, on our own buffer, with one mixed
         * soundtrack - which is exactly the file a mute cannot do anything
         * honest with. Returning false quietly here is how a clip arrives
         * looking like every other clip, and the only sign that the track per
         * person went missing is a mute that takes the whole call with it, an
         * hour later, in the studio. So it says so.
         */
        if (!(seconds > 0)) {
            this.nativeFailures++;
            logger.warn(`The native clip engine had nothing buffered (it reported ${reported}); falling back to the plugin's own buffer.`);
            toast("The native engine had no footage buffered - saved the plugin's mixed recording instead", Toasts.Type.MESSAGE);
            return false;
        }

        const saved = path.split(/[\\/]/).pop() || name;
        const data = await Native.readClip(settings.store.saveDirectory, saved);

        // It answered with a file, so whatever else is wrong with it, the
        // engine is not the thing to give up on.
        this.nativeFailures = 0;

        /*
         * A clip with no picture is not a clip.
         *
         * The engine reads the capture id as a window handle, and a screen id
         * does not convert to one - the native log answers `creating session
         * with (RsVideoOptions { source: Window(HWND(0x0)), ... })` and turns
         * its own capture back off a fifth of a second later. What it saves
         * after that is the call audio, correctly split per person, over
         * nothing at all. It reports a healthy length for it too, so the length
         * check above waves it through.
         *
         * The plugin's own buffer has the picture, so the file is dropped and
         * save() carries on down its own path: a mixed soundtrack the studio
         * cannot unpick is still worth more than a black clip.
         */
        if (!hasVideoTrack(data)) {
            logger.info(`The native clip engine wrote ${saved} with no picture; muxing its tracks into the plugin's clip instead.`);

            // Handed to save(), which has the picture and does the muxing once
            // its own buffer has been flushed and repaired.
            this.nativeAudio = data;

            try {
                await Native.deleteClip(settings.store.saveDirectory, saved);
            } catch (e) {
                logger.warn(`Could not remove the pictureless clip ${saved}`, e);
            }

            return false;
        }

        const blob = new Blob([data as BlobPart], { type: "video/mp4" });

        const end = Date.now();
        const start = end - Math.round(seconds * 1000);
        const markers = this.marks.map(m => (m - start) / 1000).filter(m => m >= 0);
        const voices = voiceActivity.slice(start, end);
        const chat = chatLog.slice(start, end);

        this.lastSaved = { name: saved, path, blob, mimeType: "video/mp4", markers, voices, chat };

        await tagSavedClip(path, markers, voices.map(toMeta), undefined, voiceLevelsFrom(readMixer()), chat);
        void writeThumbnail(blob, saved);

        /*
         * How many audio tracks came out, said out loud.
         *
         * This is the whole question the native path exists to answer: the
         * recorder keeps one per person internally, and whether `saveClipEx`
         * hands those over or mixes them down on the way out is not documented
         * anywhere. One track means the clip is mixed like any other and a mute
         * still has to duck; more than one means a mute can drop a voice and
         * leave the rest of the call alone.
         */
        const tracks = probeAudioTracks(data);
        const layout = tracks && tracks.length > 1
            ? `${tracks.length} voice tracks`
            : "one mixed track";

        logger.info(`Native clip saved: ${saved} (${Math.round(seconds)}s, ${layout})`, tracks);

        if (!tracks || tracks.length < 2) {
            toast("The engine wrote one mixed track for this clip - a mute will have to duck", Toasts.Type.MESSAGE);
        }

        if (settings.store.notifications) {
            showNotification({
                title: "Clip saved (native engine)",
                body: `${Math.round(seconds)}s - ${formatBytes(blob.size)} - ${layout}\n${path}`,
                onClick: () => copy(path)
            });
        } else {
            toast(`Clip saved (${Math.round(seconds)}s, ${formatBytes(blob.size)}, ${layout})`, Toasts.Type.SUCCESS);
        }

        return true;
    }

    /**
     * Throws away the clip that was just saved.
     *
     * The other half of watching a clip straight after saving it: most of what
     * a rolling buffer writes is not worth keeping, and a folder nobody ever
     * prunes is how a clip library becomes unusable. It goes to the trash, not
     * to the void - the native delete is the same one the library uses.
     */
    async discardLastSaved(): Promise<void> {
        const last = this.lastSaved;
        if (!last) return;

        try {
            await Native.deleteClip(settings.store.saveDirectory, last.name);
            await dropMeta(last.name);

            this.lastSaved = null;
            toast("Clip deleted", Toasts.Type.MESSAGE);
        } catch (e) {
            logger.error("Could not delete the clip", e);
            toast(`Could not delete the clip: ${errorMessage(e)}`, Toasts.Type.FAILURE);
        }
    }

    /**
     * Forgets the clip the replay card is holding, by name.
     *
     * The card offers to trim, send and delete the file it is pointing at, so
     * it has to let go of one that something else - the editor over the game -
     * has just cut or deleted underneath it.
     */
    forgetSaved(name: string): void {
        if (this.lastSaved?.name === name) this.lastSaved = null;
    }

    /**
     * Cuts the clip that was just saved down to its last `seconds`.
     *
     * The save takes the whole buffer because the length that was wanted is only
     * obvious once it has been watched; this is the correction. It cuts at the
     * container level, so it is a memory copy rather than a re-encode and the
     * footage that is kept is the same bytes. The original goes to the trash
     * rather than being overwritten, so a cut that took too much is undoable.
     */
    async trimLastSaved(seconds: number): Promise<void> {
        const last = this.lastSaved;
        if (!last) {
            toast("No clip has been saved yet", Toasts.Type.FAILURE);
            return;
        }
        if (!(seconds > 0)) return;

        try {
            // Read once, then measure and cut on those same bytes. A clip is
            // hundreds of megabytes and every parse of the blob used to copy
            // the whole of it again.
            const data = new Uint8Array(await last.blob.arrayBuffer());
            const total = lengthBytes(data, last.mimeType);
            const from = total - seconds;

            // Shorter than the cut asked for: nothing to take off.
            if (!(from > 0)) {
                toast("That clip is already shorter than that", Toasts.Type.MESSAGE);
                return;
            }

            const trimmed = trimBytes(data, last.mimeType, from, total + TIMESLICE / 1000);
            if (!trimmed) {
                toast("Nothing could be cut off that clip", Toasts.Type.FAILURE);
                return;
            }

            const cut = new Blob([trimmed as any], { type: last.mimeType });

            const base = last.name.replace(/\.[^.]+$/, "");
            const path = await writeClip(trimmed, `${base}-last${Math.round(seconds)}s.${extensionFor(last.mimeType)}`, cut);
            const saved = path.split(/[\\/]/).pop() || base;

            // The cut lands on a keyframe at or before the point asked for, so
            // measure what was really taken off rather than assuming.
            const gone = total - lengthBytes(trimmed, last.mimeType);
            const markers = shift(last.markers, gone);
            const voices = shiftTracks(last.voices, gone);
            const chat = shiftChat(last.chat ?? [], gone);

            await tagSavedClip(path, markers, voices.map(toMeta), undefined, voiceLevelsFrom(readMixer()), chat);
            void writeThumbnail(cut, saved);

            // Only once the replacement is safely on disk.
            try {
                await Native.deleteClip(settings.store.saveDirectory, last.name);
                await dropMeta(last.name);
            } catch (e) {
                logger.warn("Could not remove the untrimmed clip", e);
            }

            this.lastSaved = { name: saved, path, blob: cut, mimeType: last.mimeType, markers, voices, chat };
            toast(`Kept the last ${Math.round(seconds)}s (${formatBytes(cut.size)})`, Toasts.Type.SUCCESS);
        } catch (e) {
            logger.error("Failed to trim the last clip", e);
            toast(`Failed to trim the clip: ${errorMessage(e)}`, Toasts.Type.FAILURE);
        }
    }

    /**
     * Forgets the containers remembered as broken here.
     *
     * For the encoder probe: a container that has just proved it encodes should
     * not stay on a list that exists to stop the buffer trying it.
     */
    retryEncoders(): void {
        forgetBroken();
    }

    async toggle() {
        if (this.isRecording) this.stop();
        else await this.start(true);
    }

    /** Asks the overlay to show the source picker. */
    chooseSource(): void {
        if (!pickerOpener) {
            toast("Clipper: the overlay is not mounted", Toasts.Type.FAILURE);
            return;
        }
        pickerOpener();
    }

    /** Asks the overlay to show the studio, on a clip when one is named. */
    openStudio(name?: string): void {
        if (!studioOpener) {
            toast("Clipper: the overlay is not mounted", Toasts.Type.FAILURE);
            return;
        }
        studioOpener(name);
    }

    /** Re-arms the buffer so changed capture settings take effect. */
    async restart(): Promise<void> {
        if (!this.isRecording) return;

        this.cleanup();
        this.setState("idle");
        await this.start();
    }

    /** Remembers a source picked in the overlay and re-arms the buffer if it was running. */
    useSource(source: CaptureSource): void {
        rememberSource(source);
        this.pickedByHand = true;
        toast(`Clip source: ${source.name}`, Toasts.Type.SUCCESS);
        void this.restart();
    }

    /** Name of the remembered source, empty when none was picked yet. */
    get sourceName(): string {
        return settings.store.sourceName;
    }
}

/**
 * Set by the overlay so the toolbox entry and the chat bar button can open the
 * picker without importing any UI into this module.
 */
let pickerOpener: (() => void) | null = null;
let studioOpener: ((name?: string) => void) | null = null;

export function setPickerOpener(open: (() => void) | null) {
    pickerOpener = open;
}

export function setStudioOpener(open: ((name?: string) => void) | null) {
    studioOpener = open;
}

/** Absolute folder clips land in, for display in the settings. */
export async function resolveClipFolder(): Promise<string> {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return "";

    try {
        return await Native.getClipDirectory(settings.store.saveDirectory);
    } catch (e) {
        logger.warn("Could not resolve the clip folder", e);
        return "";
    }
}

/** Native folder picker, returns an empty string when cancelled. */
export async function pickClipFolder(): Promise<string> {
    try {
        return await Native.pickClipDirectory(settings.store.saveDirectory);
    } catch (e) {
        logger.error("Folder picker failed", e);
        return "";
    }
}

/** Opens the clip folder in the file explorer. */
export function openClipFolder(): void {
    Native.openClipDirectory(settings.store.saveDirectory)
        .catch(e => logger.error("Could not open the clip folder", e));
}

/**
 * Lists capture sources, empty when the main process helper is unavailable.
 *
 * Thumbnails cost a Windows Graphics Capture session per window, so the picker
 * asks for them once and polls without.
 */
export async function listCaptureSources(withThumbnails = false): Promise<CaptureSource[]> {
    try {
        return await Native.getCaptureSources(withThumbnails);
    } catch (e) {
        logger.warn("Could not list capture sources", e);
        return [];
    }
}

function rememberSource(source: CaptureSource) {
    settings.store.sourceId = source.id;
    settings.store.sourceName = source.name;
}

/**
 * Resolves the source to record without ever prompting.
 *
 * Window ids change between restarts, hence the fallback on the name. With
 * nothing remembered at all, the primary screen is used, so starting the
 * buffer never interrupts with a picker.
 */
function resolveSource(sources: CaptureSource[]): CaptureSource | null {
    const { sourceId, sourceName } = settings.store;

    // Windows the main process already saw refuse capture are filtered out of the
    // listing, so anything still here is worth trying.
    return sources.find(s => s.id === sourceId)
        ?? (sourceName ? sources.find(s => s.name === sourceName) : undefined)
        ?? sources.find(s => s.id.startsWith("screen:"))
        ?? sources[0]
        ?? null;
}

/**
 * The JavaScript heap, as a clause for the memory line.
 *
 * A footnote rather than the headline: it is one slice of one process, and on
 * this pipeline it is the slice that does not move. It stays in the line only
 * so a leak that really is JavaScript's can still be told apart at a glance.
 *
 * Empty where Chromium does not expose it, so the line reads the same either
 * way.
 */
function jsHeap(): string {
    const memory = (performance as any)?.memory as { usedJSHeapSize: number; jsHeapSizeLimit: number; } | undefined;
    if (!memory || typeof memory.usedJSHeapSize !== "number") return "";

    const share = Math.round((memory.usedJSHeapSize / Math.max(1, memory.jsHeapSizeLimit)) * 100);

    return `, JS heap ${formatBytes(memory.usedJSHeapSize)} (${share}%)`;
}

interface Capture {
    stream: MediaStream;
    /** What the stream is of, or null when the client picked it for us. */
    source: CaptureSource | null;
}

/**
 * The screen to record while a game is running, or null.
 *
 * A game in exclusive fullscreen cannot be captured as a window: Windows hands
 * back whatever is behind it, which is why those clips come out showing the
 * desktop. A screen has neither problem, and it is also the only thing Chromium
 * gives loopback audio for, so the game's own sound comes with it.
 *
 * The screen the cursor is on rather than the first one: a second monitor is
 * usually where the browser is, and the game is usually where the hands are.
 */
async function gameScreen(sources: CaptureSource[], allowed: boolean): Promise<CaptureSource | null> {
    if (!allowed || !settings.store.followGame || !runningGame() || !sources.length) return null;

    const screens = sources.filter(s => s.id.startsWith("screen:"));
    if (!screens.length) return null;

    try {
        const id = await Native.getActiveScreen();
        return screens.find(s => s.id === id) ?? screens[0];
    } catch (e) {
        logger.warn("Could not tell which screen the game is on, taking the first", e);
        return screens[0];
    }
}

/**
 * Grabs a screen / window stream.
 *
 * Preferred path: a display-media request handler is installed in the main
 * process, pointed at the remembered source, and the renderer then calls plain
 * `getDisplayMedia`. No picker is ever shown, and the modern capture path is
 * used rather than the legacy `chromeMediaSource` constraints, which crash the
 * renderer process outright on some Windows setups.
 *
 * Vesktop is the exception: it installs its own display-media handler for its
 * picker and its Linux audio capture, Electron keeps only one, and it cannot be
 * read back to be restored. Taking it over would break Vesktop's screen share
 * for the rest of the session, so there the legacy constraints are used
 * instead, with Vesktop's own picker as the last resort.
 */
async function acquireStream(fps: number, resolution: number, follow: boolean): Promise<Capture> {
    const video: MediaTrackConstraints = {
        frameRate: { ideal: fps, max: fps },
        ...(resolution ? { height: { ideal: resolution } } : {})
    };

    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) {
        return { stream: await navigator.mediaDevices.getDisplayMedia({ video, audio: true }), source: null };
    }

    const sources = await listCaptureSources();
    const following = await gameScreen(sources, follow);
    const source = following ?? (sources.length ? resolveSource(sources) : null);

    // Only a source the user picked is remembered: the screen a game is played
    // on is borrowed for as long as the game runs, not chosen.
    if (source && !following) rememberSource(source);
    if (following) logger.info(`Recording ${following.name} while ${runningGame()} is running`);

    // Wayland returns no sources at all: the portal picks the source itself.
    if (!source) return { stream: await navigator.mediaDevices.getDisplayMedia({ video, audio: true }), source: null };

    if (IS_VESKTOP) {
        try {
            return { stream: await getDesktopStream(source.id, fps, resolution), source };
        } catch (e) {
            logger.warn("Desktop constraints failed, falling back to Vesktop's own picker", e);
            return { stream: await navigator.mediaDevices.getDisplayMedia({ video, audio: true }), source: null };
        }
    }

    let armed = false;
    try {
        armed = await Native.armDisplayMedia(source.id, true);
        if (!armed) return { stream: await getDesktopStream(source.id, fps, resolution), source };

        return { stream: await navigator.mediaDevices.getDisplayMedia({ video, audio: true }), source };
    } catch (e) {
        logger.warn("getDisplayMedia failed, falling back to the legacy desktop constraints", e);
        return { stream: await getDesktopStream(source.id, fps, resolution), source };
    } finally {
        // The handler is only needed for the one call above; leaving it installed
        // would hijack any other display capture in the client.
        if (armed) Native.disarmDisplayMedia().catch(() => void 0);
    }
}

/**
 * Opens the machine's own output as a stream, independently of the video.
 *
 * Chromium only hands out loopback audio for a *screen*: ask it for the sound of
 * a window and it answers with nothing, quietly, which is how a clip of a game
 * window ends up carrying only whatever the microphone picked up off the
 * speakers. The screen's loopback is the whole machine's output anyway, so it is
 * the same sound the window would have produced - it is simply the only handle
 * Chromium offers.
 *
 * It is taken through the display-media handler, never through the legacy
 * `chromeMediaSource` constraints: asking `getUserMedia` for desktop audio kills
 * the renderer process outright on some Windows setups, and a renderer that dies
 * while the buffer is arming at startup takes the client into a reload loop.
 *
 * Returns null when the client has no such handle to give - Vesktop owns its own
 * handler, and nothing outside the desktop client has one at all - which is the
 * caller's signal to record without system sound rather than to fail.
 */
async function captureSystemAudio(): Promise<MediaStream | null> {
    if (!IS_DISCORD_DESKTOP || IS_VESKTOP) return null;

    let armed = false;

    try {
        const sources = await listCaptureSources();
        const screen = sources.find(s => s.id.startsWith("screen:"));
        if (!screen) return null;

        armed = await Native.armDisplayMedia(screen.id, true);
        if (!armed) return null;

        // The video track is the price of the audio one: `getDisplayMedia` has
        // no audio-only form. It is asked for at the smallest size the handler
        // will honour and stopped as soon as the stream arrives.
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 1, max: 1 }, height: { ideal: 120 } },
            audio: true
        });

        stream.getVideoTracks().forEach(t => {
            t.stop();
            stream.removeTrack(t);
        });

        if (!stream.getAudioTracks().length) {
            stream.getTracks().forEach(t => t.stop());
            return null;
        }

        return stream;
    } catch (e) {
        logger.warn("The system audio handle was refused; recording without it", e);
        return null;
    } finally {
        if (armed) Native.disarmDisplayMedia().catch(() => void 0);
    }
}

/** Legacy capture path, kept as a fallback only. */
async function getDesktopStream(sourceId: string, fps: number, resolution: number): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
                maxFrameRate: fps,
                ...(resolution ? { maxHeight: resolution } : {})
            }
        }
    } as any);

    try {
        const audio = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: "desktop",
                    chromeMediaSourceId: sourceId
                }
            }
        } as any);

        for (const track of audio.getAudioTracks()) stream.addTrack(track);
    } catch (e) {
        logger.warn("System audio unavailable for this source, recording without it", e);
    }

    return stream;
}

async function writeClip(data: Uint8Array, name: string, blob: Blob): Promise<string> {
    // Desktop: write straight to the configured folder through the native module.
    if (IS_DISCORD_DESKTOP || IS_VESKTOP) {
        try {
            // keep = true: two saves inside the same second would otherwise land
            // on the same timestamped name and the first one would be lost.
            return await Native.saveClip(settings.store.saveDirectory, name, data, true);
        } catch (e) {
            logger.warn("Native save failed, falling back to a browser download", e);
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return name;
}

/**
 * Seconds the repair or the cut took off the front of a clip.
 *
 * Both lengths are read from the container, from its first timestamp to its
 * last, so what changed between them is exactly the footage that was dropped.
 */
function droppedBytes(before: Uint8Array, after: Uint8Array, mimeType: string): number {
    try {
        return Math.max(0, lengthBytes(before, mimeType) - lengthBytes(after, mimeType));
    } catch (e) {
        logger.warn("Could not measure what the repair dropped, markers may be early", e);
        return 0;
    }
}

/** Moves markers back by what was cut off the front, dropping those cut away. */
function shift(markers: number[], by: number): number[] {
    if (!by) return markers;

    return markers.map(m => m - by).filter(m => m >= 0);
}

function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => void 0);
}

// Native helper (main process). Falls back to downloads when unavailable.
const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

export const recorder = new ClipRecorder();
