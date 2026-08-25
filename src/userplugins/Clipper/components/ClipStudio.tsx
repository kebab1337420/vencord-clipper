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

import { localStorage } from "@utils/localStorage";
import { Toasts, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { addAssets, type Asset, type AssetKind, removeAsset, sortedAssets, touchAsset } from "../assets";
import {
    type AudioClip,
    type AudioSource,
    clipEnd,
    clipLengthOf,
    decodeSource,
    scheduleClips
} from "../audio";
import {
    deleteClip,
    frameName,
    listClips,
    loadAudioFile,
    loadClipUrl,
    loadImageFile,
    loadThumbUrl,
    loadVideoFile,
    pickAudioFiles,
    pickImageFiles,
    pickVideoFiles,
    probeRange,
    renameClip,
    renderName,
    revealClip,
    saveFrame,
    type StoredClip,
    typeOfClip,
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
import { trimClip } from "../repair";
import { sendClip } from "../send";
import { Container, extensionFor, pickMimeType } from "../settings";
import {
    type AvatarCache,
    type Caption,
    cutRange,
    decodeImage,
    DEFAULT_CAPTION_STYLE,
    DEFAULT_EFFECTS,
    DEFAULT_OVERLAY,
    type Effects,
    estimatedSize,
    type Frame,
    type ImageSource,
    keepRange,
    loadAvatars,
    newId,
    type Overlay,
    OVERLAY_SECONDS,
    overlayBox,
    overlaySounds,
    paintFrame,
    type Project,
    projectEnding,
    projectLength,
    renderProject,
    type Segment,
    segmentLength,
    segmentStart,
    type SourceOrigin,
    type StudioSource
} from "../studio";
import { writeThumbnail } from "../thumbnail";
import { formatBytes, formatTime } from "../utils";
import { fromMeta, mutedFraction, voiceDuckAt, voiceGainOf, voiceLevelsTouched,type VoiceTrack } from "../voice";
import { createVoiceBand, type VoiceBand } from "../voiceBand";
import { forgetVoiceMixes, type VoiceMix, voiceMixFor } from "../voiceMix";
import { AudioMixerInput } from "./AudioMixer";
import { AudioTimeline } from "./AudioTimeline";
import { type CutMark, CutRuler } from "./CutRuler";
import { VoiceLanes } from "./VoiceLanes";

export const STUDIO_CSS = `
.vc-clipper-studio {
    width: min(1280px, 96vw);
    height: min(840px, 92vh);
}
.vc-clipper-studio-body {
    display: flex;
    flex: 1;
    min-height: 0;
    background: var(--background-secondary, #2b2d31);
}

/* Discord's own scrollbars, so a panel does not sprout a fat native one. */
.vc-clipper-studio ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}
.vc-clipper-studio ::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 8px;
    background-clip: padding-box;
    background-color: var(--scrollbar-thin-thumb, rgba(30, 31, 34, .7));
}
.vc-clipper-studio ::-webkit-scrollbar-track {
    background: transparent;
}

.vc-clipper-studio-main {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    padding: 12px 14px;
    gap: 10px;
    background: var(--background-primary, #313338);
}
/* ----------------------------------------------------------------- stage -- */
/* The element decodes, the canvas shows. The element is kept in the layout but
   out of sight: a display:none video is throttled by Chromium and stops handing
   out frames, which would freeze the picture the canvas is drawing. */
.vc-clipper-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    overflow: hidden;
    background: #000;
    box-shadow: var(--elevation-low, 0 1px 3px rgba(0, 0, 0, .3));
}
.vc-clipper-stage canvas {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}
.vc-clipper-decoder {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: .01;
    pointer-events: none;
}

.vc-clipper-transport {
    display: flex;
    align-items: center;
    gap: 10px;
}
.vc-clipper-transport button {
    flex: 0 0 auto;
    min-width: 72px;
    padding: 5px 12px;
    border: none;
    border-radius: 6px;
    background: var(--button-secondary-background, #4e5058);
    color: var(--text-normal, #dbdee1);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
}
.vc-clipper-transport button:disabled {
    opacity: .4;
    cursor: default;
}
.vc-clipper-transport input[type="range"] {
    flex: 1;
    min-width: 0;
}

/* ------------------------------------------------------------ sound lane -- */
.vc-clipper-sounds {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.vc-clipper-sounds-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-sound-lane {
    position: relative;
    height: 44px;
    border-radius: 8px;
    background: var(--background-secondary, #2b2d31);
    box-shadow: inset 0 0 0 1px var(--background-modifier-accent, rgba(78, 80, 88, .48));
    overflow: hidden;
    cursor: crosshair;
}
.vc-clipper-sound-block {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: 5px;
    border: 1px solid var(--brand-experiment, #5865f2);
    background: color-mix(in srgb, var(--brand-experiment, #5865f2) 26%, transparent);
    overflow: hidden;
    cursor: grab;
    /* The edges are the trim handles; the middle moves the block. */
    box-sizing: border-box;
}
.vc-clipper-sound-block.vc-clipper-active {
    border-color: var(--text-normal, #dbdee1);
    background: color-mix(in srgb, var(--brand-experiment, #5865f2) 44%, transparent);
}
.vc-clipper-sound-block.vc-clipper-muted {
    opacity: .4;
}
.vc-clipper-sound-wave {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    fill: var(--text-normal, #dbdee1);
    opacity: .75;
    pointer-events: none;
}
.vc-clipper-sound-name {
    position: absolute;
    left: 6px;
    right: 6px;
    bottom: 2px;
    font-size: 10px;
    color: var(--text-normal, #dbdee1);
    text-shadow: 0 1px 2px rgba(0, 0, 0, .9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
}
.vc-clipper-sound-head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text-danger, #f23f43);
    pointer-events: none;
}
.vc-clipper-sound-title {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--text-normal, #dbdee1);
}
.vc-clipper-sound-title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.vc-clipper-sound-title small {
    flex: 0 0 auto;
    color: var(--text-muted, #949ba4);
    font-variant-numeric: tabular-nums;
}
.vc-clipper-voice-item {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding: 8px;
    border-radius: 6px;
    background: var(--background-secondary, #2b2d31);
}
.vc-clipper-voice-face {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    background: var(--background-tertiary, #1e1f22);
}
.vc-clipper-voice-body {
    flex: 1;
    min-width: 0;
}
.vc-clipper-voice-body .vc-clipper-field {
    margin: 0;
}
.vc-clipper-voice-item button {
    flex: 0 0 auto;
    width: auto;
    margin: 0;
    padding: 4px 10px;
}

.vc-clipper-side {
    width: 312px;
    flex: 0 0 auto;
    overflow-y: auto;
    padding: 12px;
    background: var(--background-secondary, #2b2d31);
}
.vc-clipper-side.vc-clipper-side-left {
    width: 268px;
}
.vc-clipper-side h4 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .02em;
    color: var(--header-secondary, #b5bac1);
}

/* ---------------------------------------------------------- clip library -- */
.vc-clipper-side-clip {
    display: block;
    width: 100%;
    margin-bottom: 4px;
    padding: 7px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    color: var(--text-normal, #dbdee1);
    text-align: left;
    font-size: 13px;
    cursor: pointer;
    transition: background-color .12s ease, border-color .12s ease;
}
.vc-clipper-side-clip:hover:not(:disabled) {
    background: var(--background-modifier-hover, rgba(78, 80, 88, .3));
}
.vc-clipper-side-clip.vc-clipper-active {
    border-color: var(--brand-experiment, #5865f2);
    background: var(--background-modifier-selected, #43444b);
}
.vc-clipper-side-clip:disabled {
    opacity: .5;
    cursor: default;
}
.vc-clipper-side-clip .vc-clipper-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
}
.vc-clipper-side-clip .vc-clipper-meta {
    margin-top: 2px;
    font-size: 11px;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-clip-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.vc-clipper-clip-text {
    min-width: 0;
    flex: 1;
}
.vc-clipper-thumb {
    width: 64px;
    height: 36px;
    flex: 0 0 auto;
    border-radius: 4px;
    object-fit: cover;
    background: var(--background-tertiary, #1e1f22);
}
.vc-clipper-thumb-empty {
    border: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
}

/* ------------------------------------------------------------------ tabs -- */
.vc-clipper-shelf {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 8px;
    background: var(--background-secondary-alt, #232428);
}

.vc-clipper-shelf-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

/*
 * A chip, not a row: a shelf is browsed by name at a glance, and twenty file
 * names down a single column is a scrollbar nobody reads.
 */
.vc-clipper-shelf-item {
    display: flex;
    align-items: stretch;
    max-width: 100%;
    border-radius: 6px;
    overflow: hidden;
    background: var(--background-tertiary, #1e1f22);
}

.vc-clipper-shelf-place {
    max-width: 150px;
    padding: 5px 8px;
    border: none;
    background: transparent;
    color: var(--text-normal, #dbdee1);
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
}

.vc-clipper-shelf-place:hover:not(:disabled) {
    background: var(--background-modifier-hover, #35373c);
    color: var(--interactive-active, #fff);
}

.vc-clipper-shelf-forget {
    padding: 0 7px;
    border: none;
    border-left: 1px solid var(--background-secondary, #2b2d31);
    background: transparent;
    color: var(--text-muted, #949ba4);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
}

.vc-clipper-shelf-forget:hover:not(:disabled) {
    background: var(--status-danger, #da373c);
    color: #fff;
}

.vc-clipper-shelf-place:disabled,
.vc-clipper-shelf-forget:disabled {
    opacity: 0.5;
    cursor: default;
}

/* A picture on the frame is draggable, so the pointer has to say so. */
.vc-clipper-stage-live {
    cursor: grab;
}

.vc-clipper-stage-live:active {
    cursor: grabbing;
}

.vc-clipper-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 12px;
    padding: 3px;
    border-radius: 8px;
    background: var(--background-tertiary, #1e1f22);
}
.vc-clipper-tabs button {
    flex: 1 1 0;
    padding: 6px 4px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--interactive-normal, #b5bac1);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color .12s ease, color .12s ease;
}
.vc-clipper-tabs button:hover:not(.vc-clipper-active) {
    color: var(--interactive-hover, #dbdee1);
    background: var(--background-modifier-hover, rgba(78, 80, 88, .3));
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

/* -------------------------------------------------------------- timeline -- */
.vc-clipper-timeline {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 6px;
    min-height: 74px;
    border-radius: 8px;
    background: var(--background-secondary, #2b2d31);
    box-shadow: inset 0 0 0 1px var(--background-modifier-accent, rgba(78, 80, 88, .48));
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
    transition: border-color .12s ease, transform .12s ease;
}
.vc-clipper-block:hover:not(:disabled) {
    transform: translateY(-1px);
}
.vc-clipper-block.vc-clipper-active {
    border-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-block .vc-clipper-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
}
.vc-clipper-block small {
    display: block;
    color: var(--text-muted, #949ba4);
}

/* ------------------------------------------------------------- cut ruler -- */
.vc-clipper-ruler-wrap {
    padding: 6px;
    border-radius: 8px;
    background: var(--background-secondary, #2b2d31);
    box-shadow: inset 0 0 0 1px var(--background-modifier-accent, rgba(78, 80, 88, .48));
}
.vc-clipper-ruler {
    position: relative;
    height: 26px;
    border-radius: 5px;
    background: var(--background-tertiary, #1e1f22);
    cursor: crosshair;
    overflow: hidden;
    user-select: none;
}
.vc-clipper-ruler-block {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: 3px;
    background: var(--background-modifier-accent, rgba(78, 80, 88, .6));
    box-shadow: inset 0 0 0 1px var(--background-tertiary, #1e1f22);
}
.vc-clipper-ruler-block.vc-clipper-active {
    background: var(--brand-experiment, #5865f2);
}
/* Over the blocks rather than between them: what is being marked is a stretch
   of the montage, not a list of the segments under it. */
.vc-clipper-ruler-mark {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(218, 55, 60, .34);
    box-shadow: inset 0 0 0 1px var(--button-danger-background, #da373c);
    pointer-events: none;
}
.vc-clipper-ruler-grip {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    background: var(--button-danger-background, #da373c);
}
.vc-clipper-ruler-grip-end {
    left: auto;
    right: 0;
}
.vc-clipper-ruler-head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text-normal, #dbdee1);
    pointer-events: none;
}
.vc-clipper-ruler-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}
.vc-clipper-ruler-actions span {
    flex: 1;
    min-width: 180px;
    color: var(--text-muted, #949ba4);
    font-size: 11px;
}
.vc-clipper-ruler-actions button {
    padding: 4px 9px;
    border: none;
    border-radius: 4px;
    background: var(--button-secondary-background, #4e5058);
    color: var(--text-normal, #dbdee1);
    font-size: 12px;
    cursor: pointer;
}
.vc-clipper-ruler-actions button:disabled {
    opacity: .5;
    cursor: default;
}
.vc-clipper-ruler-actions button.vc-clipper-danger {
    background: var(--button-danger-background, #da373c);
    color: #fff;
}

/* ---------------------------------------------------------- voice lanes -- */
.vc-clipper-lanes {
    padding: 8px 10px 10px;
    border-radius: 8px;
    background: var(--background-secondary, #2b2d31);
    box-shadow: inset 0 0 0 1px var(--background-modifier-accent, rgba(78, 80, 88, .48));
}
.vc-clipper-lanes-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .02em;
    color: var(--header-secondary, #b5bac1);
}
.vc-clipper-lanes-head span:last-child {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-lane {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 3px;
}
.vc-clipper-lane-name {
    width: 108px;
    flex: 0 0 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--text-normal, #dbdee1);
}
.vc-clipper-lane-track {
    position: relative;
    flex: 1;
    height: 22px;
    min-width: 0;
    border-radius: 4px;
    background: var(--background-tertiary, #1e1f22);
    cursor: pointer;
    overflow: hidden;
}
.vc-clipper-lane-track svg {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    fill: var(--green-360, #23a55a);
}
.vc-clipper-lane-kept {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--brand-experiment, #5865f2);
    opacity: .16;
}
.vc-clipper-lane-head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text-normal, #dbdee1);
    pointer-events: none;
}

/* ----------------------------------------------------------- side panels -- */
.vc-clipper-field {
    margin-bottom: 12px;
    font-size: 13px;
}
.vc-clipper-field label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    color: var(--header-secondary, #b5bac1);
    font-size: 12px;
    font-weight: 500;
}
.vc-clipper-field small {
    display: block;
    margin-top: 3px;
    color: var(--text-muted, #949ba4);
    font-size: 11px;
}
.vc-clipper-field input[type="range"] {
    width: 100%;
    accent-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-field input[type="checkbox"] {
    accent-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-field input[type="number"],
.vc-clipper-field input[type="text"],
.vc-clipper-field textarea,
.vc-clipper-field select {
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
    border-radius: 6px;
    background: var(--input-background, #1e1f22);
    color: var(--text-normal, #dbdee1);
    font-size: 13px;
    box-sizing: border-box;
    outline: none;
    transition: border-color .12s ease;
}
.vc-clipper-field input[type="number"]:focus,
.vc-clipper-field input[type="text"]:focus,
.vc-clipper-field textarea:focus,
.vc-clipper-field select:focus {
    border-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-field textarea {
    min-height: 58px;
    resize: vertical;
}
.vc-clipper-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.vc-clipper-markers button {
    padding: 2px 8px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
}
.vc-clipper-caption-item {
    margin-bottom: 8px;
    padding: 10px;
    border-radius: 8px;
    background: var(--background-tertiary, #1e1f22);
}
.vc-clipper-side-manage {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
}
.vc-clipper-side-manage h4 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: none;
    font-size: 13px;
    color: var(--header-primary, #f2f3f5);
}
.vc-clipper-side-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
}

/* ---------------------------------------------------------------- footer -- */
.vc-clipper-studio-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 10px;
    border-top: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .48));
}
.vc-clipper-progress {
    flex: 1 1 120px;
    height: 6px;
    min-width: 80px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--background-tertiary, #1e1f22);
}
.vc-clipper-progress div {
    height: 100%;
    background: var(--brand-experiment, #5865f2);
    transition: width .2s ease;
}

/* --------------------------------------------------------------- buttons -- */
.vc-clipper-side-actions button,
.vc-clipper-row button,
.vc-clipper-studio-foot button {
    height: 32px;
    padding: 0 12px;
    border: none;
    border-radius: 6px;
    background: var(--button-secondary-background, #4e5058);
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color .12s ease, opacity .12s ease;
}
.vc-clipper-side-actions button:hover:not(:disabled),
.vc-clipper-row button:hover:not(:disabled),
.vc-clipper-studio-foot button:hover:not(:disabled) {
    background: var(--button-secondary-background-hover, #6d6f78);
}
.vc-clipper-side-actions button:focus-visible,
.vc-clipper-row button:focus-visible,
.vc-clipper-studio-foot button:focus-visible,
.vc-clipper-side-clip:focus-visible,
.vc-clipper-block:focus-visible {
    outline: 2px solid var(--brand-experiment, #5865f2);
    outline-offset: 2px;
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
.vc-clipper-side-actions button.vc-clipper-primary:hover:not(:disabled),
.vc-clipper-studio-foot button.vc-clipper-primary:hover:not(:disabled) {
    background: var(--brand-experiment-560, #4752c4);
}
.vc-clipper-side-actions button.vc-clipper-danger,
.vc-clipper-row button.vc-clipper-danger,
.vc-clipper-studio-foot button.vc-clipper-danger {
    background: var(--button-danger-background, #da373c);
}
.vc-clipper-side-actions button.vc-clipper-danger:hover:not(:disabled),
.vc-clipper-row button.vc-clipper-danger:hover:not(:disabled),
.vc-clipper-studio-foot button.vc-clipper-danger:hover:not(:disabled) {
    background: var(--button-danger-background-hover, #a12828);
}
`;

function toast(message: string, type: string) {
    Toasts.show({ id: Toasts.genId(), message, type });
}

/** Reads a video's real range without showing it, for a source being added. */
async function probeFile(url: string): Promise<{ start: number; end: number; width: number; height: number; }> {
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
        return {
            ...await probeRange(video),
            width: video.videoWidth,
            height: video.videoHeight
        };
    } finally {
        // Not src = "": an empty src is resolved against the page, so Chromium
        // goes and fetches the app itself before deciding it is not a video.
        video.pause();
        video.removeAttribute("src");
        video.load();
    }
}

const OUTPUT_HEIGHTS = [1440, 1080, 720, 480];

const STORAGE_KEY = "vc-clipper-studio-project";

/**
 * Where the timeline is kept between two openings.
 *
 * Discord deletes `window.localStorage` off its own renderer, so reaching for
 * it here answers `ReferenceError: localStorage is not defined` and the studio
 * silently forgets every project. Vencord keeps the reference it took before
 * that happened, which is what the import above is. On a client that has none,
 * the project lives as long as the client does rather than not at all.
 */
const store: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage ?? (() => {
    const held = new Map<string, string>();

    return {
        getItem: (key: string) => held.get(key) ?? null,
        setItem: (key: string, value: string) => void held.set(key, value),
        removeItem: (key: string) => void held.delete(key)
    };
})();

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
    /** Sounds are restored from disk by path; the samples are not stored. */
    sounds?: { id: string; name: string; path: string; }[];
    /** Pictures, the same way: by path, never as bytes. */
    images?: { id: string; name: string; path: string; }[];
}

