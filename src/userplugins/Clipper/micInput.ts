/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the microphone, as Discord captures it
 *
 * A clip recorded alone used to sound nothing like the same voice in a call,
 * and the two reasons were both invisible from the settings panel.
 *
 * The first is the device. `MediaEngineStore.getInputDeviceId()` returns an id
 * minted by `discord_voice`, the native voice module, and `getUserMedia` only
 * knows the ids Chromium mints - a per-origin hash of something else entirely.
 * Asking for Discord's id with `{ exact }` therefore fails on the desktop
 * client every time, and the fallback opened the *system default* input. Anyone
 * whose Windows default is not the microphone they chose in Discord - a webcam
 * array, a laptop lid mic, the "Communications" device - was recording that
 * one: distant, roomy, and picking up the speakers. Which is what an echo is.
 * The devices are matched by name here instead, and the id is only used when it
 * is one Chromium actually handed out (the web build, where they are the same).
 *
 * The second is that nothing gated the microphone. Discord transmits when you
 * speak - push-to-talk, or voice activity above the sensitivity threshold - and
 * everything below that never leaves the machine. The plugin recorded the input
 * continuously instead, so a clip carried the whole room: the keyboard, the
 * fan, the chair, someone talking next door, the speakers bleeding back in
 * between two sentences. A gate on the same signal Discord gates on keeps that
 * out of the clip and leaves the voice untouched.
 *
 * What cannot be had: Krisp. It runs inside the native module, on the native
 * capture, and nothing hands the result back to the renderer as a stream. The
 * browser's own noise suppression and echo cancellation are switched to match
 * Discord's toggles, which is the same intent through a weaker algorithm, and
 * the gate covers the rest of what Krisp was doing for a clip - the noise
 * between the words rather than under them.
 */

import { Logger } from "@utils/Logger";
import { FluxDispatcher, MediaEngineStore, SelectedChannelStore, UserStore } from "@webpack/common";

import { settings } from "./settings";

const logger = new Logger("Clipper", "#f0b132");

/** How often the gate looks at the level. Short enough to be inaudible. */
const POLL_MS = 20;

/**
 * How far the microphone is delayed so the gate can open before the sound
 * arrives.
 *
 * Detection costs one poll, and a gate that opens on the syllable it detected
 * eats the front of it. Delaying the signal by more than the detection latency
 * moves the decision ahead of the sound instead, at the price of the whole mic
 * channel sitting this far behind the picture - a twentieth of a second, well
 * under what anyone can hear against a game.
 */
const LOOKAHEAD_MS = 45;

/** Gain ramps, as `setTargetAtTime` time constants. Fast open, gentle close. */
const ATTACK_TAU = 0.008;
const RELEASE_TAU = 0.07;

/** How long the gate stays open after the last thing loud enough to open it. */
const HOLD_MS = 350;

/** Above the noise floor, in dB, when Discord is set to decide by itself. */
const OPEN_MARGIN_DB = 10;
const CLOSE_MARGIN_DB = 6;

/** How long one SPEAKING dispatch keeps the gate open on its own. */
const SPEAKING_MS = 400;

/** Nothing quieter than this is a sound. Keeps log(0) out of the arithmetic. */
const FLOOR_DB = -110;

/**
 * Corner of the high-pass in front of everything.
 *
 * Below it there is no voice, only the desk the microphone stands on, the fan,
 * the chair and the pops of breath - all of which are loud in dB terms and are
 * exactly what walks the noise floor up until the gate stops trusting it.
 */
const HIGHPASS_HZ = 85;

/**
 * How far the speakers are allowed to push the gate's threshold up.
 *
 * The echo people hear in a clip is the game coming back out of the speakers
 * and into the microphone. Chromium's echo cancellation cannot touch it: its
 * reference is what Chromium itself plays, and the game is another process
 * entirely. What the plugin does have is the captured system sound, one node
 * away in the same graph - so when the room is loud the microphone has to be
 * louder still before the gate believes it is a voice. Only the threshold
 * moves; the signal itself is never touched, so nothing pumps.
 */
const DUCK_MAX_DB = 12;

