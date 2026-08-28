/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - keeping the SteamVR bridge alive, main process half
 *
 * ./vrHelper is the process that talks to OpenVR. This is the part that starts
 * it, restarts it, and turns its output back into something the renderer can
 * long-poll for - the same shape as the game feeds, for the same reason: nothing
 * pushes from the main process into a plugin's renderer code.
 *
 * The supervision matters more here than anywhere else in the plugin, because
 * the thing being supervised is only reachable some of the time. SteamVR is not
 * running when Discord starts, it starts when somebody puts a headset on, and it
 * stops again when they take it off - and none of that is an error. So a bridge
 * that cannot attach is not a failure to report to anybody, it is a retry in
 * fifteen seconds, quietly, for as long as the setting is on.
 *
 * The one thing that is worth saying out loud is a SteamVR too old to have the
 * interfaces, because no amount of retrying fixes that. It is remembered and
 * repeated in the toolbox rather than logged once at the moment nobody was
 * looking.
 */

import { type ChildProcess, spawn } from "child_process";
import { app } from "electron";
import { writeFileSync } from "fs";
import { join } from "path";

import { SCRIPT } from "./vrHelper";
import { ACTION_SET, apiLibrary, APP_KEY, scriptPath, VR_ACTIONS, type VrAction, writeActionManifest, writeAppManifest } from "./vrManifest";

/** How long to leave SteamVR alone before trying to attach again. */
const RETRY_MS = 15_000;

/**
 * How long the bridge gets to come up before it is treated as stuck.
 *
 * Generous, because the first run of it compiles the C# helper, and a cold
 * .NET compiler on a machine that is also running a game is not quick.
 */
const READY_MS = 45_000;

/** How long a bridge asked to stop gets to shut SteamVR down tidily. */
const GRACE_MS = 2000;

export interface VrStatus {
    /** Whether a bridge is attached to SteamVR right now. */
    running: boolean;
    /** Whether the plugin is meant to be attached, attached or not. */
    wanted: boolean;
    /** The SteamVR version the bridge reported, once it has. */
    runtime: string;
    /** The last thing that went wrong and is not just SteamVR being off. */
    problem: string;
}

export type VrEvent =
    | { kind: "action"; action: VrAction; }
    | { kind: "motion"; hands: number; head: number; };

let child: ChildProcess | null = null;
let wanted = false;
let runtime = "";
let problem = "";
let retry: NodeJS.Timeout | null = null;

/**
 * Actions waiting to be collected, and the newest motion reading.
 *
 * Kept apart on purpose. A press is a thing that happened and must not be lost
 * because the renderer was busy; a motion reading is a thing that is true right
 * now, and the only one worth having is the last one. Delivering a queue of
 * stale ones would report a flail that finished several seconds ago.
 */
let presses: VrAction[] = [];
let motion: VrEvent | null = null;
let waiters: Array<(event: VrEvent | null) => void> = [];

/**
 * The tail of the queue every start and stop is put through.
 *
 * Same reasoning as ./gameFeeds: a flag saying one is in flight is not enough,
 * because two callers waiting on the same flag both see it clear on the same
 * turn and both go on to spawn a process. Here that would mean two bridges
 * fighting over one SteamVR application key.
 */
let queue: Promise<unknown> = Promise.resolve();

function hand(event: VrEvent) {
    const next = waiters.shift();

    if (next) {
        next(event);
        return;
    }

    if (event.kind === "motion") {
        motion = event;
        return;
    }

    presses.push(event.action);
    if (presses.length > 8) presses.shift();
}

/** Turns one line of the bridge's output into something to act on. */
function line(text: string) {
    const trimmed = text.trim();

    // PowerShell writes things of its own from time to time, and none of them
    // are ours. Anything that is not a JSON object is simply not for us.
    if (!trimmed.startsWith("{")) return;

    let message: any;
    try {
        message = JSON.parse(trimmed);
    } catch {
        return;
    }

    if (message.t === "ready") {
        runtime = String(message.runtime ?? "");
        problem = "";
        return;
    }

    if (message.t === "error") {
        problem = String(message.message ?? "The SteamVR bridge failed for a reason it did not give");
        return;
    }

    if (message.t === "action") {
        const action = VR_ACTIONS.find(name => name === message.name);
        if (action) hand({ kind: "action", action });
        return;
    }

    if (message.t === "motion") {
        hand({
            kind: "motion",
            hands: Number(message.hands) || 0,
            head: Number(message.head) || 0
        });
    }
}

function later() {
    if (retry || !wanted) return;

    retry = setTimeout(() => {
        retry = null;
        if (wanted) void open();
    }, RETRY_MS);
}

