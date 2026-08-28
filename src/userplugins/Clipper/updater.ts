/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - updates
 *
 * The plugin is installed as a finished bundle, not from a store that keeps it
 * current, so it has to look after itself: every launch asks GitHub for the
 * newest release, and a newer one is offered - or taken, when the setting says
 * so - and written over the installed bundle by ./native.
 *
 * Nothing here downloads anything on its own. The check reads a release list;
 * the install only happens on `installUpdate`, which is either the user
 * pressing the button or the automatic setting being on.
 */

import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";
import { Alerts, Toasts } from "@webpack/common";

import type { UpdateInfo } from "./native";
import { settings } from "./settings";
import { toast as showToast } from "./toasts";
import { errorMessage } from "./utils";

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;
const logger = new Logger("Clipper");

/**
 * The version this bundle was built as.
 *
 * Bumped by hand, and read back by scripts\build-prebuilt.ps1, which stamps
 * it into prebuilt\build-info.json. The check compares it against the newest
 * release tag, so a build has to go out under the tag it names here: publish
 * this one as v4.1.0, or the clients already running it are offered it again.
 */
export const CLIPPER_VERSION = "4.1.0";

interface UpdateState {
    /** A check is in flight. */
    checking: boolean;
    /** The bundle is being fetched and swapped in. */
    installing: boolean;
    /** What the last check found, or null when none has finished. */
    latest: UpdateInfo | null;
    /** Why the last check or install failed, in one line. */
    error: string;
    /** True once an update has been written and only a restart is missing. */
    restartNeeded: boolean;
}

const state: UpdateState = {
    checking: false,
    installing: false,
    latest: null,
    error: "",
    restartNeeded: false
};

const listeners = new Set<() => void>();

export function updateState(): UpdateState {
    return state;
}

/** Subscribes to every change of the state above. Returns the unsubscribe. */
export function watchUpdates(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

function change(patch: Partial<UpdateState>): void {
    Object.assign(state, patch);
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (e) {
            logger.warn("An update listener threw", e);
        }
    }
}

/** An update failure is read once and dismissed, so it is given a moment. */
function toast(message: string, type: string): void {
    showToast(message, type, 6000);
}

/**
 * Whether the main process half of the plugin knows about updates.
 *
 * The renderer and the main bundle are loaded at different moments: reloading
 * the client window (Ctrl+R) picks up a freshly installed renderer while the
 * main process keeps the one it started with. A client in that state has an
 * updater in the window and none behind it, and calling through would throw a
 * TypeError at launch, which is exactly the moment nothing should shout.
 */
function nativeReady(): boolean {
    return typeof Native?.checkUpdate === "function" && typeof Native?.downloadUpdate === "function";
}

export const RESTART_FIRST = "Clipper was updated under a running client. Quit Discord completely and start it again.";

/**
 * Asks GitHub what the newest release is.
 *
 * Throws nothing: a client with no network, or a rate limit, must not turn a
 * launch into an error the user has to dismiss.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
    if (state.checking) return state.latest;

    if (!nativeReady()) {
        logger.info("The main process is still on an older Clipper, so the check waits for a full restart");
        change({ error: RESTART_FIRST });

        return null;
    }

    change({ checking: true, error: "" });

    try {
        const info = await Native.checkUpdate(CLIPPER_VERSION);
        change({ latest: info });

        logger.info(`Update check: installed ${CLIPPER_VERSION}, published ${info.version || "unknown"}`);

        return info;
    } catch (e) {
        logger.warn("Could not check for updates", e);
        change({ error: errorMessage(e) });

        return null;
    } finally {
        change({ checking: false });
    }
}

/**
 * Fetches a release and writes it over the installed bundle.
 *
 * The client keeps running on the bundle it loaded at startup, so nothing
 * changes until it restarts; that is what the modal at the end is for.
 */
export async function installUpdate(info: UpdateInfo, quiet = false): Promise<boolean> {
    if (state.installing) return false;

    if (!nativeReady()) {
        change({ error: RESTART_FIRST });
        if (!quiet) toast(RESTART_FIRST, Toasts.Type.FAILURE);

        return false;
    }

    if (!info.writable) {
        const message = `Clipper cannot write to ${info.directory}. Run install.bat again to update.`;
        change({ error: message });
        if (!quiet) toast(message, Toasts.Type.FAILURE);

        return false;
    }

    change({ installing: true, error: "" });
    if (!quiet) toast(`Downloading Clipper ${info.version}...`, Toasts.Type.MESSAGE);

    try {
        const files = await Native.downloadUpdate(info.tag);
        logger.info(`Installed Clipper ${info.version}: ${files.length} files replaced`);

        change({ restartNeeded: true });
        offerRestart(info);

        return true;
    } catch (e) {
        logger.error("Could not install the update", e);
        change({ error: errorMessage(e) });
        toast(`Could not install Clipper ${info.version}: ${errorMessage(e)}`, Toasts.Type.FAILURE);

        return false;
    } finally {
        change({ installing: false });
    }
}

/** Asks whether to restart now, since the new bundle only loads on a restart. */
function offerRestart(info: UpdateInfo): void {
    Alerts.show({
        title: `Clipper ${info.version} is ready`,
        body: "Discord has to restart to load it. Anything the capture buffer is holding right now is lost on restart, so save the clip first if there is one worth keeping.",
        confirmText: "Restart now",
        cancelText: "Later",
        onConfirm: () => {
            // Written down before it happens: a client that restarts by itself
            // is otherwise indistinguishable, in the log, from one that crashed.
            logger.info(`Restarting the client to load Clipper ${info.version}`);
            void Native.relaunchClient();
        }
    });
}

/** Offers the update found by a check, with the notes the release carries. */
function offerUpdate(info: UpdateInfo): void {
    Alerts.show({
        title: `Clipper ${info.version} is out`,
        body: `You are on ${CLIPPER_VERSION}.${info.notes ? `\n\n${info.notes}` : ""}`,
        confirmText: "Update now",
        cancelText: "Not now",
        onConfirm: () => void installUpdate(info)
    });
}

/**
 * The launch check.
 *
 * Called from the plugin's start(), and deliberately not awaited there: a slow
 * or unreachable GitHub must not hold up the buffer arming.
 */
export async function checkAtLaunch(): Promise<void> {
    if (!settings.store.updateCheck) return;

    const info = await checkForUpdate();
    if (!info?.available) return;

    if (!settings.store.updateAutomatic) {
        offerUpdate(info);
        return;
    }

    // Silent path: nothing is asked, and the only thing said is that a restart
    // is what is left to do.
    const installed = await installUpdate(info, true);
    if (!installed) offerUpdate(info);
    else {
        showNotification({
            title: `Clipper updated to ${info.version}`,
            body: "It loads on the next Discord restart."
        });
    }
}

/** The manual check, from the toolbox or the settings button. */
export async function checkNow(): Promise<void> {
    const info = await checkForUpdate();

    if (!info) {
        toast(
            state.error === RESTART_FIRST ? RESTART_FIRST : `Could not reach GitHub: ${state.error}`,
            Toasts.Type.FAILURE
        );
        return;
    }

    if (info.available) offerUpdate(info);
    else toast(`Clipper ${CLIPPER_VERSION} is the latest release.`, Toasts.Type.SUCCESS);
}

/** Restarts the client, for the settings button. */
export function restartClient(): void {
    if (typeof Native?.relaunchClient !== "function") {
        toast("Quit Discord from the tray icon and start it again.", Toasts.Type.FAILURE);
        return;
    }

    logger.info("Restarting the client, asked for from the settings");
    void Native.relaunchClient();
}