interface MicPlan {
    /** The id Discord holds, which is the native module's, not Chromium's. */
    discordDeviceId: string;
    /** What Discord calls that device, when its list can be read. */
    discordDeviceName: string;
    /** The id to ask `getUserMedia` for, empty for the system default. */
    deviceId: string;
    /** How the two were tied together. */
    matched: "id" | "name" | "default" | "none";
    /** What Chromium says it opened, once it has. Empty before that. */
    openedLabel: string;
    /** Discord's input volume as a factor, 0 to 2. */
    volume: number;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
    /** Discord's input mode, when it can be read. */
    mode: "VOICE_ACTIVITY" | "PUSH_TO_TALK" | "unknown";
    /** Sensitivity in dBFS, or null when Discord sets it by itself. */
    threshold: number | null;
    selfMute: boolean;
}

export interface MicStatus {
    /** A microphone is open in the running mix. */
    live: boolean;
    /** The gate is following Discord rather than passing everything through. */
    gated: boolean;
    /** The gate is letting sound through right now. */
    open: boolean;
    /** Current input level in dBFS, or null when nothing is open. */
    level: number | null;
    /** Muted in Discord: the clip gets nothing, exactly as the call does. */
    selfMute: boolean;
    /** Label of the device actually opened. */
    device: string;
    mode: MicPlan["mode"];
}

function asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/**
 * Whether Discord is actually transmitting anywhere.
 *
 * The mute button keeps its state outside a call, and a lot of people leave it
 * on between two of them. Muted means "do not send my voice to those people",
 * which is a sentence about a call; read as "do not record me" it would hand
 * back a silent clip to somebody talking alone over a game, so it only counts
 * while there is somebody to be muted from.
 */
function inCall(): boolean {
    try {
        return !!SelectedChannelStore.getVoiceChannelId?.();
    } catch {
        return false;
    }
}

/** Discord's own list, so the device it picked can be recognised by name. */
function discordDeviceName(store: any, id: string): string {
    if (!id) return "";

    for (const source of [store?.getInputDevices?.(), store?.getMediaEngine?.()?.getInputDevices?.()]) {
        if (!source || typeof source !== "object") continue;

        const entries: any[] = Array.isArray(source) ? source : Object.values(source);
        const found = entries.find(e => e && (e.id === id || e.deviceId === id));

        if (found) return String(found.name ?? found.label ?? found.displayName ?? "");
    }

    return "";
}

/**
 * Reads the voice settings the user already configured in Discord.
 *
 * Every field is optional on purpose: these are internal methods on an internal
 * store, they come and go between builds, and a missing one has to read as "use
 * the sensible default" rather than take the microphone down with it.
 */
function micPlan(): MicPlan | null {
    const store = MediaEngineStore as any;
    if (typeof store?.getInputDeviceId !== "function") return null;

    try {
        const discordDeviceId = String(store.getInputDeviceId() ?? "");
        const volume = typeof store.getInputVolume === "function" ? Number(store.getInputVolume()) : 100;

        const options = typeof store.getModeOptions === "function" ? store.getModeOptions() : null;
        const mode = typeof store.getMode === "function" ? String(store.getMode()) : "";
        const raw = Number(options?.threshold);

        // Discord's slider is a dBFS value between silence and clipping. Its
        // "automatically determine input sensitivity" checkbox is the same
        // decision this gate makes from the noise floor, so it maps to null.
        const automatic = options?.autoThreshold !== false;
        const threshold = !automatic && Number.isFinite(raw) && raw <= 0 && raw >= -100 ? raw : null;

        return {
            discordDeviceId,
            discordDeviceName: discordDeviceName(store, discordDeviceId),
            deviceId: "",
            matched: "none",
            openedLabel: "",
            volume: Math.min(2, Math.max(0, (Number.isFinite(volume) ? volume : 100) / 100)),
            echoCancellation: asBoolean(store.getEchoCancellation?.(), true),
            noiseSuppression: asBoolean(store.getNoiseSuppression?.(), false) || asBoolean(store.getNoiseCancellation?.(), false),
            autoGainControl: asBoolean(store.getAutomaticGainControl?.(), true),
            mode: mode === "PUSH_TO_TALK" || mode === "VOICE_ACTIVITY" ? mode : "unknown",
            threshold,
            selfMute: asBoolean(store.isSelfMute?.(), false)
        };
    } catch (e) {
        logger.warn("Could not read Discord's voice settings, using the browser defaults", e);
        return null;
    }
}

