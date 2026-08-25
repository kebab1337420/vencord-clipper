/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the client's own clip recorder
 *
 * Discord ships a native clip engine inside `discord_voice.node`: a ring buffer
 * fed straight from the capture pipeline, encoded on the GPU, written out as an
 * MP4 without the renderer ever touching a frame. It is the same machinery
 * behind Discord's own Clips feature, and it is reachable from a plugin because
 * the media engine wrapper exposes it on the object `MediaEngineStore` hands
 * out.
 *
 * Using it buys three things the plugin's own MediaRecorder path cannot have:
 *
 *   - hardware encoding, so a long buffer costs a fraction of the CPU;
 *   - a real MP4 straight away, no repair pass, no remux;
 *   - the call's audio kept apart from the game's audio inside the file, which
 *     is what makes a clip usable when someone was talking over a loud game.
 *
 * And the fourth thing, which is the reason the rest of this file exists: the
 * file it writes keeps one AAC track per person. The recorder keys audio by
 * user on the way in (`ClipsRecorder::RecordAudioForUser ... audio track for
 * key`) and tags each track with an MP4 `handler_name` - `0:all` for the
 * machine's own sound, `<userId>:voice` for each person in the call. Measured
 * on a real clip, the cross-correlation between one person's track and the
 * desktop track is 0.013, so the separation is real and not a mixdown with the
 * levels moved. `nativeTracks.ts` reads those tracks back out, which is what
 * lets the studio mute somebody and leave everybody else talking.
 *
 * Two consequences worth carrying around:
 *
 *   - the engine still decides per person whether their voice is recorded at
 *     all - that is `setClipRecordUser`, driven by the "allow voice recording"
 *     consent setting - so a person who refused simply has no track;
 *   - anything that plays a video plays the first audio track and no more, so
 *     on these files a player hands back the game with the call missing. The
 *     studio always rebuilds the soundtrack from the tracks, mutes or no
 *     mutes, and an export is never a plain byte copy.
 *
 * Everything here is defensive on purpose: the engine is an experiment, the
 * methods come and go between builds, and a missing one has to read as "not
 * available" rather than as a crash in the middle of a call.
 */

import { MediaEngineStore } from "@webpack/common";

import { logger } from "./recorder";

/** Dropped off the end of a save: the newest frames are still being encoded. */
const TAIL_MS = 1000;

/** Dropped off the front: the source takes a moment to deliver its first frame. */
const HEAD_MS = 1500;

/** Shorter than this and there is nothing worth handing to the muxer. */
const MIN_SPAN_MS = 1000;

/** What `setClipRecordUser` records for a person. */
type RecordKind = "audio" | "video" | "soundboard";

/**
 * The clips half of the media engine.
 *
 * Written as all-optional because that is the truth: every one of these is
 * absent on a client without the experiment, and several are absent on macOS
 * and Linux even with it.
 */
interface ClipsEngine {
    hasSetClipsRecordingEnabled?(): boolean;
    setClipsRecordingEnabled?(enabled: boolean): void;
    /**
     * The switch for the out-of-process recorder, deliberately never called.
     *
     * Clips exist in two shapes inside this module. The older one records in
     * the voice process itself; the newer one, "v3", spawns a separate
     * `discord_clips.exe` and talks to it over `\\.\pipe\discord-clips-*`.
     * That executable ships in a module of its own and is not present in
     * `modules/discord_voice-1`, so turning v3 on here only moves the engine
     * onto a path it cannot walk: `failed to ensure clips process is alive`.
     *
     * The in-process recorder needs none of it and already writes one track
     * per person, which is the whole point - `clip-2026-08-24_18-29-57.mp4`,
     * written by this plugin, carries `0:all` and three `<userId>:voice`
     * tracks. Kept in the interface so the settings panel can report whether
     * this client has v3 at all, and for the next person who wonders why it is
     * not used.
     */
    setClipsV3Enabled?(enabled: boolean): void;
    setClipsUIActive?(active: boolean): void;
    setClipBufferLength?(seconds: number): void;
    /**
     * Quality, under both names it has had.
     *
     * The native module exports `applyClipsQualitySettings`; `set...` is the
     * older wrapper name and is missing from current builds, where calling it
     * through `?.` did nothing at all and left the engine on its defaults.
     */
    applyClipsQualitySettings?(...args: any[]): boolean;
    setClipsQualitySettings?(...args: any[]): boolean;
    /**
     * The name the native module actually exports for this.
     *
     * `Discord::ApplyClipsSettings(ClipsSettings)` - one struct, not a list of
     * numbers - and it has to land before the source does, because a source
     * handed to an engine with no quality is refused outright: `Cannot set
     * clips source due to missing video quality settings. Framerate: `. A
     * refusal there is silent from out here, and what it leaves behind is an
     * engine that is enabled, armed, holding nothing, which is exactly what a
     * save then fails on.
     */
    applyClipsSettings?(...args: any[]): boolean;
    setClipsSource?(source: ClipsSource | null): void;
    getSystemSteadyClockNowMs?(): number | null;
    saveClipEx?(request: SaveRequest): Promise<SaveResult>;
    hasExportClipToFile?(): boolean;
    on?(event: string, listener: (...args: any[]) => void): void;
    off?(event: string, listener: (...args: any[]) => void): void;
    removeListener?(event: string, listener: (...args: any[]) => void): void;
}

