---
name: effectcraft
description: >-
  EffectCraft is a free, open-source, pure-Rust motion-graphics and visual-effects compositor: a
  clean-room reimplementation of Adobe After Effects for animated titles, motion graphics and
  compositing (compositions, layers, keyframes, effects, 3D, render queue, Lottie, MCP/CLI
  automation). Trigger this skill whenever the user mentions EffectCraft, `.ecproj`, `.ecprojx`,
  `.ectemplate`, `.ecpreset`, or asks about writing/animating/compositing motion graphics,
  converting or verifying exported video (MP4/WebM/ProRes/image sequences/Lottie), scripting an
  After Effects-style app, driving a compositor from an AI agent (MCP, CLI, control channel), or
  troubleshooting one — even if they don't name the app but describe its job ("make a title card
  animation", "key this green screen clip", "export Lottie from my composition", "open my After
  Effects project").
---

# EffectCraft

## Overview

EffectCraft is a clean-room, open-source reimplementation of Adobe After Effects, written entirely
in pure Rust (README.md, CLAUDE.md). It targets After Effects 2026 parity in behaviour and menus:
compositions, layers, keyframes, 306 effects, expressions, scripting, Classic/Advanced 3D, tracking
and a render queue, with no FFmpeg inside — video/audio codecs come from FilmCraft's pure-Rust
crates (README.md §What EffectCraft is). It is in **alpha**: feature breadth ≈ 91%, but only ≈ 45%
"ready for real work" (ROADMAP.md headline numbers; first commit 1 October 2026, README.md). Source
lives at `https://github.com/storytold/effectcraft` (workspace version 0.9.2, Cargo.toml). Native
desktop apps for macOS, Windows and Linux, plus a full WebAssembly browser build
(`apps/effectcraft-web`, docs/web.md). The installed macOS app is `/Applications/EffectCraft.app`
(v0.9.2, bundle id `ai.storyteller.effectcraft`).

## Capabilities (verified)

Everything a user can do is one engine command with an id reachable from menu, CLI, control channel
and MCP (CLAUDE.md; crates/engine). Grouped capabilities with code evidence:

**Composition and layers**
- Comps with classic and Advanced 3D renderers; layers: footage, precomp, solid, text, shape, null,
  camera, light, 3D model, 3D primitive (`LayerSource` enum, crates/project/src/lib.rs:655; `Renderer`
  enum at :335).
- 38 blend modes, parenting, track mattes, motion blur (`BlendMode::ALL` is `[BlendMode; 38]`,
  crates/color/src/blend.rs:52).
- Nine layer styles (Drop Shadow, Inner/Outer Glow, Bevel and Emboss, Satin, overlays, Stroke) as
  property groups (crates/project/src/styles.rs:4).
- Keyframes: linear / Bezier / hold plus auto and continuous Bezier, spatial motion-path tangents
  (crates/keyframe/src/lib.rs); Graph Editor and Keyframe Velocity via commands (docs/agents.md).
- Expressions: JavaScript (boa_engine) with the After Effects object model
  (`wiggle`, `loopOut`, `thisComp.layer(...)`), evaluated per property (crates/expr; docs/agents.md).

**Effects**
- 306 registered effects with 3,017 parameters — all of After Effects' effects by name plus
  Obsolete/own ones (docs/effects-parity.md:14; registry in crates/effects/src/lib.rs:485).
- 280 of 306 run on the GPU compositor, checked against the CPU renderer
  (docs/hardware-parity.md:16-17).

**Import / footage** (extensions from code, not docs alone)
- Stills: png jpg jpeg gif webp tif tiff bmp exr tga hdr psd psb svg pdf ai eps
  (`STILL_EXTENSIONS`, crates/media/src/lib.rs:62); DPX/Cineon via `dpx::EXTENSIONS` (:79).
- Video: mp4 m4v mov mkv webm mxf (`VIDEO_EXTENSIONS`, crates/media/src/lib.rs:67); audio:
  FilmCraft's `AUDIO_EXTENSIONS` (:65).
