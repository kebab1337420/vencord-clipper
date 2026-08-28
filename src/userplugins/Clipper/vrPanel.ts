/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - what the plugin says inside the headset
 *
 * Everything the plugin has to say, it says on a desktop: a toast in Discord, or
 * ./gameOverlay's notice in the corner of the game. Somebody in a headset sees
 * neither. They press a controller button to save a clip and nothing whatsoever
 * happens as far as they can tell, which is the one thing a clip button must
 * never do - the whole point of pressing it is that the moment was good, and
 * having to take a headset off to find out whether it was caught is worse than
 * not having the button.
 *
 * So the notice is drawn again, as pixels, and handed to SteamVR's compositor
 * to hang in front of the player for a few seconds.
 *
 * The reason this is a small file rather than an impossible one is
 * `SetOverlayRaw`: OpenVR will take a plain RGBA buffer out of main memory and
 * put it on an overlay itself. No Direct3D device, no Vulkan instance, no shared
 * texture handle - none of which a Discord renderer process could produce. A
 * canvas is drawn on here exactly as it would be anywhere else in the plugin,
 * `getImageData` hands over the bytes, and ./vrBridge carries them to the
 * headset.
 *
 * Transient by design. The panel appears when something happens and takes itself
 * away a few seconds later, and the countdown is held by the bridge rather than
 * here, so a renderer that reloads mid-notice cannot leave a picture nailed
 * across somebody's game.
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";

import { settings } from "./settings";

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

const logger = new Logger("Clipper");

/*
 * The panel's size in pixels, and how big it is hung in the world.
 *
 * Half a metre across at a metre away is about the width of a hand held out at
 * arm's length - big enough to read a sentence off without moving, small enough
 * not to be in the way of the game. 640 by 200 at that size works out at rather
 * more pixels per degree than the headset can resolve, which is the right way
 * round to be wrong: the compositor is sampling this every frame while the head
 * moves, and a picture with room to spare stays sharp through it.
 */
const WIDTH = 640;
const HEIGHT = 200;

/** How long a notice stays up, in ms. Long enough to read twice. */
const DWELL_MS = 4000;

/**
 * Drawn once and kept.
 *
 * A canvas this size costs half a megabyte, and notices arrive in bursts - a
 * multi-angle request answers several times in a few seconds. Making one per
 * notice would leave the page collecting garbage at exactly the moment the
 * recorder wants the machine.
 */
let canvas: HTMLCanvasElement | null = null;

function context(): CanvasRenderingContext2D | null {
    if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
    }

    // `willReadFrequently`, because reading the whole thing back out is the
    // only reason this canvas exists: without it the browser keeps the surface
    // on the GPU and every read is a stall waiting for it to come back.
    return canvas.getContext("2d", { willReadFrequently: true });
}

/** A rounded rectangle, since not every Electron here has `roundRect`. */
function panelPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/**
 * Cuts a line to what fits, ending in an ellipsis if it did not.
 *
 * Nothing upstream knows how wide the panel is, and a clip title is whatever
 * the game was called: left alone, a long one runs off the side of the picture
 * and the part that says what happened to it goes with it.
 */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
    if (ctx.measureText(text).width <= width) return text;

    let cut = text.length;
    while (cut > 1 && ctx.measureText(text.slice(0, cut) + "…").width > width) cut--;

    return text.slice(0, cut) + "…";
}

/**
 * Paints the notice and returns its pixels.
 *
 * Dark and nearly opaque rather than a clean overlay: this is drawn over a game
 * nobody has any control over, and light text on a dark card is the one
 * combination that stays readable on top of a snowfield and a night level both.
 */
function paint(title: string, note: string): ImageData | null {
    const ctx = context();
    if (!ctx) return null;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = "rgba(14, 15, 18, 0.92)";
    panelPath(ctx, 0, 0, WIDTH, HEIGHT, 28);
    ctx.fill();

    // The plugin's own red, down the left edge. At a glance and from the corner
    // of an eye this is the part that says which program is talking.
    ctx.fillStyle = "#ed4245";
    ctx.fillRect(0, 40, 8, HEIGHT - 80);

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 44px system-ui, sans-serif";
    ctx.fillText(fit(ctx, title, WIDTH - 80), 40, 92);

    if (note) {
        ctx.fillStyle = "#b8bcc4";
        ctx.font = "400 32px system-ui, sans-serif";
        ctx.fillText(fit(ctx, note, WIDTH - 80), 40, 144);
    }

    return ctx.getImageData(0, 0, WIDTH, HEIGHT);
}

/**
 * Says something in the headset, if there is a headset to say it in.
 *
 * Quiet about everything: no SteamVR, no session, a runtime too old to draw an
 * overlay, a compositor that refused the picture. Every one of those is a
 * notice that was already delivered somewhere else, and none of them is worth
 * a toast on a monitor the player is not looking at.
 */
export function vrNotice(title: string, note: string): void {
    if (!settings.store.vrInstalled || !settings.store.vrControls || !settings.store.vrPanel) return;
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    const pixels = paint(title, note);
    if (!pixels) return;

    try {
        // The buffer rather than the view, because only the buffer survives the
        // trip: Electron copies an ArrayBuffer across, and would otherwise put
        // a typed array through the structured clone a byte at a time.
        void Promise.resolve(Native.showVrPanel(pixels.data.buffer as ArrayBuffer, WIDTH, HEIGHT, DWELL_MS))
            .catch(e => logger.warn("Could not put a notice in the headset", e));
    } catch (e) {
        logger.warn("Could not put a notice in the headset", e);
    }
}

/** Takes the panel down early, whatever is left of its dwell. */
export function clearVrNotice(): void {
    if (!IS_DISCORD_DESKTOP && !IS_VESKTOP) return;

    try {
        void Promise.resolve(Native.hideVrPanel()).catch(() => { });
    } catch { }
}