interface ClipsSource {
    desktopDescription: {
        id: string;
        soundshareId: number | null;
        useVideoHook: boolean;
        useHookFramePacer: boolean;
        useGraphicsCapture: boolean;
        useCaptureDeviceForEncode: boolean;
        useLoopback: boolean;
        useQuartzCapturer: boolean;
        allowScreenCaptureKit: boolean;
        videoHookStaleFrameTimeoutMs: number;
        graphicsCaptureStaleFrameTimeoutMs: number;
        hdrCaptureMode: string;
        videoHookAllowDx12: boolean;
        minCaptureWidth: number;
        minCaptureHeight: number;
    };
    quality: { frameRate: number; resolution: number; bitratePercent: number; };
    bitratePercent: number;
    applicationName: string;
}

/**
 * The window the native buffer is asked to save.
 *
 * All four times are on the engine's own steady clock, not on the wall clock:
 * `now()` below is the only correct source for them. `trim*` is the part that
 * ends up in the file, `start`/`end` the part the engine is asked to hold on
 * to - Discord keeps them apart so its editor can widen a clip afterwards, and
 * the plugin simply asks for the same span twice.
 */
/**
 * What `saveClipEx` takes, and all four times are genuinely optional.
 *
 * The module's own signature says so - `Engine::SaveClip(std::string,
 * std::string, std::string, std::optional<uint64_t>, std::optional<uint64_t>,
 * std::optional<uint64_t>, std::optional<uint64_t>, ...)` - and leaving them
 * out is the only way to say "whatever you have". Every one of them is a point
 * on the engine's own steady clock, and there is no way from out here to know
 * where its ring buffer actually begins: it fills at whatever rate the encoder
 * manages, a capture that reopened starts it over, and the muxer needs a
 * keyframe on each side of the span. Ask for a window it cannot cover and it
 * refuses the whole clip - `Mp4MuxerImpl::FinishedAddingTracks failed to find
 * appropriate starting and ending timestamp` - rather than handing back the
 * part it does have.
 *
 * `endMs` was in this list and is not a field the module reads. The four it
 * reads are the ones below.
 */
interface SaveRequest {
    filepath: string;
    metadata: string;
    thumbnailMs?: number;
    startMs?: number;
    trimStartMs?: number;
    trimEndMs?: number;
    userId?: string;
}

interface SaveResult {
    duration?: number;
    /** What the module calls it internally, on builds that answer with it. */
    clipDurationMs?: number;
    clipStats?: Record<string, unknown>;
    thumbnail?: string;
    metadata?: string;
}

/** A connection in the voice channel, which is where per-person consent lives. */
interface ClipsConnection {
    context: string;
    setClipRecordUser?(userId: string, kind: RecordKind, enabled: boolean): void;
}

export interface NativeAvailability {
    /** Whether a clip can be recorded and saved through the native engine. */
    available: boolean;
    /** Why not, in a form that can be shown to the user as it is. */
    reason: string;
    /** The individual methods, for the diagnostic in the settings panel. */
    methods: Record<string, boolean>;
}

/** How the source is armed, so re-arming with the same values does nothing. */
interface Armed {
    sourceId: string;
    seconds: number;
    resolution: number;
    frameRate: number;
    /** Engine clock at the moment the source was set, for clamping a save. */
    at: number;
}

let armed: Armed | null = null;

/**
 * The source last handed to the engine, kept so it can be handed over again.
 *
 * The module says outright what it wants here: when it takes a source and has
 * no video to attach it to yet, it logs `Engine::CreateClipsVideoForwarder: no
 * video source available` and `); leaving recording dormant, JS-side
 * setClipsSource will retry` - and then waits to be asked a second time. A
 * single call at arming is therefore a coin toss on whether the window was
 * capturable at that exact instant, and losing it is silent: the engine stays
 * enabled, the buffer stays armed, and nothing fills it.
 */
