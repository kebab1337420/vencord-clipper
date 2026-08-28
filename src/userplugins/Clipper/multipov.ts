/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - one key, everybody's angle
 *
 * A moment in a call happens to everyone in it, but only one buffer was pointed
 * at the screen it happened on. The usual repair is to say "clip that" out loud,
 * and by the time somebody reaches for their keybind the moment has rolled out
 * of their buffer - or they were looking at a different part of the game and
 * their angle is the one worth having. So one key asks for all of them at once.
 *
 * There is no side channel here. Discord gives a plugin nothing to talk to
 * another plugin on, and the tempting workaround - hiding a payload in zero
 * width characters inside an ordinary looking message - is the plugin talking
 * behind the user's back in their own name. So the request travels as a
 * message, in plain words, in the call's own chat: everyone in the channel sees
 * exactly what was sent, whether they run this plugin or not, and the part the
 * plugin reads back out is visible in it.
 *
 * The chat is how it travels, not how it is read. Everybody this is aimed at is
 * looking at a game rather than at Discord, so the request also goes over the
 * game as a line of text, at both ends: the person who asked sees that the call
 * was asked, and the people in it see who asked and that their own angle is
 * being saved. Whoever can see the client gets the usual toast instead. And
 * because the message has done its work within a second of being sent, it is
 * taken back down a few seconds later rather than left to pile up in the
 * channel, which the settings can turn off for anybody who would rather keep it.
 *
 * The one piece of cleverness is the clock. A request lands a few hundred
 * milliseconds after it was sent, so a receiver that just saves "the last
 * thirty seconds" ends its clip later than the person who asked. The message
 * carries Discord's own timestamp for when it was sent, so the receiver cuts
 * its buffer to end there instead, and the angles cover the same moment rather
 * than drifting apart by the round trip.
 */

import { sendMessage } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, SelectedChannelStore, Toasts, UserStore } from "@webpack/common";

import { notifyOverlay } from "./gameOverlay";
import { logger, recorder } from "./recorder";
import { settings } from "./settings";
import { nameOf, voiceParticipants } from "./voice";

/**
 * The part of the message the plugin reads back.
 *
 * An inline code span, because it has to survive being retyped by a person and
 * has to be obvious to one who is not running the plugin: the message says what
 * it does in words, and this is the same thing again in a shape that parses.
 */
const REQUEST = /`multi-pov (\d+)s`/;

/**
 * The module that deletes messages.
 *
 * Not the common `MessageActions`, which is found by `sendMessage` and
 * `editMessage` and only happens to carry a delete: if a build ever splits
 * them, the take-down would quietly do nothing and every request would stay in
 * the channel. This asks for the pair Vencord's own message actions ask for.
 */
const MessageDelete = findByPropsLazy("deleteMessage", "startEditMessage");

/** How long to ignore further requests after honouring one, in ms. */
const COOLDOWN = 10_000;

/**
 * Largest round trip that is treated as a round trip.
 *
 * Past this it is a clock that disagrees with Discord's rather than a slow
 * network, and correcting for it would cut the clip early enough to lose the
 * moment. Nothing is a worse trade than that, so an implausible lag is taken as
 * no lag: the clip then ends a fraction of a second late, which nobody notices.
 */
const MAX_LAG = 2000;

/**
 * How long between two requests of our own.
 *
 * Long enough to cover the take-down: two presses inside it used to leave the
 * first message in the channel for good, and asking the call twice in five
 * seconds was never the intention anyway.
 */
const ASK_COOLDOWN = 10_000;

/**
 * How long the request is left in the chat before it is taken back down.
 *
 * A client that is connected has acted on it inside a second; this is slack for
 * one that was reconnecting when it was sent, and short enough that a session
 * does not leave a wall of them behind.
 */
const CLEANUP_DELAY = 8000;

/** How long a message of our own is still recognised as the one we just sent. */
const CLEANUP_WINDOW = 30_000;

let lastHonoured = 0;
let installed = false;

/** When we last asked, so the copy that comes back can be recognised. */
let askedAt = 0;

/** When we last asked, so a second press does not ask again. */
let lastAsked = 0;

