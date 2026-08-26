/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - per-application volume, on the main process
 *
 * Windows mixes every application into one endpoint stream, and that stream is
 * what both the speakers and the loopback capture get. Nothing in Chromium can
 * take the music back out of it: `getDisplayMedia` hands over the mix, already
 * mixed, which is why the plugin's own mixer has one "system sound" slider for
 * the lot of it.
 *
 * Windows itself does keep the applications apart, one step earlier. Every
 * process that plays sound has an audio session on the endpoint - the same list
 * the volume mixer shows - carrying its own volume, its own mute and its own
 * peak meter. Setting a session's volume changes what that application feeds
 * into the mix, which means it changes the recording as well as the speakers.
 * That is the whole trick behind the Spotify slider: the music cannot be pulled
 * out of the clip afterwards, but it can be made quieter before it goes in.
 *
 * Reaching those sessions means COM interfaces (IAudioSessionManager2,
 * ISimpleAudioVolume, IAudioMeterInformation) that Node cannot call and that
 * would otherwise need a compiled addon - which this plugin, shipped as a
 * bundle of JavaScript, has no way to build or ship. So it borrows a compiler
 * that is already on every Windows machine: one PowerShell process, handed the
 * interface declarations once, then kept alive and spoken to over its stdin.
 *
 * Kept alive, because that first hand-off costs a second and a half of C#
 * compilation and a meter is polled several times a second; and killed again
 * after a minute of silence, because a PowerShell holding a COM enumerator is
 * thirty megabytes nobody asked for while nothing is looking at the mixer.
 *
 * The script is passed as an encoded command rather than written to a file: a
 * plugin that drops a script in the temp folder and runs it is indistinguishable
 * from something a user should be worried about, and this way there is nothing
 * on disk to be worried about.
 */

import { type ChildProcess, spawn } from "child_process";

const IS_WINDOWS = process.platform === "win32";

/** How long one command may take before the helper is treated as wedged. */
const COMMAND_MS = 5_000;
/** Silence after which the helper is shut down. Restarted on the next call. */
const IDLE_MS = 60_000;
/** Marks the end of a reply, so a multi-line list is read as one answer. */
const END = "--end--";

/** One process playing sound, as Windows' own volume mixer sees it. */
export interface AppAudioSession {
    pid: number;
    /** Process name without its extension, as `Spotify` or `chrome`. */
    process: string;
    /** Session volume, 0 to 1. Independent of the master volume. */
    volume: number;
    muted: boolean;
    /** Loudest sample since the last read, 0 to 1. Zero means silent, not stopped. */
    peak: number;
}

