---
name: deckcraft
description: DeckCraft is an open-source, pure-Rust desktop presentation app (macOS, Windows, Linux, FreeBSD + web; a clean-room reimplementation of Microsoft PowerPoint) that opens and saves PowerPoint .pptx and native .deckcraft files, exports PDF/PNG/JPEG/outline, and is fully scriptable through commands, a CLI, a JSON control channel and an MCP server. Trigger this skill whenever the user mentions DeckCraft, or asks to create, edit, convert, inspect, render, present, automate or troubleshoot a presentation, deck, slideshow or slide file (.pptx, .potx, .ppsx, .deckcraft), wants slides exported to PDF/images, wants assets prepared for a deck, asks what DeckCraft can or cannot do or which formats it supports — even when they don't name the app but describe its job ("open this pptx", "build me a deck", "export these slides to PDF", "script slide editing"). Use it before assuming any PowerPoint feature exists in DeckCraft.
---

# DeckCraft

## Overview

DeckCraft is presentations and slide-show software: an open-source, clean-room reimplementation of
Microsoft PowerPoint, written from scratch in pure Rust (README.md:13). Source:
https://github.com/storytold/deckcraft (GitHub org `storytold`), dual-licensed MIT OR Apache-2.0.
It is in **alpha**: 79% of PowerPoint's feature breadth measured, ~55% ready for real work estimated
(ROADMAP.md:17-19). HEAD inspected is version 0.7.0, 117k lines in 23 crates (docs/architecture.md:7).
One engine backs the GUI (egui/eframe), the headless CLI, a JSON control channel, an MCP server and a
WASM build, and every action is a command, so humans and agents use the same verbs
(docs/architecture.md:40-47). Crashes are guarded: `Session::execute` runs every command inside a
panic guard that keeps the document as it was (crates/engine/src/guard.rs:1-60).

The installed `/Applications/DeckCraft.app` is **0.6.1** (Contents/Info.plist) while this skill
describes HEAD 0.7.0 — verify against your installed version.

## Capabilities (verified)

Tier labels: **[impl]** implemented and wired; **[partial]** works but visibly incomplete;
**[none]** absent.

### Decks, masters, themes, layouts
- **[impl]** New/open/save/close/export documents from one `file.*` command family, plus
  AutoRecover (crates/engine/src/cmd/file.rs:9-45).
- **[impl]** 8 built-in themes (DeckCraft, Harbor, Ember, Meadow, Nocturne, Paper, Coral Reef,
  Slate; crates/model/src/theme.rs:153-225), 11 layouts (crates/model/src/defaults.rs:299-461),
  slide masters and layout editing (`master.*`, `view.slideMaster`, `view.closeMaster`;
  crates/engine/src/cmd/design.rs, crates/engine/src/cmd/slide.rs).
- **[impl]** Sections (`section.add/rename/move/removeAll`), notes (`slide.notes`), hiding slides
  (`slide.hide`), custom slide size and header/footer (`design.slideSize`, `design.headerFooter`;
  crates/engine/src/cmd/slide.rs:37-49, crates/engine/src/cmd/design.rs).
- **[impl]** `slide.new` with layout name/kind, title and body; `slide.fromOutline` builds slides
  from outline text (crates/engine/src/cmd/slide.rs:14-26, :50).

### Drawing and shapes
- **[impl]** `shape.insert` preset shapes; `shape.presets` returns the gallery: 183 catalog entries
  at HEAD (crates/engine/src/cmd/insert.rs:183-187, crates/geom/src/preset.rs:147+); adjust handles
  (`shape.adjust`), change shape, rotate/flip, move/resize/set bounds (crates/engine/src/cmd/shape.rs:33-39).
- **[impl]** Connectors glued to shapes (`shape.connect`, `shape.sites`), freeform/curve (smooth)
  and merge ops `union|combine|fragment|intersect|subtract` (crates/engine/src/cmd/shape.rs:14-32,
  crates/engine/src/cmd/merge.rs:147).
- **[impl]** Fills (solid, gradient, picture, pattern), outlines with dashes and arrowheads, shadow,
  glow, soft edges, reflection, alt text, rename, visibility (crates/engine/src/cmd/shape.rs:40+).

