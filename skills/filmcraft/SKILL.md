---
name: filmcraft
description: >-
  FilmCraft is an open-source, clean-room reimplementation of Adobe Premiere Pro: video editing,
  trimming, multicam, Lumetri-style colour, keyframes and effects, titles/captions, audio mixing
  and export — pure Rust, macOS/Windows/Linux plus a WebAssembly web build, with every action
  exposed as a command through a CLI, a JSON control channel and an MCP server. Trigger this skill
  whenever the user mentions FilmCraft (or "fcproj"), asks what it can do, which file formats it
  reads or writes, how to script/automate/edit video without Premiere, wants to prepare or convert
  assets for it, verify/repair its projects or exports, or troubleshoot it — and also when they
  just describe the job ("cut this footage", "make a title card", "grade this clip", "export an
  H.264 MP4", "hand an EDL/AAF to an editor") even if they never name the app. Prefer this skill
  over generic video-editing advice for anything FilmCraft touches; do not guess its capabilities
  from Premiere knowledge — read this first.
---

# FilmCraft

## Overview

FilmCraft is a non-linear video editor: a clean-room, from-the-spec reimplementation of the Adobe
Premiere Pro workflow (README.md:14), written in pure Rust and built by the ArtCraft team. Source
lives at GitHub `storytold/filmcraft` (Cargo.toml:11), dual-licensed MIT OR Apache-2.0. It is in
**alpha**: the project measures itself at ~86% feature breadth but ~56% "ready for real work"
(ROADMAP.md:19-20); the headline beta blocker is that Premiere's `.prproj` cannot be opened
(docs/gaps.md G2). The same engine runs as a native desktop app (macOS/Windows/Linux), a headless
CLI (`filmcraft-cli`), and a browser build (`apps/filmcraft-web`, docs/web.md). Everything the UI
can do is an engine command; the UI, CLI, control channel and MCP server all dispatch the same
command ids (docs/agents.md:1-3).

Repo HEAD inspected here is `cee1feb1` (workspace version 0.7.2). The installed app is 0.7.2 built
from commit `71438c6` (that commit is not in this shallow clone) — the installed build may be older
than HEAD; **verify against your installed version**.

## Capabilities (verified)

**Editing / timeline (implemented).**
- Multi-track timeline with video/audio tracks, three-point editing, insert/overwrite, lift/extract,
  ripple/roll/slip/slide/rate-stretch and razor; dynamic (J-K-L) trimming — README.md:81-88;
  engine command ids in `crates/engine/src/commands.rs` (`timeline.place`:2578, `sequence.addEdit`:2054,
  `edit.pasteInsert`:1632, `timeline.trim`:2633, `trim.toggleType`:2710).
- Markers (colour/name/comment), nesting (`clip.nest`, commands.rs:1989), multicam
  (`crates/engine/src/multicam.rs`), add-edit on one/all tracks, snap, linked selection.
- Exact integer time base: 254,016,000,000 ticks/second; 23.976/29.97 DF/59.94 are exact
  (README.md:85, docs/agents.md:165).
- Undo/redo history — but capped at 200 steps (`crates/engine/src/lib.rs:842`,
  `crates/engine/src/commands.rs:1143`), despite README.md:86 saying "unlimited".
- Projects: `.fcproj` — UTF-8 JSON envelope tagged `"filmcraft.project"` with `schema_version`
  (currently **15** at HEAD: `crates/format/src/lib.rs:54-66`; the docs table stops at 13 — code is
  authoritative). Older schemas migrate on load; newer-than-build files are refused, not half-read
  (docs/project-files.md:79-86). Saves are atomic (temp + fsync + rename: `crates/format/src/atomic.rs`),
  auto-save ring in an `Auto-Save/` folder, crash-recovery journal with OS file locks
  (docs/project-files.md:88-166).

**Import / open (implemented).**
- Recognised import extensions (`crates/media/src/lib.rs:175-179`):
  - video: `mp4 m4v mov mkv webm avi mxf mts m2ts m2t ts mpg mpeg vob mod tod m2v m1v mpv 3gp y4m apv`
  - audio: `wav wave bwf aif aiff mp3 mp2 m4a aac flac ogg opus`
  - stills: `png jpg jpeg gif webp tif tiff bmp tga dpx exr hdr dng`
- Container/codec openers actually registered: MP4/MOV, Matroska/WebM, MXF (OP1a/OP-Atom),
  Ogg (Opus/Vorbis), MPEG TS/PS and MPEG-1/2 elementary streams, raw APV, AVI (OpenDML), Y4M,
  standalone audio (`crates/codecs/src/lib.rs:135-137`; AVI source in `crates/codecs/src/avi.rs`).
- `file.import` also auto-detects caption documents (SRT/VTT/SCC/MCC/STL/TTML/DFXP) and
  interchange documents (EDL/FCP7 XML/FCPXML/OTIO/AAF/OMF) and imports them instead of treating
  them as media (`crates/engine/src/commands.rs:1373-1385`). Image sequences import with
  `"imageSequence": true` or by auto-detection (commands.rs:1349-1362). Interchange import merges
  bins/media/sequences as one undo step and links media found on disk
  (`crates/engine/src/interchange.rs:29-113`).

**Export (implemented unless noted).**
- `Format` enum (`crates/export/src/lib.rs:64-134`): h264, hevc (hardware-only), av1
  (hardware-only), prores, dnxhr, apv, mjpeg, mxf-op1a, mxf-opatom, png/tiff/bmp/jpg/tga/dpx/exr
  image sequences, gif, wav, aiff, aac, flac. `file.exportMedia` accepts these names plus settings
  (params doc: `crates/engine/src/export_tools.rs:1602`).
- HEVC and AV1 have **no built-in encoder**: they exist only where a platform hardware encoder
  registers one (`crates/export/src/lib.rs:69-79`; registration in `crates/platform/src/lib.rs:72-92`).
  On macOS that is VideoToolbox H.264/HEVC 8-bit; NVENC on Windows/Linux (H.264; HEVC incl.
  Main 10 HDR on Windows).
- Built-in export presets (~40; `crates/export/src/presets.rs:95-190`): "Match Source" adaptive
  H.264, YouTube/Vimeo 1080p/4K, Social Vertical 1080×1920, ProRes 422 (HQ/standard/LT/Proxy/4444/
  4444 XQ), DNxHR HQ/SQ/LB, APV 422-10/12, MXF OP1a (DNxHR/ProRes/H.264), MXF OP-Atom (Avid),
  PNG/TIFF/BMP/JPEG/Targa/DPX/OpenEXR sequences, animated GIF, WAV/AIFF/AAC/FLAC audio.
- Interchange export: CMX 3600 EDL (+ per-track EDL), FCP7 XML (`xmeml`), FCPXML 1.9–1.11,
  OpenTimelineIO, AAF (Edit Protocol; embedded/separate audio, mixdown options), OMF 2.0 —
  `crates/interchange/src/lib.rs:52-107` and `:377-396`; commands `file.exportEdl`,
  `file.exportFcp7Xml`, `file.exportFcpxml`, `file.exportOtio`, `file.exportAaf`, `file.exportOmf`
  (`crates/engine/src/commands.rs:1444-1491`). AAF/OMF/XML quality is untested in Avid/Pro Tools
  (docs/gaps.md G15). Editable ALE export in `crates/engine/src/project_tools.rs:822`.
- Markers CSV: `markers.exportCsv {path}` (docs/agents.md:232-246). Graphics templates `.fcgt`
  (FilmCraft's own; Adobe `.mogrt` is refused by design — `crates/engine/src/graphic_templates.rs:99,1159`).

**Colour / effects / audio / titles (implemented).**
- Lumetri-style grading, colour wheels, curves, HSL secondary, vignette; grading in linear light,
  32-bit float; scopes (README.md:106-113; `crates/engine/src/color.rs`, `crates/scopes`).
- Effects/transitions catalogue (README.md:138) with keyframes; GPU compositor via wgpu
  (`crates/gpu`), CPU path tested against it.
- Audio: mixer with inserts/sends/submixes, clip effects on the crate's own DSP, automation modes,
  BS.1770 / EBU R128 loudness metering (`crates/audio-dsp`, `crates/engine/src/mixer.rs`).
- Captions: caption tracks; import/export SRT, WebVTT, SCC, MCC (608/708), EBU STL, TTML/DFXP
  (`crates/captions/src/lib.rs:63-80`; commands `captions.import`/`captions.export`),
  burn-in (`crates/captions/src/burn.rs`).
- Titles/graphics: text/shape/pen tools on graphic clips (docs/graphics.md;
  `crates/engine/src/graphics.rs`).
- Speech-to-text (Whisper) and neural TTS (Kokoro) exist behind **off-by-default cargo features**
  (`apps/filmcraft/Cargo.toml:13-18`); release builds ship without them (docs/gaps.md G19).

**Automation surface (implemented — this is the app's strongest suit).**
- Headless CLI `filmcraft-cli`: subcommands `exec`, `run` (JSONL scripts from file or stdin),
  `commands`, `describe`, `inspect`, `import`, `export` (+`--list-presets`), `render`, `probe`,
  `bench-decode`, `mcp`, `help`; global options `--project --demo --save --save-as --bridge
  --data-dir --keep-going --compact` (`apps/filmcraft-cli/src/main.rs:63-121`).
- Control channel: `filmcraft --control <port>` (or `FILMCRAFT_CONTROL_PORT`) — loopback-only JSON
  lines, one request/reply per line; `--control-input-only` isolates input for unattended runs
  (`apps/filmcraft/src/control_server.rs:27-34`, `apps/filmcraft/src/args.rs:7-26`;
  method table docs/control-protocol.md:24-43).
- MCP server on stdio with 17 tools (`crates/automation/src/server.rs:304-550`): `command_list`,
  `command_run`, `command_batch`, `doc_inspect`, `render_preview`, `project_inspect`,
  `sequence_inspect`, `media_import`, `render_frame`, `ui_inspect`, `ui_elements`, `ui_click`,
  `ui_drag`, `ui_key`, `ui_type`, `ui_screenshot`, `ui_control`; resources `filmcraft://document`
  and `filmcraft://commands`. Headless (`--demo`/`--project`) or bridge to a running app
  (`--bridge 127.0.0.1:9876`). `.mcp.json` in the repo registers both.
- Web build (WebAssembly) exposes `window.filmcraft` (`execute`, `request`, `commands`, `inspect`,
  `screenshot`, `importFiles`, `importUrl`, `openProject`, `files`, `readFile`, `info` —
  docs/web.md:107-126).

## Known limitations and not-implemented

- **`.prproj` (Premiere projects): not implemented.** No code anywhere (`rg -ri prproj crates apps`
  is empty); the beta blocker (docs/gaps.md G2). To bring work in, ask the user to export FCP7 XML,
  AAF or OTIO from Premiere first.
- **No plugin hosting**: no VST3 / Audio Units / OpenFX; Settings ▸ Plugins is a stub
  (`crates/engine/src/settings.rs:1311-1315`; docs/gaps.md G11).
- **Delivery codecs**: H.264 is the only software delivery-codec export. HEVC/AV1 need a registered
  hardware encoder; no AV1 software export. No MPEG-2/DVD/Blu-ray/DCP/J2K export, no MP3 export,
  no interlaced encoding (docs/gaps.md G13).
- **10-bit / 4:2:2 camera media (Sony XAVC S-I, Canon XF-AVC, …) needs VideoToolbox**: the pure-Rust
  H.264 decoder is 8-bit 4:2:0 only, HEVC has no 4:2:2; on Windows/Linux with no hardware support
  they fail to open (docs/gaps.md G3).
- **Camera RAW (R3D, ARRIRAW, BRAW, ProRes RAW…), WMV/ASF, DV, MPEG-4 Part 2, HEIF/HEIC, PSD
  stills: not implemented** (docs/gaps.md G10). DNG/EXR/HDR stills do import
  (`crates/media/src/lib.rs:175`).
- **AI features are minimal** (no object masks, no generative extend, no media-intelligence search);
  speech-to-text off in releases (docs/gaps.md G12, G19).
- **Web build is single-threaded**: commands needing a worker thread (render previews, proxies,
  Project Manager, mask tracking) report an error there (docs/web.md:57-62).
- **Windows/Linux get far less testing than macOS** (docs/gaps.md G9; README.md:298).
- **Work area bar is absent** (docs/keyboard.md:64) — but `file.exportMedia` accepts
  `"range": "workArea"`; treat UI absence and engine support separately.
- Interchange round-trips are covered by tests but **AAF/OMF have never been opened in Avid or
  Pro Tools**; Premiere-exported XML import was measured slow (97 s for 3 files, #461)
  (docs/gaps.md G15).
- Claimed in README but not verified here: "more than 650 engine commands" (README.md:226) — count
  them yourself at runtime (`filmcraft-cli commands | wc -l`); the in-repo test only asserts >90
  (`crates/engine/src/tests.rs:618`).

## How to operate

**macOS launch.** `open -a FilmCraft` (app at `/Applications/FilmCraft.app`, binary
`Contents/MacOS/FilmCraft`, bundle id `ai.storyteller.filmcraft`, version 0.7.2 — from the
installed `Contents/Info.plist`). `open -a FilmCraft /path/cut.fcproj` opens a project; the first
`.fcproj` among the file arguments is opened and every other file is imported
(apps/filmcraft/src/args.rs:135-141). Do not launch the GUI for headless work — the CLI covers it.

**Desktop flags (verbatim from apps/filmcraft/src/args.rs:7-26):**
```
filmcraft [--control <port>] [--control-input-only] [--demo|--empty]
          [--recover|--no-recover] [--data-dir <dir>] [--graphics <mode>]
          [--version] [-h|--help] [project.fcproj | media files...]
```
`--graphics` accepts only `default` on macOS (`apps/filmcraft/src/graphics.rs:103-109`).
Data directory: `~/Library/Application Support/FilmCraft` (auto-save, recovery, logs, presets —
`crates/engine/src/autosave.rs:494-508`).

**The CLI is NOT inside the .app on macOS** (bundle contains only the desktop binary). Get
`filmcraft-cli` from the separate `filmcraft-cli-<ver>-macos-universal.zip` release asset, or
build: `cargo build --release -p filmcraft-cli -p filmcraft` (docs/agents.md:42-55). There is no
`filmcraft-cli` on `PATH` on a freshly installed Mac.

**Core workflow.** File ▸ Import (⌘I, `file.import`) ▸ sequence (`file.newSequence`) ▸
place clips on tracks (`timeline.place`; tracks named `V1`, `A2`, …) ▸ trim/move ▸ apply effects
(`effects.apply`) and keyframes ▸ export (`file.exportMedia`). Time is in ticks
(254,016,000,000/s); commands also accept `seconds`, `frame`, `timecode`
(docs/agents.md:165-166). Ticks in `.fcproj`, `sequence.inspect` and the CLI are all the same unit.

**Canonical headless examples (from docs/agents.md:202-216):**
```sh
filmcraft-cli commands razor                       # find command ids
filmcraft-cli --demo inspect sequence              # project/sequence JSON
filmcraft-cli --project p.fcproj --save exec timeline.razor seconds=3.5
filmcraft-cli --project p.fcproj exec effects.apply '{"effect":"Gaussian Blur"}'
filmcraft-cli --project p.fcproj export out.mp4    # format from extension; waits for the job
filmcraft-cli --project p.fcproj export out --preset "YouTube 1080p Full HD" --start 0 --end 10
echo '{"id":"file.newBin","params":{"name":"Selects"}}' | filmcraft-cli --project p.fcproj --save run -
```

**Control channel example:**
```json
{"id":1,"method":"engine.execute","params":{"command":"playhead.set","params":{"seconds":2}}}
```
Replies: `{"id":1,"ok":true,"result":{…}}` or `{"id":1,"ok":false,"error":"…"}`. Loopback only,
no auth; only one client at a time should assume it (16 connections max, malformed lines close the
connection) — docs/control-protocol.md:4-17.

**MCP:** `filmcraft-cli mcp` (headless; `--demo` or `--project p.fcproj`) or
`filmcraft-cli mcp --bridge 127.0.0.1:9876` to drive the running app. Register with
`claude mcp add filmcraft -- <abs path>/filmcraft-cli mcp --bridge 127.0.0.1:9876`.

## Working with an AI agent

**Legitimate agent work:**
- Cut/grade/mix/export headlessly: prefer MCP (`command_run`, `command_batch`) or
  `filmcraft-cli exec/run` over GUI driving. Ids and params come from `command_list` /
  `filmcraft-cli commands`/`describe` — never invent command ids.
- Prepare inputs: transcode or generate assets into formats the tables above actually list
  (ffmpeg may be used *outside* FilmCraft to make inputs — FilmCraft never links or bundles it).
  Keep the user's originals; write derivatives to a separate folder.
- Read/repair `.fcproj`: it is documented JSON (docs/project-files.md). Prefer engine commands
  (`file.open`, `media.relink`) over hand-editing; if you must edit, keep `schema_version` at the
  version you read, save atomically, and never downgrade a file a newer build wrote.
- Verify output: `filmcraft-cli probe`, `ffprobe` (external oracle), and the export result's
  `offlineMedia` field + exit status. Render frames for visual checks with
  `filmcraft-cli render --seconds S --out f.png` or MCP `render_frame`.
- Inspect before and after every edit: `project.inspect` / `sequence.inspect` (ids, ticks, frames).

**What an agent must NOT do:**
- Don't promise `.prproj`, camera RAW, MP3 audio export, plugin-hosted effects, AI object masks,
  or MPEG-2/DCP delivery — none exist (see limitations).
- Don't drive the GUI blind: element ids come from the previous rendered frame; a missing element
  right after a layout change is expected (docs/agents.md:185-186). Use `ui.elements` first, and
  `ui_screenshot` to confirm.
- Don't treat a written export as valid without checking `offlineMedia`: offline media renders a
  "MEDIA NOT FOUND" placeholder and the CLI exits 1 unless `--allow-offline`
  (apps/filmcraft-cli/src/main.rs:531-552).
- Don't open the user's project in a newer build and save over it without a backup: the first save
  over a migrated file keeps a `(schema vN backup).fcproj` copy (docs/project-files.md:75-77), but
  a file written by a *newer* build is refused rather than migrated.

## Verification protocol

Alpha-software discipline; follow it for every job:

1. **Throwaway round-trip first.** New/empty project → import one small file → one edit → save →
   export → `probe`/`ffprobe` the output. Confirm duration, frame count, codecs and A/V sync before
   touching real work. Use `--demo` to smoke-test the pipeline on any machine.
2. **Never trust a silent export.** Inspect the result JSON: `path`, `offlineMedia`, and the CLI
   exit status (0 success, 1 command/offline failure, 2 usage — apps/filmcraft-cli/src/main.rs:
   118-121). A file that exists may still be placeholder frames.
3. **Version and back up per session.** Keep a copy of the `.fcproj` (and let auto-save/recovery
   do their job: `file.listAutoSaves`, `file.recoveryList`). The crash-recovery journal restores
   unsaved changes after a crash (docs/project-files.md:136-159).
4. **One variable at a time.** Update the app / change schema only between projects, not mid-job;
   record app version (`filmcraft --version`, `filmcraft-cli --version`) and the HEAD commit you
   reasoned about.
5. **Cross-check where it matters.** Compare exported H.264/ProRes/DNxHR with `ffprobe`; for
   interchange, re-import your own exported XML/EDL/OTIO and diff `sequence.inspect`.
6. **Hostile inputs are normal.** Media, projects and CLI/MCP params are untrusted; the app is
   built to return errors, not crash (AGENTS.md §0) — report any crash as a bug rather than
   working around it silently.

## Sources & evidence

- Repo: https://github.com/storytold/filmcraft — HEAD `cee1feb185e675a108f78067f71ad86a640ace3d`
  (shallow clone, `git rev-parse HEAD`), inspected 2026-10-14; workspace version 0.7.2
  (Cargo.toml:7).
- Installed app: `/Applications/FilmCraft.app`, `CFBundleShortVersionString` 0.7.2,
  `FilmCraftBuildCommit` 71438c6 (Contents/Info.plist; commit not present in this shallow clone).
- Key files read: `README.md`, `Cargo.toml`, `ROADMAP.md`, `docs/agents.md`,
  `docs/control-protocol.md`, `docs/project-files.md`, `docs/gaps.md`, `docs/file-format-parity.md`,
  `docs/keyboard.md`, `docs/web.md`, `apps/filmcraft/src/args.rs`,
  `apps/filmcraft/src/control_server.rs`, `apps/filmcraft-cli/src/main.rs`,
  `apps/filmcraft-cli/src/args.rs`, `apps/filmcraft-web/Cargo.toml`, `crates/media/src/lib.rs`,
  `crates/codecs/src/lib.rs`, `crates/export/src/lib.rs`, `crates/export/src/presets.rs`,
  `crates/interchange/src/lib.rs`, `crates/engine/src/commands.rs`,
  `crates/engine/src/interchange.rs`, `crates/engine/src/export_tools.rs`,
  `crates/engine/src/graphic_templates.rs`, `crates/format/src/lib.rs`,
  `crates/automation/src/server.rs`, `crates/platform/src/lib.rs`, `.mcp.json`.
- Format details in `evidence.md`; deeper repo docs: docs/architecture.md, docs/testing.md,
  docs/captions.md, docs/graphics.md, docs/monitors.md, docs/target-app-parity.md.
