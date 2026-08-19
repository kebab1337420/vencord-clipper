/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - keybind picker used by the plugin settings
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { React, useEffect, useState } from "@webpack/common";

import { formatKeybind, isModifierKey, keybindFromEvent, serializeKeybind } from "../utils";

interface KeybindInputProps {
    title: string;
    note?: string;
    value: string;
    onChange(value: string): void;
}

export function KeybindInput({ title, note, value, onChange }: KeybindInputProps) {
    const [listening, setListening] = useState(false);
    const [current, setCurrent] = useState(value);

    useEffect(() => {
        if (!listening) return;

        const onKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.code === "Escape") {
                setListening(false);
                return;
            }

            // Wait for a real key: modifiers alone are not a valid bind.
            if (isModifierKey(e.code)) return;

            const bind = serializeKeybind(keybindFromEvent(e));
            setCurrent(bind);
            onChange(bind);
            setListening(false);
        };

        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [listening, onChange]);

    return (
        <section>
            <Heading tag="h5">{title}</Heading>
            {note && <Paragraph style={{ color: "var(--text-secondary)" }}>{note}</Paragraph>}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <Button
                    variant={listening ? "primary" : "secondary"}
                    onClick={() => setListening(l => !l)}
                >
                    {listening ? "Press a key… (Esc to cancel)" : formatKeybind(current)}
                </Button>
                <Button
                    variant="dangerSecondary"
                    onClick={() => {
                        setCurrent("");
                        onChange("");
                        setListening(false);
                    }}
                >
                    Clear
                </Button>
            </div>
        </section>
    );
}