- 3D models: gltf glb obj stl fbx (`MODEL_EXTENSIONS`, crates/media/src/lib.rs:70).
- png/jpg/jpeg/gif/bmp/exr/tif/tiff/dpx/tga/hdr decode via the pure-Rust media crate; PSD/PSB with
  layers, groups, masks, styles and smart objects (crates/psd); SVG (crates/svg); PDF/AI/EPS
  (crates/pdf); multi-layer EXR channel routing via EXtractoR (docs/agents.md).
- Image sequences, Interpret Footage, data files `.json/.csv/.tsv` (`DATA_EXTENSIONS`,
  crates/engine/src/commands/file.rs:562).
- Lottie JSON and dotLottie `.json`/`.lottie` import (`file.importLottie`, crates/lottie/src/import.rs;
  crates/engine/src/tests_lottie.rs:58).
- Timeline interchange FCP7 XML / `.fcpxml` / `.otio` / `.edl` / `.aaf` / `.omf`
  (`file.importTimeline`, crates/engine/src/commands/timeline.rs:25; crates/interchange).

**Save / native formats**
- `.ecproj`: versioned JSON project (`SCHEMA_VERSION = 2`, crates/project/src/lib.rs:34); opening
  repairs out-of-limit values and warns on newer-version excerpts (`file.open`,
  crates/engine/src/commands/file.rs:40-66).
- `.ecprojx` / `.xml`: XML copy of the same project, read and written (`file_text`,
  crates/engine/src/commands/file.rs:97; crates/engine/src/xml_project.rs).
- `.ectemplate`: Essential Graphics template (ZIP) exported/imported by `essential.exportTemplate`
  (crates/engine/src/commands/essential.rs:10, :807); `.ecpreset` JSON animation presets
  (crates/engine/src/commands/animation.rs:16, :478).
- Relative footage paths resolve beside the project on open (crates/engine/src/commands/file.rs:81).

**Export**
- Render Queue outputs, 13 formats (`OutputFormat::ALL`, crates/project/src/render_queue.rs:531):
  H.264 MP4, HEVC MP4 (`hvc1`), AV1 MP4 (`av01`), ProRes MOV (Proxy…4444 XQ + alpha), uncompressed
  QuickTime, WebM (VP9 or AV1 + Opus), PNG/JPEG/TIFF/EXR sequences, animated GIF, WAV, AIFF.
- CLI `render` with per-format flags (`--format h264|hevc|av1|prores|webm|png|jpeg|tiff|exr|gif|wav|aiff`,
  apps/effectcraft-cli/src/main.rs:13-18), `render --queue` for the project's queue (:21).
- Field rendering with 3:2 pulldown, crop, ROI, resize, render logs (crates/project/src/render_queue.rs:99,139;
  README.md §Export).
- Lottie export with a warnings list of what Lottie can't express (`file.exportLottie` returns
  `{path, bytes, warnings}`, docs/agents.md §CLI; crates/lottie/src/export.rs).
- Timeline export `file.exportTimeline` (FCP7 XML default; fcpxml/otio/edl/aaf/omf by extension or
  `format`) with optional ProRes 4444 prerender (crates/engine/src/commands/timeline.rs:133).
- Composition ▸ Save Frame As ▸ Photoshop Layers (layered PSD) and ProEXR
  (crates/engine/src/commands/frame_export.rs:1-7).
- Render queue from CLI: `effectcraft-cli render … --queue` and `renderQueue.add` / `renderQueue.render`
  (apps/effectcraft-cli/src/main.rs:21, 656).

**Automation and agent surfaces** (all commands live in `crates/engine`)
- MCP server over stdio: `effectcraft-cli mcp` — headless, `--gpu`, `--autosave`, or `--bridge PORT`
  to a live app (apps/effectcraft-cli/src/main.rs:604-627; crates/automation; docs/mcp.md).