/** Starts one bridge and waits for it to say which way it went. */
function open(): Promise<void> {
    if (child) return Promise.resolve();

    // SteamVR runs on Linux too, but the bridge is a Windows PowerShell script
    // compiling against the .NET Framework, so it does not. Reported as nothing
    // rather than as a problem: there is no advice to give somebody here.
    const api = process.platform === "win32" ? apiLibrary() : null;

    if (!api) {
        // Not a problem worth remembering: SteamVR gets installed, and when it
        // does this stops being true without anybody restarting anything.
        later();
        return Promise.resolve();
    }

    let started: ChildProcess;

    try {
        const script = scriptPath();
        writeFileSync(script, SCRIPT, "utf8");

        const shell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

        started = spawn(shell, [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-File", script,
            "-Api", api,
            "-Actions", writeActionManifest(),
            "-Manifest", writeAppManifest(shell),
            "-AppKey", APP_KEY,
            // The set first, then its actions, because a PowerShell parameter
            // takes one string far more reliably than it takes a list.
            "-ActionList", [ACTION_SET, ...VR_ACTIONS].join("|")
        ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
        problem = `The SteamVR bridge could not be started (${(e as Error).message}).`;
        later();
        return Promise.resolve();
    }

    child = started;
    runtime = "";

    return new Promise<void>(resolve => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
        };

        const timer = setTimeout(() => {
            problem = "The SteamVR bridge did not come up. Compiling it may have failed; nothing else is affected.";
            done();
        }, READY_MS);

        let rest = "";

        started.stdout?.on("data", (chunk: Buffer) => {
            rest += chunk.toString("utf8");

            const lines = rest.split("\n");
            rest = lines.pop() ?? "";

            for (const one of lines) {
                line(one);
                // Ready or failed, either way there is an answer to give back.
                if (runtime || problem) done();
            }
        });

        // Whatever PowerShell could not swallow. Kept only if nothing better is
        // known, so a real message from the bridge always wins.
        started.stderr?.on("data", (chunk: Buffer) => {
            if (!problem) problem = chunk.toString("utf8").trim().slice(0, 300);
        });

        started.on("error", e => {
            problem = `The SteamVR bridge could not be started (${e.message}).`;
            done();
        });

        started.on("exit", () => {
            if (child === started) {
                child = null;
                runtime = "";
            }

            // Every waiter is woken with nothing rather than left parked: the
            // renderer's poll would otherwise hang for its full timeout on every
            // pass while SteamVR is off.
            const parked = waiters;
            waiters = [];
            for (const wake of parked) wake(null);

            done();
            later();
        });
    });
}

function shut(): void {
    if (retry) {
        clearTimeout(retry);
        retry = null;
    }

    const going = child;
    child = null;
    runtime = "";
    presses = [];
    motion = null;

    const parked = waiters;
    waiters = [];
    for (const wake of parked) wake(null);

    if (!going) return;

    /*
     * Closing the pipe is the polite way: the bridge reads the end of its input
     * as an instruction to stop, and shuts its SteamVR session down on the way
     * out. Killing it outright leaves the application registration behind until
     * SteamVR notices the process is gone, so the kill is only the fallback.
     */
    try {
        going.stdin?.end();
    } catch {
        // Already closed, which is fine - the exit path below covers it.
    }

    const axe = setTimeout(() => {
        try {
            going.kill();
        } catch {
            // Gone on its own in the meantime.
        }
    }, GRACE_MS);

    going.on("exit", () => clearTimeout(axe));
}

/** Attaches to SteamVR, or stops trying to, and says where that got to. */
export function startBridge(want: boolean): Promise<VrStatus> {
    const run = queue.then(async (): Promise<VrStatus> => {
        wanted = want;

        if (!want) {
            shut();
            problem = "";
            return status();
        }

        await open();
        return status();
    });

    // The queue must not inherit a rejection, or every call after a failed one
    // would be dropped without running. The caller still gets the throw.
    queue = run.catch(() => undefined);

    return run;
}

export function closeBridge(): Promise<void> {
    const run = queue.then(() => {
        wanted = false;
        shut();
    });

    queue = run.catch(() => undefined);

    return run;
}

export function status(): VrStatus {
    return { running: child !== null && runtime !== "", wanted, runtime, problem };
}

/**
 * Opens SteamVR's own binding panel on this plugin's actions.
 *
 * There is no in-headset interface of the plugin's own anywhere in here, and
 * that is the design rather than a gap in it: SteamVR already owns the screen
 * every VR game is rebound from, people know how to work it, and a binding it
 * writes survives this plugin being uninstalled and reinstalled.
 */
export function openBindings(): boolean {
    if (!child?.stdin?.writable) return false;

    try {
        child.stdin.write("bindings\n");
        return true;
    } catch {
        return false;
    }
}

/** Resolves with the next thing the headset did, or null once the timeout passes. */
export function waitForVrEvent(timeoutMs = 30_000): Promise<VrEvent | null> {
    const press = presses.shift();
    if (press) return Promise.resolve({ kind: "action", action: press });

    if (motion) {
        const held = motion;
        motion = null;
        return Promise.resolve(held);
    }

    return new Promise(resolve => {
        let done = false;

        const settle = (event: VrEvent | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(event);
        };

        const timer = setTimeout(() => {
            waiters = waiters.filter(w => w !== settle);
            settle(null);
        }, timeoutMs);

        waiters.push(settle);
    });
}

// A bridge outlives the window it was started for otherwise, and it holds a
// SteamVR application registration while it does. Not waited on: nothing here
// can hold the quit open, and the pipe closing stops it either way.
app.on("will-quit", () => void closeBridge());
