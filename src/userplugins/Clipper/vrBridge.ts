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
 * stops again when they take it off - and none of that is an error.
 *
 * Which is why the retrying is not done here. One bridge process runs for as
 * long as the setting is on and does its own waiting, because restarting it
 * means recompiling its C# - a second of a core, and it was being paid four
 * times a minute for as long as somebody left Discord open with no headset on.
 * What is left here is a supervisor for the case the process actually dies.
 *
 * The bridge says which of three things is true, and only one of them is a
 * problem: attached, waiting for something outside anybody's control, or
 * stopped by something no amount of retrying fixes - a SteamVR too old for the
 * interfaces, an action manifest it will not take. Only the last is remembered
 * and repeated in the toolbox, and it is also the one case where no replacement
 * bridge is started: the next one would compile the same C# and fail the same
 * way, which is the fifteen-second cycle this file exists to avoid. The middle
 * one is a sentence about why, because "no headset is connected" and "SteamVR is
 * not running" want different things doing about them.
 *
 * There is a fourth thing it can say, and the distinction is the whole reason
 * the three above are not two: a warning is something wrong with a session that
 * is nonetheless attached and working. It is shown like a problem and retried
 * like an attachment, because the bridge after it is still worth starting.
 */

import { type ChildProcess, spawn } from "child_process";
import { app } from "electron";
import { writeFileSync } from "fs";
import { join } from "path";

import { SCRIPT } from "./vrHelper";
import { ACTION_SET, apiLibrary, APP_KEY, scriptPath, VR_ACTIONS, type VrAction, writeActionManifest, writeAppManifest } from "./vrManifest";

/**
 * How long to wait before starting another bridge, after one has died.
 *
 * Not how often SteamVR is tried: the bridge does that itself, from inside, for
 * the cost of a function call. This is the far rarer case of the process going
 * away - killed, crashed, or stopped by something it could not get past - and
 * fifteen seconds of nothing is the right answer to a thing that just failed.
 */
const RETRY_MS = 15_000;

/**
 * How long the bridge gets to come up before it is treated as stuck.
 *
 * Generous, because the first run of it compiles the C# helper, and a cold
 * .NET compiler on a machine that is also running a game is not quick.
 */
const READY_MS = 45_000;

/**
 * How many bridges may die without a word before the plugin stops starting them.
 *
 * A bridge that said anything - attached, or waiting, or why it gave up - is
 * understood, and what to do about it is known. One that exits having said
 * nothing is not: PowerShell refused the script, something killed it, the
 * machine is out of whatever it needed. Three of those is enough to conclude
 * that the fourth will go the same way, and each one costs a C# compile.
 */
const STILLBORN_LIMIT = 3;

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
    /** Why there is no session, when that is nobody's fault. */
    waiting: string;
}

export type VrEvent =
    | { kind: "action"; action: VrAction; }
    | { kind: "motion"; hands: number; head: number; };

let child: ChildProcess | null = null;
let wanted = false;
let runtime = "";
let problem = "";
let waiting = "";
/** Whether the last bridge stopped for a reason another one would hit too. */
let fatal = false;
/** Bridges that have died without ever saying anything at all. */
let stillborn = 0;
let retry: NodeJS.Timeout | null = null;

/**
 * Actions waiting to be collected, and the newest motion reading.
 *
 * Kept apart on purpose. A press is a thing that happened, and is kept until
 * somebody collects it; a motion reading is a thing that is true right now, and
 * the only one worth having is the last one. Delivering a queue of stale ones
 * would report a flail that finished several seconds ago.
 *
 * The press queue is bounded, and the oldest goes first. Nine unread presses
 * means nothing has collected any of them for several minutes, and replaying
 * the oldest of those at that point would save a clip of something long gone.
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

/**
 * Turns one line of the bridge's output into something to act on, and says
 * whether it was the bridge saying which way the start went.
 *
 * Returned rather than worked out afterwards from whether one of the three
 * strings is now set: a waiting line with an empty reason is still an answer,
 * and reading it as a string would leave the caller parked for the full
 * three-quarters of a minute the timeout allows.
 */
function line(text: string): boolean {
    const trimmed = text.trim();

    // PowerShell writes things of its own from time to time, and none of them
    // are ours. Anything that is not a JSON object is simply not for us.
    if (!trimmed.startsWith("{")) return false;

    let message: any;
    try {
        message = JSON.parse(trimmed);
    } catch {
        return false;
    }

    if (message.t === "ready") {
        runtime = String(message.runtime ?? "");
        problem = "";
        waiting = "";
        fatal = false;
        return true;
    }

    // Not attached, and nothing anybody did wrong: SteamVR is off, or it is on
    // with the headset still on the desk. Kept as a sentence rather than as a
    // problem, so the settings panel can say which it is.
    //
    // It clears the last problem as well, because the bridge is demonstrably
    // alive and accounting for itself. Without that, one stray line on
    // PowerShell's error stream outranks everything the bridge says for the rest
    // of the session - and on a machine with no headset there is never an attach
    // to clear it.
    if (message.t === "waiting") {
        runtime = "";
        problem = "";
        waiting = String(message.reason ?? "");
        return true;
    }

    // Attached, working, and something about it is wrong anyway. Shown like a
    // problem, but no reason to stop starting bridges: the session it is about
    // is running, and the next one deserves the same chance this one got.
    if (message.t === "warning") {
        problem = String(message.message ?? "The SteamVR bridge reported something wrong without saying what");
        return true;
    }

    // An error is by definition something no retry fixes: the bridge reports
    // everything it can wait out as waiting, from inside, without stopping. So
    // this both remembers the message and stops another bridge being started.
    if (message.t === "error") {
        problem = String(message.message ?? "The SteamVR bridge failed for a reason it did not give");
        fatal = true;
        return true;
    }

    if (message.t === "action") {
        const action = VR_ACTIONS.find(name => name === message.name);
        if (action) hand({ kind: "action", action });
        return false;
    }

    if (message.t === "motion") {
        hand({
            kind: "motion",
            hands: Number(message.hands) || 0,
            head: Number(message.head) || 0
        });
    }

    return false;
}

function later() {
    /*
     * Nothing is scheduled after a fatal stop. The bridge only reports one for
     * something a second bridge would hit as well, and a second bridge is a
     * PowerShell start and a C# compile - a little over a second of a core,
     * four times a minute, for as long as Discord stays open. On the machine
     * where the compile itself is what failed, that is every fifteen seconds
     * for nothing, for ever.
     *
     * Turning the setting off and on again clears it, which is where somebody
     * who has fixed the cause will go anyway.
     */
    if (retry || !wanted || fatal) return;

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
    waiting = "";

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
                // Attached, waiting or stopped: all three are an answer, and
                // the caller has been holding on since the process was started.
                if (line(one)) done();
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
                // Counted before the two are cleared, because whether this one
                // ever said anything is exactly what they hold.
                if (!runtime && !waiting && !fatal) {
                    if (++stillborn >= STILLBORN_LIMIT) {
                        fatal = true;
                        if (!problem) problem = `The SteamVR bridge stopped ${STILLBORN_LIMIT} times without saying why. Switch the VR controls off and on again to try it once more.`;
                    }
                } else stillborn = 0;

                child = null;
                runtime = "";
                waiting = "";
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
    waiting = "";
    fatal = false;
    stillborn = 0;
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
    return { running: child !== null && runtime !== "", wanted, runtime, problem, waiting };
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