- One-shot CLI: `info`, `commands`, `exec`, `run`, `props`, `get`, `set`, `render-frame`, `render`,
  `bench`, `script`, `mcp` (apps/effectcraft-cli/src/main.rs:92-124).
- Control channel: `effectcraft --control 9877` — TCP JSON-lines on 127.0.0.1, `engine.execute`,
  `ui.menu.invoke`, input methods, `render.frame`, `ui.screenshot` (docs/control-protocol.md;
  apps/effectcraft/src/main.rs:1-11).
- Scripting: `.jsx` scripts with the After Effects object model and ScriptUI, run via `script.run`
  / `file.runScript` (crates/script; docs/scripting-parity.md:21-27). WASM effect plug-ins load via
  `effect.plugins.load` (crates/plugin; docs/plugins.md).
- Tracking/AI: motion tracking, mask + face tracking (optional MediaPipe model), Warp Stabilizer,
  3D Camera Tracker, Roto Brush (optional MobileSAM model), Object Matte — all scriptable
  (docs/agents.md; crates/segment; crates/effects/src/object_matte.rs).

**Platform notes**
- WebAssembly build: yes — the same engine+UI runs in a browser (`apps/effectcraft-web`, docs/web.md;
  `cargo xtask web`; `cargo xtask wasm` runs in CI). Web build is single-threaded per instance, jobs
  run in Web Workers, system fonts are not scanned (docs/web.md:55,68,103).
- macOS is the most tested platform; Linux/Windows have open interaction bugs (README.md §Where it
  stands; docs/gaps.md gaps 6, 20).

## Known limitations and not-implemented

- **Cannot open After Effects projects.** `.aep` / `.aepx` have no reader (docs/gaps.md gap 1;
  README.md admits it). There is no `.aep` code path in the engine — only EffectCraft's own
  `.ecproj`/`.ecprojx`. Home-screen recents label `.aep` files "After Effects project"
  (crates/ui-egui/src/panels/home.rs:120), but opening them fails.
- **After Effects plug-ins do not run** (no AE SDK host); only WebAssembly effect plug-ins
  (README.md; docs/gaps.md gap 19; crates/plugin).
- **`.mogrt` and `.ffx` are not read/written**; EffectCraft uses `.ectemplate` and `.ecpreset`
  (docs/file-format-parity.md:27-29). `.aet`/`.aetx`, `.ars`/`.aom` likewise unsupported.
- **Missing import formats**: AVI, camera raw (DNG/CR3/NEF…), HEIF/AVIF, USD/USDZ, `.sbsar`
  Substance materials, legacy SGI/PICT/RLA. The Media Browser lists AVI but import refuses it
  (docs/file-format-parity.md; docs/gaps.md gap 17).
- **No output** for DPX/Targa/MXF/DNxHR, no 16-bpc uncompressed, no AVI or lossless-compressed
  single-file video (docs/file-format-parity.md §Render queue outputs; gap 22).