/** The pending take-downs, cleared if the plugin stops before they fire. */
let cleanups = new Set<ReturnType<typeof setTimeout>>();

function toast(message: string, type: string, duration = 5000) {
    Toasts.show({
        id: Toasts.genId(),
        message,
        type,
        options: { duration, position: Toasts.Position.BOTTOM }
    });
}

/** A name cut to fit a line over the game, which holds 90 characters in all. */
function short(name: string): string {
    return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}

/*
 * What the message claims is what the sender can actually see.
 *
 * It used to say everyone had saved their angle, which is a thing this client
 * has no way of knowing: a receiver may have the plugin off, the buffer off or
 * the setting off, and the message would have said otherwise in their own chat.
 * So it says what it is - a request - and leaves the claiming to the clips.
 */
function requestText(seconds: number): string {
    return `🎬 **Clip that.** Asking everyone in the call running Clipper to save the last ${seconds} seconds. \`multi-pov ${seconds}s\``;
}

function myId(): string {
    try {
        return UserStore.getCurrentUser()?.id ?? "";
    } catch {
        return "";
    }
}

/** The call this client is sitting in, which is also the chat to ask in. */
function channelOf(): string {
    try {
        return SelectedChannelStore.getVoiceChannelId() ?? "";
    } catch {
        return "";
    }
}

/**
 * Saves your own angle and asks the call for theirs.
 *
 * Your own clip is not conditional on any of it: a call that turns out to be
 * empty, a channel that refuses the message, a network that drops it - the
 * moment is still saved here, because losing it is the one outcome the key
 * exists to prevent.
 */
export async function requestPov(): Promise<void> {
    const { clipLength } = settings.store;
    const seconds = Math.round(clipLength);

    // Ours first, and only if there is anything to take it from: asking the
    // call is worth doing either way, but saying a clip was saved while the
    // buffer was off sends somebody looking for a file that was never written.
    const mine = recorder.isRecording;
    if (mine) void recorder.save();

    // A second press this soon still saves the clip - that is what the key is
    // for - but the call has already been asked, and asking again would post a
    // message the take-down cannot keep up with.
    if (Date.now() - lastAsked < ASK_COOLDOWN) {
        toast(mine
            ? "Saved another clip - the call was already asked"
            : "The call was already asked", Toasts.Type.MESSAGE);
        return;
    }

    const others = voiceParticipants().filter(p => !p.self);
    if (!others.length) {
        toast(mine
            ? "Not in a call with anyone - saved your own clip"
            : "Not in a call with anyone, and your clip buffer is off", Toasts.Type.MESSAGE);
        return;
    }

    // voiceParticipants only ever reports the channel we are in ourselves, so
    // the id it was built from is the one to post into. A voice channel carries
    // its own chat, and a call in a DM is that DM.
    const channelId = channelOf();
    if (!channelId) {
        toast(mine
            ? "Could not tell which call you are in - saved your own clip"
            : "Could not tell which call you are in, and your clip buffer is off", Toasts.Type.MESSAGE);
        return;
    }

    try {
        // Set before the send rather than after it: the message can come back
        // through the dispatcher before this promise resolves.
        askedAt = Date.now();
        lastAsked = askedAt;

        await sendMessage(channelId, { content: requestText(seconds) });

        toast(`Asked ${others.length === 1 ? "the other person" : `the ${others.length} others`} in the call for their angle`, Toasts.Type.SUCCESS);
        notifyOverlay("Asked for everyone's angle", mine ? "Your own clip is saved" : "Your clip buffer is off");
    } catch (e) {
        // Both of them: nothing was posted, so there is no message to take back
        // down and nothing to hold the next press off for. Leaving the cooldown
        // set would answer a second press with "the call was already asked",
        // which would not be true.
        askedAt = 0;
        lastAsked = 0;

        logger.error("Could not ask the call for a clip", e);
        toast(mine
            ? "Saved your clip, but the call could not be asked"
            : "The call could not be asked", Toasts.Type.FAILURE);
    }
}

interface IncomingMessage {
    id?: string;
    channel_id?: string;
    content?: string;
    timestamp?: string;
    author?: { id?: string; bot?: boolean; };
}

