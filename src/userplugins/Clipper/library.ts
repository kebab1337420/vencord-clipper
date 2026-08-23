/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - clip metadata and categories
 *
 * A clip on disk is just a file with a timestamp for a name, which makes a
 * folder of two hundred of them useless. This module keeps one small JSON
 * document next to the clips - name, game, free-form tags - so the editor can
 * group them by what was on screen.
 *
 * The game is read from Discord itself at save time. Discord already detects
 * running games for the activity status, so `RunningGameStore` knows the name
 * of what is running without any image analysis; the captured window's title is
 * the fallback when Discord has no game (a browser game, a source picked by
 * hand, activity detection turned off).
 */

import { Logger } from "@utils/Logger";
import type { PluginNative } from "@utils/types";
import { RunningGameStore } from "@webpack/common";

import { settings } from "./settings";

// Its own logger rather than the recorder's: the recorder tags clips through
// this module, and borrowing its logger would close an import cycle.
const logger = new Logger("Clipper", "#f0b132");

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

export interface ClipMeta {
    /** Category the clip is filed under. Empty means uncategorised. */
    game: string;
    /** Free-form labels, lower-cased, for the search box. */
    tags?: string[];
    /** Epoch ms the metadata was written, so a stale entry can be spotted. */
    taggedAt?: number;
}

interface LibraryDocument {
    version: 1;
    clips: Record<string, ClipMeta>;
}

const EMPTY: LibraryDocument = { version: 1, clips: {} };

/**
 * Cached document.
 *
 * Every listing, tag change and rename touches it, and it is a few kilobytes at
 * most, so it is read once and written back whole. `null` means "not read yet".
 */
let cache: LibraryDocument | null = null;

/**
 * Folder the cache was read from.
 *
 * The clip folder is a setting and can change while the client runs. Keeping the
 * folder next to the cache is what stops one folder's categories from being
 * written into another - and from being pruned against the wrong listing.
 */
let cacheDir: string | null = null;

function parse(json: string): LibraryDocument {
    if (!json) return { ...EMPTY, clips: {} };

    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== "object" || typeof parsed.clips !== "object") {
            return { ...EMPTY, clips: {} };
        }

        return { version: 1, clips: parsed.clips as Record<string, ClipMeta> };
    } catch (e) {
        // A corrupt document must not take the clip list down with it: the clips
        // themselves are the data that matters, the metadata is recoverable.
        logger.warn("Clip library is unreadable, starting a fresh one", e);
        return { ...EMPTY, clips: {} };
    }
}

async function load(): Promise<LibraryDocument> {
    const dir = settings.store.saveDirectory ?? "";
    if (cache && cacheDir === dir) return cache;

    cacheDir = dir;

    try {
        cache = parse(await Native.readLibrary(dir));
    } catch (e) {
        logger.warn("Could not read the clip library", e);
        cache = { ...EMPTY, clips: {} };
    }

    return cache;
}

async function flush(): Promise<void> {
    if (!cache) return;

    try {
        // Deliberately the folder the cache came from, not the current setting:
        // a folder changed between the read and the write must not receive the
        // previous folder's categories.
        await Native.writeLibrary(cacheDir ?? settings.store.saveDirectory, JSON.stringify(cache));
    } catch (e) {
        logger.warn("Could not write the clip library", e);
    }
}

export async function readMeta(): Promise<Record<string, ClipMeta>> {
    return (await load()).clips;
}

export async function setMeta(name: string, meta: Partial<ClipMeta>): Promise<void> {
    const doc = await load();
    const current = doc.clips[name] ?? { game: "" };

    doc.clips[name] = { ...current, ...meta, taggedAt: Date.now() };
    await flush();
}

/** Follows a rename, so the category is not lost with the old name. */
export async function moveMeta(from: string, to: string): Promise<void> {
    const doc = await load();
    if (from === to || !doc.clips[from]) return;

    doc.clips[to] = doc.clips[from];
    delete doc.clips[from];
    await flush();
}

export async function dropMeta(name: string): Promise<void> {
    const doc = await load();
    if (!doc.clips[name]) return;

    delete doc.clips[name];
    await flush();
}

/** Forgets entries whose clip is gone, so a folder cleaned by hand stays tidy. */
export async function pruneMeta(existing: string[]): Promise<void> {
    const doc = await load();
    const keep = new Set(existing);

    let changed = false;
    for (const name of Object.keys(doc.clips)) {
        if (keep.has(name)) continue;

        delete doc.clips[name];
        changed = true;
    }

    if (changed) await flush();
}

/*
 * Window titles carry decoration a category name should not: the running
 * frame rate, the map, the player's name, the build number. Cutting at the
 * usual separators keeps "Elden Ring" out of
 * "Elden Ring - 144fps - vulkan".
 */
const TITLE_NOISE = /\s*[-|–—:]\s.*$/;
const TITLE_STRIP = /\s*\((?:32|64)[- ]?bit\)|\s*\[[^\]]*\]/gi;

/** Turns a window title into something worth showing as a category. */
export function categoryFromTitle(title: string): string {
    const cleaned = title.replace(TITLE_STRIP, "").replace(TITLE_NOISE, "").trim();

    // A whole screen is not a game, and neither is Discord watching itself.
    if (!cleaned || /^(entire |screen|display|desktop)/i.test(cleaned)) return "";
    if (/^(discord|vesktop|equibop)$/i.test(cleaned)) return "";

    return cleaned.slice(0, 60);
}

/**
 * Best guess at what is being played right now.
 *
 * Discord's own detection comes first because it names the game rather than the
 * window ("Counter-Strike 2", not "Counter-Strike 2 - Direct3D 11"). The
 * captured source's title is the fallback.
 */
export function detectGame(): string {
    try {
        const games = RunningGameStore?.getRunningGames?.() as { name?: string; }[] | undefined;
        const running = games?.map(g => g?.name).find(name => typeof name === "string" && name.trim());

        if (running) return running.trim().slice(0, 60);
    } catch (e) {
        logger.warn("Could not read Discord's running games", e);
    }

    return categoryFromTitle(settings.store.sourceName || "");
}

/** Tags a freshly saved clip with whatever was running when it was saved. */
export async function tagSavedClip(path: string): Promise<void> {
    const name = path.split(/[\\/]/).pop();
    if (!name) return;

    const game = detectGame();
    if (!game) return;

    try {
        await setMeta(name, { game });
    } catch (e) {
        logger.warn("Could not tag the saved clip", e);
    }
}

export const UNCATEGORISED = "Uncategorised";

/** Category names present in the folder, sorted, uncategorised last. */
export function categoriesOf(names: string[], meta: Record<string, ClipMeta>): string[] {
    const found = new Set<string>();
    let loose = false;

    for (const name of names) {
        const game = meta[name]?.game?.trim();
        if (game) found.add(game);
        else loose = true;
    }

    const sorted = [...found].sort((a, b) => a.localeCompare(b));
    return loose ? [...sorted, UNCATEGORISED] : sorted;
}
