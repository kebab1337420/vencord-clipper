/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - shared helpers
 */

/**
 * Name of the thumbnail that belongs to a clip.
 *
 * A sidecar rather than an entry in the library file: it is written once, it is
 * binary, and a clip copied out of the folder by hand should take its picture
 * with it.
 */
export function thumbNameFor(name: string): string {
    return `${name.replace(/\.(webm|mp4)$/i, "")}.thumb.jpg`;
}

export interface Keybind {
    code: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
}

/** Serializes a keybind to a stable string, e.g. "ctrl+shift+KeyS". */
export function serializeKeybind(kb: Keybind): string {
    const parts: string[] = [];
    if (kb.ctrl) parts.push("ctrl");
    if (kb.shift) parts.push("shift");
    if (kb.alt) parts.push("alt");
    if (kb.meta) parts.push("meta");
    parts.push(kb.code);
    return parts.join("+");
}

export function parseKeybind(value: string): Keybind | null {
    if (!value) return null;

    const parts = value.split("+").filter(Boolean);
    const code = parts.pop();
    if (!code) return null;

    return {
        code,
        ctrl: parts.includes("ctrl"),
        shift: parts.includes("shift"),
        alt: parts.includes("alt"),
        meta: parts.includes("meta")
    };
}

const KEY_LABELS: Record<string, string> = {
    ControlLeft: "Ctrl",
    ControlRight: "Ctrl",
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    AltLeft: "Alt",
    AltRight: "Alt",
    Space: "Space",
    Escape: "Esc"
};

/** Human readable label, e.g. "Ctrl + Shift + S". */
export function formatKeybind(value: string): string {
    const kb = parseKeybind(value);
    if (!kb) return "Unbound";

    const parts: string[] = [];
    if (kb.ctrl) parts.push("Ctrl");
    if (kb.shift) parts.push("Shift");
    if (kb.alt) parts.push("Alt");
    if (kb.meta) parts.push("Meta");

    let key = KEY_LABELS[kb.code] ?? kb.code;
    key = key.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
    parts.push(key);

    return parts.join(" + ");
}

const MODIFIER_CODES = ["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"];

export function isModifierKey(code: string): boolean {
    return MODIFIER_CODES.includes(code);
}

export function keybindMatches(value: string, event: KeyboardEvent): boolean {
    const kb = parseKeybind(value);
    if (!kb) return false;

    return event.code === kb.code
        && event.ctrlKey === kb.ctrl
        && event.shiftKey === kb.shift
        && event.altKey === kb.alt
        && event.metaKey === kb.meta;
}

export function keybindFromEvent(event: KeyboardEvent): Keybind {
    return {
        code: event.code,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey
    };
}

/*
 * Electron accelerators, used to register the keybinds system-wide so they also
 * fire while Discord is not the focused window.
 *
 * Only the keys below can be registered globally; anything else keeps working
 * through the in-client listener only.
 */
const ACCELERATOR_KEYS: Record<string, string> = {
    Space: "Space",
    Escape: "Esc",
    Enter: "Return",
    NumpadEnter: "Return",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    PrintScreen: "PrintScreen",
    CapsLock: "Capslock",
    NumpadAdd: "numadd",
    NumpadSubtract: "numsub",
    NumpadMultiply: "nummult",
    NumpadDivide: "numdiv",
    NumpadDecimal: "numdec",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`"
};

/** Maps a key code to its accelerator name, empty when it cannot be registered. */
function acceleratorKey(code: string): string {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

    return ACCELERATOR_KEYS[code] ?? "";
}

/**
 * Converts a stored keybind to an Electron accelerator, e.g. "alt+F10" to
 * "Alt+F10". Returns an empty string when the key has no accelerator name, in
 * which case the bind cannot be registered globally.
 */
export function toAccelerator(value: string): string {
    const kb = parseKeybind(value);
    if (!kb) return "";

    const key = acceleratorKey(kb.code);
    if (!key) return "";

    const parts: string[] = [];
    if (kb.ctrl) parts.push("Control");
    if (kb.shift) parts.push("Shift");
    if (kb.alt) parts.push("Alt");
    if (kb.meta) parts.push("Super");
    parts.push(key);

    return parts.join("+");
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** File-system safe timestamp, e.g. "2026-08-19_14-32-07". */
export function timestampName(prefix = "clip"): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** True when the user is typing in a text field and the keybind has no modifier. */
export function isTypingTarget(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
}

/** A position on a timeline, e.g. "1:07.5". */
export function formatTime(seconds: number): string {
    const value = Math.max(0, seconds);
    const minutes = Math.floor(value / 60);
    const rest = value - minutes * 60;

    return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}
