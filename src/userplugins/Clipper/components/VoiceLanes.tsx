/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - who was talking, drawn under the timeline
 *
 * One lane per person, over the length of the clip they were recorded in. Not
 * audio: the call reaches this client already mixed, so what a lane draws is
 * the activity Discord reported for that person while the buffer was running.
 * It is the fastest way to find the moment someone called something out -
 * click the lane and the playhead goes there.
 */

import { VOICE_HZ, type VoiceTrack } from "../voice";

/** Bars per lane. Enough to read a sentence apart from a pause. */
const BINS = 240;

/** Drawn height of a lane, in the SVG's own units. */
const HEIGHT = 20;

/**
 * The samples reduced to a fixed number of bars.
 *
 * The peak of each bin rather than its average: a lane is read for "did they
 * say something here", and averaging a short word into a long bin buries it.
 */
function bins(levels: Uint8Array): number[] {
    if (!levels.length) return [];

    const out: number[] = [];
    const per = levels.length / BINS;

    for (let i = 0; i < BINS; i++) {
        const from = Math.floor(i * per);
        const to = Math.max(from + 1, Math.floor((i + 1) * per));

        let peak = 0;
        for (let j = from; j < to && j < levels.length; j++) {
            if (levels[j] > peak) peak = levels[j];
        }

        out.push(peak);
    }

    return out;
}

function Lane({ track, length, current, from, to, onSeek }: {
    track: VoiceTrack;
    length: number;
    current: number;
    from: number;
    to: number;
    onSeek(at: number): void;
}) {
    const bars = bins(track.levels);
    const span = Math.max(0.1, length);

    const pick = (e: React.MouseEvent<HTMLDivElement>) => {
        const box = e.currentTarget.getBoundingClientRect();
        if (!box.width) return;

        onSeek(Math.max(0, Math.min(span, ((e.clientX - box.left) / box.width) * span)));
    };

    return (
        <div className="vc-clipper-lane">
            <div className="vc-clipper-lane-name" title={track.name}>{track.name}</div>

            <div className="vc-clipper-lane-track" title="Click to jump there" onClick={pick}>
                {/* The part of the source the segment actually keeps. */}
                <div
                    className="vc-clipper-lane-kept"
                    style={{
                        left: `${(Math.max(0, from) / span) * 100}%`,
                        width: `${(Math.max(0, Math.min(span, to) - Math.max(0, from)) / span) * 100}%`
                    }}
                />

                <svg viewBox={`0 0 ${BINS} ${HEIGHT}`} preserveAspectRatio="none">
                    {bars.map((value, i) => {
                        const height = Math.max(1, (value / 255) * HEIGHT);

                        return (
                            <rect
                                key={i}
                                x={i + 0.15}
                                y={(HEIGHT - height) / 2}
                                width={0.7}
                                height={height}
                            />
                        );
                    })}
                </svg>

                <div className="vc-clipper-lane-head" style={{ left: `${(Math.max(0, current) / span) * 100}%` }} />
            </div>
        </div>
    );
}

/**
 * Every lane for one clip.
 *
 * `length` is the clip's own length, which the lanes are measured against; a
 * track that was cut short by the repair simply stops before the end rather
 * than being stretched to fit.
 */
export function VoiceLanes({ tracks, length, current, from, to, onSeek }: {
    tracks: VoiceTrack[];
    length: number;
    current: number;
    from: number;
    to: number;
    onSeek(at: number): void;
}) {
    if (!tracks.length) return null;

    return (
        <div className="vc-clipper-lanes">
            {tracks.map(track => (
                <Lane
                    key={track.id}
                    track={track}
                    length={length || track.levels.length / VOICE_HZ}
                    current={current}
                    from={from}
                    to={to}
                    onSeek={onSeek}
                />
            ))}
        </div>
    );
}