let source: ClipsSource | null = null;

/** Whether the engine has said it is recording since the buffer was armed. */
let confirmed = false;

/** The heartbeat that does the retrying, cleared on disarm. */
let retry: ReturnType<typeof setInterval> | null = null;

/** How long to leave between two offers of the same source. */
const RETRY_MS = 3_000;

/**
 * Keep offering the source until the engine admits it is recording.
 *
 * Re-offering is safe by the engine's own account - `CLIPS Screenshare:
 * SetWumpusSource idempotent ` is what it logs for the second and every
 * subsequent offer of an id it already holds - so the heartbeat costs nothing
 * once the capture is up. `setClipsRecordingEnabled(true)` goes back on the
 * wire alongside it because a source offered to a disabled engine is dropped:
 * `Engine::SetClipsSource declining: clips recording is disabled`.
 */
function keepOffering(): void {
    if (retry != null) return;

    retry = setInterval(() => {
        if (!armed || !source || confirmed) return;

        const found = engine();
        if (!found) return;

        ours++;

        try {
            found.setClipsRecordingEnabled?.(true);
            found.setClipsSource?.(source);
        } catch (e) {
            logger.warn("The clip engine refused the source on a retry", e);
        } finally {
            ours--;
        }
    }, RETRY_MS);
}

/** Drop the heartbeat and everything it was keeping alive. */
function stopOffering(): void {
    if (retry != null) clearInterval(retry);
    retry = null;
    source = null;
    confirmed = false;
}

/*
 * Discord drives the same engine, and it wins by default.
 *
 * `MediaEngineStore.getMediaEngine()` hands back one shared object. The
 * client's own clips controller pushes its state onto that object whenever it
 * re-syncs, and with Discord's own Clips off that state is "not recording". The
 * native log shows it plainly: the buffer is armed at 20:52:06.427
 * (`SetClipsRecordingEnabled(true)`, `SetClipBufferLength(10)`) and torn back
 * down at 20:52:07.204, 777ms later, by a call this plugin never made - no
 * `SetClipsUIActive(false)` behind it, which `disarm` below always emits, and a
 * `SetClipsV3Enabled(false)` alongside it that nothing here emits at all. The
 * save nine seconds later then lands on an engine that has been off the whole
 * time, and the muxer answers `FinishedAddingTracks failed to find appropriate
 * starting and ending timestamp`, which is it saying the ring buffer was empty.
 *
 * So for as long as this plugin's buffer is armed, the calls that would tear it
 * down are refused: the four methods are shadowed on the engine instance and
 * handed back on disarm. Only teardown is dropped, and only from outside - every
 * other call, Discord's included, goes straight through untouched.
 */
interface Guard {
    key: string;
    /** Whether the engine owned the method itself rather than inheriting it. */
    own: boolean;
    original: (...args: any[]) => any;
}

const guards: Guard[] = [];

/** Whether this plugin currently expects the engine to be recording. */
let locked = false;

/** Nesting depth of this plugin's own engine calls, which are never refused. */
let ours = 0;

function guardEngine(found: ClipsEngine): void {
    if (guards.length) return;

    const target = found as any;

    const shield = (key: string, tearsDown: (args: any[]) => boolean) => {
        const original = target[key];
        if (typeof original !== "function") return;

        const own = Object.prototype.hasOwnProperty.call(target, key);

        target[key] = function (this: any, ...args: any[]) {
            if (locked && ours === 0 && tearsDown(args)) {
                logger.info(`Refused ${key} from outside the plugin: the clip buffer is armed.`, ...args);
                return undefined;
            }

            return original.apply(this, args);
        };

        guards.push({ key, own, original });
    };

    shield("setClipsRecordingEnabled", ([enabled]) => enabled === false);
    shield("setClipBufferLength", ([seconds]) => !seconds);
    shield("setClipsSource", ([offered]) => offered == null);
    shield("setClipsUIActive", ([active]) => active === false);

    /*
     * Not a teardown of the buffer as such, but Discord emits it in the same
     * breath as the rest when its own clips controller re-syncs, and it takes
     * the recording bridge down with it. Nothing here ever asks for `false`.
     */
    shield("setClipsV3Enabled", ([enabled]) => enabled === false);
}

