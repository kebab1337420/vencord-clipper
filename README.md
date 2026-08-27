# Clipper — Vencord user plugin

Free clipping plugin because i don't want to pay 10 bucks a month for basic features 👍👍👍👍👍👍👍👍👍👍
Runs a LOT better than alternatives like MidalTV 
usually takes up a couple % of GPU usage at most

obviously can't really make every single feature possible because it isn't a dedicated app (not really the point of the **plugin** but i might make it a seperated app in the future)


## Features

- Rolling in-memory buffer, configurable from 10s to 300s
- Four keybinds — save, start/stop, drop a marker, clip everyone's angle — all
  rebindable from the settings panel and registered system-wide, so they fire
  from inside a game. The picker takes combinations: it shows the modifiers as
  they are held, and it hands the system-wide binds back to the OS while it
  listens, so the combination being replaced reaches the picker instead of being
  swallowed on its way
- Quality controls: video bitrate (1–50 Mbps), audio bitrate (64–320 kbps),
  resolution (source / 2160p → 480p), frame rate (24 / 30 / 60 / 120)
- Container / codec choice: WebM VP9, WebM VP8, MP4 H.264
- Optional microphone mixed into the clip audio, matched to Discord's own voice
  settings: the input device Discord is set to, its input volume, echo
  cancellation, noise suppression and gain control, plus a noise gate that
  follows Discord's input sensitivity, so a clip taken alone carries your voice
  and not the room around it or the speaker bleed people hear as echo. The gate
  raises its own threshold while the captured system sound is loud, so a noisy
  game has to be shouted over rather than talked over, and a gentle compressor
  after it evens out the voice the way Discord does on its own side
- Settings grouped into sections — **Capture**, **Audio**, **Clips**,
  **Interface**, **Keybinds** — so every sound source sits under *Audio*
- Sound mixer in the **Audio** section: one slider (0–300%) and one mute per
  audio channel, with a live meter while the buffer runs. **System sound** is the
  captured source, **Microphone** is your own voice, and any input device can be
  added as its own channel. Moving a slider is heard in the clip being buffered
  right now, not only in the next one
- **One channel per person in the call**, under the same mixer, with a live
  meter each. Everybody is recorded on a track of their own beside the clip, so
  a level here is the level that person's own recording is added back at when
  the clip is put together, and a mute leaves their track out of the sum rather
  than filtering them out of a mix. It is saved with the clip and applied the
  moment it is opened in the studio, where it can still be changed. Unlike
  Discord's own per-user volume, none of it touches what you hear while you
  play
- Sound played when a clip is saved, built-in or any audio file of your own,
  with its own volume. The system channel is ducked for the length of it, so the
  sound confirms the clip without ending up inside it, and it never fires while
  a clip is being played back in the studio or the overlay.
- Built-in source picker with live previews, searchable, screens and windows
- Clip studio, one window for the whole clip folder and a light video editor.
  The left panel is the library: search, category filter, and for the picked
  clip *Add to the timeline*, *Show in folder*, *Rename*, *Delete* (to the
  trash) and *File it* under a category. Double-clicking a clip drops it
  straight on the timeline.
- On that timeline: chain several clips and imported MP4 / WebM / MOV / MKV
  files, trim, split, duplicate and reorder each segment, cut a range out of the
  montage from the ruler above it (drag to mark, *Cut out* to remove it, *Keep
  only* to throw away the rest; captions, overlays and sounds move with the
  picture), give it its own speed
  (0.25x–4x) and volume, add effects (brightness, contrast, saturation, black
  and white, blur, zoom, mirror, fade in / out), save the frame under the
  playhead as a PNG, lay captions over the result with their own size, colour,
  outline and position, then render the whole thing to a single file
  (480p–1440p, 24/30/60 FPS, audio optional). The timeline survives closing the
  studio and every edit can be undone with `Ctrl + Z`.