/*
 * The helper, in one string.
 *
 * C# because these interfaces are IUnknown-only: PowerShell can hold the COM
 * pointers but cannot call through them without the declarations, and the
 * enumeration is a dozen calls per pass that are better spent inside one method
 * than marshalled back and forth.
 *
 * Written to stay small: it travels on a command line, and Windows caps that at
 * about 32,000 characters once it has been base64'd from UTF-16.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -Language CSharp @"
using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
namespace ClipperAudio {
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class Enumerator { }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection devices);
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
}
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection { int GetCount(out int count); int Item(int i, out IMMDevice device); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr par, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IManager { int Skip1(); int Skip2(); int GetSessionEnumerator(out ISessions list); }
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ISessions { int GetCount(out int count); int GetSession(int i, out IControl session); }
[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IControl {
  int GetState(out int state); int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string n);
  int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string v, ref Guid c);
  int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string n);
  int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string v, ref Guid c);
  int GetGroupingParam(out Guid g); int SetGroupingParam(ref Guid g, ref Guid c);
  int Skip1(); int Skip2();
  int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string n);
  int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string n);
  int GetProcessId(out uint pid); int IsSystemSoundsSession(); int SetDuckingPreference(bool o);
}
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IVolume {
  int SetMasterVolume(float level, ref Guid c); int GetMasterVolume(out float level);
  int SetMute(bool mute, ref Guid c); int GetMute(out bool mute);
}
[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMeter { int GetPeakValue(out float peak); }
public static class Mixer {
  static Guid iid = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
  static Guid none = Guid.Empty;
  static System.Collections.Generic.List<ISessions> Open() {
    // Every active output, not just the default one: a headset on the front
    // panel and speakers on the back are two endpoints, an application plays
    // into whichever it was given, and a mute written to the wrong one is a
    // mute the user watches do nothing.
    IMMDeviceCollection outputs;
    Marshal.ThrowExceptionForHR(((IMMDeviceEnumerator)(new Enumerator())).EnumAudioEndpoints(0, 1, out outputs));
    int count;
    Marshal.ThrowExceptionForHR(outputs.GetCount(out count));
    System.Collections.Generic.List<ISessions> all = new System.Collections.Generic.List<ISessions>();
    for (int i = 0; i < count; i++) {
      IMMDevice device;
      if (outputs.Item(i, out device) != 0) continue;
      object manager;
      if (device.Activate(ref iid, 1, IntPtr.Zero, out manager) != 0) continue;
      ISessions list;
      if (((IManager)manager).GetSessionEnumerator(out list) != 0) continue;
      all.Add(list);
    }
    return all;
  }
  static string Name(uint pid) {
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
  }
  static string Num(float value) { return value.ToString("0.###", CultureInfo.InvariantCulture); }
  public static string List() {
    StringBuilder text = new StringBuilder();
    foreach (ISessions list in Open()) {
      int count;
      if (list.GetCount(out count) != 0) continue;
      for (int i = 0; i < count; i++) {
        IControl session;
        if (list.GetSession(i, out session) != 0) continue;
        int state;
        // Expired means the process that owned it is gone: the entry lingers
        // for a while and would keep a row on screen with nothing behind it.
        if (session.GetState(out state) == 0 && state == 2) continue;
        uint pid;
        if (session.GetProcessId(out pid) != 0 || pid == 0) continue;
        string name = Name(pid);
        if (name.Length == 0) continue;
        float level = 0, peak = 0; bool muted = false;
        IVolume volume = (IVolume)session;
        volume.GetMasterVolume(out level); volume.GetMute(out muted);
        ((IMeter)session).GetPeakValue(out peak);
        text.Append(pid).Append('\t').Append(name).Append('\t').Append(Num(level))
            .Append('\t').Append(muted ? 1 : 0).Append('\t').Append(Num(peak)).Append('\n');
      }
    }
    return text.ToString();
  }
  public static int Apply(string process, float level, int mute) {
    int touched = 0;
    foreach (ISessions list in Open()) {
      int count;
      if (list.GetCount(out count) != 0) continue;
      for (int i = 0; i < count; i++) {
        IControl session;
        if (list.GetSession(i, out session) != 0) continue;
        int state;
        if (session.GetState(out state) == 0 && state == 2) continue;
        uint pid;
        if (session.GetProcessId(out pid) != 0 || pid == 0) continue;
        if (!string.Equals(Name(pid), process, StringComparison.OrdinalIgnoreCase)) continue;
        IVolume volume = (IVolume)session;
        if (level >= 0) volume.SetMasterVolume(level, ref none);
        if (mute >= 0) volume.SetMute(mute == 1, ref none);
        touched++;
      }
    }
    return touched;
  }
}
}
"@
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line -or $line -eq "quit") { break }
    try {
        $parts = $line.Split(" ")
        if ($parts[0] -eq "list") {
            [ClipperAudio.Mixer]::List()
        } elseif ($parts[0] -eq "apply") {
            $touched = [ClipperAudio.Mixer]::Apply($parts[1], [float] $parts[2], [int] $parts[3])
            "ok $touched"
        } else {
            "error unknown command"
        }
    } catch {
        "error $($_.Exception.Message -replace '\r?\n', ' ')"
    }
    "--end--"
    [Console]::Out.Flush()
}
`;

let helper: ChildProcess | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

/** Replies are read line by line; this holds the one being assembled. */
let lines: string[] = [];
let waiting: { resolve(reply: string[]): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout>; } | null = null;

/** One command at a time: the protocol has no request ids, the queue is the ordering. */
let chain: Promise<unknown> = Promise.resolve();

/**
 * Set once the helper has failed to start.
 *
 * A machine that refuses to run PowerShell refuses it every time, and the mixer
 * polls: without this the failure would be a process spawn, a compile attempt
 * and a log line several times a second.
 */
let broken = false;

/**
 * Commands that failed in a row.
 *
 * A machine in constrained language mode, or one whose policy blocks Add-Type,
 * starts the helper happily and loses it the moment the script runs - so the
 * spawn succeeds and every command dies with it. Without a count of those, a
 * mixer left open would start a PowerShell every four hundred milliseconds
 * forever.
 */
let strikes = 0;
const STRIKES = 3;

