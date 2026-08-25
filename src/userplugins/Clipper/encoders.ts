/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - asking the encoders to prove it
 *
 * `MediaRecorder.isTypeSupported` answers for the Chromium build. It says
 * nothing about the machine, and an H.264 that answers yes still dies at the
 * first frame when the encoder behind it is missing or broken - which is how
 * the buffer ends up falling back to WebM at every launch with nothing but a
 * toast to show for it.
 *
 * This actually runs each container: a canvas with something moving on it, a
 * silent tone beside it so the audio encoder is exercised too, and a real
 * MediaRecorder over both for half a second. A container that comes back with
 * bytes works on this machine. One that comes back with a DOMException names it.
 *
 * The picture is a canvas rather than a screen capture on purpose: it is the
 * one source that is always available and always the same size, so a container
 * that fails here fails on its own account, while one that works here and fails
 * on the capture points at the capture instead.
 */

import { Logger } from "@utils/Logger";

import { Container, mimeTypeChain } from "./settings";

const logger = new Logger("Clipper");

/** How long each container is given to produce bytes. */
const RUN_MS = 600;

export interface EncoderReport {
    mimeType: string;
    ok: boolean;
    /** Bytes produced, when it produced any. */
    bytes: number;
    /** Why it failed, in the encoder's own words. */
    reason?: string;
}

/**
 * Runs every container this client claims, and reports what actually encoded.
 *
 * Sequential, because two hardware encoders running at once is a way to fail a
 * test that would otherwise pass.
 */
export async function probeEncoders(): Promise<EncoderReport[]> {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return [];

    let frame = 0;
    const draw = () => {
        // Something that moves: an encoder handed 30 identical frames can drop
        // every one of them and still look like it produced nothing.
        ctx.fillStyle = "#101014";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#5865f2";
        ctx.fillRect((frame * 17) % canvas.width, 240, 240, 240);
        frame++;
    };

    draw();

    const ticker = window.setInterval(draw, 33);
    const stream = canvas.captureStream(30);

    // The soundtrack matters: MP4 asks for AAC, and a machine whose AAC encoder
    // is the broken half would otherwise pass a video-only test.
    const audio = new AudioContext();
    const silence = audio.createGain();
    silence.gain.value = 0;

    const tone = audio.createOscillator();
    tone.connect(silence);

    const sink = audio.createMediaStreamDestination();
    silence.connect(sink);
    tone.start();

    for (const track of sink.stream.getAudioTracks()) stream.addTrack(track);

    const seen = new Set<string>();
    const reports: EncoderReport[] = [];

    try {
        for (const container of [Container.Mp4H264, Container.WebmVp9, Container.WebmVp8]) {
            for (const mimeType of mimeTypeChain(container)) {
                if (seen.has(mimeType)) continue;
                seen.add(mimeType);

                reports.push(await runOne(stream, mimeType));
            }
        }
    } finally {
        clearInterval(ticker);
        tone.stop();
        stream.getTracks().forEach(t => t.stop());
        await audio.close().catch(() => void 0);
    }

    logger.info("Encoder probe", reports);
    return reports;
}

function runOne(stream: MediaStream, mimeType: string): Promise<EncoderReport> {
    return new Promise(resolve => {
        let bytes = 0;
        let recorder: MediaRecorder;

        try {
            recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
        } catch (e) {
            resolve({ mimeType, ok: false, bytes: 0, reason: `would not open (${errorText(e)})` });
            return;
        }

        let settled = false;
        const finish = (reason?: string) => {
            if (settled) return;
            settled = true;

            clearTimeout(timer);
            try {
                if (recorder.state !== "inactive") recorder.stop();
            } catch {
                // An encoder that has already given up throws on being stopped.
            }

            resolve({ mimeType, ok: !reason && bytes > 0, bytes, reason: reason ?? (bytes ? undefined : "produced no bytes") });
        };

        recorder.ondataavailable = e => { bytes += e.data.size; };
        recorder.onerror = e => {
            const raised = (e as unknown as { error?: { name?: string; message?: string; }; }).error;
            finish([raised?.name, raised?.message].filter(Boolean).join(" - ") || "failed");
        };

        const timer = setTimeout(() => finish(), RUN_MS);

        try {
            recorder.start(200);
        } catch (e) {
            finish(`would not start (${errorText(e)})`);
        }
    });
}

function errorText(e: unknown): string {
    const raised = e as { name?: string; message?: string; };
    return [raised?.name, raised?.message].filter(Boolean).join(" - ") || String(e);
}

/** The probe as one line per container, for a toast. */
export function encoderSummary(reports: EncoderReport[]): string {
    if (!reports.length) return "This client offers no video encoder at all.";

    return reports
        .map(r => `${r.mimeType}: ${r.ok ? `${Math.round(r.bytes / 1024)} KB in ${RUN_MS}ms` : r.reason}`)
        .join("\n");
}
