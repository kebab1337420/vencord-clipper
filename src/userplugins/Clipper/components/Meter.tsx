/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - what a channel is sending, right now
 *
 * The source rows and the people in the call are different lists with
 * different meanings, but a level is a level: both read from the same bar and
 * both put the same number beside it, so both come from here.
 */

/** The numeric readout beside a meter: fixed width, so a row does not jump. */
export const VALUE: React.CSSProperties = {
    width: 46,
    flex: "0 0 auto",
    textAlign: "right",
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    color: "var(--text-muted, #949ba4)"
};

/** Green bar following how loud a channel is, red as it runs out of headroom. */
export function Meter({ level }: { level: number; }) {
    return (
        <div
            style={{
                width: 56,
                height: 6,
                flex: "0 0 auto",
                overflow: "hidden",
                borderRadius: 3,
                background: "var(--background-tertiary, #1e1f22)"
            }}
        >
            <div
                style={{
                    width: `${Math.round(Math.min(1, level) * 100)}%`,
                    height: "100%",
                    background: level > 0.9 ? "var(--status-danger, #da373c)" : "var(--green-360, #23a55a)",
                    transition: "width .1s linear"
                }}
            />
        </div>
    );
}
