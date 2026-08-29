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
  meter each. Where a track of their own exists - Discord's clip engine writes
  one per person, and on a client that does voice over WebRTC each of them is
  recorded beside the clip - a level here is the level that person's own
  recording is added back at when the clip is put together, and a mute leaves
  their track out of the sum rather than filtering them out of a mix. Where the
  call only ever arrived mixed, a mute cannot be exact and does not pretend to
  be: it takes 15dB out of the band a voice lives in while that person is
  audible, so they go under the game instead of taking the game with them. It is
  saved with the clip and applied the moment it is opened in the studio, where it
  can still be changed. Unlike Discord's own per-user volume, none of it touches
  what you hear while you play
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
- **Or cut between them, which is what an edit is.** One button turns a shot
  and its angles into a run of shots that cut from one to the next: whoever the
  moment is happening to is the loudest angle of it, so the edit stays on them
  while it lands, and after their peak it cuts to somebody watching rather than
  back to the same screen. Every angle is judged against its own normal, so the
  person with their volume up does not simply hold the screen. Shots have a
  floor and a ceiling — fast, normal or slow — and what comes out is ordinary
  segments: trim them, drop one, or undo the whole edit in a single step.
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
- **Automatic highlight markers.** The plugin drops a marker by itself when a
  moment stands out, and nothing it reads is sound. The picture is watched for
  how much it is moving, a red wash for damage, the colour draining for a death
  screen and a cut to black; and the games that publish one are asked for their
  own account of what happened, which is worth more than every guess put
  together. Both of them are wrong about a room enjoying itself, which is the
  entire reason they are the two left.

  Loudness was the first detector and the worst one, in both of its forms. The
  call shouting is somebody swearing at their own bad play far more often than
  it is a moment. Listening to the game instead does not get around that,
  because there is one loopback stream and the call is inside it, so a room
  laughing puts enough through as gunfire to mark the evening every ninety
  seconds. Neither counts for anything now. `voiceHighlights` puts the room
  back and `gameAudioWatch` puts the game's sound back, for a quiet call or for
  playing alone. What is still measured is measured against the last minute
  rather than against a fixed threshold, so a busy evening does not slowly mark
  everything.
- **What the games say outright.** Counter-Strike 2 and League of Legends both
  ship a supported way to report their own events, and a kill the game reported
  beats every guess about one, so those mark immediately. Off by default: it
  writes a config file into Counter-Strike's `cfg` folder and opens a listener
  on `127.0.0.1` for the game to post to. Nothing leaves the machine. *Check
  what is watching the game* in the actions menu says what is actually hooked
  up. Every other game gets the sound and the picture, which need no setup.
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
- **Clipping from inside a headset**, if you ask for it. Most people have no
  headset, so this part is opt-in and starts switched off: nothing about it
  appears in the settings and nothing ever attaches to SteamVR until
  `VRinstaller.bat` is run (`VRinstaller.bat --uninstall` puts it back). Once it
  is on, four actions are offered to SteamVR, which puts Clipper in the same
  Controller Bindings panel every VR game is rebound from — the plugin draws no
  binding screen of its own because SteamVR already owns one, and a bind made
  there survives the plugin being reinstalled. Only two of the four start on a
  button, and both are on the right hand: double-tap B to save a clip, hold A to
  drop a marker. A double tap and a hold rather than a plain press, so a default
  never fires in the middle of a game — and nothing at all on the left hand,
  because a controller has about four buttons that are not already the game's.
  Starting the buffer and asking the call for their angle are offered too but
  start unbound; add a button for either in that panel. It attaches when a
  headset goes on and lets go when it comes off; Discord never starts SteamVR by
  itself. Whatever the plugin has to say is said in the headset too: a card a
  metre in front of you, for a few seconds, when a button is pressed and again
  when the clip it saved has a name — because every other way the plugin has of
  telling you is a toast on a monitor nobody in a headset can see. While it is
  attached, how fast the
  hands and head are actually moving is fed to the marker as corroboration — on
  its own it never marks anything, however hard you swing, because somebody
  playing a rhythm game swings for the whole song