/**
 * Device names as Windows and Chromium write them, reduced to what they agree
 * on.
 *
 * The same microphone is "Microphone (2- USB Audio Device)" in one list and
 * "USB Audio Device" in the other, and the enumeration index moves when a
 * webcam is plugged in. What survives is the letters.
 */
function normalise(name: string): string {
    return name
        .toLowerCase()
        .replace(/\b\d+\s*-\s*/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(microphone|mic|input|default|communications)\b/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

/** Ties Discord's chosen device to one Chromium is willing to open. */
function resolveDevice(plan: MicPlan, devices: MediaDeviceInfo[]): MicPlan {
    const id = plan.discordDeviceId;

    // Discord's own word for "whatever the system is set to", which is also
    // what an empty constraint means. Asking for it by id is rejected outright.
    if (!id || id === "default" || id === "communications") return { ...plan, deviceId: "", matched: "default" };

    // The web build has no native module, so the two id spaces are one.
    if (devices.some(d => d.deviceId === id)) return { ...plan, deviceId: id, matched: "id" };

    const wanted = normalise(plan.discordDeviceName);
    if (wanted) {
        const named = devices.filter(d => d.deviceId !== "default" && d.deviceId !== "communications");
        const exact = named.find(d => normalise(d.label) === wanted);
        const partial = exact ?? named.find(d => {
            const label = normalise(d.label);
            return !!label && (label.includes(wanted) || wanted.includes(label));
        });

        if (partial) return { ...plan, deviceId: partial.deviceId, matched: "name" };
    }

    // Chromium cannot name what it has not been allowed to open, and Discord's
    // id means nothing here, so the system default is all that is left.
    return { ...plan, deviceId: "", matched: "none" };
}

/** What the plan asks the capture pipeline for, device aside. */
function processing(plan: MicPlan): MediaTrackConstraints {
    return {
        echoCancellation: plan.echoCancellation,
        noiseSuppression: plan.noiseSuppression,
        autoGainControl: plan.autoGainControl,
        // One microphone is one channel. Chromium will otherwise hand back a
        // stereo pair for a mono capsule, and the empty side of it is hiss.
        channelCount: 1
    };
}

/** What Chromium says the track it handed over is actually recording. */
function openedLabel(stream: MediaStream, devices: MediaDeviceInfo[]): string {
    const track = stream.getAudioTracks()[0];
    if (!track) return "";

    const id = track.getSettings?.().deviceId ?? "";
    const known = devices.find(d => d.deviceId === id)?.label;

    return known || track.label || "";
}

/**
 * Opens the microphone Discord is set to, and says which one that turned out
 * to be.
 *
 * The order matters, and getting it wrong was the whole bug. `enumerateDevices`
 * returns entries with **empty labels** until the origin has been granted
 * microphone access, and Discord's own voice never goes through `getUserMedia`
 * - the native module handles it - so the client can be in a call all day with
 * the renderer still holding no permission at all. Matching a device by name
 * against a list of blanks matches nothing, every time, and the fallback was
 * the system default: a webcam array, a laptop lid microphone, whatever
 * Windows happened to prefer. Distant, roomy, full of the speakers. The echo.
 *
 * So a plain capture is opened first, purely to hold the permission open while
 * the list is read; the real device is picked from a list that now has names;
 * and the throwaway is only dropped once its replacement is running, so the
 * device is never released and reacquired in front of another application.
 */
async function openMic(plan: MicPlan): Promise<{ stream: MediaStream; plan: MicPlan; }> {
    const audio = processing(plan);
    const first = await navigator.mediaDevices.getUserMedia({ audio });

    let devices: MediaDeviceInfo[] = [];
    try {
        devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput" && d.deviceId);
    } catch (e) {
        logger.warn("Could not list the input devices", e);
    }

    const wanted = resolveDevice(plan, devices);
    const already = first.getAudioTracks()[0]?.getSettings?.().deviceId ?? "";

    if (!wanted.deviceId || wanted.deviceId === already) {
        return { stream: first, plan: { ...wanted, openedLabel: openedLabel(first, devices) } };
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { ...audio, deviceId: { exact: wanted.deviceId } }
        });

        first.getTracks().forEach(t => t.stop());

        return { stream, plan: { ...wanted, openedLabel: openedLabel(stream, devices) } };
    } catch (e) {
        // Unplugged between the enumeration and now, or held exclusively by
        // something else. A clip with the wrong microphone beats a silent one.
        logger.warn("Discord's input device would not open, keeping the default one", e);

        return {
            stream: first,
            plan: { ...wanted, deviceId: "", matched: "none", openedLabel: openedLabel(first, devices) }
        };
    }
}

