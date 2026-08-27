/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - one rolling buffer per person in the call
 *
 * The clip's own soundtrack is whole-machine loopback: by the time it reaches
 * this plugin every voice in the call is already mixed into it, and no filter
 * takes one person back out of a mix. Everything the studio's mute has tried so
 * far has been an approximation of subtraction, and an approximation is what
 * kept being audible.
 *
 * So the voices are not subtracted, they are kept apart from the start. Each
 * remote audio receiver the client opens is tapped (`voiceTaps.ts`) and given a
 * buffer of its own here, running in step with the main one and trimmed to the
 * same window. On save each of those becomes a file next to the clip, and the
 * studio then has the call as a set of separate tracks: muting somebody is not
 * connecting theirs, which cannot leak because their audio was never in the
 * others to begin with.
 *
 * What remains is their copy inside the loopback bed, which the notch in
 * `voiceBand.ts` still deals with - but only for that one bed, and only while
 * the muted person actually speaks.
 */

import { Logger } from "@utils/Logger";

import { lengthBytes, repairBytes } from "./repair";
import { settings } from "./settings";
import { type VoiceTap, voiceTaps } from "./voiceTaps";

const logger = new Logger("Clipper", "#f0b132");

/** Same as the main buffer's, so both sides cut on the same boundaries. */
const TIMESLICE = 1000;

/** How often to look for a receiver that has opened since the last look. */
const SCAN_MS = 2000;

/**
 * How long to wait for a flush before giving up on it.
 *
 * A lane whose track has already died never answers `requestData`, and a save
 * must not hang on it: what it costs is the last second of that one person.
 */
const FLUSH_MS = 700;

const MIMES = ["audio/webm;codecs=opus", "audio/webm"];

/** The lane id of the microphone, which is not one of the receivers. */
const SELF_ID = "tap-self";

interface Chunk {
    blob: Blob;
    /** Timestamp (ms) the chunk was handed over, i.e. where its audio ends. */
    at: number;
}

interface Lane {
    tap: VoiceTap;
    /**
     * Whether the sweep may close this lane.
     *
     * The microphone is not a receiver and will never be in `voiceTaps()`, so
     * the sweep would close it on its first pass. It is closed with the buffer
     * instead, like the stream it records.
     */
    pinned: boolean;
    recorder: MediaRecorder;
    mimeType: string;
    /** First chunk, carrying the EBML header: useless alone, needed by all. */
    header: Blob | null;
    chunks: Chunk[];
    /** Resolver for a flush in flight. */
    next: (() => void) | null;
}

/** One person's own audio, cut to the saved window. */
interface VoiceLaneClip {
    userId: string;
    name: string;
    blob: Blob;
    mimeType: string;
    /**
     * Seconds between the start of the clip and the start of this audio.
     *
     * Signed. A lane can only start on one of its own chunk boundaries, which
     * are not the clip's, so it is normally a fraction of a second either way -
     * negative when the lane's first kept chunk began before the clip did. The
     * studio plays the lane at `clipTime - offset`, so it lines up whichever
     * side of zero this lands on.
     */
    offset: number;
}

function mimeType(): string | null {
    for (const mime of MIMES) {
        try {
            if (MediaRecorder.isTypeSupported(mime)) return mime;
        } catch {
            // Some builds throw on an unknown codec string rather than say no.
        }
    }

    return null;
}

class VoiceBuffers {
    private lanes = new Map<string, Lane>();
    private scanner: ReturnType<typeof setInterval> | null = null;
    private running = false;

    /** Whether anything is being kept per person right now. */
    get active(): boolean {
        return this.running;
    }

    /** How many people are being recorded on a track of their own. */
    get count(): number {
        return this.lanes.size;
    }

    /**
     * Starts a buffer for every receiver that is open, and for every one that
     * opens later: people join a call after the buffer is armed, and a lane that
     * only exists from the moment somebody was noticed is a lane missing from
     * the clip they are in.
     */
    start(): void {
        if (this.running) return;

        this.running = true;
        this.sweep();

        this.scanner = setInterval(() => this.sweep(), SCAN_MS);
    }

    stop(): void {
        this.running = false;

        if (this.scanner) clearInterval(this.scanner);
        this.scanner = null;

        for (const id of [...this.lanes.keys()]) this.close(id);
    }

    /** Opens what is missing, closes what has died. */
    private sweep(): void {
        if (!this.running) return;

        const open = new Set<string>();

        for (const tap of voiceTaps()) {
            open.add(tap.id);
            if (!this.lanes.has(tap.id)) this.open(tap);
        }

        for (const [id, lane] of this.lanes) {
            if (lane.pinned) continue;
            if (!open.has(id) || lane.tap.track.readyState === "ended") this.close(id);
        }

        for (const lane of this.lanes.values()) this.prune(lane);
    }

    /**
     * Records a stream that is not a receiver, under a name of its own.
     *
     * The one caller is the microphone. Without it the person holding the mouse
     * is the only one in the call who cannot be brought back while somebody
     * else is muted: their voice reaches the clip through the mixer rather than
     * through a peer connection, so it is in the bed and nowhere else, and the
     * notch that removes the muted person removes them with it.
     */
    attach(stream: MediaStream, userId: string, name: string): void {
        if (!this.running || !userId) return;

        const track = stream.getAudioTracks()[0];
        if (!track || this.lanes.has(SELF_ID)) return;

        this.open({ id: SELF_ID, userId, name, stream, track, confidence: 1 }, true);
    }

