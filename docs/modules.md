# The module map

Seventy-one files, about thirty-four thousand lines. The root `README.md` says what
the plugin does for the person using it; this says where each part of it lives,
so that a change can start from the right file instead of from a search.

Line counts are there to set expectations, not as a target. They are the
figures at the time of writing and will drift.

## The shape of it

A Vencord plugin is split across two processes. `native.ts` is the only file
that runs in the main process, and every value it exports becomes an IPC
handler the renderer can call — that is the whole of the plugin's access to the
disc, to `ffmpeg` and to the operating system's keyboard. Everything else runs
in the renderer, inside Discord's own page, and reaches the file system only
through those handlers.

The renderer half has three long-lived pieces:

- **The recorder** keeps the last N seconds of screen and sound in memory and
  never stops while the plugin is on.
- **The overlay** is a React root of its own, attached to `<body>` rather than
  to Discord's tree, so a throw in it cannot take the client down with it.
- **The studio** is opened from the overlay, edits a saved clip, and renders a
  new file out of it.

A fourth piece is optional: the **game overlay**, a separate always-on-top
window that shows the same controls over a full-screen game.

## Entry points

| File | Lines | What it is |
| --- | --- | --- |
| `index.tsx` | 313 | The plugin definition: what starts, what stops, and where the overlay root is mounted. |
| `native.ts` | 1363 | The main process half. Path safety, size caps and every file, `ffmpeg` and keybind operation the renderer asks for. |
| `settings.tsx` | 433 | The settings the user sees, and their defaults. |

## Capture

Everything that produces bytes while nothing is being edited.

| File | Lines | What it is |
| --- | --- | --- |
| `recorder.ts` | 2602 | The rolling buffer: the capture stream, the timeslices, the ring, and saving a clip out of it. |
| `voiceRecord.ts` | 361 | One rolling buffer per person in the call, so a clip can be remixed after the fact. |
| `voiceTaps.ts` | 428 | Taking each speaker's audio before Discord mixes it down. |
| `micInput.ts` | 946 | The microphone, taken the way Discord itself takes it, including its processing settings. |
| `clipSound.ts` | 238 | The sound the plugin makes when a clip is saved. |
| `encoders.ts` | 205 | Asking the browser which codecs it will actually accept, rather than assuming. |
| `game.ts` | 90 | What is being played and when that changes, which is what names a clip. |
| `nativeClips.ts` | 1162 | Discord's own clip recorder: reading its clips, its metadata and its folder. |

## What is a moment

The automatic marker. Several detectors vote, one board totals them, one watcher
decides. Nothing that listens votes by default: the room and the game's own
sound both marked a good evening every ninety seconds, so both are off unless
asked for, and a marker comes from the picture or from the game saying so.

| File | Lines | What it is |
| --- | --- | --- |
| `highlights.ts` | 358 | The judge: the bar, the hold, the cooldown, and what the room is worth against the rest. |
| `signals.ts` | 265 | The board every detector pins to. Levels fade, events decay, testimony jumps the queue. |
| `gameAudio.ts` | 215 | Telling a gunshot from a shout by the shape of the sound. Off: the call is in the same stream. |
| `gameVideo.ts` | 326 | Motion, red washes, colour draining and cuts to black, on a 64x36 copy of the frame. |
| `gameEvents.ts` | 147 | The renderer half of the game integrations: a long poll, straight onto the board. |
| `gameFeeds.ts` | 674 | Main process. Counter-Strike 2's state posts, League of Legends' live client API. |

## Reading and repairing files

The byte-level half. This is the code that fails silently — its bugs produce no
message, only a file that will not open — and it is the part the tests cover.

| File | Lines | What it is |
| --- | --- | --- |
| `boxes.ts` | 81 | The one careful walk over an MP4 box list, shared by everything that reads one. |
| `mp4.ts` | 537 | Fragmented MP4: rebasing a buffer to zero, cutting a range out losslessly, reading a length and the audio tracks. |
| `webm.ts` | 388 | The same repair for WebM, for the encoders that only offer it. |
| `mux.ts` | 771 | Putting the plugin's picture and the engine's separate audio tracks into one file. |
| `nativeTracks.ts` | 360 | Pulling one person's audio track out of a native clip. |
| `laneMix.ts` | 1187 | Rebuilding a clip out of its separate tracks, with each person at the level asked for. |
| `repair.ts` | 78 | Picks the repair that suits the container and gets out of the way. |
| `shrink.ts` | 274 | Making a clip small enough for the channel's upload limit. |
| `gif.ts` | 435 | GIF89a, written by hand, because no encoder here produces one. |
| `gifExport.ts` | 244 | Turning a piece of a clip into a GIF small enough to send. |
| `thumbnail.ts` | 119 | The still frame that stands for a clip in the library. |

## The studio

| File | Lines | What it is |
| --- | --- | --- |
| `components/ClipStudio.tsx` | 5913 | The editor itself: the timeline, every panel, and every keystroke. The largest file here by a distance. |
| `studio.ts` | 2829 | The render engine. Draws the project to a canvas in real time and records it. |
| `assets.ts` | 168 | The shelf of sounds and pictures kept between sessions. |
| `audio.ts` | 593 | Sounds laid on the timeline: decoding, waveforms and playback. |
| `mixer.ts` | 181 | The mixer model the settings and the studio share. |
| `voiceMix.ts` | 188 | One file's separated soundtrack, kept around so it is not rebuilt on every scrub. |
| `voiceBand.ts` | 188 | Turning one voice down without turning the whole clip down with it. |
| `components/AudioTimeline.tsx` | 202 | The sound lane. |
| `components/CutRuler.tsx` | 171 | The ruler and its cut marks. |
| `components/VoiceLanes.tsx` | 138 | Who was talking, drawn under the timeline. |

