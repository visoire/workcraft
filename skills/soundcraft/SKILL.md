---
name: soundcraft
description: Use this skill whenever the user mentions SoundCraft (the ArtCraft clean-room Pro Tools reimplementation), or wants to record, edit, mix, bounce, import/export or script audio with it — including questions about its file formats (.scraft/.scraftz sessions, WAV/AIFF/FLAC bounce, MIDI/MusicXML exports), keyboard shortcuts, the soundcraft-cli tool, its MCP server or JSON control channel, preparing importable audio/MIDI/video, repairing or isolating session files, or verifying its output. Trigger even when the app is not named but the task is DAW audio with SoundCraft installed; do not use it for Avid Pro Tools itself or other DAWs.
---

# SoundCraft

## Overview

SoundCraft is a clean-room, pure-Rust digital audio workstation that reimplements Avid Pro Tools
workflows (Edit/Mix windows, edit modes and tools, playlists, memory locations, AudioSuite,
bounce), aiming for parity and beyond via full scriptability. It is one of the ArtCraft "Crafting
Apps", authored at GitHub `storytold/soundcraft` (`README.md`). Stage: **pre-alpha** — the core
workflow gate fails on three rows (interface recording, MIDI recording, session interchange), so
treat every feature as moving (`ROADMAP.md`, `docs/roadmap.md`). It runs natively on
macOS/Windows/Linux/FreeBSD and as WebAssembly in a browser (`apps/soundcraft-web`). The authoring machine
has the launcher-installed app at `/Applications/SoundCraft.app` (bundle `ai.storyteller.soundcraft`,
version **0.6.1**) while this repo's HEAD declares workspace version **0.7.0** — verify against your
installed version.

## Capabilities (verified)

Everything user-visible is a **command** with an id and JSON params, dispatched identically from
menus, keyboard, CLI, the control channel and MCP (`crates/engine/src/cmd/mod.rs`;
`docs/control-protocol.md`). ~296 unique command ids exist at HEAD (a test enforces >150:
`cmd/mod.rs` `ids_are_unique_and_documented`); `soundcraft-cli commands [FILTER]` lists them live.

**Editing** (`crates/engine/src/cmd/edit.rs`, `edit_more.rs`, `clip*.rs`; `crates/ui-egui/src/shortcuts.rs`)
- Edit modes Shuffle/Slip/Spot/Grid/Grid-relative (`F1`–`F4`, `Alt+1-4`, backtick cycles; F4
  toggles Absolute/Relative grid).
- Tools Zoom/Trim/Selector/Grabber/Scrubber/Pencil (`F5`–`F10`) plus Smart tool
  (`edit.tool`; `edit.rs` shortcut families).
- cut/copy/paste, clear, duplicate (`Cmd+D`), repeat, shift, insert silence, separate at
  selection/on grid/at transients (`Cmd+E`), heal, trim to selection, consolidate, strip
  silence, nudge, fades and crossfades in five shapes, clip gain lines, playlists with comping
  lanes, edit groups, clip rating/lock/group (`.scgrp` files via `clip_group_file.rs`).
- Undo for every document-changing command; queries/view settings excluded (`cmd/mod.rs`
  `journal`/`undoable`, `Engine::execute` in `crates/engine/src/lib.rs`).

**Mixing and automation** (`crates/engine/src/cmd/mix.rs`, `crates/model/src/mixer.rs`)
- 10 insert slots and 10 send slots per track (`INSERT_SLOTS`/`SEND_SLOTS` = 10), busses, aux
  inputs, master faders, VCA masters, routing folders; solo/mute, phase invert, clip effects,
  plugin delay compensation (`docs/architecture.md`).
- Breakpoint automation for volume, pan, mute, sends and plugin parameters; Write/Touch/Latch/
  Trim modes; thin, glide, coalesce, convert to clip gain (`cmd/mix.rs` `automation.*`).

**Built-in plugins and hosting** (`crates/dsp/src/plugins/mod.rs` registry)
- 27 built-ins: 24 processors (1/7-band EQ, compressor, expander/gate, de-esser, maximizer,
  channel strip, room/plate reverb, mod delay, chorus, flanger, phaser, saturator, lo-fi,
  rectifier, pitch shifter, time shift, gain, trim, invert, DC removal, signal generator,
  dither) + 3 instruments (subtractive synth, drum synth, sampler). `soundcraft-cli plugins`
  prints the list with ids.