/**
 * Runs the whole opening once and throws the capture away again.
 *
 * For the report, and for nothing else: it asks for the microphone, so it only
 * ever runs when somebody clicked the toolbox entry that says it will.
 */
async function probeMic(read: MicPlan): Promise<MicPlan> {
    try {
        const { stream, plan } = await openMic(read);
        stream.getTracks().forEach(t => t.stop());

        return plan;
    } catch (e) {
        logger.warn("Could not open the microphone for the check", e);

        return { ...read, deviceId: "", matched: "none", openedLabel: "" };
    }
}

/** The microphone currently in the mix, for the status the panel shows. */
let current: MicInput | null = null;

const watchers = new Set<(status: MicStatus) => void>();
let watchTimer: ReturnType<typeof setInterval> | null = null;

/**
 * One microphone, gated, ready to be wired into the recording mix.
 *
 * Owns the device as well as the gate: Discord's input device can change while
 * a buffer is running, and the graph the recorder built around the gate has to
 * survive that. The stream is swapped underneath instead.
 */
export class MicInput {
    private data: Float32Array<ArrayBuffer>;
    private refData: Float32Array<ArrayBuffer> | null;

    /** The node the reference analyser hangs off, so it can be unhooked again. */
    private refSource: AudioNode | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private unsubscribe: (() => void) | null = null;

    /** Adaptive noise floor, in dBFS, when Discord decides the threshold. */
    private floor = -60;
    private level = FLOOR_DB;
    private open = true;
    private holdUntil = 0;
    private speakingUntil = 0;

    /** Whether a call is on, rechecked on a timer rather than every poll. */
    private call = inCall();
    private callAt = 0;

    /** How much of the run the gate spent open, for the microphone report. */
    private openMs = 0;
    private totalMs = 0;

    private constructor(
        private readonly ctx: AudioContext,
        private plan: MicPlan,
        private stream: MediaStream,
        private source: MediaStreamAudioSourceNode,
        private readonly highpass: BiquadFilterNode,
        private readonly delay: DelayNode,
        private readonly gate: GainNode,
        private readonly compressor: DynamicsCompressorNode,
        private readonly makeup: GainNode,
        private readonly analyser: AnalyserNode,
        private readonly tap: MediaStreamAudioDestinationNode,
        private readonly reference: AnalyserNode | null
    ) {
        this.data = new Float32Array(analyser.fftSize);
        this.refData = reference ? new Float32Array(reference.fftSize) : null;
    }

    /**
     * @param reference the captured system sound, when the recorder has it.
     * Used to raise the gate's threshold while the speakers are loud - see
     * DUCK_MAX_DB - and never mixed into anything.
     */
    static async open(ctx: AudioContext, reference?: AudioNode | null): Promise<MicInput | null> {
        const read = micPlan() ?? {
            discordDeviceId: "",
            discordDeviceName: "",
            deviceId: "",
            matched: "default" as const,
            openedLabel: "",
            volume: 1,
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: true,
            mode: "unknown" as const,
            threshold: null,
            selfMute: false
        };

        const { stream, plan } = await openMic(read);

        if (!stream.getAudioTracks().length) {
            stream.getTracks().forEach(t => t.stop());
            return null;
        }

        const source = ctx.createMediaStreamSource(stream);

        const highpass = ctx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = HIGHPASS_HZ;

        const delay = ctx.createDelay(1);
        delay.delayTime.value = LOOKAHEAD_MS / 1000;

        const gate = ctx.createGain();
        gate.gain.value = 1;

        /*
         * A voice against a game is never loud enough in one place and always
         * too loud in another: leaning into the microphone for a call-out, back
         * in the chair for the rest. Discord evens that out on its own side and
         * a clip had nothing, which is most of why the same voice sounded worse
         * in a clip than in the call it came from.
         *
         * Gentle on purpose - 3:1 from -24 dB, which is a hand on the fader
         * rather than a radio compressor - and after the gate, so what it
         * brings up is a voice and never the silence between two of them.
         */
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 12;
        compressor.ratio.value = 3;
        compressor.attack.value = 0.005;
        compressor.release.value = 0.15;

        const makeup = ctx.createGain();
        makeup.gain.value = 1.6;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;

        let listen: AnalyserNode | null = null;
        if (reference) {
            try {
                listen = ctx.createAnalyser();
                listen.fftSize = 1024;
                reference.connect(listen);
            } catch (e) {
                logger.warn("Could not listen to the system sound, the gate will not follow the speakers", e);
                listen = null;
            }
        }

        const mic = new MicInput(
            ctx, plan, stream, source, highpass, delay, gate, compressor, makeup, analyser,
            ctx.createMediaStreamDestination(), listen
        );
        mic.refSource = listen ? reference ?? null : null;
        mic.wire();
        mic.start();

        current = mic;
        logger.info(`Microphone: ${mic.describe()}`);

        if (plan.matched === "none") {
            logger.warn(`Discord is set to "${plan.discordDeviceName || plan.discordDeviceId}" but nothing in Chromium's list matches it; recording ${plan.openedLabel || "the system default"} instead`);
        }

        return mic;
    }

