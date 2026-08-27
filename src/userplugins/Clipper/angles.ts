/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the angles the others posted
 *
 * `multipov.ts` asks the call for their view of a moment; this is the other
 * end of it, hours later, when everyone has dropped their clip in the channel
 * and the montage wants all of them side by side.
 *
 * There is no index and no side channel: the angles are ordinary attachments
 * on ordinary messages, so what this does is read the messages the client has
 * already loaded and pick out the video files. Nothing is fetched from the API
 * and no history is walked - if a clip is far enough up the channel that the
 * client has forgotten it, scrolling to it is what loads it, and the person
 * doing the editing is the one who decides that.
 */

import { Logger } from "@utils/Logger";
import { MessageStore, SelectedChannelStore } from "@webpack/common";

const logger = new Logger("Clipper");

/** What the client is asked for at most, newest first. */
const MAX_ANGLES = 25;

export interface PostedAngle {
    /** The attachment id, so the same file is never pulled in twice. */
    id: string;
    /** File name as it was posted. */
    name: string;
    url: string;
    /** Who posted it, for the label on the timeline. */
    author: string;
    /** Epoch ms the message was sent. */
    sentAt: number;
}

function watchedChannel(): string | undefined {
    try {
        return SelectedChannelStore.getVoiceChannelId() ?? SelectedChannelStore.getChannelId() ?? undefined;
    } catch {
        return undefined;
    }
}

function isVideo(attachment: any): boolean {
    const type = String(attachment?.content_type ?? attachment?.contentType ?? "");
    if (type.startsWith("video/")) return true;

    return /\.(mp4|webm|mov|mkv)$/i.test(String(attachment?.filename ?? ""));
}

/**
 * The video files posted in the channel being watched, newest first.
 *
 * Everyone's clip of the same moment, as far as this client can see it. The
 * caller decides which of them to pull onto the timeline: this only says what
 * is there, because downloading a folder of other people's clips because a
 * button was pressed once is not something to do behind their back.
 */
export function postedAngles(): PostedAngle[] {
    const channelId = watchedChannel();
    if (!channelId) return [];

    let messages: any[];

    try {
        const held = MessageStore.getMessages(channelId) as any;
        messages = held?._array ?? held?.toArray?.() ?? [];
    } catch (e) {
        logger.warn("Could not read the channel for posted angles", e);
        return [];
    }

    const found: PostedAngle[] = [];

    for (let i = messages.length - 1; i >= 0 && found.length < MAX_ANGLES; i--) {
        const message = messages[i];
        const author = message?.author;

        for (const attachment of message?.attachments ?? []) {
            if (!isVideo(attachment) || !attachment?.url) continue;

            found.push({
                id: String(attachment.id ?? attachment.url),
                name: String(attachment.filename ?? "angle.mp4"),
                url: String(attachment.url),
                author: String(author?.globalName || author?.global_name || author?.username || "Someone"),
                sentAt: Date.parse(message?.timestamp) || 0
            });

            if (found.length >= MAX_ANGLES) break;
        }
    }

    return found;
}

/** Pulls one posted angle down as a blob the timeline can play. */
export async function fetchAngle(angle: PostedAngle): Promise<{ url: string; bytes: ArrayBuffer; }> {
    const response = await fetch(angle.url);
    if (!response.ok) throw new Error(`${angle.name} could not be downloaded (${response.status})`);

    const bytes = await response.arrayBuffer();

    // One copy for the element to play and one for the alignment to decode:
    // decoding detaches the buffer it is handed, and the element needs it after.
    return { url: URL.createObjectURL(new Blob([bytes.slice(0)], { type: response.headers.get("content-type") || "video/mp4" })), bytes };
}
