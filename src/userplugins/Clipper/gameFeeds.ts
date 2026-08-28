/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Vencord Clipper - the games that will tell you what happened, main process half
 *
 * ./gameAudio and ./gameVideo guess. Some games do not need guessing at: they
 * ship a supported way to say "you got a kill" out loud, and where that exists
 * it is worth more than every inference put together, so ./signals scores it as
 * certain and ./highlights marks on it immediately.
 *
 * Two of them are implemented, and they are the two that are both popular and
 * official:
 *
 *   - Counter-Strike 2, through Game State Integration. Valve's own feature:
 *     you drop a config file in the game's cfg folder naming a URL, and the
 *     game POSTs its state there as JSON whenever it changes. So this hosts a
 *     small HTTP server, on the loopback interface only, and writes that file.
 *   - League of Legends, through the Live Client Data API. Riot's own feature,
 *     and the reverse shape: the game hosts the server, on 127.0.0.1:2999, and
 *     it is polled. Its certificate is Riot's own self-signed one, which is why
 *     the check is off for that host and nowhere else.
 *
 * Both live here rather than in the renderer for the same two reasons: a
 * renderer cannot listen on a socket or write into a game's folder, and Riot's
 * certificate cannot be excused from inside a page.
 *
 * The rest is deliberately not attempted. Apex's LiveAPI needs a launch option
 * and speaks protobuf over a socket; Valorant, Fortnite, Warzone and Overwatch
 * publish nothing at all and their anti-cheat is entitled to take an interest
 * in anything that reads them another way. Those games get the guesswork, which
 * is what it is for.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { get as httpsGet } from "https";
import { homedir } from "os";
import { join } from "path";

export interface GameEvent {
    kind: "kill" | "death" | "multikill" | "objective" | "roundwin";
    /** Said in the marker and in the log: "a kill in Counter-Strike 2". */
    note: string;
}

export interface FeedStatus {
    /** The port the CS2 listener took, or 0 when it is not running. */
    port: number;
    /** Where the CS2 config was written, if it was. */
    configPath: string;
    /** Whether the League poller is running. */
    league: boolean;
    /** What went wrong, for the settings panel to show. */
    problems: string[];
}

/** The first port tried for the CS2 listener, and how many are tried after it. */
const FIRST_PORT = 34765;
const PORT_TRIES = 6;

/** A CS2 state post is a few kilobytes; anything of this size is not one. */
const MAX_BODY = 256 * 1024;

/** How often League is asked what has happened. */
const LEAGUE_MS = 2000;

/** And how long one of those requests is given. */
const LEAGUE_TIMEOUT = 1500;

const LEAGUE_HOST = "127.0.0.1";
const LEAGUE_PORT = 2999;

/** The config written into the game's folder. Named so it is obvious whose it is. */
const CS2_CONFIG = "gamestate_integration_clipper.cfg";

let server: Server | null = null;
let port = 0;
let configPath = "";
let leagueTimer: ReturnType<typeof setInterval> | null = null;
let problems: string[] = [];

let queued: GameEvent[] = [];
let waiters: Array<(event: GameEvent | null) => void> = [];

/** What is actually up, so asking for the same thing again changes nothing. */
let listening = { cs2: false, league: false };

/**
 * The tail of the queue every start is put through, so none of them overlap.
 *
 * A flag saying one is in flight is not enough. Two callers waiting on the same
 * flag both see it clear on the same turn and both go on to bind a socket, and
 * a queue is the only shape of this that has no such turn.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Hands an event to whoever is polling, or keeps it for the next poll.
 *
 * One event, one poller, exactly as the keybinds do it: waking every parked
 * call would drop a marker once per stale poll left over from a client reload.
 */
function emit(event: GameEvent): void {
    const next = waiters.shift();

    if (next) {
        next(event);
        return;
    }

    queued.push(event);
    if (queued.length > 16) queued.shift();
}

/* ------------------------------------------------------- Counter-Strike 2 --- */