function unguardEngine(): void {
    const target = engine() as any;

    /*
     * The list is spent whether or not the engine is still there.
     *
     * Keeping it for a missing engine was tried, on the reasoning that the
     * wrappers would otherwise be stranded on it - but `guardEngine` refuses to
     * shield an engine while the list is not empty, so a full list is what stops
     * the next engine from being guarded at all, and the buffer it was meant to
     * protect gets torn down by Discord on the first re-sync. A stranded wrapper
     * is inert; an unguarded engine is a clip that never saves.
     */
    for (const { key, own, original } of guards.splice(0)) {
        try {
            if (!target) continue;

            if (own) target[key] = original;
            else delete target[key];
        } catch (e) {
            logger.warn(`Could not hand ${key} back to the engine`, e);
        }
    }
}

/**
 * Whether it is worth pointing the clip engine at this capture source.
 *
 * Windows and screens both, and the engine is left to say which of the two it
 * can actually do. This used to refuse a screen outright, on the reasoning that
 * the recorder reads the id as a window handle - and the cost of being wrong
 * about that was silence: somebody recording their whole screen never got the
 * native engine, never got a track per person, and was quietly handed the mixed
 * recording the whole feature exists to replace. The engine reports its own
 * failures through `clips-init-failure`, which is a better judge than a guess
 * about an id, and a refusal there costs a few seconds and disarms.
 */
export function canRecord(sourceId: string): boolean {
    return sourceId.startsWith("window:") || sourceId.startsWith("screen:");
}

/** The engine's own recording events, under the names the media engine emits. */
const READY = "clips-recording-ready-changed";
const FAILED = "clips-init-failure";
const ENDED = "clips-recording-ended";
const IDLE = "clips-bridge-idle-shutdown";

/**
 * The last thing the engine said about its own recording, kept for a save that
 * fails.
 *
 * `watchRecording` listens too, but only for five seconds around arming, and by
 * the time a clip is asked for that watch is long gone. What a failed save
 * needs to say is whether the engine ever claimed to be recording at all - the
 * difference between a request built wrong and a ring buffer that was never
 * filling - and that is only knowable if somebody was still listening.
 */
let lastEvent: { event: string; detail: string; } | null = null;

/** Whether the permanent listeners are already installed. */
let listening = false;

/** How the engine took its quality settings, in the words of the failure. */
let qualityNote = "quality never applied";

function detailOf(args: any[]): string {
    return args
        .map(a => {
            if (a == null) return "";
            if (typeof a === "object") {
                try {
                    return JSON.stringify(a);
                } catch {
                    return "[object]";
                }
            }
            return String(a);
        })
        .filter(Boolean)
        .join(" ");
}

/** Installs the listeners once, so the engine's last word is always on hand. */
function listen(): void {
    const found = engine();
    if (listening || !found?.on) return;

    listening = true;

    for (const event of [READY, FAILED, ENDED, IDLE]) {
        found.on(event, (...args: any[]) => {
            lastEvent = { event, detail: detailOf(args) };

            /*
             * `clips-recording-ready-changed` carries the answer as its first
             * argument, and it is the only word the engine gives on whether the
             * ring buffer is actually filling. It arrives on the in-process
             * path too: the media engine wrapper registers the native handler
             * from inside its own `setClipsSource`, not from `setClipsV3-
             * Enabled`, so it does not depend on the out-of-process recorder.
             */
            if (event === READY) confirmed = args[0] !== false;
            logger.info(`The clip engine emitted ${event}`, ...args);
        });
    }
}

function engine(): ClipsEngine | null {
    try {
        return (MediaEngineStore as any)?.getMediaEngine?.() ?? null;
    } catch (e) {
        logger.error("Could not reach the media engine", e);
        return null;
    }
}

function connections(context = "default"): ClipsConnection[] {
    try {
        const found = (engine() as any)?.connections;
        if (!found) return [];

        return [...found].filter(c => c?.context === context);
    } catch {
        return [];
    }
}

/**
 * Whether a Go Live stream is running, which the clip engine will not share a
 * capture with.
 *
 * `Engine::SetClipsSource declining to create source because GoLive is active.`
 * - the source is refused outright, the buffer stays empty, and nothing in the
 * arming path fails, so the only symptom is a clip that comes back mixed. A
 * stream shows up as a second media connection under the `stream` context.
 */
export function goLiveActive(): boolean {
    return connections("stream").length > 0;
}

/**
 * Whether the native engine can record and save a clip on this client.
 *
 * `hasSetClipsRecordingEnabled` is the same check Discord makes before it turns
 * its own clips on, and it is the honest one: the JS wrapper defines the method
 * either way, so only asking the native module tells you whether the experiment
 * shipped a clips-capable `discord_voice.node`.
 */