    /** Where the recorder takes the gated, levelled signal from. */
    get node(): AudioNode {
        return this.makeup;
    }

    /**
     * The same signal as a stream, for the per-person tracks.
     *
     * Gated like the mix, deliberately: the studio's "you" track and the clip's
     * soundtrack are the same voice, and a track carrying the room while the
     * mix stays quiet would be heard the moment anybody unmutes it.
     */
    get track(): MediaStream {
        return this.tap.stream;
    }

    /** Discord's input volume, applied by the recorder as the channel's factor. */
    get volume(): number {
        return this.plan.volume;
    }

    get status(): MicStatus {
        return {
            live: true,
            gated: this.gating,
            open: this.open,
            level: this.level,
            selfMute: this.plan.selfMute && this.call,
            // What is being recorded, not what Discord is set to: those are the
            // same thing only when the match worked, and the row is the place
            // that has to say so when it did not.
            device: this.plan.openedLabel || this.plan.discordDeviceName || "System default input",
            mode: this.plan.mode
        };
    }

    /** One line for the log and the microphone check. */
    describe(): string {
        const wanted = this.plan.discordDeviceName || this.plan.discordDeviceId || "the system default";
        const device = this.plan.openedLabel || wanted;
        const how = {
            id: "matched by id",
            name: `matched by name to Discord's ${wanted}`,
            default: "Discord is on the system default",
            none: `no match for Discord's ${wanted}, using the system default`
        }[this.plan.matched];

        const track: MediaTrackSettings = this.stream.getAudioTracks()[0]?.getSettings?.() ?? {};
        const on = [
            (track.echoCancellation ?? this.plan.echoCancellation) ? "echo cancellation" : "",
            (track.noiseSuppression ?? this.plan.noiseSuppression) ? "noise suppression" : "",
            (track.autoGainControl ?? this.plan.autoGainControl) ? "auto gain" : ""
        ].filter(Boolean).join(", ") || "no processing";

        const gate = !this.gating
            ? "gate off"
            : this.plan.threshold !== null
                ? `gate at ${this.plan.threshold} dB`
                : `gate following the noise floor (${Math.round(this.floor)} dB)`;

        const share = this.totalMs > 0 ? `, open ${Math.round((this.openMs / this.totalMs) * 100)}% of the time` : "";

        return `${device} (${how}), ${on}, ${gate}${share}`;
    }

    private get gating(): boolean {
        return settings.store.micGate !== false;
    }

    private wire(): void {
        // The high-pass sits in front of the detector as well as the signal:
        // a gate that measures the rumble it is about to remove reads a noise
        // floor that is not there and stops opening for the voice.
        this.source.connect(this.highpass);
        this.highpass.connect(this.delay);
        this.highpass.connect(this.analyser);
        this.delay.connect(this.gate);
        this.gate.connect(this.compressor);
        this.compressor.connect(this.makeup);
        this.makeup.connect(this.tap);
    }

