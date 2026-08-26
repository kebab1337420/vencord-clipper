/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - clip sound row in the plugin settings
 *
 * The sound is feedback, and feedback nobody can hear before they need it is
 * useless: the point of the Test button is to set the volume against whatever
 * the machine is actually playing, not against silence in a settings panel.
 * Testing while the buffer runs ducks the mix exactly as a real clip does, so
 * what is being tried out is the whole behaviour rather than the tone alone.
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { React } from "@webpack/common";

import { pickAudioFiles } from "../clips";
import { DEFAULT_CLIP_SOUND_VOLUME, forgetClipSound, playClipSound } from "../clipSound";
import { recorder } from "../recorder";
import { settings } from "../settings";

const muted = "var(--text-muted, #949ba4)";

export function ClipSoundInput() {
    const { clipSound, clipSoundPath, clipSoundVolume } = settings.use([
        "clipSound",
        "clipSoundPath",
        "clipSoundVolume"
    ]);

    const volume = Number.isFinite(Number(clipSoundVolume))
        ? Number(clipSoundVolume)
        : DEFAULT_CLIP_SOUND_VOLUME;

    const name = clipSoundPath ? clipSoundPath.split(/[\\/]/).pop() : "";

    return (
        <section style={{ marginBottom: 20, opacity: clipSound ? 1 : 0.5 }}>
            <Heading tag="h5">Clip sound</Heading>

            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <div
                    style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: 4,
                        background: "var(--input-background, #1e1f22)",
                        color: name ? "var(--text-normal, #dbdee1)" : muted,
                        fontSize: 14,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                    }}
                    title={clipSoundPath || undefined}
                >
                    {name || "Built-in blip"}
                </div>

                <Button
                    variant="secondary"
                    onClick={async () => {
                        const [picked] = await pickAudioFiles();
                        if (!picked) return;

                        settings.store.clipSoundPath = picked;
                        forgetClipSound();

                        void playClipSound(ms => recorder.duckSystem(ms));
                    }}
                >
                    Browse
                </Button>

                {clipSoundPath ? (
                    <Button
                        variant="secondary"
                        onClick={() => {
                            settings.store.clipSoundPath = "";
                            forgetClipSound();
                        }}
                    >
                        Reset
                    </Button>
                ) : null}

                <Button
                    variant="secondary"
                    onClick={() => void playClipSound(ms => recorder.duckSystem(ms))}
                >
                    Test
                </Button>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
                <span style={{ color: muted, fontSize: 12, width: 54 }}>Volume</span>

                <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={volume}
                    onChange={e => (settings.store.clipSoundVolume = Number(e.currentTarget.value))}
                    style={{ flex: 1, accentColor: "var(--brand-500, #5865f2)" }}
                />

                <span style={{ color: muted, fontSize: 12, width: 40, textAlign: "right" }}>
                    {volume}%
                </span>
            </div>

            <Paragraph style={{ marginTop: 6, color: muted }}>
                Played on your speakers only. The machine's own sound is held at zero while it
                plays, so the tone never lands in the clip it announces - at the price of that
                fraction of a second of game audio.
            </Paragraph>
        </section>
    );
}
