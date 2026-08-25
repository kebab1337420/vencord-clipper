/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the shelf of sounds and pictures
 *
 * An air horn is not used once. Neither is a logo, a subscribe banner or the
 * three reaction images someone puts on everything they post. Until now every
 * one of those had to be found in a file picker again for every montage, which
 * is the kind of friction that stops an edit from happening at all.
 *
 * So: a shelf. Paths, kept in the settings, listed in the studio, placed with
 * one click. Paths rather than bytes on purpose - a sound effect lives where
 * the user keeps it, and copying its samples into the settings file would make
 * that file huge, slow to read on every start, and wrong the moment the source
 * file is replaced.
 *
 * The cost of that choice is that a shelf entry can go stale when the file is
 * moved or deleted. That is not hidden: loading one throws, the studio says
 * which entry failed, and the entry can be dropped from the shelf on the spot.
 */

import { Logger } from "@utils/Logger";

import { settings } from "./settings";

const logger = new Logger("Clipper", "#f0b132");

export type AssetKind = "sound" | "image";

/** A file on the shelf. `id` is stable so a placement can refer to it. */
export interface Asset {
    id: string;
    kind: AssetKind;
    /** Shown in the list. Defaults to the file name, and can be renamed. */
    name: string;
    path: string;
    /** When it was last placed on a timeline, for the "recent" ordering. */
    usedAt?: number;
}

/** A shelf longer than this is a file browser, and there is one of those. */
const MAX_ASSETS = 120;

interface Shelf {
    items: Asset[];
}

function newId(): string {
    return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clean(value: unknown): Asset | null {
    const raw = value as Partial<Asset> | undefined;
    if (!raw || typeof raw.path !== "string" || !raw.path.trim()) return null;

    const kind: AssetKind = raw.kind === "image" ? "image" : "sound";
    const name = (typeof raw.name === "string" && raw.name.trim()) || raw.path.split(/[\\/]/).pop() || "asset";

    return {
        id: typeof raw.id === "string" && raw.id ? raw.id : newId(),
        kind,
        name: name.slice(0, 80),
        path: raw.path,
        ...(typeof raw.usedAt === "number" && Number.isFinite(raw.usedAt) ? { usedAt: raw.usedAt } : {})
    };
}

/**
 * The shelf as it is stored, with every entry checked.
 *
 * The setting is a free-form custom value that an older version or a hand edit
 * may have written, and an entry with no path would reach the loader as
 * `undefined` and fail somewhere far from here.
 */
function readAssets(kind?: AssetKind): Asset[] {
    const raw = settings.store.assetLibrary as Partial<Shelf> | undefined;
    const items = Array.isArray(raw?.items) ? raw.items : [];

    const cleaned = items
        .map(clean)
        .filter((a): a is Asset => !!a)
        .slice(0, MAX_ASSETS);

    return kind ? cleaned.filter(a => a.kind === kind) : cleaned;
}

function writeAssets(items: Asset[]): void {
    // Assigned whole: the settings store only notices a new value on the key.
    settings.store.assetLibrary = { items: items.slice(0, MAX_ASSETS).map(a => ({ ...a })) };
}

/**
 * Puts files on the shelf, skipping the ones already there.
 *
 * Answers with the entries for every path handed in, new or not, so a caller
 * that just picked five files can place all five whether or not four of them
 * were already known.
 */
export function addAssets(kind: AssetKind, paths: string[]): Asset[] {
    const items = readAssets();
    const byPath = new Map(items.map(a => [a.path.toLowerCase(), a]));
    const touched: Asset[] = [];

    for (const path of paths) {
        if (!path) continue;

        const existing = byPath.get(path.toLowerCase());
        if (existing) {
            touched.push(existing);
            continue;
        }

        const entry: Asset = {
            id: newId(),
            kind,
            name: (path.split(/[\\/]/).pop() || "asset").slice(0, 80),
            path
        };

        items.push(entry);
        byPath.set(path.toLowerCase(), entry);
        touched.push(entry);
    }

    if (items.length > MAX_ASSETS) {
        // The oldest untouched entries go first: the shelf is a working set,
        // not an archive, and something placed last week is what is wanted.
        items.sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0));
        items.length = MAX_ASSETS;
    }

    try {
        writeAssets(items);
    } catch (e) {
        logger.warn("Could not write the asset shelf", e);
    }

    return touched;
}

export function removeAsset(id: string): void {
    try {
        writeAssets(readAssets().filter(a => a.id !== id));
    } catch (e) {
        logger.warn("Could not drop an asset from the shelf", e);
    }
}

/** Notes that an asset was placed, which is what orders the list. */
export function touchAsset(id: string): void {
    try {
        writeAssets(readAssets().map(a => a.id === id ? { ...a, usedAt: Date.now() } : a));
    } catch (e) {
        logger.warn("Could not mark an asset as used", e);
    }
}

/** Most recently placed first, then everything else by name. */
export function sortedAssets(kind: AssetKind): Asset[] {
    return readAssets(kind).sort((a, b) => {
        const used = (b.usedAt ?? 0) - (a.usedAt ?? 0);
        return used || a.name.localeCompare(b.name);
    });
}
