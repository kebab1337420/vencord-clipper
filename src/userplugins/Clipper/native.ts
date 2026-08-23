/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - main process helper
 *
 * Renderer code cannot touch the file system, so clip bytes are handed over
 * here and written to the folder chosen in the settings.
 */

import { app, desktopCapturer, dialog, globalShortcut, type IpcMainInvokeEvent, session, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, extname, isAbsolute, join } from "path";

/*
 * Windows Graphics Capture is the only backend that reports "not capturable"
 * per window, and loopback audio through `getDisplayMedia` is Windows-only as
 * well, so both behaviours are gated on the platform rather than assumed.
 */
const IS_WINDOWS = process.platform === "win32";

/**
 * Wayland has no window list: `desktopCapturer.getSources` goes through the
 * xdg-desktop-portal, which pops a system dialog on every single call. Listing
 * is therefore skipped entirely there and the renderer falls back to plain
 * `getDisplayMedia`, which is what the portal expects anyway.
 */
const IS_WAYLAND = process.platform === "linux"
    && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);

/**
 * Vesktop (and its forks) install their own display-media handler at startup
 * for their picker and their Linux audio capture. Electron only keeps one, and
 * it cannot be read back, so overwriting it would break their screen share
 * until the app restarts. The renderer says which client it runs in; the app
 * name is a backstop for the case it does not.
 */
const IS_VESKTOP_APP = /vesktop|equibop/i.test(app.getName());

function resolveDirectory(dir: string): string {
    const trimmed = dir?.trim();
    if (trimmed && isAbsolute(trimmed)) return trimmed;

    return join(app.getPath("videos"), "DiscordClips");
}

/**
 * Reduces a clip name to a plain file name in the clip folder.
 *
 * The name comes from the renderer, and everything a plugin exports here is
 * callable from there, so a name is never trusted with a directory component or
 * an extension of its own choosing: `..\..\autorun.bat` must not escape the clip
 * folder, and nothing but a video file may be written.
 */
function safeClipName(name: string): string {
    const flat = basename(String(name ?? "").replace(/[\\/]/g, "_")).trim();
    const cleaned = flat.replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/^\.+/, "");

    // Parentheses are allowed because the de-duplicating suffix uses them, and
    // png because the editor saves single frames next to the clips.
    const match = /^([\w.\-+ ()[\]]{1,120})\.(webm|mp4|png)$/i.exec(cleaned);
    if (match) return `${match[1]}.${match[2].toLowerCase()}`;

    return `clip-${Date.now()}.webm`;
}

/** Appends " (2)", " (3)"... until the name is free, so nothing is overwritten. */
function freePath(dir: string, name: string): string {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);

    let path = join(dir, name);
    for (let i = 2; existsSync(path) && i < 1000; i++) path = join(dir, `${stem} (${i})${ext}`);

    return path;
}

/**
 * Writes a clip and returns the absolute path it landed on.
 *
 * `keep` never overwrites an existing file: the editor exports under a name
 * derived from the source clip, which collides as soon as the same clip is
 * trimmed twice.
 */
export function saveClip(_: IpcMainInvokeEvent, dir: string, name: string, data: Uint8Array, keep = false): string {
    const target = resolveDirectory(dir);
    mkdirSync(target, { recursive: true });

    const safe = safeClipName(name);
    const path = keep ? freePath(target, safe) : join(target, safe);

    writeFileSync(path, Buffer.from(data));
    return path;
}

export interface StoredClip {
    name: string;
    path: string;
    size: number;
    /** Last modification, epoch ms. */
    modified: number;
}

/** Clips found in the folder, newest first. */
export function listClips(_: IpcMainInvokeEvent, dir: string): StoredClip[] {
    const target = resolveDirectory(dir);
    if (!existsSync(target)) return [];

    const clips: StoredClip[] = [];

    for (const entry of readdirSync(target, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(webm|mp4)$/i.test(entry.name)) continue;

        const path = join(target, entry.name);
        try {
            const stat = statSync(path);
            clips.push({ name: entry.name, path, size: stat.size, modified: stat.mtimeMs });
        } catch {
            // Deleted between the listing and the stat, or unreadable: skip it.
        }
    }

    return clips.sort((a, b) => b.modified - a.modified);
}

/**
 * Reads one clip back for the editor.
 *
 * The name goes through the same sanitiser as a write, so the renderer can only
 * ever read a video file sitting directly in the clip folder.
 */