interface Cs2Payload {
    provider?: { steamid?: string; };
    player?: {
        steamid?: string;
        team?: string;
        match_stats?: { kills?: number; deaths?: number; };
    };
    round?: { phase?: string; win_team?: string; };
    map?: { round?: number; };
}

/** The last numbers seen, so a post can be compared against the one before it. */
let cs2 = { kills: -1, deaths: -1, round: -1, roundKills: 0, announced: 0 };

function resetCs2(): void {
    cs2 = { kills: -1, deaths: -1, round: -1, roundKills: 0, announced: 0 };
}

/** What a run of kills in one round is called. */
function multiKillName(count: number): string {
    if (count >= 5) return "an ace in Counter-Strike 2";
    if (count === 4) return "a 4K in Counter-Strike 2";
    return "a 3K in Counter-Strike 2";
}

/**
 * Turns one state post into events.
 *
 * The game posts its whole state on every change, so everything here is a
 * difference against the last one. Nothing is emitted on the first post of a
 * session: that one is the score as it already stood, not something that just
 * happened.
 */
function onCs2(payload: Cs2Payload): void {
    const me = payload.provider?.steamid;
    const { player } = payload;

    // No player block on a menu post, and a different steamid means the game is
    // showing somebody else - a spectated player, or a demo.
    if (!player || !me || !player.steamid || player.steamid !== me) return;

    const stats = player.match_stats;
    if (!stats || typeof stats.kills !== "number" || typeof stats.deaths !== "number") return;

    const round = typeof payload.map?.round === "number" ? payload.map.round : cs2.round;

    // A new match, or the score went backwards: start again rather than
    // reporting the whole scoreboard as things that just happened.
    if (stats.kills < cs2.kills || stats.deaths < cs2.deaths) resetCs2();

    // Read after the reset, not before it: a post that arrives with a score
    // already on it - a reconnect, a match joined in progress - is the state as
    // it stands and not a dozen kills that just happened.
    const first = cs2.kills < 0;

    if (round !== cs2.round) {
        cs2.round = round;
        cs2.roundKills = 0;
        cs2.announced = 0;
    }

    const kills = stats.kills - Math.max(0, cs2.kills);
    const deaths = stats.deaths - Math.max(0, cs2.deaths);

    cs2.kills = stats.kills;
    cs2.deaths = stats.deaths;

    if (first) return;

    if (kills > 0) {
        cs2.roundKills += kills;

        if (cs2.roundKills >= 3 && cs2.roundKills > cs2.announced) {
            cs2.announced = cs2.roundKills;
            emit({ kind: "multikill", note: multiKillName(cs2.roundKills) });
        } else {
            emit({ kind: "kill", note: kills > 1 ? "a double kill in Counter-Strike 2" : "a kill in Counter-Strike 2" });
        }
    }

    if (deaths > 0) emit({ kind: "death", note: "your death in Counter-Strike 2" });

    const win = payload.round?.win_team;
    if (win && player.team && win === player.team && payload.round?.phase === "over") {
        // Only the rounds you had a hand in: every other round win is a marker
        // on a screen where nothing is happening.
        if (cs2.roundKills > 0) emit({ kind: "roundwin", note: "a round you won in Counter-Strike 2" });
    }
}

/**
 * Starts the listener the game will post to.
 *
 * Bound to the loopback interface, so nothing off the machine can reach it. Any
 * program on the machine still can, and the worst it could do with that is drop
 * a marker in a clip, which is why nothing here does anything but count.
 */