- Chat bar button — left click saves, right click starts/stops
- Floating button above the account panel — left click opens the source picker,
  right click opens the actions menu (start/stop, save, clip studio, buffer
  status)
- Vencord toolbox entries for the same actions
- Clips written straight to disk on the desktop app (configurable folder,
  defaults to `<Videos>/DiscordClips`), browser download as fallback

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

If you play in VR, run

```
VRinstaller.bat
```

and restart Discord. That is the only thing that makes the SteamVR side exist:
without it there is no VR section in the settings, nothing looks for a headset,
and no bridge is ever started. It checks that SteamVR is installed and refuses
to change anything if it is not. `--uninstall` takes it back out, `--status`
says what is set up without touching anything.

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
| Clip from a VR controller | Double-tap **B** on the right controller; hold **A** for a marker. Plugin settings → *VR* → *Open SteamVR bindings* to change them or add more |

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

Seventy-three modules, so the full list lives in [`docs/modules.md`](docs/modules.md)
with a line about each and a short guide to which one a given problem starts
from. The shape of it:

| Where | What runs there |
| --- | --- |
| `index.tsx`, `settings.tsx` | The plugin definition and the settings the user sees |
| `native.ts` | The only file in the main process, and the plugin's only access to the disc, `ffmpeg` and the system keyboard |
| `recorder.ts`, `voiceRecord.ts`, `voiceTaps.ts`, `micInput.ts` | The rolling buffers, and the per-person audio that makes a clip remixable |
| `boxes.ts`, `mp4.ts`, `webm.ts`, `mux.ts`, `laneMix.ts` | Reading and repairing the files, byte by byte |
| `components/ClipStudio.tsx`, `studio.ts` | The editor, and the engine that renders what it describes |
| `components/ClipperOverlay.tsx` | The plugin's own React root, mounted outside Discord's tree |
| `overlayWindow.ts`, `gameOverlay.ts`, `studioOverlay.ts` | The always-on-top window that puts all of it over a full-screen game |
| `vr.ts`, `vrBridge.ts`, `vrHelper.ts`, `vrManifest.ts` | The SteamVR side: a controller press, and where the player's hands are |

Unit tests cover the byte-level readers, the part that fails without saying
anything. Run them with `.\scripts\test.ps1`.

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
- **The VR side is opt-in, but it is not a separate download.** It ships in the
  same bundle as everything else and `VRinstaller.bat` only decides whether it
  runs — so the settings stay clean and nothing starts, but the bundle is the
  same few dozen kilobytes larger either way.
- **VR is controls and motion, not capture.** The SteamVR side gets a press off
  a controller and reads where the hands and head are; it does not change what is
  recorded. The picker still captures a window, which for a VR game is the
  desktop mirror — one eye, barrel-distorted and letterboxed, and some games do
  not draw it at all. Nothing is stabilised either, so raw headset footage is
  rough to watch back. What is drawn in the headset is a notice and nothing
  more: a few seconds of text saying what just happened, not an interface — you
  cannot point at it, and the binding panel the settings open is SteamVR's own.
  It needs a SteamVR new enough to have `IVROverlay`, and an older one simply
  goes without the card. The game
  integrations are dead weight in VR as well — no VR game reports its kills the
  way Counter-Strike does. It needs Windows, since the bridge is a PowerShell
  script compiling C# against the .NET Framework, and a SteamVR recent enough to
  have `IVRInput`; an older one says so in the settings row instead of failing
  silently.
- **Linux system audio.** Loopback capture through `getDisplayMedia` exists only
  on Windows, so clips recorded on Linux carry no desktop audio.
- Encoding is software-side (Chromium's MediaRecorder), so a high bitrate at
  120 FPS costs noticeably more CPU than a native GPU encoder would.