export function readClip(_: IpcMainInvokeEvent, dir: string, name: string): Uint8Array {
    const path = join(resolveDirectory(dir), safeClipName(name));
    return new Uint8Array(readFileSync(path));
}

/** Moves a clip to the trash, so a mis-click stays undoable. */
export async function deleteClip(_: IpcMainInvokeEvent, dir: string, name: string): Promise<void> {
    const path = join(resolveDirectory(dir), safeClipName(name));

    try {
        await shell.trashItem(path);
    } catch {
        // No trash available (some Linux setups, network drives): delete outright.
        unlinkSync(path);
    }
}

/** Renames a clip inside the folder. Returns the name it ended up with. */
export function renameClip(_: IpcMainInvokeEvent, dir: string, name: string, next: string): string {
    const target = resolveDirectory(dir);
    const from = join(target, safeClipName(name));

    // The extension is the source of truth for the container, so it is kept
    // whatever the user typed.
    const ext = extname(safeClipName(name));
    const wanted = safeClipName(next.toLowerCase().endsWith(ext) ? next : next + ext);

    const to = freePath(target, wanted);
    renameSync(from, to);

    return basename(to);
}

/*
 * Clip metadata lives in one JSON file next to the clips rather than in the
 * plugin settings: the folder is what the user backs up, moves or shares, and
 * metadata that stayed behind in Vencord's settings would be lost the moment
 * the folder moved. It is also the only place a per-clip category can survive a
 * Vencord reinstall.
 */
const LIBRARY_FILE = "clipper-library.json";

/** Raw metadata document, kept opaque here: the renderer owns its shape. */
export function readLibrary(_: IpcMainInvokeEvent, dir: string): string {
    const path = join(resolveDirectory(dir), LIBRARY_FILE);
    if (!existsSync(path)) return "";

    try {
        return readFileSync(path, "utf8");
    } catch {
        // Unreadable or mid-write: the renderer treats this as an empty library
        // rather than losing the clips it is listing.
        return "";
    }
}

export function writeLibrary(_: IpcMainInvokeEvent, dir: string, json: string): void {
    const target = resolveDirectory(dir);
    mkdirSync(target, { recursive: true });

    // A metadata file is small, but it is rewritten on every tag change while
    // clips may be recording: write beside it and rename, so a crash mid-write
    // leaves the previous document intact instead of a truncated one.
    const path = join(target, LIBRARY_FILE);
    const temp = `${path}.tmp`;

    writeFileSync(temp, String(json ?? ""), "utf8");
    renameSync(temp, path);
}

/** Native picker for videos to drop on the studio timeline. */
export async function pickVideoFiles(_: IpcMainInvokeEvent): Promise<string[]> {
    const result = await dialog.showOpenDialog({
        title: "Add videos to the timeline",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Video", extensions: ["mp4", "webm", "mkv", "mov", "m4v"] }]
    });

    return result.canceled ? [] : result.filePaths;
}

/**
 * Reads a video the user picked, by absolute path.
 *
 * Unlike `readClip` this deliberately leaves the clip folder: the point is to
 * bring outside footage in. It is still fenced - only a video extension, only a
 * path the user chose in the OS dialog above - and capped, because the bytes
 * cross IPC and are held in the renderer while the timeline is open.
 */
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

export function readVideoFile(_: IpcMainInvokeEvent, path: string): Uint8Array {
    if (!isAbsolute(path) || !/\.(mp4|webm|mkv|mov|m4v)$/i.test(path)) {
        throw new Error("Not a video file");
    }

    const stat = statSync(path);
    if (stat.size > MAX_IMPORT_BYTES) {
        // The file is read here, copied across IPC and held as a Blob in the
        // renderer: three copies of whatever passes through. Half a gigabyte is
        // already an uncomfortable amount to hold while the timeline is open.
        const mb = Math.round(stat.size / (1024 * 1024));
        throw new Error(`That video is ${mb} MB; imports are capped at 512 MB. Trim it or lower its bitrate first.`);
    }

    return new Uint8Array(readFileSync(path));
}

/** Shows the clip in the file explorer, with the file itself selected. */
export function revealClip(_: IpcMainInvokeEvent, dir: string, name: string): void {
    shell.showItemInFolder(join(resolveDirectory(dir), safeClipName(name)));
}

/** Absolute folder clips land in with the current setting. */
export function getClipDirectory(_: IpcMainInvokeEvent, dir: string): string {
    return resolveDirectory(dir);
}