export function nativeAvailability(): NativeAvailability {
    const found = engine();

    const methods = {
        setClipsRecordingEnabled: typeof found?.setClipsRecordingEnabled === "function",
        setClipsV3Enabled: typeof found?.setClipsV3Enabled === "function",
        setClipBufferLength: typeof found?.setClipBufferLength === "function",
        setClipsSource: typeof found?.setClipsSource === "function",
        setClipsQualitySettings: typeof (found?.applyClipsQualitySettings ?? found?.setClipsQualitySettings) === "function",
        saveClipEx: typeof found?.saveClipEx === "function",
        getSystemSteadyClockNowMs: typeof found?.getSystemSteadyClockNowMs === "function"
    };

    if (!found) return { available: false, reason: "The media engine is not up yet.", methods };

    // The wrapper is always there; this asks the native module underneath it.
    let native = false;
    try {
        native = found.hasSetClipsRecordingEnabled?.() === true;
    } catch { /* an older build without the check */ }

    if (!native) {
        return {
            available: false,
            reason: "This client's voice module was built without the clip engine - the Clips experiment is not on this account.",
            methods
        };
    }

    if (!methods.saveClipEx || !methods.setClipsSource) {
        return { available: false, reason: "The clip engine is present but does not expose a way to save.", methods };
    }

    if (typeof found.getSystemSteadyClockNowMs?.() !== "number") {
        return { available: false, reason: "The clip engine has no clock, so a clip's span cannot be asked for.", methods };
    }

    return { available: true, reason: "Ready.", methods };
}

/** The engine's clock, which is the only clock a save request may be built on. */
export function now(): number | null {
    const value = engine()?.getSystemSteadyClockNowMs?.();
    return typeof value === "number" ? value : null;
}

/**
 * Point the native ring buffer at a capture source and start filling it.
 *
 * `sourceId` is an Electron desktop-capturer id (`screen:0:0`, `window:123:0`),
 * which is the same shape the engine wants. Returns whether the buffer is
 * running afterwards.
 */
