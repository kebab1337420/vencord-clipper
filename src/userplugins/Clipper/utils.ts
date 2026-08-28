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

/*
 * Whether a keybind is being picked right now.
 *
 * This lives here rather than beside the shortcuts themselves. The picker is a
 * settings component and the shortcut module pulls in the recorder, so having
 * the picker import it closes an import cycle around a module that builds a
 * recorder as it loads. This one imports nothing, so both sides can depend on
 * it.
 *
 * Counted rather than a flag: the settings panel holds three pickers, and
 * opening a second one before the first has closed must not hand the binds back
 * while the second is still listening.
 */
let suspensions = 0;
let onSuspension: ((suspended: boolean) => void) | null = null;

/**
 * Follows the picker, so the OS-level binds can be freed while one is open.
 *
 * Set by the shortcut module, which is the only thing that can register and
 * unregister them. Null unhooks it.
 */
export function watchKeybindSuspension(listener: ((suspended: boolean) => void) | null): void {
    onSuspension = listener;
}

/** True while a keybind is being picked, so the shortcuts must not fire. */
export function keybindsSuspended(): boolean {
    return suspensions > 0;
}

/**
 * Holds the shortcuts back until the returned function is called.
 *
 * A registered accelerator is swallowed by the OS before the renderer sees the
 * key, which is exactly why a combination could not be assigned: pressing the
 * one already bound produced no event at all. While a picker is open the
 * registration is dropped and the in-client listener stands down, so every
 * combination reaches the picker and none of them saves a clip on the way.
 */
export function suspendKeybinds(): () => void {
    suspensions++;
    if (suspensions === 1) onSuspension?.(true);

    let released = false;

    return () => {
        if (released) return;
        released = true;

        suspensions = Math.max(0, suspensions - 1);
        if (!suspensions) onSuspension?.(false);
    };
}


/**
 * Chunk interval, in ms. Smaller = finer trimming, more overhead.
 *
 * Here rather than in ./recorder because ./voiceRecord cuts on the same
 * boundaries and cannot import it - the recorder imports the voice buffers, so
 * the other direction is a cycle. It had its own copy of the number and a
 * comment saying the two had to agree, which is the arrangement where they
 * quietly stop agreeing.
 */
export const TIMESLICE = 1000;

/**
 * Something readable out of anything that was thrown.
 *
 * `String(e)` alone is what put `[object Object]` in front of a user instead of
 * a reason: the native voice module rejects with plain objects rather than
 * `Error`s, and a plain object stringifies to nothing at all. Anything that
 * came from across the IPC boundary has to be dug into by hand, including the
 * non-enumerable properties an `Error` from another realm keeps its message in.
 */
export function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message || e.name;
    if (typeof e === "string") return e;
    if (e === null || e === undefined) return "no reason given";

    if (typeof e === "object") {
        const record = e as Record<string, unknown>;

        for (const key of ["message", "error", "reason", "detail", "description"]) {
            const value = record[key];
            if (typeof value === "string" && value) return value;
            if (value && typeof value === "object") {
                const nested = errorMessage(value);
                if (nested && nested !== "[object Object]") return nested;
            }
        }

        try {
            const json = JSON.stringify(e);
            if (json && json !== "{}" && json !== "null") return json;
        } catch {
            // Circular, or something with a throwing getter. The properties are
            // still worth reading one at a time.
        }

        try {
            const parts: string[] = [];
            for (const key of Object.getOwnPropertyNames(record)) {
                if (key === "stack") continue;
                parts.push(`${key}: ${String(record[key])}`);
            }

            if (parts.length) return parts.join(", ");
        } catch {
            // Nothing readable on it at all, which String() will say as well.
        }
    }

    return String(e);
}

/**
 * Seeks and waits, giving up rather than hanging on a frame that never lands.
 *
 * The early return is not an optimisation: a browser that is already at `at`
 * fires no `seeked` at all, so without it every frame that needed no seek waits
 * out the whole two seconds before carrying on.
 */
export function seekVideo(video: HTMLVideoElement, at: number): Promise<void> {
    return new Promise<void>(resolve => {
        if (Math.abs(video.currentTime - at) < .05) return resolve();

        let done = false;

        const settle = () => {
            if (done) return;

            done = true;
            clearTimeout(timer);
            video.removeEventListener("seeked", settle);
            resolve();
        };

        const timer = setTimeout(settle, 2000);
        video.addEventListener("seeked", settle);
        video.currentTime = at;
    });
}
