/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - clip folder row in the plugin settings
 *
 * The plain text field alone is easy to get wrong (relative paths, typos), so
 * the folder is picked through Electron's native dialog and the effective
 * destination is always shown.
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { React, useEffect, useState } from "@webpack/common";

import { openClipFolder, pickClipFolder, resolveClipFolder } from "../recorder";
import { settings } from "../settings";

export function SaveDirectoryInput() {
    const { saveDirectory } = settings.use(["saveDirectory"]);
    const [resolved, setResolved] = useState("");

    useEffect(() => {
        let alive = true;
        resolveClipFolder().then(path => { if (alive) setResolved(path); });
        return () => { alive = false; };
    }, [saveDirectory]);

    return (
        <section style={{ marginBottom: 20 }}>
            <Heading tag="h5">Clip folder</Heading>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                    value={saveDirectory}
                    placeholder="Leave empty for <Videos>/DiscordClips"
                    onChange={e => (settings.store.saveDirectory = e.currentTarget.value)}
                    style={{
                        flex: 1,
                        padding: "8px 10px",
                        border: "1px solid transparent",
                        borderRadius: 4,
                        background: "var(--input-background, #1e1f22)",
                        color: "var(--text-normal, #dbdee1)",
                        fontSize: 14,
                        outline: "none"
                    }}
                />
                <Button
                    variant="secondary"
                    onClick={async () => {
                        const picked = await pickClipFolder();
                        if (picked) settings.store.saveDirectory = picked;
                    }}
                >
                    Browse
                </Button>
                <Button variant="secondary" onClick={() => openClipFolder()}>
                    Open
                </Button>
            </div>

            <Paragraph style={{ marginTop: 6, color: "var(--text-muted, #949ba4)" }}>
                {resolved ? `Clips are written to ${resolved}` : "Clips are written next to your videos folder."}
            </Paragraph>
        </section>
    );
}
