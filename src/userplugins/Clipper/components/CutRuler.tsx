/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the cut ruler
 *
 * One bar holding the whole montage, drawn against project time rather than
 * against the file under the playhead. Drag across it to mark a range, drag
 * either edge of that range to adjust it, click anywhere to put the playhead
 * there.
 *
 * It exists because a cut is a statement about the montage and the rest of the
 * editor is a statement about one segment: taking a dead minute out used to mean
 * splitting twice by eye and deleting what fell between, with nothing on screen
 * saying where the two seams were. Here the range is the thing being dragged and
 * the cut is one button.
 */

import { useEffect, useRef, useState } from "@webpack/common";

import { type Segment, segmentLength } from "../studio";
import { formatTime } from "../utils";

/** Pixels of grab area on either edge of the marked range. */
const HANDLE = 7;

/** Pixels of movement below which a press is a click, not a drag. */
const SLOP = 4;

export interface CutMark {
    from: number;
    to: number;
}

type Drag =
    | { kind: "range"; anchor: number; moved: boolean; }
    | { kind: "start"; }
    | { kind: "end"; };

interface Props {
    segments: Segment[];
    /** Source name per segment id, for the tooltip on each block. */
    names: Map<string, string>;
    /** Length of the montage, in seconds. */
    length: number;
    /** Playhead in project time. */
    playhead: number;
    mark: CutMark | null;
    selected: string;
    disabled: boolean;
    onMark(mark: CutMark | null): void;
    onSeek(at: number): void;
    onSelect(id: string): void;
}

export function CutRuler({ segments, names, length, playhead, mark, selected, disabled, onMark, onSeek, onSelect }: Props) {
    const laneRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<Drag | null>(null);

    // An empty montage still has a width, and dividing by it must not produce
    // an infinity that lands every block at the same place.
    const span = Math.max(0.5, length);

    /** Project time under a pointer, clamped to the montage. */
    const timeAt = (clientX: number): number => {
        const box = laneRef.current?.getBoundingClientRect();
        if (!box?.width) return 0;

        return Math.max(0, Math.min(span, ((clientX - box.left) / box.width) * span));
    };

    /*
     * The drag runs on the window rather than on the lane: a range is marked by
     * sweeping across it, and a sweep that leaves the bar - which is what
     * marking to the very end looks like - must not drop the gesture.
     */
    useEffect(() => {
        if (!drag) return;

        const move = (e: MouseEvent) => {
            const at = timeAt(e.clientX);

            if (drag.kind === "range") {
                if (!drag.moved && Math.abs(at - drag.anchor) * (laneRef.current?.clientWidth ?? 1) / span < SLOP) return;

                setDrag({ ...drag, moved: true });
                onMark({ from: Math.min(drag.anchor, at), to: Math.max(drag.anchor, at) });
                return;
            }

            if (!mark) return;

            if (drag.kind === "start") onMark({ from: Math.min(at, mark.to - 0.05), to: mark.to });
            else onMark({ from: mark.from, to: Math.max(at, mark.from + 0.05) });
        };

        const up = (e: MouseEvent) => {
            // A press that never moved is a seek. Marking and seeking share the
            // same gesture because the playhead is where a cut is judged from.
            if (drag.kind === "range" && !drag.moved) {
                onMark(null);
                onSeek(timeAt(e.clientX));
            }

            setDrag(null);
        };

        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);

        return () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
    }, [drag, mark, span]);

    const grab = (e: React.MouseEvent) => {
        if (disabled) return;

        e.preventDefault();

        const at = timeAt(e.clientX);

        // An edge of the existing range wins over starting a new one, so a range
        // can be nudged instead of being swept again from scratch.
        if (mark) {
            const box = laneRef.current?.getBoundingClientRect();
            const perSecond = (box?.width ?? 0) / span;

            if (Math.abs(at - mark.from) * perSecond <= HANDLE) return setDrag({ kind: "start" });
            if (Math.abs(at - mark.to) * perSecond <= HANDLE) return setDrag({ kind: "end" });
        }

        setDrag({ kind: "range", anchor: at, moved: false });
    };

    let elapsed = 0;
    const blocks = segments.map(s => {
        const at = elapsed;
        elapsed += segmentLength(s);

        return { segment: s, at, length: segmentLength(s) };
    });

    return (
        <div className="vc-clipper-ruler-wrap">
            <div className="vc-clipper-ruler" ref={laneRef} onMouseDown={grab}>
                {blocks.map(({ segment, at, length: width }) => (
                    <div
                        key={segment.id}
                        className={`vc-clipper-ruler-block${segment.id === selected ? " vc-clipper-active" : ""}`}
                        style={{ left: `${(at / span) * 100}%`, width: `${Math.max(0.4, (width / span) * 100)}%` }}
                        title={`${names.get(segment.id) ?? "?"} - ${formatTime(width)}`}
                        onMouseDown={() => {
                            // Selecting on the press rather than on a click: the
                            // press is already the start of a sweep, and a range
                            // is nearly always marked inside the segment it is
                            // being taken out of.
                            if (!disabled) onSelect(segment.id);
                        }}
                    />
                ))}

                {mark && mark.to - mark.from > 0 && (
                    <div
                        className="vc-clipper-ruler-mark"
                        style={{ left: `${(mark.from / span) * 100}%`, width: `${Math.max(0.3, ((mark.to - mark.from) / span) * 100)}%` }}
                    >
                        <span className="vc-clipper-ruler-grip" />
                        <span className="vc-clipper-ruler-grip vc-clipper-ruler-grip-end" />
                    </div>
                )}

                <div className="vc-clipper-ruler-head" style={{ left: `${(Math.max(0, Math.min(span, playhead)) / span) * 100}%` }} />
            </div>
        </div>
    );
}
