/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the one line that shows a toast
 *
 * Its own module rather than a helper in ./utils, for one reason: ./utils is
 * imported by ./native, which runs in the main process where there is no
 * `@webpack/common` to import `Toasts` from. Five files had their own copy of
 * the call instead, three of them identical.
 */

import { Toasts } from "@webpack/common";

/**
 * Shows one, with the client's own placement unless a dwell time is given.
 *
 * Passing a duration also moves the toast to the bottom of the window, because
 * the two callers that want one are the two that talk over a game: a toast that
 * lingers belongs out of the way of what is being watched.
 */
export function toast(message: string, type: string, duration?: number): void {
    Toasts.show({
        id: Toasts.genId(),
        message,
        type,
        ...(duration === undefined ? {} : { options: { duration, position: Toasts.Position.BOTTOM } })
    });
}
