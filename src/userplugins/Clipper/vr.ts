/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - clipping from inside a headset, renderer half
 *
 * Two problems, and only one of them is the buttons.
 *
 * The buttons are the easy one. Somebody wearing a headset cannot see Discord,
 * cannot see the plugin's overlay - it is a window on a desktop nobody is
 * looking at - and usually cannot reach a keyboard either, so the global
 * keybinds are no use. ./vrBridge gets a press off a controller instead, and it
 * arrives here as one of the same actions a keybind fires, goes through the same
 * dispatcher, and gets the same debounce. Nothing downstream knows or cares
 * where the press came from.
 *
 * The harder one is that the automatic marker goes deaf and blind in VR. No VR
 * game reports its kills the way Counter-Strike does, so ./gameEvents has
 * nothing to listen to; and what ./gameVideo is watching is the desktop mirror
 * window, which is one eye, barrel-distorted, letterboxed, and sometimes not
 * being drawn at all. Both of the detectors that were meant to replace loudness
 * are worth very little here.
 *
 * What VR has instead is something no flat game gives up: where the player's
 * hands and head actually are, every frame, in metres and radians. A swing is a
 * hand moving at five metres a second, and no amount of sitting still and
 * talking produces that. So the third detector is the player's own body, and it
 * is the one signal in the whole plugin that is measured in real units against
 * real thresholds rather than against its own recent history.
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";

import { runShortcut } from "./globalKeybinds";
import { settings } from "./settings";
import { signals } from "./signals";
import type { VrEvent, VrStatus } from "./vrBridge";

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

const logger = new Logger("Clipper");

/*
 * Where a hand stops being a gesture and starts being a swing, in metres per
 * second, and where it is going as fast as anybody swings.
 *
 * Absolute numbers, not a baseline this drifts up to, and that is the whole
 * reason this detector is worth having. Every other one in the plugin measures a
 * thing against how loud or how busy it has been lately, because a pixel or a
 * decibel means nothing on its own. A hand is not like that: a metre per second
 * is a metre per second on every machine and in every game. Somebody sitting
 * talking with their hands runs at well under one; a swing in a rhythm game or a
 * punch in a boxing game runs at five and more.
 */
const HAND_FLOOR = 1.2;
const HAND_FULL = 5;

/** The same for the head turning, in radians per second. */
const HEAD_FLOOR = 1.5;
const HEAD_FULL = 5.5;

/** Bumped on every stop, so a pump left over from a previous run exits. */
let generation = 0;
let running = false;

function supported(): boolean {
    return IS_DISCORD_DESKTOP || IS_VESKTOP;
}

/** Straight-line scale from "not happening" to "as much as it gets". */
function scale(value: number, floor: number, full: number): number {
    if (value <= floor) return 0;
    return Math.min(1, (value - floor) / (full - floor));
}

/**
 * Starts the bridge, or stops it, to match the setting.
 *
 * Coming back with nothing attached is the normal case rather than a failure:
 * SteamVR is usually not running when Discord starts. ./vrBridge keeps trying by
 * itself from here on, so putting a headset on an hour later still works without
 * anything being toggled.
 */
export async function syncVr(): Promise<void> {
    if (!supported()) return;

    // The whole VR side is opt-in from outside Discord, through
    // VRinstaller.ps1. Somebody who has never run it has no VR settings to see
    // and nothing here ever runs, whatever the stored values happen to say.
    if (!settings.store.vrInstalled || !settings.store.vrControls) {
        stopVr();
        return;
    }

    let status: VrStatus;

    try {
        status = await Native.startVrBridge(true);
    } catch (e) {
        logger.warn("Could not start the SteamVR bridge", e);
        return;
    }

    if (status.problem) logger.warn(status.problem);
    else if (status.running) logger.info(`SteamVR ${status.runtime} is bound to the clip controls`);
    else logger.info(status.waiting || "Waiting for SteamVR to start");

    signals.claim("vr");

    if (running) return;
    running = true;

    const mine = ++generation;
    void pump(mine);
}