- Third-party hosting: CLAP (`crates/clap-host`), VST3 (`crates/vst3-host`), Audio Units on
  macOS (`crates/au-host`); state saved in the session; instances created off the audio thread
  (`docs/plugin-parity.md`). Editors: CLAP floating windows, embedded on Windows; VST3 on
  macOS+Windows (Linux missing); AU editor views not hosted (`au-host/src/lib.rs` header).
- Any processor runs offline as AudioSuite (`crates/engine/src/cmd/audiosuite.rs`); user presets
  save per plugin (`cmd/plugin_state.rs`).

**MIDI, score and instruments** (`crates/engine/src/cmd/midi.rs`, `event*.rs`, `crates/midi`)
- Instrument/MIDI tracks, piano-roll MIDI editor with velocity lane, event list, score editor,
  step input, quantize, transpose, real-time properties (`crates/ui-egui/src/midi_editor.rs`,
  `score_editor.rs`).
- Standard MIDI File import/export (`soundcraft_midi::read_smf`/`write_smf`;
  `engine::io::export_midi`; tests in `cmd/file.rs` prove controllers are kept and the `tracks`
  filter works — the older parity note is stale).
- MusicXML export and SVG score print (`crates/engine/src/score.rs` `musicxml`/`svg`;
  commands `file.export_sibelius`, `file.send_to_sibelius`, `file.print_score`).
- Audio-to-MIDI (monophonic pitch tracking): `edit.copy_audio_as_midi`
  (`crates/engine/src/cmd/audio_midi.rs`, `crates/dsp/src/pitch_detect.rs`).

**Recording** (`crates/engine/src/cmd/transport.rs`, `options.rs`)
- Record/play/stop commands (`transport.record` `Cmd+Space`), punch-in on selection or on the
  fly (`options.quickpunch`), pre/post-roll, loop recording with a playlist per take, input
  monitoring, autosave with recovery (`crates/engine/src/autosave.rs`). Caveats in
  "Known limitations" below — recording uses the system default input and holds takes in RAM.

**Time, tempo and analysis** (`crates/time`, `cmd/event_more.rs`)
- Bars|Beats, Min:Secs, Timecode (all rates incl. drop-frame), Feet+Frames, Samples; tempo and
  meter maps, tempo ramps, key/chord display; Beat Detective and Identify Beat
  (`event.beat_detective`, `event.identify_beat`); pitch-preserving Elastic warping.

**Video and surround** (`crates/video/src/lib.rs`, `cmd/video.rs`, `cmd/surround.rs`)
- Video track with thumbnails + Video window; decodes MP4/QuickTime MOV with H.264
  (Baseline/Main/High), ProRes (422 Proxy/LT/Standard/HQ, 4444/XQ) and Motion JPEG.
- Channel formats Mono…9.1.6, plus Ambisonics orders 1–7, surround panner, Renderer window
  (`crates/model/src/mixer.rs` `ChannelFormat`).

**Files — import, session, export** (see `docs/file-format-parity.md`)
- Native session: `.scraft` (JSON) plus an `Audio Files/` folder of 32-bit-float WAV sidecars;
  saves are atomic (temp + rename), and the replaced file is copied to `Backups/<name> backup
  <n>.scraft`, newest ten kept (`crates/model/src/session.rs` `SESSION_EXTENSION`;
  `crates/engine/src/io.rs` `write_session`, `back_up`). In the browser a session saves as ONE
  zip bundle `<name>.scraftz` (`io.rs` `BUNDLE_EXTENSION`; `apps/soundcraft-web/src/main.rs`).
- Import audio: WAV (PCM 8/16/24/32, float 32/64, WAVE_FORMAT_EXTENSIBLE, RF64/BW64, BWF
  `bext`), AIFF/AIFF-C, FLAC, MP3, Ogg Vorbis, AAC/M4A/MP4, ALAC, CAF, Matroska/WebM (native
  readers + symphonia; `crates/audio-io/src/lib.rs` docs and `detect_format`). The file dialog
  offers `wav wave bwf aif aiff aifc flac mp3 ogg oga m4a m4b aac mp4 caf mkv webm`
  (`apps/soundcraft/src/main.rs` `services`).