    private start(): void {
        this.timer = setInterval(this.tick, POLL_MS);

        const store = MediaEngineStore as any;
        const onSettings = () => void this.resync();
        const onSpeaking = (event: any) => {
            if (event?.userId && event.userId === UserStore.getCurrentUser()?.id && event.speakingFlags) {
                this.speakingUntil = Date.now() + SPEAKING_MS;
            }
        };

        try {
            store?.addChangeListener?.(onSettings);
            FluxDispatcher.subscribe("SPEAKING" as any, onSpeaking);
        } catch (e) {
            logger.warn("Could not follow Discord's voice settings while recording", e);
        }

        this.unsubscribe = () => {
            try {
                store?.removeChangeListener?.(onSettings);
                FluxDispatcher.unsubscribe("SPEAKING" as any, onSpeaking);
            } catch (e) {
                logger.warn("Could not stop following Discord's voice settings", e);
            }
        };
    }

    /**
     * Follows a change made in Discord's voice settings while the buffer runs.
     *
     * Only the device costs anything: a threshold, a mute or a volume is read
     * live by the gate, and reopening a capture for one of those would put a
     * hole in the clip for no reason.
     */
    private async resync(): Promise<void> {
        const read = micPlan();
        if (!read) return;

        const before = this.plan;
        const sameProcessing = read.echoCancellation === before.echoCancellation
            && read.noiseSuppression === before.noiseSuppression
            && read.autoGainControl === before.autoGainControl;

        if (read.discordDeviceId === before.discordDeviceId && sameProcessing) {
            this.plan = { ...read, deviceId: before.deviceId, matched: before.matched, openedLabel: before.openedLabel };
            return;
        }

        try {
            const { stream, plan } = await openMic(read);

            if (!stream.getAudioTracks().length) {
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            this.source.disconnect();
            this.stream.getTracks().forEach(t => t.stop());

            this.stream = stream;
            this.source = this.ctx.createMediaStreamSource(stream);
            this.source.connect(this.highpass);

            this.plan = plan;
            logger.info(`Microphone changed in Discord: ${this.describe()}`);
        } catch (e) {
            logger.warn("Could not follow the microphone Discord switched to", e);
        }
    }

    /**
     * How much louder the microphone has to be right now, in dB, because of
     * what the speakers are doing.
     *
     * Zero on headphones, where the system sound never reaches the capsule and
     * the meter it is read from is the only thing that changes. Nothing here
     * can tell the two apart, which is why the effect is capped: at worst a
     * loud game costs the quietest sentences, and no amount of game moves the
     * gate more than DUCK_MAX_DB.
     */
    private speakerDb(): number {
        const { reference, refData } = this;
        if (!reference || !refData) return 0;

        reference.getFloatTimeDomainData(refData);

        let sum = 0;
        for (let i = 0; i < refData.length; i++) sum += refData[i] * refData[i];

        const rms = Math.sqrt(sum / refData.length);
        if (rms <= 0) return 0;

        // -45 dBFS of system sound is a quiet menu and moves nothing; the scale
        // is deliberately shallow, a third of a dB per dB of game.
        const db = 20 * Math.log10(rms);

        return Math.min(DUCK_MAX_DB, Math.max(0, (db + 45) / 3));
    }

    private tick = (): void => {
        try {
            this.analyser.getFloatTimeDomainData(this.data);

            let sum = 0;
            for (let i = 0; i < this.data.length; i++) sum += this.data[i] * this.data[i];

            const rms = Math.sqrt(sum / this.data.length);
            const db = rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB;

            this.level = db;

            // Down quickly, up slowly: a room gets quiet in a moment and loud
            // for a reason, and a floor that chased the noise up would end up
            // gating out the voice that raised it.
            this.floor += (db - this.floor) * (db < this.floor ? 0.25 : 0.0025);
            this.floor = Math.min(-25, Math.max(-90, this.floor));

            const now = Date.now();
            const { threshold } = this.plan;
            const duck = this.speakerDb();
            const openAt = (threshold ?? this.floor + OPEN_MARGIN_DB) + duck;
            const closeAt = (threshold !== null ? threshold - 4 : this.floor + CLOSE_MARGIN_DB) + duck;

            if (db >= openAt || now < this.speakingUntil) this.holdUntil = now + HOLD_MS;
            else if (this.open && db >= closeAt) this.holdUntil = Math.max(this.holdUntil, now + POLL_MS * 4);

            // The mute button is a call thing (see inCall), and asking the store
            // on every poll would cost more than the gate itself does.
            if (now >= this.callAt) {
                this.call = inCall();
                this.callAt = now + 1000;
            }

            const muted = this.plan.selfMute && this.call;
            const wanted = !this.gating || (!muted && now < this.holdUntil);

            this.totalMs += POLL_MS;
            if (this.open) this.openMs += POLL_MS;

            if (wanted === this.open) return;

            this.open = wanted;
            this.gate.gain.setTargetAtTime(wanted ? 1 : 0, this.ctx.currentTime, wanted ? ATTACK_TAU : RELEASE_TAU);
        } catch (e) {
            // A dead graph must not leave a timer firing forever.
            logger.warn("The microphone gate stopped", e);
            this.stop();
        }
    };

    stop(): void {
        if (this.timer != null) clearInterval(this.timer);
        this.timer = null;

        this.unsubscribe?.();
        this.unsubscribe = null;

        try {
            this.source.disconnect();
            this.highpass.disconnect();
            this.delay.disconnect();
            this.gate.disconnect();
            this.compressor.disconnect();
            this.makeup.disconnect();
            if (this.refSource && this.reference) this.refSource.disconnect(this.reference);
        } catch { /* the context is already closed */ }

        this.stream.getTracks().forEach(t => t.stop());

        if (current === this) current = null;
    }
}

/** What the panel shows next to the microphone slider. */
export function micStatus(): MicStatus {
    if (current) return current.status;

    const plan = micPlan();

    return {
        live: false,
        gated: settings.store.micGate !== false,
        open: false,
        level: null,
        selfMute: plan?.selfMute === true && inCall(),
        device: plan?.discordDeviceName || "Discord's input device",
        mode: plan?.mode ?? "unknown"
    };
}

/** Follows that status while a panel is on screen, and stops when none is. */
export function watchMic(listener: (status: MicStatus) => void): () => void {
    watchers.add(listener);
    listener(micStatus());

    watchTimer ??= setInterval(() => {
        const status = micStatus();

        for (const watcher of watchers) {
            try {
                watcher(status);
            } catch (e) {
                logger.warn("A microphone listener threw", e);
            }
        }
    }, 250);

    return () => {
        watchers.delete(listener);

        if (watchers.size || watchTimer == null) return;

        clearInterval(watchTimer);
        watchTimer = null;
    };
}

/**
 * Everything the microphone path decided, in words.
 *
 * The toolbox entry behind this is the only way to see the half of it that is
 * invisible from the outside: which device was actually opened, whether it is
 * the one Discord is set to, and how much of the time the gate is letting the
 * room through.
 */
export async function micReport(): Promise<string> {
    if (current) return `Recording from ${current.describe()}`;

    const read = micPlan();
    if (!read) return "Discord's voice settings are not reachable from here; a clip would use the browser's default microphone.";

    // Opened for real, briefly. Nothing short of that can answer the question
    // the report exists for: the device list has no names until the microphone
    // has been granted once, so a check that only reads settings would report
    // a match that the recording then fails to make.
    const plan = await probeMic(read);
    const wanted = plan.discordDeviceName || plan.discordDeviceId || "the system default";
    const device = plan.openedLabel || wanted;

    const how = {
        id: "which Chromium can open directly",
        name: `matched by name to Discord's ${wanted}`,
        default: "which is the system default",
        none: `no match for Discord's ${wanted}, so a clip records the system default instead`
    }[plan.matched];

    const gate = settings.store.micGate === false
        ? "The gate is off: everything the microphone hears goes into the clip."
        : plan.threshold !== null
            ? `The gate follows Discord's sensitivity, ${plan.threshold} dB.`
            : "The gate follows the noise floor, as Discord's automatic sensitivity does.";

    const ptt = plan.mode === "PUSH_TO_TALK"
        ? " Discord is on push-to-talk; the key is invisible to a plugin while a game has focus, so the clip is gated on your voice instead."
        : "";

    return [
        `A clip would record ${device}, ${how}.`,
        `Processing: ${[
            plan.echoCancellation ? "echo cancellation" : "",
            plan.noiseSuppression ? "noise suppression" : "",
            plan.autoGainControl ? "auto gain" : ""
        ].filter(Boolean).join(", ") || "none"}. Input volume ${Math.round(plan.volume * 100)}%.`,
        plan.selfMute && inCall() ? "You are muted in Discord, so a clip gets no voice either." : "",
        gate + ptt
    ].filter(Boolean).join("\n");
}