function startServer(): Promise<number> {
    return new Promise(resolve => {
        let attempt = 0;

        const listener = createServer((req, res) => {
            if (req.method !== "POST") {
                res.writeHead(405).end();
                return;
            }

            let body = "";
            let over = false;

            req.on("data", (chunk: Buffer) => {
                if (over) return;

                body += chunk.toString("utf8");
                if (body.length > MAX_BODY) {
                    over = true;
                    body = "";
                    req.destroy();
                }
            });

            req.on("end", () => {
                res.writeHead(200).end();
                if (over) return;

                try {
                    onCs2(JSON.parse(body) as Cs2Payload);
                } catch {
                    // Not our JSON, or not JSON at all. Nothing to do about it.
                }
            });

            req.on("error", () => void 0);
        });

        listener.on("error", (e: NodeJS.ErrnoException) => {
            // Something else has the port: try the next few before giving up.
            if (e.code === "EADDRINUSE" && ++attempt < PORT_TRIES) {
                listener.listen(FIRST_PORT + attempt, "127.0.0.1");
                return;
            }

            problems.push(`The Counter-Strike listener could not open a port (${e.code ?? e.message})`);
            try {
                listener.close();
            } catch {
                // Never opened.
            }

            resolve(0);
        });

        listener.on("listening", () => {
            server = listener;
            resolve((listener.address() as { port: number; }).port);
        });

        listener.listen(FIRST_PORT, "127.0.0.1");
    });
}

/** Every Steam library on this machine, best guess first. */
function steamLibraries(): string[] {
    const roots: string[] = [];
    const home = homedir();

    if (process.platform === "win32") {
        const files = [process.env["ProgramFiles(x86)"], process.env.ProgramW6432, process.env.ProgramFiles];
        for (const dir of files) if (dir) roots.push(join(dir, "Steam"));
    } else if (process.platform === "darwin") {
        roots.push(join(home, "Library", "Application Support", "Steam"));
    } else {
        roots.push(join(home, ".steam", "steam"), join(home, ".local", "share", "Steam"));
    }

    const found: string[] = [];

    for (const root of roots) {
        if (!existsSync(root)) continue;
        found.push(root);

        // Games are often on another drive, and Steam keeps the list of drives
        // in this file. Read for the paths only: a full VDF parser for one field
        // is not worth carrying.
        try {
            const vdf = readFileSync(join(root, "steamapps", "libraryfolders.vdf"), "utf8");

            for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
                const path = match[1].replace(/\\\\/g, "\\");
                if (path && !found.includes(path)) found.push(path);
            }
        } catch {
            // No file, or no libraries beyond this one.
        }
    }

    return found;
}

/** Where Counter-Strike 2 keeps its configs, or an empty string. */
function cs2ConfigDirectory(): string {
    for (const library of steamLibraries()) {
        const dir = join(library, "steamapps", "common", "Counter-Strike Global Offensive", "game", "csgo", "cfg");
        if (existsSync(dir)) return dir;
    }

    return "";
}

/**
 * Writes the config that makes the game post to us.
 *
 * Rewritten every time rather than left alone, because the port it names can
 * change between runs when something else took ours.
 */
function writeCs2Config(at: number): string {
    const dir = cs2ConfigDirectory();
    if (!dir) {
        problems.push("Counter-Strike 2 is not installed where Steam usually puts it, so its config was not written");
        return "";
    }

    const file = join(dir, CS2_CONFIG);

    const body = `"Clipper"
{
    "uri"       "http://127.0.0.1:${at}/"
    "timeout"   "5.0"
    "buffer"    "0.1"
    "throttle"  "0.5"
    "heartbeat" "60.0"
    "auth"      { }
    "data"
    {
        "provider"           "1"
        "player_id"          "1"
        "player_state"       "1"
        "player_match_stats" "1"
        "map"                "1"
        "round"              "1"
    }
}
`;

    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, body, "utf8");
        return file;
    } catch (e) {
        problems.push(`Counter-Strike 2's config could not be written (${(e as Error).message})`);
        return "";
    }
}

/* ------------------------------------------------------ League of Legends --- */

let leagueMe = "";
let leagueSeen = -1;
let leagueWarned = false;
let leaguePolling = false;

/**
 * A player name reduced to the part both endpoints agree on.
 *
 * `activeplayername` answers with the full Riot ID - the tagline included on
 * current patches - while the event list names people without it. Comparing
 * the two as they come back means never recognising yourself, and the failure
 * is silent: no events, no error, and a poller that looks healthy. So both
 * sides are cut at the tag and cased down before they are compared.
 */
function riotName(name: string): string {
    return name.split("#")[0].trim().toLowerCase();
}