### Text
- **[impl]** In-place editing and text ops through `text.edit`, `text.insert`, `text.delete`,
  `text.select*`, `text.get`, `text.commit`, `text.exit` (crates/engine/src/cmd/text.rs); formatting
  through `format.*`: bold/italic/underline, font, size, alignment, indent/outdent, columns,
  autofit, caps, highlight, wrap, subscript/superscript (crates/engine/src/cmd/format.rs:12+).
- **[impl]** WordArt text warp (`insert.wordArt`), fields and hyperlinks (`insert.hyperlink`,
  `Cmd+K`), symbols, slide numbers, date fields (crates/engine/src/cmd/insert.rs:46-60).

### Content
- **[impl]** Pictures from file or base64 (`insert.picture`) with crop/reset (crates/engine/src/cmd/insert.rs:27-35;
  image types accepted: png/jpeg/gif/webp/bmp/tiff, crates/engine/src/cmd/insert.rs:237-250).
- **[impl]** Tables (`insert.table`, merge/split, rows/columns, widths; crates/engine/src/cmd/table.rs),
  charts (`insert.chart`, `chart.type`, `chart.data`, `chart.options`; column/bar/line/pie/doughnut/
  area/scatter/stacked…; crates/model/src/chart.rs:11-70, crates/engine/src/cmd/insert.rs:37-79).
- **[impl]** SmartArt basics (`insert.smartArt` kinds list|process|cycle|hierarchy|pyramid|matrix as
  pre-drawn shapes; crates/engine/src/cmd/insert.rs:80-88; see limitations).
- **[impl]** Audio/video from file (`insert.audio`, `insert.video`) and playback commands
  (`media.play/pause/stop/seek/toggle/info`, GIF play; crates/engine/src/cmd/media.rs:13-38).
  Decodable media: MP3, AAC/M4A, ALAC, WAV, AIFF, CAF, FLAC, Ogg Vorbis, Opus; H.264/HEVC in MP4/MOV;
  VP9/AV1 in WebM/MKV (docs/file-format-parity.md:43-47).
- **[impl]** Action buttons and hyperlinks/actions (`insert.actionButton`, `insert.hyperlink`;
  crates/engine/src/cmd/insert.rs:52-97).

### Presenting
- **[impl]** 48/48 PowerPoint transitions including Morph with Words-and-Characters, measured frame
  by frame against PowerPoint (docs/animation-parity.md:9-48; model list in crates/model/src/anim.rs);
  64 animation effects with start/duration/delay/triggers/by-paragraph builds and Animation Painter
  (docs/animation-parity.md:50-78; crates/engine/src/cmd/animation.rs:13-63).
- **[impl]** Full-screen show (`show.fromStart` Cmd+Shift+Enter, `show.fromCurrent` Cmd+Enter;
  crates/engine/src/cmd/review.rs:20-21), presenter view, custom shows, Set Up Show (`show.setup`,
  `show.customShow`; crates/engine/src/cmd/review.rs:25-40), rehearse timings, pen in the show
  (docs/slideshow-parity.md:11-56).
- **[impl]** Comments with replies/resolve (`comment.*` Cmd+Alt+M), accessibility check,
  spelling against a small built-in list (`review.spelling` F7; crates/engine/src/cmd/review.rs:13-19).

### Files
- **[impl] Open**: `.deckcraft` (native) and legacy `.slidecraft`, `.pptx`, `.potx`, `.ppsx`
  (OOXML sniff), `.txt`/`.md` outlines (crates/engine/src/cmd/file.rs:67-87; crates/format/src/lib.rs:85-87;
  crates/pptx/src/lib.rs:40-55).
- **[impl] Save**: `.deckcraft` by default, `.pptx` when the extension says so; writes go to a
  temp sibling then rename, so a failed save never truncates the old file (crates/engine/src/cmd/file.rs:185-200,
  :216-226). `file.saveBytes`/`file.openBytes` move base64 data (browser-safe).