    private open(tap: VoiceTap, pinned = false): void {
        const mime = mimeType();
        if (!mime) return;

        try {
            const recorder = new MediaRecorder(tap.stream, {
                mimeType: mime,
                audioBitsPerSecond: 96_000
            });

            const lane: Lane = { tap, pinned, recorder, mimeType: mime, header: null, chunks: [], next: null };

            recorder.ondataavailable = e => this.onChunk(lane, e.data);
            recorder.onerror = e => {
                logger.warn(`The voice buffer for ${tap.name || tap.id} failed`, e);
                this.close(tap.id);
            };

            recorder.start(TIMESLICE);
            this.lanes.set(tap.id, lane);

            logger.info(`Voice buffer opened for ${tap.name || tap.id} (${this.lanes.size} running)`);
        } catch (e) {
            logger.warn("Could not open a voice buffer", e);
        }
    }

    private close(id: string): void {
        const lane = this.lanes.get(id);
        if (!lane) return;

        this.lanes.delete(id);

        // A flush waiting on this lane would otherwise wait out its timeout.
        lane.next?.();
        lane.next = null;

        try {
            if (lane.recorder.state !== "inactive") lane.recorder.stop();
        } catch (e) {
            logger.warn("Could not stop a voice buffer cleanly", e);
        }
    }

    private onChunk(lane: Lane, blob: Blob): void {
        if (blob?.size) {
            if (!lane.header) lane.header = blob;
            else lane.chunks.push({ blob, at: Date.now() });
        }

        lane.next?.();
        lane.next = null;

        this.prune(lane);
    }

    private prune(lane: Lane): void {
        const cutoff = Date.now() - (settings.store.clipLength * 1000 + TIMESLICE);
        while (lane.chunks.length && lane.chunks[0].at < cutoff) lane.chunks.shift();
    }

    /** Asks one lane for whatever it holds that has not been handed over yet. */
    private flush(lane: Lane): Promise<void> {
        if (lane.recorder.state !== "recording") return Promise.resolve();

        return new Promise<void>(resolve => {
            let done = false;
            let timer: ReturnType<typeof setTimeout> | null = null;

            const finish = () => {
                if (done) return;
                done = true;

                // Both the chunk and the deadline call this, and whichever
                // arrives first releases the other: a timer left armed keeps
                // this closure alive until it fires, and the lane keeps a
                // callback for a flush that is over.
                if (timer != null) clearTimeout(timer);
                timer = null;

                if (lane.next === finish) lane.next = null;

                resolve();
            };

            lane.next = finish;

            try {
                lane.recorder.requestData();
            } catch {
                finish();
            }

            if (!done) timer = setTimeout(finish, FLUSH_MS);
        });
    }

    /**
     * The saved window, one blob per person, for the clip that covers it.
     *
     * Anonymous lanes are dropped rather than saved under their tap id: a track
     * nobody can name is a track the studio cannot label, cannot mute by person
     * and cannot line up with the activity lanes, and it is already inside the
     * bed anyway.
     */
    async harvest(start: number, end: number): Promise<VoiceLaneClip[]> {
        const lanes = [...this.lanes.values()];
        if (!lanes.length) return [];

        await Promise.all(lanes.map(lane => this.flush(lane)));

        /*
         * Every lane at once rather than one after another.
         *
         * The rebase below is the slow part of a save, and it is per person: a
         * full call used to pay for all of them in a row while the clip waited.
         * Nothing here reads another lane, and `Promise.all` hands the results
         * back in the order they were asked for.
         */
        const harvested = await Promise.all(lanes.map(async (lane): Promise<VoiceLaneClip | null> => {
            const { userId, name } = lane.tap;
            if (!userId || !lane.header) return null;

            // A chunk covers [at - TIMESLICE, at], so it belongs to the clip if
            // that span meets the clip's own at all.
            const kept = lane.chunks.filter(c => c.at > start && c.at - TIMESLICE < end);
            if (!kept.length) return null;

            const raw = new Blob([lane.header, ...kept.map(c => c.blob)], { type: lane.mimeType });

            // Cluster timecodes are absolute, exactly as in the main buffer:
            // without a rebase the lane claims to begin where the call did and
            // every player seeks into silence.
            let blob = raw;

            /*
             * The rebase drops whatever sits before the first clean cluster, so
             * the track no longer starts at the chunk it was assembled from: it
             * starts that much later. Without this the studio lines the lane up
             * against the wrong frame, and a mute lands beside the words it was
             * meant to take out - the further the rebase had to walk, the
             * further off it is.
             *
             * One read of the lane, and the rebase and both measurements work
             * on those bytes: a lane is a call's worth of audio, and reading it
             * back three times copied all of it three times.
             */
            let cutOff = 0;

            try {
                const bytes = new Uint8Array(await raw.arrayBuffer());
                const fixed = repairBytes(bytes, lane.mimeType);

                if (fixed) {
                    blob = new Blob([fixed as BlobPart], { type: lane.mimeType });
                    cutOff = Math.max(0, lengthBytes(bytes, lane.mimeType) - lengthBytes(fixed, lane.mimeType));
                }
            } catch (e) {
                logger.warn(`Could not rebase the voice track for ${name || userId}`, e);
            }

            return {
                userId,
                name: name || userId,
                blob,
                mimeType: lane.mimeType,
                offset: (kept[0].at - TIMESLICE - start) / 1000 + cutOff
            };
        }));

        return harvested.filter((clip): clip is VoiceLaneClip => clip !== null);
    }
}

export const voiceBuffers = new VoiceBuffers();
