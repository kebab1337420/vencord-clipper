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

import { createHash } from "crypto";
import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, type IpcMainInvokeEvent, screen, session, shell } from "electron";
import { accessSync, constants as fsConstants, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { get as httpsGet } from "https";
import { basename, extname, isAbsolute, join } from "path";

import { canOverlay, hideOverlay, type OverlayCorner, type OverlayLook, overlayUp, showOverlay, showToast } from "./overlayWindow";
// From utils rather than defined here: the renderer needs the same names and
// cannot import this module, which pulls in fs and electron. Not re-exported
// either - every value export of a native module must be an IPC handler.
import { thumbNameFor } from "./utils";

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
 * Reduces a clip name to a plain file name in the clip folder, or null when
 * nothing usable is left of it.
 *
 * The name comes from the renderer, and everything a plugin exports here is
 * callable from there, so a name is never trusted with a directory component or
 * an extension of its own choosing: `..\..\autorun.bat` must not escape the clip
 * folder, and nothing but a video file may be written.
 */
function clipName(name: string): string | null {
    const flat = basename(String(name ?? "").replace(/[\\/]/g, "_")).trim();
    const cleaned = flat.replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/^\.+/, "");

    // Parentheses are allowed because the de-duplicating suffix uses them, png
    // because the editor saves single frames next to the clips, jpg because
    // that is what the thumbnails are, and gif because a clip exported as one
    // is written into the same folder and read back out of it to be attached.
    const match = /^([\w.\-+ ()[\]]{1,120})\.(webm|mp4|png|jpg|gif)$/i.exec(cleaned);

    return match ? `${match[1]}.${match[2].toLowerCase()}` : null;
}

