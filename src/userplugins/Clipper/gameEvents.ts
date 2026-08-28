/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the games that will tell you what happened, renderer half
 *
 * ./gameFeeds runs in the main process, because listening on a socket and
 * writing into a game's config folder are not things a page can do. This is the
 * side that turns what it hears into evidence on ./signals' board, and it is
 * mostly a long-poll: the main process parks the call until a game says
 * something, so an idle client does no work and a kill arrives with no delay.
 *
 * It is off unless it is turned on, and that is on purpose. Everything else in
 * the automatic marker looks at sound and pictures that are already going past;
 * this one writes a file into a folder belonging to Counter-Strike 2 and opens
 * a listening socket on the loopback interface, and neither of those is a thing
 * to do to somebody without asking.
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";

import type { GameEvent } from "./gameFeeds";
import { settings } from "./settings";
import { signals } from "./signals";

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

const logger = new Logger("Clipper");

/** Bumped on every stop, so a pump left over from a previous run exits. */
let generation = 0;
let running = false;

function supported(): boolean {
    return IS_DISCORD_DESKTOP || IS_VESKTOP;
}

/** What the settings say should be listened to. */
function wanted(): { cs2: boolean; league: boolean; } {
    const on = settings.store.gameIntegrations;
    return { cs2: !!on, league: !!on };
}

/**
 * Starts the feeds, or stops them, to match the setting.
 *
 * Called on start and whenever the setting moves, so turning it on mid-game
 * takes effect at once - which for Counter-Strike still means loading a map
 * again, since the config is only read when the game starts.
 */
export async function syncGameEvents(): Promise<void> {
    if (!supported()) return;

    if (!settings.store.gameIntegrations) {
        stopGameEvents();
        return;
    }

    try {
        const status = await Native.startGameFeeds(wanted());

        for (const problem of status.problems) logger.warn(problem);

        logger.info("Game integrations", {
            counterStrike: status.configPath || "not set up",
            port: status.port || "not listening",
            league: status.league
        });
    } catch (e) {
        logger.warn("Could not start the game integrations", e);
        return;
    }

    signals.claim("events");

    if (running) return;
    running = true;

    const mine = ++generation;
    void pump(mine);
}

export function stopGameEvents(): void {
    generation++;
    running = false;
    signals.release("events");

    if (!supported()) return;

    try {
        // A promise, like every other call over IPC: a throw on the far side
        // never reaches the catch below, so it needs catching where it lands.
        void Promise.resolve(Native.stopGameFeeds())
            .catch(e => logger.warn("Could not stop the game integrations", e));
    } catch (e) {
        logger.warn("Could not stop the game integrations", e);
    }
}

/** A line for the toolbox saying what is actually hooked up. */
export async function gameEventReport(): Promise<string> {
    if (!supported()) return "Game integrations need the desktop client.";
    if (!settings.store.gameIntegrations) return "Game integrations are off. Turn them on in the Clipper settings.";

    try {
        const status = await Native.gameFeedStatus();
        const lines: string[] = [];

        lines.push(status.configPath
            ? `Counter-Strike 2 will report to port ${status.port}. Its config is at ${status.configPath} - load a map again if the game was already running.`
            : "Counter-Strike 2 is not set up.");

        lines.push(status.league
            ? "League of Legends is being watched while a game is running."
            : "League of Legends is not being watched.");

        for (const problem of status.problems) lines.push(problem);

        return lines.join("\n");
    } catch (e) {
        return `The game integrations could not be reached (${(e as Error).message}).`;
    }
}

/**
 * Long-polls the main process for the next thing a game reported.
 *
 * The call parks over there until an event arrives or the timeout expires, so
 * this costs nothing while nothing is happening.
 */
async function pump(mine: number): Promise<void> {
    while (mine === generation) {
        let event: GameEvent | null = null;

        try {
            event = await Native.waitForGameEvent();
        } catch (e) {
            logger.warn("The game integration listener failed, retrying", e);
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        if (mine !== generation) return;
        if (event) signals.fire(event.kind, event.note);
    }
}
