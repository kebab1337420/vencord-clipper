/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - sound mixer row in the plugin settings
 *
 * One slider per audio channel that goes into a clip, with a meter next to it
 * while the buffer runs. Moving a slider during a recording is applied to the
 * live graph, so the balance can be set by ear on the clip being buffered right
 * now rather than by trial and error over several takes.
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Logger } from "@utils/Logger";
import { useEffect, useState } from "@webpack/common";

import {
    clampGain,
    DEFAULT_MIXER,
    gainOf,
    listInputDevices,
    MIC_CHANNEL,
    type MixerChannel,
    type MixerConfig,
    type MixerLevel,
    newChannelId,
    readMixer,
    SYSTEM_CHANNEL,
    writeMixer
} from "../mixer";
import { recorder } from "../recorder";
import { settings } from "../settings";
import { VoicePanel } from "./VoicePanel";

const logger = new Logger("Clipper", "#f0b132");

/**
 * Anything that reaches outside the panel, with the failure kept local.
 *
 * Vencord renders every setting inside a silent error boundary, so a throw
 * anywhere in here used to remove the whole mixer from the panel without a
 * word - which is exactly how the sliders went missing. A recorder that has
 * not built its graph yet, or a machine with no audio device at all, is a
 * normal state, not a reason to hide the sliders.
 */
function guard<T>(what: string, run: () => T, fallback: T): T {
    try {
        return run();
    } catch (e) {
        logger.warn(`${what} failed`, e);
        return fallback;
    }
}

const ROW: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    flexWrap: "wrap"
};

const NAME: React.CSSProperties = {
    width: 150,
    flex: "0 0 auto",
    fontSize: 14,
    color: "var(--text-normal, #dbdee1)"
};

/** Same rows, narrow enough for the studio sidebar. */
const COMPACT_NAME: React.CSSProperties = { ...NAME, width: 96, fontSize: 13 };

const VALUE: React.CSSProperties = {
    width: 46,
    flex: "0 0 auto",
    textAlign: "right",
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    color: "var(--text-muted, #949ba4)"
};

const INPUT: React.CSSProperties = {
    padding: "6px 8px",
    border: "1px solid transparent",
    borderRadius: 4,
    background: "var(--input-background, #1e1f22)",
    color: "var(--text-normal, #dbdee1)",
    fontSize: 13,
    outline: "none"
};

/** Green bar that follows what the channel is actually sending to the encoder. */
function Meter({ level }: { level: number; }) {
    return (
        <div
            style={{
                width: 56,
                height: 6,
                flex: "0 0 auto",
                overflow: "hidden",
                borderRadius: 3,
                background: "var(--background-tertiary, #1e1f22)"
            }}
        >
            <div
                style={{
                    width: `${Math.round(Math.min(1, level) * 100)}%`,
                    height: "100%",
                    background: level > 0.9 ? "var(--status-danger, #da373c)" : "var(--green-360, #23a55a)",
                    transition: "width .1s linear"
                }}
            />
        </div>
    );
}

function Channel({ id, name, note, level, meter, compact, onChange, onRemove, children }: {
    id: string;
    name: string;
    note?: string;
    level: MixerLevel;
    meter: number;
    compact?: boolean;
    onChange(next: MixerLevel): void;
    onRemove?(): void;
    children?: React.ReactNode;
}) {
    return (
        <div style={{ marginTop: 12 }}>
            <div style={ROW}>
                <div style={compact ? COMPACT_NAME : NAME}>
                    <div>{name}</div>
                    {note && <div style={{ fontSize: 11, color: "var(--text-muted, #949ba4)" }}>{note}</div>}
                </div>

                <input
                    type="range"
                    min={0}
                    max={300}
                    step={5}
                    value={Math.round(level.gain * 100)}
                    style={{ flex: 1, accentColor: "var(--brand-experiment, #5865f2)" }}
                    onChange={e => onChange({ ...level, gain: clampGain(Number(e.currentTarget.value) / 100) })}
                />

                <span style={VALUE}>{level.muted ? "muted" : `${Math.round(level.gain * 100)}%`}</span>
                {!compact && <Meter level={meter} />}

                <Button
                    size="small"
                    variant={level.muted ? "primary" : "secondary"}
                    onClick={() => onChange({ ...level, muted: !level.muted })}
                >
                    {level.muted ? "Unmute" : "Mute"}
                </Button>

                {onRemove && (
                    <Button size="small" variant="secondary" onClick={onRemove}>
                        Remove
                    </Button>
                )}
            </div>

            {children}
            <input type="hidden" value={id} />
        </div>
    );
}

