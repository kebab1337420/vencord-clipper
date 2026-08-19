# Clipper — Vencord user plugin

Shadowplay-style clipping inside Discord. A rolling buffer keeps the last *N*
seconds of a captured source in memory; a keybind (or the chat bar button) dumps
that buffer to a video file. Capture never stops while you save.

## Features

- Rolling in-memory buffer, configurable from 10s to 300s
- Save keybind and start/stop keybind, both rebindable from the settings panel,
  registered system-wide so they fire from inside a game
- Quality controls: video bitrate (1–50 Mbps), audio bitrate (64–320 kbps),
  resolution (source / 2160p → 480p), frame rate (24 / 30 / 60 / 120)
- Container / codec choice: WebM VP9, WebM VP8, MP4 H.264
- Optional microphone mixed into the clip audio
- Built-in source picker with live previews, searchable, screens and windows
- Chat bar button — left click saves, right click starts/stops
- Vencord toolbox entries for the same two actions
- Clips written straight to disk on the desktop app (configurable folder,
  defaults to `<Videos>/DiscordClips`), browser download as fallback

## Install

Requires a [Vencord dev install](https://docs.vencord.dev/installing/).

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

### Vesktop

Vesktop ships its own Vencord, so it has to be pointed at the build that
contains the plugin. `install.bat` does that for you: it writes `vencordDir` in
Vesktop's `state.json` (`%APPDATA%esktop`), pointing at the `dist` folder of
the Vencord repo it just built. **Close Vesktop first** — it rewrites that file
when it exits, which would undo the change — then run `install.bat` and start
Vesktop again.

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
- **System audio is Windows-only** on this capture path. On Linux the clip has
  the microphone (enable **Include mic**) but no desktop audio.
- **Wayland ignores application-registered hotkeys**, so the keybinds only fire
  while Discord is focused. Bind a compositor shortcut, or use the chat bar
  button.

## Usage

| Action | Default |
| --- | --- |
| Start / stop the buffer | `Alt + F9`, panel button menu, chat bar button right click, or toolbox |
| Save the last N seconds | `Alt + F10`, panel or chat bar button left click, or toolbox |

Pick what to record from the plugin's own picker (overlay button, chat bar
button, or toolbox): the game window, or the whole screen if you alt-tab a lot.
System audio is captured for whole screens; enable **Include mic** to mix your
microphone in.

Avoid binding `Ctrl+R` or `Ctrl+Shift+R`: Chromium reloads the client on those
before any DOM listener runs, so the plugin never sees them.

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
| `globalKeybinds.ts` | System-wide keybind registration and dispatch |
| `native.ts` | Main process: file write, source listing, global shortcuts |
| `utils.ts` | Keybind parsing / accelerators, formatting helpers |
| `components/ClipperOverlay.tsx` | Floating button, source picker, capture options |
| `components/ClipperChatButton.tsx` | Chat bar button |
| `components/KeybindInput.tsx` | Keybind picker used by the settings |
| `components/SaveDirectoryInput.tsx` | Clip folder picker used by the settings |

## Known limitations

- **WebM duration metadata.** Clips are assembled from the container header plus
  the buffered clusters, so the duration field in the header stays at the value
  written when recording started. Players seek and play the file fine
  (browsers, VLC, mpv); some editors want a remux first:
  `ffmpeg -i clip.webm -c copy fixed.webm`.
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
