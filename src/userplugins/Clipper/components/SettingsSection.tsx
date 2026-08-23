/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - section header in the plugin settings
 *
 * The panel had grown into one flat column where the microphone switch, the
 * audio quality slider and the sound mixer sat several settings apart. Vencord
 * renders the settings in declaration order and has no grouping of its own, so
 * a group is a header rendered as a setting of its own, with the settings it
 * covers declared right after it.
 */

import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";

export function SettingsSection({ title, note }: { title: string; note?: string; }) {
    return (
        <section style={{ margin: "24px 0 4px" }}>
            <div
                style={{
                    height: 1,
                    marginBottom: 12,
                    background: "var(--background-modifier-accent, rgba(78, 80, 88, .48))"
                }}
            />

            <Heading tag="h5" style={{ textTransform: "uppercase", letterSpacing: ".02em" }}>
                {title}
            </Heading>

            {note && (
                <Paragraph style={{ marginTop: 4, fontSize: 13, color: "var(--text-muted, #949ba4)" }}>
                    {note}
                </Paragraph>
            )}
        </section>
    );
}