- Export/bounce audio: WAV/BWF (RF64 above 4 GiB), AIFF/AIFF-C `fl32`, FLAC only —
  `ENCODE_EXTENSIONS = "wav, aif, aiff, flac"` (`crates/audio-io/src/lib.rs`). `file.bounce_mix`
  takes `format`, `bit_depth` 16/24/32f, `start`/`end`, `source` (main or a named bus),
  `normalize`, `dither` (default true), `fold_down`, and returns `peak_db`, `true_peak_db`,
  `lufs` (`crates/engine/src/cmd/file.rs` `bounce_job`/`bounce`). Stems: `file.bounce_stems`.
- Import MIDI: `.mid`, `.midi`, `.smf`. Import video: `file.import_video`. Import clip groups:
  `.scgrp` (`crates/engine/src/clip_group_file.rs`).
- Other exports: `file.export_midi`, `file.export_clips` (WAV), `file.export_session_text`,
  `file.export_selected_tracks_as_session`, `file.export_clip_groups`, MusicXML/SVG score.
- Session audio health report: `session.audio_health` / Window · Session Audio Health
  (`crates/engine/src/cmd/health.rs`).

**Automation surfaces** (CLI `apps/soundcraft-cli/src/main.rs`; MCP `docs/mcp.md`)
- `soundcraft-cli` (hand-rolled arg parsing, no clap): `info`, `convert`, `run`, `script`,
  `commands`, `describe`, `app`, `mcp`, `parity`, `plugins`.
- Desktop control channel: newline-JSON over TCP on 127.0.0.1 (`--control <port>`, `0` = free
  port; prints `SOUNDCRAFT_CONTROL_PORT=<n>`; `crates/ui-egui/src/control.rs`,
  `apps/soundcraft/src/control_server.rs`). Methods: `engine.execute`/`command`,
  `engine.commands`, `engine.parity`, `session.inspect`/`document.inspect`, `ui.inspect`,
  `ui.set`, `ui.menu.list`, `ui.menu.invoke`, `ui.click`, `ui.drag`, `ui.scroll`, `ui.zoom`,
  `ui.move`, `ui.key`, `ui.text`, `ui.screenshot`, `app.quit`.
- MCP server on stdio (`soundcraft-cli mcp [--demo] [--connect PORT]`) with tools
  `list_commands`, `execute`, `batch`, `inspect_session`, `new_session`, `open_session`,
  `save_session`, `import_audio`, `bounce_mix`, `parity` (+ `screenshot`, `ui_inspect`,
  `ui_set`, `menu_invoke`, `click`, `drag`, `key` when bridged to the app) and optional
  `--automation-read-root` / `--automation-write-root` confinement (`docs/mcp.md`).

**Platforms**: desktop builds for macOS (universal), Windows x64/arm64/x86, Linux
(AppImage/deb/rpm/Flatpak/tar.gz incl. riscv64), FreeBSD; **WebAssembly build exists**
(`apps/soundcraft-web`, `trunk build --release`) with no filesystem and no TCP control channel
(`apps/soundcraft-web/src/main.rs` docs).

## Known limitations and not-implemented

Do not assign these to SoundCraft; each is a documented gap (`docs/gaps.md`, `ROADMAP.md`).

- **Alpha gate failures (pre-alpha):** (1) no full interface workflow — device/rate/buffer
  selection exists (Setup · Playback Engine) but there is no channel routing, no duplex
  single-clock stream, ASIO only behind an opt-in build feature, fixed 512-sample mix blocks,
  and takes record into RAM, not to disk (G-01, G-06); (2) **no MIDI device layer at all** —
  you cannot record from a keyboard or play an instrument live (G-02); (3) **no session
  interchange** — no `.ptx`, AAF or OMF import/export (G-03). AAX hosting is deliberately
  absent (Avid SDK/PACE; likely never).
