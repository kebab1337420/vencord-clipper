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
import { Toasts, UserStore } from "@webpack/common";

import { playClipSound } from "./clipSound";
import { dropMeta, tagSavedClip } from "./library";
import { MicInput } from "./micInput";
import { gainOf, MIC_CHANNEL, type MixerLevel, readMixer, SYSTEM_CHANNEL, voiceLevelsFrom } from "./mixer";
import { probeAudioTracks } from "./mp4";
import { muxNativeAudio } from "./mux";
import type { CaptureSource } from "./native";
import { arm, canRecord, disarm, goLiveActive, nativeAvailability, saveNativeClip, setRecordUser, watchRecording } from "./nativeClips";
import { hasVideoTrack } from "./nativeTracks";
import { clipLength, repairClip, trimClip } from "./repair";
import { Container, extensionFor, mimeTypeChain, settings } from "./settings";
import { writeThumbnail } from "./thumbnail";
import { formatBytes, timestampName } from "./utils";
import { shiftTracks, toMeta, voiceActivity, type VoiceFileMeta, voiceParticipants,type VoiceTrack } from "./voice";
import { voiceBuffers } from "./voiceRecord";

export const logger = new Logger("Clipper", "#f0b132");

export type RecorderState = "idle" | "starting" | "recording" | "saving";

interface TimedChunk {
    blob: Blob;
    /** Timestamp (ms) at which the chunk was handed to us. */
    at: number;
}

/** Chunk interval, in ms. Smaller = finer trimming, more overhead. */
const TIMESLICE = 1000;

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
}

class ClipRecorder {
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
    private stream: MediaStream | null = null;
    /** Discord's microphone, gated the way Discord gates it. See ./micInput. */
    private mic: MicInput | null = null;
    /** Loopback opened separately when the captured source carried no sound. */
    private systemStream: MediaStream | null = null;
    private audioCtx: AudioContext | null = null;
    private destination: MediaStreamAudioDestinationNode | null = null;
    private recorder: MediaRecorder | null = null;

    /** Extra input devices opened for the mix, kept so they can be stopped. */
    private extraStreams: MediaStream[] = [];

    /** Live gain stage and meter of every channel in the mix, by channel id. */
    private channels = new Map<string, { gain: GainNode; meter: AnalyserNode; factor: number; data: Uint8Array<ArrayBuffer>; }>();

    /** Set while the clip sound is playing, so it is not recorded. See duckSystem(). */
    private duckTimer: ReturnType<typeof setTimeout> | null = null;
    private duckedUntil = 0;

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

    /** Resolved by the next chunk, used to flush the recorder before a save. */
    private nextChunk: (() => void) | null = null;

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

            const stream = await acquireStream(fps, resolution);

            // Stopped while the source was being acquired: drop what we just got.
            if (mine !== this.generation) {
                stream.getTracks().forEach(t => t.stop());
                return false;
            }

            this.stream = stream;

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
        const { audioCtx: ctx, destination } = this;
        if (!ctx || !destination) return;

        const gain = ctx.createGain();
        gain.gain.value = level * factor;

        // Small window: the meter is a bar in a settings panel, not an analyser.
        const meter = ctx.createAnalyser();
        meter.fftSize = 256;

        source.connect(gain);
        gain.connect(destination);
        gain.connect(meter);

        this.channels.set(id, { gain, meter, factor, data: new Uint8Array(meter.fftSize) });
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