- **Encoder efficiency**: HEVC/AV1 lack B-frames, multi-reference, SAO/CDEF; ProRes 4444 colour tag
  is wrong (open issue #340); no hardware decode/encode yet (docs/gaps.md gaps 10, 15, 22).
- **Fidelity vs After Effects is largely unmeasured** — one live comparison so far (scalar ease,
  168 samples) (docs/gaps.md gap 2; docs/fidelity/README.md). Treat "looks like AE" as unverified.
- **Open crash reports** exist (macOS/Linux/Windows): #580, #501, #426, #341, #234, #879
  (docs/gaps.md gap 3).
- **No CI gate on pull requests** — `cargo xtask ci` runs locally only (docs/gaps.md gap 4).
- **Localization is partial**: menus in 10 languages, panels in 6, effect names only in Simplified
  Chinese; no native-speaker review (ROADMAP.md §Languages; gap 16).
- **No third-party plug-in ecosystem** (Trapcode/Element/Saber etc. have no equivalent)
  (docs/gaps.md gap 19).
- **`.jsxbin` not supported; Startup/Shutdown script folders not run; no keyboard shortcuts for
  scripts** (docs/scripting-parity.md:26-29).
- **Footage paths are absolute in the project**; missing footage can be relinked at HEAD
  (`file.relinkFootage`, crates/engine/src/commands/relink.rs; `file.findMissing`), but moving and
  sharing projects still needs relinking (docs/gaps.md gap 18 — partly stale vs. HEAD code).
- **`prproj` is not read/written** (docs/file-format-parity.md:90); interop is via FCP7
  XML/FCPXML/OTIO/EDL/AAF/OMF.
- **Beta blockers call this alpha**: `.aep` opening, fidelity, performance at 4K scale, Linux/Windows
  reliability (ROADMAP.md §Stage).

Claimed but unverified: README's marketing summary numbers (91% breadth, 45% ready) are the team's
own estimates, not measured against After Effects (ROADMAP.md itself says so). Treat every fidelity
claim as unverified until checked. This repo is HEAD of main; the launcher ships releases — verify
against your installed version (this inspection: repo 0.9.2, installed app 0.9.2).

## How to operate

**Launch (macOS).** `open -a EffectCraft` or
`/Applications/EffectCraft.app/Contents/MacOS/EffectCraft`. App arguments (apps/effectcraft/src/main.rs:1-11):
`--control PORT` (`EFFECTCRAFT_CONTROL_PORT` also works), `--demo`, `--empty`, `--home`, `--version`,
`--`, then a positional `*.ecproj`/`*.ecprojx` project or media files to import. Without a project it
opens an empty Untitled Project; `--demo` opens the demo composition ("EffectCraft Intro",
crates/engine/src/demo.rs:14).

**Command-line tool.** `effectcraft-cli` is a separate binary, not inside the `.app` on macOS
(docs/agents.md §From an installed release). Build it with
`cargo build --release -p effectcraft-cli`, or `cargo run --release -p effectcraft-cli -- …`.
Subcommands and notable flags (apps/effectcraft-cli/src/main.rs:92-124):

```sh
effectcraft-cli info --json                          # version, command/effect counts, project
effectcraft-cli commands --filter keys               # engine command ids (+ --schemas)
effectcraft-cli exec comp.new --params '{"name":"Main","width":1280,"height":720}' --empty --save-as main.ecproj
effectcraft-cli run main.ecproj comp.open '{"comp":"Main"}' time.set '{"time":1}' --json
effectcraft-cli set Main '#1' transform/position '[100,360]' --time 0 main.ecproj --save
effectcraft-cli get Main '#1' transform/position --time 0.5 main.ecproj --json
effectcraft-cli render-frame main.ecproj --time 1 --max-side 640 --out f.png --json
effectcraft-cli render --comp Main --out intro.mp4 --format h264 --audio auto
effectcraft-cli render main.ecproj --queue            # render the project's Render Queue
effectcraft-cli script build.jsx --save-as main.ecproj
effectcraft-cli mcp [--autosave | --bridge 9877] [--automation-read-root DIR] [--automation-write-root DIR]
```

Options: `--project F | --demo | --empty`, `--save`/`--save-as F`, `--bridge PORT`, `--json`, `--gpu`.
Positional `<comp>` is id/name/`-` (active), `<layer>` is id/`#n`/name, `<value>` is JSON or bare
string. Exit codes: 0 ok, 1 error (`{"error": …}` with `--json`), 2 usage error
(apps/effectcraft-cli/src/main.rs:285-297). Relative `--out` resolves against the working directory.

**MCP.** `effectcraft-cli mcp` is headless (instant startup; `--demo` or `--project F.ecproj` to seed
content; `--gpu` attaches the GPU compositor). `--bridge 9877` drives a running app. The repo ships a
`.mcp.json` with `effectcraft` (headless demo) and `effectcraft-app` (bridge) entries. Core tools:
`list_commands`, `describe_command`, `execute_command`, `get_state`, `get_project`/`get_comp`,
`get_layer`, `get_property`/`set_property`, `add_keyframe`, `list_effects`, `list_fonts`,
`add_effect`, `render_frame`, `open_project`/`save_project`, `undo`/`redo`/`history`, `run_script`,
`script_ui`, `batch` (docs/agents.md §Tools). Unknown parameter keys are rejected with the accepted
list — pass exactly the documented keys.

**Control channel (live GUI).** `effectcraft --control 9877` starts a localhost-only JSON-lines TCP
server (no auth; only enable while needed; 60 s request timeout, max 16 connections). Methods:
`engine.execute {command, params}`, `ui.menu.invoke`, `ui.click/drag/key/type`, `ui.elements`,
`ui.inspect`, `ui.screenshot`, `render.frame`, `app.quit` (docs/control-protocol.md). The MCP bridge
is a thin client of this protocol.

**Document model.** One project per window (File ▸ New/Open/Close Project; Save/Don't Save/Cancel
prompt on close), dockable panels (Project, Composition, Timeline, Effect Controls, Effects &
Presets, …), persisted workspaces, and a Home screen. All edits go through one command registry, so
UI, CLI, control channel and MCP do the same thing (CLAUDE.md).

**Core workflow concepts.** Build a comp (`comp.new`) → add layers (`layer.newText`, `layer.newSolid`,
`layer.newShape`, `layer.newNull`, `layer.newCamera`, `layer.newLight`, `file.import` +
`layer.addItem`) → animate with keys (`prop.addKey`, `keys.set`) → stack effects (`effect.apply`,
then `prop.set` on `effects/#n/<param>`) → preview (`render_frame`) → render (`renderQueue.add` +
`renderQueue.render {"wait": true}`). Property paths come from `get_layer` (e.g. `transform/position`,
`transform/opacity`, `effects/#1/blurriness`). **Keyframe times are layer time**; `get_property` and
`render_frame` take comp time; pass `timeBase: "comp"` when a layer is offset or stretched
(docs/agents.md §Pitfalls). Effect points and Roto/Puppet strokes are in effect space
(docs/agents.md §Effect positions).

**Open / save / export flow.** Open `.ecproj`/`.ecprojx` (File ▸ Open or CLI positional) → save with
`file.save`/`file.saveAs` (or `--save`/`--save-as`); save copies as `.ecprojx`/`.xml` stay XML.
Export via the Render Queue (13 formats; settings + output modules and templates), `render
--queue`, Lottie (`file.exportLottie` → `.json` or `.lottie`), timeline interchange
(`file.exportTimeline`), frame exports (Photoshop Layers PSD, ProEXR), templates
(`essential.exportTemplate` `.ectemplate`).

## Working with an AI agent

**Legitimately do:**
- Drive the app headless: MCP (`effectcraft-cli mcp --autosave --project F.ecproj`) or the CLI for
  one-shot work; both render on CPU by default, add `--gpu` for the GPU compositor.
- Discover, don't guess: `list_commands` / `describe_command` (or `effectcraft-cli commands
  --schemas`) return every command id, params doc and JSON Schema; `list_effects` returns effect ids
  and parameters; `list_fonts` returns usable families/styles.
- Prepare inputs: convert/generate media into supported formats (PNG/JPEG/TIFF/EXR sequences, MP4,
  WAV, glTF/OBJ/STL/FBX, Lottie JSON) with external tools, then `file.import`; keep image sequences
  numbered (`shot_0001.png`) so they import as one item; use `file.interpretFootage` to conform fps.
- Interpret and repair `.ecproj`: it is versioned JSON (schema 2) — safe to diff in git; opening
  repairs out-of-range values and reports them (`file.open` returns `{path, savedBy, repaired}`).
  Never hand-edit a newer schema backward — saving in an older app drops unknown settings
  (warning at crates/engine/src/commands/file.rs:59-66).
- Verify exports by reading them back: re-import the rendered file (`file.import`,
  `file.newCompFromSelection`) and `render_frame {transparent: true}` to check alpha (docs/agents.md).
- Confine file access in MCP sessions with `--automation-read-root` / `--automation-write-root`
  (docs/mcp.md).
- Use `batch` / `command_batch` to do several edits in one call (one undo step with `batch`).

**Must not:**
- Do not drive the GUI blind by clicking pixel coordinates; use the control channel's element ids
  (`ui.elements`, `ui.click {id}`) or, better, commands. Screenshots need a visible window.
- Do not promise After Effects file compatibility (`.aep`/`.aepx`/`.aet`/`.mogrt`/`.ffx`/`.prproj`)
  or AE plug-ins.
- Do not assume a format is supported because the Media Browser lists it (AVI is the known trap) —
  check `crates/media/src/lib.rs` extension lists before telling a user to import something.
- Do not assume renders are correct because a file exists: check `renderQueue.render`/CLI status,
  warnings from Lottie export (`warnings` array), and reopen the output.
- Do not edit the installed `.app` bundle or its resources; it is signed and auto-updates.

## Verification protocol

Alpha discipline — every claim about output must be checked:

1. **Throwaway round-trip before real work.** `comp.new` → add a text/solid layer → add a keyframe →
   `render_frame` at two times → `save_project` → reopen → render again. Confirm dimensions, alpha
   (`transparent: true`) and timing. Compare against what you asked for, not against After Effects:
   fidelity is largely unmeasured (docs/gaps.md gap 2).
2. **Never trust a silent export.** Check the Render Queue status (`renderQueue.list`), CLI exit code
   (0/1/2) and `--json` output; for Lottie export read the `warnings` list; for CLI renders read the
   per-item `{"rendered": …}` / failure list (apps/effectcraft-cli/src/main.rs:766-784).
3. **Back up and version projects.** `.ecproj` is human-readable JSON and diffs well; save a copy
   (`file.incrementAndSave` produces `Name 2.ecproj`) before risky batch edits. Undo is bounded
   (default 32 levels, `prefs.set general.undoLevels`) and history branches (docs/agents.md).
4. **Version hygiene.** The repo is ahead of released builds by design; the launcher app updates
   between sessions. Re-check `effectcraft-cli info --json` (version, command/effect counts) and the
   app's About/version before trusting a feature: verify against your installed version.
5. **Respect the data-safety rules.** MCP/CLI edits never raise save prompts (save explicitly, or
   `mcp --autosave`); opening/creating a project through commands discards unsaved headless work
   without asking (docs/agents.md §Unsaved changes). Save after every milestone.

## Sources & evidence

- Repo: https://github.com/storytold/effectcraft · inspected at HEAD
  `549e9d825132986d6167c1432cd3328efcbb0278` (2026-10-14).
- Installed app: `/Applications/EffectCraft.app`, v0.9.2, `ai.storyteller.effectcraft`.
- Read for this skill: README.md; CLAUDE.md; AGENTS.md; ROADMAP.md; Cargo.toml; docs/agents.md;
  docs/mcp.md; docs/control-protocol.md; docs/gaps.md; docs/file-format-parity.md;
  docs/scripting-parity.md; docs/effects-parity.md; docs/hardware-parity.md; docs/web.md (start);
  apps/effectcraft-cli/src/main.rs; apps/effectcraft/src/main.rs (CLI + bundle facts);
  crates/media/src/lib.rs; crates/engine/src/commands/file.rs, relink.rs, timeline.rs, essential.rs,
  animation.rs, frame_export.rs; crates/engine/src/xml_project.rs; crates/project/src/lib.rs,
  render_queue.rs, styles.rs; crates/color/src/blend.rs; crates/keyframe/src/lib.rs;
  crates/effects/src/lib.rs; crates/automation/src/server.rs.
- Per-claim evidence table: `evidence.md` (next to this file).