/** Native folder picker. Returns the chosen path, or an empty string on cancel. */
export async function pickClipDirectory(_: IpcMainInvokeEvent, current: string): Promise<string> {
    const result = await dialog.showOpenDialog({
        title: "Where should clips be saved?",
        defaultPath: resolveDirectory(current),
        properties: ["openDirectory", "createDirectory"]
    });

    return result.canceled ? "" : result.filePaths[0] ?? "";
}

/** Opens the clip folder in the file explorer, creating it when needed. */
export function openClipDirectory(_: IpcMainInvokeEvent, dir: string): void {
    const target = resolveDirectory(dir);
    mkdirSync(target, { recursive: true });
    shell.openPath(target);
}

export interface PlatformInfo {
    platform: NodeJS.Platform;
    /** Wayland session: no window list, and OS-level keybinds do not fire. */
    wayland: boolean;
    /** Vesktop or a fork, which owns the display-media handler itself. */
    vesktop: boolean;
}

/** What the renderer cannot tell about the host on its own. */
export function getPlatformInfo(_: IpcMainInvokeEvent): PlatformInfo {
    return { platform: process.platform, wayland: IS_WAYLAND, vesktop: IS_VESKTOP_APP };
}

export interface CaptureSource {
    id: string;
    name: string;
    /** Small PNG data URL used by the source picker. Empty when not fetched. */
    thumbnail: string;
    /**
     * False when Windows Graphics Capture refused to grab a preview for this
     * window (minimised, elevated, or otherwise protected). Undefined when the
     * listing was made without thumbnails, so nothing is known either way.
     */
    capturable?: boolean;
}

/** Ids of windows a thumbnail grab has already failed on, so they stay out of the list. */
const uncapturable = new Set<string>();

/**
 * Lists screens and windows that can be captured.
 *
 * Discord's Electron build has no `setDisplayMediaRequestHandler`, so
 * `getDisplayMedia` rejects in the renderer. Enumerating here and handing the
 * source id back is the supported path.
 *
 * Asking for a thumbnail makes Chromium open a Windows Graphics Capture session
 * per window, and every window that refuses logs
 * `CreateForWindow failed ... Source is not capturable`. That is why the picker
 * fetches thumbnails once and then polls with `withThumbnails: false`: the cheap
 * listing touches no capture session at all.
 */
export async function getCaptureSources(_: IpcMainInvokeEvent, withThumbnails = true): Promise<CaptureSource[]> {
    if (IS_WAYLAND) return [];

    const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: withThumbnails ? { width: 320, height: 180 } : { width: 0, height: 0 },
        fetchWindowIcons: false
    });

    // Window ids die with their window; drop the ones the system no longer lists
    // so the set cannot grow for the whole session.
    if (uncapturable.size) {
        const alive = new Set(sources.map(s => s.id));
        for (const id of uncapturable) if (!alive.has(id)) uncapturable.delete(id);
    }

    const listed: CaptureSource[] = [];

    for (const s of sources) {
        const isScreen = s.id.startsWith("screen:");

        if (!withThumbnails) {
            if (!isScreen && uncapturable.has(s.id)) continue;
            listed.push({ id: s.id, name: s.name, thumbnail: "" });
            continue;
        }

        const empty = s.thumbnail.isEmpty();

        // A screen with an empty preview is still recordable; a window is not -
        // but only Windows Graphics Capture refuses that way, so elsewhere an
        // empty preview means nothing and the window stays in the list.
        if (IS_WINDOWS && !isScreen && empty) {
            uncapturable.add(s.id);
            continue;
        }

        uncapturable.delete(s.id);
        listed.push({
            id: s.id,
            name: s.name,
            thumbnail: empty ? "" : s.thumbnail.toDataURL(),
            capturable: true
        });
    }

    return listed;
}

/*
 * Display-media handling.
 *
 * The legacy `chromeMediaSource: "desktop"` constraints run through an old code
 * path that kills the renderer process on some Windows / GPU combinations, and
 * a renderer crash looks exactly like the client reloading itself. Installing a
 * display-media request handler here lets the renderer use plain
 * `getDisplayMedia`, which is the maintained path, with the source resolved in
 * the main process so no system picker ever shows up.
 */
let armedSourceId = "";

/** True while this plugin owns the session's display-media handler. */
let handlerInstalled = false;

/**
 * Points the display-media handler at a source. Empty id means the primary
 * screen. `allowed` is false when the client already owns the handler (Vesktop),
 * in which case nothing is installed and false is returned so the renderer takes
 * another path.
 */