- **Cut the silence out in one click.** The clip carries a recording of who
  spoke and when, so the studio knows which stretches nobody said anything
  over and drops them, leaving a short pad around every word. What is left is
  the same montage with the dead air gone.
- **The sound lane ducks under speech.** A song laid under a montage is pulled
  down whenever somebody in the clip talks and let back up when they stop,
  from the same recording of the voices, with the depth of the duck yours to
  set.
- **The picture can move.** A shot can hold keys of its own: a zoom and a
  point to look at, at chosen moments, eased between. *Punch in on markers*
  writes those keys from the highlight markers, so the frame pushes in exactly
  where the moment was marked, and *Track the action* writes them from the
  picture itself — it walks the shot, follows where the movement is, and keeps
  the subject in frame.
- **Real transitions.** Two shots can dissolve into one another instead of
  cutting, over a length you choose. The last frame of the outgoing shot is
  held and mixed into the incoming one, which also takes the black flash the
  seek used to leave behind.
- **Reframe for phones.** One button turns a montage 9:16 and crops to it
  rather than adding pillar bars, and the moving framing above decides what
  the crop keeps — by hand, or from the action tracker.
- **Everybody's angle in one frame.** The angles the call posted in the
  channel can be pulled onto a shot and composed with it, as a grid or as a
  picture in picture. They are lined up automatically by cross-correlating how
  loud each recording is over time, so the same instant lands on the same
  frame, and a slider is there for when nothing in common can be found.
- **Best of the evening.** One button builds a montage out of the markers of
  every clip in the current view, taking moments in turn from each clip until
  it reaches the length asked for, back in the order they happened, with
  dissolves between them.
- **Cuts on the beat.** The seams of a montage can be snapped onto the beats
  of a chosen sound, without moving the sound itself; captions, overlays and
  the other sounds follow the picture.
- **The chat, burned into the picture.** What the channel said while the
  buffer was running is recorded beside the video and stored with the clip, and
  the render can draw the last lines over the frame, each one fading out a few
  seconds after it was sent.
