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
import type { VoiceFileMeta, VoiceTrackMeta } from "./voice";

const logger = new Logger("Clipper", "#f0b132");

const Native = VencordNative.pluginHelpers.Clipper as PluginNative<typeof import("./native")>;

export interface ClipMeta {
    /** Category the clip is filed under. Empty means uncategorised. */
    game: string;
    /** Free-form labels, lower-cased, for the search box. */
    tags?: string[];
    /** Epoch ms the metadata was written, so a stale entry can be spotted. */
    taggedAt?: number;
    /**
     * Offsets in seconds from the start of the clip, marked while recording.
     *
     * Sorted, and only the ones that landed inside the clip that was saved: they
     * are what the studio timeline draws so a play can be found without scrubbing
     * for it.
     */
    markers?: number[];
    /**
     * Who was talking during the clip, one lane per person.
     *
     * Not audio: the call reaches this client already mixed, so what is kept is
     * the activity envelope Discord reports per user. It is what the studio
     * draws under the timeline, and it is stored base64'd because a plain array
     * of a few thousand small numbers would dwarf the rest of the document.
     */
    voices?: VoiceTrackMeta[];
    /**
     * The per-person recordings kept alongside this clip.
     *
     * `voices` is an envelope drawn under the timeline; this is the audio
     * itself, one file per person, and it is what the studio's mute works on.
     * Held here rather than read off the folder because the offset cannot be
     * recovered from a file name: a lane starts on its own chunk boundary, a
     * fraction of a second either side of the clip's.
     */
    tracks?: VoiceFileMeta[];
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

/**
 * One entry, with every field checked, or null when there is nothing to keep.
 *
 * The document is a file in a folder the user opens, moves and backs up, so it
 * may have been edited by hand or written by an older version: a `game` that is
 * not a string would reach the category list and the clip grid as-is.
 */
function entryOf(value: unknown): ClipMeta | null {
    if (!value || typeof value !== "object") return null;

    const raw = value as Partial<ClipMeta>;

    const tags = Array.isArray(raw.tags)
        ? raw.tags.filter((t): t is string => typeof t === "string" && !!t.trim()).map(t => t.trim().toLowerCase())
        : [];

    const voices = Array.isArray(raw.voices)
        ? (raw.voices as unknown[])
            .map(value => value as Partial<VoiceTrackMeta>)
            .filter(v => !!v && typeof v.id === "string" && typeof v.levels === "string" && !!v.levels)
            .slice(0, 10)
            .map(v => ({
                id: v.id!,
                name: (typeof v.name === "string" && v.name.trim()) || v.id!,
                // Only an http(s) avatar is kept: the value is fed to an <img>
                // the render draws onto its canvas, and a javascript: or data:
                // URL out of a hand-edited sidecar has no business going there.
                ...(typeof v.avatar === "string" && /^https:\/\//.test(v.avatar) ? { avatar: v.avatar.slice(0, 400) } : {}),
                levels: v.levels!.slice(0, 8000)
            }))
        : [];

    const tracks = Array.isArray(raw.tracks)
        ? (raw.tracks as unknown[])
            .map(value => value as Partial<VoiceFileMeta>)
            .filter(t => !!t && typeof t.id === "string" && typeof t.file === "string" && !!t.file)
            // A file name out of a hand-edited sidecar is handed to the native
            // reader, which resolves it inside the clip folder: it may name a
            // file, never a path.
            .filter(t => !/[\\/]/.test(t.file!) && t.file!.toLowerCase().endsWith(".webm"))
            .slice(0, 10)
            .map(t => ({
                id: t.id!,
                name: (typeof t.name === "string" && t.name.trim()) || t.id!,
                file: t.file!.slice(0, 200),
                offset: typeof t.offset === "number" && Number.isFinite(t.offset) ? t.offset : 0
            }))
        : [];

    const markers = Array.isArray(raw.markers)
        ? raw.markers
            .filter((m): m is number => typeof m === "number" && Number.isFinite(m) && m >= 0)
            .sort((a, b) => a - b)
            .slice(0, 200)
        : [];

    return {
        game: typeof raw.game === "string" ? raw.game.trim().slice(0, 60) : "",
        ...(tags.length ? { tags } : {}),
        ...(typeof raw.taggedAt === "number" && Number.isFinite(raw.taggedAt) ? { taggedAt: raw.taggedAt } : {}),
        ...(markers.length ? { markers } : {}),
        ...(voices.length ? { voices } : {}),
        ...(tracks.length ? { tracks } : {})
    };
}

function parse(json: string): LibraryDocument {
    if (!json) return { ...EMPTY, clips: {} };

    try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== "object" || !parsed.clips || typeof parsed.clips !== "object") {
            return { ...EMPTY, clips: {} };
        }

        const clips: Record<string, ClipMeta> = {};
        for (const [name, value] of Object.entries(parsed.clips as Record<string, unknown>)) {
            const entry = entryOf(value);
            if (entry) clips[name] = entry;
        }

        return { version: 1, clips };
    } catch (e) {
        // A corrupt document must not take the clip list down with it: the clips
        // themselves are the data that matters, the metadata is recoverable.
        logger.warn("Clip library is unreadable, starting a fresh one", e);
        return { ...EMPTY, clips: {} };
    }
}

/** The read currently in flight, so concurrent callers share one document. */
let loading: Promise<LibraryDocument> | null = null;

async function read(dir: string): Promise<LibraryDocument> {
    let doc: LibraryDocument;

    try {
        doc = parse(await Native.readLibrary(dir));
    } catch (e) {
        logger.warn("Could not read the clip library", e);
        doc = { ...EMPTY, clips: {} };
    }

    // The folder may have been changed again while this read was in flight, in
    // which case the cache belongs to the newer one, not to this document.
    if (cacheDir === dir) cache = doc;

    return doc;
}

async function load(): Promise<LibraryDocument> {
    const dir = settings.store.saveDirectory ?? "";
    if (cache && cacheDir === dir) return cache;

    // Two callers arriving before the first read comes back would otherwise each
    // parse their own document, and whichever wrote first would have its change
    // dropped by the other's copy. They share one read instead.
    if (loading && cacheDir === dir) return loading;

    cacheDir = dir;
    loading = read(dir);
    loading.finally(() => void (loading = null)).catch(() => void 0);

    return loading;
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
export async function tagSavedClip(path: string, markers?: number[], voices?: VoiceTrackMeta[], tracks?: VoiceFileMeta[]): Promise<void> {
    const name = path.split(/[\\/]/).pop();
    if (!name) return;

    const game = detectGame();
    const kept = markers?.filter(m => Number.isFinite(m) && m >= 0).sort((a, b) => a - b) ?? [];
    const lanes = voices?.filter(v => v.levels) ?? [];
    const files = tracks?.filter(t => t.file) ?? [];

    // Markers are worth writing on their own: a clip taken outside a game has no
    // category to record but its marks are still the reason it was saved.
    if (!game && !kept.length && !lanes.length && !files.length) return;

    try {
        await setMeta(name, {
            ...(game ? { game } : {}),
            ...(kept.length ? { markers: kept } : {}),
            ...(lanes.length ? { voices: lanes } : {}),
            ...(files.length ? { tracks: files } : {})
        });
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