export function stopVr(): void {
    generation++;
    running = false;
    signals.release("vr");
    signals.report("hands", 0, "");
    signals.report("turn", 0, "");

    if (!supported()) return;

    try {
        // A promise, like every other call over IPC: a throw on the far side
        // never reaches the catch below, so it needs catching where it lands.
        void Promise.resolve(Native.stopVrBridge())
            .catch(e => logger.warn("Could not stop the SteamVR bridge", e));
    } catch (e) {
        logger.warn("Could not stop the SteamVR bridge", e);
    }
}

/**
 * Opens SteamVR's binding panel on the plugin's actions.
 *
 * Shown on the desktop as well as in the headset, because whoever pressed the
 * button in the Discord settings is looking at a monitor.
 */
export async function openVrBindings(): Promise<boolean> {
    if (!supported()) return false;

    try {
        return await Native.openVrBindings();
    } catch (e) {
        logger.warn("Could not open the SteamVR binding panel", e);
        return false;
    }
}

/** What to say about the VR side, and whether it is actually attached. */
export interface VrLine {
    /** One sentence for the toolbox and the settings panel. */
    text: string;
    /** Whether there is a SteamVR session right now. */
    attached: boolean;
}

/**
 * The state of the VR side, as a sentence and as a fact.
 *
 * Both together and from one call, because the panel needs both and they must
 * agree: reading whether the bridge is attached out of the wording of the
 * sentence is how a button that opens SteamVR's binding panel ends up enabled
 * while there is no SteamVR to open it on.
 */
export async function vrLine(): Promise<VrLine> {
    if (!settings.store.vrInstalled) return { text: "", attached: false };
    if (!supported()) return { text: "The SteamVR controls need the desktop client.", attached: false };
    if (!settings.store.vrControls) return { text: "The SteamVR controls are off. Turn them on in the Clipper settings.", attached: false };

    try {
        const status = await Native.vrBridgeStatus();

        /*
         * Said in the order they matter: something that needs doing about it,
         * then what is attached, then what is being waited for. Whether the
         * binding panel can be opened is a separate question with a separate
         * answer - a bridge can be attached and still have something wrong
         * with it, and that is exactly when somebody wants the panel.
         */
        if (status.problem) return { text: status.problem, attached: status.running };
        if (status.running) return { text: `SteamVR ${status.runtime} is bound to the clip controls. Rebind them from the SteamVR settings, under Controller Bindings, as Clipper.`, attached: true };

        // Whatever the bridge is waiting for, said in its own words - "SteamVR
        // is not running" and "no headset is connected" want different things
        // doing about them, and neither is a fault.
        const why = status.waiting || "Waiting for SteamVR to start";

        return { text: `${why}. Nothing else needs doing - put the headset on and the controls attach by themselves.`, attached: false };
    } catch (e) {
        return { text: `The SteamVR bridge could not be reached (${(e as Error).message}).`, attached: false };
    }
}

/** A line for the toolbox saying what is hooked up. */
export async function vrReport(): Promise<string> {
    return (await vrLine()).text;
}

/**
 * Long-polls the main process for presses and for where the hands are.
 *
 * The call parks over there until something happens or the timeout expires, so
 * an idle client does no work, and no work at all when there is no headset.
 */
async function pump(mine: number): Promise<void> {
    while (mine === generation) {
        let event: VrEvent | null = null;

        try {
            event = await Native.waitForVrEvent();
        } catch (e) {
            logger.warn("The SteamVR listener failed, retrying", e);
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        if (mine !== generation) return;
        if (!event) continue;

        if (event.kind === "action") {
            runShortcut(event.action);
            continue;
        }

        if (!settings.store.vrMotionWatch) continue;

        /*
         * Reported as levels rather than fired as events, because this is a
         * thing that is true for as long as it is true. ./signals forgets a
         * level a second after the last report, so a bridge that dies mid-swing
         * stops counting instead of holding the swing for ever.
         */
        const hands = scale(event.hands, HAND_FLOOR, HAND_FULL);
        const head = scale(event.head, HEAD_FLOOR, HEAD_FULL);

        signals.report("hands", hands, `hands moving at ${event.hands.toFixed(1)} m/s`);
        signals.report("turn", head, `looking around at ${event.head.toFixed(1)} rad/s`);
    }
}
