/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the SteamVR row in the plugin settings
 *
 * The plugin does not draw a binding screen of its own, and there is nothing
 * missing here: SteamVR already owns one, it is the same panel every VR game is
 * rebound from, and a binding made there outlives the plugin being reinstalled.
 * So this row is a status line and one button that opens it.
 *
 * The button only does anything while the bridge is attached, because the panel
 * is opened by SteamVR on behalf of a running application. With no headset on
 * there is nothing to open it on, and the row says so rather than offering a
 * button that quietly fails.
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { useEffect, useState } from "@webpack/common";

import { openVrBindings, vrReport } from "../vr";

/** How often the row re-reads the bridge. Slow: it is a settings panel. */
const REFRESH_MS = 4000;

export function VrBindings() {
    const [status, setStatus] = useState("Checking...");
    const [opening, setOpening] = useState(false);

    /*
     * Polled rather than pushed. Whether SteamVR is up changes without anything
     * in Discord happening - somebody puts a headset on - and there is no event
     * to hang this off; the panel is open for a few seconds at a time, so the
     * cost of asking is not worth an event system of its own.
     */
    useEffect(() => {
        let alive = true;

        const read = () => void vrReport().then(text => {
            if (alive) setStatus(text);
        });

        read();
        const timer = setInterval(read, REFRESH_MS);

        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, []);

    const attached = status.startsWith("SteamVR ");

    return (
        <section style={{ marginBottom: 20 }}>
            <Heading tag="h5">Controller bindings</Heading>

            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <Paragraph style={{ flex: 1, color: "var(--text-muted, #949ba4)" }}>
                    {status}
                </Paragraph>

                <Button
                    variant="secondary"
                    disabled={!attached || opening}
                    onClick={() => {
                        setOpening(true);
                        void openVrBindings().finally(() => setOpening(false));
                    }}
                >
                    {opening ? "Opening..." : "Open SteamVR bindings"}
                </Button>
            </div>

            <Paragraph style={{ marginTop: 6, color: "var(--text-muted, #949ba4)" }}>
                Out of the box: double-tap B on the right controller to save a clip, hold A to drop a
                marker, double-tap the left one to start or stop the buffer, hold it to ask the call
                for their angle. A double tap and a hold rather than a plain press, so a default never
                fires in the middle of a game - change any of them in the panel above.
            </Paragraph>
        </section>
    );
}