- **[impl] Export** (`file.export`): PNG and JPEG (scale in px/pt, JPEG quality 92), PPTX,
  DeckCraft, outline `.txt`/`.md`, and PDF with layouts slides|notes|handouts (1-9 per page), dpi
  36-600, real text layer, links/bookmarks, slide ranges like `"1-3, 5"`, hidden slides and framing
  (crates/engine/src/cmd/file.rs:18, :130-178, :272-319; crates/pdf/src/lib.rs:1-6,45-65).
- **[impl]** Native `.deckcraft` format: zip holding `mimetype`
  (`application/vnd.storyteller.deckcraft+zip`, stored), `presentation.json` (deflated model) and
  `media/<id>` entries; readers ignore unknown fields; a `repair()` pass fixes missing layouts, ids
  and sizes on load (crates/format/src/lib.rs:1-20, :43-73, :117-148).
- **[impl]** AutoRecover: `file.recovery.list/open/save/discard`; entries are `<uid>.deckcraft` +
  `<uid>.json` in `~/Library/Application Support/DeckCraft/Recovery` on macOS, opened at app start
  (crates/engine/src/recovery.rs:1-30; apps/deckcraft/src/main.rs:201-210).

### Automation surface
- **[impl]** 233 command specs registered at HEAD via the `cmd!` macro (`command_specs()`;
  crates/engine/src/cmd/mod.rs:111-147) plus 36 UI-only commands such as `view.sorter`,
  `app.print`, `show.start` F5 (crates/ui-egui/src/lib.rs:136-179). Each has id, label, menu path,
  shortcut, params doc and an `enabled` reason — list them live with `deckcraft-cli commands`.
- **[impl]** `deckcraft-cli` headless: `info`, `render`, `render-transition`, `convert`, `run`,
  `commands`, `describe`, `app`, `mcp`, `links`, `--version` (apps/deckcraft-cli/src/main.rs:36-45).
- **[impl]** JSON control channel: `deckcraft --control <port>` (or `DECKCRAFT_CONTROL_PORT`),
  bound to 127.0.0.1 only, one JSON request/reply per line (apps/deckcraft/src/control_server.rs:14-21;
  docs/control-protocol.md).
- **[impl]** MCP server over stdio: `deckcraft-cli mcp` (headless) or `--connect PORT` (drives a
  running app); JSON-RPC 2.0 (crates/mcp/src/lib.rs:3-14; tool list crates/mcp/src/tools.rs:65-279).

### Platform
- **[impl]** Native macOS/Windows/Linux/FreeBSD desktop builds, plus a WebAssembly web build that
  shares the same UI (apps/deckcraft-web/src/main.rs:1-16; README.md:164-222). Web differences: no
  TCP control channel, no persisted preferences, Save/Export are browser downloads
  (apps/deckcraft-web/src/main.rs:7-16).

## Known limitations and not-implemented

Comprehensive, ranked gap list: `docs/gaps.md` (reviewed 2026-10-13). The items an agent is most
likely to trip over:

### Formats
- **[none]** No import of legacy `.ppt`/`.pot`/`.pps` (97-2003), no `.odp`, no `.thmx`, no
  `.pptm`/`.potm`/`.ppsm` (docs/file-format-parity.md:22-25; docs/gaps.md:95-105).
- **[partial]** `.potx`/`.ppsx` open as plain presentations and are always **written as plain
  `.pptx`** content type (`file.saveTemplate` is Save As under another name; docs/file-format-parity.md:20-21,
  docs/gaps.md:87-93).
- **[none]** Writing `.pptx` only (plus PDF/PNG/JPEG/outline above). No video MP4/MOV export, no
  animated GIF, no TIFF/BMP/GIF slide images (docs/file-format-parity.md:29-32).
- **[none]** No printing: Print routes through a PDF opened in the system viewer (docs/ui-parity.md:50;
  docs/gaps.md:113-116).
- **[none]** Embedded fonts are neither read nor written (docs/file-format-parity.md:52,87).
- **[none]** SVG pictures do not render; a PPTX SVG shows only its raster fallback
  (docs/gaps.md:78-85). EMF/WMF draw as vectors but without clip regions/EMF+ records (same entry).