- **Plugin hosting limits:** signed macOS builds refuse third-party VST3 (missing
  `disable-library-validation` entitlement, #153); AU editor windows not hosted; VST3 editors
  missing on Linux; no sidechain/key input; no ARA; plugins run in-process (a crashing plugin
  takes the app down) (G-05, G-13).
- **Compressed export missing:** bounce writes WAV/AIFF/FLAC only — no MP3/AAC/Ogg export
  (G-21). Import of compressed formats works.
- **Video:** no HEVC/DNxHD/DNxHR/AV1 decode, no video bounce, no external timecode (G-17).
- **No immersive delivery:** no Dolby Atmos/ADM BWF, MPEG-H or binaural rendering (surround
  mixing to 9.1.6/Ambisonics exists, G-12).
- **No control surfaces** (HUI/MCU/EUCON), **no external sync** (MTC/LTC/MIDI clock/word
  clock) (G-10, G-11).
- **Session management:** no session templates, track presets, workspace/sound browser or batch
  rename (G-16); memory locations and window configurations exist (`cmd/tab.rs`,
  `window.configurations`).
- **Localization:** English only; every string is a literal, no CJK/RTL support (G-09,
  `ROADMAP.md` languages table).
- **In-memory media:** sources decode whole into memory; long sessions/long takes exhaust RAM
  (G-06).
- **Stability/platform notes:** open correctness bugs in "done" features and no PR CI running
  `cargo xtask ci` on three OSes; Windows/Linux lightly exercised (G-04, G-14).
- **Claimed but unverified:** README performance claims ("120 fps with seventy-odd tracks",
  "parallel mix engine") are unmeasured in-repo; no fidelity harness compares output with Pro
  Tools (G-07) — uncertain, see `docs/gaps.md`.
- **Editor install caveat:** `soundcraft-cli` is not inside the .app bundle; it ships as a
  separate zip in GitHub releases (`README.md` Downloads) or must be built from source.

## How to operate

Launch the GUI: `open -a "SoundCraft"` (bundle binary:
`/Applications/SoundCraft.app/Contents/MacOS/SoundCraft`). Desktop flags parsed in
`apps/soundcraft/src/main.rs`: `--demo` (or `--sample`) loads the synthesised demo song,
`--control <port>` starts the JSON control server (`0` = free port), `--no-audio` disables
playback, `--version`/`-V`, and any positional paths open a `.scraft` session or import audio
(`.mid/.midi/.smf` go to MIDI import). Drag-and-drop onto the window does the same.

Environment: `SOUNDCRAFT_CONFIG_DIR` isolates the settings dir (`ui.json`, `Autosave/`,
`Presets/`, `logs/`) for automation; `SOUNDCRAFT_NO_PREFS` runs without reading/writing prefs or
logs (agents' test runs); `SOUNDCRAFT_CONTROL_PORT` sets the control port without the flag;
`RUST_LOG` sets log levels (`README.md` Logs; `docs/control-protocol.md`).

```sh
# Headless: load the demo, turn the kick down, add an EQ, bounce.
soundcraft-cli run --demo \
  --cmd 'mix.volume={"track":"Kick","db":-6}' \
  --cmd 'mix.insert={"track":"Bass","plugin":"eq_7band"}' \
  --bounce mix.wav

# Drive the running app (control port printed as SOUNDCRAFT_CONTROL_PORT=…).
soundcraft --demo --control 0 &
soundcraft-cli app --port <port> transport.play
soundcraft-cli app --port <port> session.inspect '{"detail":"full"}'
soundcraft-cli app --port <port> ui.screenshot '{"path":"/tmp/shot.png"}'

# MCP for an agent.
soundcraft-cli mcp --demo                       # headless
soundcraft-cli mcp --connect <port>             # bridge to a running app
```

`soundcraft-cli` usage (`--help` reproduces the module doc in
`apps/soundcraft-cli/src/main.rs`):

```
soundcraft-cli info FILE                       audio file or .scraft summary
soundcraft-cli convert IN OUT [--bit-depth 16|24|32f] [--rate HZ] [--normalize]
soundcraft-cli run [--in S.scraft | --demo] [--cmd ID[=JSON]]… [--bounce OUT] [--start T --end T] [--save S.scraft] [--inspect]
soundcraft-cli script FILE [--in S | --demo] [--save S] [--bounce OUT] [--keep-going]
soundcraft-cli commands [FILTER]               list commands
soundcraft-cli describe ID                     one command's details
soundcraft-cli app [--port P] METHOD [JSON]    call a running app's control channel
soundcraft-cli mcp [--connect PORT] [--demo] [--automation-read-root DIR] [--automation-write-root DIR]
soundcraft-cli parity [--write PATH]           parity report (markdown)
soundcraft-cli plugins                         list built-in plugins
```

Document model: one session per window; the window title is `<session name> * — SoundCraft` when
dirty (native menu bar). Edit and Mix are the two main windows (`Cmd+=` toggles; Window menu, see
`crates/ui-egui/src/menus.rs` `UI_COMMANDS` for the full window list: Transport `Cmd+1`, Big
Counter `Cmd+3`, Automation `Cmd+4`, Memory Locations `Cmd+5`, Video `Cmd+9`, MIDI Editor,
Score Editor `Cmd+Ctrl+=`, Clip List, Undo History, Renderer, …). Tracks/Groups, Clips, MIDI
Editor, Memory Locations and Undo History are dockable panels (`ui.dock`; `docs/control-protocol.md`).

Core workflow: New/Open (`session.new`/`session.open`) → import (`file.import_audio`,
`file.import_midi`, `file.import_video`) → edit (selection + commands above) → mix
(`mix.volume`, `mix.insert`, sends, automation) → save `.scraft` (`session.save`; pass
`replace: true` to overwrite an existing file) → bounce (`file.bounce_mix` to `.wav`, `.aif`/
`.aiff` or `.flac`) → verify with `soundcraft-cli info out.wav` or any external decoder.

Top keyboard shortcuts (all verifiable in `crates/engine/src/cmd/*` and
`crates/ui-egui/src/shortcuts.rs`; full list: Window · Keyboard Shortcuts / `window.shortcuts`):
`Space` play/stop, `Shift+Space` half-speed, `Cmd+Space` record, `F1`–`F4` edit modes, `F5`–`F10`
tools, `Cmd+=` Mix/Edit, `Enter` new marker, `Cmd+Shift+N` new tracks, `Cmd+E` separate, `Cmd+D`
duplicate, `Cmd+Z`/`Cmd+Shift+Z` undo/redo, `Cmd+S` save, `Cmd+P` print score. Single-key
Commands Focus shortcuts apply in the Edit window when that focus mode is on
(`shortcuts.rs` `commands_focus`).

## Working with an AI agent

An agent should work through the CLI/MCP/control surfaces, never by driving the GUI blind.

- **Headless processing:** `soundcraft-cli run --in song.scraft --cmd 'ID=JSON'… --save out.scraft
  --bounce mix.wav` or `script FILE` (one `ID JSON` per line, `#` comments, `--keep-going` to
  continue past failures). Every result is JSON; `--inspect` prints the session. `soundcraft-cli
  convert` is a standalone audio converter (input any decodable format → wav/aiff/flac, with
  `--rate`, `--bit-depth`, `--normalize`).
- **Discovering commands:** `soundcraft-cli commands [FILTER]` and `describe ID` give id, label,
  menu path, shortcut, params doc and enabled state. Prefer params docs over guessing
  (`position` accepts samples, `{"seconds": x}` or time strings like `"bars_beats:5|1|000"`;
  tracks by id or name; clips by id — `docs/control-protocol.md`).
- **Verifying your own edits:** call `session.inspect` (add `{"detail":"full"}` for inserts and
  params) before/after; it reports tracks, clips, routing, automation, markers, sources with a
  `loaded` flag, selection, transport and undo label. For UI state and click targets use
  `ui.inspect` (window/panel rects and `edit_layout`), then `ui.click`/`ui.key`/`ui.text` — or
  `ui.screenshot` to look at the result.
- **MCP:** `claude mcp add soundcraft -- soundcraft-cli mcp --demo`; confine file access with
  `--automation-read-root`/`--automation-write-root` (the desktop app under `--connect` is NOT
  confined — `docs/mcp.md`). Read roots cover open/import/presets; write roots cover
  save/bounce/export. A refused path is a normal tool error to correct.
- **Programmatic calls never open dialogs** — only `ui.menu.invoke` behaves like clicking a menu
  item and may raise one. Don't use menu dialogs in headless runs.
- **Safe automation hygiene:** point `SOUNDCRAFT_CONFIG_DIR` at a scratch dir; don't rely on
  `SOUNDCRAFT_NO_PREFS` when testing pref persistence; in UI smoke tests never arm a track,
  enable monitoring or start recording, and use `--no-audio` (which still permits recording
  input via arm/monitor commands — `docs/control-protocol.md`).
- **Prepare inputs for it:** generate or convert assets to formats SoundCraft reads (WAV/AIFF/
  FLAC/MP3/OGG/M4A/CAF audio; `.mid`/`.midi`/`.smf` MIDI; MP4/MOV H.264/ProRes/MJPEG video).
  Do not hand it MP3/AAC/Ogg for *export* — export is WAV/AIFF/FLAC only.
- **Must NOT:** assume `.ptx`/AAF/OMF support in either direction; assume MIDI hardware input or
  live instrument playing; drive an installed 0.6.x app with 0.7.0-HEAD command expectations
  without checking (`soundcraft-cli commands`); use `soundcraft-cli app` for `ui.scroll`/`ui.zoom`
  — its shorthand recognizer (`apps/soundcraft-cli/src/main.rs` `is_control_method`) omits them,
  so send those two as raw JSON lines over the TCP control channel instead.
- **Repairing sessions:** `.scraft` is serde JSON; a malformed file fails cleanly (there is a
  property test for mutated files, `docs/file-format-parity.md`). Keep edits minimal, preserve
  unknown fields where possible, and remember audio lives in `Audio Files/` beside the session —
  moving the `.scraft` alone loses media (reported as `missing`, not fatal, on open).

## Verification protocol

SoundCraft is pre-alpha and HEAD moves daily; treat every artifact as unverified until round-tripped.

1. **Throwaway round-trip before real work:** new session → import → edit → save → close/reopen →
   bounce → decode the bounce elsewhere (`soundcraft-cli info` or any player). Confirm counts and
   values via `session.inspect` rather than trusting the UI.
2. **Never trust a silent export:** `file.bounce_mix` returns `peak_db`, `true_peak_db` and
   `lufs` — check them (a near-`-inf` peak means silence); check `missing` from `session.open`
   and `session.audio_health` for dropped media.
3. **Version/backup discipline:** record the version you used (`soundcraft --version`,
   `soundcraft-cli --version`; installed bundle is 0.6.1 while HEAD is 0.7.0) and keep your own
   copy of the `.scraft` + `Audio Files/` per session — the built-in `Backups/` roll only keeps
   ten.
4. **Isolate automation:** fresh `SOUNDCRAFT_CONFIG_DIR` per test; scratch paths for sessions;
   never run destructive commands (`session.save` with `replace: true`, restructure commands)
   against a user's only copy.
5. **Update only between projects:** the ArtCraft launcher auto-updates; a release can change
   command behavior mid-session, so finish or archive a session before updating and re-check
   `soundcraft-cli commands` after updates.

## Sources & evidence

- Repo: https://github.com/storytold/soundcraft — inspected at HEAD
  `3a28a657692c1b98b28c276d8f61df9471074f0f` (2026-10-14), working tree read-only.
- Key files: `README.md`, `ROADMAP.md`, `docs/roadmap.md`, `docs/gaps.md`,
  `docs/file-format-parity.md`, `docs/plugin-parity.md`, `docs/control-protocol.md`,
  `docs/mcp.md`, `docs/architecture.md`; `Cargo.toml` (workspace 0.7.0).
- Code: `apps/soundcraft-cli/src/main.rs`, `apps/soundcraft/src/main.rs`,
  `apps/soundcraft/src/control_server.rs`, `apps/soundcraft-web/src/main.rs`;
  `crates/engine/src/cmd/*.rs`, `crates/engine/src/io.rs`, `crates/engine/src/score.rs`,
  `crates/engine/src/clip_group_file.rs`, `crates/engine/src/autosave.rs`; `crates/audio-io/src/lib.rs`;
  `crates/model/src/session.rs`, `crates/model/src/mixer.rs`; `crates/dsp/src/plugins/mod.rs`;
  `crates/ui-egui/src/control.rs`, `menus.rs`, `shortcuts.rs`; `crates/video/src/lib.rs`;
  host crates `clap-host`, `vst3-host`, `au-host`.
- Installed bundle (metadata only, not launched): `/Applications/SoundCraft.app` Info.plist —
  `CFBundleIdentifier ai.storyteller.soundcraft`, `CFBundleShortVersionString 0.6.1`.
- Date of inspection: 2026-10-14. HEAD may be ahead of the installed release — re-verify
  version-sensitive behavior against your installed version.
