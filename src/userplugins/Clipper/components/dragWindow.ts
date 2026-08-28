/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - a drag that lives on the window
 *
 * Both lanes of the studio are dragged the same way, and neither can afford to
 * listen on its own element: a pointer moving faster than React re-renders
 * leaves that element behind, and a button released outside the modal would
 * never end the gesture, leaving whatever was grabbed stuck to the cursor.
 */

import { useEffect } from "@webpack/common";

interface DragHandlers {
    move(e: MouseEvent): void;
    up(e: MouseEvent): void;
}

/**
 * Runs a gesture on the window for as long as one is given.
 *
 * Null is how a drag ends: the listeners exist only while it is on. `deps` says
 * what the handlers were built from, exactly as it would for the effect this
 * replaces - the handlers themselves are deliberately not part of it, since a
 * fresh pair is built on every render.
 */
export function useDragWindow(handlers: DragHandlers | null, deps: unknown[]): void {
    useEffect(() => {
        if (!handlers) return;

        const { move, up } = handlers;

        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);

        return () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
    }, deps);
}