function readSaved(): SavedProject | null {
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as SavedProject;
        if (!parsed?.project?.segments?.length || !Array.isArray(parsed.sources)) return null;

        // A document written by an older version is missing whatever was added
        // since, so every field falls back to its default rather than to
        // undefined, which would reach the canvas as NaN.
        return {
            sources: parsed.sources,
            sounds: Array.isArray(parsed.sounds) ? parsed.sounds.filter(s => s?.path) : [],
            images: Array.isArray(parsed.images) ? parsed.images.filter(i => i?.path) : [],
            project: {
                ...parsed.project,
                segments: parsed.project.segments.map(s => ({ ...s, effects: { ...DEFAULT_EFFECTS, ...s.effects } })),
                audioClips: parsed.project.audioClips ?? [],
                // Filled in rather than trusted: a project saved before overlays
                // could carry sound has no volume on them at all.
                overlays: (parsed.project.overlays ?? []).map(o => ({ ...DEFAULT_OVERLAY, ...o })),
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
        if (!value) store.removeItem(STORAGE_KEY);
        else store.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (e) {
        logger.warn("Could not save the studio project", e);
    }
}

/**
 * The saved sounds and pictures, one click from the timeline.
 *
 * Kept out of the studio body because it is the same list twice with a
 * different `kind`, and because it holds no state of its own: the shelf lives
 * in the settings, and everything here is a call back into the studio.
 */
function Shelf({ kind, items, busy, onPlace, onForget }: {
    kind: AssetKind;
    items: Asset[];
    busy: boolean;
    onPlace(asset: Asset): void;
    onForget(id: string): void;
}) {
    const mine = items.filter(a => a.kind === kind);
    if (!mine.length) return null;

    return (
        <div className="vc-clipper-shelf">
            <div className="vc-clipper-sound-title">
                <span>{kind === "sound" ? "Your sounds" : "Your pictures and clips"}</span>
                <small>click to place at the playhead</small>
            </div>

            <div className="vc-clipper-shelf-list">
                {mine.map(asset => (
                    <div key={asset.id} className="vc-clipper-shelf-item">
                        <button
                            className="vc-clipper-shelf-place"
                            disabled={busy}
                            title={asset.path}
                            onClick={() => onPlace(asset)}
                        >
                            {asset.name}
                        </button>
                        <button
                            className="vc-clipper-shelf-forget"
                            disabled={busy}
                            title="Take it off the shelf. The file itself is left alone."
                            onClick={() => onForget(asset.id)}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ClipStudio({ onClose, initial }: { onClose(): void; initial?: string; }) {
    const [clips, setClips] = useState<StoredClip[] | null>(null);
    const [sources, setSources] = useState<StudioSource[]>([]);
    const [project, setProject] = useState<Project>({
        segments: [],
        captions: [],
        overlays: [],
        captionStyle: { ...DEFAULT_CAPTION_STYLE },
        height: 1080,
        fps: 30,
        audio: true,
        showSpeakers: true
    });

    /*
     * Sounds laid over the montage, decoded.
     *
     * Kept out of `project` on purpose: the project is what gets written to
     * local storage on every keystroke, and an `AudioBuffer` neither survives
     * `JSON.stringify` nor belongs anywhere near it. The project holds only the
     * placements, which refer to these by id.
     */
    const [sounds, setSounds] = useState<AudioSource[]>([]);
    const [pickedSound, setPickedSound] = useState("");

    /** Decoded pictures, kept out of the project for the same reason. */
    const [images, setImages] = useState<ImageSource[]>([]);
    const [pickedOverlay, setPickedOverlay] = useState("");

    /*
     * The shelf of reusable sounds and pictures.
     *
     * Read into state rather than off the settings on every render: the list is
     * parsed and validated on each read, and this component re-renders on every
     * frame the preview plays.
     */
    const [shelf, setShelf] = useState<Asset[]>([]);

    const [selected, setSelected] = useState("");

    /*
     * The range marked on the cut ruler, in project time.
     *
     * Null while nothing is marked, which is also what a cut leaves behind: the
     * range has been spent by then, and keeping it on screen over the seam it
     * just closed would only invite the same cut a second time.
     */
    const [mark, setMark] = useState<CutMark | null>(null);
    const [tab, setTab] = useState<"segment" | "captions" | "audio" | "images" | "output">("segment");
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
    const [thumbs, setThumbs] = useState<Record<string, string>>({});

    /*
     * Where the playhead is, and how long the file under it runs.
     *
     * Read off the element rather than tracked from the seeks this component
     * makes: the video has its own controls, and the voice lanes have to follow
     * the user dragging those just as much as a click on a marker.
     */
    const [playhead, setPlayhead] = useState({ at: 0, length: 0 });
    const [playing, setPlaying] = useState(false);
    const [tagging, setTagging] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(false);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sourcesRef = useRef<StudioSource[]>([]);

    /*
     * One audio context for the whole modal.
     *
     * Chromium caps how many a page may hold open, and this one is used for
     * everything: decoding a dropped file, and playing the sound lane back while
     * the preview runs. Opened on first use, closed on unmount.
     */
    const audioCtxRef = useRef<AudioContext | null>(null);

    /*
     * A seek that has to wait for a segment to be selected.
     *
     * Clicking a point on the sound lane may land in a segment other than the
     * one on screen, and selecting it swaps the element's source; the position
     * inside it is only reachable once that has happened.
     */
    const pendingSeekRef = useRef<{ id: string; at: number; } | null>(null);
    const stopSoundsRef = useRef<(() => void) | null>(null);

    /*
     * Speaker avatars, decoded once per clip.
     *
     * A ref rather than state: the preview reads it inside its paint loop, and
     * a state write per decoded image would re-render the whole modal for
     * something no React output depends on.
     */
    const avatarsRef = useRef<AvatarCache>(new Map());

    /*
     * Every object URL this modal has opened.
     *
     * Revoking from the source list only frees what made it onto the timeline,
     * which leaves behind everything that failed on the way there - a file that
     * would not decode, a restore interrupted by a close, an import that threw
     * halfway down its list. A clip is tens of megabytes and the URL pins it
     * until the page is reloaded, so the ledger is what gets revoked.
     */
    const urlsRef = useRef(new Set<string>());

    /** True until the modal unmounts, so async work can stop touching state. */
    const aliveRef = useRef(true);
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
        setMark(null);
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

    const segmentIndex = project.segments.findIndex(s => s.id === selected);
    const soundsById = useMemo(() => new Map(sounds.map(s => [s.id, s])), [sounds]);
    const audioClips = project.audioClips ?? [];
    const overlays = project.overlays ?? [];

    /*
     * Size of the preview surface.
     *
     * The output's own shape, scaled down: a montage rendered for a portrait
     * source has to be previewed in portrait or the letterboxing the render adds
     * is invisible until the file exists.
     */
    const previewHeight = 540;
    const previewWidth = Math.round(previewHeight * ((project.width || project.height * 16 / 9) / Math.max(1, project.height)) / 2) * 2;

    /** Playhead in project time, for the lane and the caption placement. */
    const projectAt = segment && segmentIndex >= 0
        ? segmentStart(project, segmentIndex) + Math.max(0, playhead.at - segment.from) / Math.max(0.25, segment.speed)
        : 0;

    /**
     * Where the playhead is in project time.
     *
     * The element only knows where it is inside its own file, and everything the
     * user places - a caption, a sound, a picture - is placed against the
     * montage. Read off the element rather than off state so it is right in the
     * middle of a drag.
     */
    const projectTime = (): number => {
        const video = videoRef.current;
        if (!video || !segment || segmentIndex < 0) return 0;

        return segmentStart(project, segmentIndex) + Math.max(0, video.currentTime - segment.from) / Math.max(0.25, segment.speed);
    };

    /*
     * The voice tracks of the clip under the playhead.
     *
     * Decoded once per clip rather than per render: a busy call is ten lanes of
     * a few thousand samples, and this component re-renders on every frame the
     * video plays.
     */
    const lanes: VoiceTrack[] = useMemo(
        () => (source ? meta[source.name]?.voices ?? [] : []).map(fromMeta),
        [source?.name, meta]
    );

    /**
     * The per-person recordings saved beside the clip being previewed.
     *
     * Identity matters here: this goes into an effect's dependencies, and a new
     * array on every commit would rebuild the mix on every keystroke.
     */
    const laneFiles = useMemo(
        () => (source ? meta[source.name]?.tracks ?? [] : []),
        [source?.name, meta]
    );

    // Read by the preview's paint loop, which must not be re-armed on every
    // clip switch just to see the new tracks.
    const lanesRef = useRef<VoiceTrack[]>([]);
    lanesRef.current = lanes;

    /*
     * The clip's sound with every person's level applied to their own voice.
     *
     * A mute cannot be done by turning the mix down - two people talking at once
     * are the same samples - so muting somebody used to take whoever was talking
     * across them with it. `voiceMixFor` rebuilds the soundtrack instead,
     * leaning on the recorded activity to tell the voices apart, and what comes
     * back is played in place of the element's own audio.
     *
     * Null whenever there is nothing to do: nobody muted, one person in the
     * call, or a recording nothing could be learned from. The duck then carries
     * the levels exactly as it always did.
     */
    const [voiceMix, setVoiceMix] = useState<VoiceMix | null>(null);
    /** 0..1 while a separation runs, -1 when none is. */
    const [separating, setSeparating] = useState(-1);

    const voiceMixRef = useRef<VoiceMix | null>(null);
    voiceMixRef.current = voiceMix && source && voiceMix.sourceId === source.id ? voiceMix : null;

    const voiceNodesRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode; band: VoiceBand; } | null>(null);

    /**
     * The preview's own speech notch, opened only if a level is ever moved.
     *
     * `createMediaElementSource` is a one-way door - it takes the element's
     * sound out of the page and into the graph for the life of the context, and
     * it may only be called once per element - so it is not opened for a clip
     * nobody touches. Until then the preview plays the way it always has,
     * straight out of the element on its own volume.
     */
    /**
     * The preview's notch, and the element it belongs to.
     *
     * The element is not decoration. `createMediaElementSource` binds a source
     * node to one element for good, and the preview does not keep one element:
     * it gets a new `<video>` whenever the montage moves to a clip from another
     * file. The routing was cached without recording who it was for, so after
     * that swap the notch was still there, still being driven, still reporting
     * a mute - attached to an element nobody was listening to, while the new
     * one played straight out of the page at full volume. A mute that does
     * nothing at all, which is exactly what it looked like.
     */
    /** Whether the notch was open on the previous frame, for the log line. */
    const duckWasOpenRef = useRef(false);

    const previewBandRef = useRef<{ el: HTMLMediaElement; source: MediaElementAudioSourceNode; band: VoiceBand; } | null>(null);

    /*
     * Identity, not contents, is what an effect compares, and every commit
     * builds a new levels object even when the numbers are identical. Comparing
     * the numbers is what keeps a caption edit from throwing away a separation
     * that is still perfectly valid.
     */
    const levelsSignature = JSON.stringify(project.voiceLevels ?? {});

    useEffect(() => {
        /*
         * Null until somebody is actually turned down.
         *
         * `voiceMixFor` answers on the spot for a clip with every level left
         * alone: its own soundtrack is the call as it was heard, and the
         * preview plays it straight out of the element the way it always has.
         * The rebuild is only worth its seconds where a voice has to be left
         * out of the sum.
         */
        if (!source) {
            setVoiceMix(null);
            return;
        }

        let alive = true;

        /*
         * Waited out rather than run on the spot: a slider being dragged fires
         * this on every pixel, and each run is seconds of arithmetic. The pause
         * is short enough that letting go of the handle feels like the start of
         * the work rather than a delay before it.
         */
        const timer = setTimeout(() => {
            setSeparating(0);

            voiceMixFor(
                { id: source.id, url: source.url, voices: lanes, tracks: laneFiles },
                projectRef.current.voiceLevels,
                audioContext(),
                done => { if (alive) setSeparating(done); }
            ).then(mix => {
                if (!alive) return;

                setVoiceMix(mix);
                setSeparating(-1);
            }).catch(() => {
                if (alive) setSeparating(-1);
            });
        }, 400);

        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [source?.id, source?.url, lanes, laneFiles, levelsSignature]);

    /**
     * Who is being pulled out of the mix rather than ducked.
     *
     * The two are worth telling apart in the panel: one costs nothing to
     * everybody else and the other costs them the moments they were talking.
     */
    const separated = useMemo(() => new Set(voiceMix?.modelled ?? []), [voiceMix]);

    /** The decoded pictures, by id, for the paint loop and the drag below. */
    const imagesRef = useRef<Map<string, ImageSource>>(new Map());
    const imagesById = useMemo(() => new Map(images.map(i => [i.id, i])), [images]);
    imagesRef.current = imagesById;

    /*
     * The timeline sources, each carrying the voice tracks of its own file.
     *
     * The renderer needs them per source and not per clip name: a montage cut
     * out of three calls has three sets of people, and the badge drawn over a
     * segment has to be the one recorded in the file that segment came from.
     */
    const voicedSources: StudioSource[] = useMemo(
        () => sources.map(item => {
            const voices = meta[item.name]?.voices;
            const tracks = meta[item.name]?.tracks;

            if (!voices?.length && !tracks?.length) return item;

            return {
                ...item,
                ...(voices?.length ? { voices: voices.map(fromMeta) } : {}),
                ...(tracks?.length ? { tracks } : {})
            };
        }),
        [sources, meta]
    );

    /** Everyone recorded anywhere on the timeline, for the level sliders. */
    const people: VoiceTrack[] = useMemo(() => {
        const seen = new Map<string, VoiceTrack>();

        for (const item of voicedSources) {
            for (const track of item.voices ?? []) {
                if (!seen.has(track.id)) seen.set(track.id, track);
            }
        }

        return [...seen.values()];
    }, [voicedSources]);

    // One lookup table rather than a scan per timeline block; a long montage
    // redraws this list on every slider move.
    const byId = new Map(sources.map(s => [s.id, s]));

    /** Source name per segment id, for the blocks on the cut ruler. */
    const rulerNames = new Map(project.segments.map(s => [s.id, byId.get(s.sourceId)?.name ?? "?"]));

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

    /**
     * Notes an object URL so it is released whatever happens next, or releases
     * it now when there is no ledger left to note it on.
     *
     * A restore walks a file at a time and the studio can be closed halfway
     * through: the unmount sweep has already run by then, so a URL added to the
     * ledger afterwards would never be released at all.
     */
    const track = <T extends { url: string; }>(opened: T): T => {
        if (aliveRef.current) urlsRef.current.add(opened.url);
        else URL.revokeObjectURL(opened.url);

        return opened;
    };

    const drop = (url: string) => {
        urlsRef.current.delete(url);
        URL.revokeObjectURL(url);
    };

    /**
     * Fetches the bytes of a source again, from the clip folder or from disk.
     *
     * Every object URL the studio holds is opened here, which is what makes the
     * ledger complete.
     */
    const openSource = async (origin: SourceOrigin): Promise<{ name: string; url: string; }> => {
        if (origin.kind === "clip") return track({ name: origin.name, url: await loadClipUrl(origin.name) });

        return track(await loadVideoFile(origin.path));
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

        // Closed while the sources were being fetched: the state below belongs
        // to a modal that is gone, and its URLs are the unmount's to release.
        if (!aliveRef.current) return;

        if (!segments.length) {
            loaded.forEach(s => drop(s.url));
            writeSaved(null);
            setNote("");
            return;
        }

        /*
         * Sounds come back after the sources, from their own files.
         *
         * A file that has moved or been deleted since takes its placements with
         * it: a clip pointing at a source that is not there renders as silence,
         * which looks like a bug rather than like a missing file.
         */
        const decoded: AudioSource[] = [];
        for (const entry of saved.sounds ?? []) {
            try {
                const { name, url, data } = track(await loadAudioFile(entry.path));
                decoded.push(await decodeSource(audioContext(), entry.id, name || entry.name, data, url, entry.path));
            } catch (e) {
                logger.warn("Could not restore a timeline sound", e);
            }
        }

        // Pictures, on the same terms as the sounds above.
        const pictures: ImageSource[] = [];
        for (const entry of saved.images ?? []) {
            try {
                const { name, url } = track(await loadImageFile(entry.path));
                pictures.push(await decodeImage(entry.id, name || entry.name, url, audioContext(), entry.path));
            } catch (e) {
                logger.warn("Could not restore a timeline picture", e);
            }
        }

        if (!aliveRef.current) return;

        const heard = new Set(decoded.map(s => s.id));
        const audioClips = (saved.project.audioClips ?? []).filter(c => heard.has(c.sourceId));

        const seen = new Set(pictures.map(i => i.id));
        const overlays = (saved.project.overlays ?? []).filter(o => seen.has(o.sourceId));

        setSources(loaded);
        setSounds(decoded);
        setImages(pictures);
        setProject({ ...saved.project, segments, audioClips, overlays });
        setSelected(segments[0].id);
        setNote("");

        if (segments.length !== saved.project.segments.length) {
            setError("Some files of the saved timeline are gone; their segments were dropped.");
        }
    };

    useEffect(() => {
        // Set rather than assumed: a ref survives a remount of the same element,
        // and a modal that came back must not think it is already gone.
        aliveRef.current = true;

        void refreshClips();
        setShelf(sortedAssets("sound").concat(sortedAssets("image")));

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
        return () => {
            aliveRef.current = false;
            urlsRef.current.forEach(url => URL.revokeObjectURL(url));
            urlsRef.current.clear();

            // A context left open keeps an audio device claimed for as long as
            // the client runs, and anything still scheduled on it keeps playing.
            stopSoundsRef.current?.();
            stopSoundsRef.current = null;

            // Tens of megabytes of spectra per clip: worth keeping while the
            // studio is open so a slider is instant, not worth keeping after.
            forgetVoiceMixes();

            previewBandRef.current?.band.disconnect();
            previewBandRef.current?.source.disconnect();
            previewBandRef.current = null;

            void audioCtxRef.current?.close().catch(() => void 0);
            audioCtxRef.current = null;
        };
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const follow = () => setPlayhead({ at: video.currentTime || 0, length: Number.isFinite(video.duration) ? video.duration : 0 });
        const running = () => setPlaying(!video.paused && !video.ended);

        video.addEventListener("timeupdate", follow);
        video.addEventListener("seeked", follow);
        video.addEventListener("loadedmetadata", follow);
        video.addEventListener("play", running);
        video.addEventListener("pause", running);
        video.addEventListener("ended", running);

        return () => {
            video.removeEventListener("timeupdate", follow);
            video.removeEventListener("seeked", follow);
            video.removeEventListener("loadedmetadata", follow);
            video.removeEventListener("play", running);
            video.removeEventListener("pause", running);
            video.removeEventListener("ended", running);
        };
    }, []);

    /*
     * Pictures for the clips in the folder.
     *
     * Loaded once each and kept for as long as the modal is open: the list is
     * filtered and re-rendered constantly, and reading a JPEG back over IPC per
     * keystroke of the search box would be absurd. Only clips that actually have
     * a sidecar are read, so an old folder costs nothing.
     */
    useEffect(() => {
        if (!clips?.length) return;

        void (async () => {
            for (const clip of clips) {
                if (!clip.thumb || thumbs[clip.name]) continue;

                const url = await loadThumbUrl(clip);
                if (!url) continue;

                // The modal may have closed during the read, in which case this
                // URL has already missed the unmount's sweep.
                if (!aliveRef.current) {
                    URL.revokeObjectURL(url);
                    return;
                }

                // Checked again inside the setter: two listings in flight would
                // otherwise both read the same sidecar and one URL would be
                // stranded until the modal closes.
                setThumbs(current => {
                    if (current[clip.name]) {
                        URL.revokeObjectURL(url);
                        return current;
                    }

                    urlsRef.current.add(url);
                    return { ...current, [clip.name]: url };
                });
            }
        })();
    }, [clips]);

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
            else {
                writeSaved({
                    project,
                    sources: sources.map(({ id, name, origin }) => ({ id, name, origin })),
                    // Only a sound that came off disk can be found again; one
                    // whose file has no path would come back as a silent gap.
                    sounds: sounds.filter(s => s.path).map(({ id, name, path }) => ({ id, name, path: path! })),
                    images: images.filter(i => i.path).map(({ id, name, path }) => ({ id, name, path: path! }))
                });
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [project, sources, sounds, images, rendering]);

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
            drop(url);
            throw new Error(`"${name}" has nothing to play - this client may not decode it (MKV and some MOV files need remuxing to MP4 first)`);
        }

        const source: StudioSource = {
            id: newId(),
            name,
            url,
            origin,
            ...(range.height ? { width: range.width, height: range.height } : {})
        };
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
            const opened = await openSource({ kind: "clip", name });
            await addSource(name, opened.url, { kind: "clip", name });
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
                const { name, url } = await openSource({ kind: "file", path });
                await addSource(name, url, { kind: "file", path });
            }
        } catch (e) {
            logger.warn("Could not import a video", e);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setNote("");
        }
    };

    /** The modal's audio context, opened the first time a sound needs one. */
    const audioContext = (): AudioContext => {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();

        // A context created while the page had no gesture behind it starts
        // suspended, and a suspended context schedules silence.
        void audioCtxRef.current.resume().catch(() => void 0);

        return audioCtxRef.current;
    };

    /**
     * The notch the preview's per-person levels ride, built on first use.
     *
     * Null when the element could not be routed, which leaves the caller to
     * fall back to the element's own volume - a whole-clip duck, the way it
     * behaved before there was a notch, rather than no duck at all.
     */
    const previewBand = (video: HTMLVideoElement): VoiceBand | null => {
        // Called on every frame the notch is open, so the context gets a nudge
        // on every one of them: a page that loses audio focus suspends it, and
        // a suspended context is silence rather than a duck.
        const ctx = audioContext();

        const held = previewBandRef.current;
        if (held?.el === video) return held.band;

        /*
         * A different element, so the old routing is finished: it can never be
         * moved across, and leaving it connected keeps a silent element's node
         * summing into the destination.
         */
        if (held) {
            try {
                held.band.disconnect();
                held.source.disconnect();
            } catch (e) {
                logger.warn("Could not drop the previous preview routing", e);
            }

            previewBandRef.current = null;
        }

        /*
         * Not until the context is actually running.
         *
         * `createMediaElementSource` takes the element's sound out of the page
         * for good - there is no putting it back, and no second call on the
         * same element - so handing it to a context that turns out to be
         * suspended trades a preview that ducks badly for one that is silent.
         * `audioContext()` has already asked it to resume; this frame goes
         * without the notch and the next one has it.
         */
        if (ctx.state !== "running") return null;

        try {
            const source = ctx.createMediaElementSource(video);
            const band = createVoiceBand(ctx);

            source.connect(band.input);
            band.output.connect(ctx.destination);

            previewBandRef.current = { el: video, source, band };
            return band;
        } catch (e) {
            logger.warn("Could not route the preview through the speech notch", e);
            return null;
        }
    };

    /**
     * Adds sounds to the lane, each one landing at the playhead.
     *
     * At the playhead rather than at zero: a sting is placed against something
     * that happens in the montage, and the playhead is where the user was
     * already looking.
     */
    /**
     * Decodes a sound off disk and lays it on the timeline.
     *
     * Split out of the picker so the shelf can use it too: placing a saved
     * sound effect and importing a new one differ only in where the path came
     * from, and two copies of this would drift the moment one of them gained a
     * default.
     */
    const placeSound = async (path: string, at: number) => {
        const { name, url, data } = track(await loadAudioFile(path));

        const source = await decodeSource(audioContext(), newId(), name, data, url, path);
        if (!aliveRef.current) return;

        const clip: AudioClip = {
            id: newId(),
            sourceId: source.id,
            at,
            from: 0,
            to: source.duration,
            gain: 1,
            fadeIn: 0,
            fadeOut: 0,
            muted: false
        };

        setSounds(list => [...list, source]);
        commit(p => ({ ...p, audioClips: [...(p.audioClips ?? []), clip] }));
        setPickedSound(clip.id);
    };

    /**
     * Decodes a picture off disk and lays it over the timeline.
     *
     * It lands centred, at a third of the frame's width, for three seconds
     * from the playhead. Something visible and obviously draggable beats
     * something correct and invisible: a picture placed at its own pixel size
     * would be either a speck or wider than the frame depending on the file.
     */
    const placeImage = async (path: string, at: number) => {
        const { name, url } = track(await loadImageFile(path));

        const source = await decodeImage(newId(), name, url, audioContext(), path);
        if (!aliveRef.current) return;

        const overlay: Overlay = {
            id: newId(),
            sourceId: source.id,
            from: at,
            to: at + OVERLAY_SECONDS,
            ...DEFAULT_OVERLAY
        };

        setImages(list => [...list, source]);
        commit(p => ({ ...p, overlays: [...(p.overlays ?? []), overlay] }));
        setPickedOverlay(overlay.id);
    };

    const onImportSound = async () => {
        setError("");

        const paths = await pickAudioFiles();
        if (!paths.length) return;

        setNote("Decoding…");

        try {
            const at = projectTime();
            for (const path of paths) await placeSound(path, at);

            // On the shelf as well: a sound effect imported once is one the
            // user will want again without going back through a file dialog.
            addAssets("sound", paths);
            setShelf(sortedAssets("sound").concat(sortedAssets("image")));
            setTab("audio");
        } catch (e) {
            logger.warn("Could not add a sound to the timeline", e);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setNote("");
        }
    };

    const onImportImage = async () => {
        setError("");

        const paths = await pickImageFiles();
        if (!paths.length) return;

        setNote("Decoding…");

        try {
            const at = projectTime();
            for (const path of paths) await placeImage(path, at);

            addAssets("image", paths);
            setShelf(sortedAssets("sound").concat(sortedAssets("image")));
            setTab("images");
        } catch (e) {
            logger.warn("Could not add a picture to the timeline", e);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setNote("");
        }
    };

    /**
     * The pictures showing at the playhead, topmost last.
     *
     * The drag below hit-tests this list from the end, so the one drawn on top
     * is the one that gets picked up - which is what a user expects from two
     * overlapping images.
     */
    const overlaysHere = (project.overlays ?? []).filter(o => projectAt >= o.from && projectAt <= o.to && imagesById.has(o.sourceId));

    /**
     * Moves a picture by dragging it on the preview.
     *
     * Typing coordinates into two number boxes is how nobody places anything.
     * The canvas is drawn at its own pixel size and laid out at whatever size
     * the panel gives it, so every client coordinate is scaled back through the
     * bounding box before it means anything to the frame.
     */
    const onStageDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (busy || !overlaysHere.length) return;

        const canvas = e.currentTarget;
        const box = canvas.getBoundingClientRect();
        if (!box.width || !box.height) return;

        const toFrame = (clientX: number, clientY: number) => ({
            x: ((clientX - box.left) / box.width) * canvas.width,
            y: ((clientY - box.top) / box.height) * canvas.height
        });

        const start = toFrame(e.clientX, e.clientY);

        let hit: Overlay | null = null;
        for (let i = overlaysHere.length - 1; i >= 0; i--) {
            const overlay = overlaysHere[i];
            const source = imagesById.get(overlay.sourceId);
            if (!source) continue;

            const rect = overlayBox(overlay, source, canvas.width, canvas.height);
            if (start.x >= rect.x && start.x <= rect.x + rect.w && start.y >= rect.y && start.y <= rect.y + rect.h) {
                hit = overlay;
                break;
            }
        }

        if (!hit) return;

        e.preventDefault();
        setPickedOverlay(hit.id);
        setTab("images");

        const picked = hit;
        const from = { x: picked.x, y: picked.y };

        const move = (event: MouseEvent) => {
            const now = toFrame(event.clientX, event.clientY);

            // Clamped to the frame, and to the frame only: half a picture may
            // hang off an edge, which is how a corner watermark is placed, but
            // its centre stays somewhere the user can grab it again.
            patchOverlay(picked.id, {
                x: Math.min(1, Math.max(0, from.x + (now.x - start.x) / canvas.width)),
                y: Math.min(1, Math.max(0, from.y + (now.y - start.y) / canvas.height))
            }, `overlay-move-${picked.id}`);
        };

        const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };

        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    };

    /** Places a shelf entry at the playhead, and marks it as used. */
    const placeAsset = async (asset: Asset) => {
        setError("");
        setNote("Decoding…");

        try {
            const at = projectTime();

            if (asset.kind === "sound") await placeSound(asset.path, at);
            else await placeImage(asset.path, at);

            touchAsset(asset.id);
            setShelf(sortedAssets("sound").concat(sortedAssets("image")));
        } catch (e) {
            logger.warn("Could not place a shelf asset", e);

            // Named, because the usual cause is that the file moved: the entry
            // has to be identifiable for the user to drop it from the shelf.
            setError(`"${asset.name}" could not be loaded: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setNote("");
        }
    };

    const forgetAsset = (id: string) => {
        removeAsset(id);
        setShelf(sortedAssets("sound").concat(sortedAssets("image")));
    };

    const patchOverlay = (id: string, patch: Partial<Overlay>, tag = "") => {
        commit(p => ({ ...p, overlays: (p.overlays ?? []).map(o => o.id === id ? { ...o, ...patch } : o) }), tag);
    };

    /**
     * Takes a picture off the montage.
     *
     * The decoded bitmap stays, exactly as a removed sound's samples do: undo
     * has to be able to put the placement back without decoding the file again.
     */
    const removeOverlay = (id: string) => {
        commit(p => ({ ...p, overlays: (p.overlays ?? []).filter(o => o.id !== id) }));
        setPickedOverlay(current => current === id ? "" : current);
    };

    /** Moves one person's level on the montage. 1 is the recorded level. */
    const patchVoice = (userId: string, gain: number, tag = "") => {
        commit(p => ({ ...p, voiceLevels: { ...p.voiceLevels, [userId]: gain } }), tag);
    };

    const patchSound = (id: string, patch: Partial<AudioClip>, tag = "") => {
        commit(p => ({ ...p, audioClips: (p.audioClips ?? []).map(c => c.id === id ? { ...c, ...patch } : c) }), tag);
    };

    /**
     * Trims a sound at the playhead.
     *
     * The same thing dragging an edge of the block does, reachable without the
     * aim: the lane is a few hundred pixels wide for the whole montage, so a
     * cut on a particular word is far easier to make by parking the playhead on
     * it. Trimming the start moves the placement with it, so what is left stays
     * against the same frames instead of sliding backwards.
     */
    const cutSound = (clip: AudioClip, edge: "start" | "end") => {
        const at = projectTime();
        const inside = at - clip.at;
        if (inside <= 0 || inside >= clipLengthOf(clip)) return;

        if (edge === "start") patchSound(clip.id, { at, from: clip.from + inside });
        else patchSound(clip.id, { to: clip.from + inside });
    };

    /**
     * Cuts a sound in two at the playhead.
     *
     * Both halves stay where they were heard, so nothing moves on the montage
     * until one of them is dragged - which is the point: splitting is how a
     * middle section gets dropped, or how one phrase of a track gets moved
     * somewhere else. The fades stay on the outer ends, since a fade in the
     * middle of what used to be one continuous sound would be a gap.
     */
    const splitSound = (clip: AudioClip) => {
        const at = projectTime();
        const inside = at - clip.at;
        if (inside <= 0 || inside >= clipLengthOf(clip)) return;

        const cut = clip.from + inside;
        const head: AudioClip = { ...clip, to: cut, fadeOut: 0 };
        const tail: AudioClip = { ...clip, id: newId(), at, from: cut, fadeIn: 0 };

        commit(p => ({
            ...p,
            audioClips: (p.audioClips ?? []).flatMap(c => c.id === clip.id ? [head, tail] : [c])
        }));

        setPickedSound(tail.id);
    };

    /**
     * Takes a sound off the timeline.
     *
     * The decoded source stays: undo has to be able to put the placement back,
     * and decoding the file again would be seconds of wait for something the
     * modal is still holding. Everything goes together when the modal closes.
     */
    const removeSound = (id: string) => {
        commit(p => ({ ...p, audioClips: (p.audioClips ?? []).filter(c => c.id !== id) }));
        setPickedSound(current => current === id ? "" : current);
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

    /*
     * The two ends of the marked range.
     *
     * Marking is done from the playhead rather than by sweeping when the keys
     * are used, which is how a range is marked precisely: park the frame, press
     * the key, park the other frame, press the other key. A first mark with no
     * partner runs to the end of the montage, so `I` alone already means
     * "everything from here".
     */
    const markIn = () => {
        const at = projectTime();
        const end = mark && mark.to > at + 0.05 ? mark.to : total;

        if (end <= at + 0.05) {
            toast("Nothing between the mark and the end of the montage", Toasts.Type.FAILURE);
            return;
        }

        setMark({ from: at, to: end });
    };

    const markOut = () => {
        const at = projectTime();
        const start = mark && mark.from < at - 0.05 ? mark.from : 0;

        if (at <= start + 0.05) {
            toast("Nothing between the start of the montage and the mark", Toasts.Type.FAILURE);
            return;
        }

        setMark({ from: start, to: at });
    };

    /*
     * Takes the marked range out of the montage, or keeps only it.
     *
     * The new project is built here rather than inside the updater because the
     * selection has to be checked against it: a cut that swallows the segment on
     * screen leaves the editor pointing at a segment that no longer exists, and
     * the panel beside the preview would go blank with no way back.
     */
    const cutMarked = (keep: boolean) => {
        if (!mark || mark.to - mark.from < 0.05) {
            toast("Mark a range on the ruler first", Toasts.Type.FAILURE);
            return;
        }

        const before = projectRef.current;
        const next = keep
            ? keepRange(before, mark.from, mark.to)
            : cutRange(before, mark.from, mark.to);

        if (next === before) {
            toast("That range holds nothing to cut", Toasts.Type.FAILURE);
            return;
        }

        if (!next.segments.length) {
            toast("That would empty the timeline", Toasts.Type.FAILURE);
            return;
        }

        commit(() => next);
        setMark(null);

        // A split segment keeps its id on one of the two halves, so the usual
        // case survives; only a segment the cut swallowed whole needs a new
        // selection, and the head of the montage is the safe one to fall on.
        setSelected(current => next.segments.some(s => s.id === current) ? current : next.segments[0].id);

        toast(keep ? `Kept ${formatTime(mark.to - mark.from)}` : `Cut ${formatTime(mark.to - mark.from)}`, Toasts.Type.SUCCESS);
    };

    /** Empties the timeline and forgets the saved project. */
    const clearProject = () => {
        const video = videoRef.current;
        if (video?.src) {
            video.pause();
            video.removeAttribute("src");
            video.load();
        }

        sources.forEach(s => drop(s.url));
        historyRef.current = { past: [], future: [] };

        setSources([]);
        setSelected("");
        setMark(null);
        setError("");
        setDepth({ past: 0, future: 0 });
        setProject(p => ({ ...p, segments: [], captions: [], audioClips: [], overlays: [], voiceLevels: {} }));
        setSounds([]);
        setPickedSound("");
        setImages([]);
        setPickedOverlay("");
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
            // A pending seek is a click that landed in this segment before it was
            // the one on screen; it wins over the segment's own in point.
            const pending = pendingSeekRef.current;
            const at = pending?.id === segment.id ? pending.at : segment.from;
            if (pending?.id === segment.id) pendingSeekRef.current = null;

            try {
                video.currentTime = at;
            } catch {
                // Not seekable yet; the loadeddata handler below tries again.
            }
        };

        if (video.readyState >= 1) return void seek();

        video.addEventListener("loadeddata", seek, { once: true });

        // Dropped when the selection moves on before the file is ready: the
        // handler holds the segment it was made for, and letting a stale one
        // fire would seek the preview back into the segment the user just left.
        return () => video.removeEventListener("loadeddata", seek);
    }, [selected, source?.url]);

    /*
     * The preview canvas.
     *
     * The element behind it is a decoder and nothing else: what the user watches
     * is the same painter the render uses, so the effects, the fades and the
     * captions are on screen exactly where they will be in the file. Placing a
     * caption used to be blind - the preview showed the bare element - which is
     * the whole reason this exists.
     */
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d", { alpha: false });
        if (!canvas || !ctx) return;

        let frame = 0;

        const paint = () => {
            frame = requestAnimationFrame(paint);

            const video = videoRef.current;
            const { width } = canvas;
            const { height } = canvas;

            const live = projectRef.current;
            const voices = lanesRef.current;

            const shown: Frame | null = segment && video?.videoWidth
                ? {
                    segment,
                    startsAt: segmentIndex >= 0 ? segmentStart(live, segmentIndex) : 0,
                    captions: live.captions,
                    style: live.captionStyle,
                    overlays: live.overlays,
                    images: imagesRef.current,
                    voices,
                    voiceLevels: live.voiceLevels,
                    avatars: avatarsRef.current,
                    showSpeakers: live.showSpeakers !== false
                }
                : null;

            paintFrame(ctx, video ?? null, width, height, shown);

            /*
             * The montage's own mix, on the element's own volume.
             *
             * The preview plays through the element rather than through a
             * WebAudio graph, so there is no gain node to ramp and the volume
             * property is what there is. It carries everything the render puts
             * on that gain: the segment's level, the switch that drops the
             * footage's sound entirely, and the per-person duck. Leaving any of
             * the three out is what made a muted segment audible here and
             * silent in the file.
             */
            if (video) {
                const base = live.audio === false ? 0 : Math.min(1, Math.max(0, segment?.volume ?? 1));

                /*
                 * With a separated soundtrack the levels are already in the
                 * samples, and all the duck has left to carry is whoever was
                 * too quiet to separate - usually nobody, in which case
                 * `mix.duck` is undefined and this sits flat at 1.
                 */
                /*
                 * The node has to exist before the element is silenced, not
                 * merely the separation: the two are set up by different
                 * effects, and trusting the wrong one leaves a preview with the
                 * element off and nothing playing in its place.
                 */
                const node = voiceNodesRef.current;
                const mix = node ? voiceMixRef.current : null;
                const levels = mix ? mix.duck : live.voiceLevels;

                const duck = voices.length && voiceLevelsTouched(levels)
                    ? Math.min(1, voiceDuckAt(voices, levels, video.currentTime))
                    : 1;

                /*
                 * Said once per crossing rather than per frame, because a mute
                 * that does not work and a mute that never opens look the same
                 * from a chair and completely different from here.
                 */
                if ((duck < 0.999) !== (duckWasOpenRef.current)) {
                    duckWasOpenRef.current = duck < 0.999;
                    logger.info(`Voice notch ${duck < 0.999 ? `open at ${duck.toFixed(2)}` : "closed"}`
                        + ` (${voices.length} lanes, routed: ${previewBandRef.current?.el === video})`);
                }

                /*
                 * The duck rides the speech band, the volume stays the volume.
                 *
                 * These were one number once - the level was multiplied into
                 * the element's volume - and that is what made a mute silence
                 * the game, the music and everybody else along with the person
                 * being muted. The notch only reaches where a voice lives; the
                 * rest of the clip plays through it at full level. See
                 * `voiceBand.ts`.
                 *
                 * Only written when it actually moves: assigning either of
                 * these every frame makes Chromium re-run its volume plumbing
                 * at the refresh rate for nothing.
                 */
                if (mix && node) {
                    // The element is silent and the rebuilt sound is what is
                    // heard, so the mix rides that gain instead.
                    if (video.volume !== 0) video.volume = 0;
                    if (Math.abs(node.gain.gain.value - base) > 0.005) node.gain.gain.value = base;

                    node.band.set(duck);
                } else {
                    // Opened on the first clip that needs it and not before,
                    // and once it exists it keeps carrying the level even when
                    // that level is back at 1.
                    const band = duck < 1 || previewBandRef.current?.el === video ? previewBand(video) : null;
                    const wanted = band ? base : base * duck;

                    if (Math.abs(video.volume - wanted) > 0.005) video.volume = wanted;
                    band?.set(duck);
                }
            }
        };

        frame = requestAnimationFrame(paint);

        return () => {
            cancelAnimationFrame(frame);

            // The mix above left the element wherever the last frame put it,
            // and the next clip opened would start out quiet - or with the last
            // one's notch still dug into it - for no visible reason.
            const video = videoRef.current;
            if (video) video.volume = 1;

            previewBandRef.current?.band.set(1, false);
        };
    }, [segment, segmentIndex, segment?.volume, project.audio]);

    /*
     * The avatars of everyone on the timeline.
     *
     * Decoded here rather than at export so the badges are already on the
     * preview while the user decides whether they want them at all.
     */
    useEffect(() => {
        if (!people.length || project.showSpeakers === false) {
            avatarsRef.current = new Map();
            return;
        }

        let alive = true;

        void loadAvatars(people).then(cache => {
            if (alive) avatarsRef.current = cache;
        });

        return () => { alive = false; };
    }, [people, project.showSpeakers]);

    /*
     * The sound lane follows the preview.
     *
     * Scheduled on play and torn down on pause or seek rather than followed
     * frame by frame: the graph runs on the audio thread, so a bed lined up once
     * stays lined up even while the main thread is busy painting, and a seek is
     * simply a new schedule from the new position.
     */
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const stop = () => {
            stopSoundsRef.current?.();
            stopSoundsRef.current = null;
        };

        const start = () => {
            stop();

            const live = projectRef.current;

            /*
             * The overlays' soundtracks are folded in here as well, so what the
             * preview plays is what the render will write. They are rebuilt on
             * every start rather than memoised: a placement being dragged
             * changes them, and rebuilding a handful of clips is nothing next
             * to the seek that caused it.
             */
            const placed = (live.overlays ?? []).filter(o => imagesRef.current.has(o.sourceId));
            const extra = overlaySounds(placed, imagesRef.current);

            const clips = extra.clips.length ? [...(live.audioClips ?? []), ...extra.clips] : live.audioClips ?? [];
            if (!clips.length || video.paused) return;

            const sources = extra.sources.size ? new Map([...soundsById, ...extra.sources]) : soundsById;

            const ctx = audioContext();
            const from = projectTime();

            stopSoundsRef.current = scheduleClips(
                ctx, ctx.destination, clips, sources, ctx.currentTime, from, from + 3600, projectEnding(live)
            );
        };

        video.addEventListener("play", start);
        video.addEventListener("playing", start);
        video.addEventListener("seeked", start);
        video.addEventListener("pause", stop);
        video.addEventListener("ended", stop);

        return () => {
            stop();
            video.removeEventListener("play", start);
            video.removeEventListener("playing", start);
            video.removeEventListener("seeked", start);
            video.removeEventListener("pause", stop);
            video.removeEventListener("ended", stop);
        };
    }, [segment, segmentIndex, soundsById, project.audioClips, project.overlays, imagesById]);

    /*
     * The separated soundtrack follows the preview the same way.
     *
     * Started at the frame the element is on and at the segment's own rate, so
     * the rebuilt sound stays against the picture it was cut from; a seek is a
     * new start from the new position. The element itself is silent while this
     * runs - the paint loop above takes its volume to zero - so what is heard is
     * only ever one of the two.
     */
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !voiceMix || !segment) return;

        const stop = () => {
            const node = voiceNodesRef.current;
            voiceNodesRef.current = null;
            if (!node) return;

            try {
                node.source.stop();
            } catch {
                // Already finished on its own, which is what happens when the
                // playhead reaches the end of the clip.
            }

            node.source.disconnect();
            node.band.disconnect();
            node.gain.disconnect();
        };

        const start = () => {
            stop();
            if (video.paused) return;

            const ctx = audioContext();

            // Ahead of the paint loop rather than by it, so the recording is
            // not heard unseparated for the frame between the two.
            video.volume = 0;

            const gain = ctx.createGain();
            // Opened by the paint loop on its next frame, which is also what
            // knows the segment's volume and what the duck still has to do.
            gain.gain.value = 0;
            gain.connect(ctx.destination);

            const band = createVoiceBand(ctx);
            band.output.connect(gain);

            const source = ctx.createBufferSource();
            source.buffer = voiceMix.buffer;
            source.playbackRate.value = Math.min(4, Math.max(0.25, segment.speed || 1));
            source.connect(band.input);
            source.start(ctx.currentTime, Math.max(0, video.currentTime));

            voiceNodesRef.current = { source, gain, band };
        };

        if (!video.paused) start();

        video.addEventListener("play", start);
        video.addEventListener("playing", start);
        video.addEventListener("seeked", start);
        video.addEventListener("pause", stop);
        video.addEventListener("ended", stop);

        return () => {
            stop();

            // The element was left silent for the mix; anything else playing it
            // afterwards would be a preview with no sound at all.
            if (video.volume === 0) video.volume = 1;

            video.removeEventListener("play", start);
            video.removeEventListener("playing", start);
            video.removeEventListener("seeked", start);
            video.removeEventListener("pause", stop);
            video.removeEventListener("ended", stop);
        };
    }, [voiceMix, segment, segmentIndex]);

    /**
     * Puts the playhead at a point in project time.
     *
     * The montage is a list of segments in different files, so a project time is
     * only reachable by selecting the segment that covers it and seeking inside
     * it. A click on the sound lane is exactly that, which is how a sting gets
     * placed against the frame it belongs to.
     */
    const seekProject = (at: number) => {
        let elapsed = 0;

        for (let i = 0; i < project.segments.length; i++) {
            const item = project.segments[i];
            const length = segmentLength(item);

            if (at <= elapsed + length || i === project.segments.length - 1) {
                const inside = item.from + Math.max(0, at - elapsed) * Math.max(0.25, item.speed);

                setSelected(item.id);

                const video = videoRef.current;
                if (video && item.id === selected) video.currentTime = Math.min(item.to, inside);
                else pendingSeekRef.current = { id: item.id, at: Math.min(item.to, inside) };

                return;
            }

            elapsed += length;
        }
    };

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
     *
     * Held in a ref, and bound once: the handler closes over the project, the selection and the busy flag, so
     * binding it as an effect would tear the listener down and put it back on
     * every keystroke of a caption and every pixel of a slider drag. The ref is
     * rewritten each render instead, which costs nothing and keeps the listener
     * itself in place.
     */
    const keyRef = useRef<(e: KeyboardEvent) => void>(() => void 0);

    keyRef.current = (e: KeyboardEvent) => {
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
            case "i": markIn(); break;
            case "o": markOut(); break;
            case "x": cutMarked(e.shiftKey); break;
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

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => keyRef.current(e);

        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);

    /**
     * True when the render would give back exactly what went in.
     *
     * One segment, played at speed, at full volume, with no effect, no caption
     * and the sound kept: the only thing the renderer would do is decode every
     * frame and encode it again, losing quality over minutes to produce the
     * bytes that are already there.
     */
    const isPlainCut = () => {
        if (project.captions.length || project.segments.length !== 1 || !project.audio) return false;

        // A sound laid over the montage exists nowhere in the source file, so a
        // copy of that file is not the montage the user is looking at.
        if (project.audioClips?.length || project.overlays?.length) return false;

        // Same for the voice work: a person turned down or a speaker badge is
        // painted into the picture and mixed into the sound, neither of which
        // is in the file that was recorded.
        if (voiceLevelsTouched(project.voiceLevels)) return false;

        /*
         * A native clip is never a plain cut either.
         *
         * Copying its bytes keeps the per-person tracks, and everything that
         * plays a video plays the first audio track alone - which on those
         * files is the game, with the whole call missing. The export has to mix
         * them down, which is a render.
         */
        if (voiceMix?.exact) return false;
        if (project.showSpeakers !== false && people.length) return false;

        // At speed 1 the pitch switch does nothing, so it is not consulted.
        const [only] = project.segments;
        if (only.speed !== 1 || only.volume !== 1) return false;

        return (Object.keys(DEFAULT_EFFECTS) as (keyof Effects)[]).every(k => only.effects[k] === DEFAULT_EFFECTS[k]);
    };

    /**
     * The export, cut out of the source instead of re-encoded.
     *
     * Null when the timeline asks for anything the container cannot express, and
     * the caller falls back to the renderer. The cut lands on the keyframe at or
     * before the start asked for, so it can hand back slightly more than the
     * segment: that is said out loud rather than trimmed by re-encoding.
     */
    const losslessExport = async (): Promise<{ blob: Blob; name: string; } | null> => {
        if (!isPlainCut()) return null;

        const [only] = project.segments;
        const from = sources.find(s => s.id === only.sourceId);
        if (!from || !/\.(webm|mp4)$/i.test(from.name)) return null;

        // A source restored from a saved project has never been probed, so its
        // size is read now rather than giving up on the fast path.
        const height = from.height || (await probeFile(from.url)).height;

        // The output size is a render setting: honouring it means re-encoding,
        // and silently ignoring it would hand back a file of the wrong size.
        if (!height || height !== project.height) return null;

        const type = typeOfClip(from.name);
        const whole = await (await fetch(from.url)).blob();
        const cut = await trimClip(whole, type, only.from, only.to);

        // Same blob back: the parser found nothing to remove, which for a
        // segment that starts at zero and runs to the end is the right answer.
        return { blob: new Blob([cut], { type }), name: from.name };
    };

    const onExport = async () => {
        cancelRef.current = false;
        setError("");
        setProgress(0);

        try {
            const lossless = await losslessExport();

            const blob = lossless?.blob ?? await renderProject(project, voicedSources, {
                onProgress: setProgress,
                cancelled: () => cancelRef.current,
                sounds,
                images
            });

            const first = sources.find(s => s.id === project.segments[0]?.sourceId);
            const path = await writeClipCopy(blob, renderName(first?.name ?? "timeline", blob.type));

            toast(
                lossless
                    ? `Cut without re-encoding (${formatBytes(blob.size)})`
                    : `Montage saved (${formatBytes(blob.size)})`,
                Toasts.Type.SUCCESS
            );
            logger.info("Rendered a montage", path);

            await writeThumbnail(blob, path.split(/[\\/]/).pop() || "");
            void refreshClips();
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

    /**
     * Re-encodes a clip as MP4, in place of the WebM it was saved as.
     *
     * Discord's own player gives no sound on WebM, so a clip recorded before the
     * container setting was changed is silent in chat forever. This is the one
     * conversion that cannot be lossless: the codecs differ.
     */
    const onConvert = async (name: string) => {
        const mimeType = pickMimeType(Container.Mp4H264);
        if (extensionFor(mimeType) !== "mp4") {
            toast("This client cannot encode MP4", Toasts.Type.FAILURE);
            return;
        }

        cancelRef.current = false;
        setError("");
        setProgress(0);

        const opened = await openSource({ kind: "clip", name });

        try {
            const range = await probeFile(opened.url);
            const probe = document.createElement("video");
            probe.src = opened.url;
            await new Promise<void>(resolve => {
                probe.addEventListener("loadedmetadata", () => resolve(), { once: true });
                probe.addEventListener("error", () => resolve(), { once: true });
            });

            const height = probe.videoHeight || 1080;
            const width = probe.videoWidth || Math.round(height * 16 / 9);

            // Read, done with: it holds a decoder open until it is emptied.
            probe.removeAttribute("src");
            probe.load();

            const blob = await renderProject(
                {
                    segments: [{
                        id: newId(),
                        sourceId: "convert",
                        from: range.start,
                        to: range.end,
                        speed: 1,
                        volume: 1,
                        effects: { ...DEFAULT_EFFECTS }
                    }],
                    captions: [],
                    captionStyle: { ...DEFAULT_CAPTION_STYLE },
                    height,
                    width,
                    fps: project.fps,
                    audio: true
                },
                [{ id: "convert", name, url: opened.url }],
                { mimeType, onProgress: setProgress, cancelled: () => cancelRef.current }
            );

            const path = await writeClipCopy(blob, name.replace(/\.[^.]+$/, ".mp4"));
            toast(`Converted to MP4 (${formatBytes(blob.size)})`, Toasts.Type.SUCCESS);
            logger.info("Converted a clip", path);

            await writeThumbnail(blob, path.split(/[\\/]/).pop() || "");

            await refreshClips();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);

            if (cancelRef.current) toast("Conversion cancelled", Toasts.Type.MESSAGE);
            else {
                logger.error("Could not convert the clip", e);
                setError(message);
            }
        } finally {
            drop(opened.url);
            setProgress(-1);
        }
    };

    /** Puts the clip in the message box of the channel behind the studio. */
    const onSend = async (name: string) => {
        if (await sendClip(name)) onClose();
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

                        {shown.map(clip => {
                            const marks = meta[clip.name]?.markers?.length ?? 0;

                            return (
                                <button
                                    key={clip.name}
                                    className={`vc-clipper-side-clip${clip.name === picked ? " vc-clipper-active" : ""}`}
                                    disabled={busy}
                                    title={`${clip.name} - double-click to put it on the timeline`}
                                    onClick={() => { setPicked(clip.name); setConfirmDelete(false); setRenaming(""); }}
                                    onDoubleClick={() => void onAddClip(clip.name)}
                                >
                                    <div className="vc-clipper-clip-row">
                                        {thumbs[clip.name]
                                            ? <img className="vc-clipper-thumb" src={thumbs[clip.name]} alt="" />
                                            : <div className="vc-clipper-thumb vc-clipper-thumb-empty" />}
                                        <div className="vc-clipper-clip-text">
                                            <div className="vc-clipper-name">{clip.name}</div>
                                            <div className="vc-clipper-meta">
                                                {formatBytes(clip.size)} - {categoryOf(clip.name)}
                                                {marks ? ` - ${marks} marker${marks === 1 ? "" : "s"}` : ""}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}

                        {!!picked && (
                            <div className="vc-clipper-side-manage">
                                <h4 title={picked}>{picked}</h4>

                                <div className="vc-clipper-side-actions">
                                    <button className="vc-clipper-primary" disabled={busy} onClick={() => void onAddClip(picked)}>
                                        Add to the timeline
                                    </button>
                                    <button disabled={busy} onClick={() => void onSend(picked)}>Send to this channel</button>
                                    <button disabled={busy} onClick={() => void revealClip(picked)}>Show in folder</button>
                                    {/\.webm$/i.test(picked) && (
                                        <button
                                            disabled={busy}
                                            title="Discord's player gives no sound on WebM; this re-encodes the clip so it plays in chat"
                                            onClick={() => void onConvert(picked)}
                                        >
                                            Convert to MP4
                                        </button>
                                    )}
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

                        <div className="vc-clipper-stage">
                            {/*
                              * The element is the decoder, the canvas is the
                              * picture: everything the render will do is done to
                              * the frame before it reaches the screen. It stays
                              * in the layout rather than being hidden, because a
                              * display:none element gets throttled and stops
                              * handing out frames to draw.
                              */}
                            <video ref={videoRef} className="vc-clipper-decoder" playsInline />
                            <canvas
                                ref={canvasRef}
                                width={previewWidth}
                                height={previewHeight}
                                className={overlaysHere.length ? "vc-clipper-stage-live" : ""}
                                onMouseDown={onStageDown}
                            />
                        </div>

                        <div className="vc-clipper-transport">
                            <button
                                disabled={busy || !segment}
                                onClick={() => {
                                    const video = videoRef.current;
                                    if (!video) return;

                                    if (video.paused) void video.play().catch(() => void 0);
                                    else video.pause();
                                }}
                            >
                                {playing ? "Pause" : "Play"}
                            </button>

                            <input
                                type="range"
                                disabled={busy || !segment}
                                min={segment?.from ?? 0}
                                max={segment?.to ?? 1}
                                step={0.02}
                                value={Math.min(Math.max(playhead.at, segment?.from ?? 0), segment?.to ?? 1)}
                                onChange={e => {
                                    const video = videoRef.current;
                                    if (video) video.currentTime = Number(e.currentTarget.value);
                                }}
                            />

                            <span className="vc-clipper-meta">
                                {formatTime(Math.max(0, playhead.at - (segment?.from ?? 0)))} / {formatTime(segment ? segmentLength(segment) * segment.speed : 0)}
                                {" - "}{formatTime(projectAt)} in the montage
                            </span>
                        </div>

                        {!!segment && (
                            <VoiceLanes
                                tracks={lanes}
                                length={playhead.length}
                                current={playhead.at}
                                from={segment.from}
                                to={segment.to}
                                onSeek={at => {
                                    const video = videoRef.current;
                                    if (video) video.currentTime = at;
                                }}
                            />
                        )}

                        <AudioTimeline
                            clips={audioClips}
                            sources={soundsById}
                            length={total}
                            playhead={projectAt}
                            disabled={busy}
                            selected={pickedSound}
                            onChange={patchSound}
                            onSelect={id => { setPickedSound(id); setTab("audio"); }}
                            onSeek={seekProject}
                        />

                        <CutRuler
                            segments={project.segments}
                            names={rulerNames}
                            length={total}
                            playhead={projectAt}
                            mark={mark}
                            selected={selected}
                            disabled={busy}
                            onMark={setMark}
                            onSeek={seekProject}
                            onSelect={id => { setSelected(id); setTab("segment"); }}
                        />

                        {project.segments.length > 0 && (
                            <div className="vc-clipper-ruler-actions">
                                <span>
                                    {mark
                                        ? `Marked ${formatTime(mark.from)} - ${formatTime(mark.to)} (${formatTime(mark.to - mark.from)})`
                                        : "Drag across the ruler, or press I and O at the playhead, to mark a range"}
                                </span>

                                <button disabled={busy} onClick={markIn} title="I">Mark in</button>
                                <button disabled={busy} onClick={markOut} title="O">Mark out</button>
                                <button className="vc-clipper-danger" disabled={busy || !mark} onClick={() => cutMarked(false)} title="X">
                                    Cut out
                                </button>
                                <button disabled={busy || !mark} onClick={() => cutMarked(true)} title="Shift+X">
                                    Keep only
                                </button>
                                <button disabled={busy || !mark} onClick={() => setMark(null)}>Clear</button>
                            </div>
                        )}

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
                            <button className="vc-clipper-primary" disabled={busy || !project.segments.length} onClick={() => void onExport()}>
                                {rendering ? `Rendering ${Math.round(progress * 100)}%` : `Render ${formatTime(total)}`}
                            </button>

                            {rendering && (
                                <>
                                    <div className="vc-clipper-progress">
                                        <div style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
                                    </div>

                                    <button className="vc-clipper-danger" onClick={() => { cancelRef.current = true; }}>
                                        Cancel
                                    </button>
                                </>
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
                            <button className={tab === "images" ? "vc-clipper-active" : ""} onClick={() => setTab("images")}>Images</button>
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

                                {!!source && !!meta[source.name]?.markers?.length && (
                                    <div className="vc-clipper-field">
                                        <label>
                                            <span>Markers</span>
                                            <span>click to seek, shift to cut there</span>
                                        </label>
                                        <div className="vc-clipper-row vc-clipper-markers">
                                            {meta[source.name]!.markers!.map((at, i) => (
                                                <button
                                                    key={`${at}-${i}`}
                                                    disabled={busy}
                                                    title={`Marker ${i + 1} at ${formatTime(at)}`}
                                                    onClick={e => {
                                                        if (e.shiftKey) {
                                                            patchSegment(segment.id, {
                                                                from: Math.min(at, segment.to - 0.2)
                                                            });
                                                            return;
                                                        }

                                                        const video = videoRef.current;
                                                        if (video) video.currentTime = at;
                                                    }}
                                                >
                                                    {formatTime(at)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {slider("Speed", segment.speed, 0.25, 4, 0.25, v => patchSegment(segment.id, { speed: v }, "speed"), "x")}

                                {segment.speed !== 1 && (
                                    <div className="vc-clipper-field">
                                        <label>
                                            <span>Keep the voices natural</span>
                                            <input
                                                type="checkbox"
                                                checked={segment.pitch !== false}
                                                disabled={busy}
                                                onChange={e => patchSegment(segment.id, { pitch: e.currentTarget.checked })}
                                            />
                                        </label>
                                        <small>Off gives the chipmunk when sped up, the drawl when slowed down.</small>
                                    </div>
                                )}

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
                            <>
                                {people.length > 0 && (
                                    <>
                                        <div className="vc-clipper-sound-title">
                                            <span>People in this montage</span>
                                            <small>{people.length} recorded</small>
                                        </div>

                                        {voiceMix?.exact ? (
                                            <div className="vc-clipper-note">
                                                This clip was recorded by Discord's own engine, which kept every person
                                                on a track of their own and the game on another. So a level here moves
                                                that person and nobody else, and a mute leaves them out of the mix
                                                entirely: the others carry on talking over the hole where they were,
                                                and the game never dips. Nothing is estimated and nothing is ducked.
                                            </div>
                                        ) : (
                                            <div className="vc-clipper-note">
                                                The call reached this client already mixed - one signal, everybody summed
                                                into it - so a level here can only turn the whole montage up or down while
                                                a given person is making noise. A mute is therefore absolute: wherever that
                                                person can be heard the sound is cut, so they are not in the clip once, and
                                                anybody talking across them loses those instants too. The percentage next to
                                                a mute is how much of the clip goes with them, so the price is visible
                                                before you render. Clips recorded with the native engine on - the setting
                                                is in the plugin's settings - keep one track per person instead, and there
                                                a mute costs nobody else anything.
                                            </div>
                                        )}

                                        {separating >= 0 && (
                                            <div className="vc-clipper-note">
                                                Separating the voices, {Math.round(separating * 100)}% - the preview picks
                                                it up as soon as it is done.
                                            </div>
                                        )}

                                        {people.map(person => {
                                            const gain = voiceGainOf(project.voiceLevels, person.id);

                                            return (
                                                <div key={person.id} className="vc-clipper-voice-item">
                                                    {person.avatar
                                                        ? <img className="vc-clipper-voice-face" src={person.avatar} alt="" />
                                                        : <div className="vc-clipper-voice-face" />}

                                                    <div className="vc-clipper-voice-body">
                                                        <div className="vc-clipper-field">
                                                            <label>
                                                                <span title={person.name}>{person.name}</span>
                                                                <b>
                                                                    {gain === 0
                                                                        ? separated.has(person.id)
                                                                            ? "muted - lifted out of the mix"
                                                                            : `muted - silences ${Math.round(mutedFraction(person) * 100)}% of the clip`
                                                                        : `${Math.round(gain * 100)}%`}
                                                                </b>
                                                            </label>
                                                            <input
                                                                type="range"
                                                                min={0}
                                                                max={2}
                                                                step={0.05}
                                                                value={gain}
                                                                disabled={busy}
                                                                onChange={e => patchVoice(person.id, Number(e.currentTarget.value), `voice-${person.id}`)}
                                                            />
                                                        </div>
                                                    </div>

                                                    <button
                                                        className="vc-clipper-side-clip"
                                                        disabled={busy}
                                                        onClick={() => patchVoice(person.id, gain === 0 ? 1 : 0)}
                                                    >
                                                        {gain === 0 ? "Unmute" : "Mute"}
                                                    </button>
                                                </div>
                                            );
                                        })}

{/* What a mute costs, said before the render rather than after it. On a
                                            clip with a track per person it costs nothing - the mute drops that
                                            track and the call carries on - so the warning is only for the rest. */}
                                        {!voiceMix?.exact && Object.values(project.voiceLevels ?? {}).some(v => v === 0) && (
                                            <div className="vc-clipper-note">
                                                This clip was recorded as one mixed signal, so a mute works on the band
                                                a voice lives in rather than on the whole soundtrack: wherever the muted
                                                person is talking their voice drops out of the clip, and the game, the
                                                music and the low end carry on at full volume. What it cannot do is tell
                                                two voices apart - two people talking at once are literally the same
                                                samples - so anybody talking across the muted person sounds muffled for
                                                those instants. A recording with one track per person - the native
                                                engine, in the plugin's settings - mutes exactly and leaves every other
                                                voice untouched.
                                            </div>
                                        )}

                                        <div className="vc-clipper-field">
                                            <label>
                                                <span>Show who is talking</span>
                                                <input
                                                    type="checkbox"
                                                    checked={project.showSpeakers !== false}
                                                    disabled={busy}
                                                    onChange={e => { const showSpeakers = e.currentTarget.checked; commit(p => ({ ...p, showSpeakers })); }}
                                                />
                                            </label>
                                        </div>

                                        <div className="vc-clipper-note">
                                            Their avatar and name are painted in the top-left corner of the frame while they
                                            speak, in the preview and in the render alike.
                                        </div>
                                    </>
                                )}

                                <button className="vc-clipper-side-clip" disabled={busy} onClick={() => void onImportSound()}>
                                    Add a sound at the playhead…
                                </button>

                                <Shelf kind="sound" items={shelf} busy={busy} onPlace={placeAsset} onForget={forgetAsset} />

                                {!audioClips.length && (
                                    <div className="vc-clipper-note">
                                        No sound on the timeline. Add one and it lands where the playhead is; drag it on the
                                        lane under the preview to move it, drag an edge to trim it, or park the playhead and
                                        cut it there.
                                    </div>
                                )}

                                {audioClips.map(clip => {
                                    const sound = soundsById.get(clip.sourceId);
                                    const length = clipLengthOf(clip);

                                    // A cut only means something strictly inside the block.
                                    const inside = projectAt > clip.at && projectAt < clipEnd(clip);

                                    return (
                                        <div
                                            key={clip.id}
                                            className={`vc-clipper-caption-item${clip.id === pickedSound ? " vc-clipper-active" : ""}`}
                                            onMouseDown={() => setPickedSound(clip.id)}
                                        >
                                            <div className="vc-clipper-sound-title">
                                                <span title={sound?.name}>{sound?.name ?? "missing sound"}</span>
                                                <small>{formatTime(length)} at {formatTime(clip.at)}</small>
                                            </div>

                                            <div className="vc-clipper-field">
                                                <label>
                                                    <span>Level</span>
                                                    <b>{Math.round(clip.gain * 100)}%</b>
                                                </label>
                                                <input
                                                    type="range"
                                                    min={0}
                                                    max={2}
                                                    step={0.05}
                                                    value={clip.gain}
                                                    disabled={busy}
                                                    onChange={e => patchSound(clip.id, { gain: Number(e.currentTarget.value) }, `gain-${clip.id}`)}
                                                />
                                            </div>

                                            <div className="vc-clipper-row">
                                                <div className="vc-clipper-field">
                                                    <label><span>Fade in</span><b>{clip.fadeIn.toFixed(1)}s</b></label>
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={Math.max(0.5, Math.min(10, length))}
                                                        step={0.1}
                                                        value={clip.fadeIn}
                                                        disabled={busy}
                                                        onChange={e => patchSound(clip.id, { fadeIn: Number(e.currentTarget.value) }, `fadein-${clip.id}`)}
                                                    />
                                                </div>

                                                <div className="vc-clipper-field">
                                                    <label><span>Fade out</span><b>{clip.fadeOut.toFixed(1)}s</b></label>
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={Math.max(0.5, Math.min(10, length))}
                                                        step={0.1}
                                                        value={clip.fadeOut}
                                                        disabled={busy}
                                                        onChange={e => patchSound(clip.id, { fadeOut: Number(e.currentTarget.value) }, `fadeout-${clip.id}`)}
                                                    />
                                                </div>
                                            </div>

                                            <div className="vc-clipper-caption-row">
                                                <button disabled={busy || !inside} onClick={() => cutSound(clip, "start")}>
                                                    Cut start here
                                                </button>
                                                <button disabled={busy || !inside} onClick={() => cutSound(clip, "end")}>
                                                    Cut end here
                                                </button>
                                                <button disabled={busy || !inside} onClick={() => splitSound(clip)}>
                                                    Split here
                                                </button>
                                            </div>

                                            <div className="vc-clipper-caption-row">
                                                <button disabled={busy} onClick={() => patchSound(clip.id, { at: projectTime() })}>
                                                    Move here
                                                </button>
                                                <button disabled={busy} onClick={() => patchSound(clip.id, { muted: !clip.muted })}>
                                                    {clip.muted ? "Unmute" : "Mute"}
                                                </button>
                                                <button className="vc-clipper-danger" disabled={busy} onClick={() => removeSound(clip.id)}>
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                <div className="vc-clipper-note">
                                    The sliders below balance what goes into a new recording, not what is on this timeline.
                                </div>

                                <div className="vc-clipper-mixer">
                                    <AudioMixerInput compact />
                                </div>
                            </>
                        )}

                        {tab === "images" && (
                            <>
                                <button className="vc-clipper-side-clip" disabled={busy} onClick={() => void onImportImage()}>
                                    Add a picture or a clip at the playhead…
                                </button>

                                <Shelf kind="image" items={shelf} busy={busy} onPlace={placeAsset} onForget={forgetAsset} />

                                {!overlays.length && (
                                    <div className="vc-clipper-note">
                                        Nothing over the picture yet. A PNG, a GIF or a short MP4 all work, and the
                                        moving ones play while the montage does. Add one and it lands in the middle of the frame for
                                        {" "}{OVERLAY_SECONDS} seconds from the playhead; drag it on the preview to move it,
                                        and set how long it stays with the two buttons under it.
                                    </div>
                                )}

                                {overlays.map(overlay => {
                                    const source = imagesById.get(overlay.sourceId);
                                    const length = Math.max(0, overlay.to - overlay.from);
                                    const showing = projectAt >= overlay.from && projectAt <= overlay.to;

                                    return (
                                        <div
                                            key={overlay.id}
                                            className={`vc-clipper-caption-item${overlay.id === pickedOverlay ? " vc-clipper-active" : ""}`}
                                            onMouseDown={() => setPickedOverlay(overlay.id)}
                                        >
                                            <div className="vc-clipper-sound-title">
                                                <span title={source?.name}>{source?.name ?? "missing picture"}</span>
                                                <small>{formatTime(length)} at {formatTime(overlay.from)}{showing ? " - showing" : ""}</small>
                                            </div>

                                            {source?.audio && (
                                                <div className="vc-clipper-field">
                                                    <label>
                                                        <span>Sound</span>
                                                        <b>{overlay.volume > 0 ? `${Math.round(overlay.volume * 100)}%` : "off"}</b>
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={2}
                                                        step={0.05}
                                                        value={overlay.volume}
                                                        disabled={busy}
                                                        onChange={e => patchOverlay(overlay.id, { volume: Number(e.currentTarget.value) }, `volume-${overlay.id}`)}
                                                    />
                                                </div>
                                            )}

                                            <div className="vc-clipper-field">
                                                <label><span>Size</span><b>{Math.round(overlay.scale * 100)}% wide</b></label>
                                                <input
                                                    type="range"
                                                    min={0.05}
                                                    max={1.5}
                                                    step={0.01}
                                                    value={overlay.scale}
                                                    disabled={busy}
                                                    onChange={e => patchOverlay(overlay.id, { scale: Number(e.currentTarget.value) }, `scale-${overlay.id}`)}
                                                />
                                            </div>

                                            <div className="vc-clipper-row">
                                                <div className="vc-clipper-field">
                                                    <label><span>Across</span><b>{Math.round(overlay.x * 100)}%</b></label>
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={1}
                                                        step={0.01}
                                                        value={overlay.x}
                                                        disabled={busy}
                                                        onChange={e => patchOverlay(overlay.id, { x: Number(e.currentTarget.value) }, `x-${overlay.id}`)}
                                                    />
                                                </div>

                                                <div className="vc-clipper-field">
                                                    <label><span>Down</span><b>{Math.round(overlay.y * 100)}%</b></label>
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={1}
                                                        step={0.01}
                                                        value={overlay.y}
                                                        disabled={busy}
                                                        onChange={e => patchOverlay(overlay.id, { y: Number(e.currentTarget.value) }, `y-${overlay.id}`)}
                                                    />
                                                </div>
                                            </div>

                                            <div className="vc-clipper-row">
                                                <div className="vc-clipper-field">
                                                    <label><span>Opacity</span><b>{Math.round(overlay.opacity * 100)}%</b></label>
                                                    <input
                                                        type="range"
                                                        min={0.05}
                                                        max={1}
                                                        step={0.05}
                                                        value={overlay.opacity}
                                                        disabled={busy}
                                                        onChange={e => patchOverlay(overlay.id, { opacity: Number(e.currentTarget.value) }, `opacity-${overlay.id}`)}
                                                    />
                                                </div>

                                                <div className="vc-clipper-field">
                                                    <label><span>Tilt</span><b>{Math.round(overlay.rotation)}°</b></label>
                                                    <input
                                                        type="range"
                                                        min={-180}
                                                        max={180}
                                                        step={1}
                                                        value={overlay.rotation}
                                                        disabled={busy}
                                                        onChange={e => patchOverlay(overlay.id, { rotation: Number(e.currentTarget.value) }, `rotation-${overlay.id}`)}
                                                    />
                                                </div>
                                            </div>

                                            <div className="vc-clipper-row">
                                                <div className="vc-clipper-field">
                                                    <label><span>Fade in</span><b>{overlay.fadeIn.toFixed(1)}s</b></label>
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={Math.max(0.5, Math.min(5, length))}
                                                        step={0.1}
                                                        value={overlay.fadeIn}
                                                        disabled={busy}
                                                        onChange={e => patchOverlay(overlay.id, { fadeIn: Number(e.currentTarget.value) }, `fadein-${overlay.id}`)}
                                                    />
                                                </div>

                                                <div className="vc-clipper-field">
                                                    <label><span>Fade out</span><b>{overlay.fadeOut.toFixed(1)}s</b></label>
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={Math.max(0.5, Math.min(5, length))}
                                                        step={0.1}
                                                        value={overlay.fadeOut}
                                                        disabled={busy}
                                                        onChange={e => patchOverlay(overlay.id, { fadeOut: Number(e.currentTarget.value) }, `fadeout-${overlay.id}`)}
                                                    />
                                                </div>
                                            </div>

                                            <div className="vc-clipper-caption-row">
                                                <button
                                                    disabled={busy}
                                                    onClick={() => patchOverlay(overlay.id, { from: Math.min(projectTime(), overlay.to - 0.2) })}
                                                >
                                                    Starts here
                                                </button>
                                                <button
                                                    disabled={busy}
                                                    onClick={() => patchOverlay(overlay.id, { to: Math.max(projectTime(), overlay.from + 0.2) })}
                                                >
                                                    Ends here
                                                </button>
                                                <button className="vc-clipper-danger" disabled={busy} onClick={() => removeOverlay(overlay.id)}>
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                <div className="vc-clipper-note">
                                    Sizes and positions are kept as a share of the frame, so a montage laid out on this
                                    preview comes out the same whether it is rendered at 720p or at 1080p.
                                </div>
                            </>
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
