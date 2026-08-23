/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - studio.
 *
 * The montage side of the plugin: several clips and outside videos chained on a
 * timeline, each segment trimmed, sped up, faded and colour-graded on its own,
 * with captions over the result. The render engine is in ../studio; this file is
 * only the surface.
 *
 * Same isolation rules as the rest of the overlay: own React root, no Discord
 * internal component, one shared stylesheet.
 */

import { Toasts, useEffect, useRef, useState } from "@webpack/common";

import {
    deleteClip,
    frameName,
    listClips,
    loadClipUrl,
    loadVideoFile,
    pickVideoFiles,
    probeRange,
    renameClip,
    renderName,
    revealClip,
    saveFrame,
    type StoredClip,
    writeClipCopy
} from "../clips";
import {
    categoriesOf,
    type ClipMeta,
    dropMeta,
    moveMeta,
    pruneMeta,
    readMeta,
    setMeta,
    UNCATEGORISED
} from "../library";
import { logger } from "../recorder";
import {
    type Caption,
    DEFAULT_CAPTION_STYLE,
    DEFAULT_EFFECTS,
    type Effects,
    estimatedSize,
    newId,
    type Project,
    projectLength,
    renderProject,
    type Segment,
    segmentLength,
    segmentStart,
    type SourceOrigin,
    type StudioSource
} from "../studio";
import { formatBytes } from "../utils";
import { AudioMixerInput } from "./AudioMixer";

export const STUDIO_CSS = `
.vc-clipper-studio {
    width: min(1240px, 96vw);
    height: min(820px, 92vh);
}
.vc-clipper-studio-body {
    display: flex;
    flex: 1;
    min-height: 0;
}
.vc-clipper-studio-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    padding: 10px 12px;
    gap: 10px;
}
.vc-clipper-studio-main video {
    width: 100%;
    flex: 1;
    min-height: 0;
    border-radius: 8px;
    background: #000;
}
.vc-clipper-side {
    width: 300px;
    flex: 0 0 auto;
    overflow-y: auto;
    padding: 10px;
    border-left: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
}
.vc-clipper-side.vc-clipper-side-left {
    border-left: none;
    border-right: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
    width: 250px;
}
.vc-clipper-side h4 {
    margin: 0 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .02em;
    color: var(--header-secondary, #b5bac1);
}
.vc-clipper-side-clip {
    display: block;
    width: 100%;
    margin-bottom: 4px;
    padding: 7px 9px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text-normal, #dbdee1);
    text-align: left;
    font-size: 13px;
    cursor: pointer;
}
.vc-clipper-side-clip:hover {
    background: var(--background-modifier-hover, rgba(78, 80, 88, .3));
}
.vc-clipper-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
}
.vc-clipper-tabs button {
    flex: 1 1 64px;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: var(--background-secondary, #2b2d31);
    color: var(--text-normal, #dbdee1);
    font-size: 12px;
    cursor: pointer;
}
.vc-clipper-tabs button.vc-clipper-active {
    background: var(--brand-experiment, #5865f2);
    color: #fff;
}
/* The mixer draws itself with inline styles; the sidebar only has to keep its
   sliders usable at half the width of the settings panel. */
.vc-clipper-mixer input[type="range"] {
    min-width: 96px;
}
.vc-clipper-timeline {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 6px;
    min-height: 74px;
    border-radius: 8px;
    background: var(--background-secondary, #2b2d31);
}
.vc-clipper-block {
    flex: 0 0 auto;
    min-width: 74px;
    padding: 7px 9px;
    border: 2px solid transparent;
    border-radius: 6px;
    background: var(--background-tertiary, #1e1f22);
    color: var(--text-normal, #dbdee1);
    text-align: left;
    font-size: 12px;
    cursor: pointer;
    overflow: hidden;
}
.vc-clipper-block.vc-clipper-active {
    border-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-block small {
    display: block;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-field {
    margin-bottom: 10px;
    font-size: 13px;
}
.vc-clipper-field label {
    display: flex;
    justify-content: space-between;
    margin-bottom: 3px;
    color: var(--header-secondary, #b5bac1);
    font-size: 12px;
}
.vc-clipper-field input[type="range"] {
    width: 100%;
}
.vc-clipper-field input[type="number"],
.vc-clipper-field input[type="text"],
.vc-clipper-field textarea,
.vc-clipper-field select {
    width: 100%;
    padding: 5px 7px;
    border: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
    border-radius: 5px;
    background: var(--input-background, #1e1f22);
    color: var(--text-normal, #dbdee1);
    font-size: 13px;
    box-sizing: border-box;
}
.vc-clipper-field textarea {
    min-height: 58px;
    resize: vertical;
}
.vc-clipper-row {
    display: flex;
    gap: 6px;
}
.vc-clipper-caption-item {
    margin-bottom: 8px;
    padding: 8px;
    border-radius: 6px;
    background: var(--background-secondary, #2b2d31);
}
.vc-clipper-studio-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.vc-clipper-side-clip.vc-clipper-active {
    background: var(--background-modifier-selected, #43444b);
}
.vc-clipper-side-clip .vc-clipper-meta {
    margin-top: 2px;
    font-size: 11px;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-side-manage {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
}
.vc-clipper-side-manage h4 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: none;
}
.vc-clipper-side-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
}
.vc-clipper-side-actions button,
.vc-clipper-row button,
.vc-clipper-studio-foot button {
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: var(--button-secondary-background, #4e5058);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
}
.vc-clipper-side-actions button:hover:not(:disabled),
.vc-clipper-row button:hover:not(:disabled),
.vc-clipper-studio-foot button:hover:not(:disabled) {
    background: var(--button-secondary-background-hover, #6d6f78);
}
.vc-clipper-side-actions button:disabled,
.vc-clipper-row button:disabled,
.vc-clipper-studio-foot button:disabled {
    opacity: .5;
    cursor: default;
}
.vc-clipper-side-actions button.vc-clipper-primary,
.vc-clipper-studio-foot button.vc-clipper-primary {
    background: var(--brand-experiment, #5865f2);
}
.vc-clipper-side-actions button.vc-clipper-danger,
.vc-clipper-row button.vc-clipper-danger,
.vc-clipper-studio-foot button.vc-clipper-danger {
    background: var(--button-danger-background, #da373c);
}
`;

