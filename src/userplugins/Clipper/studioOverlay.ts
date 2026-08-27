/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the cutting room, over the game
 *
 * The clip window in ./overlayWindow only plays; this one is worked in. A clip
 * is watched, a range is picked out of it, and it is cut, sent, deleted or
 * handed to the full studio without the game ever being left.
 *
 * Two things make it different from every other window this plugin opens.
 *
 * It takes the mouse. Every other overlay here is click-through on purpose,
 * because a window that eats a click mid-fight is worse than no window; this
 * one cannot be, since it is made of buttons. The keybind is therefore a
 * toggle: pressing it opens the editor and hands it the pointer, pressing it
 * again gives the pointer back to the game and closes it. Nothing else opens
 * it, so the mouse is never taken from somebody who did not ask for it.
 *
 * It talks back. The page is a plain document with a preload, so what it can
 * say is one message on one channel. Anything that needs Discord itself -
 * attaching to a channel, opening the studio - belongs to the renderer, so
 * those actions are queued here and the plugin long-polls for them exactly the
 * way it long-polls for keybinds; the answer comes back the other way and
 * lands in the status line. A panel added later is a kind in that message and
 * a block in the page, not another round of plumbing.
 */

import { app, BrowserWindow, ipcMain, screen } from "electron";
import { pathToFileURL } from "url";

import { canOverlay, embed, hideOverlay, hideToast, writePage } from "./overlayWindow";

/** What the page is opened on. */
export interface StudioClip {
    /** File name, shown in the corner and named back in every action. */
    name: string;
    /** Absolute path of the clip on disk. */
    path: string;
    /** Marker offsets in seconds, drawn as ticks under the scrub bar. */
    markers: number[];
}

export interface StudioLook {
    /** Width of the window in pixels; the video keeps 16:9 above the controls. */
    width: number;
    /** 0 to 100. At 0 the clip plays muted, which is also the autoplay fallback. */
    volume: number;
}

/**
 * Something the page asked for that only the renderer can do.
 *
 * The range travels with every one of them, so a panel added later - a speed, a
 * volume, a caption - is a new kind here and a new block in the page rather
 * than a new channel.
 */
export interface StudioAction {
    kind: "cut" | "send" | "delete" | "open";
    /** Clip the editor is showing, by name. */
    clip: string;
    /** Selection in seconds, from the in handle to the out handle. */
    from: number;
    to: number;
}

/** What the renderer says once it has done it, shown in the status line. */
export interface StudioReply {
    ok: boolean;
    message: string;
    /** Whether the editor should go away - the clip is gone, or moved on. */
    close: boolean;
}

/** Page to main. One channel, one message shape. */
const ACTION_CHANNEL = "VencordClipperOverlayAction";

/** Main to page: the answer to the last one. */
const REPLY_CHANNEL = "VencordClipperOverlayReply";

/** Height of the controls under the video, in pixels. */
const CONTROLS = 108;

let win: BrowserWindow | null = null;

/** True while the editor is up. */
export function studioUp(): boolean {
    return !!win && !win.isDestroyed();
}

/** Takes the editor down, giving the pointer back to whatever is underneath. */
export function hideStudio(): void {
    const going = win;
    win = null;

    if (going && !going.isDestroyed()) going.destroy();
}

/*
 * The queue.
 *
 * Same shape as the keybind queue in ./native: nothing pushes from the main
 * process into a plugin's renderer, so the renderer parks a call here and it
 * resolves when the page asks for something. One action wakes one poller, and
 * an action fired while nothing is polling is kept rather than dropped.
 */
let waiters: Array<(action: StudioAction | null) => void> = [];
let pending: StudioAction[] = [];

function queue(action: StudioAction): void {
    const next = waiters.shift();

    if (next) {
        next(action);
        return;
    }

    pending.push(action);
    if (pending.length > 4) pending.shift();
}

