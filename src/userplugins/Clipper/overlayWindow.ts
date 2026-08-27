/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - what the plugin draws over the game
 *
 * Two things, both in a window of their own: the clip you ask for with the
 * keybind, and a one-line notice that a clip was saved. Nothing here ever
 * starts playing a video on its own - somebody is in the middle of a game, and
 * a video appearing unasked is exactly the wrong thing to do to them.
 *
 * These are plain BrowserWindows, so they are composited by the desktop like
 * any other window. That covers a game running borderless or windowed, which is
 * what most of them do, and it cannot cover a game in exclusive fullscreen:
 * there the game owns the screen and nothing is drawn on top of it. Doing that
 * needs a DLL injected into the game and its graphics API hooked, which is what
 * Discord's own overlay does and what a plugin has no business doing.
 *
 * The pages are written to disk rather than built as data: URLs, because a
 * data: document is an opaque origin and cannot load the clip off the disk.
 */

import { app, BrowserWindow, screen } from "electron";
import { mkdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { pathToFileURL } from "url";

export type OverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface OverlayLook {
    /** Which corner of the screen it sits in. */
    corner: OverlayCorner;
    /** Width of the clip window in pixels; the height follows at 16:9. */
    width: number;
    /** 0 to 100. Anything at 0 plays muted, which is also the autoplay fallback. */
    volume: number;
    /** How many seconds off the end of the clip to play. 0 plays all of it. */
    seconds: number;
}

/** Distance kept from the edges of the screen, in pixels. */
const MARGIN = 24;

/** How long the "clip saved" notice stays up, in milliseconds. */
const TOAST_MS = 2600;

/** Fade in and out, in milliseconds. */
const FADE_MS = 220;

const TOAST_WIDTH = 300;
const TOAST_HEIGHT = 56;

/**
 * Linux compositing is not a given - a transparent window without a compositor
 * is drawn black - and Wayland refuses to let an application place its own
 * windows at all, so the overlay is offered where it can actually work.
 */
const CAN_OVERLAY = process.platform === "win32" || process.platform === "darwin"
    || (process.platform === "linux" && process.env.XDG_SESSION_TYPE !== "wayland" && !process.env.WAYLAND_DISPLAY);

/** Whether a window can be placed over a game on this platform at all. */
export function canOverlay(): boolean {
    return CAN_OVERLAY;
}

let clipWin: BrowserWindow | null = null;
let clipTimer: NodeJS.Timeout | null = null;

let toastWin: BrowserWindow | null = null;
let toastTimer: NodeJS.Timeout | null = null;

/** True while a clip is up. */
export function overlayUp(): boolean {
    return !!clipWin && !clipWin.isDestroyed();
}

/** Takes the clip down, if it is up. Safe to call at any time. */
export function hideOverlay(): void {
    if (clipTimer) {
        clearTimeout(clipTimer);
        clipTimer = null;
    }

    const going = clipWin;
    clipWin = null;

    if (going && !going.isDestroyed()) going.destroy();
}

/** Takes the notice down, if it is up. Safe to call at any time. */
export function hideToast(): void {
    if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }

    const going = toastWin;
    toastWin = null;

    if (going && !going.isDestroyed()) going.destroy();
}

function cornerOf(corner: OverlayCorner, width: number, height: number): { x: number; y: number; } {
    // The display under the pointer rather than the primary one: on two screens
    // the game is on the one being looked at, and that is where the pointer is.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;

    const left = corner === "top-left" || corner === "bottom-left";
    const top = corner === "top-left" || corner === "top-right";

    return {
        x: Math.round(left ? area.x + MARGIN : area.x + area.width - width - MARGIN),
        y: Math.round(top ? area.y + MARGIN : area.y + area.height - height - MARGIN)
    };
}

/** Writes a page into the plugin's own folder and hands back its path. */
export function writePage(name: string, html: string): string {
    const folder = join(app.getPath("userData"), "clipper-overlay");
    mkdirSync(folder, { recursive: true });

    const file = join(folder, name);
    writeFileSync(file, html, "utf8");

    return file;
}

/**
 * Opens one of these windows on a page, and hands it back.
 *
 * Every one of them is the same thing: borderless, click-through, above the
 * fullscreen layer, and never taking the focus - taking it is what makes a game
 * minimise itself.
 */
function spawn(file: string, width: number, height: number, corner: OverlayCorner): BrowserWindow {
    const { x, y } = cornerOf(corner, width, height);

    const made = new BrowserWindow({
        width, height, x, y,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            // The window is only ever in the background as far as the OS is
            // concerned, and a throttled timer would stall the playback.
            backgroundThrottling: false
        }
    });

    // "screen-saver" is the level above a fullscreen window; the plain flag is
    // not enough to sit over a game running borderless.
    made.setAlwaysOnTop(true, "screen-saver");
    made.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Clicks belong to the game underneath, always: a window that eats a click
    // mid-fight is worse than no overlay at all.
    made.setIgnoreMouseEvents(true, { forward: true });

    void made.loadFile(file).then(() => {
        // showInactive rather than show: the game keeps the focus it has.
        if (!made.isDestroyed()) made.showInactive();
    }).catch(() => {
        if (!made.isDestroyed()) made.destroy();
    });

    return made;
}

/** The shared head of both pages: no network, no scripts but their own. */
function head(extraStyle: string): string {
    return `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
    html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
    .card {
        position: absolute; inset: 0; border-radius: 12px; overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 10px 34px rgba(0, 0, 0, 0.6);
        opacity: 0; transform: scale(0.96); transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
    }
    .card.up { opacity: 1; transform: none; }
    ${extraStyle}
</style>`;
}

