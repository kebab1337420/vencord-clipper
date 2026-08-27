/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - watching the buffer before writing it
 *
 * A rolling buffer is saved on a keypress, which means its length is guessed
 * from memory: the play was either ten seconds ago or forty, the key gets
 * pressed, and what comes out is trimmed afterwards or not at all. This is the
 * buffer itself, playable, before anything is written - scrub back to the
 * moment, put the two handles around it, and what gets written is that window
 * rather than a guess.
 *
 * The footage is the same assembly a save makes, so what is watched here is
 * exactly what would land on disk. The cut is at chunk boundaries, a second
 * apart, because that is where the container can be cut without re-encoding.
 */

import { useEffect, useRef, useState } from "@webpack/common";

import { type BufferPreview as Buffered, recorder } from "../recorder";
import { formatTime } from "../utils";
import { useDragWindow } from "./dragWindow";

/** Nothing shorter than this can be saved, so the handles never cross. */
const MIN_SPAN = 1;

type Handle = "from" | "to";

export function BufferPreview({ onClose }: { onClose(): void; }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const barRef = useRef<HTMLDivElement>(null);

    const [buffered, setBuffered] = useState<Buffered | null>(null);
    const [error, setError] = useState("");
    const [url, setUrl] = useState("");

    const [span, setSpan] = useState(0);
    const [at, setAt] = useState(0);
    const [from, setFrom] = useState(0);
    const [to, setTo] = useState(0);
    const [drag, setDrag] = useState<Handle | null>(null);

    // Built once, on open: it is a copy of the whole buffer, and rebuilding it
    // as the buffer rolls would mean re-reading tens of megabytes every second
    // underneath somebody trying to watch it.
    useEffect(() => {
        let alive = true;
        let made = "";

        void (async () => {
            try {
                const preview = await recorder.preview();
                if (!alive) return;

                if (!preview) {
                    setError("Nothing buffered yet - start the buffer and give it a second.");
                    return;
                }

                made = URL.createObjectURL(preview.blob);

                setBuffered(preview);
                setUrl(made);
            } catch (e) {
                if (alive) setError(e instanceof Error ? e.message : String(e));
            }
        })();

        return () => {
            alive = false;
            if (made) URL.revokeObjectURL(made);
        };
    }, []);

    /** Position under a pointer, in seconds of the preview. */
    const timeAt = (clientX: number): number => {
        const box = barRef.current?.getBoundingClientRect();
        if (!box?.width || !span) return 0;

        return Math.max(0, Math.min(span, ((clientX - box.left) / box.width) * span));
    };

    useDragWindow(drag && {
        move: (e: MouseEvent) => {
            const value = timeAt(e.clientX);

            if (drag === "from") setFrom(Math.min(value, to - MIN_SPAN));
            else setTo(Math.max(value, from + MIN_SPAN));
        },
        up: () => setDrag(null)
    }, [drag, from, to, span]);

    const seek = (seconds: number) => {
        const video = videoRef.current;
        if (!video) return;

        video.currentTime = Math.max(0, Math.min(span, seconds));
        setAt(video.currentTime);
    };

    const save = () => {
        if (!buffered) return;

        // Back into wall-clock, which is what the buffer is indexed by.
        void recorder.save(undefined, {
            from: buffered.start + from * 1000,
            to: buffered.start + to * 1000
        });

        onClose();
    };

    const percent = (seconds: number) => (span ? (seconds / span) * 100 : 0);

    return (
        <div className="vc-clipper-backdrop" onClick={onClose}>
            <div className="vc-clipper-modal vc-clipper-preview" onClick={e => e.stopPropagation()}>
                <div className="vc-clipper-head">
                    <div>
                        <h2>What is in the buffer</h2>
                        <p>Watch it, put the handles around the bit worth keeping, and save that.</p>
                    </div>
                    <button className="vc-clipper-close" onClick={onClose} aria-label="Close">&times;</button>
                </div>

                <div className="vc-clipper-body">
                    {error && <div className="vc-clipper-note vc-clipper-error">{error}</div>}
                    {!error && !url && <div className="vc-clipper-note">Reading the buffer…</div>}

                    {url && (
                        <>
                            <video
                                ref={videoRef}
                                className="vc-clipper-preview-video"
                                src={url}
                                controls
                                autoPlay
                                onLoadedMetadata={e => {
                                    /*
                                     * Wall-clock first, the container second.
                                     *
                                     * The handles are read back as an offset
                                     * from `buffered.start`, so the scale they
                                     * are drawn on has to be the one the save
                                     * cuts by. A rebased fragment stream also
                                     * reports an infinite duration until it has
                                     * been seeked, which is the other half of
                                     * why the container is not the authority.
                                     */
                                    const video = e.currentTarget;
                                    const wall = buffered ? (buffered.end - buffered.start) / 1000 : 0;
                                    const length = wall || (Number.isFinite(video.duration) ? video.duration : 0);

                                    setSpan(length);
                                    setFrom(0);
                                    setTo(length);
                                }}
                                onTimeUpdate={e => setAt(e.currentTarget.currentTime)}
                            />

                            <div
                                ref={barRef}
                                className="vc-clipper-scrub"
                                onMouseDown={e => seek(timeAt(e.clientX))}
                            >
                                <div
                                    className="vc-clipper-range"
                                    style={{ left: `${percent(from)}%`, width: `${percent(to - from)}%` }}
                                />

                                {buffered?.marks.map((mark, i) => (
                                    <div
                                        key={`${mark}-${i}`}
                                        className="vc-clipper-tick"
                                        style={{ left: `${percent(mark)}%` }}
                                        title={`Marker at ${formatTime(mark)}`}
                                    />
                                ))}

                                <div className="vc-clipper-playhead" style={{ left: `${percent(at)}%` }} />

                                <div
                                    className="vc-clipper-handle"
                                    style={{ left: `${percent(from)}%` }}
                                    onMouseDown={e => { e.stopPropagation(); setDrag("from"); }}
                                />
                                <div
                                    className="vc-clipper-handle"
                                    style={{ left: `${percent(to)}%` }}
                                    onMouseDown={e => { e.stopPropagation(); setDrag("to"); }}
                                />
                            </div>

                            <div className="vc-clipper-preview-actions">
                                <button onClick={() => setFrom(Math.min(at, to - MIN_SPAN))}>Start here</button>
                                <button onClick={() => setTo(Math.max(at, from + MIN_SPAN))}>End here</button>
                                <button onClick={() => { setFrom(0); setTo(span); }}>Whole buffer</button>
                                <span>
                                    {formatTime(from)} - {formatTime(to)} ({Math.max(1, Math.round(to - from))}s)
                                </span>
                            </div>
                        </>
                    )}
                </div>

                <div className="vc-clipper-foot">
                    <span>The buffer keeps rolling while this is open - this is a copy of it.</span>
                    <button onClick={onClose}>Cancel</button>
                    <button disabled={!url} onClick={save}>Save this bit</button>
                </div>
            </div>
        </div>
    );
}