/** One GET against the game's own server, or null when it is not running. */
function leagueGet(path: string): Promise<unknown> {
    return new Promise(resolve => {
        const request = httpsGet({
            host: LEAGUE_HOST,
            port: LEAGUE_PORT,
            path,
            // Riot signs this with its own certificate for a name that is not
            // this host. Only ever for 127.0.0.1:2999, and only for reading.
            rejectUnauthorized: false,
            timeout: LEAGUE_TIMEOUT
        }, response => {
            if (response.statusCode !== 200) {
                response.resume();
                resolve(null);
                return;
            }

            let body = "";
            response.setEncoding("utf8");
            response.on("data", chunk => {
                body += chunk;
                if (body.length > MAX_BODY) request.destroy();
            });
            response.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch {
                    resolve(null);
                }
            });
        });

        request.on("timeout", () => request.destroy());
        // Not in a game: the server is simply not there, which is the normal case.
        request.on("error", () => resolve(null));
    });
}

interface LeagueEvent {
    EventID?: number;
    EventName?: string;
    KillerName?: string;
    VictimName?: string;
    Acer?: string;
    Recipient?: string;
    KillStreak?: number;
    DragonType?: string;
}

/** What one League event is worth, or null when it is not about you. */
function readLeagueEvent(event: LeagueEvent, me: string): GameEvent | null {
    const name = event.EventName ?? "";
    const killer = riotName(event.KillerName ?? "");

    switch (name) {
        case "ChampionKill":
            if (killer === me) return { kind: "kill", note: "a kill in League of Legends" };
            if (riotName(event.VictimName ?? "") === me) return { kind: "death", note: "your death in League of Legends" };
            return null;

        case "Multikill":
            if (killer !== me) return null;
            return { kind: "multikill", note: `a ${event.KillStreak ?? 3}-kill run in League of Legends` };

        case "Ace":
            if (riotName(event.Acer ?? "") !== me) return null;
            return { kind: "multikill", note: "an ace in League of Legends" };

        case "FirstBlood":
            if (riotName(event.Recipient ?? "") !== me) return null;
            return { kind: "kill", note: "first blood in League of Legends" };

        case "DragonKill":
            if (killer !== me) return null;
            return { kind: "objective", note: `${event.DragonType ? `the ${event.DragonType.toLowerCase()} dragon` : "a dragon"} in League of Legends` };

        case "BaronKill":
            if (killer !== me) return null;
            return { kind: "objective", note: "baron in League of Legends" };

        case "HeraldKill":
            if (killer !== me) return null;
            return { kind: "objective", note: "the herald in League of Legends" };

        case "TurretKilled":
        case "InhibKilled":
            if (killer !== me) return null;
            return { kind: "objective", note: "a structure in League of Legends" };

        default:
            return null;
    }
}

/**
 * Asks the game what has happened since the last time it was asked.
 *
 * The event list is the whole game from the start, so the first poll of a game
 * only takes note of where the list has got to. Everything after that is new.
 */
async function pollLeague(): Promise<void> {
    // Two requests of up to a second and a half each, on a two second timer:
    // one poll can still be reading the event list when the next is due. Both
    // would see the same events against the same high-water mark, and every
    // kill would be reported twice.
    if (leaguePolling) return;
    leaguePolling = true;

    try {
        if (!leagueMe) {
            const who = await leagueGet("/liveclientdata/activeplayername");
            if (typeof who !== "string" || !who) return;

            leagueMe = riotName(who);
            leagueSeen = -1;
        }

        const data = await leagueGet("/liveclientdata/eventdata") as { Events?: LeagueEvent[]; } | null;

        // The game closed, or has not started: forget who we were, so the next
        // one is looked up again.
        if (!data?.Events) {
            leagueMe = "";
            return;
        }

        const first = leagueSeen < 0;
        let highest = leagueSeen;

        for (const event of data.Events) {
            const id = typeof event.EventID === "number" ? event.EventID : -1;
            if (id <= leagueSeen) continue;

            highest = Math.max(highest, id);
            if (first) continue;

            const scored = readLeagueEvent(event, leagueMe);
            if (scored) emit(scored);
        }

        leagueSeen = highest;
    } finally {
        leaguePolling = false;
    }
}

