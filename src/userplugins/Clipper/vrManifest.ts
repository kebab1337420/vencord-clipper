/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - what SteamVR has to be handed before it will take a bind
 *
 * SteamVR does not let an application invent its own binding screen, and it does
 * not need to: it already has one, the same panel every VR game is rebound from,
 * and it is driven entirely by two JSON files on disk.
 *
 *   - an action manifest names the things the plugin can be asked to do, in the
 *     abstract - "save a clip" - with no button attached to any of them;
 *   - a binding file suggests which button each one starts on, per controller,
 *     and is the file SteamVR rewrites when somebody changes a bind.
 *
 * Plus an application manifest, which is what gives the plugin a name in that
 * panel instead of it appearing as "powershell.exe". It is registered as
 * temporary: nothing is written into SteamVR's permanent application list, and
 * the registration is gone the moment the bridge exits.
 *
 * All three are generated here rather than shipped as files, because the paths
 * inside them are absolute and only known at runtime.
 */

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * How the plugin is known to SteamVR.
 *
 * Also written into every binding file: SteamVR matches a binding to an
 * application by this key, so the two must agree or the defaults are ignored.
 */
export const APP_KEY = "vencord.clipper";

/** The action set everything below hangs off. */
export const ACTION_SET = "/actions/clipper";

/**
 * The actions offered, in the order they appear in the SteamVR panel.
 *
 * Deliberately the same vocabulary as the global keybinds, so a press coming out
 * of a headset and a press coming off a keyboard end up in the same dispatcher
 * with the same debounce.
 *
 * `replay` is missing on purpose: it opens a window on the desktop, and nobody
 * wearing a headset can see the desktop.
 *
 * All four are offered; only the first two start on a button. An action nobody
 * has bound costs nothing at all - it sits in the panel waiting to be given a
 * button, which is where somebody who wants it will go looking.
 */
export const VR_ACTIONS = ["save", "mark", "toggle", "pov"] as const;

/**
 * The two that get a button out of the box.
 *
 * A controller has about four buttons that are not already the game's, and a
 * default binding is a button taken from whatever is being played. Two is what
 * the plugin is actually for - clip that, and mark this - and the other two are
 * worth a trip to the binding panel by anybody who wants them.
 */
const BOUND_BY_DEFAULT = ["save", "mark"] as const;

export type VrAction = typeof VR_ACTIONS[number];

const ACTION_NAMES: Record<VrAction, string> = {
    save: "Save a clip",
    mark: "Drop a marker",
    toggle: "Start / stop the clip buffer",
    pov: "Ask the call for their angle"
};

/** Where the generated files go. Next to the overlay pages, and just as disposable. */
function folder(): string {
    const dir = join(app.getPath("userData"), "clipper-vr");
    mkdirSync(dir, { recursive: true });

    return dir;
}

/**
 * Where SteamVR is installed.
 *
 * `openvrpaths.vrpath` is the runtime's own record of itself, written by
 * whichever SteamVR was installed last, and reading it is the only way to find a
 * copy that is not under the default Steam folder. Several runtimes can be
 * listed - a Steam one and a standalone one, or the same path twice in different
 * case, which is what a real machine looks like - so the first that is actually
 * on disk wins.
 */
function runtimePath(): string | null {
    const registry = join(process.env.LOCALAPPDATA ?? "", "openvr", "openvrpaths.vrpath");

    try {
        const listed = JSON.parse(readFileSync(registry, "utf8")).runtime;

        if (Array.isArray(listed)) {
            for (const path of listed) {
                if (typeof path === "string" && existsSync(join(path, "bin", "win64", "openvr_api.dll"))) return path;
            }
        }
    } catch {
        // No file, or not JSON: SteamVR has never run here. Fall through to the
        // default install, which is where it would be if it had.
    }

    const fallback = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
        "Steam", "steamapps", "common", "SteamVR");

    return existsSync(join(fallback, "bin", "win64", "openvr_api.dll")) ? fallback : null;
}

/** The runtime library itself, which is what the bridge loads. */
export function apiLibrary(): string | null {
    const runtime = runtimePath();
    return runtime && join(runtime, "bin", "win64", "openvr_api.dll");
}

/**
 * How long a long press has to be held, in seconds.
 *
 * `long_press_delay` and a number, both of which matter: an earlier version of
 * this wrote `long_press_time` and the string "0.4", and SteamVR ignores a
 * parameter it does not know without saying anything, so the hold silently ran
 * at whatever the default is. The name and the shape are SteamVR's own, out of
 * the binding files it ships with.
 */
const LONG_PRESS = 0.4;

