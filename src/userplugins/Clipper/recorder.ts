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
import { MediaEngineStore, Toasts } from "@webpack/common";

import { tagSavedClip } from "./library";
import { gainOf, MIC_CHANNEL, type MixerLevel, readMixer, SYSTEM_CHANNEL } from "./mixer";
import type { CaptureSource } from "./native";
import { extensionFor, mimeCandidates, settings } from "./settings";
import { formatBytes, timestampName } from "./utils";
import { repairClip } from "./webm";

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

class ClipRecorder {
    private stream: MediaStream | null = null;
    private micStream: MediaStream | null = null;
    private audioCtx: AudioContext | null = null;
    private destination: MediaStreamAudioDestinationNode | null = null;
    private recorder: MediaRecorder | null = null;

    /** Extra input devices opened for the mix, kept so they can be stopped. */
    private extraStreams: MediaStream[] = [];

    /** Live gain stage and meter of every channel in the mix, by channel id. */
    private channels = new Map<string, { gain: GainNode; meter: AnalyserNode; factor: number; data: Uint8Array<ArrayBuffer>; }>();

    /** First chunk emitted by the recorder: holds the container header. */
    private header: Blob | null = null;
    private chunks: TimedChunk[] = [];

    /**
     * Bumped by every cleanup, so a `start()` still awaiting its stream knows the
     * user stopped the buffer in the meantime and drops what it acquired instead
     * of arming a recorder nobody asked for.
     */
    private generation = 0;

    /** Resolved by the next chunk, used to flush the recorder before a save. */
    private nextChunk: (() => void) | null = null;

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

    subscribe(listener: Listener) {
        this.listeners.add(listener);
        return () => void this.listeners.delete(listener);
    }

    private setState(state: RecorderState) {
        this.state = state;
        for (const listener of this.listeners) listener(state);
    }