    private onChunk(blob: Blob) {
        const notify = this.nextChunk;
        this.nextChunk = null;

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

        notify?.();
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
                if (this.nextChunk === settle) this.nextChunk = null;
                settle();
            }, 500);

            this.nextChunk = settle;

            try {
                recorder.requestData();
            } catch (e) {
                logger.warn("Could not flush the recorder", e);
                settle();
            }
        });
    }

    private prune() {
        // Keep one extra timeslice so the clip is never shorter than asked for.
        const cutoff = Date.now() - (settings.store.clipLength * 1000 + TIMESLICE);
        while (this.chunks.length && this.chunks[0].at < cutoff) this.chunks.shift();

        // A mark whose footage has been dropped points at nothing.
        const start = this.bufferStart;
        if (this.marks.length) this.marks = this.marks.filter(m => m >= start);
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

        try {
            if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
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

        // Stopped while the canvas was starting: this buffer is not ours to arm.
        if (mine !== this.generation) return;

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
        if (!ctx) return null;

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
        toast("Clip buffer stopped", Toasts.Type.MESSAGE);
    }

    private cleanup() {
        // Any start() still waiting on a stream is now stale.
        this.generation++;

        try {
            if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
        } catch (e) {
            logger.warn("Error stopping recorder", e);
        }

        this.nextChunk?.();
        this.nextChunk = null;

        voiceActivity.stop();
        voiceBuffers.stop();

        if (this.consentTicker) clearInterval(this.consentTicker);
        this.consentTicker = null;
        this.consented.clear();

        if (this.native) {
            disarm();
            this.native = false;
        }

        this.recorder = null;
        this.header = null;
        this.chunks = [];
        this.marks = [];

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

        this.channels.clear();
        this.extraStreams = [];
        this.mic = null;
        this.stream = this.systemStream = null;
        this.audioCtx = null;
        this.destination = null;
    }

    /** Writes the buffered footage to disk. Capture keeps running. */
    async save(): Promise<void> {
        if (this.state === "saving") return;

        if (!this.isRecording) {
            toast("Clip buffer is not running", Toasts.Type.FAILURE);
            return;
        }
        if (!this.header || !this.chunks.length) {
            toast("Nothing buffered yet, give it a second", Toasts.Type.FAILURE);
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
             */
            if (this.native) {
                try {
                    if (await this.saveNative()) return;
                } catch (e) {
                    logger.error("The native clip engine could not save, falling back to the plugin's own buffer", e);
                    toast(`The native engine could not save (${errorMessage(e)}), used the plugin's buffer instead`, Toasts.Type.MESSAGE);
                }
            }

            // Flush whatever the recorder holds so the clip ends on "now".
            await this.flush();
            this.prune();

            if (mine !== this.generation) {
                toast("Clip buffer stopped before the clip could be saved", Toasts.Type.FAILURE);
                return;
            }

            const seconds = Math.round(this.bufferedSeconds);
            const raw = new Blob([this.header, ...this.chunks.map(c => c.blob)], { type: this.mimeType });
            const name = `${timestampName()}.${extensionFor(this.mimeType)}`;

            // Read before the write, because the buffer keeps moving underneath.
            const start = this.bufferStart;
            const markers = this.marks.map(m => Math.max(0, (m - start) / 1000));
            const voices = voiceActivity.slice(start, Date.now());

            // Cluster timecodes are absolute, so the kept ones still carry the
            // time elapsed since the buffer started: without this the clip
            // claims to last as long as the whole session.
            let blob = raw;
            try {
                blob = await repairClip(raw, this.mimeType);
            } catch (e) {
                logger.warn("Could not rebase the clip timeline, saving it as recorded", e);
            }

            // The repair drops everything before the first keyframe, which on a
            // WebM is up to a few seconds. The markers were measured from the
            // start of the buffer, so they move by exactly what it took off -
            // otherwise every one of them points several seconds early.
            const cutOff = blob === raw ? 0 : await dropped(raw, blob, this.mimeType);
            const offsets = shift(markers, cutOff);
            const lanes = shiftTracks(voices, cutOff);

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
            blob = await this.muxNative(blob);

            const path = await writeClip(blob, name);
            const saved = path.split(/[\\/]/).pop() || name;

            this.lastSaved = { name: saved, path, blob, mimeType: this.mimeType, markers: offsets, voices: lanes };

            // The call, kept apart. `cutOff` is what the repair took off the
            // front, so this is the instant the saved footage really begins.
            const tracks = await this.saveVoices(saved, start + cutOff * 1000);

            // File the clip under whatever is running now: after the save, the
            // player may already have alt-tabbed away.
            await tagSavedClip(path, offsets, lanes.map(toMeta), tracks, voiceLevelsFrom(readMixer()));

            // Best effort and off the critical path: the library falls back to a
            // placeholder for a clip that has no picture.
            void writeThumbnail(blob, saved);

            if (settings.store.notifications) {
                showNotification({
                    title: "Clip saved",
                    body: `${seconds}s - ${formatBytes(blob.size)}\n${path}`,
                    onClick: () => copy(path)
                });
            } else {
                toast(`Clip saved (${seconds}s, ${formatBytes(blob.size)})`, Toasts.Type.SUCCESS);
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
    private async saveVoices(clip: string, from: number): Promise<VoiceFileMeta[]> {
        if (!voiceBuffers.active) return [];

        try {
            const harvested = await voiceBuffers.harvest(from, Date.now());
            const written: VoiceFileMeta[] = [];

            for (const lane of harvested) {
                try {
                    const data = new Uint8Array(await lane.blob.arrayBuffer());
                    const path = await Native.saveVoiceTrack(settings.store.saveDirectory, clip, lane.userId, data);
                    if (!path) continue;

                    written.push({
                        id: lane.userId,
                        name: lane.name,
                        file: path.split(/[\\/]/).pop() || "",
                        offset: lane.offset
                    });
                } catch (e) {
                    logger.warn(`Could not save the voice track for ${lane.name}`, e);
                }
            }

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

        const { sourceId, sourceName, clipLength, resolution, fps } = settings.store;

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

        this.consentTicker ??= setInterval(() => this.grantConsent(), 3000);

        this.native = true;

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

        for (const person of voiceParticipants()) {
            if (this.consented.has(person.id)) continue;

            setRecordUser(person.id, true);
            this.consented.add(person.id);
        }
    }

    /**
     * Folds the engine's per-person tracks into the clip that has the picture.
     *
     * Best effort from end to end: anything unexpected in either file leaves
     * the clip exactly as it was, with one mixed soundtrack, which is what
     * every clip looked like before the native engine existed.
     */
    private async muxNative(clip: Blob): Promise<Blob> {
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
            const muxed = muxNativeAudio(new Uint8Array(await clip.arrayBuffer()), native);
            if (!muxed) return clip;

            return new Blob([muxed as BlobPart], { type: "video/mp4" });
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
    private async saveNative(): Promise<boolean> {
        const name = `${timestampName()}.mp4`;
        const path = await Native.reserveClipPath(settings.store.saveDirectory, name);

        const reported = await saveNativeClip(path, settings.store.clipLength, { application: "Clipper" });

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
            logger.warn(`The native clip engine had nothing buffered (it reported ${reported}); falling back to the plugin's own buffer.`);
            toast("The native engine had no footage buffered - saved the plugin's mixed recording instead", Toasts.Type.MESSAGE);
            return false;
        }

        const saved = path.split(/[\\/]/).pop() || name;
        const data = await Native.readClip(settings.store.saveDirectory, saved);

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

        this.lastSaved = { name: saved, path, blob, mimeType: "video/mp4", markers, voices };

        await tagSavedClip(path, markers, voices.map(toMeta), undefined, voiceLevelsFrom(readMixer()));
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
            const total = await clipLength(last.blob, last.mimeType);
            const from = total - seconds;

            // Shorter than the cut asked for: nothing to take off.
            if (!(from > 0)) {
                toast("That clip is already shorter than that", Toasts.Type.MESSAGE);
                return;
            }

            const cut = await trimClip(last.blob, last.mimeType, from, total + TIMESLICE / 1000);
            if (cut === last.blob) {
                toast("Nothing could be cut off that clip", Toasts.Type.FAILURE);
                return;
            }

            const base = last.name.replace(/\.[^.]+$/, "");
            const path = await writeClip(cut, `${base}-last${Math.round(seconds)}s.${extensionFor(last.mimeType)}`);
            const saved = path.split(/[\\/]/).pop() || base;

            // The cut lands on a keyframe at or before the point asked for, so
            // measure what was really taken off rather than assuming.
            const gone = total - await clipLength(cut, last.mimeType);
            const markers = shift(last.markers, gone);
            const voices = shiftTracks(last.voices, gone);

            await tagSavedClip(path, markers, voices.map(toMeta), undefined, voiceLevelsFrom(readMixer()));
            void writeThumbnail(cut, saved);

            // Only once the replacement is safely on disk.
            try {
                await Native.deleteClip(settings.store.saveDirectory, last.name);
                await dropMeta(last.name);
            } catch (e) {
                logger.warn("Could not remove the untrimmed clip", e);
            }

            this.lastSaved = { name: saved, path, blob: cut, mimeType: last.mimeType, markers, voices };
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

    /** Asks the overlay to show the studio. */
    openStudio(): void {
        if (!studioOpener) {
            toast("Clipper: the overlay is not mounted", Toasts.Type.FAILURE);
            return;
        }
        studioOpener();
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
let studioOpener: (() => void) | null = null;

export function setPickerOpener(open: (() => void) | null) {
    pickerOpener = open;
}

export function setStudioOpener(open: (() => void) | null) {
    studioOpener = open;
}

/**
 * Something readable out of anything that was thrown.
 *
 * `String(e)` alone is what put `[object Object]` in front of a user instead of
 * a reason: the native voice module rejects with plain objects rather than
 * `Error`s, and a plain object stringifies to nothing at all. Anything that
 * came from across the IPC boundary has to be dug into by hand, including the
 * non-enumerable properties an `Error` from another realm keeps its message in.
 */
function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message || e.name;
    if (typeof e === "string") return e;
    if (e === null || e === undefined) return "no reason given";

    if (typeof e === "object") {
        const record = e as Record<string, unknown>;

        for (const key of ["message", "error", "reason", "detail", "description"]) {
            const value = record[key];
            if (typeof value === "string" && value) return value;
            if (value && typeof value === "object") {
                const nested = errorMessage(value);
                if (nested && nested !== "[object Object]") return nested;
            }
        }

        try {
            const json = JSON.stringify(e);
            if (json && json !== "{}" && json !== "null") return json;
        } catch {
            // Circular, or something with a throwing getter. The properties are
            // still worth reading one at a time.
        }

        try {
            const parts: string[] = [];
            for (const key of Object.getOwnPropertyNames(record)) {
                if (key === "stack") continue;
                parts.push(`${key}: ${String(record[key])}`);
            }

            if (parts.length) return parts.join(", ");
        } catch {
            // Nothing readable on it at all, which String() will say as well.
        }
    }

    return String(e);
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
async function acquireStream(fps: number, resolution: number): Promise<MediaStream> {
    const video: MediaTrackConstraints = {
        frameRate: { ideal: fps, max: fps },
        ...(resolution ? { height: { ideal: resolution } } : {})
    };

    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) {
        return navigator.mediaDevices.getDisplayMedia({ video, audio: true });
    }

    const sources = await listCaptureSources();
    const source = sources.length ? resolveSource(sources) : null;
    if (source) rememberSource(source);

    // Wayland returns no sources at all: the portal picks the source itself.
    if (!source) return navigator.mediaDevices.getDisplayMedia({ video, audio: true });

    if (IS_VESKTOP) {
        try {
            return await getDesktopStream(source.id, fps, resolution);
        } catch (e) {
            logger.warn("Desktop constraints failed, falling back to Vesktop's own picker", e);
            return navigator.mediaDevices.getDisplayMedia({ video, audio: true });
        }
    }

    let armed = false;
    try {
        armed = await Native.armDisplayMedia(source.id, true);
        if (!armed) return await getDesktopStream(source.id, fps, resolution);

        return await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
    } catch (e) {
        logger.warn("getDisplayMedia failed, falling back to the legacy desktop constraints", e);
        return getDesktopStream(source.id, fps, resolution);
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

async function writeClip(blob: Blob, name: string): Promise<string> {
    const data = new Uint8Array(await blob.arrayBuffer());

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
async function dropped(before: Blob, after: Blob, mimeType: string): Promise<number> {
    try {
        return Math.max(0, await clipLength(before, mimeType) - await clipLength(after, mimeType));
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

function toast(message: string, type: string) {
    Toasts.show({ id: Toasts.genId(), message, type });
}

// Native helper (main process). Falls back to downloads when unavailable.
const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

export const recorder = new ClipRecorder();