/** Resolves with the next thing the editor asked for, or null on timeout. */
export function waitForStudioAction(timeoutMs: number): Promise<StudioAction | null> {
    const queued = pending.shift();
    if (queued) return Promise.resolve(queued);

    return new Promise(resolve => {
        let done = false;

        const settle = (action: StudioAction | null) => {
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

/** Frees every parked poll, so a reloading renderer is not left waiting. */
export function dropStudioWaiters(): void {
    pending = [];

    const waiting = waiters;
    waiters = [];
    for (const resolve of waiting) resolve(null);
}

/** Puts the outcome of an action back in the editor's status line. */
export function answerStudio(reply: StudioReply): void {
    if (!win || win.isDestroyed()) return;

    win.webContents.send(REPLY_CHANNEL, reply);
}

// Only ever one listener, whatever else in the client reloads.
ipcMain.removeAllListeners(ACTION_CHANNEL);
ipcMain.on(ACTION_CHANNEL, (event, kind: unknown, payload: unknown) => {
    // The editor is the only page allowed to ask for any of this.
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;

    const asked = String(kind ?? "");
    if (asked === "close") {
        hideStudio();
        return;
    }

    if (asked !== "cut" && asked !== "send" && asked !== "delete" && asked !== "open") return;

    const body = (payload ?? {}) as Record<string, unknown>;
    const from = Number(body.from);
    const to = Number(body.to);

    queue({
        kind: asked,
        clip: String(body.clip ?? ""),
        from: Number.isFinite(from) ? Math.max(0, from) : 0,
        to: Number.isFinite(to) ? Math.max(0, to) : 0
    });
});

/** Centred on the display the pointer is on, which is the one being played on. */
function centreOn(width: number, height: number): { x: number; y: number; } {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

    return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2)
    };
}

/**
 * What the page is allowed to say, and the only way it can say it.
 *
 * Written next to the page rather than shipped as a file of its own, because
 * the plugin is a bundle: there is no second file on disk to point at.
 */
const PRELOAD = `"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipper", {
    act(kind, payload) {
        ipcRenderer.send(${embed(ACTION_CHANNEL)}, String(kind), payload);
    },
    onReply(handler) {
        ipcRenderer.on(${embed(REPLY_CHANNEL)}, (_event, reply) => handler(reply));
    }
});
`;

/** The editor page: a video, a scrub bar with handles, and the buttons. */
function studioPage(clip: StudioClip, look: StudioLook): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
    html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; user-select: none; }
    .card {
        position: absolute; inset: 0; display: flex; flex-direction: column;
        border-radius: 12px; overflow: hidden; background: #101114;
        border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.7);
        font: 12px/1.35 "gg sans", "Segoe UI", system-ui, sans-serif; color: #f2f3f5;
        opacity: 0; transition: opacity 160ms ease;
    }
    .card.up { opacity: 1; }
    .screen { position: relative; flex: 1 1 auto; min-height: 0; background: #000; }
    video { display: block; width: 100%; height: 100%; object-fit: contain; }
    .name {
        position: absolute; left: 10px; top: 8px; max-width: 70%; padding: 3px 8px; border-radius: 6px;
        background: rgba(0, 0, 0, 0.55); font-size: 11px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .controls { flex: none; padding: 10px 12px 11px; display: flex; flex-direction: column; gap: 8px; }
    .track { position: relative; height: 22px; cursor: pointer; }
    .rail { position: absolute; left: 0; right: 0; top: 8px; height: 6px; border-radius: 3px; background: #2c2f36; }
    .range { position: absolute; top: 8px; height: 6px; border-radius: 3px; background: #3c437e; }
    .played { position: absolute; top: 8px; height: 6px; border-radius: 3px; background: #5865f2; }
    .mark { position: absolute; top: 3px; width: 2px; height: 16px; margin-left: -1px; border-radius: 1px; background: #f0b132; }
    .handle {
        position: absolute; top: 1px; width: 8px; height: 20px; margin-left: -4px; border-radius: 3px;
        background: #f2f3f5; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); cursor: ew-resize;
    }
    .head { position: absolute; top: 0; width: 2px; height: 22px; margin-left: -1px; background: #fff; pointer-events: none; }
    .row { display: flex; align-items: center; gap: 6px; }
    .spacer { flex: 1 1 auto; }
    .time { font-variant-numeric: tabular-nums; opacity: 0.75; }
    button {
        font: inherit; color: #f2f3f5; background: #2b2d31; border: 0; border-radius: 6px;
        padding: 5px 10px; cursor: pointer;
    }
    button:hover { background: #3a3d44; }
    button:disabled { opacity: 0.4; cursor: default; }
    button.go { background: #5865f2; }
    button.go:hover { background: #4752c4; }
    button.danger:hover { background: #b5292d; }
    .status { min-height: 15px; font-size: 11px; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status.bad { color: #fa777c; opacity: 1; }
    /* Where the panels that come later - speed, volume, captions - mount. They
       speak the same channel, so nothing below them has to change. */
    .panels:empty { display: none; }
</style>
</head>
<body>
<div class="card" id="card">
    <div class="screen">
        <video id="video" playsinline></video>
        <div class="name" id="name"></div>
    </div>
    <div class="controls">
        <div class="track" id="track">
            <div class="rail"></div>
            <div class="range" id="range"></div>
            <div class="played" id="played"></div>
            <div id="marks"></div>
            <div class="handle" id="handleIn"></div>
            <div class="handle" id="handleOut"></div>
            <div class="head" id="head"></div>
        </div>
        <div class="panels" id="panels"></div>
        <div class="row">
            <button id="play" data-do="play">Pause</button>
            <span class="time" id="time">0:00 / 0:00</span>
            <button data-do="in" title="I">In</button>
            <button data-do="out" title="O">Out</button>
            <button data-do="all">All</button>
            <span class="spacer"></span>
            <button class="go" data-do="cut">Cut</button>
            <button class="go" data-do="send">Send</button>
            <button class="danger" data-do="delete">Delete</button>
            <button data-do="open">Studio</button>
            <button data-do="close" title="Esc">Close</button>
        </div>
        <div class="status" id="status"></div>
    </div>
</div>
<script>
    var clip = ${embed({ name: clip.name, url: pathToFileURL(clip.path).href, markers: clip.markers })};
    var look = ${embed(look)};
    var api = window.clipper;

    var el = {};
    ["card", "video", "name", "track", "range", "played", "marks", "handleIn", "handleOut", "head", "play", "time", "status"]
        .forEach(function (id) { el[id] = document.getElementById(id); });

    el.name.textContent = clip.name;

    var length = 0;
    var inAt = 0;
    var outAt = 0;
    var busy = false;
    var armed = false;
    var armedTimer = 0;

    function clamp(value, low, high) { return value < low ? low : value > high ? high : value; }

    function stamp(seconds) {
        var whole = Math.max(0, Math.floor(seconds || 0));
        var rest = whole % 60;
        return Math.floor(whole / 60) + ":" + (rest < 10 ? "0" : "") + rest;
    }

    function percent(seconds) { return (length > 0 ? clamp(seconds / length, 0, 1) * 100 : 0) + "%"; }

    function span(from, to) {
        return (length > 0 ? clamp((to - from) / length, 0, 1) * 100 : 0) + "%";
    }

    function draw() {
        var at = el.video.currentTime || 0;

        el.range.style.left = percent(inAt);
        el.range.style.width = span(inAt, outAt);

        el.played.style.left = percent(inAt);
        el.played.style.width = span(inAt, clamp(at, inAt, outAt));

        el.head.style.left = percent(at);
        el.handleIn.style.left = percent(inAt);
        el.handleOut.style.left = percent(outAt);

        el.time.textContent = stamp(at - inAt) + " / " + stamp(outAt - inAt);
    }

    function say(text, bad) {
        el.status.textContent = text || "";
        el.status.className = bad ? "status bad" : "status";
    }

    function disarm() {
        if (!armed) return;
        armed = false;
        clearTimeout(armedTimer);
        document.querySelector("[data-do=delete]").textContent = "Delete";
    }

    function working(state) {
        busy = state;
        var buttons = document.querySelectorAll("[data-do=cut], [data-do=send], [data-do=delete], [data-do=open]");
        for (var i = 0; i < buttons.length; i++) buttons[i].disabled = state;
    }

    function leave() {
        el.card.classList.remove("up");
        // The window belongs to the main process; asking it to close is the
        // same door the keybind uses.
        if (api) api.act("close", {});
        else window.close();
    }

    function ask(kind) {
        if (busy) return;
        if (!api) { say("This overlay cannot reach the client", true); return; }
        if (!(outAt > inAt)) { say("Nothing is selected", true); return; }

        working(true);
        say("Working...");
        api.act(kind, { clip: clip.name, from: inAt, to: outAt });
    }

    if (api) api.onReply(function (reply) {
        working(false);
        say(reply && reply.message, !(reply && reply.ok));
        if (reply && reply.close) setTimeout(leave, 700);
    });

    /* ------------------------------------------------------------ playback */

    el.video.addEventListener("loadedmetadata", function () {
        length = isFinite(el.video.duration) ? el.video.duration : 0;
        outAt = length;
        drawMarks();
        draw();
        el.card.classList.add("up");
    });

    el.video.addEventListener("timeupdate", function () {
        // Playback stays inside the selection, so the handles are heard as well
        // as seen: what loops is what a cut would keep.
        if (el.video.currentTime < inAt - 0.25 || el.video.currentTime > outAt) el.video.currentTime = inAt;
        draw();
    });

    el.video.addEventListener("play", function () { el.play.textContent = "Pause"; });
    el.video.addEventListener("pause", function () { el.play.textContent = "Play"; });
    el.video.addEventListener("error", function () { say("That clip cannot be played here", true); });

    el.video.volume = clamp((look.volume || 0) / 100, 0, 1);
    el.video.muted = !(look.volume > 0);
    el.video.src = clip.url;

    // Sound needs a gesture this window has not had yet; muted always plays.
    el.video.play().catch(function () {
        el.video.muted = true;
        el.video.play().catch(function () { say("That clip cannot be played here", true); });
    });

    /* ----------------------------------------------------------- the ruler */

    function timeAt(event) {
        var box = el.track.getBoundingClientRect();
        return clamp((event.clientX - box.left) / (box.width || 1), 0, 1) * length;
    }

    function drag(handle, move) {
        handle.addEventListener("pointerdown", function (event) {
            event.preventDefault();
            event.stopPropagation();
            handle.setPointerCapture(event.pointerId);

            var onMove = function (moved) { move(timeAt(moved)); draw(); };
            var onUp = function () {
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onUp);
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onUp);
        });
    }

    drag(el.handleIn, function (at) {
        inAt = clamp(at, 0, Math.max(0, outAt - 0.2));
        if (el.video.currentTime < inAt) el.video.currentTime = inAt;
    });

    drag(el.handleOut, function (at) {
        outAt = clamp(at, Math.min(length, inAt + 0.2), length);
        if (el.video.currentTime > outAt) el.video.currentTime = inAt;
    });

    el.track.addEventListener("pointerdown", function (event) {
        el.video.currentTime = clamp(timeAt(event), inAt, outAt);
        draw();
    });

    function drawMarks() {
        el.marks.textContent = "";
        if (!(length > 0)) return;

        for (var i = 0; i < clip.markers.length; i++) {
            if (clip.markers[i] < 0 || clip.markers[i] > length) continue;

            var mark = document.createElement("div");
            mark.className = "mark";
            mark.style.left = percent(clip.markers[i]);
            el.marks.appendChild(mark);
        }
    }

    /* --------------------------------------------------------- the buttons */

    var doing = {
        play: function () { if (el.video.paused) el.video.play().catch(function () {}); else el.video.pause(); },
        "in": function () { inAt = clamp(el.video.currentTime, 0, Math.max(0, outAt - 0.2)); draw(); },
        out: function () { outAt = clamp(el.video.currentTime, Math.min(length, inAt + 0.2), length); draw(); },
        all: function () { inAt = 0; outAt = length; el.video.currentTime = 0; draw(); },
        cut: function () { ask("cut"); },
        send: function () { ask("send"); },
        open: function () { ask("open"); },
        close: leave,
        "delete": function () {
            // Nothing irreversible on one click, in a window opened mid-game.
            if (!armed) {
                armed = true;
                document.querySelector("[data-do=delete]").textContent = "Sure?";
                say("Press again to delete this clip");
                armedTimer = setTimeout(disarm, 4000);
                return;
            }

            disarm();
            ask("delete");
        }
    };

    document.addEventListener("click", function (event) {
        var button = event.target.closest ? event.target.closest("[data-do]") : null;
        if (!button) return;

        var what = button.getAttribute("data-do");
        if (what !== "delete") disarm();
        if (doing[what]) doing[what]();
    });

    document.addEventListener("keydown", function (event) {
        var step = event.shiftKey ? 5 : 1;

        if (event.key === "Escape") leave();
        else if (event.key === " ") doing.play();
        else if (event.key === "ArrowLeft") el.video.currentTime = clamp(el.video.currentTime - step, inAt, outAt);
        else if (event.key === "ArrowRight") el.video.currentTime = clamp(el.video.currentTime + step, inAt, outAt);
        else if (event.key === "i" || event.key === "I") doing["in"]();
        else if (event.key === "o" || event.key === "O") doing.out();
        else return;

        event.preventDefault();
        draw();
    });

    draw();
</script>
</body>
</html>`;
}

/**
 * Opens the editor on a clip, over whatever is on screen.
 *
 * Unlike everything else this plugin puts up, this window takes the focus and
 * the pointer: it is only ever opened because the keybind was pressed, and it
 * is made of buttons. Returns false when the platform cannot place a window
 * over a game at all.
 */
export function showStudio(clip: StudioClip, look: StudioLook): boolean {
    if (!canOverlay()) return false;

    hideStudio();
    // A clip playing in the corner and the same clip in the editor is one clip
    // too many, and the notice would sit under the window anyway.
    hideOverlay();
    hideToast();

    const width = Math.max(360, Math.round(look.width));
    const height = Math.round(width * 9 / 16) + CONTROLS;
    const { x, y } = centreOn(width, height);

    const preload = writePage("studio-preload.js", PRELOAD);
    const page = writePage("studio.html", studioPage(clip, look));

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
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
            preload,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false
        }
    });

    win = made;

    made.setAlwaysOnTop(true, "screen-saver");
    made.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    made.on("closed", () => {
        if (win === made) win = null;
    });

    void made.loadFile(page).then(() => {
        if (made.isDestroyed()) return;

        // show, not showInactive: this is the one window here meant to be
        // clicked in, and closing it gives the game its pointer straight back.
        made.show();
        made.focus();
    }).catch(() => {
        if (!made.isDestroyed()) made.destroy();
    });

    return true;
}

// A window left over would sit over the desktop with nothing behind it.
app.on("will-quit", () => hideStudio());