function formatTime(seconds: number): string {
    const value = Math.max(0, seconds);
    const minutes = Math.floor(value / 60);
    const rest = value - minutes * 60;

    return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

function toast(message: string, type: string) {
    Toasts.show({ id: Toasts.genId(), message, type });
}

/** Reads a video's real range without showing it, for a source being added. */
async function probeFile(url: string): Promise<{ start: number; end: number; }> {
    const video = document.createElement("video");
    video.src = url;
    video.preload = "auto";

    await new Promise<void>(resolve => {
        let done = false;
        const settle = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve();
        };

        const timer = setTimeout(settle, 8000);
        video.addEventListener("loadeddata", settle, { once: true });
        video.addEventListener("error", settle, { once: true });
        video.load();
    });

    try {
        return await probeRange(video);
    } finally {
        video.src = "";
    }
}

const OUTPUT_HEIGHTS = [1440, 1080, 720, 480];

const STORAGE_KEY = "vc-clipper-studio-project";

/** Shown when the clip folder cannot be listed; cleared by the next good read. */
const FOLDER_ERROR = "Could not read the clip folder";

/**
 * What is kept between two openings of the studio.
 *
 * The bytes are not: object URLs die with the page. Only the timeline and where
 * each source came from are stored, and the sources are fetched again on the way
 * back in - which is also why a source without an origin cannot be restored.
 */
interface SavedProject {
    project: Project;
    sources: { id: string; name: string; origin?: SourceOrigin; }[];
}

function readSaved(): SavedProject | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as SavedProject;
        if (!parsed?.project?.segments?.length || !Array.isArray(parsed.sources)) return null;

        // A document written by an older version is missing whatever was added
        // since, so every field falls back to its default rather than to
        // undefined, which would reach the canvas as NaN.
        return {
            sources: parsed.sources,
            project: {
                ...parsed.project,
                segments: parsed.project.segments.map(s => ({ ...s, effects: { ...DEFAULT_EFFECTS, ...s.effects } })),
                captions: parsed.project.captions ?? [],
                captionStyle: { ...DEFAULT_CAPTION_STYLE, ...parsed.project.captionStyle },
                height: Number(parsed.project.height) || 1080,
                fps: Number(parsed.project.fps) || 30,
                audio: parsed.project.audio !== false
            }
        };
    } catch (e) {
        logger.warn("Could not read the saved studio project", e);
        return null;
    }
}