// Embedded as JSON, and with the one sequence that could end the script early
// taken out of it - a clip name is whatever the user typed.
export function embed(data: unknown): string {
    return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * The clip page.
 *
 * Everything it needs is written into it, so there is no preload, no node
 * integration and nothing for the page to talk to: it plays one file and closes
 * its own window when it is done.
 */
function clipPage(path: string, look: OverlayLook): string {
    return `<!doctype html>
<html>
<head>
${head(`.card { background: #000; }
    video { display: block; width: 100%; height: 100%; object-fit: cover; }
    .tag {
        position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 10px 7px;
        font: 600 12px/1.3 "gg sans", "Segoe UI", system-ui, sans-serif; color: #fff;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    }`)}
</head>
<body>
<div class="card" id="card">
    <video id="video" playsinline></video>
    <div class="tag" id="tag"></div>
</div>
<script>
    var look = ${embed(look)};
    var video = document.getElementById("video");
    var card = document.getElementById("card");
    document.getElementById("tag").textContent = ${embed(basename(path))};

    var leaving = false;
    function leave() {
        if (leaving) return;
        leaving = true;
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${FADE_MS});
    }

    // The last seconds of the clip are the ones worth seeing: a save keeps the
    // moment that just happened, and it happened at the end of the buffer.
    video.addEventListener("loadedmetadata", function () {
        var length = isFinite(video.duration) ? video.duration : 0;
        if (look.seconds > 0 && length > look.seconds) video.currentTime = length - look.seconds;
        card.classList.add("up");
    });

    video.addEventListener("ended", leave);
    video.addEventListener("error", leave);

    video.volume = Math.max(0, Math.min(1, look.volume / 100));
    video.muted = look.volume <= 0;

    video.src = ${embed(pathToFileURL(path).href)};

    // Autoplay with sound is only allowed after a gesture, and this window
    // never gets one. Muted playback is always allowed, so it is the fallback
    // rather than a reason to show nothing.
    video.play().catch(function () {
        video.muted = true;
        video.play().catch(leave);
    });
</script>
</body>
</html>`;
}

/** The notice: a line of text that says a clip was written, and goes away. */
function toastPage(title: string, note: string): string {
    return `<!doctype html>
<html>
<head>
${head(`.card {
        background: rgba(20, 21, 24, 0.92); display: flex; align-items: center; gap: 10px; padding: 0 14px;
        font: 12px/1.3 "gg sans", "Segoe UI", system-ui, sans-serif; color: #fff;
    }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #f23f43; flex: none; }
    .text { min-width: 0; }
    .title { font-weight: 600; font-size: 13px; }
    .note { opacity: 0.72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`)}
</head>
<body>
<div class="card" id="card">
    <div class="dot"></div>
    <div class="text">
        <div class="title" id="title"></div>
        <div class="note" id="note"></div>
    </div>
</div>
<script>
    var card = document.getElementById("card");
    document.getElementById("title").textContent = ${embed(title)};
    document.getElementById("note").textContent = ${embed(note)};

    requestAnimationFrame(function () { card.classList.add("up"); });

    setTimeout(function () {
        card.classList.remove("up");
        setTimeout(function () { window.close(); }, ${FADE_MS});
    }, ${TOAST_MS});
</script>
</body>
</html>`;
}

/**
 * Plays a clip over whatever is on screen.
 *
 * Only ever called because somebody pressed the keybind. Returns false when
 * this platform cannot place a window over a game, so the caller can say so
 * once instead of leaving the user waiting for something that never appears.
 */
export function showOverlay(path: string, look: OverlayLook): boolean {
    if (!CAN_OVERLAY) return false;

    hideOverlay();
    // The clip covers the notice anyway, and they would sit on top of each other.
    hideToast();

    const width = Math.max(200, Math.round(look.width));
    const height = Math.round(width * 9 / 16);

    const made = spawn(writePage("clip.html", clipPage(path, look)), width, height, look.corner);
    clipWin = made;

    made.on("closed", () => {
        if (clipWin !== made) return;

        clipWin = null;
        if (clipTimer) {
            clearTimeout(clipTimer);
            clipTimer = null;
        }
    });

    /*
     * The page closes itself when the clip ends. This is for when it cannot:
     * a file Chromium will not decode, a page that failed to load. Without it
     * a black rectangle would sit over the game until the client restarts.
     */
    const cap = (look.seconds > 0 ? look.seconds : 300) + 10;
    clipTimer = setTimeout(() => hideOverlay(), cap * 1000);

    return true;
}

/**
 * Says that a clip was written, for a couple of seconds.
 *
 * Nothing plays and nothing moves: the point is to know the save worked without
 * having to leave the game to find out, not to watch anything.
 */
export function showToast(title: string, note: string, corner: OverlayCorner): boolean {
    if (!CAN_OVERLAY) return false;
    // A clip is already up and says the same thing, louder.
    if (overlayUp()) return false;

    hideToast();

    const made = spawn(writePage("toast.html", toastPage(title, note)), TOAST_WIDTH, TOAST_HEIGHT, corner);
    toastWin = made;

    made.on("closed", () => {
        if (toastWin !== made) return;

        toastWin = null;
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }
    });

    // Same reasoning as the clip: the page normally closes itself.
    toastTimer = setTimeout(() => hideToast(), TOAST_MS + 4000);

    return true;
}

// Windows left over would outlive the client itself.
app.on("will-quit", () => {
    hideOverlay();
    hideToast();
});