/**
 * How each of the two defaults is activated.
 *
 * Here rather than at the call site so that BOUND_BY_DEFAULT is the one place
 * the defaults are listed: adding a third is this line, the button, and nothing
 * else.
 */
const ACTIVATORS: Record<typeof BOUND_BY_DEFAULT[number], "double" | "long"> = {
    save: "double",
    mark: "long"
};

/**
 * One suggested binding, in the shape SteamVR's binding files use.
 *
 * A double click or a long press rather than a plain click, because a single
 * press of a face button belongs to the game being played. A default that fired
 * every time somebody reloaded would be worse than no default at all.
 */
function source(path: string, activator: "double" | "long", action: VrAction) {
    return {
        path,
        mode: "button",
        inputs: { [activator]: { output: `${ACTION_SET}/in/${action}` } },
        parameters: activator === "long" ? { long_press_delay: LONG_PRESS } : {}
    };
}

/**
 * The default binding file for one controller.
 *
 * Two sources, both on the right hand, and nothing on the left. Everything else
 * the plugin can do is in the panel this file opens in, unbound.
 */
function bindings(controller: string, buttons: Record<typeof BOUND_BY_DEFAULT[number], string>) {
    return {
        app_key: APP_KEY,
        controller_type: controller,
        description: "Where Clipper's two default binds start out. Change them here, and add the rest.",
        name: "Clipper defaults",
        action_manifest_version: 0,
        bindings: {
            [ACTION_SET]: {
                sources: BOUND_BY_DEFAULT.map(action => source(buttons[action], ACTIVATORS[action], action))
            }
        }
    };
}

/**
 * Writes the action manifest and the default bindings, and hands back the path
 * to the manifest.
 *
 * Only two controllers get defaults, and only two actions do. They are the two
 * controllers most people are holding, and the two things the plugin is for;
 * everything else - the other actions, and every other controller - starts
 * unbound, which is the state the binding panel exists to fix.
 */
export function writeActionManifest(): string {
    const dir = folder();

    const localization: Record<string, string> = { language_tag: "en_US", [ACTION_SET]: "Clipper" };
    for (const action of VR_ACTIONS) localization[`${ACTION_SET}/in/${action}`] = ACTION_NAMES[action];

    const manifest = {
        default_bindings: [
            { controller_type: "knuckles", binding_url: "bindings_knuckles.json" },
            { controller_type: "oculus_touch", binding_url: "bindings_oculus_touch.json" }
        ],
        action_sets: [{ name: ACTION_SET, usage: "leftright" }],
        // Every one of them optional, including the two with a default: the
        // plugin has to work with nothing bound at all, because that is what a
        // controller SteamVR has no default file for looks like. "optional" and
        // "mandatory" are also the only two SteamVR itself ships.
        actions: VR_ACTIONS.map(action => ({
            name: `${ACTION_SET}/in/${action}`,
            type: "boolean",
            requirement: "optional"
        })),
        localization: [localization]
    };

    // A and B on the right hand, which both of these controllers have in the
    // same place under the thumb. The left hand is left entirely alone.
    const buttons = {
        save: "/user/hand/right/input/b",
        mark: "/user/hand/right/input/a"
    };

    writeFileSync(join(dir, "bindings_knuckles.json"), JSON.stringify(bindings("knuckles", buttons), null, 4), "utf8");
    writeFileSync(join(dir, "bindings_oculus_touch.json"), JSON.stringify(bindings("oculus_touch", buttons), null, 4), "utf8");

    const path = join(dir, "actions.json");
    writeFileSync(path, JSON.stringify(manifest, null, 4), "utf8");

    return path;
}

/**
 * Writes the application manifest, which is what puts a name on the panel.
 *
 * `binary_path_windows` is how SteamVR ties a running process to this key, so it
 * has to be the interpreter that is actually running, not the script. The plugin
 * never wants to be launched by SteamVR - it is launched by Discord, and only
 * while a headset is on - so there is no autostart here and none is asked for
 * anywhere else.
 */
export function writeAppManifest(binary: string): string {
    const manifest = {
        source: "builtin",
        applications: [{
            app_key: APP_KEY,
            launch_type: "binary",
            binary_path_windows: binary,
            is_dashboard_overlay: false,
            strings: {
                en_us: {
                    name: "Clipper",
                    description: "Clip what just happened, from the controller."
                }
            }
        }]
    };

    const path = join(folder(), "clipper.vrmanifest");
    writeFileSync(path, JSON.stringify(manifest, null, 4), "utf8");

    return path;
}

/** Where the bridge script is written, so both halves agree on one path. */
export function scriptPath(): string {
    return join(folder(), "bridge.ps1");
}
