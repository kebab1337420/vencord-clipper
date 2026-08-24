/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the client's own clip engine, and whether it is here
 *
 * Discord's native clip recorder is an experiment: the code that drives it is
 * in every client, but the `discord_voice` module that answers it is only built
 * with the engine for accounts the experiment is on. Nothing about that is
 * visible from the settings, so this panel asks the engine directly and says
 * what it found, method by method.
 *
 * The button below it is the honest way to find out the rest. Arming the buffer
 * and saving from it is the only thing that proves the engine works on this
 * machine, and it costs one short file in the clip folder.
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { useEffect, useState } from "@webpack/common";

import { loadClipBytes } from "../clips";
import { probeAudioTracks } from "../mp4";
import { arm, canRecord, disarm, type NativeAvailability, nativeAvailability, saveNativeClip, watchRecording } from "../nativeClips";
import { resolveClipFolder } from "../recorder";
import { settings } from "../settings";

/*
 * How long the trial lets the buffer run before it saves, and how much of that
 * run it then asks for.
 *
 * The two are deliberately apart. A window takes a moment to deliver its first
 * frame, and the newest frames are still inside the encoder when the save goes
 * in, so a clip that asks for everything it waited for asks for footage at both
 * edges that does not exist yet - which is what the muxer refuses.
 */
const FILL_SECONDS = 10;
const TRIAL_SECONDS = 4;

const MONO: React.CSSProperties = {
    fontFamily: "var(--font-code, monospace)",
    fontSize: 12,
    color: "var(--text-muted, #949ba4)"
};

