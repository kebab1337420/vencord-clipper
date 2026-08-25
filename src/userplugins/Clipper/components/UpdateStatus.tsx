/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - version row in the plugin settings
 *
 * Shows what is installed against what the launch check found, and carries the
 * three buttons that matter: check again, take the update, restart into it.
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { useEffect, useState } from "@webpack/common";

import { checkForUpdate, CLIPPER_VERSION, installUpdate, restartClient, updateState, watchUpdates } from "../updater";

export function UpdateStatus() {
    const [, redraw] = useState(0);
    const state = updateState();

    // The launch check runs on its own and lands whenever it lands, so the row
    // follows the state rather than holding a copy of it.
    useEffect(() => watchUpdates(() => redraw(n => n + 1)), []);

    const { latest } = state;

    const status = state.checking
        ? "Checking GitHub..."
        : state.restartNeeded
            ? `Version ${latest?.version} is written. It loads once Discord restarts.`
            : state.error
                ? `Last check failed: ${state.error}`
                : latest?.available
                    ? `Version ${latest.version} is out.`
                    : latest
                        ? "This is the latest release."
                        : "Not checked yet.";

    return (
        <section style={{ marginBottom: 20 }}>
            <Heading tag="h5">Installed version</Heading>

            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text-normal, #dbdee1)" }}>
                    Clipper {CLIPPER_VERSION}
                </span>

                <div style={{ flex: 1 }} />

                <Button
                    variant="secondary"
                    disabled={state.checking || state.installing}
                    onClick={() => void checkForUpdate()}
                >
                    {state.checking ? "Checking..." : "Check now"}
                </Button>

                {latest?.available && !state.restartNeeded && (
                    <Button
                        variant="primary"
                        disabled={state.installing}
                        onClick={() => void installUpdate(latest)}
                    >
                        {state.installing ? "Installing..." : `Install ${latest.version}`}
                    </Button>
                )}

                {state.restartNeeded && (
                    <Button variant="primary" onClick={() => restartClient()}>
                        Restart Discord
                    </Button>
                )}
            </div>

            <Paragraph style={{ marginTop: 6, color: "var(--text-muted, #949ba4)" }}>
                {status}
            </Paragraph>

            {latest?.available && latest.notes && !state.restartNeeded && (
                <Paragraph
                    style={{
                        marginTop: 6,
                        maxHeight: 120,
                        overflowY: "auto",
                        whiteSpace: "pre-wrap",
                        color: "var(--text-muted, #949ba4)"
                    }}
                >
                    {latest.notes}
                </Paragraph>
            )}
        </section>
    );
}