/**
 * Takes our own request back out of the chat, a few seconds on.
 *
 * The message is the transport and nothing else, so it has no reason to stay:
 * everybody running the plugin has been told over their game by now, and
 * everybody not running it saw it go past. Each message gets its own take-down,
 * so a request sent while an earlier one is still pending does not take its
 * slot and leave that first message in the channel for good.
 */
function takeDown(channelId: string, id: string): void {
    const timer = setTimeout(() => {
        cleanups.delete(timer);

        try {
            void Promise.resolve(MessageDelete.deleteMessage(channelId, id))
                .catch(e => logger.warn("Could not take the multi-POV request back down", e));
        } catch (e) {
            logger.warn("Could not take the multi-POV request back down", e);
        }
    }, CLEANUP_DELAY);

    cleanups.add(timer);
}

/**
 * Honours a request from somebody else in the same call.
 *
 * Every condition here is one that has to hold for the request to mean what it
 * says: it came from the call this client is sitting in, from somebody actually
 * in that call, and the buffer was already running - so the key can only ever
 * produce a clip the user could have saved themselves a second earlier.
 */
function onMessage({ message, optimistic }: { message?: IncomingMessage; optimistic?: boolean; }) {
    try {
        if (optimistic || !message?.content) return;

        const match = REQUEST.exec(message.content);
        if (!match) return;

        const author = message.author?.id ?? "";
        if (!author || message.author?.bot) return;

        // Our own request, come back with the id the chat gave it. The only
        // thing left to do with it is to take it down again.
        if (author === myId()) {
            const ours = Date.now() - askedAt < CLEANUP_WINDOW;
            if (!ours || !settings.store.povCleanup || !message.id || !message.channel_id) return;

            askedAt = 0;
            takeDown(message.channel_id, message.id);
            return;
        }

        if (!settings.store.povRequests) return;

        // From the call we are in, and from somebody who is in it: the chat of a
        // voice channel is readable by people who never joined the call.
        if (message.channel_id !== channelOf()) return;
        if (!voiceParticipants().some(p => p.id === author && !p.self)) return;

        const now = Date.now();
        if (now - lastHonoured < COOLDOWN) return;

        if (!recorder.isRecording) {
            lastHonoured = now;
            toast(`${nameOf(author)} asked for everyone's angle, but your clip buffer is off`, Toasts.Type.MESSAGE, 7000);
            notifyOverlay("Clip that", `${short(nameOf(author))} asked, but your clip buffer is off`);
            return;
        }

        lastHonoured = now;

        const seconds = Math.min(Number(match[1]) || 30, Math.round(settings.store.clipLength));

        /*
         * Ending where the request was sent rather than where it arrived.
         *
         * A lag that is negative or wild is a clock disagreeing with Discord's,
         * not a slow network, and is taken as zero rather than trusted.
         */
        const sent = Date.parse(message.timestamp ?? "");
        const lag = Number.isFinite(sent) && now - sent >= 0 && now - sent <= MAX_LAG ? now - sent : 0;

        const to = now - lag;

        toast(`${nameOf(author)} asked for everyone's angle - saving yours`, Toasts.Type.SUCCESS);
        notifyOverlay("Clip that", `${short(nameOf(author))} asked - saving your last ${seconds}s`);

        void recorder.save(undefined, { from: to - seconds * 1000, to });
    } catch (e) {
        logger.warn("Could not act on a multi-POV request", e);
    }
}

/** Starts listening for requests from the rest of the call. */
export function installPovRequests(): void {
    if (installed) return;

    try {
        FluxDispatcher.subscribe("MESSAGE_CREATE" as any, onMessage);
        installed = true;
    } catch (e) {
        logger.warn("Could not listen for multi-POV requests", e);
    }
}

export function uninstallPovRequests(): void {
    for (const timer of cleanups) clearTimeout(timer);
    cleanups = new Set();

    if (!installed) return;

    try {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE" as any, onMessage);
    } catch (e) {
        logger.warn("Could not stop listening for multi-POV requests", e);
    }

    installed = false;
}