function pause(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * Arm the buffer, wait for the engine to say it is recording, save one clip.
 *
 * The buffer is disarmed again whatever happens: leaving it running would hold
 * a capture of a window open behind a settings panel the user has closed.
 */
async function trial(): Promise<string> {
    const { sourceId, sourceName, clipLength, resolution, fps } = settings.store;
    if (!sourceId) return "Pick a capture source first - the native buffer records from the same source the plugin does.";

    if (!canRecord(sourceId)) {
        return `The engine only records a window, and "${sourceName || sourceId}" is a screen. `
            + "Pick the game's own window in the source picker, then try again.";
    }

    const folder = await resolveClipFolder();
    if (!folder) return "The clip folder could not be resolved.";

    // Opened before arming: where the engine starts quickly it reports itself
    // ready from inside the arming call, and a watch opened afterwards misses
    // it and waits out the whole timeout.
    const watch = watchRecording();

    const running = arm({
        sourceId,
        seconds: Math.max(FILL_SECONDS, clipLength),
        resolution: resolution || 1080,
        frameRate: fps,
        applicationName: sourceName || "Clipper"
    });

    if (!running) {
        watch.stop();
        return "The buffer refused to arm. The client's log has the engine's own reason.";
    }

    try {
        // The engine's own verdict rather than a fixed sleep: it opens the
        // capture before it records anything, and it says so on its event
        // stream when that fails.
        const verdict = await watch.settled;
        if (!verdict.recording) return `The engine did not start recording: ${verdict.reason}.`;

        await pause(FILL_SECONDS * 1000);

        const name = `native-test-${Date.now()}.mp4`;
        // The folder comes back in the platform's own shape; joining on the
        // separator it already uses keeps this off a path module.
        const separator = folder.includes("\\") ? "\\" : "/";
        const length = await saveNativeClip(`${folder}${separator}${name}`, TRIAL_SECONDS, { name: "Clipper native test" });

        const heard = await countVoices(folder, name);

        const said = verdict.confirmed ? "" : " It never reported itself ready, so the save is the only proof.";

        return `Saved ${name} - ${length ? `${(length / 1000).toFixed(1)}s` : "no length reported"}. The native engine works on this client.${heard}${said}`;
    } catch (e: any) {
        const reason = e?.errorMessage ?? e?.message ?? String(e);
        const at = e?.errorAt ? ` (at ${e.errorAt})` : "";
        return `The engine refused the save: ${reason}${at}`;
    } finally {
        disarm();
    }
}

/**
 * What the saved file says about per-person audio.
 *
 * The engine records a track per speaker and mixes them down at export, and
 * which side of that a saved clip falls on is not documented anywhere - so the
 * trial reads its own output back and says. More than one track means a person
 * can be turned down after the fact; one means the voices were already summed
 * before the file existed, and the studio's duck is all there will ever be.
 *
 * A diagnostic, never a failure: a save that worked still worked if this cannot
 * read the file back.
 */
async function countVoices(folder: string, name: string): Promise<string> {
    try {
        const tracks = probeAudioTracks(await loadClipBytes(name, folder));
        if (!tracks) return " Its audio tracks could not be counted - no readable moov.";

        if (tracks.length <= 1) {
            return " One audio track, so the voices were mixed before the file was written.";
        }

        const names = tracks.map(t => t.handler || `track ${t.id}`).join(", ");

        return ` ${tracks.length} audio tracks (${names}) - the voices are separate in the file.`;
    } catch (e: any) {
        return ` Its audio tracks could not be counted: ${e?.message ?? String(e)}.`;
    }
}

function Row({ name, ok }: { name: string; ok: boolean; }) {
    return (
        <div style={{ ...MONO, display: "flex", gap: 6 }}>
            <span style={{ color: ok ? "var(--text-positive, #4bb543)" : "var(--text-danger, #f23f43)" }}>
                {ok ? "yes" : "no "}
            </span>
            <span>{name}</span>
        </div>
    );
}

function Native() {
    const [state, setState] = useState<NativeAvailability | null>(null);
    const [source, setSource] = useState({ id: "", name: "" });
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState("");

    // Read once on mount and then on a slow timer: the media engine can come up
    // after the settings panel does, and the capture source changes from a
    // picker that knows nothing about this panel.
    useEffect(() => {
        let alive = true;

        const read = () => {
            if (!alive) return;

            setState(nativeAvailability());
            setSource({ id: settings.store.sourceId, name: settings.store.sourceName });
        };

        read();
        const timer = setInterval(read, 2000);

        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, []);

    if (!state) return null;

    const wrongSource = !!source.id && !canRecord(source.id);
    const canTry = state.available && !wrongSource && !busy;

    return (
        <section style={{ marginTop: 8 }}>
            <Paragraph style={{ fontSize: 13, color: state.available ? "var(--text-positive, #4bb543)" : "var(--text-muted, #949ba4)" }}>
                {state.available
                    ? "Discord's own clip engine is available on this client."
                    : state.reason}
            </Paragraph>

            <div style={{ marginTop: 8, display: "grid", gap: 2 }}>
                {Object.entries(state.methods).map(([name, ok]) => <Row key={name} name={name} ok={ok} />)}
            </div>

            <Paragraph style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted, #949ba4)" }}>
                It records a window, never a whole screen: the media engine hands the native module a window handle
                and has nowhere to put a display. Pick the game's own window in the source picker before trying it.
            </Paragraph>

            <Paragraph style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted, #949ba4)" }}>
                The engine records the call as one mixed voice track, kept apart from the game's audio inside the
                file. It decides per person whether their voice is recorded at all, but nobody - not this plugin,
                not Discord - gets one track per person.
            </Paragraph>

            {wrongSource && (
                <Paragraph style={{ marginTop: 8, fontSize: 12, color: "var(--text-warning, #f0b132)" }}>
                    The current source is {source.name ? `"${source.name}"` : source.id}, which is a screen. The
                    engine cannot record it.
                </Paragraph>
            )}

            <button
                type="button"
                disabled={!canTry}
                style={{
                    marginTop: 10,
                    padding: "6px 12px",
                    border: "none",
                    borderRadius: 4,
                    background: "var(--button-secondary-background, #4e5058)",
                    color: "#fff",
                    fontSize: 13,
                    cursor: canTry ? "pointer" : "default",
                    opacity: canTry ? 1 : 0.5
                }}
                onClick={async () => {
                    setBusy(true);
                    setResult(`Waiting for the engine, then filling the buffer for ${FILL_SECONDS}s...`);
                    setResult(await trial());
                    setBusy(false);
                }}
            >
                {busy ? "Recording..." : `Record a ${TRIAL_SECONDS}s test clip with it`}
            </button>

            {!!result && (
                <Paragraph style={{ marginTop: 8, fontSize: 12, color: "var(--text-normal, #dbdee1)" }}>
                    {result}
                </Paragraph>
            )}
        </section>
    );
}

export function NativeClipsPanel() {
    return (
        <ErrorBoundary message="The Clipper native engine panel could not be rendered.">
            <Native />
        </ErrorBoundary>
    );
}
