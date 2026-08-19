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
import { Toasts } from "@webpack/common";

import type { CaptureSource } from "./native";
import { extensionFor, mimeCandidates, settings } from "./settings";
import { formatBytes, timestampName } from "./utils";

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
    private recorder: MediaRecorder | null = null;

    /** First chunk emitted by the recorder: holds the container header. */
    private header: Blob | null = null;
    private chunks: TimedChunk[] = [];
    private startedAt = 0;

    private listeners = new Set<Listener>();

    state: RecorderState = "idle";
    mimeType = "";

    get isRecording() {
        return this.state === "recording";
    }

    /** Seconds currently held in the buffer. */
    get bufferedSeconds() {
        if (!this.chunks.length) return 0;
        return Math.min((Date.now() - this.startedAt) / 1000, settings.store.clipLength);
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
        try {
            const { fps, resolution, videoBitrate, audioBitrate, includeMic, container } = settings.store;

            this.stream = await acquireStream(fps, resolution);

            const [videoTrack] = this.stream.getVideoTracks();
            if (!videoTrack) throw new Error("The picked source returned no video track");

            // User stopped the capture from Discord's / the OS' own UI.
            videoTrack?.addEventListener("ended", () => this.stop());

            const audioTrack = includeMic
                ? await this.buildMixedAudio(this.stream)
                : this.stream.getAudioTracks()[0];

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
            this.startedAt = Date.now();

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

            if (e instanceof CancelledError) return false;

            logger.error("Failed to start capture", e);
            toast(`Could not start the clip buffer: ${errorMessage(e)}`, Toasts.Type.FAILURE);
            return false;
        }
    }

    /** Mixes the captured system audio with the microphone into a single track. */
    private async buildMixedAudio(display: MediaStream): Promise<MediaStreamTrack | undefined> {
        try {
            this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            logger.warn("Microphone unavailable, falling back to system audio only", e);
            return display.getAudioTracks()[0];
        }

        this.audioCtx = new AudioContext();
        const destination = this.audioCtx.createMediaStreamDestination();

        for (const source of [display, this.micStream]) {
            if (!source.getAudioTracks().length) continue;
            this.audioCtx.createMediaStreamSource(new MediaStream(source.getAudioTracks())).connect(destination);
        }

        return destination.stream.getAudioTracks()[0];
    }

    private onChunk(blob: Blob) {
        if (!blob.size) return;

        // The very first chunk carries the container header; every later save reuses it.
        if (!this.header) {
            this.header = blob;
            return;
        }

        this.chunks.push({ blob, at: Date.now() });
        this.prune();
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
        try {
            if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
        } catch (e) {
            logger.warn("Error stopping recorder", e);
        }

        this.recorder = null;
        this.header = null;
        this.chunks = [];

        this.stream?.getTracks().forEach(t => t.stop());
        this.micStream?.getTracks().forEach(t => t.stop());
        this.audioCtx?.close().catch(() => void 0);

        this.stream = this.micStream = null;
        this.audioCtx = null;
    }

    /** Writes the buffered footage to disk. Capture keeps running. */
    async save(): Promise<void> {
        if (!this.isRecording) {
            toast("Clip buffer is not running", Toasts.Type.FAILURE);
            return;
        }
        if (!this.header || !this.chunks.length) {
            toast("Nothing buffered yet, give it a second", Toasts.Type.FAILURE);
            return;
        }

        this.setState("saving");
        try {
            // Flush whatever the recorder holds so the clip ends on "now".
            this.recorder?.requestData();
            await new Promise(r => setTimeout(r, 120));
            this.prune();

            const seconds = Math.round(this.bufferedSeconds);
            const blob = new Blob([this.header, ...this.chunks.map(c => c.blob)], { type: this.mimeType });
            const name = `${timestampName()}.${extensionFor(this.mimeType)}`;

            const path = await writeClip(blob, name);

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
            toast("Failed to save the clip", Toasts.Type.FAILURE);
        } finally {
            this.setState("recording");
        }
    }

    async toggle() {
        if (this.isRecording) this.stop();
        else await this.start();
    }

    /** Opens the picker, remembers the choice and re-arms the buffer if it was running. */
    /** Asks the overlay to show the source picker. */
    chooseSource(): void {
        if (!pickerOpener) {
            toast("Clipper: the overlay is not mounted", Toasts.Type.FAILURE);
            return;
        }
        pickerOpener();
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

export function setPickerOpener(open: (() => void) | null) {
    pickerOpener = open;
}

/** Thrown when the user closes the source picker. */
class CancelledError extends Error { }

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
export async function listCaptureSources(withThumbnails = true): Promise<CaptureSource[]> {
    return listSources(withThumbnails);
}

async function listSources(withThumbnails = false): Promise<CaptureSource[]> {
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
 * Fallback: those legacy constraints, used only when the handler could not be
 * installed or when `getDisplayMedia` still refuses.
 */
async function acquireStream(fps: number, resolution: number): Promise<MediaStream> {
    const video: MediaTrackConstraints = {
        frameRate: { ideal: fps, max: fps },
        ...(resolution ? { height: { ideal: resolution } } : {})
    };

    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) {
        return navigator.mediaDevices.getDisplayMedia({ video, audio: true });
    }

    const sources = await listSources();
    const source = sources.length ? resolveSource(sources) : null;
    if (source) rememberSource(source);

    try {
        await Native.armDisplayMedia(source?.id ?? "");
        return await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
    } catch (e) {
        logger.warn("getDisplayMedia failed, falling back to the legacy desktop constraints", e);

        if (!source) throw e;
        return getDesktopStream(source.id, fps, resolution);
    } finally {
        // The handler is only needed for the one call above; leaving it installed
        // would hijack any other display capture in the client.
        Native.disarmDisplayMedia().catch(() => void 0);
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
            return await Native.saveClip(settings.store.saveDirectory, name, data);
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