function start(): ChildProcess {
    if (helper) return helper;

    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");

    const child = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-EncodedCommand", encoded
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    child.stdout?.setEncoding("utf8");

    let pending = "";
    child.stdout?.on("data", (chunk: string) => {
        pending += chunk;

        // Split on the newline, keep the remainder: a reply can arrive in as
        // many pieces as the pipe feels like, mid-line included.
        const parts = pending.split(/\r?\n/);
        pending = parts.pop() ?? "";

        for (const line of parts) {
            if (line === END) {
                const reply = lines;
                lines = [];
                finish(reply);
            } else {
                lines.push(line);
            }
        }
    });

    child.on("exit", () => {
        if (helper === child) helper = null;
        fail(new Error("The volume helper stopped"));
    });

    child.on("error", e => {
        broken = true;
        if (helper === child) helper = null;
        fail(e instanceof Error ? e : new Error(String(e)));
    });

    helper = child;

    return child;
}

function finish(reply: string[]): void {
    const answer = waiting;
    waiting = null;
    strikes = 0;

    if (!answer) return;

    clearTimeout(answer.timer);
    answer.resolve(reply);
}

function fail(e: Error): void {
    const answer = waiting;
    waiting = null;
    lines = [];

    if (!answer) return;

    if (++strikes >= STRIKES) {
        broken = true;
        console.warn(`[Clipper] Giving up on the per-application volume: ${STRIKES} commands in a row failed.`, e);
    }

    clearTimeout(answer.timer);
    answer.reject(e);
}

function keepWarm(): void {
    if (idle) clearTimeout(idle);

    idle = setTimeout(() => {
        idle = null;
        stopAppVolumeHelper();
    }, IDLE_MS);
}

/** Sends one command and waits for its reply. Queued behind the ones before it. */
function ask(command: string): Promise<string[]> {
    const run = async (): Promise<string[]> => {
        const child = start();
        if (!child.stdin?.writable) throw new Error("The volume helper is not accepting commands");

        keepWarm();

        return await new Promise<string[]>((resolve, reject) => {
            waiting = {
                resolve,
                reject,
                timer: setTimeout(() => {
                    // Wedged rather than slow: a helper that has not answered in
                    // five seconds is holding a COM call that will not return,
                    // and the next command would queue behind it forever.
                    fail(new Error(`The volume helper did not answer "${command}"`));
                    stopAppVolumeHelper();
                }, COMMAND_MS)
            };

            child.stdin!.write(`${command}\n`, e => {
                if (e) fail(e);
            });
        });
    };

    // Chained on the previous call whatever happened to it, so one failure does
    // not stall every command after it.
    const next = chain.then(run, run);
    chain = next.catch(() => void 0);

    return next;
}

/** Every process that currently has an audio session on the default output. */
export async function listAppSessions(): Promise<AppAudioSession[]> {
    if (!IS_WINDOWS || broken) return [];

    const reply = await ask("list");
    const sessions: AppAudioSession[] = [];

    for (const line of reply) {
        if (line.startsWith("error ")) throw new Error(line.slice(6));

        const [pid, name, volume, muted, peak] = line.split("\t");
        if (!name) continue;

        sessions.push({
            pid: Number(pid) || 0,
            process: name,
            volume: Number(volume) || 0,
            muted: muted === "1",
            peak: Number(peak) || 0
        });
    }

    return sessions;
}

/**
 * Sets one application's volume and mute, by process name.
 *
 * By name rather than by pid because a browser or a music player is several
 * processes and any of them may hold the session, and because the pid changes
 * every time the application is restarted while the slider does not. Answers
 * with how many sessions were touched, which is zero when the application is
 * not playing anything.
 *
 * `level` below zero leaves the volume alone, `mute` below zero leaves the mute
 * alone, so one call can do either or both.
 */
export async function applyAppVolume(name: string, level: number, mute: number): Promise<number> {
    if (!IS_WINDOWS || broken) return 0;

    // The name reaches PowerShell as a bare argument on a line it splits on
    // spaces; a process name has neither, and anything else is not one.
    if (!/^[\w.-]{1,64}$/.test(name)) throw new Error(`Not a process name: ${name}`);

    const reply = await ask(`apply ${name} ${level.toFixed(3)} ${Math.trunc(mute)}`);
    const answer = reply.find(line => line.startsWith("ok ") || line.startsWith("error "));

    if (!answer) throw new Error("The volume helper gave no answer");
    if (answer.startsWith("error ")) throw new Error(answer.slice(6));

    return Number(answer.slice(3)) || 0;
}

/** Shuts the helper down. It starts again by itself on the next command. */
export function stopAppVolumeHelper(): void {
    if (idle) clearTimeout(idle);
    idle = null;

    const child = helper;
    helper = null;

    if (!child) return;

    try {
        child.stdin?.write("quit\n");
        child.stdin?.end();
    } catch {
        // Already gone; the kill below is what matters.
    }

    child.kill();
}