export function arm(options: {
    sourceId: string;
    seconds: number;
    resolution: number;
    frameRate: number;
    applicationName?: string;
}): boolean {
    const found = engine();
    if (!found || !nativeAvailability().available) return false;

    const { sourceId, seconds, resolution, frameRate } = options;
    if (!sourceId || seconds <= 0) return false;

    if (!canRecord(sourceId)) {
        logger.warn(`The clip engine cannot record ${sourceId}: it takes a window or a screen.`);
        return false;
    }

    if (armed && armed.sourceId === sourceId && armed.seconds === seconds
        && armed.resolution === resolution && armed.frameRate === frameRate) return true;

    /*
     * The order is the engine's, and it is not the obvious one.
     *
     * `setClipsRecordingEnabled(true)` comes before the source, not after, and
     * the module is explicit about why - `Engine::SetClipsSource declining:
     * clips recording is disabled`. A source handed to a disabled engine is
     * dropped on the floor. That the engine also logs
     * `Engine::CreateClipsVideoForwarder: no video source available` in between
     * is expected and harmless: it says so itself, "leaving recording dormant,
     * JS-side setClipsSource will retry".
     *
     * `setClipsUIActive(true)` goes last, once there is a buffer worth keeping
     * the helper process alive for.
     */
    // Before anything else, so nothing the engine says on the way up is lost.
    listen();

    /*
     * Held across the whole arming sequence, which is synchronous from here to
     * the end of the try: nothing else can interleave, so every call below is
     * this plugin's and the shield lets all of them through.
     */
    guardEngine(found);
    ours++;

    try {
        locked = true;

        found.setClipsRecordingEnabled?.(true);
        found.setClipBufferLength?.(seconds);

        /*
         * Quality is not a nice-to-have, which is what it had been treated as.
         *
         * `Cannot set clips source due to missing video quality settings.
         * Framerate: ` is in the module, and it is a refusal of the *source*,
         * not of the settings: an engine with no quality takes the enable, takes
         * the buffer length, takes the source, and records nothing. From out
         * here that looks exactly like a working buffer until the save comes
         * back with `FinishedAddingTracks failed to find appropriate starting
         * and ending timestamp`, which is the muxer saying there were no tracks
         * to bound.
         *
         * So it is tried in every shape it might take, and the first one that
         * does not throw wins. `setClipsQualitySettings` is not a name the
         * module exports at all - the wrapper defined it, current builds do not,
         * and the optional call on it had been quietly doing nothing for as long
         * as it has been there. What the module exports is `applyClipsSettings`,
         * standing for `Discord::ApplyClipsSettings(ClipsSettings)`: one struct
         * rather than the four loose numbers that were being passed.
         */
        const width = resolution <= 480 ? Math.round(resolution / 3 * 4) : Math.round(resolution / 9 * 16);
        const struct = { width, height: resolution, frameRate, bitratePercent: 100 };

        const shapes: [string, () => unknown][] = [
            ["applyClipsSettings(struct)", () => found.applyClipsSettings?.(struct)],
            ["applyClipsQualitySettings(struct)", () => found.applyClipsQualitySettings?.(struct)],
            ["applyClipsQualitySettings(numbers)", () => found.applyClipsQualitySettings?.(width, resolution, frameRate, 100)],
            ["setClipsQualitySettings(numbers)", () => found.setClipsQualitySettings?.(width, resolution, frameRate, 100)]
        ];

        qualityNote = "quality never applied";

        for (const [label, call] of shapes) {
            try {
                const answer = call();

                // `undefined` is the method being absent, which is not a
                // refusal; `false` is the engine saying no to this shape.
                if (answer === undefined || answer === false) continue;

                qualityNote = label;
                break;
            } catch (e) {
                logger.info(`The clip engine would not take ${label}`, e);
            }
        }

        logger.info(`Clip quality: ${qualityNote} (${width}x${resolution}@${frameRate})`);

        confirmed = false;
        source = {
            desktopDescription: {
                id: sourceId,
                // The native side takes this as a `uint32_t`, and the wrapper's
                // own null-source path spells the empty value `0`, not `null`.
                soundshareId: 0,
                useVideoHook: false,
                useHookFramePacer: true,
                useGraphicsCapture: true,
                useCaptureDeviceForEncode: false,
                useLoopback: true,
                useQuartzCapturer: true,
                allowScreenCaptureKit: true,
                videoHookStaleFrameTimeoutMs: 500,
                graphicsCaptureStaleFrameTimeoutMs: 3000,
                hdrCaptureMode: "never",
                videoHookAllowDx12: false,
                minCaptureWidth: 0,
                minCaptureHeight: 0
            },
            quality: { frameRate, resolution, bitratePercent: 100 },
            bitratePercent: 100,
            applicationName: options.applicationName || "Clipper"
        };

        found.setClipsSource?.(source);

        // Tells the engine a UI is watching, which is what keeps the helper
        // process alive between clips instead of idling out after one.
        found.setClipsUIActive?.(true);

        armed = { sourceId, seconds, resolution, frameRate, at: now() ?? 0 };

        // Only now, so the heartbeat never fires against a half-built arming.
        keepOffering();
        logger.info(`Native clip buffer armed on ${sourceId} (${seconds}s, ${resolution}p${frameRate})`);
        return true;
    } catch (e) {
        logger.error("Could not arm the native clip buffer", e);
        armed = null;
        locked = false;
        unguardEngine();
        return false;
    } finally {
        ours--;
    }
}

/** Stop the native buffer and let go of the capture source. */
export function disarm(): void {
    stopOffering();

    const found = engine();
    if (!found) {
        armed = null;
        locked = false;
        guards.length = 0;
        return;
    }

    // Dropped first, so the shield stops refusing the teardown it is about to
    // be asked for, and put back in the engine's hands at the end.
    locked = false;
    ours++;

    try {
        found.setClipsSource?.(null);
        found.setClipBufferLength?.(0);
        found.setClipsRecordingEnabled?.(false);

        // Which lets the engine let go of the capture and idle back down.
        found.setClipsUIActive?.(false);
    } catch (e) {
        logger.error("Could not stop the native clip buffer", e);
    } finally {
        ours--;
        unguardEngine();
    }

    armed = null;
}

/**
 * Say, per person in the call, whether their voice may be recorded.
 *
 * The engine defaults everyone to off, so nothing is captured until this runs.
 * Passing `false` for someone leaves them out of the clip's audio entirely -
 * a harder cut than the local mute the voice panel offers, and one they cannot
 * be brought back from afterwards.
 */
export function setRecordUser(userId: string, enabled: boolean, kind: RecordKind = "audio"): void {
    for (const connection of connections()) {
        try {
            connection.setClipRecordUser?.(userId, kind, enabled);
        } catch (e) {
            logger.error(`Could not set clip recording for ${userId}`, e);
        }
    }
}

