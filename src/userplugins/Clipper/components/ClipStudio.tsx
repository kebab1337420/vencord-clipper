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

import { ANGLE_PACES, type AngleTrack, cutBetweenAngles } from "../angleCut";
import { fetchAngle, type PostedAngle, postedAngles } from "../angles";
import { addAssets, type Asset, type AssetKind, removeAsset, sortedAssets, touchAsset } from "../assets";
import {
    alignTo,
    type AudioClip,
    type AudioSource,
    beatsOf,
    clipEnd,
    clipLengthOf,
    decodeSource,
    ENVELOPE_HZ,
    envelopeOf,
    scheduleClips,
    stretchToRate
} from "../audio";
import type { ChatLine } from "../chat";
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
import { trimBytes } from "../repair";
import { sendClipFitted } from "../send";
import { Container, extensionFor, pickMimeType } from "../settings";
import {
    type AngleLayout,
    type AvatarCache,
    bestOf,
    type Caption,
    cutRange,
    cutSilence,
    decodeImage,
    DEFAULT_CAPTION_STYLE,
    DEFAULT_EFFECTS,
    DEFAULT_MONTAGE,
    DEFAULT_OVERLAY,
    duckSettingsOf,
    type Effects,
    estimatedSize,
    type Frame,
    framingAt,
    type ImageSource,
    keepRange,
    loadAvatars,
    type MontagePick,
    newId,
    type Overlay,
    OVERLAY_SECONDS,
    overlayBox,
    overlaySounds,
    paintFrame,
    type Project,
    projectEnding,
    projectLength,
    punchIn,
    reframeVertical,
    renderProject,
    type Segment,
    segmentLength,
    segmentStart,
    snapToBeats,
    type SourceOrigin,
    speechDuck,
    type StudioSource,
    trackAction,
    verticalWidth,
    type ZoomKey
} from "../studio";
import { writeThumbnail } from "../thumbnail";
import { toast } from "../toasts";
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
    /* The drop veil is laid over this and nothing else. Without it the veil
       would anchor to the backdrop and grey out the whole screen. */
    position: relative;
}
/* The title is the whole header here: the panels underneath say what each does. */
.vc-clipper-studio .vc-clipper-head {
    align-items: center;
    padding: 12px 16px 10px;
}
.vc-clipper-studio .vc-clipper-head h2 {
    font-size: 16px;
    line-height: 20px;
}
.vc-clipper-studio.vc-clipper-dropping {
    outline: 2px dashed var(--brand-experiment, #5865f2);
    outline-offset: -2px;
}
.vc-clipper-drop-veil {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: inherit;
    background: color-mix(in srgb, var(--background-primary, #313338) 82%, transparent);
    /* The veil sits over the whole modal, so it must not be what the drop
       lands on: the count would never come back down and the handlers on the
       modal below would never see it. */
    pointer-events: none;
}
.vc-clipper-drop-veil > div {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    padding: 18px 26px;
    border: 2px dashed var(--brand-experiment, #5865f2);
    border-radius: 12px;
    text-align: center;
}
.vc-clipper-drop-veil b {
    font-size: 16px;
    color: var(--header-primary, #f2f3f5);
}
.vc-clipper-drop-veil small {
    color: var(--text-muted, #949ba4);
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
    gap: 8px;
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
    padding: 0 2px;
}
/* Round, so the one control that is pressed constantly reads as the one that is. */
.vc-clipper-transport button {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--brand-experiment, #5865f2);
    color: #fff;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition: background-color .12s ease, transform .12s ease;
}
.vc-clipper-transport button:hover:not(:disabled) {
    background: var(--brand-experiment-560, #4752c4);
    transform: scale(1.06);
}
.vc-clipper-transport button:disabled {
    background: var(--button-secondary-background, #4e5058);
    opacity: .4;
    cursor: default;
}
.vc-clipper-transport input[type="range"] {
    flex: 1;
    min-width: 0;
    accent-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-time {
    flex: 0 0 auto;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted, #949ba4);
}
.vc-clipper-time b {
    color: var(--text-normal, #dbdee1);
    font-weight: 600;
}

/*
 * The strips under the picture - cut ruler, segments, sounds, voices - are one
 * card with a label gutter rather than four cards in a column. Four bordered
 * boxes stacked on top of each other read as four unrelated widgets; the same
 * four rows sharing a background read as one timeline, which is what they are.
 */
.vc-clipper-tracks {
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    background: var(--background-secondary, #2b2d31);
    box-shadow: inset 0 0 0 1px var(--background-modifier-accent, rgba(78, 80, 88, .48));
    overflow: hidden;
}
.vc-clipper-track {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
}
.vc-clipper-track + .vc-clipper-track {
    border-top: 1px solid var(--background-modifier-accent, rgba(78, 80, 88, .32));
}
.vc-clipper-track-label {
    flex: 0 0 auto;
    width: 44px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--text-muted, #949ba4);
    user-select: none;
}
.vc-clipper-track-body {
    flex: 1;
    min-width: 0;
}
.vc-clipper-track-empty {
    align-self: center;
    padding: 12px 2px;
    color: var(--text-muted, #949ba4);
    font-size: 12px;
}

/* ------------------------------------------------------------ sound lane -- */
.vc-clipper-sounds {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.vc-clipper-sound-lane {
    position: relative;
    height: 40px;
    border-radius: 6px;
    background: var(--background-tertiary, #1e1f22);
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
.vc-clipper-side > h4:first-child {
    margin-top: 0;
}
.vc-clipper-side h4 {
    margin: 14px 0 8px;
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
/* Same row as the library entries, but an outline: this one makes something. */
.vc-clipper-add {
    margin-bottom: 10px;
    border: 1px dashed var(--background-modifier-accent, rgba(78, 80, 88, .8));
    color: var(--header-secondary, #b5bac1);
    text-align: center;
    font-size: 12px;
    font-weight: 500;
}
.vc-clipper-add:hover:not(:disabled) {
    border-color: var(--brand-experiment, #5865f2);
    color: var(--text-normal, #dbdee1);
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
    padding: 2px 0 4px;
    min-height: 56px;
}
.vc-clipper-block {
    flex: 0 0 auto;
    min-width: 74px;
    padding: 6px 9px;
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
    min-width: 0;
}
.vc-clipper-ruler {
    position: relative;
    height: 24px;
    border-radius: 6px;
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
/* The markers, on the montage's own clock. Amber rather than the playhead's
   white: a tick is a place worth cutting near, not the place being watched. */
.vc-clipper-ruler-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--yellow-330, #f0b232);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .35);
    pointer-events: none;
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
/* Sits in the ruler's own row, so marking a range costs no vertical space. */
.vc-clipper-ruler-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
}
.vc-clipper-ruler-actions button {
    padding: 3px 8px;
    border: none;
    border-radius: 4px;
    background: var(--background-tertiary, #1e1f22);
    color: var(--text-muted, #949ba4);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color .12s ease, color .12s ease;
}
.vc-clipper-ruler-actions button:hover:not(:disabled) {
    background: var(--background-modifier-hover, rgba(78, 80, 88, .3));
    color: var(--text-normal, #dbdee1);
}
.vc-clipper-ruler-actions button:disabled {
    opacity: .4;
    cursor: default;
}
.vc-clipper-ruler-actions button.vc-clipper-danger:not(:disabled) {
    background: var(--button-danger-background, #da373c);
    color: #fff;
}
.vc-clipper-mark-badge {
    flex: 0 0 auto;
    padding: 2px 7px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--button-danger-background, #da373c) 24%, transparent);
    color: var(--text-normal, #dbdee1);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
}

/* ---------------------------------------------------------- voice lanes -- */
.vc-clipper-lanes {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 116px;
    overflow-y: auto;
}
.vc-clipper-lane {
    display: flex;
    align-items: center;
    gap: 8px;
}
.vc-clipper-lane-name {
    width: 96px;
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
    height: 20px;
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
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--background-tertiary, #1e1f22);
}
.vc-clipper-caption-item.vc-clipper-active {
    border-color: var(--brand-experiment, #5865f2);
}
.vc-clipper-caption-item > .vc-clipper-field:last-of-type,
.vc-clipper-caption-item > .vc-clipper-row:last-of-type {
    margin-bottom: 0;
}
.vc-clipper-side-manage {
    margin-top: 12px;
    padding: 10px;
    border-radius: 8px;
    background: var(--background-secondary-alt, #232428);
}
.vc-clipper-side-manage h4 {
    margin-top: 0;
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
.vc-clipper-caption-row button,
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
.vc-clipper-caption-row button:hover:not(:disabled),
.vc-clipper-studio-foot button:hover:not(:disabled) {
    background: var(--button-secondary-background-hover, #6d6f78);
}
.vc-clipper-side-actions button:focus-visible,
.vc-clipper-row button:focus-visible,
.vc-clipper-caption-row button:focus-visible,
.vc-clipper-studio-foot button:focus-visible,
.vc-clipper-side-clip:focus-visible,
.vc-clipper-block:focus-visible {
    outline: 2px solid var(--brand-experiment, #5865f2);
    outline-offset: 2px;
}
.vc-clipper-side-actions button:disabled,
.vc-clipper-row button:disabled,
.vc-clipper-caption-row button:disabled,
.vc-clipper-studio-foot button:disabled {
    opacity: .5;
    cursor: default;
}
.vc-clipper-side-actions button.vc-clipper-primary,
.vc-clipper-row button.vc-clipper-primary,
.vc-clipper-studio-foot button.vc-clipper-primary {
    background: var(--brand-experiment, #5865f2);
}
.vc-clipper-side-actions button.vc-clipper-primary:hover:not(:disabled),
.vc-clipper-row button.vc-clipper-primary:hover:not(:disabled),
.vc-clipper-studio-foot button.vc-clipper-primary:hover:not(:disabled) {
    background: var(--brand-experiment-560, #4752c4);
}
.vc-clipper-side-actions button.vc-clipper-danger,
.vc-clipper-row button.vc-clipper-danger,
.vc-clipper-caption-row button.vc-clipper-danger,
.vc-clipper-studio-foot button.vc-clipper-danger {
    background: var(--button-danger-background, #da373c);
}
.vc-clipper-side-actions button.vc-clipper-danger:hover:not(:disabled),
.vc-clipper-row button.vc-clipper-danger:hover:not(:disabled),
.vc-clipper-caption-row button.vc-clipper-danger:hover:not(:disabled),
.vc-clipper-studio-foot button.vc-clipper-danger:hover:not(:disabled) {
    background: var(--button-danger-background-hover, #a12828);
}
.vc-clipper-caption-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
}
.vc-clipper-caption-row button {
    flex: 1 1 auto;
    height: 28px;
    padding: 0 8px;
    font-size: 12px;
}

/* ----------------------------------------------------------------- notes -- */
/*
 * A note in the panels is an aside, not an announcement: the shared style is a
 * centred paragraph the width of a modal, which in a 312px column turns three
 * sentences into a wall. Here it is a quiet left-aligned block with a rule down
 * its side, sized so it reads as a caption to the control above it.
 */
.vc-clipper-studio .vc-clipper-note {
    padding: 7px 10px;
    border-radius: 6px;
    border-left: 2px solid var(--background-modifier-accent, rgba(78, 80, 88, .8));
    background: var(--background-secondary-alt, #232428);
    text-align: left;
    font-size: 12px;
    line-height: 16px;
}
.vc-clipper-studio-main > .vc-clipper-note {
    padding: 8px 12px;
}
.vc-clipper-side .vc-clipper-note {
    margin-bottom: 10px;
}
.vc-clipper-studio .vc-clipper-note.vc-clipper-error {
    border-left-color: var(--text-danger, #f23f43);
}

/*
 * The long explanations - what a mute costs, what the render is about to do -
 * are worth reading once and in the way afterwards, so they fold. Shut by
 * default: the summary carries the answer, the body carries the reasoning.
 */
.vc-clipper-hint {
    margin-bottom: 10px;
    border-radius: 6px;
    background: var(--background-secondary-alt, #232428);
}
.vc-clipper-hint > summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    color: var(--text-muted, #949ba4);
    font-size: 12px;
    cursor: pointer;
    list-style: none;
    user-select: none;
}
.vc-clipper-hint > summary::-webkit-details-marker {
    display: none;
}
.vc-clipper-hint > summary::before {
    content: "";
    flex: 0 0 auto;
    width: 0;
    height: 0;
    border-left: 4px solid currentColor;
    border-top: 3.5px solid transparent;
    border-bottom: 3.5px solid transparent;
    transition: transform .12s ease;
}
.vc-clipper-hint[open] > summary::before {
    transform: rotate(90deg);
}
.vc-clipper-hint > summary:hover {
    color: var(--text-normal, #dbdee1);
}
.vc-clipper-hint > div {
    padding: 0 10px 9px 20px;
    color: var(--text-muted, #949ba4);
    font-size: 12px;
    line-height: 16px;
}

/* --------------------------------------------------------------- groups -- */
/*
 * Ten sliders in a column is a list nobody scans. Grouped, the panel opens on
 * the three or four that are wanted and the rest stay one click away.
 */
.vc-clipper-group {
    margin-bottom: 10px;
    border-radius: 8px;
    background: var(--background-secondary-alt, #232428);
}
.vc-clipper-group > summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    color: var(--header-secondary, #b5bac1);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .02em;
    cursor: pointer;
    list-style: none;
    user-select: none;
}
.vc-clipper-group > summary::-webkit-details-marker {
    display: none;
}
.vc-clipper-group > summary::before {
    content: "";
    flex: 0 0 auto;
    width: 0;
    height: 0;
    border-left: 4px solid currentColor;
    border-top: 3.5px solid transparent;
    border-bottom: 3.5px solid transparent;
    transition: transform .12s ease;
}
.vc-clipper-group[open] > summary::before {
    transform: rotate(90deg);
}
.vc-clipper-group > summary:hover {
    color: var(--header-primary, #f2f3f5);
}
.vc-clipper-group > summary small {
    margin-left: auto;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-muted, #949ba4);
    font-variant-numeric: tabular-nums;
}
.vc-clipper-group-body {
    padding: 2px 10px 4px;
}
.vc-clipper-group-body > .vc-clipper-field:last-child,
.vc-clipper-group-body > .vc-clipper-row:last-child {
    margin-bottom: 0;
}
.vc-clipper-group-body > .vc-clipper-row + .vc-clipper-row {
    margin-top: 6px;
}

/* The tabs stay put while the panel under them scrolls. */
.vc-clipper-side .vc-clipper-tabs {
    position: sticky;
    top: -12px;
    z-index: 1;
    margin: -12px -12px 12px;
    padding: 12px 12px 9px;
    border-radius: 0;
    background: var(--background-secondary, #2b2d31);
}
.vc-clipper-tab-strip {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 8px;
    background: var(--background-tertiary, #1e1f22);
}
.vc-clipper-side h4 + .vc-clipper-field,
.vc-clipper-side h4 + .vc-clipper-group {
    margin-top: 0;
}
`;

/**
 * Follows the preview's transport.
 *
 * `start` runs on everything that means the element is playing again - a seek
 * included, because what was scheduled for the old position is not the sound
 * for this one - and `stop` on the two events that mean it is not. Hands back
 * the cleanup, so an effect can return it as it is.
 */
function followPlayback(video: HTMLVideoElement, start: () => void, stop: () => void): () => void {
    video.addEventListener("play", start);
    video.addEventListener("playing", start);
    video.addEventListener("seeked", start);
    video.addEventListener("pause", stop);
    video.addEventListener("ended", stop);

    return () => {
        video.removeEventListener("play", start);
        video.removeEventListener("playing", start);
        video.removeEventListener("seeked", start);
        video.removeEventListener("pause", stop);
        video.removeEventListener("ended", stop);
    };
}

/** How many thumbnail sidecars are read at once when a folder is listed. */
const THUMB_READS = 4;

/** What a dropped file is taken for, by its name. */
const DROP_VIDEO = /\.(mp4|webm|mkv|mov|m4v)$/i;
const DROP_SOUND = /\.(mp3|wav|ogg|opus|m4a|aac|flac)$/i;
const DROP_IMAGE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;

/** The native reader's own caps, which a drop does not pass through. */
const DROP_VIDEO_BYTES = 512 * 1024 * 1024;
const DROP_SOUND_BYTES = 64 * 1024 * 1024;

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

/*
 * How many clips the auto-montage will open at once.
 *
 * Every one of them holds a decoded video element open for as long as the
 * timeline does, and a folder with a hundred marked clips in it would exhaust
 * the client rather than build anything watchable.
 */
const MONTAGE_CLIPS = 12;

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

/**
 * Whether the user has already been told the timeline is not being kept.
 *
 * Module scope rather than component state: the write is debounced and runs
 * every few seconds while editing, so a per-render flag would still let the
 * same warning stack up a dozen times over one session.
 */
let saveWarned = false;

function writeSaved(value: SavedProject | null) {
    try {
        if (!value) store.removeItem(STORAGE_KEY);
        else store.setItem(STORAGE_KEY, JSON.stringify(value));

        saveWarned = false;
    } catch (e) {
        logger.warn("Could not save the studio project", e);

        // The studio promises the timeline outlives the modal, so a storage
        // that refuses the write - a full quota, most often - has to be said
        // out loud. Silently, the user closes the studio on a finished montage
        // and opens it again on nothing.
        if (!saveWarned) {
            saveWarned = true;
            toast("This timeline is not being kept: the client's storage refused it. Render before you close.", Toasts.Type.FAILURE);
        }
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

/**
 * A paragraph worth reading once, folded away until it is.
 *
 * The studio has several of these - what a mute actually costs, what the render
 * is about to do - and they are true and they matter, but a panel 312px wide
 * turns any of them into a wall standing between two controls. The summary is
 * the answer; the body is why.
 */
function Hint({ summary, children }: { summary: string; children: React.ReactNode; }) {
    const [open, setOpen] = useState(false);

    return (
        <details className="vc-clipper-hint" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
            <summary>{summary}</summary>
            <div>{children}</div>
        </details>
    );
}

/**
 * A named run of controls, foldable.
 *
 * The segment panel is a dozen sliders deep and only three or four of them are
 * ever wanted at once, so they come in groups: the ones that get touched every
 * time are open, the rest are a click away rather than a scroll away.
 */
function Group({ title, note, start = false, children }: {
    title: string;
    note?: string;
    start?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(start);

    return (
        <details className="vc-clipper-group" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
            <summary>{title}{note ? <small>{note}</small> : null}</summary>
            <div className="vc-clipper-group-body">{children}</div>
        </details>
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

    /**
     * The caption the keyboard acts on.
     *
     * Captions are the only thing on the timeline with no handle in the
     * preview, so without this they could be copied and nudged only by the
     * buttons on their own row, while sounds and pictures answered the
     * keyboard.
     */
    const [pickedCaption, setPickedCaption] = useState("");

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

    /**
     * Whether the preview goes back to the in point instead of stopping.
     *
     * Judging a cut of two seconds means watching it a dozen times, and hitting
     * play between each one loses the rhythm that is being judged.
     */
    const [loop, setLoop] = useState(false);

    /**
     * How many drags are currently over the studio.
     *
     * A count rather than a flag, because dragging across a child fires a leave
     * for the old element after the enter for the new one, and a flag would
     * blink the whole overlay off and on as the cursor crossed every button.
     */
    const [dragging, setDragging] = useState(0);
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

    /** Rough length the auto-montage aims for, in seconds. */
    const [montageTarget, setMontageTarget] = useState(DEFAULT_MONTAGE.target);

    /** The video files posted in the channel, once somebody has asked for them. */
    const [posted, setPosted] = useState<PostedAngle[] | null>(null);

    /** How fast a multi-angle edit cuts, when one is made. */
    const [anglePace, setAnglePace] = useState("normal");

    /** The countdown on the delete confirmation, so a second click resets it. */
    const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (confirmTimer.current != null) clearTimeout(confirmTimer.current);
    }, []);

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
    const duck = duckSettingsOf(project);

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

    /** What the chat said while the previewed clip was recorded. */
    const chatLines = useMemo(
        () => (source ? meta[source.name]?.chat ?? [] : []),
        [source?.name, meta]
    );

    // Read by the preview's paint loop, which must not be re-armed on every
    // clip switch just to see the new tracks.
    const lanesRef = useRef<VoiceTrack[]>([]);
    lanesRef.current = lanes;

    const chatRef = useRef<ChatLine[]>([]);
    chatRef.current = chatLines;

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

    /** Whether the notch was open on the previous frame, for the log line. */
    const duckWasOpenRef = useRef(false);

    /**
     * The preview's notch, and the element it belongs to.
     *
     * Opened only if a level is ever moved: `createMediaElementSource` is a
     * one-way door, taking the element's sound out of the page and into the
     * graph for the life of the context, and it may only be called once per
     * element. Until then the preview plays straight out of the element.
     *
     * The element is not decoration. That call binds a source node to one
     * element for good, and the preview does not keep one element: it gets a
     * new `<video>` whenever the montage moves to a clip from another file. The
     * routing was cached without recording who it was for, so after that swap
     * the notch was still there, still being driven, still reporting a mute -
     * attached to an element nobody was listening to, while the new one played
     * straight out of the page at full volume. A mute that does nothing at all,
     * which is exactly what it looked like.
     */
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
            const chat = meta[item.name]?.chat;

            if (!voices?.length && !tracks?.length && !chat?.length) return item;

            return {
                ...item,
                ...(voices?.length ? { voices: voices.map(fromMeta) } : {}),
                ...(tracks?.length ? { tracks } : {}),
                ...(chat?.length ? { chat } : {})
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

    /**
     * Every marker of every segment, moved onto the montage's clock.
     *
     * A marker is stored against the source file, so it is placed by where its
     * segment starts and stretched by that segment's speed: one inside a 2x
     * segment is half as far along the montage as it is along the file. A
     * marker a trim left outside its segment is not on the montage at all, and
     * is not drawn.
     */
    const rulerMarkers = (() => {
        const out: number[] = [];
        let elapsed = 0;

        for (const s of project.segments) {
            const span = Math.max(0.001, s.to - s.from);
            const scale = segmentLength(s) / span;

            for (const at of meta[byId.get(s.sourceId)?.name ?? ""]?.markers ?? []) {
                if (at >= s.from && at <= s.to) out.push(elapsed + (at - s.from) * scale);
            }

            elapsed += segmentLength(s);
        }

        return out;
    })();

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
        if (confirmTimer.current != null) clearTimeout(confirmTimer.current);
        confirmTimer.current = null;

        if (!confirmDelete) {
            setConfirmDelete(true);
            // An older countdown left running would disarm the confirmation
            // under the click that was about to answer it.
            confirmTimer.current = setTimeout(() => setConfirmDelete(false), 4000);
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

        // All of them at once: each one is a file read over IPC, and a timeline
        // of a dozen sources used to open them one after another with the modal
        // sitting on "Restoring…" throughout.
        const opened = await Promise.all(saved.sources.map(async (entry): Promise<StudioSource | null> => {
            if (!entry.origin) return null;

            try {
                const { url } = await openSource(entry.origin);
                return { id: entry.id, name: entry.name, url, origin: entry.origin };
            } catch (e) {
                logger.warn("Could not restore a timeline source", e);
                return null;
            }
        }));

        const loaded = opened.filter((source): source is StudioSource => source !== null);

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
        const [decoded, pictures] = await Promise.all([
            Promise.all((saved.sounds ?? []).map(async (entry): Promise<AudioSource | null> => {
                try {
                    const { name, url, data } = track(await loadAudioFile(entry.path));
                    return await decodeSource(audioContext(), entry.id, name || entry.name, data, url, entry.path);
                } catch (e) {
                    logger.warn("Could not restore a timeline sound", e);
                    return null;
                }
            })).then(list => list.filter((sound): sound is AudioSource => sound !== null)),

            // Pictures, on the same terms as the sounds above.
            Promise.all((saved.images ?? []).map(async (entry): Promise<ImageSource | null> => {
                try {
                    const { name, url } = track(await loadImageFile(entry.path));
                    return await decodeImage(entry.id, name || entry.name, url, audioContext(), entry.path);
                } catch (e) {
                    logger.warn("Could not restore a timeline picture", e);
                    return null;
                }
            })).then(list => list.filter((picture): picture is ImageSource => picture !== null))
        ]);

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
            const pending = clips.filter(clip => clip.thumb && !thumbs[clip.name]);
            let next = 0;

            /*
             * A few reads in flight rather than one.
             *
             * A folder of two hundred clips used to be two hundred IPC reads in
             * single file before the last picture appeared. All of them at once
             * would hand the main process the whole folder in one breath, which
             * is the opposite mistake, so the reads share a handful of slots.
             */
            const worker = async () => {
                for (let i = next++; i < pending.length; i = next++) {
                    if (!aliveRef.current) return;

                    const clip = pending[i];
                    const url = await loadThumbUrl(clip);
                    if (!url) continue;

                    // The modal may have closed during the read, in which case
                    // this URL has already missed the unmount's sweep.
                    if (!aliveRef.current) {
                        URL.revokeObjectURL(url);
                        return;
                    }

                    // Checked again inside the setter: two listings in flight
                    // would otherwise both read the same sidecar and one URL
                    // would be stranded until the modal closes.
                    setThumbs(current => {
                        if (current[clip.name]) {
                            URL.revokeObjectURL(url);
                            return current;
                        }

                        urlsRef.current.add(url);
                        return { ...current, [clip.name]: url };
                    });
                }
            };

            await Promise.all(Array.from({ length: Math.min(THUMB_READS, pending.length) }, worker));
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

    /*
     * The moving framing: a key at the playhead, and the automatic punch-in.
     *
     * Keys are held in source seconds and in order, so adding one is a matter
     * of finding where it belongs and replacing any key already standing on
     * that frame - setting the same instant twice should move the camera, not
     * add a second one a hundredth of a second later.
     */
    const addFraming = () => {
        const video = videoRef.current;
        if (!segment || !video) return;

        const at = Math.min(segment.to, Math.max(segment.from, video.currentTime));
        const now = framingAt(segment, at);
        const key: ZoomKey = { at, zoom: now.zoom, x: now.x, y: now.y };

        const moves = [...(segment.moves ?? []).filter(m => Math.abs(m.at - at) > 0.02), key]
            .sort((a, b) => a.at - b.at);

        patchSegment(segment.id, { moves });
        toast(`Framing key at ${formatTime(at)}`, Toasts.Type.SUCCESS);
    };

    const clearFraming = () => {
        if (!segment) return;

        patchSegment(segment.id, { moves: [] });
        toast("The framing holds still again", Toasts.Type.SUCCESS);
    };

    const punchMarkers = () => {
        if (!segment || !source) return;

        const marks = meta[source.name]?.markers ?? [];
        const moves = punchIn(segment, marks);

        if (!moves.length) {
            toast("No marker inside this segment", Toasts.Type.FAILURE);
            return;
        }

        patchSegment(segment.id, { moves });
        toast(`Punched in on ${moves.length / 4} moment${moves.length === 4 ? "" : "s"}`, Toasts.Type.SUCCESS);
    };

    /**
     * The decoded sound of a timeline source, kept for the alignment.
     *
     * Lining two angles up reads the whole file, and the same reference is read
     * once per angle added, so the buffers are held rather than decoded again.
     */
    const audioOfRef = useRef(new Map<string, AudioBuffer>());

    const audioOf = async (item: StudioSource): Promise<AudioBuffer> => {
        const held = audioOfRef.current.get(item.id);
        if (held) return held;

        const bytes = await (await fetch(item.url)).arrayBuffer();
        const decoded = await audioContext().decodeAudioData(bytes);

        audioOfRef.current.set(item.id, decoded);
        return decoded;
    };

    /**
     * Pulls one of the clips posted in the channel in beside this shot.
     *
     * The download is the easy half. The hard half is that their buffer started
     * whenever their client felt like it, so the two files are the same moment
     * minutes apart: the sound is what they have in common, and the offset that
     * lines their loudness up with ours is what puts them on the same clock.
     */
    const addAngle = async (angle: PostedAngle) => {
        if (!segment || !source) return;

        setError("");
        setNote(`Downloading ${angle.name}…`);

        let opened: { url: string; bytes: ArrayBuffer; } | null = null;

        try {
            opened = await fetchAngle(angle);
            track({ url: opened.url });

            const range = await probeFile(opened.url);
            if (range.end - range.start <= 0) throw new Error(`"${angle.name}" has nothing to play`);

            const item: StudioSource = {
                id: newId(),
                name: `${angle.author} - ${angle.name}`,
                url: opened.url,
                ...(range.height ? { width: range.width, height: range.height } : {})
            };

            setNote("Lining it up by ear…");

            let offset = 0;

            try {
                const ctx = audioContext();
                const mine = await audioOf(source);
                const theirs = await ctx.decodeAudioData(opened.bytes);
                const lag = alignTo(mine, theirs);

                if (lag === null) toast("Nothing in common to hear - line it up by hand below", Toasts.Type.FAILURE);
                else offset = lag;
            } catch (e) {
                logger.warn("Could not line up an angle by its sound", e);
                toast("Could not read the sound of that angle - line it up by hand below", Toasts.Type.FAILURE);
            }

            setSources(list => [...list, item]);
            patchSegment(segment.id, { angles: [...(segment.angles ?? []), { sourceId: item.id, offset }] });

            toast(`Added ${angle.author}'s angle`, Toasts.Type.SUCCESS);
        } catch (e) {
            if (opened) drop(opened.url);
            logger.warn("Could not add a posted angle", e);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setNote("");
        }
    };

    const nudgeAngle = (index: number, offset: number) => {
        if (!segment) return;

        const angles = (segment.angles ?? []).map((angle, i) => i === index ? { ...angle, offset } : angle);
        patchSegment(segment.id, { angles }, `angle-${segment.id}-${index}`);
    };

    const dropAngle = (index: number) => {
        if (!segment) return;

        const angles = (segment.angles ?? []).filter((unused, i) => i !== index);
        patchSegment(segment.id, { angles });
    };

    /**
     * Turns this shot and its angles into an edit that cuts between them.
     *
     * The angles were pulled in to be played alongside this one, which shows
     * that four people were there rather than showing what happened. This
     * replaces the shot with a run of shots that cut: whoever the moment is
     * happening to while it lands, then somebody watching it, then back.
     *
     * The decision is made on the sound, so every angle has to be decoded -
     * which the alignment has usually done already, and which is held either
     * way. What comes out is ordinary segments, so it can be trimmed by hand
     * afterwards or undone in one step.
     */
    const cutAngles = async () => {
        if (!segment || !source) return;

        const angles = segment.angles ?? [];
        if (!angles.length) return;

        setError("");
        setNote("Listening to the angles…");

        try {
            const base = segment;
            const tracks: AngleTrack[] = [{
                sourceId: source.id,
                offset: 0,
                envelope: envelopeOf(await audioOf(source)),
                hz: ENVELOPE_HZ
            }];

            for (const angle of angles) {
                const item = sources.find(s => s.id === angle.sourceId);
                if (!item) continue;

                tracks.push({
                    sourceId: item.id,
                    offset: angle.offset,
                    envelope: envelopeOf(await audioOf(item)),
                    hz: ENVELOPE_HZ
                });
            }

            const made = cutBetweenAngles(base, tracks, ANGLE_PACES[anglePace]);

            if (made.length < 2) {
                toast("One angle carried the whole shot - there was nothing to cut to", Toasts.Type.MESSAGE);
                return;
            }

            commit(p => {
                const index = p.segments.findIndex(s => s.id === base.id);
                if (index < 0) return p;

                /*
                 * The soundtrack stays on the angle the shot was cut from
                 * rather than following whoever is on screen.
                 *
                 * Every one of these captures has the same call in it, at its
                 * own level and its own few hundred milliseconds of latency, so
                 * an edit that took the sound of each angle in turn would jump
                 * mix and echo on every cut. One sound clip over the whole run
                 * instead, and the pictures cut under it.
                 *
                 * A sound clip has no rate of its own, so it only lines up at
                 * speed 1: a stretched shot keeps the sound of each angle, and
                 * a silent one has nothing to keep.
                 */
                const together = base.speed === 1 && base.volume > 0 && p.audio;

                const segments = [
                    ...p.segments.slice(0, index),
                    ...(together ? made.map(one => ({ ...one, volume: 0 })) : made),
                    ...p.segments.slice(index + 1)
                ];

                if (!together) return { ...p, segments };

                const at = p.segments.slice(0, index).reduce((sum, s) => sum + segmentLength(s), 0);

                const clip: AudioClip = {
                    id: newId(),
                    sourceId: source.id,
                    at,
                    from: base.from,
                    to: base.to,
                    gain: base.volume,
                    fadeIn: base.effects?.fadeIn ?? 0,
                    fadeOut: base.effects?.fadeOut ?? 0,
                    muted: false
                };

                return { ...p, segments, audioClips: [...(p.audioClips ?? []), clip] };
            });

            setSelected(made[0].id);

            toast(`Cut into ${made.length} shots across ${tracks.length} angles`, Toasts.Type.SUCCESS);
        } catch (e) {
            logger.warn("Could not cut between the angles", e);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setNote("");
        }
    };

    /** Turns the whole montage into a 9:16 crop, or back to the wide one. */
    const toggleVertical = () => {
        const before = projectRef.current;
        const vertical = before.width === verticalWidth(before.height);

        if (vertical) {
            commit(p => ({
                ...p,
                width: undefined,
                segments: p.segments.map(segment => segment.fill ? { ...segment, fill: false } : segment)
            }));
            toast("Back to the wide frame", Toasts.Type.SUCCESS);
            return;
        }

        commit(p => reframeVertical(p));
        toast("Cropped to 9:16 - track the action on a shot to follow it", Toasts.Type.SUCCESS);
    };

    /**
     * Walks the selected shot and keys the crop onto whatever is moving.
     *
     * The preview element is what is walked, so it is paused first and put back
     * where it was afterwards: a scrub the user did not ask for that ends
     * somewhere else is worse than the wait.
     */
    const trackSegment = async () => {
        const video = videoRef.current;
        if (!segment || !video) return;

        const live = projectRef.current;
        const width = live.width || live.height * 16 / 9;

        const was = video.currentTime;
        const wasPlaying = !video.paused;

        video.pause();
        setNote("Following the action…");

        try {
            const keys = await trackAction(video, segment, {
                aspect: width / live.height,
                onProgress: done => setNote(`Following the action… ${Math.round(done * 100)}%`)
            });

            if (!keys.length) {
                toast("Nothing to follow: the crop is already the whole picture", Toasts.Type.FAILURE);
                return;
            }

            patchSegment(segment.id, { moves: keys });
            toast(`Tracked ${keys.length} points across the shot`, Toasts.Type.SUCCESS);
        } catch (e) {
            logger.warn("Could not track the action", e);
            toast("Could not read the picture to track it", Toasts.Type.FAILURE);
        } finally {
            setNote("");

            try {
                video.currentTime = was;
                if (wasPlaying) await video.play();
            } catch {
                // The element was swapped out from under the walk; nothing to
                // put back.
            }
        }
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

        /*
         * The mixer's per-person levels travel with the clip.
         *
         * They were set while the buffer was running, which is when the call was
         * still a set of separate tracks and the only moment somebody could be
         * turned down on purpose; this is the first place anything can act on
         * them. Levels already on the timeline win, because those were set here,
         * on this montage, with the clip in front of the person setting them.
         */
        const saved = origin?.kind === "clip" ? meta[origin.name]?.levels : undefined;

        commit(p => ({
            ...p,
            segments: [...p.segments, segment],
            ...(saved ? { voiceLevels: { ...saved, ...p.voiceLevels } } : {})
        }));

        setSelected(segment.id);
    };

    /**
     * Builds a montage out of every marked moment in the clips on show.
     *
     * The search box and the category picker are the selection: whatever is
     * listed is what an evening means, so filtering to one game and pressing
     * this gives the best of that game. Clips without a marker are skipped -
     * nothing in them was ever flagged as worth watching again.
     */
    const buildBestOf = async () => {
        const marked = shown.filter(clip => meta[clip.name]?.markers?.length);
        if (!marked.length) {
            toast("No clip on show carries a marker", Toasts.Type.FAILURE);
            return;
        }

        setError("");

        const opened: StudioSource[] = [];
        const picks: MontagePick[] = [];

        try {
            for (const clip of marked.slice(0, MONTAGE_CLIPS)) {
                setNote(`Reading ${clip.name}…`);

                const source = await openSource({ kind: "clip", name: clip.name });
                const range = await probeFile(source.url);

                // A file this client cannot decode is skipped rather than
                // failing the montage: the rest of the evening still plays.
                if (range.end - range.start <= 0) {
                    drop(source.url);
                    logger.warn(`Skipped ${clip.name} in the montage, nothing to play`);
                    continue;
                }

                const item: StudioSource = {
                    id: newId(),
                    name: clip.name,
                    url: source.url,
                    origin: { kind: "clip", name: clip.name },
                    ...(range.height ? { width: range.width, height: range.height } : {})
                };

                opened.push(item);
                picks.push({ sourceId: item.id, from: range.start, to: range.end, markers: meta[clip.name]!.markers! });
            }
        } catch (e) {
            opened.forEach(item => drop(item.url));
            logger.warn("Could not build the montage", e);
            setError(e instanceof Error ? e.message : String(e));
            setNote("");
            return;
        }

        setNote("");

        const segments = bestOf(picks, { target: montageTarget });
        const used = new Set(segments.map(segment => segment.sourceId));

        // Whatever contributed no moment is closed again rather than left on
        // the timeline as a source nothing points at.
        for (const item of opened) {
            if (!used.has(item.id)) drop(item.url);
        }

        const kept = opened.filter(item => used.has(item.id));

        if (!segments.length) {
            toast("Those markers were too close to the edges to cut", Toasts.Type.FAILURE);
            return;
        }

        setSources(list => [...list, ...kept]);
        commit(p => ({ ...p, segments: [...p.segments, ...segments] }));
        setSelected(segments[0].id);
        setMark(null);

        toast(`Cut ${segments.length} moment${segments.length === 1 ? "" : "s"} out of ${kept.length} clip${kept.length === 1 ? "" : "s"}`, Toasts.Type.SUCCESS);
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
     * Decodes a sound off disk and lays it on the timeline.
     *
     * Split out of the picker so the shelf can use it too: placing a saved
     * sound effect and importing a new one differ only in where the path came
     * from, and two copies of this would drift the moment one of them gained a
     * default.
     */
    /**
     * Lays a decoded sound on the timeline at a point.
     *
     * Takes the loaded file rather than a path, because a sound can arrive two
     * ways: read off disk by the picker, which knows where it lives, or
     * dropped onto the studio, which hands over bytes and a name and no path
     * at all. Everything past the read is the same for both.
     */
    const placeLoadedSound = async (
        file: { name: string; url: string; data: ArrayBuffer; path?: string; },
        at: number
    ) => {
        const { name, url, data, path } = file;

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

    const placeSound = async (path: string, at: number) =>
        placeLoadedSound({ ...track(await loadAudioFile(path)), path }, at);

    /**
     * Decodes a picture off disk and lays it over the timeline.
     *
     * It lands centred, at a third of the frame's width, for three seconds
     * from the playhead. Something visible and obviously draggable beats
     * something correct and invisible: a picture placed at its own pixel size
     * would be either a speck or wider than the frame depending on the file.
     */
    /** The same two ways in as a sound, past the read. */
    const placeLoadedImage = async (file: { name: string; url: string; path?: string; }, at: number) => {
        const { name, url, path } = file;

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

    const placeImage = async (path: string, at: number) =>
        placeLoadedImage({ ...track(await loadImageFile(path)), path }, at);

    /**
     * Adds sounds to the lane, each one landing at the playhead.
     *
     * At the playhead rather than at zero: a sting is placed against something
     * that happens in the montage, and the playhead is where the user was
     * already looking.
     */
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
     * Files dropped onto the studio, sorted by what they are.
     *
     * A drop hands over bytes and a name, never a path: Electron took
     * `File.path` away in its 32nd version and the client runs a later one, so
     * there is nothing to give the native reader. Everything the plugin does
     * with a sound or a picture is done from the bytes anyway, so the only
     * thing lost is the path - which is what the shelf remembers files by, and
     * what a saved timeline finds them again by. Hence the note: a dropped
     * file is here for as long as the studio is open, and the picker is what
     * keeps one.
     *
     * The size caps are the native reader's own, repeated here because a drop
     * never goes through it and a dropped four-gigabyte recording would be
     * read into the renderer before anything noticed.
     */
    const onDropFiles = async (files: File[]) => {
        setError("");

        const at = projectTime();
        const refused: string[] = [];
        let pathless = 0;
        let placed = 0;

        setNote("Reading…");

        try {
            for (const file of files) {
                const { name } = file;

                // A .webm is either a picture or a video depending on what is
                // in it, and the name cannot say which. It goes in as a source,
                // which is the reading that loses nothing: an overlay can be
                // laid down from the pictures tab afterwards.
                const kind = DROP_VIDEO.test(name) ? "video"
                    : DROP_SOUND.test(name) ? "sound"
                        : DROP_IMAGE.test(name) ? "image"
                            : null;

                if (!kind) {
                    refused.push(`${name} is not a video, a sound or a picture`);
                    continue;
                }

                const cap = kind === "sound" ? DROP_SOUND_BYTES : DROP_VIDEO_BYTES;
                if (kind !== "image" && file.size > cap) {
                    refused.push(`${name} is ${Math.round(file.size / (1024 * 1024))} MB, over the ${Math.round(cap / (1024 * 1024))} MB cap`);
                    continue;
                }

                const { url } = track({ url: URL.createObjectURL(file) });

                try {
                    if (kind === "video") await addSource(name, url);
                    else if (kind === "sound") await placeLoadedSound({ name, url, data: await file.arrayBuffer() }, at);
                    else await placeLoadedImage({ name, url }, at);

                    pathless++;
                    placed++;
                } catch (e) {
                    // `addSource` revokes what it could not use; the other two
                    // leave the URL to the ledger, which the modal empties.
                    logger.warn("Could not take a dropped file", e);
                    refused.push(e instanceof Error ? e.message : String(e));
                }
            }

            if (placed) setTab(DROP_SOUND.test(files[0]?.name ?? "") ? "audio" : DROP_IMAGE.test(files[0]?.name ?? "") ? "images" : "segment");
            if (refused.length) setError(refused.join("; "));

            if (pathless) {
                toast(
                    `${pathless} dropped file${pathless === 1 ? "" : "s"} added for this session - use the Add buttons to keep ${pathless === 1 ? "it" : "them"} across reopenings`,
                    Toasts.Type.MESSAGE
                );
            }
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

    /*
     * Copying a sound, and pasting it as many times as it takes.
     *
     * A sting that punctuates a montage is placed a dozen times, and every one
     * of those placements is the same block with the same trim, the same gain
     * and the same fades - re-importing the file and re-dialling all of that is
     * the tedium this removes. What is held is the block, not the file: the
     * decoded source stays where it is and the copies all point at it, so a
     * hundred placements cost a hundred small objects rather than a hundred
     * decodes.
     */
    // State rather than a ref, because the Paste buttons are disabled until
    // there is something to paste and a ref would not re-render them into life.
    const [clipboard, setClipboard] = useState<
        | { kind: "sound"; clip: AudioClip; }
        | { kind: "overlay"; overlay: Overlay; }
        | { kind: "caption"; caption: Caption; }
        | { kind: "segment"; segment: Segment; }
        | null
    >(null);

    /**
     * Where the last paste of the current run landed, so the next one follows it.
     *
     * Pasting repeatedly at one playhead would otherwise stack every copy on the
     * same frame and sound like a single louder hit. Each paste in a run butts
     * against the end of the one before instead, which is what laying a sound
     * down several times in a row is for. Moving the playhead starts a new run,
     * so a paste always lands where it was asked for.
     */
    const pasteRun = useRef<{ head: number; end: number; } | null>(null);

    const copySound = (id: string): boolean => {
        const clip = (project.audioClips ?? []).find(c => c.id === id);
        if (!clip) return false;

        setClipboard({ kind: "sound", clip });
        pasteRun.current = null;
        return true;
    };

    const copyOverlay = (id: string): boolean => {
        const overlay = (project.overlays ?? []).find(o => o.id === id);
        if (!overlay) return false;

        setClipboard({ kind: "overlay", overlay });
        pasteRun.current = null;
        return true;
    };

    const copyCaption = (id: string): boolean => {
        const caption = project.captions.find(c => c.id === id);
        if (!caption) return false;

        setClipboard({ kind: "caption", caption });
        pasteRun.current = null;
        return true;
    };

    const copySegment = (id: string): boolean => {
        const segment = project.segments.find(s => s.id === id);
        if (!segment) return false;

        setClipboard({ kind: "segment", segment });
        pasteRun.current = null;
        return true;
    };

    /**
     * Where the copy in hand should land, given how long it is.
     *
     * The playhead, unless the last paste of this run was asked for at the same
     * playhead - then it goes after that one. Kept in one place so a sound and
     * a picture behave the same way under a held Ctrl+V.
     */
    const pasteAt = (length: number): number => {
        const head = projectTime();
        const run = pasteRun.current;
        const at = run && Math.abs(run.head - head) < 0.001 ? run.end : head;

        pasteRun.current = { head, end: at + length };
        return at;
    };

    const pasteSound = (): boolean => {
        // The source is dropped when the modal closes, and a copy that outlived
        // it would be a clip pointing at nothing: silent, undeletable from the
        // lane's own controls, and rendered as a gap.
        if (clipboard?.kind !== "sound" || !soundsById.has(clipboard.clip.sourceId)) return false;

        const clip: AudioClip = { ...clipboard.clip, id: newId(), at: pasteAt(clipLengthOf(clipboard.clip)) };

        commit(p => ({ ...p, audioClips: [...(p.audioClips ?? []), clip] }));
        setPickedSound(clip.id);
        return true;
    };

    const pasteOverlay = (): boolean => {
        if (clipboard?.kind !== "overlay" || !imagesById.has(clipboard.overlay.sourceId)) return false;

        const copied = clipboard.overlay;
        const span = Math.max(0.2, copied.to - copied.from);

        // Held back from the end of the montage: a picture laid down with the
        // playhead parked on the last frame would show over nothing at all,
        // and an invisible copy is one nobody thinks to go and delete.
        const from = Math.min(pasteAt(span), Math.max(0, total - span));

        const overlay: Overlay = { ...copied, id: newId(), from, to: from + span };

        commit(p => ({ ...p, overlays: [...(p.overlays ?? []), overlay] }));
        setPickedOverlay(overlay.id);
        return true;
    };

    const pasteCaption = (): boolean => {
        if (clipboard?.kind !== "caption") return false;

        const copied = clipboard.caption;
        const span = Math.max(0.2, copied.to - copied.from);
        const from = Math.min(pasteAt(span), Math.max(0, total - span));

        const caption: Caption = { ...copied, id: newId(), from, to: from + span };

        commit(p => ({ ...p, captions: [...p.captions, caption] }));
        setPickedCaption(caption.id);
        return true;
    };

    /**
     * Puts a copy of a shot after the one that is selected.
     *
     * A segment has no placement of its own - the montage is the order of the
     * list - so this is the one paste the playhead has nothing to say about,
     * and a run of them stacks up after the selection rather than after each
     * other's end.
     */
    const pasteSegment = (): boolean => {
        if (clipboard?.kind !== "segment") return false;

        const copy: Segment = { ...clipboard.segment, id: newId(), effects: { ...clipboard.segment.effects } };

        commit(p => {
            const index = p.segments.findIndex(s => s.id === selected);
            const segments = [...p.segments];

            segments.splice(index < 0 ? segments.length : index + 1, 0, copy);
            return { ...p, segments };
        });

        setSelected(copy.id);
        return true;
    };

    /**
     * Puts a sound down on the nearest seam of the montage.
     *
     * A sting is placed against a cut far more often than against a moment in
     * the middle of a shot, and the lane is a few hundred pixels wide for the
     * whole montage, so hitting a seam by dragging is aim rather than editing.
     * The end of the montage counts as a seam: a sound that plays out over the
     * last frame is a normal way to finish.
     */
    const snapSoundToCut = (clip: AudioClip) => {
        const seams = project.segments.map((_, i) => segmentStart(project, i));
        seams.push(total);

        const nearest = seams.reduce((best, at) => Math.abs(at - clip.at) < Math.abs(best - clip.at) ? at : best, seams[0] ?? 0);

        if (Math.abs(nearest - clip.at) < 0.001) {
            toast("It already starts on a cut", Toasts.Type.FAILURE);
            return;
        }

        patchSound(clip.id, { at: nearest });
        toast(`Moved it to ${formatTime(nearest)}`, Toasts.Type.SUCCESS);
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
    /*
     * Takes every stretch nobody talks over out of the montage at once.
     *
     * The lanes are per clip, so an imported file with none is passed over
     * rather than cut to nothing - which is also why this says how much it
     * found: a montage that comes back the same length is one whose sources
     * never carried the activity, not one with no dead air in it.
     */
    const trimSilence = () => {
        const before = projectRef.current;
        if (!before.segments.length) {
            toast("Nothing on the timeline yet", Toasts.Type.FAILURE);
            return;
        }

        const { project: next, removed, ranges } = cutSilence(before, sourcesRef.current);

        if (next === before || !ranges) {
            toast("Found no dead air to cut", Toasts.Type.FAILURE);
            return;
        }

        commit(() => next);
        setMark(null);
        setSelected(current => next.segments.some(s => s.id === current) ? current : next.segments[0].id);

        toast(`Cut ${formatTime(removed)} of silence over ${ranges} place${ranges === 1 ? "" : "s"}`, Toasts.Type.SUCCESS);
    };

    /**
     * Beats of a sound, kept per source.
     *
     * The detection walks the whole decoded buffer, which is slow enough on a
     * long track to be worth doing once rather than on every click.
     */
    const beatsRef = useRef(new Map<string, number[]>());

    const beatsFor = (sound: AudioSource): number[] => {
        const held = beatsRef.current.get(sound.id);
        if (held) return held;

        const found = beatsOf(sound.buffer);
        beatsRef.current.set(sound.id, found);
        return found;
    };

    /** Pull every cut onto the nearest beat of the picked sound. */
    const snapCuts = (clip: AudioClip) => {
        const sound = soundsById.get(clip.sourceId);
        if (!sound) {
            toast("That sound is missing", Toasts.Type.FAILURE);
            return;
        }

        const beats = beatsFor(sound);
        if (!beats.length) {
            toast("Found no beat in that sound", Toasts.Type.FAILURE);
            return;
        }

        const before = projectRef.current;
        const { project: next, moved } = snapToBeats(before, clip, beats);

        if (next === before || !moved) {
            toast("Every cut already sits on a beat", Toasts.Type.FAILURE);
            return;
        }

        commit(() => next);
        setMark(null);

        toast(`Snapped ${moved} cut${moved === 1 ? "" : "s"} to the beat`, Toasts.Type.SUCCESS);
    };

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

        /*
         * What the last painted frame was of.
         *
         * A paused preview is the same picture sixty times a second, and
         * painting it is a full pass of the effects, the captions and the
         * overlays. It is skipped while nothing that shows has moved: the
         * playhead, an edit to the montage, a resize of the canvas. Four times
         * a second it paints anyway, so an overlay image or an avatar that
         * finished loading appears without waiting for the next click.
         */
        let paintedAt = 0;
        let paintedTime = -1;
        let paintedProject: unknown = null;
        let paintedWidth = -1;
        let paintedHeight = -1;

        const paint = () => {
            frame = requestAnimationFrame(paint);

            const video = videoRef.current;
            const { width } = canvas;
            const { height } = canvas;

            const live = projectRef.current;
            const voices = lanesRef.current;

            const now = performance.now();
            const at = video?.currentTime ?? -1;
            const still = video?.paused !== false
                && at === paintedTime
                && live === paintedProject
                && width === paintedWidth
                && height === paintedHeight
                && now - paintedAt < 250;

            if (!still) {
                paintedAt = now;
                paintedTime = at;
                paintedProject = live;
                paintedWidth = width;
                paintedHeight = height;

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
                        showSpeakers: live.showSpeakers !== false,
                        ...(live.showChat === true ? { chat: chatRef.current } : {})
                    }
                    : null;

                paintFrame(ctx, video ?? null, width, height, shown);
            }

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

            /*
             * The duck is built over what is actually going to be heard rather
             * than over the hour the preview asks for: the curve is a sample
             * per fifth of a second, and an hour of them for a montage that
             * runs four minutes is work nobody hears.
             */
            const until = Math.min(from + 3600, projectLength(live));

            stopSoundsRef.current = scheduleClips(
                ctx, ctx.destination, clips, sources, ctx.currentTime, from, from + 3600, projectEnding(live),
                speechDuck(live, sourcesRef.current, from, until)
            );
        };

        const unfollow = followPlayback(video, start, stop);

        return () => {
            stop();
            unfollow();
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

            /*
             * A buffer source has no `preservesPitch`, so a segment that asks
             * for its pitch to be kept gets a buffer stretched to the speed
             * instead - the same thing the render does, so the preview and the
             * file agree.
             */
            const speed = Math.min(4, Math.max(0.25, segment.speed || 1));
            const buffer = segment.pitch !== false ? stretchToRate(ctx, voiceMix.buffer, speed) : voiceMix.buffer;
            const kept = buffer !== voiceMix.buffer;

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = kept ? 1 : speed;
            source.connect(band.input);
            source.start(ctx.currentTime, Math.max(0, kept ? video.currentTime / speed : video.currentTime));

            voiceNodesRef.current = { source, gain, band };
        };

        if (!video.paused) start();

        const unfollow = followPlayback(video, start, stop);

        return () => {
            stop();

            // The element was left silent for the mix; anything else playing it
            // afterwards would be a preview with no sound at all.
            if (video.volume === 0) video.volume = 1;

            unfollow();
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

    /**
     * Repeats a caption after itself, with its wording and its length kept.
     *
     * Two lines of the same joke on either side of a cut is typed once here
     * rather than twice, and the copy lands after the original so it is not
     * hidden underneath it.
     */
    const duplicateCaption = (caption: Caption) => {
        const span = Math.max(0.2, caption.to - caption.from);
        const from = Math.min(Math.max(0, total - span), caption.to);

        commit(p => ({ ...p, captions: [...p.captions, { ...caption, id: newId(), from, to: from + span }] }));
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
            if (video.currentTime < segment.to) return;

            if (loop) video.currentTime = segment.from;
            else video.pause();
        };

        video.addEventListener("timeupdate", stop);
        return () => video.removeEventListener("timeupdate", stop);
    }, [selected, segment?.from, segment?.to, loop]);

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

    /**
     * Copies whatever the open tab is about.
     *
     * The tab is the question the user is answering, so it decides: a sound
     * picked in the sound tab stays picked while the picture tab is open, and
     * a Ctrl+C there has to mean the picture. Answers false when that tab has
     * nothing picked, which leaves the keystroke to the client.
     */
    const copyPicked = (): boolean => {
        if (tab === "segment") return !!selected && copySegment(selected);
        if (tab === "captions") return !!pickedCaption && copyCaption(pickedCaption);
        if (tab === "audio") return !!pickedSound && copySound(pickedSound);
        if (tab === "images") return !!pickedOverlay && copyOverlay(pickedOverlay);
        return false;
    };

    /** Lays down what is in hand, whatever tab it was taken from. */
    const pastePicked = (): boolean => {
        switch (clipboard?.kind) {
            case "segment": return pasteSegment();
            case "caption": return pasteCaption();
            case "overlay": return pasteOverlay();
            case "sound": return pasteSound();
            default: return false;
        }
    };

    /**
     * Moves whatever is picked in the caption, sound or picture tab along the
     * montage.
     *
     * Answers whether it took the key. When those tabs have nothing picked, and
     * on every other tab, the arrows stay what they have always been: a scrub
     * of the preview, which is what the hands reach for while trimming. The
     * segment tab is deliberately not among them: a shot has no placement to
     * nudge, only an order, and that is what the move buttons are for.
     *
     * Every step is tagged, so a held arrow folds into one undo entry the way a
     * dragged slider does. Untagged, the key repeat would push about thirty
     * entries a second and a second of holding would push every earlier edit
     * out of the forty the history keeps.
     */
    const nudgePicked = (by: number): boolean => {
        if (tab === "captions" && pickedCaption) {
            const caption = project.captions.find(c => c.id === pickedCaption);
            if (!caption) return false;

            const span = caption.to - caption.from;
            const from = Math.max(0, Math.min(Math.max(0, total - span), caption.from + by));

            commit(
                p => ({ ...p, captions: p.captions.map(c => c.id === caption.id ? { ...c, from, to: from + span } : c) }),
                `nudge-${caption.id}`
            );
            return true;
        }

        if (tab === "audio" && pickedSound) {
            const clip = (project.audioClips ?? []).find(c => c.id === pickedSound);
            if (!clip) return false;

            patchSound(clip.id, { at: Math.max(0, Math.min(total, clip.at + by)) }, `nudge-${clip.id}`);
            return true;
        }

        if (tab === "images" && pickedOverlay) {
            const overlay = (project.overlays ?? []).find(o => o.id === pickedOverlay);
            if (!overlay) return false;

            // Both ends move together, so a nudge slides the picture rather
            // than stretching it, and it stops at the ends of the montage
            // instead of sliding off into a stretch that never shows.
            const span = overlay.to - overlay.from;
            const from = Math.max(0, Math.min(Math.max(0, total - span), overlay.from + by));

            patchOverlay(overlay.id, { from, to: from + span }, `nudge-${overlay.id}`);
            return true;
        }

        return false;
    };

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
            // Only with something picked in the tab that is open, and only when
            // there is something to paste: an unhandled Ctrl+C has to stay the
            // client's, or selecting text in the studio and copying it would
            // come back empty.
            else if (key === "c") { if (!copyPicked()) return; }
            else if (key === "v") { if (!pastePicked()) return; }
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
                if (nudgePicked(-(e.shiftKey ? 1 : 0.1))) break;
                if (!video) return;
                video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 1 : 0.1));
                break;
            case "arrowright":
                if (nudgePicked(e.shiftKey ? 1 : 0.1)) break;
                if (!video) return;
                video.currentTime += e.shiftKey ? 1 : 0.1;
                break;
            case "l": setLoop(on => !on); break;
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

        // A moving framing, a crop and a second angle are all painted, and the
        // chat is text that exists nowhere in the file.
        if (only.moves?.length || only.fill || only.angles?.length) return false;
        if (project.showChat === true) return false;

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

        // The shape as well: a montage reframed for a phone is a crop of this
        // file, not this file.
        if (project.width && project.width !== (from.width || (await probeFile(from.url)).width)) return null;

        const type = typeOfClip(from.name);
        const whole = new Uint8Array(await (await fetch(from.url)).arrayBuffer());
        const cut = trimBytes(whole, type, only.from, only.to);

        // Nothing back: the parser found nothing to remove, which for a segment
        // that starts at zero and runs to the end is the right answer.
        return { blob: new Blob([(cut ?? whole) as BlobPart], { type }), name: from.name };
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
        if (await sendClipFitted(name)) onClose();
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

    /** True while the drag carries files rather than, say, a Discord message. */
    const dragHasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    return (
        <div className="vc-clipper-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div
                className={`vc-clipper-modal vc-clipper-studio${dragging ? " vc-clipper-dropping" : ""}`}
                onDragEnter={e => { if (!busy && dragHasFiles(e)) { e.preventDefault(); setDragging(n => n + 1); } }}
                onDragLeave={e => { if (dragHasFiles(e)) setDragging(n => Math.max(0, n - 1)); }}
                // Both the over and the drop have to be taken, or the client
                // handles the drop itself and the file is uploaded to whatever
                // channel is open behind the studio.
                onDragOver={e => { if (!busy && dragHasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
                onDrop={e => {
                    if (!dragHasFiles(e)) return;

                    e.preventDefault();
                    e.stopPropagation();
                    setDragging(0);

                    const files = Array.from(e.dataTransfer.files);
                    if (!busy && files.length) void onDropFiles(files);
                }}
            >
                {!!dragging && (
                    <div className="vc-clipper-drop-veil">
                        <div>
                            <b>Drop it here</b>
                            <small>Videos join the timeline, sounds and pictures land at the playhead</small>
                        </div>
                    </div>
                )}
                <div className="vc-clipper-head">
                    <div>
                        <h2>Clip studio</h2>
                    </div>
                    <button className="vc-clipper-close" onClick={onClose} disabled={busy} aria-label="Close">×</button>
                </div>

                <div className="vc-clipper-studio-body">
                    <div className="vc-clipper-side vc-clipper-side-left">
                        <h4>Clip library</h4>

                        <button className="vc-clipper-side-clip vc-clipper-add" disabled={busy} onClick={() => void onImport()}>
                            Import a video…
                        </button>

                        <button
                            className="vc-clipper-side-clip vc-clipper-add"
                            disabled={busy || !shown.some(clip => meta[clip.name]?.markers?.length)}
                            title="Cut every marked moment out of the clips listed below into one montage"
                            onClick={() => void buildBestOf()}
                        >
                            Best of the evening…
                        </button>

                        <div className="vc-clipper-field">
                            <label>
                                <span>Montage length</span>
                                <b>{formatTime(montageTarget)}</b>
                            </label>
                            <input
                                type="range"
                                min={30}
                                max={600}
                                step={15}
                                value={montageTarget}
                                disabled={busy}
                                onChange={e => setMontageTarget(Number(e.currentTarget.value))}
                            />
                        </div>

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
                                    <button
                                        className="vc-clipper-primary"
                                        disabled={busy}
                                        title="Put this clip at the end of the timeline"
                                        onClick={() => void onAddClip(picked)}
                                    >
                                        Add
                                    </button>
                                    <button disabled={busy} title="Attach it to the channel behind the studio" onClick={() => void onSend(picked)}>
                                        Send
                                    </button>
                                    <button disabled={busy} title="Show the file in the folder" onClick={() => void revealClip(picked)}>
                                        Folder
                                    </button>
                                    {/\.webm$/i.test(picked) && (
                                        <button
                                            disabled={busy}
                                            title="Discord's player gives no sound on WebM; this re-encodes the clip so it plays in chat"
                                            onClick={() => void onConvert(picked)}
                                        >
                                            To MP4
                                        </button>
                                    )}
                                    <button disabled={busy} title="Rename the file" onClick={() => setRenaming(picked)}>Rename</button>
                                    <button
                                        className={confirmDelete ? "vc-clipper-danger" : ""}
                                        disabled={busy}
                                        title="Delete the file from the folder"
                                        onClick={() => void onDeleteClip()}
                                    >
                                        {confirmDelete ? "Sure?" : "Delete"}
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
                                    <button disabled={busy || !tagging.trim()} onClick={() => void applyCategory(tagging)}>File</button>
                                    <button
                                        disabled={busy || categoryOf(picked) === UNCATEGORISED}
                                        title="Take it out of its category"
                                        onClick={() => void applyCategory("")}
                                    >
                                        Unfile
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
                                {playing ? "❚❚" : "▶"}
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

                            <span className="vc-clipper-time" title="In the segment / segment length - position in the montage">
                                <b>{formatTime(Math.max(0, playhead.at - (segment?.from ?? 0)))}</b>
                                {" / "}{formatTime(segment ? segmentLength(segment) * segment.speed : 0)}
                                {" · "}{formatTime(projectAt)}
                            </span>
                        </div>

                        {/*
                          * One card, four rows: what is being cut, what is on
                          * the timeline, what is under it. Four widgets stacked
                          * with a gap between them read as four tools; sharing a
                          * background and a label gutter, they read as one.
                          */}
                        <div className="vc-clipper-tracks">
                            <div className="vc-clipper-track">
                                <span className="vc-clipper-track-label">Cut</span>

                                <div className="vc-clipper-track-body">
                                    <CutRuler
                                        segments={project.segments}
                                        names={rulerNames}
                                        markers={rulerMarkers}
                                        length={total}
                                        playhead={projectAt}
                                        mark={mark}
                                        selected={selected}
                                        disabled={busy}
                                        onMark={setMark}
                                        onSeek={seekProject}
                                        onSelect={id => { setSelected(id); setTab("segment"); }}
                                    />
                                </div>

                                {project.segments.length > 0 && (
                                    <div className="vc-clipper-ruler-actions">
                                        {!!mark && (
                                            <span className="vc-clipper-mark-badge">
                                                {formatTime(mark.from)}-{formatTime(mark.to)}
                                            </span>
                                        )}

                                        <button disabled={busy} onClick={markIn} title="Mark the start of a range (I)">In</button>
                                        <button disabled={busy} onClick={markOut} title="Mark the end of a range (O)">Out</button>
                                        <button
                                            className="vc-clipper-danger"
                                            disabled={busy || !mark}
                                            onClick={() => cutMarked(false)}
                                            title="Cut the marked range out (X)"
                                        >
                                            Cut
                                        </button>
                                        <button disabled={busy || !mark} onClick={() => cutMarked(true)} title="Throw away everything else (Shift+X)">
                                            Keep
                                        </button>
                                        <button disabled={busy || !mark} onClick={() => setMark(null)} title="Drop the mark">Clear</button>
                                        <button
                                            disabled={busy}
                                            onClick={trimSilence}
                                            title="Cut every stretch nobody is talking over, using the clip's own voice lanes"
                                        >
                                            Trim silence
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="vc-clipper-track">
                                <span className="vc-clipper-track-label">Clips</span>

                                <div className="vc-clipper-track-body">
                                    <div className="vc-clipper-timeline">
                                        {!project.segments.length && (
                                            <span className="vc-clipper-track-empty">Pick a clip on the left to start</span>
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
                                </div>
                            </div>

                            {audioClips.length > 0 && (
                                <div className="vc-clipper-track">
                                    <span className="vc-clipper-track-label">Sound</span>

                                    <div className="vc-clipper-track-body">
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
                                    </div>
                                </div>
                            )}

                            {!!segment && lanes.length > 0 && (
                                <div className="vc-clipper-track">
                                    <span className="vc-clipper-track-label">Voices</span>

                                    <div className="vc-clipper-track-body">
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
                                    </div>
                                </div>
                            )}
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

                            <button disabled={busy || !depth.past} onClick={undo} title="Undo (Ctrl+Z)">Undo</button>
                            <button disabled={busy || !depth.future} onClick={redo} title="Redo (Ctrl+Shift+Z)">Redo</button>
                            <button
                                className="vc-clipper-danger"
                                disabled={busy || !project.segments.length}
                                title="Empty the timeline and start over"
                                onClick={clearProject}
                            >
                                New
                            </button>

                            <span className="vc-clipper-meta" title="Segments, captions and the size the render should land at. It runs in real time.">
                                {project.segments.length} seg · {project.captions.length} cap · ~{formatBytes(estimatedSize(project))}
                            </span>
                        </div>
                    </div>

                    <div className="vc-clipper-side">
                        <div className="vc-clipper-tabs">
                            <div className="vc-clipper-tab-strip">
                                <button className={tab === "segment" ? "vc-clipper-active" : ""} onClick={() => setTab("segment")}>Segment</button>
                                <button className={tab === "captions" ? "vc-clipper-active" : ""} onClick={() => setTab("captions")}>Captions</button>
                                <button className={tab === "audio" ? "vc-clipper-active" : ""} onClick={() => setTab("audio")}>Audio</button>
                                <button className={tab === "images" ? "vc-clipper-active" : ""} onClick={() => setTab("images")}>Images</button>
                                <button className={tab === "output" ? "vc-clipper-active" : ""} onClick={() => setTab("output")}>Output</button>
                            </div>
                        </div>

                        {tab === "segment" && !segment && <div className="vc-clipper-note">Pick a segment on the timeline.</div>}

                        {tab === "segment" && segment && (
                            <>
                                <h4>{source?.name ?? "Segment"}</h4>

                                <Group title="Trim" note={formatTime(segmentLength(segment))} start>
                                    <div className="vc-clipper-field">
                                        <label><span>Start</span><span>{formatTime(segment.from)}</span></label>
                                        <div className="vc-clipper-row">
                                            <button
                                                disabled={busy}
                                                title="Start the segment at the playhead"
                                                onClick={() => patchSegment(segment.id, { from: Math.min(videoRef.current?.currentTime ?? 0, segment.to - 0.2) })}
                                            >
                                                Here
                                            </button>
                                            <button disabled={busy} onClick={() => patchSegment(segment.id, { from: Math.max(0, segment.from - 0.5) })}>-0.5</button>
                                            <button disabled={busy} onClick={() => patchSegment(segment.id, { from: Math.min(segment.to - 0.2, segment.from + 0.5) })}>+0.5</button>
                                        </div>
                                    </div>

                                    <div className="vc-clipper-field">
                                        <label><span>End</span><span>{formatTime(segment.to)}</span></label>
                                        <div className="vc-clipper-row">
                                            <button
                                                disabled={busy}
                                                title="End the segment at the playhead"
                                                onClick={() => patchSegment(segment.id, { to: Math.max(videoRef.current?.currentTime ?? 0, segment.from + 0.2) })}
                                            >
                                                Here
                                            </button>
                                            <button disabled={busy} onClick={() => patchSegment(segment.id, { to: Math.max(segment.from + 0.2, segment.to - 0.5) })}>-0.5</button>
                                            <button disabled={busy} onClick={() => patchSegment(segment.id, { to: segment.to + 0.5 })}>+0.5</button>
                                        </div>
                                    </div>

                                    {!!source && !!meta[source.name]?.markers?.length && (
                                        <div className="vc-clipper-field">
                                            <label>
                                                <span>Markers</span>
                                                <span title="Click a marker to jump there, shift-click to start the segment there">click, shift to cut</span>
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
                                </Group>

                                <Group title="Speed and sound" note={`${segment.speed}x · ${Math.round(segment.volume * 100)}%`} start>
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
                                </Group>

                                <Group title="Look">
                                    {slider("Brightness", segment.effects.brightness, 20, 200, 5, v => patchEffects(segment.id, { brightness: v }, "brightness"), "%")}
                                    {slider("Contrast", segment.effects.contrast, 20, 200, 5, v => patchEffects(segment.id, { contrast: v }, "contrast"), "%")}
                                    {slider("Saturation", segment.effects.saturate, 0, 300, 5, v => patchEffects(segment.id, { saturate: v }, "saturate"), "%")}
                                    {slider("Black and white", segment.effects.grayscale, 0, 100, 5, v => patchEffects(segment.id, { grayscale: v }, "grayscale"), "%")}
                                    {slider("Blur", segment.effects.blur, 0, 20, 1, v => patchEffects(segment.id, { blur: v }, "blur"), "px")}
                                    {slider("Zoom", segment.effects.zoom, 1, 3, 0.05, v => patchEffects(segment.id, { zoom: v }, "zoom"), "x")}

                                    {(segment.effects.zoom > 1 || !!segment.moves?.length) && (
                                        <>
                                            {slider("Frame across", segment.effects.zoomX ?? 0.5, 0, 1, 0.02, v => patchEffects(segment.id, { zoomX: v }, "zoomX"))}
                                            {slider("Frame down", segment.effects.zoomY ?? 0.5, 0, 1, 0.02, v => patchEffects(segment.id, { zoomY: v }, "zoomY"))}
                                        </>
                                    )}

                                    <div className="vc-clipper-field">
                                        <label>
                                            <span>Moving framing</span>
                                            <span>{segment.moves?.length ? `${segment.moves.length} keys` : "held still"}</span>
                                        </label>
                                        <div className="vc-clipper-row">
                                            <button
                                                disabled={busy}
                                                title="Hold the framing that is on screen right now at this frame"
                                                onClick={addFraming}
                                            >
                                                Key here
                                            </button>
                                            <button
                                                disabled={busy || !meta[source?.name ?? ""]?.markers?.length}
                                                title="Push in on every marker in this segment, and pull back out after it"
                                                onClick={punchMarkers}
                                            >
                                                Punch in on markers
                                            </button>
                                            <button
                                                disabled={busy}
                                                title="Walk this shot and key the crop onto whatever is moving"
                                                onClick={() => void trackSegment()}
                                            >
                                                Track the action
                                            </button>
                                            <button disabled={busy || !segment.moves?.length} onClick={clearFraming} title="Back to one framing for the whole segment">
                                                Hold still
                                            </button>
                                        </div>
                                        <small>
                                            Two keys or more and the crop travels between them, eased in and out. Set
                                            the zoom and the frame above, then key the frames it should be on.
                                        </small>
                                    </div>

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
                                </Group>

                                <Group title="Fades">
                                    {slider("Fade in", segment.effects.fadeIn, 0, 3, 0.1, v => patchEffects(segment.id, { fadeIn: v }, "fadeIn"), "s")}
                                    {slider("Fade out", segment.effects.fadeOut, 0, 3, 0.1, v => patchEffects(segment.id, { fadeOut: v }, "fadeOut"), "s")}

                                    {segmentIndex > 0 && (
                                        <>
                                            {slider("Dissolve from the last shot", segment.transition ?? 0, 0, 1.5, 0.1, v => patchSegment(segment.id, { transition: v }, "transition"), "s")}
                                            <small className="vc-clipper-note">
                                                The frame the previous segment ended on fades out over the opening of
                                                this one. Zero cuts straight in. Shown in the render, not in the
                                                preview, which plays one segment at a time.
                                            </small>
                                        </>
                                    )}
                                </Group>

                                <Group title="Angles">
                                    <div className="vc-clipper-field">
                                        <label>
                                            <span>Everybody else's view</span>
                                            <span>{segment.angles?.length ? `${segment.angles.length} alongside` : "this shot alone"}</span>
                                        </label>
                                        <div className="vc-clipper-row">
                                            <button
                                                disabled={busy}
                                                title="Look through the channel for the clips the others posted"
                                                onClick={() => setPosted(postedAngles())}
                                            >
                                                Look in the chat
                                            </button>
                                            {!!segment.angles?.length && (
                                                <select
                                                    value={segment.layout ?? "grid"}
                                                    disabled={busy}
                                                    onChange={e => patchSegment(segment.id, { layout: e.currentTarget.value as AngleLayout })}
                                                >
                                                    <option value="grid">Side by side</option>
                                                    <option value="pip">Small, in the corner</option>
                                                </select>
                                            )}
                                        </div>
                                        <small>
                                            The clips the others dropped in the channel, played alongside this one and
                                            lined up by their sound. Silent: this shot keeps the soundtrack. Shown in
                                            the render, not in the preview, which plays one file at a time.
                                        </small>
                                    </div>

                                    {!!segment.angles?.length && (
                                        <div className="vc-clipper-field">
                                            <label>
                                                <span>Cut between them instead</span>
                                                <span>{segment.angles.length + 1} angles</span>
                                            </label>
                                            <div className="vc-clipper-row">
                                                <button
                                                    className="vc-clipper-primary"
                                                    disabled={busy}
                                                    title="Replace this shot with an edit that cuts from angle to angle"
                                                    onClick={() => void cutAngles()}
                                                >
                                                    Make the edit
                                                </button>
                                                <select value={anglePace} disabled={busy} onChange={e => setAnglePace(e.currentTarget.value)}>
                                                    <option value="fast">Fast - about a second a shot</option>
                                                    <option value="normal">Normal</option>
                                                    <option value="slow">Slow - let a shot play</option>
                                                </select>
                                            </div>
                                            <small>
                                                Whoever the moment is happening to is the loudest angle of it, so that is
                                                who the edit stays on - and after their peak it cuts to somebody watching
                                                rather than back to them. This shot becomes several, each one an ordinary
                                                segment: trim them, drop one, or undo the whole thing in one step. The
                                                sound stays on this angle throughout, and the list of angles goes with the
                                                shot that held it.
                                            </small>
                                        </div>
                                    )}

                                    {posted !== null && !posted.length && (
                                        <div className="vc-clipper-note">
                                            No video posted in the channel this client has loaded. Scroll the chat back
                                            to the clips and look again.
                                        </div>
                                    )}

                                    {!!posted?.length && (
                                        <div className="vc-clipper-row vc-clipper-markers">
                                            {posted.map(angle => (
                                                <button
                                                    key={angle.id}
                                                    disabled={busy}
                                                    title={`${angle.name} - ${new Date(angle.sentAt).toLocaleString()}`}
                                                    onClick={() => void addAngle(angle)}
                                                >
                                                    {angle.author}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {(segment.angles ?? []).map((angle, i) => {
                                        const from = sources.find(item => item.id === angle.sourceId);

                                        return (
                                            <div className="vc-clipper-field" key={`${angle.sourceId}-${i}`}>
                                                <label>
                                                    <span title={from?.name}>{from?.name ?? "missing angle"}</span>
                                                    <b>{angle.offset >= 0 ? "+" : ""}{angle.offset.toFixed(2)}s</b>
                                                </label>
                                                <input
                                                    type="range"
                                                    min={angle.offset - 5}
                                                    max={angle.offset + 5}
                                                    step={0.05}
                                                    value={angle.offset}
                                                    disabled={busy}
                                                    onChange={e => nudgeAngle(i, Number(e.currentTarget.value))}
                                                />
                                                <div className="vc-clipper-row">
                                                    <button disabled={busy} onClick={() => nudgeAngle(i, angle.offset - 0.2)}>Earlier</button>
                                                    <button disabled={busy} onClick={() => nudgeAngle(i, angle.offset + 0.2)}>Later</button>
                                                    <button className="vc-clipper-danger" disabled={busy} onClick={() => dropAngle(i)}>Remove</button>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    <small className="vc-clipper-note">
                                        A pulled angle lives as long as this studio does: it was never on disk here, so
                                        a reopened timeline comes back without it.
                                    </small>
                                </Group>

                                <Group title="Arrange" start>
                                    <div className="vc-clipper-row">
                                        <button disabled={busy} title="Play this segment from its start (space)" onClick={playSegment}>Play</button>
                                        <button
                                            className={loop ? "vc-clipper-primary" : undefined}
                                            disabled={busy}
                                            title="Play this segment over and over instead of stopping at its end (L)"
                                            onClick={() => setLoop(on => !on)}
                                        >
                                            {loop ? "Looping" : "Loop"}
                                        </button>
                                        <button
                                            disabled={busy}
                                            title="Trim back to the whole file"
                                            onClick={() => patchSegment(segment.id, { from: 0, to: Math.max(0.2, videoRef.current?.duration || segment.to) })}
                                        >
                                            Full clip
                                        </button>
                                        <button disabled={busy} title="Copy this shot, trim, speed and effects included (Ctrl+C)" onClick={() => copySegment(segment.id)}>
                                            Copy
                                        </button>
                                        <button
                                            disabled={busy || clipboard?.kind !== "segment"}
                                            title="Put the copied shot after this one (Ctrl+V)"
                                            onClick={() => pasteSegment()}
                                        >
                                            Paste
                                        </button>
                                        <button disabled={busy} title="Split at the playhead (S)" onClick={split}>Split</button>
                                    </div>

                                    <div className="vc-clipper-row">
                                        <button disabled={busy} title="Move it one place earlier" onClick={() => move(segment.id, -1)}>Earlier</button>
                                        <button disabled={busy} title="Move it one place later" onClick={() => move(segment.id, 1)}>Later</button>
                                        <button disabled={busy} title="Copy it in place (D)" onClick={() => duplicate(segment.id)}>Duplicate</button>
                                    </div>

                                    <div className="vc-clipper-row">
                                        <button
                                            disabled={busy}
                                            title="Put every effect back to its default"
                                            onClick={() => patchEffects(segment.id, { ...DEFAULT_EFFECTS })}
                                        >
                                            Reset look
                                        </button>
                                        <button disabled={busy} title="Save this frame as a picture" onClick={() => void onSaveFrame()}>Save frame</button>
                                        <button
                                            className="vc-clipper-danger"
                                            disabled={busy}
                                            title="Take this segment off the timeline (Delete)"
                                            onClick={() => remove(segment.id)}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </Group>
                            </>
                        )}

                        {tab === "captions" && (
                            <>
                                <button className="vc-clipper-side-clip vc-clipper-add" disabled={busy} onClick={addCaption}>
                                    Add a caption here
                                </button>

                                {!project.captions.length && <div className="vc-clipper-note">No caption yet.</div>}

                                {project.captions.map(caption => (
                                    <div
                                        key={caption.id}
                                        className={`vc-clipper-caption-item${caption.id === pickedCaption ? " vc-clipper-active" : ""}`}
                                        onMouseDown={() => setPickedCaption(caption.id)}
                                    >
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

                                        <div className="vc-clipper-caption-row">
                                            <button
                                                disabled={busy}
                                                title="Say it again right after this one"
                                                onClick={() => duplicateCaption(caption)}
                                            >
                                                Duplicate
                                            </button>
                                            <button
                                                disabled={busy}
                                                title="Copy it, wording and styling included (Ctrl+C)"
                                                onClick={() => copyCaption(caption.id)}
                                            >
                                                Copy
                                            </button>
                                            <button
                                                disabled={busy || clipboard?.kind !== "caption"}
                                                title="Show the copied caption again from the playhead (Ctrl+V)"
                                                onClick={() => pasteCaption()}
                                            >
                                                Paste
                                            </button>
                                            <button
                                                className="vc-clipper-danger"
                                                disabled={busy}
                                                onClick={() => {
                                                    setPickedCaption(current => current === caption.id ? "" : current);
                                                    commit(p => ({ ...p, captions: p.captions.filter(c => c.id !== caption.id) }));
                                                }}
                                            >
                                                Remove
                                            </button>
                                        </div>
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
                                            <Hint summary="One track per person - a mute is exact">
                                                Discord's own engine recorded this clip, and it kept every person on a
                                                track of their own with the game on another. A level here moves that
                                                person and nobody else; a mute leaves them out of the mix entirely, the
                                                others carrying on over the hole where they were. Nothing is estimated
                                                and nothing is ducked.
                                            </Hint>
                                        ) : (
                                            <Hint summary="One mixed track - a mute costs the others">
                                                The call reached this client already mixed, everybody summed into one
                                                signal, so a level here can only move the whole montage while that
                                                person is making noise. A mute is absolute: wherever they can be heard
                                                the sound is cut, and anybody talking across them loses those instants
                                                too. The percentage beside a mute is how much of the clip goes with
                                                them. Turn the native engine on in the plugin's settings and a
                                                recording keeps one track per person, where a mute costs nobody else
                                                anything.
                                            </Hint>
                                        )}

                                        {separating >= 0 && (
                                            <div className="vc-clipper-note">
                                                Separating the voices, {Math.round(separating * 100)}%…
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
                                            <Hint summary="What this mute costs">
                                                The mute works on the band that voice lives in, not on the whole
                                                soundtrack: the game, the music and the low end carry on at full
                                                volume while the muted person drops out. What it cannot do is tell two
                                                voices apart - two people talking at once are literally the same
                                                samples - so anybody talking across them sounds muffled for those
                                                instants.
                                            </Hint>
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
                                            <small>Avatar and name in the corner of the frame while they speak.</small>
                                        </div>
                                    </>
                                )}

                                <div className="vc-clipper-field">
                                    <label>
                                        <span>Burn the chat into the picture</span>
                                        <input
                                            type="checkbox"
                                            checked={project.showChat === true}
                                            disabled={busy}
                                            onChange={e => { const showChat = e.currentTarget.checked; commit(p => ({ ...p, showChat })); }}
                                        />
                                    </label>
                                    <small>
                                        What the call typed while the clip was recorded, in the bottom corner as it
                                        arrived. Only the clips recorded with this version carry it.
                                    </small>
                                </div>

                                <div className="vc-clipper-field">
                                    <label>
                                        <span>Duck the sound lane under speech</span>
                                        <input
                                            type="checkbox"
                                            checked={project.duckMusic === true}
                                            disabled={busy}
                                            onChange={e => { const duckMusic = e.currentTarget.checked; commit(p => ({ ...p, duckMusic })); }}
                                        />
                                    </label>
                                    <small>
                                        The music and stings drop back while somebody talks, following the clip's own
                                        voice lanes. Needs a clip that carries them.
                                    </small>
                                </div>

                                {project.duckMusic === true && (
                                    <div className="vc-clipper-field">
                                        <label>
                                            <span>How far it drops</span>
                                            <span>{Math.round((1 - duck.depth) * 100)}%</span>
                                        </label>
                                        <input
                                            type="range"
                                            min={0}
                                            max={95}
                                            step={5}
                                            value={Math.round((1 - duck.depth) * 100)}
                                            disabled={busy}
                                            onChange={e => {
                                                const depth = 1 - Number(e.currentTarget.value) / 100;
                                                commit(p => ({ ...p, duck: { ...duckSettingsOf(p), depth } }));
                                            }}
                                        />
                                    </div>
                                )}

                                <button className="vc-clipper-side-clip vc-clipper-add" disabled={busy} onClick={() => void onImportSound()}>
                                    Add a sound here…
                                </button>

                                <Shelf kind="sound" items={shelf} busy={busy} onPlace={placeAsset} onForget={forgetAsset} />

                                {!audioClips.length && (
                                    <div className="vc-clipper-note">
                                        No sound yet. One lands at the playhead, then moves and trims on the lane
                                        under the picture.
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
                                                <button disabled={busy || !inside} title="Trim the start up to the playhead" onClick={() => cutSound(clip, "start")}>
                                                    Cut start
                                                </button>
                                                <button disabled={busy || !inside} title="Trim the end back to the playhead" onClick={() => cutSound(clip, "end")}>
                                                    Cut end
                                                </button>
                                                <button disabled={busy || !inside} title="Split it in two at the playhead" onClick={() => splitSound(clip)}>
                                                    Split
                                                </button>
                                            </div>

                                            <div className="vc-clipper-caption-row">
                                                <button
                                                    disabled={busy || project.segments.length < 2}
                                                    title="Pull every cut in the montage onto the nearest beat of this sound"
                                                    onClick={() => snapCuts(clip)}
                                                >
                                                    Snap cuts to the beat
                                                </button>
                                                <button
                                                    disabled={busy}
                                                    title="Move it onto the nearest cut of the montage"
                                                    onClick={() => snapSoundToCut(clip)}
                                                >
                                                    Snap to a cut
                                                </button>
                                            </div>

                                            <div className="vc-clipper-caption-row">
                                                <button disabled={busy} title="Move it to the playhead" onClick={() => patchSound(clip.id, { at: projectTime() })}>
                                                    Move here
                                                </button>
                                                <button disabled={busy} title="Copy this block, trim and fades included (Ctrl+C)" onClick={() => copySound(clip.id)}>
                                                    Copy
                                                </button>
                                                <button
                                                    disabled={busy || clipboard?.kind !== "sound"}
                                                    title="Lay the copied block down at the playhead, again after itself each time (Ctrl+V)"
                                                    onClick={() => pasteSound()}
                                                >
                                                    Paste
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

                                <h4 title="These balance what goes into a new recording, not what is on this timeline">Recording mixer</h4>

                                <div className="vc-clipper-mixer">
                                    <AudioMixerInput compact />
                                </div>
                            </>
                        )}

                        {tab === "images" && (
                            <>
                                <button className="vc-clipper-side-clip vc-clipper-add" disabled={busy} onClick={() => void onImportImage()}>
                                    Add a picture or a clip here…
                                </button>

                                <Shelf kind="image" items={shelf} busy={busy} onPlace={placeAsset} onForget={forgetAsset} />

                                {!overlays.length && (
                                    <Hint summary="Nothing over the picture yet">
                                        A PNG, a GIF or a short MP4 all work, and the moving ones play while the
                                        montage does. One lands in the middle of the frame for {OVERLAY_SECONDS}
                                        {" "}seconds from the playhead; drag it on the preview to move it, and the
                                        two buttons under it set how long it stays.
                                    </Hint>
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
                                                    title="Start showing it at the playhead"
                                                    onClick={() => patchOverlay(overlay.id, { from: Math.min(projectTime(), overlay.to - 0.2) })}
                                                >
                                                    Starts here
                                                </button>
                                                <button
                                                    disabled={busy}
                                                    title="Stop showing it at the playhead"
                                                    onClick={() => patchOverlay(overlay.id, { to: Math.max(projectTime(), overlay.from + 0.2) })}
                                                >
                                                    Ends here
                                                </button>
                                            </div>

                                            <div className="vc-clipper-caption-row">
                                                <button
                                                    disabled={busy}
                                                    title="Copy it, placing and fades included (Ctrl+C)"
                                                    onClick={() => copyOverlay(overlay.id)}
                                                >
                                                    Copy
                                                </button>
                                                <button
                                                    disabled={busy || clipboard?.kind !== "overlay"}
                                                    title="Show the copied picture again from the playhead, then after itself each time (Ctrl+V)"
                                                    onClick={() => pasteOverlay()}
                                                >
                                                    Paste
                                                </button>
                                                <button className="vc-clipper-danger" disabled={busy} onClick={() => removeOverlay(overlay.id)}>
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                <Hint summary="Laid out here, the same at any size">
                                    Sizes and positions are kept as a share of the frame, so a montage laid out on
                                    this preview comes out the same whether it is rendered at 720p or at 1080p.
                                </Hint>
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
                                    <label>
                                        <span>Shape</span>
                                        <span>{project.width === verticalWidth(project.height) ? `9:16, ${verticalWidth(project.height)}x${project.height}` : "wide"}</span>
                                    </label>
                                    <div className="vc-clipper-row">
                                        <button
                                            disabled={busy || !project.segments.length}
                                            title="Crop every shot to a phone frame instead of putting bars around it"
                                            onClick={toggleVertical}
                                        >
                                            {project.width === verticalWidth(project.height) ? "Back to wide" : "Reframe for phones (9:16)"}
                                        </button>
                                    </div>
                                    <small>
                                        The crop sits where each shot is framed. Track the action on a shot, in Look,
                                        to have it follow what moves instead of holding the middle.
                                    </small>
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

                                <Hint summary={`About ${formatTime(total)} to render, roughly ${formatBytes(estimatedSize(project))}`}>
                                    The render plays the whole timeline through the encoder in real time and lands
                                    next to your clips. The bitrate and the container follow the plugin settings.
                                    Keep the window visible while it runs: a hidden one stops painting frames and the
                                    sound drifts away from the picture.
                                </Hint>

                                <Hint summary="Shortcuts">
                                    Space plays the segment, L keeps it playing over and over, S splits it, D
                                    duplicates it, Delete removes it, I and O mark a range and X cuts it, arrows
                                    step the playhead, Ctrl+Z and Ctrl+Shift+Z walk the edits, Esc closes the
                                    studio. Ctrl+C copies whatever the open tab is about - the selected shot, or
                                    the caption, sound or picture picked in its list - and Ctrl+V lays it down:
                                    a shot after the selected one, everything else at the playhead. Press it
                                    again and the next copy follows the last one, so a sting can be spammed
                                    across the clip. With a caption, a sound or a picture picked, the arrows move
                                    that one along the montage rather than the playhead, a tenth of a second at a
                                    time and a whole second with Shift. The timeline is kept when you close it
                                    and comes back on the next opening.
                                </Hint>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
