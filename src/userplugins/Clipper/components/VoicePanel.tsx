/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - one channel per person in the call
 *
 * The rows above balance whole sources; these balance the people inside the one
 * source that carries a conversation, and they are channels in the same sense:
 * a slider and a mute of their own, stored with the rest of the mixer, applied
 * to the clips saved from now on.
 *
 * What makes that possible is that the call is not only recorded as the mix
 * that reaches this machine's output. Every participant is also recorded on a
 * track of their own - by Discord's clip engine, or by `voiceRecord.ts` into
 * files beside the clip - so a level here is not a filter fighting a mix: it is
 * the level that person's own track is added back at when the clip is put
 * together, and a mute simply leaves their track out of the sum.
 *
 * This used to drive Discord's per-user volume instead, which had the price of
 * changing what you hear while you play. It no longer touches it: turning
 * somebody down for a clip and turning them down in your headphones are two
 * different wishes, and only one of them was being asked for here.
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { useEffect, useState } from "@webpack/common";

import { clampGain, type MixerLevel } from "../mixer";
import { voiceActivity, voiceParticipants, type VoicePerson } from "../voice";

/** How often the panel re-reads the channel. Cheap: a few store lookups. */
const REFRESH_MS = 2000;

/** How often the meters are read while the buffer is running. */
const METER_MS = 100;

const ROW: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8
};

const AVATAR: React.CSSProperties = {
    width: 24,
    height: 24,
    flex: "0 0 auto",
    borderRadius: "50%",
    background: "var(--background-tertiary, #1e1f22)",
    objectFit: "cover"
};

const VALUE: React.CSSProperties = {
    width: 46,
    flex: "0 0 auto",
    textAlign: "right",
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    color: "var(--text-muted, #949ba4)"
};

const UNTOUCHED: MixerLevel = { gain: 1, muted: false };

/** Green bar following how loud that person is right now. */
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

function Person({ person, level, meter, compact, onChange }: {
    person: VoicePerson;
    level: MixerLevel;
    meter: number;
    compact?: boolean;
    onChange(next: MixerLevel): void;
}) {
    // Your own voice reaches a clip through the microphone channel, which has
    // its own slider, its own gate and its own device. A second one here would
    // be a slider that moves nothing.
    const disabled = person.self;

    return (
        <div style={ROW}>
            {person.avatar
                ? <img style={AVATAR} src={person.avatar} alt="" />
                : <div style={AVATAR} />}

            <div
                style={{
                    width: compact ? 84 : 130,
                    flex: "0 0 auto",
                    fontSize: compact ? 13 : 14,
                    color: disabled ? "var(--text-muted, #949ba4)" : "var(--text-normal, #dbdee1)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                }}
                title={disabled ? `${person.name} - your own voice is the microphone channel` : person.name}
            >
                {person.name}
            </div>

            <input
                type="range"
                min={0}
                max={300}
                step={5}
                value={Math.round(level.gain * 100)}
                disabled={disabled}
                style={{ flex: 1, minWidth: 70, accentColor: "var(--brand-experiment, #5865f2)" }}
                onChange={e => onChange({ ...level, gain: clampGain(Number(e.currentTarget.value) / 100) })}
            />

            <span style={VALUE}>
                {disabled ? "-" : level.muted ? "muted" : `${Math.round(level.gain * 100)}%`}
            </span>

            {!compact && <Meter level={disabled ? 0 : meter} />}

            <Button
                size="small"
                variant={level.muted ? "primary" : "secondary"}
                disabled={disabled}
                onClick={() => onChange({ ...level, muted: !level.muted })}
            >
                {level.muted ? "Unmute" : "Mute"}
            </Button>
        </div>
    );
}

function Voices({ compact, recording, voices, onChange }: {
    compact?: boolean;
    recording?: boolean;
    voices: Record<string, MixerLevel>;
    onChange(userId: string, level: MixerLevel): void;
}) {
    const [people, setPeople] = useState<VoicePerson[]>([]);
    const [meters, setMeters] = useState<Record<string, number>>({});

    /*
     * The channel is polled rather than subscribed to.
     *
     * Two different dispatches move this list - somebody joining, somebody
     * leaving - and a two second re-read costs a handful of store lookups
     * against a list that is never longer than a voice channel.
     */
    useEffect(() => {
        let alive = true;

        const refresh = () => {
            if (!alive) return;

            const found = voiceParticipants();
            setPeople(current => (sameIds(current, found) ? current : found));
        };

        refresh();
        const timer = setInterval(refresh, REFRESH_MS);

        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, []);

    // The activity buffer only fills while something is being recorded, so the
    // ten readings a second exist only then: the rest of the time there is no
    // timer at all rather than one waking up to find nothing to show.
    useEffect(() => {
        if (!recording || !people.length) {
            setMeters(current => (Object.keys(current).length ? {} : current));
            return;
        }

        const timer = setInterval(() => {
            if (!voiceActivity.active) {
                setMeters(current => (Object.keys(current).length ? {} : current));
                return;
            }

            const next: Record<string, number> = {};
            for (const person of people) next[person.id] = voiceActivity.levelNow(person.id);

            setMeters(next);
        }, METER_MS);

        return () => clearInterval(timer);
    }, [recording, people]);

    if (!people.length) return null;

    return (
        <section style={{ marginTop: compact ? 16 : 24 }}>
            <Heading tag="h5">People in the call</Heading>

            <Paragraph style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted, #949ba4)" }}>
                {compact
                    ? "One channel per person, applied to the clips saved from now on - the clip on the timeline has its own levels in the Voices tab. Everybody is recorded on a track of their own, so a mute leaves them out of the mix rather than filtering them out of it, and your headphones are not touched."
                    : "One channel per person in the call, saved with the clip and applied when it is put back together. Everybody is recorded on a track of their own beside the clip, so turning somebody down changes the level their own recording is added back at, and muting them leaves their track out of the sum - the others carry on over the hole where they were. None of this touches what you hear while you play, and any of it can still be changed afterwards in the studio."}
            </Paragraph>

            {people.map(person => (
                <Person
                    key={person.id}
                    person={person}
                    compact={compact}
                    level={voices[person.id] ?? UNTOUCHED}
                    meter={meters[person.id] ?? 0}
                    onChange={next => onChange(person.id, next)}
                />
            ))}
        </section>
    );
}

function sameIds(a: VoicePerson[], b: VoicePerson[]): boolean {
    return a.length === b.length && a.every((person, i) => person.id === b[i].id && person.name === b[i].name);
}

/** Mounted by the mixer, so both the settings panel and the studio get it. */
export function VoicePanel({ compact, recording, voices, onChange }: {
    compact?: boolean;
    recording?: boolean;
    voices: Record<string, MixerLevel>;
    onChange(userId: string, level: MixerLevel): void;
}) {
    return (
        <ErrorBoundary message="The Clipper voice panel could not be rendered.">
            <Voices compact={compact} recording={recording} voices={voices} onChange={onChange} />
        </ErrorBoundary>
    );
}