/**
 * The engine's own words out of whatever it rejected with.
 *
 * The native module does not throw `Error`s. What comes back across is a plain
 * object, sometimes carrying `{"error": "..."}` and sometimes only carrying
 * properties that do not enumerate, and both stringify to `[object Object]`.
 */
function engineError(e: unknown): string {
    if (e instanceof Error) return e.message || e.name;
    if (typeof e === "string") return e;
    if (e === null || e === undefined) return "the engine refused without saying why";

    if (typeof e === "object") {
        const record = e as Record<string, unknown>;

        for (const key of ["message", "error", "reason", "detail"]) {
            const value = record[key];
            if (typeof value === "string" && value) return value;
        }

        try {
            const json = JSON.stringify(e);
            if (json && json !== "{}" && json !== "null") return json;
        } catch {
            // Falls through to the property sweep below.
        }

        try {
            const parts = Object.getOwnPropertyNames(record)
                .filter(key => key !== "stack")
                .map(key => `${key}: ${String(record[key])}`);

            if (parts.length) return parts.join(", ");
        } catch {
            // Nothing readable on it.
        }
    }

    return String(e);
}

/**
 * Write the last `seconds` of the native buffer to `filepath`.
 *
 * Resolves with the length the engine actually had - a buffer that has not
 * filled up yet gives back a shorter clip rather than failing.
 */
export async function saveNativeClip(filepath: string, seconds: number, metadata: Record<string, unknown> = {}): Promise<number> {
    const found = engine();
    if (!found?.saveClipEx) throw new Error("The native clip engine is not available.");

    const at = now();
    if (at == null) throw new Error("The native clip engine has no clock.");

    /*
     * The window is pulled in at both ends.
     *
     * The muxer needs a frame on each side of the span it is given, and it has
     * neither at the very edges: the newest frame is still being encoded, and
     * the oldest one lands some way after the source was armed. Asking for the
     * exact edges is what makes it answer `FinishedAddingTracks failed to find
     * appropriate starting and ending timestamp`.
     */
    const to = at - TAIL_MS;
    const floor = armed ? armed.at + HEAD_MS : 0;
    const from = Math.max(floor, to - Math.round(seconds * 1000));

    // Not a refusal any more: a buffer that has only been running a moment
    // still has a moment's worth in it, and the last attempt below asks for
    // that without naming a window at all.
    if (to - from < MIN_SPAN_MS) {
        logger.info("The native buffer has barely started; asking the engine for whatever it holds.");
    }

    /*
     * Asked for several times, giving up more of the request each time.
     *
     * A window is a guess about where the engine's ring buffer starts, and the
     * guess is unverifiable from here - see `SaveRequest`. So the attempts go
     * from the most specific to the least, and the last one asks for nothing at
     * all: no start, no trim, no thumbnail time, which is the module's own way
     * of saying "write whatever you are holding". That one has no window to be
     * wrong about, and it is the reason this list exists rather than a single
     * call that fails.
     *
     * A short clip with a track per person beats a full-length one mixed down
     * to a single track, which is what the fallback produces and what a mute
     * can do nothing honest with.
     */
    const base = { filepath, metadata: JSON.stringify(metadata) };

    const windowed = (span: number): SaveRequest => ({
        ...base,
        thumbnailMs: to - span,
        startMs: to - span,
        trimStartMs: to - span,
        trimEndMs: to
    });

    const attempts: { label: string; request: SaveRequest; }[] = [];

    for (const span of [to - from, Math.round((to - from) / 2), 4000]) {
        if (span < MIN_SPAN_MS || span > to - from) continue;
        attempts.push({ label: `${span / 1000}s window`, request: windowed(span) });
    }

    attempts.push({ label: "whatever the engine is holding", request: base });

    let failure: unknown;

    for (const { label, request } of attempts) {
        try {
            const result = await found.saveClipEx(request);

            // `duration` is what the wrapper documents and `clipDurationMs` is
            // what the module calls it; builds have answered with either.
            const reported = result?.duration ?? result?.clipDurationMs ?? 0;

            if (reported > 0) {
                logger.info(`The native clip engine wrote a clip (${label}, reported ${reported}).`);
                return reported;
            }

            logger.warn(`The native clip engine accepted ${label} and reported nothing.`, result);
            failure = new Error("the engine accepted the request and wrote nothing");
        } catch (e) {
            logger.warn(`The native clip engine refused ${label}`, e);

            /*
             * The last one, not the first.
             *
             * The attempts run from the most specific request to the least, and
             * the interesting refusal is the one at the end: a windowed request
             * can fail because the window was wrong, but the last request names
             * no window at all. Keeping the first error meant every report was
             * the least informative of the four.
             */
            failure = e;
        }
    }

    /*
     * Re-thrown with what was asked for, because the engine's own answer is
     * frequently a bare object with a single unhelpful field and the caller
     * only gets to show one line. Whether the buffer had been running for
     * thirty seconds or for two is the difference between a bug in the request
     * and a ring that never filled, and neither is visible otherwise.
     */
    const held = armed ? Math.round((at - armed.at) / 1000) : 0;
    const said = lastEvent
        ? `${lastEvent.event}${lastEvent.detail ? ` ${lastEvent.detail}` : ""}`
        : "the engine never said whether it was recording";
    const state = confirmed ? "recording confirmed" : "recording never confirmed";

    throw new Error(`${engineError(failure)} [${state}; ${said}] (${attempts.length} attempts, buffer armed ${held}s ago)`);
}