function writeSaved(value: SavedProject | null) {
    try {
        if (!value) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (e) {
        logger.warn("Could not save the studio project", e);
    }
}

export function ClipStudio({ onClose, initial }: { onClose(): void; initial?: string; }) {
    const [clips, setClips] = useState<StoredClip[] | null>(null);
    const [sources, setSources] = useState<StudioSource[]>([]);
    const [project, setProject] = useState<Project>({
        segments: [],
        captions: [],
        captionStyle: { ...DEFAULT_CAPTION_STYLE },
        height: 1080,
        fps: 30,
        audio: true
    });

    const [selected, setSelected] = useState("");
    const [tab, setTab] = useState<"segment" | "captions" | "audio" | "output">("segment");
    const [progress, setProgress] = useState(-1);
    const [note, setNote] = useState("");
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");

    // The clip library, which used to be its own modal: the picked clip is the
    // one the rename, category and delete actions act on, and it is kept apart
    // from `selected`, which is a segment on the timeline.
    const [meta, setMetaState] = useState<Record<string, ClipMeta>>({});
    const [category, setCategory] = useState("");
    const [picked, setPicked] = useState("");
    const [renaming, setRenaming] = useState("");
    const [tagging, setTagging] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(false);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const sourcesRef = useRef<StudioSource[]>([]);
    const projectRef = useRef(project);
    const cancelRef = useRef(false);

    sourcesRef.current = sources;
    projectRef.current = project;

    /*
     * Undo stack.
     *
     * A ref rather than state: nothing on screen depends on it, and pushing the
     * previous project from inside a setter is what would put a write in the
     * render pass. Sliders fire a change per pixel, so an edit repeated under
     * the same tag within the coalescing window extends the current step instead
     * of opening a new one.
     */
    const historyRef = useRef<{ past: Project[]; future: Project[]; }>({ past: [], future: [] });
    const lastEditRef = useRef({ tag: "", at: 0 });
    const [depth, setDepth] = useState({ past: 0, future: 0 });

    /*
     * `updater` runs during the render pass, long after the event handler that
     * called this has returned: React has cleared `currentTarget` by then, so an
     * updater reading it throws on a null. Read the value in the handler and
     * close over it instead.
     */
    const commit = (updater: (p: Project) => Project, tag = "") => {
        const history = historyRef.current;
        const now = Date.now();
        const last = lastEditRef.current;

        if (!tag || last.tag !== tag || now - last.at > 700) {
            history.past.push(projectRef.current);
            if (history.past.length > 40) history.past.shift();
            history.future = [];
        }

        lastEditRef.current = { tag, at: now };
        setProject(updater);
        setDepth({ past: history.past.length, future: history.future.length });
    };

    const step = (from: "past" | "future", to: "past" | "future") => {
        const history = historyRef.current;
        const target = history[from].pop();
        if (!target) return;

        history[to].push(projectRef.current);
        lastEditRef.current = { tag: "", at: 0 };

        setProject(target);
        setSelected(current => target.segments.some(s => s.id === current) ? current : "");
        setDepth({ past: history.past.length, future: history.future.length });
    };

    const undo = () => step("past", "future");
    const redo = () => step("future", "past");

    const rendering = progress >= 0;
    const busy = rendering || !!note;

    const segment = project.segments.find(s => s.id === selected) ?? null;
    const source = segment ? sources.find(s => s.id === segment.sourceId) ?? null : null;
    const total = projectLength(project);

    // One lookup table rather than a scan per timeline block; a long montage
    // redraws this list on every slider move.
    const byId = new Map(sources.map(s => [s.id, s]));

    /** Every category present in the folder, for the filter dropdown. */
    const categories = categoriesOf((clips ?? []).map(c => c.name), meta);

    const categoryOf = (name: string) => meta[name]?.game?.trim() || UNCATEGORISED;

    const needle = search.trim().toLowerCase();
    const shown = (clips ?? []).filter(c =>
        (!category || categoryOf(c.name) === category)
        && (!needle || c.name.toLowerCase().includes(needle) || categoryOf(c.name).toLowerCase().includes(needle))
    );

    /**
     * Rereads the clip folder and its categories.
     *
     * Categories live in a sidecar file, so clips deleted from the file explorer
     * leave entries behind: the listing is what decides what is still real.
     */
    const refreshClips = async (pick?: string) => {
        try {
            const found = await listClips();
            setClips(found);
            setError(current => current === FOLDER_ERROR ? "" : current);

            await pruneMeta(found.map(c => c.name));
            setMetaState({ ...await readMeta() });

            if (pick !== undefined) setPicked(pick);
            else setPicked(current => found.some(c => c.name === current) ? current : "");
        } catch (e) {
            logger.warn("Could not list clips for the studio", e);
            setError(FOLDER_ERROR);
            setClips([]);
        }
    };

    const onRename = async () => {
        const wanted = renaming.trim();
        setRenaming("");
        if (!wanted || wanted === picked) return;

        try {
            const next = await renameClip(picked, wanted);
            await moveMeta(picked, next);

            setSources(list => list.map(s => s.origin?.kind === "clip" && s.origin.name === picked
                ? { ...s, name: next, origin: { kind: "clip", name: next } }
                : s));

            await refreshClips(next);
        } catch (e) {
            logger.warn("Rename failed", e);
            toast("Could not rename that clip", Toasts.Type.FAILURE);
        }
    };

    const onDeleteClip = async () => {
        if (!confirmDelete) {
            setConfirmDelete(true);
            setTimeout(() => setConfirmDelete(false), 4000);
            return;
        }

        setConfirmDelete(false);

        try {
            await deleteClip(picked);
            await dropMeta(picked);
            await refreshClips("");
        } catch (e) {
            logger.warn("Delete failed", e);
            toast("Could not delete that clip", Toasts.Type.FAILURE);
        }
    };

    /** Files the picked clip under a category, or clears it when empty. */
    const applyCategory = async (value: string) => {
        if (!picked) return;

        setTagging("");

        try {
            await setMeta(picked, { game: value.trim() });
            setMetaState({ ...await readMeta() });
        } catch (e) {
            logger.warn("Could not tag that clip", e);
            toast("Could not save that category", Toasts.Type.FAILURE);
        }
    };

    /** Writes the frame under the playhead next to the clip it came from. */
    const onSaveFrame = async () => {
        const video = videoRef.current;
        if (!video || !source) return;

        try {
            const path = await saveFrame(video, frameName(source.name, video.currentTime));
            toast("Frame saved next to the clip", Toasts.Type.SUCCESS);
            logger.info("Saved a frame", path);
        } catch (e) {
            logger.warn("Could not save the frame", e);
            toast("Could not save that frame", Toasts.Type.FAILURE);
        }
    };

    /** Fetches the bytes of a source again, from the clip folder or from disk. */
    const openSource = async (origin: SourceOrigin): Promise<{ name: string; url: string; }> => {
        if (origin.kind === "clip") return { name: origin.name, url: await loadClipUrl(origin.name) };

        return loadVideoFile(origin.path);
    };

    /** Puts a saved timeline back together, source by source. */
    const restore = async (saved: SavedProject) => {
        setNote("Restoring the last timeline…");

        const loaded: StudioSource[] = [];
        for (const entry of saved.sources) {
            if (!entry.origin) continue;

            try {
                const { url } = await openSource(entry.origin);
                loaded.push({ id: entry.id, name: entry.name, url, origin: entry.origin });
            } catch (e) {
                logger.warn("Could not restore a timeline source", e);
            }
        }

        // A clip deleted since the project was saved takes its segments with it
        // rather than leaving holes the renderer would skip silently.
        const alive = new Set(loaded.map(s => s.id));
        const segments = saved.project.segments.filter(s => alive.has(s.sourceId));

        if (!segments.length) {
            loaded.forEach(s => URL.revokeObjectURL(s.url));
            writeSaved(null);
            setNote("");
            return;
        }

        setSources(loaded);
        setProject({ ...saved.project, segments });
        setSelected(segments[0].id);
        setNote("");

        if (segments.length !== saved.project.segments.length) {
            setError("Some files of the saved timeline are gone; their segments were dropped.");
        }
    };

    useEffect(() => {
        void refreshClips();

        /*
         * The saved timeline comes back first, then whatever the clip editor
         * handed over: both load asynchronously, and letting them race would
         * have the slower one overwrite the other's segments.
         */
        void (async () => {
            const saved = readSaved();
            if (saved) await restore(saved);

            if (initial) await onAddClip(initial);
        })();

        // The object URLs live as long as the modal does; nothing else holds them.
        return () => sourcesRef.current.forEach(s => URL.revokeObjectURL(s.url));
    }, []);

    /*
     * The timeline outlives the modal.
     *
     * Debounced, because a slider drag would otherwise serialise the whole
     * project on every pixel, and skipped while rendering, where the project
     * cannot change anyway.
     */
    useEffect(() => {
        if (rendering) return;

        const timer = setTimeout(() => {
            if (!project.segments.length) writeSaved(null);
            else writeSaved({ project, sources: sources.map(({ id, name, origin }) => ({ id, name, origin })) });
        }, 600);

        return () => clearTimeout(timer);
    }, [project, sources, rendering]);

    const patchSegment = (id: string, patch: Partial<Segment>, tag = "") => {
        commit(p => ({ ...p, segments: p.segments.map(s => s.id === id ? { ...s, ...patch } : s) }), tag);
    };

    const patchEffects = (id: string, patch: Partial<Effects>, tag = "") => {
        commit(p => ({
            ...p,
            segments: p.segments.map(s => s.id === id ? { ...s, effects: { ...s.effects, ...patch } } : s)
        }), tag);
    };

    /** Adds a whole file to the end of the timeline as one segment. */
    const addSource = async (name: string, url: string, origin?: SourceOrigin) => {
        const range = await probeFile(url);
        const length = Math.max(0, range.end - range.start);

        if (length <= 0) {
            URL.revokeObjectURL(url);
            throw new Error(`"${name}" has nothing to play - this client may not decode it (MKV and some MOV files need remuxing to MP4 first)`);
        }

        const source: StudioSource = { id: newId(), name, url, origin };
        const segment: Segment = {
            id: newId(),
            sourceId: source.id,
            from: range.start,
            to: range.end,
            speed: 1,
            volume: 1,
            effects: { ...DEFAULT_EFFECTS }
        };

        setSources(list => [...list, source]);
        commit(p => ({ ...p, segments: [...p.segments, segment] }));
        setSelected(segment.id);
    };

    const onAddClip = async (name: string) => {
        setNote(`Loading ${name}…`);
        setError("");

        try {
            await addSource(name, await loadClipUrl(name), { kind: "clip", name });
        } catch (e) {
            logger.warn("Could not add a clip to the timeline", e);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setNote("");
        }
    };

    const onImport = async () => {
        setError("");

        const paths = await pickVideoFiles();
        if (!paths.length) return;

        setNote("Importing…");

        try {
            for (const path of paths) {
                const { name, url } = await loadVideoFile(path);
                await addSource(name, url, { kind: "file", path });
            }
        } catch (e) {
            logger.warn("Could not import a video", e);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setNote("");
        }
    };

    const move = (id: string, delta: number) => {
        commit(p => {
            const index = p.segments.findIndex(s => s.id === id);
            const next = index + delta;
            if (index < 0 || next < 0 || next >= p.segments.length) return p;

            const segments = [...p.segments];
            const [moved] = segments.splice(index, 1);
            segments.splice(next, 0, moved);

            return { ...p, segments };
        });
    };

    const duplicate = (id: string) => {
        commit(p => {
            const index = p.segments.findIndex(s => s.id === id);
            if (index < 0) return p;

            const copy: Segment = { ...p.segments[index], id: newId(), effects: { ...p.segments[index].effects } };
            const segments = [...p.segments];
            segments.splice(index + 1, 0, copy);

            return { ...p, segments };
        });
    };

    /**
     * Cuts a segment in two at the playhead.
     *
     * Both halves keep pointing at the same source, so nothing is loaded again
     * and each half can then take its own speed and effects.
     */
    const split = () => {
        const video = videoRef.current;
        if (!video || !segment) return;

        const at = video.currentTime;
        if (at <= segment.from + 0.2 || at >= segment.to - 0.2) {
            toast("Move the playhead inside the segment first", Toasts.Type.FAILURE);
            return;
        }

        commit(p => {
            const index = p.segments.findIndex(s => s.id === segment.id);
            if (index < 0) return p;

            const left: Segment = { ...segment, to: at };
            const right: Segment = { ...segment, id: newId(), from: at, effects: { ...segment.effects } };
            const segments = [...p.segments];
            segments.splice(index, 1, left, right);

            return { ...p, segments };
        });
    };

    /*
     * Removing a segment leaves its source loaded.
     *
     * Undo has to be able to bring the segment back, and revoking the object URL
     * would leave it pointing at nothing. The URLs are released together when the
     * modal closes or the timeline is cleared, which is also the only place where
     * releasing one cannot race with something still showing it.
     */
    const remove = (id: string) => {
        commit(p => ({ ...p, segments: p.segments.filter(s => s.id !== id) }));
        setSelected(current => current === id ? "" : current);
    };

    /** Empties the timeline and forgets the saved project. */
    const clearProject = () => {
        const video = videoRef.current;
        if (video?.src) {
            video.pause();
            video.removeAttribute("src");
            video.load();
        }

        sources.forEach(s => URL.revokeObjectURL(s.url));
        historyRef.current = { past: [], future: [] };

        setSources([]);
        setSelected("");
        setError("");
        setDepth({ past: 0, future: 0 });
        setProject(p => ({ ...p, segments: [], captions: [] }));
        writeSaved(null);
    };

    // Show the selected segment, from its own start, without touching playback
    // when only its effects changed.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        if (!segment || !source) {
            // Nothing selected any more: drop the source rather than leave the
            // element pointing at a URL that is about to be revoked.
            if (video.src) {
                video.pause();
                video.removeAttribute("src");
                video.load();
            }
            return;
        }

        if (video.src !== source.url) {
            video.src = source.url;
            video.load();
        }

        const seek = () => {
            try {
                video.currentTime = segment.from;
            } catch {
                // Not seekable yet; the loadeddata handler below tries again.
            }
        };

        if (video.readyState >= 1) seek();
        else video.addEventListener("loadeddata", seek, { once: true });
    }, [selected, source?.url]);

    const addCaption = () => {
        const video = videoRef.current;
        const index = project.segments.findIndex(s => s.id === selected);

        // Anchor the caption where the eye is: the playhead inside the selected
        // segment, translated to project time.
        const at = video && segment && index >= 0
            ? segmentStart(project, index) + Math.max(0, video.currentTime - segment.from) / segment.speed
            : 0;

        const caption: Caption = { id: newId(), from: at, to: Math.min(total, at + 3), text: "" };

        commit(p => ({ ...p, captions: [...p.captions, caption] }));
        setTab("captions");
    };

    const patchCaption = (id: string, patch: Partial<Caption>, tag = "") => {
        commit(p => ({ ...p, captions: p.captions.map(c => c.id === id ? { ...c, ...patch } : c) }), tag);
    };

    /** Plays the selected segment from its start and stops on its out point. */
    const playSegment = () => {
        const video = videoRef.current;
        if (!video || !segment) return;

        video.currentTime = segment.from;
        void video.play().catch(() => void 0);
    };

    // The player holds the whole source, so nothing would stop it at the out
    // point on its own; without this, previewing a two-second cut plays the
    // fifteen seconds after it.
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !segment) return;

        const stop = () => {
            if (video.currentTime >= segment.to) video.pause();
        };

        video.addEventListener("timeupdate", stop);
        return () => video.removeEventListener("timeupdate", stop);
    }, [selected, segment?.to]);

    /*
     * Studio shortcuts.
     *
     * Bound on the window in the capture phase so Discord never sees them, and
     * dropped while a field has focus - typing a caption must not delete the
     * segment behind it.
     */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

            if (e.key === "Escape") {
                if (busy) return;

                e.stopPropagation();
                onClose();
                return;
            }

            if (busy) return;

            const key = e.key.toLowerCase();

            if (e.ctrlKey || e.metaKey) {
                if (key === "z" && !e.shiftKey) undo();
                else if ((key === "z" && e.shiftKey) || key === "y") redo();
                else return;

                e.preventDefault();
                e.stopPropagation();
                return;
            }

            if (e.altKey) return;

            const video = videoRef.current;

            switch (key) {
                case " ":
                    if (!video) return;
                    video.paused ? playSegment() : video.pause();
                    break;
                case "s": split(); break;
                case "d": if (selected) duplicate(selected); break;
                case "delete":
                case "backspace": if (selected) remove(selected); break;
                case "arrowleft":
                    if (!video) return;
                    video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 1 : 0.1));
                    break;
                case "arrowright":
                    if (!video) return;
                    video.currentTime += e.shiftKey ? 1 : 0.1;
                    break;
                default: return;
            }

            e.preventDefault();
            e.stopPropagation();
        };

        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [busy, selected, segment, project]);

    const onExport = async () => {
        cancelRef.current = false;
        setError("");
        setProgress(0);

        try {
            const blob = await renderProject(project, sources, {
                onProgress: setProgress,
                cancelled: () => cancelRef.current
            });

            const first = sources.find(s => s.id === project.segments[0]?.sourceId);
            const path = await writeClipCopy(blob, renderName(first?.name ?? "timeline", blob.type));

            toast(`Montage saved (${formatBytes(blob.size)})`, Toasts.Type.SUCCESS);
            logger.info("Rendered a montage", path);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);

            if (cancelRef.current) toast("Render cancelled", Toasts.Type.MESSAGE);
            else {
                logger.error("Montage render failed", e);
                setError(message);
                toast(`Render failed: ${message}`, Toasts.Type.FAILURE);
            }
        } finally {
            setProgress(-1);
        }
    };

    const slider = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, suffix = "") => (
        <div className="vc-clipper-field">
            <label>
                <span>{label}</span>
                <span>{value}{suffix}</span>
            </label>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={busy}
                onChange={e => onChange(Number(e.currentTarget.value))}
            />
        </div>
    );

    return (
        <div className="vc-clipper-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className="vc-clipper-modal vc-clipper-studio">
                <div className="vc-clipper-head">
                    <div>
                        <h2>Clip studio</h2>
                        <p>Manage the clip folder, chain clips and videos, trim each one, add effects and captions, render it as a single file.</p>
                    </div>
                    <button className="vc-clipper-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
                </div>

                <div className="vc-clipper-studio-body">
                    <div className="vc-clipper-side vc-clipper-side-left">
                        <h4>Clip library</h4>

                        <button className="vc-clipper-side-clip" disabled={busy} onClick={() => void onImport()}>
                            Import a video file…
                        </button>

                        {!!clips?.length && (
                            <div className="vc-clipper-field">
                                <input
                                    type="text"
                                    value={search}
                                    placeholder="Search a clip…"
                                    disabled={busy}
                                    onChange={e => setSearch(e.currentTarget.value)}
                                />
                            </div>
                        )}

                        {categories.length > 1 && (
                            <div className="vc-clipper-field">
                                <select value={category} disabled={busy} onChange={e => setCategory(e.currentTarget.value)}>
                                    <option value="">Every category</option>
                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        )}

                        {clips === null && <div className="vc-clipper-note">Reading the clip folder…</div>}
                        {clips?.length === 0 && <div className="vc-clipper-note">No clip saved yet.</div>}
                        {!!clips?.length && !shown.length && <div className="vc-clipper-note">No clip matches.</div>}

                        {shown.map(clip => (
                            <button
                                key={clip.name}
                                className={`vc-clipper-side-clip${clip.name === picked ? " vc-clipper-active" : ""}`}
                                disabled={busy}
                                title={`${clip.name} - double-click to put it on the timeline`}
                                onClick={() => { setPicked(clip.name); setConfirmDelete(false); setRenaming(""); }}
                                onDoubleClick={() => void onAddClip(clip.name)}
                            >
                                <div className="vc-clipper-name">{clip.name}</div>
                                <div className="vc-clipper-meta">{formatBytes(clip.size)} - {categoryOf(clip.name)}</div>
                            </button>
                        ))}

                        {!!picked && (
                            <div className="vc-clipper-side-manage">
                                <h4 title={picked}>{picked}</h4>

                                <div className="vc-clipper-side-actions">
                                    <button className="vc-clipper-primary" disabled={busy} onClick={() => void onAddClip(picked)}>
                                        Add to the timeline
                                    </button>
                                    <button disabled={busy} onClick={() => void revealClip(picked)}>Show in folder</button>
                                    <button disabled={busy} onClick={() => setRenaming(picked)}>Rename</button>
                                    <button
                                        className={confirmDelete ? "vc-clipper-danger" : ""}
                                        disabled={busy}
                                        onClick={() => void onDeleteClip()}
                                    >
                                        {confirmDelete ? "Delete for good?" : "Delete"}
                                    </button>
                                </div>

                                {!!renaming && (
                                    <div className="vc-clipper-field">
                                        <label><span>New name</span><span>Enter to save</span></label>
                                        <input
                                            type="text"
                                            autoFocus
                                            value={renaming}
                                            onChange={e => setRenaming(e.currentTarget.value)}
                                            onKeyDown={e => {
                                                e.stopPropagation();
                                                if (e.key === "Enter") void onRename();
                                                if (e.key === "Escape") setRenaming("");
                                            }}
                                        />
                                    </div>
                                )}

                                <div className="vc-clipper-field">
                                    <label><span>Category</span><span>{categoryOf(picked)}</span></label>
                                    <input
                                        type="text"
                                        value={tagging}
                                        placeholder="File it under…"
                                        disabled={busy}
                                        list="vc-clipper-categories"
                                        onChange={e => setTagging(e.currentTarget.value)}
                                        onKeyDown={e => {
                                            e.stopPropagation();
                                            if (e.key === "Enter") void applyCategory(tagging);
                                            if (e.key === "Escape") setTagging("");
                                        }}
                                    />
                                    <datalist id="vc-clipper-categories">
                                        {categories.filter(c => c !== UNCATEGORISED).map(c => <option key={c} value={c} />)}
                                    </datalist>
                                </div>

                                <div className="vc-clipper-side-actions">
                                    <button disabled={busy || !tagging.trim()} onClick={() => void applyCategory(tagging)}>File it</button>
                                    <button
                                        disabled={busy || categoryOf(picked) === UNCATEGORISED}
                                        onClick={() => void applyCategory("")}
                                    >
                                        Unfile it
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="vc-clipper-studio-main">
                        {error && <div className="vc-clipper-note vc-clipper-error">{error}</div>}
                        {note && <div className="vc-clipper-note">{note}</div>}

                        <video ref={videoRef} controls />

                        <div className="vc-clipper-timeline">
                            {!project.segments.length && (
                                <div className="vc-clipper-note">Add a clip on the left to start the timeline.</div>
                            )}

                            {project.segments.map((s, i) => {
                                const name = byId.get(s.sourceId)?.name ?? "?";

                                return (
                                    <button
                                        key={s.id}
                                        className={`vc-clipper-block${s.id === selected ? " vc-clipper-active" : ""}`}
                                        style={{ width: `${Math.max(74, (segmentLength(s) / Math.max(1, total)) * 620)}px` }}
                                        disabled={busy}
                                        title={name}
                                        onClick={() => { setSelected(s.id); setTab("segment"); }}
                                    >
                                        <div className="vc-clipper-name">{i + 1}. {name}</div>
                                        <small>{formatTime(segmentLength(s))}</small>
                                    </button>
                                );
                            })}
                        </div>

                        <div className="vc-clipper-studio-foot">
                            <button disabled={busy || !project.segments.length} onClick={() => void onExport()}>
                                {rendering ? `Rendering ${Math.round(progress * 100)}%` : `Render ${formatTime(total)}`}
                            </button>

                            {rendering && (
                                <button className="vc-clipper-danger" onClick={() => { cancelRef.current = true; }}>
                                    Cancel
                                </button>
                            )}

                            <button disabled={busy || !depth.past} onClick={undo} title="Ctrl+Z">Undo</button>
                            <button disabled={busy || !depth.future} onClick={redo} title="Ctrl+Shift+Z">Redo</button>
                            <button className="vc-clipper-danger" disabled={busy || !project.segments.length} onClick={clearProject}>
                                New project
                            </button>

                            <span className="vc-clipper-meta">
                                {project.segments.length} segment{project.segments.length === 1 ? "" : "s"} - {project.captions.length} caption{project.captions.length === 1 ? "" : "s"} - about {formatBytes(estimatedSize(project))}, rendered in real time
                            </span>
                        </div>
                    </div>

                    <div className="vc-clipper-side">
                        <div className="vc-clipper-tabs">
                            <button className={tab === "segment" ? "vc-clipper-active" : ""} onClick={() => setTab("segment")}>Segment</button>
                            <button className={tab === "captions" ? "vc-clipper-active" : ""} onClick={() => setTab("captions")}>Captions</button>
                            <button className={tab === "audio" ? "vc-clipper-active" : ""} onClick={() => setTab("audio")}>Audio</button>
                            <button className={tab === "output" ? "vc-clipper-active" : ""} onClick={() => setTab("output")}>Output</button>
                        </div>

                        {tab === "segment" && !segment && <div className="vc-clipper-note">Pick a segment on the timeline.</div>}

                        {tab === "segment" && segment && (
                            <>
                                <h4>{source?.name ?? "Segment"}</h4>

                                <div className="vc-clipper-field">
                                    <label><span>Start</span><span>{formatTime(segment.from)}</span></label>
                                    <div className="vc-clipper-row">
                                        <button disabled={busy} onClick={() => patchSegment(segment.id, { from: Math.min(videoRef.current?.currentTime ?? 0, segment.to - 0.2) })}>
                                            From the playhead
                                        </button>
                                        <button disabled={busy} onClick={() => patchSegment(segment.id, { from: Math.max(0, segment.from - 0.5) })}>-0.5</button>
                                        <button disabled={busy} onClick={() => patchSegment(segment.id, { from: Math.min(segment.to - 0.2, segment.from + 0.5) })}>+0.5</button>
                                    </div>
                                </div>

                                <div className="vc-clipper-field">
                                    <label><span>End</span><span>{formatTime(segment.to)}</span></label>
                                    <div className="vc-clipper-row">
                                        <button disabled={busy} onClick={() => patchSegment(segment.id, { to: Math.max(videoRef.current?.currentTime ?? 0, segment.from + 0.2) })}>
                                            From the playhead
                                        </button>
                                        <button disabled={busy} onClick={() => patchSegment(segment.id, { to: Math.max(segment.from + 0.2, segment.to - 0.5) })}>-0.5</button>
                                        <button disabled={busy} onClick={() => patchSegment(segment.id, { to: segment.to + 0.5 })}>+0.5</button>
                                    </div>
                                </div>

                                {slider("Speed", segment.speed, 0.25, 4, 0.25, v => patchSegment(segment.id, { speed: v }, "speed"), "x")}
                                {slider("Volume", Math.round(segment.volume * 100), 0, 100, 5, v => patchSegment(segment.id, { volume: v / 100 }, "volume"), "%")}

                                <h4>Effects</h4>
                                {slider("Brightness", segment.effects.brightness, 20, 200, 5, v => patchEffects(segment.id, { brightness: v }, "brightness"), "%")}
                                {slider("Contrast", segment.effects.contrast, 20, 200, 5, v => patchEffects(segment.id, { contrast: v }, "contrast"), "%")}
                                {slider("Saturation", segment.effects.saturate, 0, 300, 5, v => patchEffects(segment.id, { saturate: v }, "saturate"), "%")}
                                {slider("Black and white", segment.effects.grayscale, 0, 100, 5, v => patchEffects(segment.id, { grayscale: v }, "grayscale"), "%")}
                                {slider("Blur", segment.effects.blur, 0, 20, 1, v => patchEffects(segment.id, { blur: v }, "blur"), "px")}
                                {slider("Zoom", segment.effects.zoom, 1, 3, 0.05, v => patchEffects(segment.id, { zoom: v }, "zoom"), "x")}
                                {slider("Fade in", segment.effects.fadeIn, 0, 3, 0.1, v => patchEffects(segment.id, { fadeIn: v }, "fadeIn"), "s")}
                                {slider("Fade out", segment.effects.fadeOut, 0, 3, 0.1, v => patchEffects(segment.id, { fadeOut: v }, "fadeOut"), "s")}

                                <div className="vc-clipper-field">
                                    <label>
                                        <span>Mirror the image</span>
                                        <input
                                            type="checkbox"
                                            checked={segment.effects.flip}
                                            disabled={busy}
                                            onChange={e => patchEffects(segment.id, { flip: e.currentTarget.checked })}
                                        />
                                    </label>
                                </div>

                                <div className="vc-clipper-row" style={{ marginBottom: "6px" }}>
                                    <button disabled={busy} onClick={playSegment}>Play the segment</button>
                                    <button disabled={busy} onClick={() => patchSegment(segment.id, { from: 0, to: Math.max(0.2, videoRef.current?.duration || segment.to) })}>
                                        Whole file
                                    </button>
                                </div>

                                <div className="vc-clipper-row">
                                    <button disabled={busy} onClick={() => move(segment.id, -1)}>Move left</button>
                                    <button disabled={busy} onClick={() => move(segment.id, 1)}>Move right</button>
                                </div>
                                <div className="vc-clipper-row" style={{ marginTop: "6px" }}>
                                    <button disabled={busy} onClick={split}>Split here</button>
                                    <button disabled={busy} onClick={() => duplicate(segment.id)}>Duplicate</button>
                                    <button className="vc-clipper-danger" disabled={busy} onClick={() => remove(segment.id)}>Remove</button>
                                </div>
                                <div className="vc-clipper-row" style={{ marginTop: "6px" }}>
                                    <button disabled={busy} onClick={() => patchEffects(segment.id, { ...DEFAULT_EFFECTS })}>Reset the effects</button>
                                    <button disabled={busy} onClick={() => void onSaveFrame()}>Save the frame</button>
                                </div>
                            </>
                        )}

                        {tab === "captions" && (
                            <>
                                <button className="vc-clipper-side-clip" disabled={busy} onClick={addCaption}>
                                    Add a caption at the playhead
                                </button>

                                {!project.captions.length && <div className="vc-clipper-note">No caption yet.</div>}

                                {project.captions.map(caption => (
                                    <div key={caption.id} className="vc-clipper-caption-item">
                                        <div className="vc-clipper-field">
                                            <textarea
                                                value={caption.text}
                                                placeholder="Text shown over the video"
                                                disabled={busy}
                                                onChange={e => patchCaption(caption.id, { text: e.currentTarget.value })}
                                            />
                                        </div>

                                        <div className="vc-clipper-row">
                                            <div className="vc-clipper-field" style={{ flex: 1 }}>
                                                <label><span>From</span></label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={total}
                                                    step={0.1}
                                                    value={Number(caption.from.toFixed(1))}
                                                    disabled={busy}
                                                    onChange={e => patchCaption(caption.id, { from: Number(e.currentTarget.value) })}
                                                />
                                            </div>
                                            <div className="vc-clipper-field" style={{ flex: 1 }}>
                                                <label><span>To</span></label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={total}
                                                    step={0.1}
                                                    value={Number(caption.to.toFixed(1))}
                                                    disabled={busy}
                                                    onChange={e => patchCaption(caption.id, { to: Number(e.currentTarget.value) })}
                                                />
                                            </div>
                                        </div>

                                        <button
                                            className="vc-clipper-danger"
                                            disabled={busy}
                                            onClick={() => commit(p => ({ ...p, captions: p.captions.filter(c => c.id !== caption.id) }))}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}

                                <h4>Caption style</h4>
                                {slider("Size", Math.round(project.captionStyle.size * 100), 2, 15, 1, v => commit(p => ({ ...p, captionStyle: { ...p.captionStyle, size: v / 100 } }), "caption-size"), "%")}
                                {slider("Height", Math.round(project.captionStyle.position * 100), 10, 95, 1, v => commit(p => ({ ...p, captionStyle: { ...p.captionStyle, position: v / 100 } }), "caption-position"), "%")}

                                <div className="vc-clipper-row">
                                    <div className="vc-clipper-field" style={{ flex: 1 }}>
                                        <label><span>Text</span></label>
                                        <input
                                            type="color"
                                            value={project.captionStyle.color}
                                            disabled={busy}
                                            onChange={e => { const color = e.currentTarget.value; commit(p => ({ ...p, captionStyle: { ...p.captionStyle, color } }), "caption-color"); }}
                                        />
                                    </div>
                                    <div className="vc-clipper-field" style={{ flex: 1 }}>
                                        <label><span>Outline</span></label>
                                        <input
                                            type="color"
                                            value={project.captionStyle.outline}
                                            disabled={busy}
                                            onChange={e => { const outline = e.currentTarget.value; commit(p => ({ ...p, captionStyle: { ...p.captionStyle, outline } }), "caption-outline"); }}
                                        />
                                    </div>
                                </div>

                                <div className="vc-clipper-field">
                                    <label>
                                        <span>Box behind the text</span>
                                        <input
                                            type="checkbox"
                                            checked={project.captionStyle.background}
                                            disabled={busy}
                                            onChange={e => { const background = e.currentTarget.checked; commit(p => ({ ...p, captionStyle: { ...p.captionStyle, background } })); }}
                                        />
                                    </label>
                                </div>
                            </>
                        )}

                        {tab === "audio" && (
                            <div className="vc-clipper-mixer">
                                <AudioMixerInput compact />
                            </div>
                        )}

                        {tab === "output" && (
                            <>
                                <div className="vc-clipper-field">
                                    <label><span>Size</span></label>
                                    <select
                                        value={String(project.height)}
                                        disabled={busy}
                                        onChange={e => { const height = Number(e.currentTarget.value); commit(p => ({ ...p, height })); }}
                                    >
                                        {OUTPUT_HEIGHTS.map(h => <option key={h} value={String(h)}>{h}p</option>)}
                                    </select>
                                </div>

                                <div className="vc-clipper-field">
                                    <label><span>Frame rate</span></label>
                                    <select
                                        value={String(project.fps)}
                                        disabled={busy}
                                        onChange={e => { const fps = Number(e.currentTarget.value); commit(p => ({ ...p, fps })); }}
                                    >
                                        {[24, 30, 60].map(f => <option key={f} value={String(f)}>{f} FPS</option>)}
                                    </select>
                                </div>

                                <div className="vc-clipper-field">
                                    <label>
                                        <span>Keep the audio</span>
                                        <input
                                            type="checkbox"
                                            checked={project.audio}
                                            disabled={busy}
                                            onChange={e => { const audio = e.currentTarget.checked; commit(p => ({ ...p, audio })); }}
                                        />
                                    </label>
                                </div>

                                <div className="vc-clipper-note">
                                    The render plays the whole timeline through the encoder, so it takes about {formatTime(total)} and lands next to your clips, weighing roughly {formatBytes(estimatedSize(project))}. The bitrate and the container follow the plugin settings. Keep the window visible while it runs: a hidden window stops painting frames and the sound drifts away from the picture.
                                </div>

                                <div className="vc-clipper-note">
                                    Shortcuts: space plays the segment, S splits it, D duplicates it, Delete removes it, arrows step the playhead, Ctrl+Z and Ctrl+Shift+Z walk the edits, Esc closes the studio. The timeline is kept when you close it and comes back on the next opening.
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
