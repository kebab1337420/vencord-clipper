/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the sound lane
 *
 * One row per sound laid over the montage, drawn against project time: drag a
 * block to move it, drag either edge to trim it, and the waveform underneath
 * says where the drop lands without playing anything.
 *
 * The waveform is the decoded file's own peak envelope, so trimming a block
 * shows the part of the wave it keeps rather than a rescaled version of the
 * whole file. That is the difference between placing a sting by ear and placing
 * it by eye, which is the whole point of a lane.
 */

import { useRef, useState } from "@webpack/common";

import { type AudioClip, type AudioSource, clipLengthOf, PEAKS } from "../audio";
import { formatTime } from "../utils";
import { useDragWindow } from "./dragWindow";

/** Height of the drawn wave, in the SVG's own units. */
const WAVE = 28;

/** Pixels of grab area on either edge of a block, for trimming. */
const HANDLE = 7;

type Drag =
    | { kind: "move"; id: string; grabbedAt: number; startedFrom: number; }
    | { kind: "start"; id: string; grabbedAt: number; startedFrom: number; startedAt: number; }
    | { kind: "end"; id: string; grabbedAt: number; startedTo: number; };

/**
 * The slice of a source's envelope a clip keeps, as SVG points.
 *
 * Reduced again to the block's own width rather than drawn at full resolution:
 * a two second block on a three minute track would otherwise carry six hundred
 * bars into two hundred pixels.
 */
function slice(source: AudioSource, from: number, to: number, bars: number): number[] {
    const span = Math.max(0.01, source.duration);
    const first = Math.max(0, Math.min(PEAKS - 1, Math.floor((from / span) * PEAKS)));
    const last = Math.max(first + 1, Math.min(PEAKS, Math.ceil((to / span) * PEAKS)));

    const per = (last - first) / bars;
    const out: number[] = [];

    for (let i = 0; i < bars; i++) {
        const start = first + Math.floor(i * per);
        const end = Math.max(start + 1, first + Math.floor((i + 1) * per));

        let peak = 0;
        for (let j = start; j < end && j < PEAKS; j++) {
            if (source.peaks[j] > peak) peak = source.peaks[j];
        }

        out.push(peak);
    }

    return out;
}

function Wave({ source, from, to }: { source: AudioSource; from: number; to: number; }) {
    const bars = slice(source, from, to, 120);

    return (
        <svg className="vc-clipper-sound-wave" viewBox={`0 0 ${bars.length} ${WAVE}`} preserveAspectRatio="none">
            {bars.map((value, i) => {
                const height = Math.max(1, value * WAVE);

                return <rect key={i} x={i + 0.1} y={(WAVE - height) / 2} width={0.8} height={height} />;
            })}
        </svg>
    );
}

/**
 * Every sound on the timeline, over one shared ruler.
 *
 * `length` is the montage's own length: a block dragged past it is kept, but the
 * part beyond the last frame will not be rendered, and the lane shades that
 * region so the reason is visible rather than surprising.
 */
export function AudioTimeline({ clips, sources, length, playhead, disabled, onChange, onSelect, selected, onSeek }: {
    clips: AudioClip[];
    sources: Map<string, AudioSource>;
    length: number;
    playhead: number;
    disabled: boolean;
    selected: string;
    onChange(id: string, patch: Partial<AudioClip>, tag?: string): void;
    onSelect(id: string): void;
    onSeek(at: number): void;
}) {
    const laneRef = useRef<HTMLDivElement | null>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const span = Math.max(1, length);

    /** Project time under a pointer, in seconds. */
    const seconds = (clientX: number): number => {
        const box = laneRef.current?.getBoundingClientRect();
        if (!box?.width) return 0;

        return ((clientX - box.left) / box.width) * span;
    };

    /*
     * The drag lives on the window rather than on the block: a pointer moving
     * faster than React re-renders leaves the element behind, and a mouse
     * released outside the modal would never end the drag.
     */
    useDragWindow(drag && {
        move: (e: MouseEvent) => {
            const at = seconds(e.clientX);
            const moved = at - drag.grabbedAt;
            const clip = clips.find(c => c.id === drag.id);
            if (!clip) return;

            const source = sources.get(clip.sourceId);
            const duration = source?.duration ?? clip.to;

            if (drag.kind === "move") {
                onChange(drag.id, { at: Math.max(0, drag.startedFrom + moved) }, `move-${drag.id}`);
                return;
            }

            if (drag.kind === "start") {
                // Trimming the head moves the in point and the placement together,
                // so the rest of the sound stays where it was on the timeline.
                const from = Math.max(0, Math.min(clip.to - 0.1, drag.startedFrom + moved));
                onChange(drag.id, { from, at: Math.max(0, drag.startedAt + (from - drag.startedFrom)) }, `trim-${drag.id}`);
                return;
            }

            const to = Math.max(clip.from + 0.1, Math.min(duration, drag.startedTo + moved));
            onChange(drag.id, { to }, `trim-${drag.id}`);
        },
        up: () => setDrag(null)
    }, [drag, clips, sources, span]);

    const grab = (e: React.MouseEvent, clip: AudioClip) => {
        if (disabled) return;

        const box = laneRef.current?.getBoundingClientRect();
        const block = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (!box?.width) return;

        const at = ((e.clientX - box.left) / box.width) * span;
        const edge = e.clientX - block.left;

        onSelect(clip.id);
        e.preventDefault();

        if (edge <= HANDLE) setDrag({ kind: "start", id: clip.id, grabbedAt: at, startedFrom: clip.from, startedAt: clip.at });
        else if (block.right - e.clientX <= HANDLE) setDrag({ kind: "end", id: clip.id, grabbedAt: at, startedTo: clip.to });
        else setDrag({ kind: "move", id: clip.id, grabbedAt: at, startedFrom: clip.at });
    };

    if (!clips.length) return null;

    return (
        <div className="vc-clipper-sounds">
            <div
                className="vc-clipper-sound-lane"
                title="Drag to move, drag an edge to trim"
                ref={laneRef}
                onMouseDown={e => {
                    // A click on the empty part of the lane is a seek, which is
                    // how the playhead is put where a sound should start.
                    if (e.target !== e.currentTarget) return;

                    const box = e.currentTarget.getBoundingClientRect();
                    if (box.width) onSeek(Math.max(0, Math.min(span, ((e.clientX - box.left) / box.width) * span)));
                }}
            >
                {clips.map(clip => {
                    const source = sources.get(clip.sourceId);
                    const width = (clipLengthOf(clip) / span) * 100;

                    return (
                        <div
                            key={clip.id}
                            className={`vc-clipper-sound-block${clip.id === selected ? " vc-clipper-active" : ""}${clip.muted ? " vc-clipper-muted" : ""}`}
                            style={{ left: `${(clip.at / span) * 100}%`, width: `${Math.max(1.5, width)}%` }}
                            title={`${source?.name ?? "missing sound"} - ${formatTime(clipLengthOf(clip))}`}
                            onMouseDown={e => grab(e, clip)}
                        >
                            {source && <Wave source={source} from={clip.from} to={clip.to} />}
                            <span className="vc-clipper-sound-name">{source?.name ?? "missing sound"}</span>
                        </div>
                    );
                })}

                <div className="vc-clipper-sound-head" style={{ left: `${(Math.max(0, Math.min(span, playhead)) / span) * 100}%` }} />
            </div>
        </div>
    );
}
