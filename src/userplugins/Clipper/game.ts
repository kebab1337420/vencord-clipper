/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - what is being played, and when that changes
 *
 * Discord already detects running games for the activity status, and it names
 * them properly: "Counter-Strike 2", not "Counter-Strike 2 - Direct3D 11". Two
 * things here want that. The library files a clip under the game it was taken
 * from, and the capture wants to know that a game is running at all, because a
 * game changes what is worth pointing the capture at.
 *
 * The store is a Flux store, so it is subscribed to rather than polled - but
 * only when it has the listener API this expects. A store shape that changed
 * under a client update falls back to looking every few seconds, which is late
 * rather than broken.
 */

import { Logger } from "@utils/Logger";
import { RunningGameStore } from "@webpack/common";

const logger = new Logger("Clipper");

/** How often the fallback looks, when the store cannot be subscribed to. */
const POLL_MS = 5000;

interface RunningGame {
    name?: string;
}

/**
 * The game Discord thinks is running, or an empty string.
 *
 * Only the first is looked at: Discord lists what it detects, and the one it
 * puts in the activity status is the one the player is in.
 */
export function runningGame(): string {
    try {
        const games = RunningGameStore?.getRunningGames?.() as RunningGame[] | undefined;
        const running = games?.map(g => g?.name).find(name => typeof name === "string" && name.trim());

        return running ? running.trim().slice(0, 60) : "";
    } catch (e) {
        logger.warn("Could not read Discord's running games", e);
        return "";
    }
}

/**
 * Calls back whenever the running game changes, and hands back an unsubscribe.
 *
 * The callback only fires on a real change - the store dispatches for plenty of
 * things that leave the answer identical, and every listener here re-arms a
 * capture.
 */
export function watchRunningGame(listener: (game: string) => void): () => void {
    let last = runningGame();

    const check = () => {
        const now = runningGame();
        if (now === last) return;

        last = now;

        try {
            listener(now);
        } catch (e) {
            logger.warn("A running-game listener threw", e);
        }
    };

    const store = RunningGameStore as { addChangeListener?(f: () => void): void; removeChangeListener?(f: () => void): void; } | undefined;

    if (store?.addChangeListener && store.removeChangeListener) {
        store.addChangeListener(check);
        return () => {
            try {
                store.removeChangeListener!(check);
            } catch (e) {
                logger.warn("Could not drop the running-game listener", e);
            }
        };
    }

    const timer = setInterval(check, POLL_MS);
    return () => clearInterval(timer);
}
