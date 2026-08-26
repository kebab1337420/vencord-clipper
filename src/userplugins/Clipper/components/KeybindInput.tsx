/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - keybind picker used by the plugin settings
 *
 * Picking a combination is not just "read the next keydown". The binds this
 * picker sets are registered with the OS through Electron's `globalShortcut`,
 * and a registered accelerator is swallowed before the renderer sees it: while
 * the old picker was listening, pressing the combination that was already bound
 * - or any combination another application had taken - produced no event at
 * all, so the picker sat there saying "press a key" and nothing was ever
 * assigned. The binds are therefore released for as long as the picker is open
 * and registered again afterwards.
 *
 * The second half is feedback. A combination is held down modifier-first, and
 * modifiers alone are not a valid bind, so the picker used to look frozen for
 * as long as the user held Ctrl and Shift. It now shows what is being held.
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { React, useEffect, useRef, useState } from "@webpack/common";

import { formatKeybind, isModifierKey, type Keybind, keybindFromEvent, serializeKeybind, suspendKeybinds, toAccelerator } from "../utils";

interface KeybindInputProps {
    title: string;
    note?: string;
    value: string;
    onChange(value: string): void;
}

/** The modifiers of a half-pressed combination, e.g. "Ctrl + Shift". */
function heldLabel(held: Keybind | null): string {
    if (!held) return "";

    const parts: string[] = [];
    if (held.ctrl) parts.push("Ctrl");
    if (held.shift) parts.push("Shift");
    if (held.alt) parts.push("Alt");
    if (held.meta) parts.push("Meta");

    return parts.join(" + ");
}

export function KeybindInput({ title, note, value, onChange }: KeybindInputProps) {
    const [listening, setListening] = useState(false);
    const [current, setCurrent] = useState(value);
    const [held, setHeld] = useState<Keybind | null>(null);

    // Held in a ref rather than in the effect's dependencies: the settings panel
    // hands down a fresh closure on every render, and re-running the effect
    // would give the binds back to the OS in the middle of a capture.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!listening) {
            setHeld(null);
            return;
        }

        // The binds are handed back to the OS when the picker closes, whether it
        // closed on a key, on Escape or because the panel was unmounted.
        const resume = suspendKeybinds();

        const stop = () => {
            setHeld(null);
            setListening(false);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();

            if (e.repeat) return;

            const bind = keybindFromEvent(e);
            const bare = !bind.ctrl && !bind.shift && !bind.alt && !bind.meta;

            // Escape on its own cancels; held with a modifier it is a key like
            // any other, so "Ctrl + Esc" can still be assigned.
            if (e.code === "Escape" && bare) {
                stop();
                return;
            }

            if (isModifierKey(e.code)) {
                setHeld(bind);
                return;
            }

            const picked = serializeKeybind(bind);

            setCurrent(picked);
            onChangeRef.current(picked);
            stop();
        };

        // Releasing a modifier while the picker waits should take it back off
        // the display rather than leave a combination nobody is holding.
        const onKeyUp = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();

            if (isModifierKey(e.code)) setHeld(keybindFromEvent(e));
        };

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("blur", stop);

        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
            window.removeEventListener("blur", stop);
            resume();
        };
    }, [listening]);

    const holding = heldLabel(held);

    return (
        <section>
            <Heading tag="h5">{title}</Heading>
            {note && <Paragraph style={{ color: "var(--text-secondary)" }}>{note}</Paragraph>}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <Button
                    variant={listening ? "primary" : "secondary"}
                    onClick={() => setListening(l => !l)}
                >
                    {listening
                        ? holding
                            ? `${holding} + …`
                            : "Press a key or a combination… (Esc to cancel)"
                        : formatKeybind(current)}
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

            {!listening && !!current && !toAccelerator(current) && (
                <Paragraph style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted, #949ba4)" }}>
                    This key cannot be registered system-wide, so it only fires while Discord is the focused window.
                </Paragraph>
            )}
        </section>
    );
}
