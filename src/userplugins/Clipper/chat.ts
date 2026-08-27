/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - what the chat said while it happened
 *
 * Half of what makes a clip funny is not in the capture: it is the three people
 * typing at the same moment in the call's own chat. A clip saved after the fact
 * has no way of going back for that, so the messages are kept on the same
 * rolling window as the footage and the voice lanes, and the ones that fall
 * inside the saved window travel with the clip as metadata.
 *
 * Only the channel being talked in is followed - the voice channel's own chat,
 * or the text channel on screen when the call has none - because a clip of one
 * game should not carry whatever was being said in an unrelated server.
 *
 * Nothing here reads message history. What is kept is what arrived while the
 * buffer was running, which is the same bargain the video buffer makes.
 */

import { Logger } from "@utils/Logger";
import { ChannelStore, FluxDispatcher, SelectedChannelStore, UserStore } from "@webpack/common";

const logger = new Logger("Clipper");

/** Longest a line is kept, whatever the buffer length is. */
const MAX_KEEP_MS = 20 * 60 * 1000;

/** Most lines held at once, so a spammed channel cannot grow without bound. */
const MAX_LINES = 400;

/** Longest message kept, in characters. Past this it is a wall, not a line. */
const MAX_TEXT = 180;

export interface ChatLine {
    /** Seconds from the start of the clip. */
    at: number;
    name: string;
    text: string;
    /** Avatar URL, when the store had one. */
    avatar?: string;
}

/** A line as it is held while the buffer runs: epoch ms rather than an offset. */
interface HeldLine extends Omit<ChatLine, "at"> {
    sentAt: number;
}

/**
 * The channel whose chat belongs to this recording.
 *
 * The voice channel first: in a call, that is where "clip that" is typed. A
 * capture taken outside a call falls back to whatever text channel is on
 * screen, which is the only other thing the person recording can be reading.
 */
function watchedChannel(): string | undefined {
    try {
        return SelectedChannelStore.getVoiceChannelId() ?? SelectedChannelStore.getChannelId() ?? undefined;
    } catch {
        return undefined;
    }
}

function displayName(author: any, userId: string): string {
    if (typeof author?.global_name === "string" && author.global_name) return author.global_name;
    if (typeof author?.username === "string" && author.username) return author.username;

    try {
        const user = UserStore.getUser(userId) as any;
        return user?.globalName || user?.username || "Someone";
    } catch {
        return "Someone";
    }
}

function avatarUrl(userId: string): string {
    try {
        return (UserStore.getUser(userId) as any)?.getAvatarURL?.(undefined, 64) ?? "";
    } catch {
        return "";
    }
}

/**
 * The last few minutes of the call's chat.
 *
 * Started and stopped with the video buffer, like the voice activity: outside a
 * recording there is nothing to keep, and keeping it anyway would be a plugin
 * quietly logging a server's chat.
 */
class ChatBuffer {
    private lines: HeldLine[] = [];
    private keepMs = MAX_KEEP_MS;
    private running = false;

    /** The channel followed when the buffer started, so a tab-out is ignored. */
    private channelId: string | undefined;

    private onMessage = (event: any) => {
        const message = event?.message;
        if (!this.running || !message) return;

        // A channel switch mid-recording does not move the clip: the footage is
        // still of the call the buffer was armed on.
        if (message.channel_id !== this.channelId) return;

        // Edits and the local echo of a send both arrive here; neither is a new
        // line, and the echo arrives again with an id once the server answers.
        if (event.isPushNotification || message.state === "SENDING") return;

        const text = String(message.content ?? "").replace(/\s+/g, " ").trim();
        if (!text) return;

        const userId = String(message.author?.id ?? "");
        const avatar = avatarUrl(userId);

        this.lines.push({
            sentAt: Date.parse(message.timestamp) || Date.now(),
            name: displayName(message.author, userId),
            text: text.slice(0, MAX_TEXT),
            ...(avatar ? { avatar } : {})
        });

        this.forget();
    };

    get active(): boolean {
        return this.running;
    }

    /** Follows the chat of the channel being recorded. `keepSeconds` is the buffer. */
    start(keepSeconds: number): void {
        if (this.running) return;

        this.channelId = watchedChannel();
        if (!this.channelId) return;

        this.keepMs = Math.min(MAX_KEEP_MS, Math.max(60, keepSeconds + 30) * 1000);
        this.lines = [];
        this.running = true;

        try {
            FluxDispatcher.subscribe("MESSAGE_CREATE" as any, this.onMessage);
        } catch (e) {
            this.running = false;
            logger.warn("Could not follow the chat", e);
        }
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;

        try {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE" as any, this.onMessage);
        } catch (e) {
            logger.warn("Could not stop following the chat", e);
        }

        this.lines = [];
        this.channelId = undefined;
    }

    /** The name of the channel being followed, for the studio's own label. */
    channelName(): string {
        if (!this.channelId) return "";

        try {
            return (ChannelStore.getChannel(this.channelId) as any)?.name ?? "";
        } catch {
            return "";
        }
    }

    /** What was said between two instants, as offsets from the first of them. */
    slice(from: number, to: number): ChatLine[] {
        return this.lines
            .filter(line => line.sentAt >= from && line.sentAt <= to)
            .map(({ sentAt, ...rest }) => ({ ...rest, at: (sentAt - from) / 1000 }))
            .sort((a, b) => a.at - b.at);
    }

    private forget(): void {
        const cutOff = Date.now() - this.keepMs;

        let first = 0;
        while (first < this.lines.length && this.lines[first].sentAt < cutOff) first++;

        const extra = this.lines.length - first - MAX_LINES;
        if (extra > 0) first += extra;

        if (first > 0) this.lines = this.lines.slice(first);
    }
}

export const chatLog = new ChatBuffer();

/** Moves the lines back by what a repair took off the front, dropping the rest. */
export function shiftChat(lines: ChatLine[], bySeconds: number): ChatLine[] {
    if (bySeconds <= 0) return lines;

    return lines
        .map(line => ({ ...line, at: line.at - bySeconds }))
        .filter(line => line.at >= 0);
}