/** What the engine had to say about whether it is recording. */
export interface RecordingVerdict {
    /** Whether it is worth keeping the native path for this buffer. */
    recording: boolean;
    /** Why not, when it is not. Empty otherwise. */
    reason: string;
    /**
     * Whether the engine said so itself, rather than the wait simply expiring.
     *
     * Expect false. The ready event belongs to the out-of-process recorder,
     * which is not the path this plugin uses, so the in-process one records
     * without ever announcing itself. Failures do arrive - `clips-init-failure`
     * came back promptly and with a reason the one time the engine was pointed
     * at a path it could not walk - so silence here is the ordinary case and
     * not an unknown. Kept for the log, and for a build that starts emitting it.
     */
    confirmed: boolean;
}

/** A verdict being waited on, and the means to stop waiting for it. */
export interface RecordingWatch {
    settled: Promise<RecordingVerdict>;
    /** Drops the listeners, for a caller that gave up before the verdict. */
    stop(): void;
}

/**
 * Watch for the engine's verdict on whether it is recording.
 *
 * Opened *before* the engine is armed, deliberately. The engine spawns a helper
 * process, opens the capture and only then starts filling the ring buffer, and
 * where that is quick the ready event comes back from inside the very call that
 * arms it - so a watch installed afterwards sits out its whole timeout waiting
 * for something that already happened.
 *
 * `clips-init-failure` is the no, and it is the one that matters: it arrives
 * quickly and carries the engine's own words. `clips-recording-ready-changed`
 * is the yes, and on this recording path it never comes at all - it belongs to
 * the out-of-process recorder - so the wait expiring means "nothing went
 * wrong", not "nobody knows". The two stop events are neither. The engine emits them while it settles -
 * tearing down a previous session, reacting to a source being replaced - and
 * they say nothing about the buffer being armed now; by the time one of them
 * matters, the ready event has already resolved this. They are logged and
 * ignored, because believing them is what turned a working screen into
 * "the engine stopped recording before the clip was asked for".
 */
export function watchRecording(timeoutMs = 5_000): RecordingWatch {
    const found = engine();

    if (!found?.on) {
        return {
            settled: Promise.resolve({ recording: true, reason: "", confirmed: false }),
            stop: () => { }
        };
    }

    let done = false;
    let drop = () => { };
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settled = new Promise<RecordingVerdict>(resolve => {
        const finish = (verdict: RecordingVerdict) => {
            if (done) return;
            done = true;

            clearTimeout(timer);
            drop();
            resolve(verdict);
        };

        const onReady = (running: boolean) => {
            if (running) finish({ recording: true, reason: "", confirmed: true });
        };

        const onFailed = (message: string) => finish({
            recording: false,
            reason: message || "the engine could not start recording",
            confirmed: true
        });

        const onSettling = (event: string) => logger.info(`The clip engine emitted ${event} while starting up; not treating it as a verdict.`);

        const listeners: [string, (...args: any[]) => void][] = [
            [READY, onReady],
            [FAILED, onFailed],
            [ENDED, () => onSettling(ENDED)],
            [IDLE, () => onSettling(IDLE)]
        ];

        drop = () => {
            for (const [event, listener] of listeners) {
                try {
                    (found.off ?? found.removeListener)?.call(found, event, listener);
                } catch { /* an emitter that only adds; the timeout still fires */ }
            }
        };

        for (const [event, listener] of listeners) found.on?.(event, listener);

        // A client that never emits the ready event is not a failure in itself:
        // the save that follows is the real test, and it reports its own reason.
        timer = setTimeout(() => finish({ recording: true, reason: "", confirmed: false }), timeoutMs);
    });

    return { settled, stop: () => { clearTimeout(timer); drop(); } };
}