/** Same, with a generated name for a write that must land somewhere. */
function safeClipName(name: string): string {
    return clipName(name) ?? `clip-${Date.now()}.webm`;
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

/**
 * Reserves a free path inside the clip folder without writing anything.
 *
 * The native clip engine writes the file itself - it is handed a path and hands
 * back a duration - so the renderer needs the same name resolution `saveClip`
 * does, minus the write: the folder created, the name made safe, and a " (2)"
 * appended if something is already sitting there.
 */
export function reserveClipPath(_: IpcMainInvokeEvent, dir: string, name: string): string {
    const target = resolveDirectory(dir);
    mkdirSync(target, { recursive: true });

    return freePath(target, safeClipName(name));
}

/*
 * Where a clip's per-person voice recordings live.
 *
 * A subfolder rather than a suffix on the clip's own name, for the one reason
 * that decides it: `listClips` walks the clip folder and calls every `.webm`
 * and `.mp4` in it a clip. Eight people in a call would put eight more entries
 * in the library for every clip taken, and no naming convention makes that
 * safe - the folder is the user's, they rename things inside it, and a rule
 * that reads a name to decide what a file *is* breaks the first time somebody
 * does. `listClips` never descends into a directory, so nothing kept here can
 * be mistaken for a clip.
 */
const VOICE_DIR = "voices";

/** Ids come from Discord and are digits; nothing else may name a file here. */
function voiceName(clip: string, userId: string): string | null {
    const safe = clipName(clip);
    if (!safe || !/^\d{1,25}$/.test(String(userId ?? ""))) return null;

    return `${safe.slice(0, safe.length - extname(safe).length)}.${userId}.webm`;
}

/** The voice recordings kept for one clip, by whose voice each one is. */
function voiceTracksIn(dir: string, clip: string): Array<{ userId: string; file: string; }> {
    const safe = clipName(clip);
    if (!safe) return [];

    const target = join(resolveDirectory(dir), VOICE_DIR);
    if (!existsSync(target)) return [];

    // Matched whole, with the dot, so the tracks of "clip.webm" are never the
    // tracks of "clip (2).webm".
    const head = `${safe.slice(0, safe.length - extname(safe).length)}.`;
    const found: Array<{ userId: string; file: string; }> = [];

    for (const entry of readdirSync(target, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!entry.name.startsWith(head) || !entry.name.toLowerCase().endsWith(".webm")) continue;

        const userId = entry.name.slice(head.length, entry.name.length - ".webm".length);
        if (/^\d{1,25}$/.test(userId)) found.push({ userId, file: entry.name });
    }

    return found;
}

/** Writes one person's own voice next to the clip it belongs to. */
export function saveVoiceTrack(_: IpcMainInvokeEvent, dir: string, clip: string, userId: string, data: Uint8Array): string | null {
    const name = voiceName(clip, userId);
    if (!name) return null;

    const target = join(resolveDirectory(dir), VOICE_DIR);
    mkdirSync(target, { recursive: true });

    const path = join(target, name);
    writeFileSync(path, Buffer.from(data));

    return path;
}

/** Reads one of them back. */
export function readVoiceTrack(_: IpcMainInvokeEvent, dir: string, file: string): Uint8Array {
    const flat = basename(String(file ?? "").replace(/[\\/]/g, "_"));
    if (!flat.toLowerCase().endsWith(".webm") || flat.includes("..")) throw new Error("not a voice track");

    return new Uint8Array(readFileSync(join(resolveDirectory(dir), VOICE_DIR, flat)));
}

/** Drops everything recorded for a clip, for when the clip itself goes. */
function dropVoiceTracks(dir: string, clip: string): void {
    const target = join(resolveDirectory(dir), VOICE_DIR);

    for (const { file } of voiceTracksIn(dir, clip)) {
        try {
            unlinkSync(join(target, file));
        } catch {
            // Already gone, or held open by a decoder: nothing to do about it.
        }
    }
}

export interface StoredClip {
    name: string;
    path: string;
    size: number;
    /** Last modification, epoch ms. */
    modified: number;
    /** File name of the sidecar thumbnail, when one was written next to it. */
    thumb?: string;
}


/** Clips found in the folder, newest first. */
export function listClips(_: IpcMainInvokeEvent, dir: string): StoredClip[] {
    const target = resolveDirectory(dir);
    if (!existsSync(target)) return [];

    const clips: StoredClip[] = [];
    const files = new Set<string>();
    const entries = readdirSync(target, { withFileTypes: true });

    for (const entry of entries) if (entry.isFile()) files.add(entry.name);

    for (const entry of entries) {
        if (!entry.isFile() || !/\.(webm|mp4)$/i.test(entry.name)) continue;

        const path = join(target, entry.name);
        try {
            const stat = statSync(path);
            const thumb = thumbNameFor(entry.name);

            clips.push({
                name: entry.name,
                path,
                size: stat.size,
                modified: stat.mtimeMs,
                ...(files.has(thumb) ? { thumb } : {})
            });
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
    const target = resolveDirectory(dir);
    const clip = safeClipName(name);
    const path = join(target, clip);

    try {
        await shell.trashItem(path);
    } catch {
        // No trash available (some Linux setups, network drives): delete outright.
        unlinkSync(path);
    }

    // The same goes for the voices: they mean nothing without the clip they
    // were recorded alongside.
    dropVoiceTracks(dir, clip);

    // The thumbnail is worthless without its clip, and leaving it behind would
    // have the next clip of the same name show the wrong picture.
    const thumb = join(target, thumbNameFor(clip));
    if (existsSync(thumb)) {
        try {
            await shell.trashItem(thumb);
        } catch {
            try {
                unlinkSync(thumb);
            } catch {
                // Locked or already gone: the listing simply keeps showing it.
            }
        }
    }
}

/** Renames a clip inside the folder. Returns the name it ended up with. */
export function renameClip(_: IpcMainInvokeEvent, dir: string, name: string, next: string): string {
    const target = resolveDirectory(dir);
    const current = safeClipName(name);
    const from = join(target, current);

    // The extension is the source of truth for the container, so it is kept
    // whatever the user typed.
    const ext = extname(current);
    const wanted = clipName(next.toLowerCase().endsWith(ext) ? next : next + ext);

    // A rename is the one place the generated fallback would be wrong: silently
    // filing the clip under `clip-1750000000000.webm` loses the name the user
    // typed, which is the entire point of the operation.
    if (!wanted) throw new Error("That name cannot be used. Keep it under 120 characters, with letters, digits, spaces or - _ . + ( ) [ ]");

    // The clip is already called this: nothing to do, and going on would find
    // the clip itself in the way and file it as "name (2).ext".
    if (wanted === current) return current;

    /*
     * A rename that only changes the case is still a rename.
     *
     * Windows and macOS both answer that the destination exists - it is the
     * same file - so the free-name search would step around it in exactly the
     * case where stepping around it is wrong.
     */
    const sameFile = wanted.toLowerCase() === current.toLowerCase();
    const to = sameFile ? join(target, wanted) : freePath(target, wanted);

    renameSync(from, to);

    // The thumbnail is found by the clip's name, so it has to follow it.
    const thumbFrom = join(target, thumbNameFor(current));
    if (existsSync(thumbFrom)) {
        try {
            renameSync(thumbFrom, join(target, thumbNameFor(basename(to))));
        } catch {
            // Not fatal: the clip just loses its picture until the next render.
        }
    }

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

/** Native picker for sounds to lay over the montage. */
export async function pickAudioFiles(_: IpcMainInvokeEvent): Promise<string[]> {
    const result = await dialog.showOpenDialog({
        title: "Add sounds to the timeline",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "opus", "m4a", "aac", "flac", "webm"] }]
    });

    return result.canceled ? [] : result.filePaths;
}

/**
 * Reads a sound the user picked, by absolute path.
 *
 * Capped far lower than a video import: a sound is decoded to float samples and
 * kept that way for as long as the timeline is open, which costs roughly ten
 * megabytes per minute of stereo whatever the file's own compression was.
 */
const MAX_SOUND_BYTES = 64 * 1024 * 1024;

export function readAudioFile(_: IpcMainInvokeEvent, path: string): Uint8Array {
    if (!isAbsolute(path) || !/\.(mp3|wav|ogg|opus|m4a|aac|flac|webm)$/i.test(path)) {
        throw new Error("Not an audio file");
    }

    const stat = statSync(path);
    if (stat.size > MAX_SOUND_BYTES) {
        const mb = Math.round(stat.size / (1024 * 1024));
        throw new Error(`That sound is ${mb} MB; the timeline caps them at 64 MB.`);
    }

    return new Uint8Array(readFileSync(path));
}

/**
 * Picks the pictures and clips to lay over the montage.
 *
 * Animations are first-class here rather than tolerated: a GIF plays as a GIF,
 * and a short MP4 or WebM is laid on the frame the same way a picture is. What
 * the render captures is a canvas painted in real time, so an overlay that
 * moves needs nothing more than to be playing while it is painted.
 */
export async function pickImageFiles(_: IpcMainInvokeEvent): Promise<string[]> {
    const result = await dialog.showOpenDialog({
        title: "Add pictures and clips to the montage",
        properties: ["openFile", "multiSelections"],
        filters: [
            { name: "Pictures and clips", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "mp4", "webm"] },
            { name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"] },
            { name: "Clips", extensions: ["mp4", "webm"] }
        ]
    });

    return result.canceled ? [] : result.filePaths;
}

/**
 * Reads a picture the user picked, by absolute path.
 *
 * Pictures are capped well below the sound limit: one is decoded to a bitmap
 * held for as long as the studio is open, and a 40 megapixel photo is 160 MB of
 * RGBA whatever the file on disk weighs. A video overlay is allowed more
 * because it is never decoded whole - it streams out of an element a frame at
 * a time, the same as the footage underneath it.
 */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_OVERLAY_VIDEO_BYTES = 64 * 1024 * 1024;

export function readImageFile(_: IpcMainInvokeEvent, path: string): Uint8Array {
    if (!isAbsolute(path) || !/\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm)$/i.test(path)) {
        throw new Error("Not a picture or a clip");
    }

    const moving = /\.(mp4|webm)$/i.test(path);
    const cap = moving ? MAX_OVERLAY_VIDEO_BYTES : MAX_IMAGE_BYTES;

    const stat = statSync(path);
    if (stat.size > cap) {
        const mb = Math.round(stat.size / (1024 * 1024));
        const capMb = Math.round(cap / (1024 * 1024));

        throw new Error(`That ${moving ? "clip" : "picture"} is ${mb} MB; the montage caps them at ${capMb} MB.`);
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

interface PlatformInfo {
    platform: NodeJS.Platform;
    /** Wayland session: no window list, and OS-level keybinds do not fire. */
    wayland: boolean;
    /** Vesktop or a fork, which owns the display-media handler itself. */
    vesktop: boolean;
    /** Whether a window can be placed over a game here at all. */
    overlay: boolean;
}

/** What the renderer cannot tell about the host on its own. */
export function getPlatformInfo(_: IpcMainInvokeEvent): PlatformInfo {
    return { platform: process.platform, wayland: IS_WAYLAND, vesktop: IS_VESKTOP_APP, overlay: canOverlay() };
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

/**
 * What every process of the client is holding, in megabytes.
 *
 * The client has been reloading itself on its own: the renderer dies with
 * `EXCEPTION_BREAKPOINT` on `CrRendererMain`, and once with `E0000008`, which
 * is the code Chromium raises when an allocation fails. A capture that runs for
 * hours can walk any of three processes up - the renderer holding the buffered
 * chunks, the GPU process holding capture surfaces, the utility process the
 * media engine runs in - and each of those is fixed somewhere else, so the
 * renderer's own heap reading is not enough to tell them apart.
 *
 * Electron only offers this in the main process, which is why it is here.
 */
export async function getMemoryReport(_: IpcMainInvokeEvent): Promise<Array<{ type: string; mb: number; }>> {
    try {
        return app.getAppMetrics()
            .map(m => ({
                type: m.serviceName || m.type,
                mb: Math.round((m.memory?.workingSetSize ?? 0) / 1024)
            }))
            .filter(m => m.mb > 0)
            .sort((a, b) => b.mb - a.mb);
    } catch {
        // Older Electron, or a metric that is not collected on this platform.
        return [];
    }
}

/**
 * The screen a game is running on, as a capture source id.
 *
 * A game in exclusive fullscreen does not answer window capture: what comes
 * back is the desktop behind it, which is what a clip of such a game used to
 * show. Recording its screen instead is the only reliable way to see it.
 *
 * The screen to pick is the one holding the pointer. A fullscreen game owns the
 * pointer, and on a single-monitor machine the question does not arise at all.
 * Returns an empty string when nothing can be matched, which leaves the source
 * the user chose alone.
 */
export async function getActiveScreen(_: IpcMainInvokeEvent): Promise<string> {
    if (IS_WAYLAND) return "";

    const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 }
    });

    if (!sources.length) return "";

    try {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        const match = sources.find(s => s.display_id === String(display.id));

        if (match) return match.id;
    } catch {
        // No display server, or a monitor that was unplugged between the two
        // calls. The first screen is still a better answer than none.
    }

    return sources[0].id;
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
type ShortcutAction = "save" | "toggle" | "mark" | "pov" | "replay";

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

/*
 * ------------------------------------------------------- the game overlay ---
 *
 * A clip played in a window of its own, above everything else, so it can be
 * watched without leaving the game, and a line of text saying a clip was
 * written. ./overlayWindow does the work; what is here is the part that must
 * not trust the renderer: a clip is named, never pathed, and the look is
 * clamped to something that fits on a screen.
 *
 * The clip only ever goes up because the keybind was pressed. Nothing here is
 * called on its own after a save: somebody is playing, and a video appearing
 * unasked in the corner is in the way rather than useful.
 */

const CORNERS: OverlayCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

function clamp(value: unknown, low: number, high: number, fallback: number): number {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;

    return Math.min(high, Math.max(low, Math.round(number)));
}

function safeCorner(corner: unknown): OverlayCorner {
    return CORNERS.includes(corner as OverlayCorner) ? corner as OverlayCorner : "bottom-right";
}

function safeLook(look: Partial<OverlayLook> | undefined): OverlayLook {
    return {
        corner: safeCorner(look?.corner),
        width: clamp(look?.width, 200, 1280, 420),
        volume: clamp(look?.volume, 0, 100, 0),
        seconds: clamp(look?.seconds, 0, 300, 10)
    };
}

/** Cuts a line of text down to something that fits, and onto one line. */
function safeLine(text: unknown, limit: number): string {
    return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

/**
 * Plays a saved clip over the game.
 *
 * Returns false when nothing was shown - a missing file, or a platform that
 * cannot place a window over a game.
 */
export function showClipOverlay(_: IpcMainInvokeEvent, dir: string, name: string, look?: Partial<OverlayLook>): boolean {
    const safe = clipName(name);
    if (!safe) return false;

    const path = join(resolveDirectory(dir), safe);
    if (!existsSync(path)) return false;

    return showOverlay(path, safeLook(look));
}

/** Takes the overlay down, or puts the clip up when nothing is playing. */
export function toggleClipOverlay(event: IpcMainInvokeEvent, dir: string, name: string, look?: Partial<OverlayLook>): boolean {
    if (overlayUp()) {
        hideOverlay();
        return false;
    }

    return showClipOverlay(event, dir, name, look);
}

/**
 * Says that a clip was written, for a couple of seconds.
 *
 * Nothing is shown while the client is the window in front: the replay card is
 * already there, and this exists for the moment you cannot see the client.
 */
export function notifyClipSaved(_: IpcMainInvokeEvent, title: string, note: string, corner?: string): boolean {
    if (BrowserWindow.getFocusedWindow()) return false;

    return showToast(safeLine(title, 60), safeLine(note, 90), safeCorner(corner));
}

/** Takes the overlay down. Does nothing when it is not up. */
export function hideClipOverlay(_?: IpcMainInvokeEvent): void {
    hideOverlay();
}

/*
 * ---------------------------------------------------------------- updates ---
 *
 * The plugin ships as a finished Vencord bundle rather than as sources, so an
 * update is a handful of files replaced in the installed dist folder. Doing it
 * here rather than in the renderer is not a preference: Discord's content
 * security policy blocks a renderer fetch to GitHub, and nothing in the
 * renderer can write to disk anyway.
 */

/** Where the prebuilt bundle is published. */
const UPDATE_REPO = "kebab1337420/vencord-clipper";

/** GitHub rejects an API request with no user agent, so every call carries one. */
const UPDATE_AGENT = `VencordClipper (+https://github.com/${UPDATE_REPO})`;

/**
 * What a release replaces when it carries no manifest of its own.
 *
 * Builds made by scripts\build-prebuilt.ps1 list their files, with a hash each,
 * in prebuilt\build-info.json; this list only covers a release published before
 * that existed. A name missing from such a release is skipped rather than
 * treated as a failure.
 */
const BUNDLE_FILES = [
    "patcher.js",
    "patcher.js.LEGAL.txt",
    "preload.js",
    "renderer.css",
    "renderer.js",
    "renderer.js.LEGAL.txt",
    "vencordDesktopMain.js",
    "vencordDesktopMain.js.LEGAL.txt",
    "vencordDesktopPreload.js",
    "vencordDesktopRenderer.css",
    "vencordDesktopRenderer.js",
    "vencordDesktopRenderer.js.LEGAL.txt"
];

interface Fetched {
    status: number;
    body: Buffer;
}

/** One GET, following redirects, with the whole body in memory. */
function httpGet(url: string, redirects = 0): Promise<Fetched> {
    return new Promise((resolve, reject) => {
        const request = httpsGet(url, { headers: { "User-Agent": UPDATE_AGENT, Accept: "*/*" } }, response => {
            const status = response.statusCode ?? 0;
            const { location } = response.headers;

            // Release assets and raw files both answer from a redirect.
            if (status >= 300 && status < 400 && location) {
                response.resume();

                if (redirects >= 5) reject(new Error(`Too many redirects for ${url}`));
                else resolve(httpGet(new URL(location, url).toString(), redirects + 1));

                return;
            }

            const chunks: Buffer[] = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => resolve({ status, body: Buffer.concat(chunks) }));
            response.on("error", reject);
        });

        request.setTimeout(60_000, () => request.destroy(new Error(`${url} timed out`)));
        request.on("error", reject);
    });
}

/** Same, refusing anything but a 200. */
async function httpGetOk(url: string): Promise<Buffer> {
    const { status, body } = await httpGet(url);
    if (status !== 200) throw new Error(`${url} answered ${status}`);

    return body;
}

/**
 * The folder the patched client loads the bundle from.
 *
 * This module is compiled into that bundle, so `__dirname` is the folder itself
 * whichever install script put it there. A folder without a patcher in it is
 * not one, and is refused rather than written into.
 */
function bundleDirectory(): string {
    return __dirname;
}

function bundleInstalled(dir: string): boolean {
    return existsSync(join(dir, "patcher.js")) && existsSync(join(dir, "renderer.js"));
}

function canWrite(dir: string): boolean {
    try {
        accessSync(dir, fsConstants.W_OK);
        return true;
    } catch {
        return false;
    }
}

/** Compares two `1.2.3` versions, ignoring anything after the numbers. */
function isNewer(candidate: string, installed: string): boolean {
    const parts = (version: string) => version.replace(/^v/i, "").split(/[.\-+]/).map(part => Number(part) || 0);

    const left = parts(candidate);
    const right = parts(installed);

    for (let i = 0; i < 3; i++) {
        if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) > (right[i] ?? 0);
    }

    return false;
}