function startLeague(): void {
    leagueMe = "";
    leagueSeen = -1;
    leaguePolling = false;

    leagueTimer = setInterval(() => {
        void pollLeague().catch(e => {
            if (leagueWarned) return;

            leagueWarned = true;
            problems.push(`League of Legends could not be read (${(e as Error).message})`);
        });
    }, LEAGUE_MS);
}

/* --------------------------------------------------------------- the feed --- */

/** Whether what is already up is what is being asked for. */
function alreadyUp(want: { cs2: boolean; league: boolean; }): boolean {
    if (want.cs2 !== listening.cs2 || want.league !== listening.league) return false;

    return (!want.cs2 || server !== null) && (!want.league || leagueTimer !== null);
}

/**
 * Starts the feeds the settings asked for. Safe to call again to re-sync.
 *
 * Asking for what is already running does nothing at all, and that matters more
 * than it sounds: this is called every time the clip buffer starts, and putting
 * the listener down and back up is not free. Closing a socket is asynchronous,
 * so the rebind arrives while the old one is still on the port, moves to the
 * next one and rewrites the config - and Counter-Strike, which read that config
 * when it launched, goes on posting to a port nobody is listening on. The feed
 * would die silently, on the second clip of the session, for no reason.
 */
export function startFeeds(want: { cs2: boolean; league: boolean; }): Promise<FeedStatus> {
    // Queued rather than joined to whatever is already running: a start may
    // have been asked for something else entirely, and a caller who wanted
    // League handed the result of a Counter-Strike start would be told it
    // succeeded and never get its own listener. Behind the queue, the test for
    // "already up" is the one that makes calling this on every clip free.
    const run = queue.then(async (): Promise<FeedStatus> => {
        if (alreadyUp(want)) return status();

        stopFeeds();
        problems = [];

        if (want.cs2) {
            resetCs2();
            port = await startServer();
            if (port) configPath = writeCs2Config(port);
        }

        if (want.league) startLeague();

        listening = { cs2: want.cs2 && server !== null, league: want.league };
        return status();
    });

    // The queue must not inherit a rejection, or every start after a failed one
    // would be dropped without running. The caller still gets the throw.
    queue = run.catch(() => undefined);

    return run;
}

function stopFeeds(): void {
    listening = { cs2: false, league: false };

    if (leagueTimer) clearInterval(leagueTimer);
    leagueTimer = null;
    leagueWarned = false;

    if (server) {
        try {
            server.close();
        } catch {
            // Already down.
        }
    }

    server = null;
    port = 0;
    configPath = "";
    queued = [];

    const waiting = waiters;
    waiters = [];
    for (const resolve of waiting) resolve(null);
}

/**
 * Puts everything down, once whatever is starting has finished starting.
 *
 * Queued for the same reason a start is. A stop landing in the middle of a bind
 * tears down what is up at that instant and then watches the bind it
 * interrupted finish and open a socket behind it - one nothing knows about any
 * more, holding a port, posting into a listener list that has been emptied.
 */
export function closeFeeds(): Promise<void> {
    const run = queue.then(() => stopFeeds());
    queue = run.catch(() => undefined);

    return run;
}

export function status(): FeedStatus {
    return { port, configPath, league: leagueTimer !== null, problems: [...problems] };
}

/** Resolves with the next event, or null once `timeoutMs` passes. */
export function waitForFeedEvent(timeoutMs: number): Promise<GameEvent | null> {
    const ready = queued.shift();
    if (ready) return Promise.resolve(ready);

    return new Promise(resolve => {
        let done = false;

        const settle = (event: GameEvent | null) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(event);
        };

        const timer = setTimeout(() => {
            waiters = waiters.filter(w => w !== settle);
            settle(null);
        }, timeoutMs);

        waiters.push(settle);
    });
}