- Clip categories: each clip is filed under the game Discord saw running when
  it was saved (the captured window's title as a fallback), stored in a
  `clipper-library.json` next to the clips. The studio filters the list by
  category and any clip can be refiled by hand.
- Studio shortcuts: `Space` plays the selected segment, `S` splits it, `I` and
  `O` mark a range on the ruler, `X` cuts that range out, `Shift + X` keeps only
  it, `D` duplicates the segment, `Delete` removes it, `←` / `→` step the
  playhead, `Ctrl + Z` and `Ctrl + Shift + Z` walk the edits, `Esc` closes
- **Automatic highlight markers.** The plugin listens to how loud the call and
  your own microphone are and drops a marker by itself when a moment stands out
  — several people talking over each other, or you shouting at your own screen.
  It measures against how loud the last minute was rather than a fixed
  threshold, so a lively call does not mark itself constantly, and it can be
  told to save a clip of those moments without being asked (at most one every
  two minutes).
- **Watch the buffer before you save it.** The actions menu plays a copy of
  what is in memory right now, with the markers drawn on the scrub bar and two
  handles to pick the piece worth keeping. The window you pick is what gets
  written, so a 30s buffer can become the 6s that mattered without a round trip
  through the studio.
- **Instant replay after a save.** The clip that was just written plays itself
  in the corner, muted and looping, next to the things anybody does about a clip
  they just watched: send it, turn its ending into a GIF, shorten it to 15s or
  30s, open it in the studio, or throw it away. It leaves on its own if it is
  ignored, and stays as long as the pointer is on it.
- **Send a clip straight to the channel, whatever size it is.** A clip that
  already fits is attached untouched. One that does not is re-encoded down to
  the limit first — the whole moment, softer, rather than the half of it that
  happened to fit. Resolution only comes down once the bitrate has been cut far
  enough that leaving it alone would spend it all on macroblocks.
- **GIF export.** The last seconds of a clip become a looping GIF small enough
  to post, written next to the clips and attached to the message box. The
  encoder is the plugin's own, with frame differencing and a median-cut palette,
  and the size is measured rather than estimated: it encodes, checks, and gives
  something up — frame rate first, then colours, and resolution last, because a
  GIF too small to read is worth nothing.
- **One key, everybody's angle.** Press the multi-POV bind and the plugin saves
  your clip and posts a message in the call's chat asking everyone else running
  Clipper to save theirs. There is no hidden payload: the message is plain text
  that says what it does, so the people without the plugin see exactly what you
  sent. Receivers cut their buffer to end where the request was *sent* rather
  than where it arrived, so the angles cover the same moment instead of drifting
  apart by the round trip. It is only accepted from somebody in the call you are
  currently in, only while your own buffer is already running, and at most once
  every ten seconds.
- Chat bar button — left click saves, right click starts/stops
- Floating button above the account panel — left click opens the source picker,
  right click opens the actions menu (start/stop, save, clip studio, buffer
  status)
- Vencord toolbox entries for the same actions
- Clips written straight to disk on the desktop app (configurable folder,
  defaults to `<Videos>/DiscordClips`), browser download as fallback

## What it looks like

The button sits above the account panel — left click opens the source picker,
right click opens the actions menu.

<p align="center">
  <img src="docs/images/overlay-button.png" alt="The Clipper button next to the mute, deafen and settings buttons of the account panel" width="384">
</p>

A second one lives in the chat bar, next to the gift and GIF buttons — left
click saves, right click starts or stops the buffer.

<p align="center">
  <img src="docs/images/chat-bar-button.png" alt="The Clipper button in the chat bar, among the gift, GIF and emoji buttons" width="384">
</p>

The picker lists screens and windows with a live preview, and carries the
capture settings that are worth changing often: frame rate, resolution,
encoding, quality and buffer length.

![The source picker, listing screens and windows with their previews](docs/images/source-picker.png)

The clip studio is the clip folder and the editor in one window: library on the
left, preview and timeline in the middle, the picked segment's trim, speed,
volume and effects on the right.

![The clip studio, a Counter-Strike clip on the timeline with the segment panel open](docs/images/clip-studio.png)

The right panel's other tabs cover the rest of a montage — captions, the sound
of the people in the call plus the mixer, images laid over the frame, and the
render settings.

| Captions | Audio |
| --- | --- |
| ![The Captions tab and its caption style controls](docs/images/studio-captions.png) | ![The Audio tab, with the people recorded in the montage and the sound mixer](docs/images/studio-audio.png) |
| **Images** | **Output** |
| ![The Images tab, placing a picture at the playhead](docs/images/studio-images.png) | ![The Output tab: size, frame rate and audio for the render](docs/images/studio-output.png) |

## Install

Windows, no toolchain: close Discord (and Vesktop), then run

```
install.bat
```

Nothing else is needed — no node, no pnpm, no Vencord clone. `prebuilt/dist` is
a finished Vencord build with Clipper compiled into it; the installer copies it
to `%APPDATA%\Vencord\clipper\dist`, patches Discord to load it (the real
`app.asar` is kept as `_app.asar`, which is exactly what the Vencord installer
does), and points Vesktop / Equibop at the same folder.

Start Discord, then enable **Clipper** in Vencord → Plugins.

Undo with `install.bat --uninstall`: Discord is unpatched, Vesktop's *Vencord
Location* is cleared, the copied bundle is deleted. Vencord settings and themes
in `%APPDATA%\Vencord` are left alone.

> The bundle **replaces** whatever Vencord install Discord was using, a dev one
> included. If you already run Vencord from a checkout, use the source install
> below instead, so your own build keeps its other plugins.

`prebuilt/build-info.json` records the Vencord version and commit the bundle was
built from. Vencord is GPL-3.0, sources at
<https://github.com/Vendicated/Vencord>.

### Source install

For a [Vencord dev install](https://docs.vencord.dev/installing/), or any
platform other than Windows:

```sh
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
mkdir -p src/userplugins
cp -r "<this repo>/src/userplugins/Clipper" src/userplugins/Clipper
pnpm build
pnpm inject   # only the first time
```

PowerShell equivalent for the copy step:

```powershell
Copy-Item -Recurse "<this repo>\src\userplugins\Clipper" "<Vencord>\src\userplugins\Clipper"
```

Restart Discord, then enable **Clipper** in Vencord → Plugins.

On Windows, `install.bat --source [path\to\Vencord]` does the copy, the build
and the Vesktop wiring for you, finding the checkout Discord is already patched
with when no path is given.

To refresh the shipped bundle after changing the plugin, run
`scripts\build-prebuilt.ps1 [-VencordDir <path>]`.

### Vesktop

Vesktop ships its own Vencord, so it has to be pointed at the build that
contains the plugin. Both installer modes do that for you — the prebuilt one at
the installed bundle, `--source` at the `dist` folder of the repo it just built.
It is written as `vencordDir` in Vesktop's `state.json`, under
`%APPDATA%\vesktop`. **Close Vesktop first** — it rewrites that file when it
exits, which would undo the change — then run the installer and start Vesktop
again.

By hand, or on Linux: build Vencord as above (no `pnpm inject`), then in
Vesktop **Settings → Vencord Location → the `dist` folder of your Vencord
clone**, and restart Vesktop. Enable **Clipper** in Vencord → Plugins as usual.

What differs there:

- Vesktop owns Electron's display-media handler for its own picker and its Linux
  audio capture, and Electron keeps only one. The plugin never takes it over, so
  capture goes through the legacy desktop constraints instead, and Vesktop's own
  picker is used as a last resort. Nothing about Vesktop's screen share changes.
- **Wayland** has no window list: `desktopCapturer` goes through
  xdg-desktop-portal, which pops a system dialog on every call. The plugin's own
  picker is empty there and says so — start the buffer and pick the source in
  the portal dialog. X11 lists screens and windows normally.
- **No per-application audio.** Chromium hands out the captured source's sound
  as one already-mixed loopback stream, so the game and the music cannot be told
  apart by the plugin. To give one app its own slider, send it to a virtual
  cable (VB-CABLE, Voicemeeter) and add that cable as a channel in the sound
  mixer. The people in a voice call are the exception, because they are also
  recorded one track per person: they get a channel each, applied when the clip
  is put back together rather than while the buffer runs.
- **System audio is Windows-only** on this capture path. On Linux the clip has
  the microphone (enable **Include mic**) but no desktop audio.
- **Wayland ignores application-registered hotkeys**, so the keybinds only fire
  while Discord is focused. Bind a compositor shortcut, or use the chat bar
  button.

## Updates

The plugin ships as a finished bundle, so it keeps itself current: at every
Discord launch it asks GitHub for the newest release and, when there is one,
offers it. Taking it downloads the release's bundle, checks every file against
the hashes the build recorded, swaps them into the installed folder and offers
a restart, which is when the new version actually loads.

Both halves are switches in the plugin settings, under *Updates*: **check at
launch** (on) and **install without asking** (off). The same panel shows the
installed version, a *Check now* button and the release notes; the toolbox has
*Check for a new Clipper version* as well. Nothing is downloaded by a check
alone.

An install that cannot write to its own folder says so instead of failing
quietly — run `install.bat` again in that case.

## Usage

| Action | Default |
| --- | --- |
| Start / stop the buffer | `Alt + F9`, panel button menu, chat bar button right click, or toolbox |
| Save the last N seconds | `Alt + F10`, panel or chat bar button left click, or toolbox |
| Trim, cut or montage clips | Panel button right click → *Open the clip studio*, or toolbox |
| Manage the clip folder | Same window: pick a clip on the left, then rename / reveal / delete / file it |
| Sort clips by game | Category dropdown above the clip list; *File it* refiles the picked clip |
| Find a clip | Search box above the clip list |
| Balance the clip audio | Plugin settings → *Audio* → *Sound mixer*, or the studio's *Audio* tab, live while recording |
| Add an audio source | Same section, *Add an audio source*, then pick the input device |
| Undo a montage edit | `Ctrl + Z`, `Ctrl + Shift + Z` to redo |
| Trim the selected segment | *From the playhead* under Start / End, or `←` / `→` then the same button |

Pick what to record from the plugin's own picker (overlay button, chat bar
button, or toolbox): the game window, or the whole screen if you alt-tab a lot.
System audio is captured for whole screens; enable **Include mic** to mix your
microphone in.

Avoid binding `Ctrl+R` or `Ctrl+Shift+R`: Chromium reloads the client on those
before any DOM listener runs, so the plugin never sees them.

Combinations are picked by holding the modifiers and pressing the key. The
picker shows what is held while it waits, and the plugin's system-wide binds are
unregistered for as long as it is open — otherwise the OS swallows the
combination that is already bound and the picker never sees the key it is being
asked to replace.

Keybinds are registered with the OS through Electron's `globalShortcut`, so they
fire while a game is focused, not only inside Discord. Turn **Global keybinds**
off in the settings to keep them Discord-only. A bind another application
already owns cannot be taken — the plugin says so with a toast and falls back to
firing it only while Discord is focused.

## Files

| File | Role |
| --- | --- |
| `index.tsx` | Plugin definition, in-client keybind listener, toolbox actions |
| `settings.tsx` | All settings + mime type resolution |
| `recorder.ts` | Capture, rolling buffer, saving |
| `clips.ts` | Clip folder access: listing, loading, renaming, deleting, frame export |
| `mixer.ts` | Audio channel levels and the input device list behind the sound mixer |
| `micInput.ts` | Opens the microphone Discord is set to, and gates it the way Discord gates it |
| `clipSound.ts` | The sound played on save, and the ducking that keeps it out of the clip |
| `library.ts` | Clip categories: game detection and the `clipper-library.json` sidecar |
| `studio.ts` | Timeline model and the montage render engine (canvas + WebAudio) |
| `webm.ts` | Rebases the buffered WebM timeline so saved clips start at zero |
| `globalKeybinds.ts` | System-wide keybind registration and dispatch |
| `highlights.ts` | Watches the call and the microphone, and marks the loud moments |
| `send.ts` | Attaching a clip to the message box, re-encoding it first when it is too big |
| `shrink.ts` | Re-encodes a clip down to a size limit through MediaRecorder |
| `gif.ts` | GIF89a encoder: median-cut palette, LZW, frame differencing |
| `gifExport.ts` | Turns part of a clip into a GIF that comes in under the limit |
| `multipov.ts` | Asks the call for everyone's angle, and answers the same request |
| `angles.ts` | Finds the angles posted in the channel, and fetches one to compose with |
| `chat.ts` | Rolling buffer of what the channel said, for the overlay burned into the render |
| `audio.ts` | Decoding, beat detection, time stretching and the envelope alignment |
| `components/BufferPreview.tsx` | Plays the live buffer and picks the window to save |
| `components/ReplayCard.tsx` | The clip that was just saved, playing back in the corner |
| `updater.ts` | Version check at launch, and the install that follows it |
| `native.ts` | Main process: file write, source listing, global shortcuts, bundle updates |
| `utils.ts` | Keybind parsing / accelerators, formatting helpers |
| `components/ClipperOverlay.tsx` | Floating button, source picker, capture options |
| `components/ClipStudio.tsx` | Clip library, categories, timeline, effects, captions, render |
| `components/AudioMixer.tsx` | Sound mixer rows, in the settings and in the studio sidebar |
| `components/VoicePanel.tsx` | One mixer channel per person in the call, with a live meter |
| `voiceRecord.ts` | One rolling buffer per person, saved as tracks beside the clip |
| `components/SettingsSection.tsx` | Section headers that group the settings panel |
| `components/ClipperChatButton.tsx` | Chat bar button |
| `components/KeybindInput.tsx` | Keybind picker used by the settings |
| `components/SaveDirectoryInput.tsx` | Clip folder picker used by the settings |
| `components/UpdateStatus.tsx` | Installed version, check / install / restart buttons |

## Known limitations

- **WebM timeline.** Clips are assembled from the container header plus the
  buffered clusters, and those clusters carry timecodes counted from the moment
  capture started — a buffer running for seven minutes used to write a 15s clip
  claiming to last seven, mostly empty, and often undecodable. `webm.ts` now
  rewrites the kept clusters so the clip starts at zero, drops anything older
  than a 3s gap (a starved or paused capture) and trims the head back to a
  keyframe, so the file opens on a decodable frame. The header still carries no
  duration field, so a few editors want a remux first:
  `ffmpeg -i clip.webm -c copy fixed.webm`. Rendering from the studio also
  produces a clean file, since that path re-encodes. MP4 recordings are left
  untouched: their fragments need a different parser.
- **The studio renders in real time**, because there is no muxer in the plugin:
  the timeline is played into one canvas and one audio mix, and a single MediaRecorder
  records the run, so a 2-minute montage takes 2 minutes. The preview plays one
  file at a time, so a dissolve and the extra angles of a shot only appear in
  the render. Sources of different shapes are letterboxed into the output
  rather than stretched, unless the segment is set to crop.
  Keep the window visible while it renders: a hidden window stops painting
  frames while the audio keeps running, and the two drift apart.
- **Imports are capped at 512 MB.** An imported file is read in the main
  process, copied across IPC and held in memory while the timeline is open, so
  a bigger one is refused rather than allowed to take the client down with it.
  MKV and some MOV files are also outside what Chromium decodes; remux them to
  MP4 first.
- **Game detection is Discord's.** Categories come from `RunningGameStore`, the
  same detection that drives the activity status, so a game Discord does not
  recognise (a browser game, an emulator) falls back to the captured window's
  title and may need refiling by hand. The categories live in
  `clipper-library.json` next to the clips: deleting that file loses the
  categories, not the clips.
- **Mic processing is Chromium's.** Discord mints its input device ids in its own
  native voice module and `getUserMedia` refuses them, so the plugin matches
  the device by name - and to do that it opens a plain capture first, because
  Chromium hands out no device names at all until the microphone has been
  granted once, and Discord's own voice never asks for it. It falls back to the
  system default when no name matches.
  **Check the microphone** in the plugin toolbox says which one it actually
  opened. The gate is the plugin's own: it reads Discord's input sensitivity but
  measures the level itself, so it opens and closes close to Discord's transmit
  indicator rather than exactly with it. Krisp is a separate native module
  Discord applies to its own voice connection only; it is not part of the
  capture, so heavy background noise may survive into the clip even when Krisp
  is on in Discord. The gate can be turned off in the settings, which records
  everything the microphone hears.
- **Memory use** scales with `clip length × video bitrate`. 300s at 50 Mbps is
  roughly 1.8 GB held in RAM — the defaults (30s at 8 Mbps) sit around 30 MB.
- **MP4 recording** depends on the Chromium build shipped with your Discord
  version. If MP4 is unsupported, starting the buffer fails; switch back to WebM.
- **Global keybinds are first come, first served.** If Steam, GeForce Experience
  or another overlay already registered the accelerator, Windows hands it to
  them and the bind only works while Discord is focused. Rebind to something
  free. Keys with no Electron accelerator name stay Discord-only as well.
- **Linux system audio.** Loopback capture through `getDisplayMedia` exists only
  on Windows, so clips recorded on Linux carry no desktop audio.
- Encoding is software-side (Chromium's MediaRecorder), so a high bitrate at
  120 FPS costs noticeably more CPU than a native GPU encoder would.