- **[partial]** PPTX has **never been tested against a corpus of real-world decks** — fidelity on
  corporate templates, SmartArt, chartex charts, embedded fonts is unknown (docs/gaps.md:61-69).
- **[partial]** PPTX round trip loses comment threads (written as legacy comments), media playback
  options and animation rewind (#70/#74/#77; docs/gaps.md:71-76).

### Feature depth
- **[partial]** Fonts: only Regular, Bold and Italic faces — Light/Medium/Semibold render wrong
  (docs/gaps.md:131-134).
- **[partial]** Animations: 64 of ~190 effects; Animation Pane has no editable timeline
  (docs/animation-parity.md:50-78).
- **[partial]** Charts: data-grid editing and chart elements are partial; `chartex` types
  (waterfall, funnel, treemap, sunburst, histogram, box & whisker) are not read (docs/gaps.md:146-151).
- **[partial]** SmartArt is pre-drawn shapes only; text pane and layout switching are absent, and
  editing a SmartArt from PowerPoint breaks it (docs/gaps.md:153-157).
- **[partial]** 3-D: bevel/camera/lighting render approximately; no extrusion, no command or pane to
  apply 3-D; text warps render all 40 presets but there is no gallery, command or adjust handles
  (docs/gaps.md:167-175).
- **[partial]** Ink from PPTX becomes freeform shapes on save — PowerPoint sees shapes, not ink
  (docs/file-format-parity.md:80).
- **[partial]** Proofing: spelling checks a small built-in list; no dictionaries, thesaurus or
  AutoCorrect (docs/gaps.md:177-180).
- **[partial]** Presenter view opens wherever the OS puts it (not the second display automatically);
  show has no laser pointer, no highlighter, no "See All Slides", no zoom, no record slide show
  (docs/slideshow-parity.md:25-56).
- **[partial]** Tab inside a text box ends text entry (#78; docs/gaps.md:141-144).
- **[none]** No localization: English-only UI, no string catalog (ROADMAP.md:85-106).
- **[none]** No AI/cloud features (Designer, Copilot, Translate, live subtitles) and no add-ins or
  VBA — by policy; MCP/CLI automation is the alternative (docs/gaps.md:243-253).
- **[none]** No native macOS menu bar; menu tree exists in code but is not installed
  (docs/gaps.md:197-198).
- **[none]** No multiple windows: one window holds the open presentations (docs/ui-parity.md:26).

### Stability and platform
- **[partial]** Recorded issues: Close via the raw `file.close` command discards without asking
  (the UI prompts; docs/gaps.md:38-41), startup crashes on some Windows GPUs (#40/#59), image paste
  fails on Windows/Linux (#53), no soak testing (docs/gaps.md:43-55).
- **[partial]** CPU rasterization only (`vello_cpu`), software video decode, no pen pressure or
  trackpad gestures (docs/gaps.md:210-220).

### Conflicting or uncertain
- docs/gaps.md:38-41 says `file.close` does not prompt, while docs/ui-parity.md:53 and
  crates/ui-egui/src/lib.rs:341 show the UI prompting around the command — treat the command itself
  as unsafe on a dirty document. Uncertain — see docs/gaps.md.
- Command count: docs/architecture.md:23 says 226 commands; 233 `cmd!` registrations exist at HEAD.
  Uncertain which is canonical — see crates/engine/src/cmd/mod.rs:124-147 (also `deckcraft-cli commands`).
- Claimed in README/docs but not directly code-verified in this pass: rehearse timings and Set Up Show
  options (README.md:76; docs/slideshow-parity.md:31,53) and the presenter-view window
  (docs/slideshow-parity.md:34-45; crates/ui-egui/src/show.rs exists). Uncertain — see those files.

## How to operate

### Launch (macOS)
- GUI: `open -a DeckCraft` or `open -a DeckCraft file.pptx` (file arguments open; apps/deckcraft/src/main.rs:155,219-223).
  Binary: `/Applications/DeckCraft.app/Contents/MacOS/DeckCraft`. Never launch it just to inspect a
  file — use the CLI/MCP instead.
- Desktop flags: `deckcraft [--control <port>] [--sample] [--show] [files…]`; `--version` prints and
  exits (apps/deckcraft/src/main.rs:3-4,145-157). `--sample` opens the built-in "Northern Lights"
  deck (crates/engine/src/sample.rs:17-22); `--show` starts the slide show from slide 0.
- The app bundle contains **only the GUI binary**; `deckcraft-cli` is a separate signed download
  (`deckcraft-cli-<ver>-macos-universal.zip`; README.md:193-198) or `cargo run --release -p deckcraft-cli -- …`.
  Check `which deckcraft-cli` before scripting; fall back to `cargo run` from a checkout.
- Environment: `DECKCRAFT_CONTROL_PORT` (same as `--control`), `DECKCRAFT_NO_PREFS`,
  `DECKCRAFT_NO_RECOVERY`, `DECKCRAFT_NO_AUDIO` (apps/deckcraft/src/main.rs:60-127), `RUST_LOG`
  directives for stderr and the log file (README.md:136-141).
- Paths on macOS: settings `~/Library/Application Support/DeckCraft/` with `ui.json`, `prefs.json`,
  `logs/deckcraft.log` (rotated to `deckcraft.1.log`/`.2.log`, 16 MiB cap) and `Recovery/`
  (apps/deckcraft/src/main.rs:42-53; crates/engine/src/recovery.rs:17-26; README.md:125-134).

### CLI (exact usage)
```
deckcraft-cli info FILE
deckcraft-cli render (FILE | --sample) [--slide N | --all] [--scale S] [--edit] OUT
deckcraft-cli render-transition FILE --slide N --t T[,T...] [--width PX] OUT.png
deckcraft-cli convert IN OUT
deckcraft-cli run [--in FILE | --sample] [--cmd ID[=JSON]]... [--save OUT] [--export OUT] [--print]
deckcraft-cli commands [FILTER]
deckcraft-cli describe COMMAND
deckcraft-cli app [--port PORT] COMMAND [JSON] | --method METHOD [JSON]
deckcraft-cli mcp [--connect PORT] [--sample]
deckcraft-cli links | --version
```
Verified in apps/deckcraft-cli/src/main.rs:36-45. Notes: `render --all` becomes `<out>/slide-NN.png`;
`--cmd` takes `ID` or `ID={JSON}`; `convert` exports slide 0 for png/jpeg and Save-As otherwise;
`deckcraft-cli app` defaults to port 7979 (crates/mcp/src/lib.rs:29) and talks to a running app
started with `deckcraft --control 7979`.

### Driving the running app (control channel)
`deckcraft --control 7990` then send one JSON object per line to `127.0.0.1:7990`:
```json
{"id":1,"method":"engine.execute","params":{"command":"slide.new","params":{"layout":"titleOnly","title":"Hello"}}}
{"id":2,"method":"ui.screenshot","params":{"path":"/tmp/shot.png"}}
```
Methods include `engine.execute`/`ui.menu.invoke`/`command`, `engine.commands`, `document.inspect`,
`ui.inspect`, `ui.tool.select`, `ui.pointer`, `ui.key`/`ui.text`/`ui.ime`,
`ui.move`/`ui.click`/`ui.drag`, `ui.set`, `ui.dialog.open/close`, `ui.screenshot`, `ui.render`,
`ui.resize`/`ui.focus`, `show.start`/`show.end`, `app.open/save/export/quit`
(docs/control-protocol.md:11-31; implemented in crates/ui-egui/src/control.rs:109-320).
Coordinates are slide points (1/72 inch; 16:9 = 960×540).

### MCP
`deckcraft-cli mcp` serves tools over stdio; `--connect PORT` attaches to the running app so an
agent and a person share the same deck (docs/mcp.md:1-14). Tools: `list_commands`, `run_command`,
`batch`, `new_presentation`, `open_presentation`, `save_presentation`, `export`, `inspect_document`,
`inspect_slide`, `render_slide`, `add_slide`, `go_to_slide`, `add_shape`, `add_text_box`, `set_text`,
`insert_picture`, `insert_table`, `insert_chart`, `select`, `pointer`, `select_tool`, `key`,
`type_text`, plus app-only `screenshot` and `call_app` (crates/mcp/src/tools.rs:65-279).

### Document model and workflow
One window; several presentations can be open at once (switch with `window.next`, Cmd+`); there is
no multi-window arrangement (crates/engine/src/cmd/file.rs:44; docs/ui-parity.md:26). Paths:
File ▸ New/Open/Save/Save As/Export/Print/Close via the Backstage (Alt+F), ribbon tabs Home, Insert,
Draw, Design, Transitions, Animations, Slide Show, Record, Review, View (docs/ui-parity.md:19-23).
Open: recent list, Browse, Recover Unsaved Presentations (`file.recovery.open`). Save As types offered:
PowerPoint, DeckCraft, PDF, Outline, PNG, JPEG (docs/ui-parity.md:49). The canonical workflow for an
agent is: `deckcraft-cli run --in x.pptx --cmd … --save out.pptx` or MCP `run_command` + `render_slide`
to look at results.

Caution: `file.save`/`file.export` decide the format from the output **extension**
(`format_for_path`, crates/engine/src/cmd/file.rs:185-200); any unknown extension silently writes
native `.deckcraft` bytes under that name. Always use the real extension.

## Working with an AI agent

### Legitimate agent work
- **Build and edit decks headlessly** with `deckcraft-cli run` or MCP: `slide.new`, `shape.insert`,
  `text.edit`/`insert`, `format.*`, `insert.picture/table/chart`, `transition.set`, `animation.add`,
  then `--save`/`export`. Verify structure with `document.inspect`/`slide.inspect`/`shape.inspect`
  (crates/engine/src/cmd/inspect.rs:12-15) and looks with `render_slide`/`ui.render` or
  `deckcraft-cli render`.
- **Prepare importable assets**: images as PNG/JPEG/GIF/WebP/BMP/TIFF (crates/engine/src/cmd/insert.rs:237-250;
  `image` 0.25 with those features, Cargo.toml:59); audio/video in the decodable formats above;
  outlines as `.txt`/`.md` — one slide per unindented line, tab-indented lines become body bullets
  (crates/format/src/lib.rs:150-188).
- **Interpret or repair native `.deckcraft` files**: they are plain zip + JSON (format documented in
  crates/format/src/lib.rs:1-20); `load()` runs `repair()` for missing layouts/ids/sizes, and unknown
  JSON fields are ignored by readers — but for real fixes prefer commands over hand-editing JSON, and
  never rewrite the zip with entries missing (`presentation.json` is required).
- **Verify exports**: read the produced PNG/JPEG; open the PDF's text (text layer is real, with
  links and bookmarks); re-open a saved `.pptx`/`.deckcraft` with `deckcraft-cli info` to confirm
  slides survive. Check the CLI's printed `path (W×H)` lines — output is quiet on success otherwise.
- **Drive the live app's UI when needed** through the documented control methods (`ui.*`), including
  `ui.screenshot` for evidence. That is the supported path — not OS-level automation.
- **Troubleshoot via logs**: the app logs to stderr and `~/Library/Application Support/DeckCraft/logs/deckcraft.log`;
  the crash guard and import skips are logged there (README.md:125-141; crates/engine/src/guard.rs:1-9).

### Do not attempt
- Do not assume any format not listed reads: `.ppt`, `.odp`, `.pptm`/macro formats, `.thmx` fail or
  are unrecognized (docs/file-format-parity.md:22-25).
- Do not "save as .potx/.ppsx" expecting template/show semantics — the writer emits a plain
  presentation (docs/gaps.md:87-93).
- Do not promise fidelity for arbitrary PowerPoint-authored decks (never corpus-tested), SVG icons,
  embedded fonts, chartex charts, comment threads or macro content (docs/gaps.md:61-105).
- Do not print expecting a printer dialog: printing exists only as PDF export (docs/gaps.md:113-116).
  Do not export video/GIF, and do not expect a native macOS menu bar.
- Do not issue `file.close` (or quit) on a dirty document from automation — save first; the command
  itself discards (crates/engine/src/cmd/file.rs:342-347; docs/gaps.md:38-41).
- Do not hand-edit `.pptx` zip internals; use the model/commands (unknown PPTX parts do round-trip
  through `Opaque`/`raw_ext`, but only when edited through the app; docs/architecture.md:63-65).
- Do not drive the GUI blindly by coordinates as a substitute for commands: commands are stable,
  pixel positions are not (docs/architecture.md:40-47). And never launch the GUI in a CI/headless
  context — use `deckcraft-cli`/MCP.

## Verification protocol

Alpha-software discipline; a silent bad export is the failure mode to design against.

1. **Throwaway round trip** before trusting any pipeline: create → edit → save → export → reopen.
   ```sh
   deckcraft-cli run --cmd 'file.new={}' --cmd 'slide.new={"layout":"titleAndContent","title":"T"}' --save /tmp/rt.deckcraft
   deckcraft-cli info /tmp/rt.deckcraft
   deckcraft-cli render /tmp/rt.deckcraft --all --scale 1 /tmp/rt-out/
   deckcraft-cli convert /tmp/rt.deckcraft /tmp/rt.pptx && deckcraft-cli info /tmp/rt.pptx
   ```
   Inspect one PNG visually; confirm `info` shows the expected slide count, theme and fonts (the
   `file.open` result also reports `missingFonts`; crates/engine/src/cmd/file.rs:105).
2. **Never trust a silent export**: check exit status, that the file exists and is non-empty, then
   re-read it (`info`, reopen in DeckCraft or PowerPoint). Remember `file.save` falls back to the
   native format for unknown extensions (crates/engine/src/cmd/file.rs:185-200).
3. **Version and back up per session**: copy `.deckcraft`/`.pptx` sources before batch edits. Saving
   deletes the AutoRecover entry for that document (`mark_saved`, crates/engine/src/cmd/file.rs:202-214),
   so recovery protects only unsaved work — it is not a backup. PPTX round trips lose comment
   threads, media options and rewind (docs/gaps.md:71-76): keep the original when fidelity matters.
4. **Update the app only between projects**: the installed bundle was 0.6.1 vs HEAD 0.7.0 at the time
   of writing, and the launcher auto-updates — re-check `deckcraft --version` and re-run the
   round-trip before relying on a newly landed behaviour.
5. **When something breaks**, capture `~/Library/Application Support/DeckCraft/logs/deckcraft.log`
   (plus `.1`/`.2`) and `RUST_LOG=debug` output before filing; the panic report is written there
   (README.md:125-141).

## Sources & evidence

- Repo: https://github.com/storytold/deckcraft — inspected at HEAD
  `d78e657e4cb1e490ceb5445785c052d9cf5ad963` ("Release 0.7.0"), 2026-10-14. Working tree clean.
- Installed app: `/Applications/DeckCraft.app`, CFBundleIdentifier `ai.storyteller.deckcraft`,
  version 0.6.1, exports UTType `ai.storyteller.deckcraft.presentation` (Contents/Info.plist).
- Key files read: README.md; Cargo.toml; AGENTS.md; ROADMAP.md; docs/{architecture,gaps,file-format-parity,
  animation-parity,slideshow-parity,ui-parity,control-protocol,mcp,roadmap}.md;
  apps/deckcraft/src/main.rs; apps/deckcraft-cli/src/main.rs; apps/deckcraft-web/src/main.rs;
  crates/engine/src/cmd/{mod,file,insert,inspect,slide,shape,merge,arrange,review,media,animation,transition,table,format,design}.rs;
  crates/engine/src/{guard,recovery,keys,sample}.rs; crates/format/src/lib.rs; crates/pptx/src/lib.rs;
  crates/pdf/src/lib.rs; crates/mcp/src/{lib,tools}.rs; crates/ui-egui/src/{lib,control,ribbon,dialogs}.rs;
  crates/model/src/{theme,defaults,chart}.rs; crates/geom/src/preset.rs; crates/anim/src/transition_fx.rs.
- Deeper detail (CLI/control/MCP tables, shortcuts, paths) in `references/commands-and-formats.md`
  next to this file.
