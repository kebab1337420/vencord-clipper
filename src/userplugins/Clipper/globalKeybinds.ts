/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - system-wide keybinds
 *
 * The in-client `keydown` listener only fires while Discord is focused, so the
 * binds are also registered with the OS through Electron's `globalShortcut` in
 * the main process. This module keeps that registration in sync with the
 * settings and pumps the fired binds back into the recorder.
 */

import type { PluginNative } from "@utils/types";
import { Toasts } from "@webpack/common";

import { requestPov } from "./multipov";
import { logger, recorder } from "./recorder";
import { settings } from "./settings";
import { formatKeybind, toAccelerator, watchKeybindSuspension } from "./utils";

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

type ShortcutAction = "save" | "toggle" | "mark" | "pov";

const ACTIONS: Record<ShortcutAction, () => void> = {
    save: () => void recorder.save(),
    toggle: () => void recorder.toggle(),
    mark: () => recorder.mark(),
    pov: () => void requestPov()
};

/** Bumped on every stop, so a pump loop left over from a previous run exits. */
let generation = 0;
let running = false;

/** Last time each action ran, to swallow the duplicate from the DOM listener. */
const lastFired = new Map<ShortcutAction, number>();

/** Window in which the same action is not run twice, in ms. */
const DEDUPE_MS = 250;

/**
 * Runs an action unless the very same one just ran.
 *
 * A registered global bind is swallowed by the OS, so Discord normally never
 * sees the key. That is not guaranteed on every setup, hence the guard.
 */
export function runShortcut(action: ShortcutAction): boolean {
    const now = Date.now();
    if (now - (lastFired.get(action) ?? 0) < DEDUPE_MS) return false;

    lastFired.set(action, now);
    ACTIONS[action]();
    return true;
}

/** Registers the current binds with the OS and starts the pump loop. */
export async function startGlobalKeybinds(): Promise<void> {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    try {
        const { wayland } = await Native.getPlatformInfo();
        if (wayland) {
            logger.warn("Wayland ignores application-registered hotkeys, so the keybinds only fire while Discord is focused. Bind them in your compositor to a command instead, or use the chat bar button.");
        }
    } catch (e) {
        logger.warn("Could not read the platform info", e);
    }

    await syncGlobalKeybinds();

    // A picker cannot be shown a combination the OS is swallowing on our behalf,
    // so the registration steps aside for as long as one is open.
    watchKeybindSuspension(suspended => {
        if (!suspended) {
            void syncGlobalKeybinds();
            return;
        }

        Native.unregisterShortcuts().catch(e => logger.warn("Could not free the global keybinds", e));
    });

    if (running) return;
    running = true;

    const mine = ++generation;
    void pump(mine);
}

/** Pushes the configured binds to the main process, warning on the rejected ones. */
export async function syncGlobalKeybinds(): Promise<void> {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    const { saveKeybind, toggleKeybind, markKeybind, povKeybind, globalKeybinds } = settings.store;

    if (!globalKeybinds) {
        await Native.unregisterShortcuts().catch(e => logger.warn("Could not drop the global keybinds", e));
        return;
    }

    const binds = {
        save: toAccelerator(saveKeybind),
        toggle: toAccelerator(toggleKeybind),
        mark: toAccelerator(markKeybind),
        pov: toAccelerator(povKeybind)
    };

    for (const [action, bind] of [["save", saveKeybind], ["toggle", toggleKeybind], ["mark", markKeybind], ["pov", povKeybind]] as const) {
        if (bind && !binds[action]) {
            logger.warn(`"${formatKeybind(bind)}" cannot be registered system-wide, it only works while Discord is focused`);
        }
    }

    try {
        const failed = await Native.registerShortcuts(binds);

        if (failed.length) {
            logger.warn("Global keybinds refused by the system", failed);
            Toasts.show({
                id: Toasts.genId(),
                message: `Clipper: ${failed.join(", ")} is already taken by another app, it only works while Discord is focused`,
                type: Toasts.Type.FAILURE
            });
        }
    } catch (e) {
        logger.warn("Could not register the global keybinds", e);
    }
}

/** Drops the OS-level binds and stops the pump loop. */
export function stopGlobalKeybinds(): void {
    generation++;
    running = false;
    watchKeybindSuspension(null);

    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;
    Native.unregisterShortcuts().catch(e => logger.warn("Could not drop the global keybinds", e));
}

/**
 * Long-polls the main process for fired binds.
 *
 * Each call parks in the main process until a bind fires or the timeout hits,
 * so an idle client does no work at all.
 */
async function pump(mine: number): Promise<void> {
    while (mine === generation) {
        let action: ShortcutAction | null = null;

        try {
            action = await Native.waitForShortcut();
        } catch (e) {
            logger.warn("Global keybind listener failed, retrying", e);
            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        if (mine !== generation) return;
        if (action) runShortcut(action);
    }
}
