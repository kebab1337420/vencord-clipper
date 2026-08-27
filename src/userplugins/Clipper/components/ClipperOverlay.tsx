/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - floating UI mounted in its own React root.
 *
 * Nothing here is injected into Discord's component tree and nothing here uses
 * a Discord internal component. A crash inside this file can only blank this
 * overlay; the client itself keeps running. That isolation is deliberate:
 * patching the account panel meant any error here took the whole client down.
 *
 * Styling goes through one injected stylesheet rather than inline styles, so
 * hover, focus and transitions behave like the rest of the client.
 */

import { React, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { CLIPS_AVAILABLE } from "../clips";
import { requestPov } from "../multipov";
import type { CaptureSource } from "../native";
import { listCaptureSources, recorder, RecorderState, type SavedClip, setPickerOpener, setStudioOpener } from "../recorder";
import { sendClipFitted, sendClipGif } from "../send";
import { Container, settings } from "../settings";
import { formatBytes } from "../utils";
import { BufferPreview } from "./BufferPreview";
import { ClipStudio, STUDIO_CSS } from "./ClipStudio";
import { ReplayCard } from "./ReplayCard";

const STYLE_ID = "vc-clipper-style";

/** How often the open picker re-enumerates screens and windows. */
const REFRESH_MS = 2000;

/**
 * How often the previews are refetched. Each fetch opens a Windows Graphics
 * Capture session per window, and every window that refuses one spams
 * `CreateForWindow failed ... Source is not capturable` in the console, so
 * previews are refreshed far more slowly than the list itself.
 */
const THUMBNAIL_MS = 15_000;

const CSS = `
.vc-clipper-root {
    position: fixed;
    left: 10px;
    bottom: 68px;
    z-index: 1002;
}

.vc-clipper-trigger {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    color: var(--interactive-normal, #b5bac1);
    background: var(--background-secondary-alt, #232428);
    box-shadow: var(--elevation-low, 0 1px 3px rgba(0, 0, 0, .3));
    transition: background-color .15s ease, color .15s ease, transform .15s ease;
}
.vc-clipper-trigger:hover {
    color: var(--interactive-hover, #dbdee1);
    background: var(--background-modifier-hover, #35373c);
    transform: translateY(-1px);
}
.vc-clipper-trigger.vc-clipper-live {
    color: #fff;
    background: var(--status-danger, #f23f43);
}

.vc-clipper-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    min-width: 220px;
    padding: 6px;
    border-radius: 8px;
    background: var(--background-floating, #111214);
    box-shadow: var(--elevation-high, 0 8px 16px rgba(0, 0, 0, .24));
    animation: vc-clipper-rise .12s ease-out;
}
.vc-clipper-menu button {
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--interactive-normal, #b5bac1);
    font-size: 14px;
    text-align: left;
    cursor: pointer;
}
.vc-clipper-menu button:hover:not(:disabled) {
    background: var(--brand-experiment, #5865f2);
    color: #fff;
}
.vc-clipper-menu button:disabled {
    color: var(--text-muted, #949ba4);
    cursor: default;
}
.vc-clipper-menu-label {
    padding: 6px 10px 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted, #949ba4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vc-clipper-menu-status {
    padding: 4px 10px 6px;
    color: var(--text-muted, #949ba4);
    font-size: 12px;
    white-space: nowrap;
}

.vc-clipper-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1003;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, .78);
    animation: vc-clipper-fade .15s ease-out;
}

.vc-clipper-modal {
    display: flex;
    flex-direction: column;
    width: min(940px, 88vw);
    max-height: 82vh;
    overflow: hidden;
    border-radius: 12px;
    background: var(--modal-background, var(--background-primary, #313338));
    color: var(--text-normal, #dbdee1);
    box-shadow: var(--elevation-high, 0 12px 32px rgba(0, 0, 0, .5));
    animation: vc-clipper-pop .15s ease-out;
    font-family: var(--font-primary, "gg sans", sans-serif);
}

.vc-clipper-head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 20px 20px 12px;
}
.vc-clipper-head h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    line-height: 24px;
    color: var(--header-primary, #f2f3f5);
}
.vc-clipper-head p {
    margin: 4px 0 0;
    font-size: 14px;
    line-height: 18px;
    color: var(--header-secondary, #b5bac1);
}
.vc-clipper-close {
    margin-left: auto;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--interactive-normal, #b5bac1);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    transition: background-color .15s ease, color .15s ease;
}
.vc-clipper-close:hover {
    background: var(--background-modifier-hover, #35373c);
    color: var(--interactive-hover, #dbdee1);
}

.vc-clipper-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 20px 12px;
    border-bottom: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
}
.vc-clipper-tab {
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--interactive-normal, #b5bac1);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color .15s ease, color .15s ease;
}
.vc-clipper-tab:hover {
    background: var(--background-modifier-hover, #35373c);
    color: var(--interactive-hover, #dbdee1);
}
.vc-clipper-tab.vc-clipper-active {
    background: var(--background-modifier-selected, #43444b);
    color: var(--interactive-active, #fff);
}
.vc-clipper-search {
    margin-left: auto;
    width: 220px;
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--input-background, #1e1f22);
    color: var(--text-normal, #dbdee1);
    font-size: 14px;
    outline: none;
    transition: border-color .15s ease;
}
.vc-clipper-toolbar .vc-clipper-tab[title] {
    margin-left: auto;
}
.vc-clipper-toolbar .vc-clipper-search {
    margin-left: 8px;
}

.vc-clipper-search:focus {
    border-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-search::placeholder {
    color: var(--text-muted, #949ba4);
}

.vc-clipper-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px 20px;
    scrollbar-color: var(--scrollbar-thin-thumb, #1a1b1e) transparent;
}
.vc-clipper-body::-webkit-scrollbar {
    width: 8px;
}
.vc-clipper-body::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background: var(--scrollbar-thin-thumb, #1a1b1e);
}

.vc-clipper-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 14px;
}

.vc-clipper-card {
    display: flex;
    flex-direction: column;
    padding: 8px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: var(--background-secondary, #2b2d31);
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: transform .12s ease, border-color .12s ease, background-color .12s ease;
}
.vc-clipper-card:hover {
    transform: translateY(-2px);
    border-color: var(--brand-experiment, #5865f2);
    background: var(--background-secondary-alt, #232428);
}
.vc-clipper-card.vc-clipper-current {
    border-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-thumb {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: 6px;
    background: var(--background-tertiary, #1e1f22);
}
.vc-clipper-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.vc-clipper-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--brand-experiment, #5865f2);
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
}
.vc-clipper-name {
    margin-top: 8px;
    font-size: 14px;
    font-weight: 500;
    line-height: 18px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-normal, #dbdee1);
}

.vc-clipper-note {
    padding: 24px 0;
    text-align: center;
    font-size: 14px;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-note.vc-clipper-error {
    color: var(--text-danger, #f23f43);
}

.vc-clipper-foot {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    background: var(--modal-footer-background, var(--background-secondary, #2b2d31));
    font-size: 13px;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-foot button {
    margin-left: auto;
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    background: var(--button-secondary-background, #4e5058);
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color .15s ease;
}
.vc-clipper-foot button:hover {
    background: var(--button-secondary-background-hover, #6d6f78);
}

.vc-clipper-options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
    background: var(--background-secondary, #2b2d31);
}
.vc-clipper-field label {
    display: block;
    margin-bottom: 5px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .02em;
    text-transform: uppercase;
    color: var(--header-secondary, #b5bac1);
}
.vc-clipper-field select,
.vc-clipper-field input {
    width: 100%;
    padding: 7px 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--input-background, #1e1f22);
    color: var(--text-normal, #dbdee1);
    font-size: 14px;
    outline: none;
    cursor: pointer;
    transition: border-color .15s ease;
}
.vc-clipper-field select:focus,
.vc-clipper-field input:focus {
    border-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-field .vc-clipper-value {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-field input[type="range"] {
    padding: 0;
    height: 18px;
    background: none;
    accent-color: var(--brand-experiment, #5865f2);
}

.vc-clipper-preview {
    width: min(760px, 82vw);
}
.vc-clipper-preview-video {
    width: 100%;
    max-height: 46vh;
    border-radius: 8px;
    background: #000;
}

.vc-clipper-scrub {
    position: relative;
    height: 26px;
    margin-top: 12px;
    border-radius: 4px;
    cursor: pointer;
    background: var(--background-tertiary, #1e1f22);
}
.vc-clipper-range {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 4px;
    background: var(--brand-experiment, #5865f2);
    opacity: .32;
}
.vc-clipper-tick {
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--status-warning, #f0b232);
}
.vc-clipper-playhead {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-left: -1px;
    background: var(--text-normal, #dbdee1);
    pointer-events: none;
}
.vc-clipper-handle {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 10px;
    margin-left: -5px;
    border-radius: 3px;
    cursor: ew-resize;
    background: var(--brand-experiment, #5865f2);
}

.vc-clipper-preview-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 13px;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-preview-actions button {
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    background: var(--button-secondary-background, #4e5058);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
}
.vc-clipper-preview-actions button:hover {
    background: var(--button-secondary-background-hover, #6d6f78);
}
.vc-clipper-preview-actions span {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
}

.vc-clipper-replay {
    position: fixed;
    left: 10px;
    bottom: 112px;
    z-index: 1002;
    width: 268px;
    padding: 8px;
    border-radius: 10px;
    background: var(--background-floating, #111214);
    box-shadow: var(--elevation-high, 0 8px 24px rgba(0, 0, 0, .5));
    font-family: var(--font-primary, "gg sans", sans-serif);
    animation: vc-clipper-rise .15s ease-out;
}
.vc-clipper-replay-video {
    display: block;
    width: 100%;
    border-radius: 6px;
    background: #000;
    cursor: pointer;
}
.vc-clipper-replay-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-replay-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-normal, #dbdee1);
}
.vc-clipper-replay-head .vc-clipper-close {
    width: 22px;
    height: 22px;
    font-size: 16px;
}
.vc-clipper-replay-actions {
    display: flex;
    gap: 6px;
    margin-top: 6px;
}
.vc-clipper-replay-actions button {
    flex: 1;
    min-width: 0;
    padding: 6px 2px;
    border: none;
    border-radius: 6px;
    background: var(--button-secondary-background, #4e5058);
    color: #fff;
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
}
.vc-clipper-replay-actions button:hover {
    background: var(--button-secondary-background-hover, #6d6f78);
}
.vc-clipper-replay-actions button:disabled {
    opacity: .5;
    cursor: default;
}
.vc-clipper-replay-actions .vc-clipper-danger {
    background: var(--button-danger-background, #da373c);
}
.vc-clipper-replay-actions .vc-clipper-danger:hover {
    background: var(--button-danger-background-hover, #a12828);
}

@keyframes vc-clipper-fade {
    from { opacity: 0; }
}
@keyframes vc-clipper-pop {
    from { opacity: 0; transform: scale(.96); }
}
@keyframes vc-clipper-rise {
    from { opacity: 0; transform: translateY(4px); }
}
` + STUDIO_CSS;

/** Injects the stylesheet once, shared by every part of the overlay. */
/**
 * Users of the shared stylesheet.
 *
 * The overlay is mounted once per panel, and Discord mounts the panel more than
 * once during a call. Without the count the second mount finds the tag already
 * there and adopts no responsibility for it, then the first unmount removes it
 * from under the one still on screen, which loses every style at once.
 */
let styleUsers = 0;

function useStyle() {
    useEffect(() => {
        if (styleUsers++ === 0 && !document.getElementById(STYLE_ID)) {
            const style = document.createElement("style");
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }

        return () => {
            if (--styleUsers === 0) document.getElementById(STYLE_ID)?.remove();
        };
    }, []);
}

function Icon({ recording }: { recording: boolean; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M17 10.5V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3.5l4 3.5V7l-4 3.5Z"
            />
            {recording && <circle cx="9.5" cy="12" r="3" fill="var(--status-danger, #f23f43)" />}
        </svg>
    );
}

type Tab = "all" | "screen" | "window";

function Field({ label, children }: { label: string; children: any; }) {
    return (
        <div className="vc-clipper-field">
            <label>{label}</label>
            {children}
        </div>
    );
}

/**
 * Capture settings, mirrored from the plugin settings so both stay in sync.
 * Changes only reach the encoder when the buffer is (re)started, hence the
 * restart below when one is already running.
 */
function CaptureOptions() {
    const { fps, resolution, container, videoBitrate, clipLength } = settings.use([
        "fps", "resolution", "container", "videoBitrate", "clipLength"
    ]);

    const restartIfLive = () => {
        if (recorder.isRecording) void recorder.restart();
    };

    const select = (value: string | number, onPick: (v: string) => void, options: [string | number, string][]) => (
        <select
            value={String(value)}
            onChange={e => { onPick(e.currentTarget.value); restartIfLive(); }}
        >
            {options.map(([v, label]) => <option key={String(v)} value={String(v)}>{label}</option>)}
        </select>
    );

    return (
        <div className="vc-clipper-options">
            <Field label="Frame rate">
                {select(fps, v => (settings.store.fps = Number(v)), [
                    [24, "24 FPS"], [30, "30 FPS"], [60, "60 FPS"], [120, "120 FPS"]
                ])}
            </Field>

            <Field label="Resolution">
                {select(resolution, v => (settings.store.resolution = Number(v)), [
                    [0, "Source"], [2160, "2160p"], [1440, "1440p"], [1080, "1080p"], [720, "720p"], [480, "480p"]
                ])}
            </Field>

            <Field label="Encoding">
                {select(container, v => (settings.store.container = v as Container), [
                    [Container.Mp4H264, "MP4 H.264"],
                    [Container.WebmVp9, "WebM VP9"],
                    [Container.WebmVp8, "WebM VP8"]
                ])}
            </Field>

            <Field label="Quality">
                <input
                    type="range"
                    min={1}
                    max={50}
                    step={1}
                    value={videoBitrate}
                    onChange={e => (settings.store.videoBitrate = Number(e.currentTarget.value))}
                    onMouseUp={restartIfLive}
                />
                <div className="vc-clipper-value">{videoBitrate} Mbps</div>
            </Field>

            <Field label="Clip length">
                <input
                    type="range"
                    min={10}
                    max={300}
                    step={5}
                    value={clipLength}
                    onChange={e => (settings.store.clipLength = Number(e.currentTarget.value))}
                />
                <div className="vc-clipper-value">{clipLength} s</div>
            </Field>
        </div>
    );
}

function Picker({ onClose }: { onClose(): void; }) {
    const [sources, setSources] = useState<CaptureSource[] | null>(null);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<Tab>("all");
    const [query, setQuery] = useState("");
    const [refreshedAt, setRefreshedAt] = useState(0);
    const searchRef = useRef<HTMLInputElement | null>(null);
    const refreshRef = useRef<(() => void) | null>(null);

    const current = settings.store.sourceId;

    /*
     * Sources come and go while the picker is open (a game launches, a window
     * closes), so the list is polled rather than fetched once. Previews are the
     * expensive half of that: asking for them makes Chromium open a capture
     * session per window. So the poll runs without them and the last known
     * preview is reused, with a full fetch only every THUMBNAIL_MS and whenever
     * the user presses Refresh.
     */
    useEffect(() => {
        let alive = true;
        let busy = false;
        let lastThumbnails = 0;
        const thumbnails = new Map<string, string>();

        const refresh = async (force = false) => {
            if (!alive || busy || (!force && document.hidden)) return;
            busy = true;

            const withThumbnails = force || Date.now() - lastThumbnails >= THUMBNAIL_MS;

            try {
                const list = await listCaptureSources(withThumbnails);

                if (withThumbnails) {
                    lastThumbnails = Date.now();
                    thumbnails.clear();
                    for (const s of list) if (s.thumbnail) thumbnails.set(s.id, s.thumbnail);
                }

                if (alive) {
                    setSources(list.map(s => s.thumbnail
                        ? s
                        : { ...s, thumbnail: thumbnails.get(s.id) ?? "" }));
                    setError("");
                }
            } catch (e: any) {
                if (alive) setError(String(e?.message ?? e));
            } finally {
                busy = false;
                if (alive) setRefreshedAt(Date.now());
            }
        };

        void refresh(true);
        const timer = setInterval(refresh, REFRESH_MS);
        refreshRef.current = () => void refresh(true);

        searchRef.current?.focus();

        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", onKey);

        return () => {
            alive = false;
            clearInterval(timer);
            refreshRef.current = null;
            window.removeEventListener("keydown", onKey);
        };
    }, []);

    const shown = useMemo(() => {
        if (!sources) return [];

        const needle = query.trim().toLowerCase();

        return sources.filter(s => {
            const isScreen = s.id.startsWith("screen:");
            if (tab === "screen" && !isScreen) return false;
            if (tab === "window" && isScreen) return false;

            return !needle || s.name.toLowerCase().includes(needle);
        });
    }, [sources, tab, query]);

    const tabButton = (id: Tab, label: string) => (
        <button
            className={`vc-clipper-tab${tab === id ? " vc-clipper-active" : ""}`}
            onClick={() => setTab(id)}
        >
            {label}
        </button>
    );

    return (
        <div className="vc-clipper-backdrop" onClick={onClose}>
            <div className="vc-clipper-modal" onClick={e => e.stopPropagation()}>
                <div className="vc-clipper-head">
                    <div>
                        <h2>Pick what to clip</h2>
                        <p>The buffer records this source continuously and keeps only the last seconds.</p>
                    </div>
                    <button className="vc-clipper-close" onClick={onClose} aria-label="Close">&times;</button>
                </div>

                <div className="vc-clipper-toolbar">
                    {tabButton("all", "All")}
                    {tabButton("screen", "Screens")}
                    {tabButton("window", "Windows")}
                    <button
                        className="vc-clipper-tab"
                        title="Refresh the list now"
                        onClick={() => refreshRef.current?.()}
                    >
                        Refresh
                    </button>
                    <input
                        ref={searchRef}
                        className="vc-clipper-search"
                        placeholder="Search"
                        value={query}
                        onChange={e => setQuery(e.currentTarget.value)}
                    />
                </div>

                <CaptureOptions />

                <div className="vc-clipper-body">
                    {error && <div className="vc-clipper-note vc-clipper-error">{error}</div>}
                    {!error && sources == null && <div className="vc-clipper-note">Loading sources…</div>}
                    {!error && sources != null && sources.length === 0 && (
                        <div className="vc-clipper-note">
                            No source can be listed here. On Wayland the desktop portal picks the
                            source itself: close this and start the buffer, the system dialog will ask.
                        </div>
                    )}
                    {!error && sources != null && sources.length > 0 && shown.length === 0 && (
                        <div className="vc-clipper-note">Nothing matches.</div>
                    )}

                    {shown.length > 0 && (
                        <div className="vc-clipper-grid">
                            {shown.map(source => (
                                <button
                                    key={source.id}
                                    className={`vc-clipper-card${source.id === current ? " vc-clipper-current" : ""}`}
                                    onClick={() => { recorder.useSource(source); onClose(); }}
                                >
                                    <div className="vc-clipper-thumb">
                                        {source.thumbnail && <img src={source.thumbnail} alt="" />}
                                        {source.id === current && <span className="vc-clipper-badge">Current</span>}
                                    </div>
                                    <div className="vc-clipper-name" title={source.name}>{source.name}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="vc-clipper-foot">
                    <span>
                        {settings.store.sourceName
                            ? `Current source: ${settings.store.sourceName}`
                            : "No source picked yet - the primary screen is used."}
                        {refreshedAt > 0 && ` - list refreshed every ${REFRESH_MS / 1000}s`}
                    </span>
                    <button onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
}

function ActionMenu({ recording, onClose, onPreview, onStudio }: {
    recording: boolean;
    onClose(): void;
    onPreview(): void;
    onStudio(): void;
}) {
    // The buffer grows while the menu is open, so the readout ticks with it.
    const [, tick] = useState(0);
    useEffect(() => {
        if (!recording) return;

        const id = setInterval(() => tick(n => n + 1), 500);
        return () => clearInterval(id);
    }, [recording]);

    const item = (label: string, action: () => void, disabled = false) => (
        <button disabled={disabled} onClick={() => { onClose(); setTimeout(action, 0); }}>
            {label}
        </button>
    );

    const buffered = Math.floor(recorder.bufferedSeconds);
    const last = recorder.lastClip;

    // Offered lengths, shortest first, none of them longer than the buffer:
    // asking for more than was recorded is asking for the whole buffer twice.
    const cuts = [15, 30, 60].filter(n => n < settings.store.clipLength);

    return (
        <div className="vc-clipper-menu">
            {item(recording ? "Stop the clip buffer" : "Start the clip buffer", () => void recorder.toggle())}
            {item(`Save the last ${settings.store.clipLength}s`, () => void recorder.save(), !recording)}
            {cuts.map(n => (
                <React.Fragment key={`save-${n}`}>
                    {item(`Save only the last ${n}s`, () => void recorder.save(n), !recording || buffered < n)}
                </React.Fragment>
            ))}
            {item("Watch the buffer before saving", onPreview, !recording || !buffered)}
            {item(
                recorder.markCount ? `Drop a marker (${recorder.markCount} so far)` : "Drop a marker",
                () => recorder.mark(),
                !recording
            )}
            {item("Clip everyone's angle in the call", () => void requestPov(), !recording)}
            {last && (
                <>
                    <div className="vc-clipper-menu-label">{last.name}</div>
                    {item("Send it to this channel", () => void sendClipFitted(last.name))}
                    {item("Post its ending as a GIF", () => void sendClipGif(last.name))}
                    {cuts.map(n => (
                        <React.Fragment key={n}>
                            {item(`Keep only its last ${n}s`, () => void recorder.trimLastSaved(n))}
                        </React.Fragment>
                    ))}
                </>
            )}
            {CLIPS_AVAILABLE && item("Open the clip studio", onStudio)}
            <div className="vc-clipper-menu-status">
                {recording
                    ? `Buffered: ${buffered}s / ${settings.store.clipLength}s - ${formatBytes(recorder.bufferedBytes)}`
                    : "Buffer stopped - nothing to save"}
            </div>
        </div>
    );
}

export function ClipperOverlay() {
    const [state, setState] = useState<RecorderState>(recorder.state);
    const [picker, setPicker] = useState(false);
    const [studio, setStudio] = useState<{ initial?: string; } | null>(null);
    const [menu, setMenu] = useState(false);
    const [preview, setPreview] = useState(false);
    const [replay, setReplay] = useState<SavedClip | null>(null);

    useStyle();

    useEffect(() => recorder.subscribe(setState), []);

    /*
     * A save ends by going back to recording, and by then the clip is written
     * and its blob is still in hand - which is the one moment it can be played
     * back without reading the file again.
     */
    const wasSaving = useRef(false);
    useEffect(() => {
        if (wasSaving.current && state !== "saving") setReplay(recorder.lastClip);
        wasSaving.current = state === "saving";
    }, [state]);
    useEffect(() => {
        setPickerOpener(() => setPicker(true));
        setStudioOpener(() => setStudio({}));

        return () => {
            setPickerOpener(null);
            setStudioOpener(null);
        };
    }, []);
    useEffect(() => {
        if (!menu) return;

        const close = () => setMenu(false);
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, [menu]);

    const { panelButton, sourceName } = settings.use(["panelButton", "sourceName"]);

    const recording = state === "recording" || state === "saving";

    /*
     * The modals stay mounted even with the button turned off: the toolbox and
     * the chat bar button open them too, and they are the only way in once the
     * floating button is hidden.
     */
    return (
        <>
            {panelButton && (
                <div className="vc-clipper-root">
                    {menu && (
                        <ActionMenu
                            recording={recording}
                            onClose={() => setMenu(false)}
                            onPreview={() => setPreview(true)}
                            onStudio={() => setStudio({})}
                        />
                    )}
                    <button
                        className={`vc-clipper-trigger${recording ? " vc-clipper-live" : ""}`}
                        title={recording
                            ? `Clipper - recording ${sourceName || "screen"} (right click: stop / save / studio)`
                            : `Clipper - pick a source${sourceName ? ` (current: ${sourceName})` : ""}`}
                        onClick={e => { e.stopPropagation(); setMenu(false); setPicker(true); }}
                        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu(v => !v); }}
                    >
                        <Icon recording={recording} />
                    </button>
                </div>
            )}

            {replay && (
                <ReplayCard
                    clip={replay}
                    onStudio={name => setStudio({ initial: name })}
                    onRefresh={() => setReplay(recorder.lastClip)}
                    onClose={() => setReplay(null)}
                />
            )}

            {picker && <Picker onClose={() => setPicker(false)} />}
            {preview && <BufferPreview onClose={() => setPreview(false)} />}
            {studio && <ClipStudio initial={studio.initial} onClose={() => setStudio(null)} />}
        </>
    );
}