function Mixer({ compact }: { compact?: boolean; }) {
    const includeMic = settings.use(["includeMic"])?.includeMic ?? false;
    const [mixer, setMixer] = useState<MixerConfig>(() => guard("Reading the mixer", readMixer, DEFAULT_MIXER));
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [levels, setLevels] = useState<Record<string, number>>({});
    const [recording, setRecording] = useState(() => guard("Reading the recorder state", () => recorder.isRecording, false));

    useEffect(() => {
        const refresh = () => void listInputDevices().then(setDevices);
        refresh();

        // A cable plugged in after the panel was opened should show up too.
        const media = navigator.mediaDevices as MediaDevices | undefined;
        if (!media?.addEventListener) return;

        media.addEventListener("devicechange", refresh);

        return () => media.removeEventListener("devicechange", refresh);
    }, []);

    useEffect(() => guard(
        "Watching the recorder",
        () => recorder.subscribe(() => setRecording(recorder.isRecording)),
        () => void 0
    ), []);

    // The meters only exist while something is being recorded, and polling them
    // costs a loop over 256 samples per channel, so the timer only runs then.
    useEffect(() => {
        if (!recording) {
            setLevels({});
            return;
        }

        const timer = setInterval(() => {
            const next = guard("Reading the meters", () => {
                const levels: Record<string, number> = {};
                for (const id of recorder.audioChannels) levels[id] = recorder.channelLevel(id);

                return levels;
            }, {} as Record<string, number>);

            setLevels(next);
        }, 100);

        return () => clearInterval(timer);
    }, [recording]);

    /** Stores the mixer and pushes the change into a running recording. */
    const apply = (next: MixerConfig, touched?: string) => {
        setMixer(next);
        guard("Saving the mixer", () => writeMixer(next), undefined);

        if (!touched) return;

        guard("Applying the level to the recording", () => {
            if (touched === SYSTEM_CHANNEL) recorder.setChannelLevel(SYSTEM_CHANNEL, next.system);
            else if (touched === MIC_CHANNEL) recorder.setChannelLevel(MIC_CHANNEL, next.mic);
            else {
                const extra = next.extras.find(e => e.id === touched);
                if (extra) recorder.setChannelLevel(extra.id, extra);
            }
        }, undefined);
    };

    const patchExtra = (id: string, patch: Partial<MixerChannel>) => {
        apply({ ...mixer, extras: mixer.extras.map(e => e.id === id ? { ...e, ...patch } : e) }, id);
    };

    const addExtra = () => {
        // The first device nothing else is pointing at, so two clicks do not add
        // the same input twice.
        const used = new Set(mixer.extras.map(e => e.deviceId));
        const free = devices.find(d => !used.has(d.deviceId)) ?? devices[0];

        if (!free) return;

        const extra: MixerChannel = {
            id: newChannelId(),
            label: free.label || "Extra input",
            deviceId: free.deviceId,
            gain: 1,
            muted: false
        };

        apply({ ...mixer, extras: [...mixer.extras, extra] });
    };

    return (
        <section style={{ marginBottom: 20 }}>
            <Heading tag="h5">Sound mixer</Heading>

            <Paragraph style={{ marginTop: 6, fontSize: compact ? 12 : undefined, color: "var(--text-muted, #949ba4)" }}>
                {compact
                    ? "Levels the buffer records with. They apply to the clips saved from now on, not to what is already on the timeline - a segment's own volume is in the Segment tab."
                    : "Balance of what goes into a clip. Sliders take effect immediately, so they can be set while the buffer is running. Windows hands out the captured source's sound as one stream, so the game, the people talking and the music arrive already mixed together: to give one of them its own slider, send that app to a virtual cable (VB-CABLE, Voicemeeter) and add the cable below as its own channel."}
            </Paragraph>

            <Channel
                id={SYSTEM_CHANNEL}
                name="System sound"
                note="Game, voice chat, music"
                compact={compact}
                level={mixer.system}
                meter={levels[SYSTEM_CHANNEL] ?? 0}
                onChange={next => apply({ ...mixer, system: next }, SYSTEM_CHANNEL)}
            />

            <Channel
                id={MIC_CHANNEL}
                name="Microphone"
                note={includeMic ? "Discord's input device" : "Microphone turned off in the settings"}
                compact={compact}
                level={mixer.mic}
                meter={levels[MIC_CHANNEL] ?? 0}
                onChange={next => apply({ ...mixer, mic: next }, MIC_CHANNEL)}
            />

            {mixer.extras.map(extra => (
                <Channel
                    key={extra.id}
                    id={extra.id}
                    name={extra.label}
                    note={devices.find(d => d.deviceId === extra.deviceId)?.label || "Device not found"}
                    compact={compact}
                    level={extra}
                    meter={levels[extra.id] ?? 0}
                    onChange={next => patchExtra(extra.id, next)}
                    onRemove={() => apply({ ...mixer, extras: mixer.extras.filter(e => e.id !== extra.id) })}
                >
                    <div style={{ ...ROW, marginTop: 4 }}>
                        <input
                            value={extra.label}
                            placeholder="Name shown on the slider"
                            style={{ ...INPUT, width: compact ? 96 : 150, flex: "0 0 auto" }}
                            onChange={e => patchExtra(extra.id, { label: e.currentTarget.value })}
                        />

                        <select
                            value={extra.deviceId}
                            style={{ ...INPUT, flex: 1, cursor: "pointer" }}
                            onChange={e => patchExtra(extra.id, { deviceId: e.currentTarget.value })}
                        >
                            {!devices.some(d => d.deviceId === extra.deviceId) && (
                                <option value={extra.deviceId}>Unavailable device</option>
                            )}
                            {devices.map(d => (
                                <option key={d.deviceId} value={d.deviceId}>
                                    {d.label || `Input ${d.deviceId.slice(0, 6)}`}
                                </option>
                            ))}
                        </select>
                    </div>
                </Channel>
            ))}

            <div style={{ ...ROW, marginTop: 12 }}>
                <Button variant="secondary" disabled={!devices.length} onClick={addExtra}>
                    Add an audio source
                </Button>

                <Paragraph style={{ margin: 0, fontSize: 12, color: "var(--text-muted, #949ba4)" }}>
                    {recording
                        ? "The buffer is running: the sliders are applied live, but a source added or removed only joins the mix on the next capture."
                        : "Changes apply to the next capture."}
                </Paragraph>
            </div>

            {mixer.extras.some(e => gainOf(e) === 0) && (
                <Paragraph style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted, #949ba4)" }}>
                    A channel left at 0 still opens its device; remove it instead to leave the device alone.
                </Paragraph>
            )}

            {/* Draws nothing outside a call, so it costs an empty list check. */}
            <VoicePanel compact={compact} />
        </section>
    );
}

/**
 * What the settings panel mounts.
 *
 * The boundary is the point: the panel's own one is silent, this one puts the
 * error on screen instead of leaving an empty gap where the sliders should be.
 */
export function AudioMixerInput({ compact }: { compact?: boolean; } = {}) {
    return (
        <ErrorBoundary message="The Clipper sound mixer could not be rendered.">
            <Mixer compact={compact} />
        </ErrorBoundary>
    );
}

/**
 * The settings panel's entry point.
 *
 * Vencord hands a setting component its own props, which do not match the
 * mixer's, so the panel gets a wrapper rather than the mixer itself. A named
 * one, not an inline arrow: an arrow would be a new component type on every
 * render of the panel and would remount the mixer, losing whatever was being
 * typed in a channel's name.
 */
export function AudioMixerSetting() {
    return <AudioMixerInput />;
}