export function armDisplayMedia(_: IpcMainInvokeEvent, sourceId: string, allowed = true): boolean {
    if (!allowed || IS_VESKTOP_APP) return false;

    armedSourceId = sourceId ?? "";
    handlerInstalled = true;

    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        const sources = await desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 0, height: 0 }
        });

        const armed = sources.find(s => s.id === armedSourceId);

        // A window known to refuse capture would hand the renderer a track that
        // never produces a frame, so fall back to a screen instead.
        const usable = armed && !uncapturable.has(armed.id) ? armed : undefined;

        const source = usable
            ?? sources.find(s => s.id.startsWith("screen:"))
            ?? sources.find(s => !uncapturable.has(s.id));

        if (!source) {
            callback({});
            return;
        }

        // Loopback audio only exists on Windows, and only for whole screens.
        callback(IS_WINDOWS && source.id.startsWith("screen:")
            ? { video: source, audio: "loopback" }
            : { video: source });
    }, { useSystemPicker: false });

    return true;
}

/**
 * Removes the handler so the client's own capture is left untouched when idle.
 *
 * Only ever clears a handler this plugin installed: clearing one owned by
 * Vesktop would kill its screen share for the rest of the session.
 */
export function disarmDisplayMedia(_?: IpcMainInvokeEvent): void {
    armedSourceId = "";

    if (!handlerInstalled) return;
    handlerInstalled = false;
    session.defaultSession.setDisplayMediaRequestHandler(null);
}

/*
 * Global keybinds.
 *
 * A `keydown` listener in the renderer only fires while Discord has focus,
 * which is useless for a clipping plugin: the interesting moment always happens
 * in the game. Electron's `globalShortcut` registers with the OS instead, so
 * the binds fire whatever is focused.
 *
 * Nothing pushes from the main process to a plugin's renderer code, so the
 * renderer long-polls `waitForShortcut`: the call parks until a bind fires or
 * the timeout expires, which costs nothing while idle and adds no latency when
 * a key is actually pressed.
 */
type ShortcutAction = "save" | "toggle";

const registered = new Map<ShortcutAction, string>();
let waiters: Array<(action: ShortcutAction | null) => void> = [];
let pending: ShortcutAction[] = [];

function fire(action: ShortcutAction) {
    // One press, one action: only the oldest poller is woken. Waking every one
    // of them would run the action twice whenever a stale poll is still parked,
    // which is exactly what happens right after the client reloads.
    const next = waiters.shift();

    if (next) {
        next(action);
        return;
    }

    // Nobody is polling right now (renderer reloading): keep it for the next call.
    pending.push(action);
    if (pending.length > 8) pending.shift();
}

/**
 * Registers the given binds system-wide, replacing whatever was registered
 * before. Values are Electron accelerators; an empty one unbinds the action.
 * Returns the accelerators that could not be taken, so the renderer can warn.
 */
export function registerShortcuts(_: IpcMainInvokeEvent, binds: Partial<Record<ShortcutAction, string>>): string[] {
    unregisterShortcuts();

    const failed: string[] = [];

    for (const [action, accelerator] of Object.entries(binds) as Array<[ShortcutAction, string]>) {
        if (!accelerator) continue;

        let ok = false;
        try {
            ok = globalShortcut.register(accelerator, () => fire(action));
        } catch {
            ok = false;
        }

        if (ok) registered.set(action, accelerator);
        // Another application already owns it, or the accelerator is malformed.
        else failed.push(accelerator);
    }

    return failed;
}

/** Drops every bind this plugin owns. Other applications keep theirs. */
export function unregisterShortcuts(_?: IpcMainInvokeEvent): void {
    for (const accelerator of registered.values()) {
        try {
            globalShortcut.unregister(accelerator);
        } catch {
            // Already gone, nothing to do.
        }
    }

    registered.clear();
    pending = [];

    const waiting = waiters;
    waiters = [];
    for (const resolve of waiting) resolve(null);
}

/** Resolves with the next bind that fires, or null once `timeoutMs` passes. */
export function waitForShortcut(_: IpcMainInvokeEvent, timeoutMs = 30_000): Promise<ShortcutAction | null> {
    const queued = pending.shift();
    if (queued) return Promise.resolve(queued);

    return new Promise(resolve => {
        let done = false;

        const settle = (action: ShortcutAction | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(action);
        };

        const timer = setTimeout(() => {
            waiters = waiters.filter(w => w !== settle);
            settle(null);
        }, timeoutMs);

        waiters.push(settle);
    });
}

// Electron keeps OS-level binds alive past the window, so drop them on exit.
app.on("will-quit", () => unregisterShortcuts());
