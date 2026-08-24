/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - one slider per person in the call
 *
 * The mixer above this panel balances whole sources; this one balances the
 * people inside the one source that carries a conversation. It drives Discord's
 * own per-user volume, which means two things worth stating plainly: it is the
 * same level the rest of the client uses, so it stays set after the recording,
 * and it has to be set *before* the clip is saved, because the call arrives at
 * this client already mixed and nothing can pull it apart afterwards.
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { useEffect, useState } from "@webpack/common";

import { localMuted, localVolume, setLocalMuted, setLocalVolume, voiceParticipants,type VoicePerson } from "../voice";

/** How often the panel re-reads the channel. Cheap: a few store lookups. */
const REFRESH_MS = 2000;

interface Level {
    volume: number;
    muted: boolean;
}

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
    width: 42,
    flex: "0 0 auto",
    textAlign: "right",
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    color: "var(--text-muted, #949ba4)"
};

function Person({ person, level, compact, onChange }: {
    person: VoicePerson;
    level: Level;
    compact?: boolean;
    onChange(next: Level): void;
}) {
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
                title={disabled ? `${person.name} - your own voice comes from the microphone channel` : person.name}
            >
                {person.name}
            </div>

            <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={level.muted ? 0 : level.volume}
                disabled={disabled}
                style={{ flex: 1, minWidth: 70 }}
                onChange={e => onChange({ volume: Number(e.currentTarget.value), muted: false })}
            />

            <span style={VALUE}>{disabled ? "-" : `${level.muted ? 0 : level.volume}%`}</span>

            <button
                type="button"
                disabled={disabled}
                title={level.muted ? "Let them back into the clip" : "Keep them out of the clip"}
                style={{
                    padding: "3px 8px",
                    border: "none",
                    borderRadius: 4,
                    background: level.muted ? "var(--status-danger, #da373c)" : "var(--button-secondary-background, #4e5058)",
                    color: "#fff",
                    fontSize: 12,
                    cursor: disabled ? "default" : "pointer",
                    opacity: disabled ? 0.5 : 1
                }}
                onClick={() => onChange({ ...level, muted: !level.muted })}
            >
                {level.muted ? "Muted" : "Mute"}
            </button>
        </div>
    );
}

function Voices({ compact }: { compact?: boolean; }) {
    const [people, setPeople] = useState<VoicePerson[]>([]);
    const [levels, setLevels] = useState<Record<string, Level>>({});

    /*
     * The channel is polled rather than subscribed to.
     *
     * Three different dispatches move this panel - someone joining, someone
     * being muted somewhere else, a volume changed from their right-click menu -
     * and a two second re-read costs a handful of store lookups against a list
     * that is never longer than a voice channel.
     */
    useEffect(() => {
        let alive = true;

        const refresh = () => {
            if (!alive) return;

            const found = voiceParticipants();
            setPeople(current => (sameIds(current, found) ? current : found));

            const next: Record<string, Level> = {};
            for (const person of found) next[person.id] = { volume: localVolume(person.id), muted: localMuted(person.id) };
            setLevels(next);
        };

        refresh();
        const timer = setInterval(refresh, REFRESH_MS);

        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, []);

    const apply = (id: string, next: Level) => {
        // Written to the state first: the poll below would otherwise snap the
        // slider back to the old value between the change and the next read.
        setLevels(current => ({ ...current, [id]: next }));

        setLocalMuted(id, next.muted);
        if (!next.muted) setLocalVolume(id, next.volume);
    };

    if (!people.length) return null;

    return (
        <section style={{ marginTop: compact ? 16 : 24 }}>
            <Heading tag="h5">People in the call</Heading>

            <Paragraph style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted, #949ba4)" }}>
                {compact
                    ? "Their level in this client, and so in the clips saved from now on. The call arrives already mixed, so this cannot be changed afterwards."
                    : "Each person's level in this client, which is the level they are recorded at. Discord mixes the call before it reaches the browser, so nobody can be turned down after the fact - set them here while the buffer runs. These are the same volumes as the right-click menu, and they stay set."}
            </Paragraph>

            {people.map(person => (
                <Person
                    key={person.id}
                    person={person}
                    compact={compact}
                    level={levels[person.id] ?? { volume: 100, muted: false }}
                    onChange={next => apply(person.id, next)}
                />
            ))}
        </section>
    );
}

function sameIds(a: VoicePerson[], b: VoicePerson[]): boolean {
    return a.length === b.length && a.every((person, i) => person.id === b[i].id && person.name === b[i].name);
}

/** Mounted by the mixer, so both the settings panel and the studio get it. */
export function VoicePanel({ compact }: { compact?: boolean; } = {}) {
    return (
        <ErrorBoundary message="The Clipper voice panel could not be rendered.">
            <Voices compact={compact} />
        </ErrorBoundary>
    );
}