    async start(): Promise<boolean> {
        if (this.state !== "idle") return this.isRecording;

        this.setState("starting");
        const mine = this.generation;

        try {
            const { fps, resolution, videoBitrate, audioBitrate, container } = settings.store;

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

            this.mimeType = mimeCandidates(container).find(t => MediaRecorder.isTypeSupported(t)) ?? "";
            if (!this.mimeType) throw new Error(`No supported mime type for container "${container}"`);

            this.recorder = new MediaRecorder(recordStream, {
                mimeType: this.mimeType,
                videoBitsPerSecond: videoBitrate * 1_000_000,
                audioBitsPerSecond: audioBitrate * 1000
            });

            this.header = null;
            this.chunks = [];

            this.recorder.ondataavailable = e => this.onChunk(e.data);
            this.recorder.onerror = e => {
                logger.error("Recorder error", e);
                this.stop();
            };

            this.recorder.start(TIMESLICE);
            this.setState("recording");
            toast(`Clip buffer running - last ${settings.store.clipLength}s kept`, Toasts.Type.SUCCESS);
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

        const displayTracks = display.getAudioTracks();
        if (!displayTracks.length && !includeMic && !mixer.extras.length) return undefined;

        this.audioCtx = new AudioContext();
        this.destination = this.audioCtx.createMediaStreamDestination();

        if (displayTracks.length) {
            const source = this.audioCtx.createMediaStreamSource(new MediaStream(displayTracks));
            this.connectChannel(SYSTEM_CHANNEL, source, gainOf(mixer.system));
        }

        if (includeMic) {
            const mic = discordMicSettings();

            try {
                this.micStream = await captureMic(mic);

                if (this.micStream.getAudioTracks().length) {
                    const source = this.audioCtx.createMediaStreamSource(this.micStream);

                    // Discord's input volume slider is not part of the track, so
                    // it is folded into the channel's own level rather than lost.
                    const device = Math.min(2, Math.max(0, (mic?.volume ?? 100) / 100));
                    this.connectChannel(MIC_CHANNEL, source, gainOf(mixer.mic), device);
                }
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

        this.recorder = null;
        this.header = null;
        this.chunks = [];

        this.stream?.getTracks().forEach(t => t.stop());
        this.micStream?.getTracks().forEach(t => t.stop());
        this.extraStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
        this.audioCtx?.close().catch(() => void 0);

        this.channels.clear();
        this.extraStreams = [];
        this.stream = this.micStream = null;
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

        this.setState("saving");
        const mine = this.generation;

        try {
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

            // Cluster timecodes are absolute, so the kept ones still carry the
            // time elapsed since the buffer started: without this the clip
            // claims to last as long as the whole session.
            let blob = raw;
            try {
                blob = await repairClip(raw, this.mimeType);
            } catch (e) {
                logger.warn("Could not rebase the clip timeline, saving it as recorded", e);
            }

            const path = await writeClip(blob, name);

            // File the clip under whatever is running now: after the save, the
            // player may already have alt-tabbed away.
            await tagSavedClip(path);

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
            // The buffer may have been stopped while the file was being written;
            // in that case "saving" must fall back to idle, not to "recording".
            // Cast: TS still narrows `state` from the guard at the top of save(),
            // but setState() has moved it since.
            if ((this.state as RecorderState) === "saving") this.setState(this.recorder ? "recording" : "idle");
        }
    }

    async toggle() {
        if (this.isRecording) this.stop();
        else await this.start();
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

interface MicSettings {
    /** Discord's selected input device, empty or "default" for the system one. */
    deviceId: string;
    /** Input volume slider, 0-200 in Discord's UI. */
    volume: number;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
}

/**
 * Reads the voice settings the user already configured in Discord.
 *
 * Plain `getUserMedia({ audio: true })` grabs the system default device with the
 * browser defaults, which is why the mic track used to sound nothing like the
 * one in a call: wrong device when several exist, and no echo cancellation or
 * noise suppression.
 *
 * Krisp ("Noise Cancellation") runs inside Discord's native voice engine and
 * cannot be tapped from here, so it is folded into the WebRTC noise suppression
 * flag: the intent is the same, the algorithm is weaker.
 *
 * Returns null when the store is not around (web build, or Discord moved it),
 * and the caller then keeps the old behaviour.
 */
function discordMicSettings(): MicSettings | null {
    const store = MediaEngineStore as any;
    if (typeof store?.getInputDeviceId !== "function") return null;

    try {
        return {
            deviceId: store.getInputDeviceId() ?? "",
            volume: typeof store.getInputVolume === "function" ? store.getInputVolume() : 100,
            echoCancellation: store.getEchoCancellation?.() ?? true,
            noiseSuppression: (store.getNoiseSuppression?.() ?? false) || (store.getNoiseCancellation?.() ?? false),
            autoGainControl: store.getAutomaticGainControl?.() ?? true
        };
    } catch (e) {
        logger.warn("Could not read Discord's voice settings, using the browser defaults", e);
        return null;
    }
}

/** Opens the microphone Discord is set to use, with Discord's processing. */
async function captureMic(mic: MicSettings | null): Promise<MediaStream> {
    if (!mic) return navigator.mediaDevices.getUserMedia({ audio: true });

    const processing: MediaTrackConstraints = {
        echoCancellation: mic.echoCancellation,
        noiseSuppression: mic.noiseSuppression,
        autoGainControl: mic.autoGainControl
    };

    // "default" is Chromium's own alias for the system device; asking for it by
    // id is both pointless and rejected by some backends.
    const wanted = mic.deviceId && mic.deviceId !== "default"
        ? { ...processing, deviceId: { exact: mic.deviceId } }
        : processing;

    try {
        return await navigator.mediaDevices.getUserMedia({ audio: wanted });
    } catch (e) {
        if (wanted === processing) throw e;

        // The device was unplugged since Discord picked it.
        logger.warn("Discord's input device is unavailable, falling back to the default one", e);
        return navigator.mediaDevices.getUserMedia({ audio: processing });
    }
}

function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message || e.name;
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

function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => void 0);
}

function toast(message: string, type: string) {
    Toasts.show({ id: Toasts.genId(), message, type });
}

// Native helper (main process). Falls back to downloads when unavailable.
const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

export const recorder = new ClipRecorder();