export interface UpdateInfo {
    /** Latest published version, without the leading v. */
    version: string;
    /** The tag it was published under, which is what the files are fetched from. */
    tag: string;
    /** True when that version is newer than the one asking. */
    available: boolean;
    /** Release notes, trimmed to something a modal can hold. */
    notes: string;
    /** Release page, for the "what changed" link. */
    url: string;
    /** Where the bundle would be written. */
    directory: string;
    /** False when this install cannot be updated from here: no bundle, or a read-only folder. */
    writable: boolean;
}

/**
 * Asks GitHub for the newest release and says whether it beats `installed`.
 *
 * Only the release list is read here; nothing is downloaded and nothing is
 * written, so a failed check costs a launch nothing but a log line.
 */
export async function checkUpdate(_: IpcMainInvokeEvent, installed: string): Promise<UpdateInfo> {
    const body = await httpGetOk(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
    const release = JSON.parse(body.toString("utf8"));

    const tag = String(release.tag_name ?? "");
    const version = tag.replace(/^v/i, "");
    const directory = bundleDirectory();

    return {
        version,
        tag,
        available: Boolean(version) && isNewer(version, installed),
        notes: String(release.body ?? "").trim().slice(0, 1200),
        url: String(release.html_url ?? `https://github.com/${UPDATE_REPO}/releases`),
        directory,
        writable: bundleInstalled(directory) && canWrite(directory)
    };
}

interface ManifestEntry {
    size?: number;
    sha256?: string;
}

/** The file list a build left behind, or null for a release published without one. */
async function fetchManifest(tag: string): Promise<Record<string, ManifestEntry> | null> {
    const { status, body } = await httpGet(`https://raw.githubusercontent.com/${UPDATE_REPO}/${tag}/prebuilt/build-info.json`);
    if (status !== 200) return null;

    try {
        const { files } = JSON.parse(body.toString("utf8"));
        return files && typeof files === "object" ? files : null;
    } catch {
        return null;
    }
}

/**
 * Downloads a release and swaps it into the installed bundle.
 *
 * Everything lands in a staging folder first and is only moved over the live
 * files once every single one has arrived and matched its hash: a download that
 * dies halfway then costs nothing, where writing straight into the dist folder
 * would leave a client that no longer starts.
 *
 * Returns the names of the files that were replaced.
 */
export async function downloadUpdate(_: IpcMainInvokeEvent, tag: string): Promise<string[]> {
    if (!/^[\w.-]{1,40}$/.test(tag)) throw new Error(`Refusing to fetch a release named ${tag}`);

    const dir = bundleDirectory();
    if (!bundleInstalled(dir)) throw new Error(`No installed bundle at ${dir}`);
    if (!canWrite(dir)) throw new Error(`${dir} is read-only`);

    const manifest = await fetchManifest(tag);
    const names = manifest ? Object.keys(manifest) : BUNDLE_FILES;

    const staging = join(dir, ".clipper-update");
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });

    try {
        const written: string[] = [];

        for (const name of names) {
            // The name comes off the network; it may only ever be a file sitting
            // in the dist folder, never a path reaching out of it.
            if (name !== basename(name) || name.startsWith(".")) throw new Error(`Refusing a release file named ${name}`);

            const { status, body } = await httpGet(`https://raw.githubusercontent.com/${UPDATE_REPO}/${tag}/prebuilt/dist/${name}`);

            // Without a manifest the list is a guess, so a name the release does
            // not carry is simply not part of it.
            if (status === 404 && !manifest) continue;
            if (status !== 200) throw new Error(`${name} answered ${status}`);
            if (body.length === 0) throw new Error(`${name} came back empty`);

            const expected = manifest?.[name];
            if (expected?.size !== undefined && body.length !== expected.size) {
                throw new Error(`${name} is ${body.length} bytes, the release says ${expected.size}`);
            }

            if (expected?.sha256) {
                const got = createHash("sha256").update(body).digest("hex");
                if (got.toLowerCase() !== expected.sha256.toLowerCase()) throw new Error(`${name} does not match its hash`);
            }

            writeFileSync(join(staging, name), body);
            written.push(name);
        }

        if (written.length === 0) throw new Error(`There is no bundle published under ${tag}`);

        // A bundle with no plugin in it would install cleanly and take the whole
        // point away with it, so the two files that carry it are checked.
        for (const name of ["renderer.js", "patcher.js"]) {
            if (!written.includes(name)) throw new Error(`The release carries no ${name}`);
        }
        if (!readFileSync(join(staging, "renderer.js")).includes("Clipper")) {
            throw new Error("There is no Clipper in that release's renderer");
        }

        for (const name of written) renameSync(join(staging, name), join(dir, name));

        return written;
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
}

/**
 * Restarts the client so the bundle just written is the one that loads.
 *
 * Discord closes to the tray on a plain quit, which would leave the old bundle
 * running in a window nobody can see, so the exit is forced shortly after.
 */
export function relaunchClient(_: IpcMainInvokeEvent): void {
    app.relaunch();
    app.quit();
    setTimeout(() => app.exit(0), 3000);
}