## The overlay and the panels

| File | Lines | What it is |
| --- | --- | --- |
| `components/ClipperOverlay.tsx` | 1145 | Everything mounted in the plugin's own React root: the button, the replay card, the studio's mount point. |
| `components/ReplayCard.tsx` | 139 | The clip that was just saved, playing straight back. |
| `components/BufferPreview.tsx` | 218 | Watching the buffer before deciding to write it. |
| `components/VoicePanel.tsx` | 225 | One channel per person in the call. |
| `components/AudioMixer.tsx` | 368 | The mixer rows in the plugin settings. |
| `components/Meter.tsx` | 48 | What a channel is sending, right now. |
| `components/KeybindInput.tsx` | 162 | The keybind picker. |
| `components/ClipSoundInput.tsx` | 124 | The clip-sound row in the settings. |
| `components/SaveDirectoryInput.tsx` | 72 | The clip-folder row in the settings. |
| `components/SettingsSection.tsx` | 42 | A section header in the settings. |
| `components/UpdateStatus.tsx` | 98 | The version row, and the update it offers. |
| `components/ClipperChatButton.tsx` | 62 | The button in the chat bar. |
| `components/dragWindow.ts` | 45 | A drag that keeps following the pointer once it leaves the element. |

## In a headset

SteamVR, for the person who cannot see any of the above because they are wearing
a headset. The controller binds are the point; the motion is a side effect of
having to open an OpenVR session for them anyway.

All of it is switched off until `VRinstaller.ps1` at the repository root sets
`vrInstalled` in the client's `settings.json`. Everything below is compiled into
the bundle regardless — there is one build — but with that setting clear the VR
settings are hidden, `syncVr` returns immediately, and no bridge is spawned.

| File | Lines | What it is |
| --- | --- | --- |
| `vr.ts` | 210 | The renderer half: a controller press becomes the same action a keybind fires, and the player's own body becomes a signal. |
| `vrBridge.ts` | 395 | Main process. Starts the bridge, restarts it when a headset goes on, and long-polls the same way the game feeds do. |
| `vrHelper.ts` | 421 | The bridge itself: C# compiled at first run by PowerShell, calling OpenVR through its function tables. |
| `vrManifest.ts` | 231 | The action manifest, the default bindings and the application manifest, which is what puts Clipper in SteamVR's own binding panel. |
| `components/VrBindings.tsx` | 88 | The settings row: whether SteamVR is attached, and the button that opens that panel. |

## Over the game

The always-on-top window, and the two files that decide what it draws.

| File | Lines | What it is |
| --- | --- | --- |
| `overlayWindow.ts` | 389 | The window itself and what the plugin draws in it. |
| `gameOverlay.ts` | 292 | The renderer's side: what to show, and what came back. |
| `studioOverlay.ts` | 608 | The cutting room, over the game. |
| `overlayEdit.ts` | 148 | Carrying out what the overlay editor asked for. |
| `globalKeybinds.ts` | 167 | System-wide keybinds, which only work from the main process. |

## The call, the library, and everything else

| File | Lines | What it is |
| --- | --- | --- |
| `voice.ts` | 730 | Who is in the voice channel, and what Discord says they are doing. |
| `multipov.ts` | 357 | One key press, everybody's angle. |
| `angles.ts` | 114 | The angles other people posted for the same moment. |
| `angleCut.ts` | 384 | Cutting between those angles: who is on screen, second by second, and one soundtrack under it. |
| `chat.ts` | 208 | What the chat said while it was happening. |
| `clips.ts` | 329 | Access to the clip folder. |
| `library.ts` | 408 | Clip metadata and categories. |
| `send.ts` | 163 | Sending a clip to the channel that is open. |
| `updater.ts` | 275 | Checking for a new version and installing it. |
| `utils.ts` | 272 | The shared helpers that had no better home. |

## Where to start

- **A clip came out broken.** `repair.ts` picks the path; the work is in
  `mp4.ts` or `webm.ts`. Run `.\scripts\test.ps1` before and after.
- **A clip came out with the wrong sound.** `laneMix.ts` if it came from the
  client's own recorder, `mux.ts` if it came from the plugin's, `voiceBand.ts`
  if one person is at the wrong level.
- **Something in the editor is wrong.** `components/ClipStudio.tsx` for what is
  on screen and what a key does, `studio.ts` for what ends up in the file.
- **Nothing is being captured.** `recorder.ts` first, then `encoders.ts` to see
  whether the codec was refused.
- **A marker dropped where nothing happened, or did not drop where something
  did.** `highlights.ts` holds the bar, and decides whether anything that
  listens is allowed to count at all; `signals.ts` says what each detector is
  worth. The detector itself is `gameVideo.ts` or `gameFeeds.ts`, and
  `gameAudio.ts` if it was turned on.
- **A multi-angle edit cut in the wrong place.** `angleCut.ts` decides who is on
  screen; `angles.ts` is what it had to choose between, and `audio.ts` lined
  them up.
- **A controller bind does nothing.** `vrBridge.ts` says whether it ever
  attached; the binding itself belongs to SteamVR, and `vrManifest.ts` is only
  what it was offered to start from.
- **It cannot read or write a file.** `native.ts`. Nothing else can.

## Tests

`tests/` at the repository root, run with `.\scripts\test.ps1`. They cover
`boxes.ts` and `mp4.ts` — the readers that fail without saying anything — and
build their MP4s from the specification rather than from a captured file, so a
reader is never tested against its own assumptions. Everything else in the
plugin needs a browser, a canvas or Discord's own modules and is not reachable
from a bare Node process.

The directory sits outside `src/`, so the mirror into the local Vencord
checkout cannot carry test files into a build.
