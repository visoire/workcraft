---
name: vectorcraft
description: >-
  VectorCraft is the ArtCraft team's clean-room, open-source vector illustration app (a Rust-native
  take on the Adobe Illustrator workflow) for macOS, Windows, Linux, FreeBSD and the browser.
  Trigger this skill whenever the user mentions VectorCraft (or "the vector app", "the Illustrator
  alternative", a `.vectorcraft`/`.vctemplate`/`.drawcraft` file), asks what it can or cannot do,
  which formats it opens or writes, how to script or automate it, how to prepare or convert assets
  for it, how to verify its output, or how to troubleshoot it — even when they don't name the app
  but describe its job: drawing or editing vector art, SVG/PDF/.ai/Pathfinder/artboard work,
  exporting screens/assets, or driving a vector editor with an agent. Also use it before generating
  SVG/PDF/EPS/PSD inputs for VectorCraft, repairing a native project file, or judging whether
  VectorCraft is the right tool for a task.
---

# VectorCraft

## Overview

VectorCraft is a clean-room, pure-Rust reimplementation of the Adobe Illustrator workflow, built by the ArtCraft team and dual-licensed MIT OR Apache-2.0. It runs natively on macOS, Windows, Linux and FreeBSD, and in browsers via WebAssembly. Per its own assessment (never measured against Illustrator — the clean-room rule forbids running it) it is **alpha**: ~88% feature breadth (348/375 menu items wired, 89/92 tools), ~75% depth, ~62% ready for real professional work (`ROADMAP.md:29`, `docs/target-app-parity.md`). Source: GitHub `storytold/vectorcraft`; siblings are PhotoCraft, FilmCraft, PdfCraft etc. under the same `crates/` layout. This skill was written from HEAD `0a33cff` (v0.11.0); the installed app bundle on the authoring Mac reports 0.10.0 — **verify against your installed version**.

## Capabilities (verified)

**Drawing, editing, style (implemented)**
- Full drawing/path surface: Pen, Pencil, Blob Brush, Eraser, shape tools, Live Corners, Width tool/Width Point Edit, Direct/Group Selection, isolation mode (`crates/engine/src/cmd/draw2.rs`, `crates/engine/src/cmd/path.rs`, `crates/tools`).
- Exact curve booleans: Pathfinder (unite, minusFront, intersect, exclude, divide, trim, merge, crop, outline, minusBack) plus Shape Builder and Live Paint (`crates/pathops`, `crates/engine/src/cmd/pathops.rs`, `crates/engine/src/cmd/shaper.rs`).
- Paint and appearance: swatches (global/spot, colour groups, libraries), gradients, gradient mesh, patterns, brushes, width profiles, multiple fills/strokes per object, transparency, opacity/clipping masks, graphic styles (`crates/engine/src/cmd/paint.rs`, `appearance.rs`, `swatch.rs`, `crates/brush`). Appearance/transparency area self-scored 97% (`ROADMAP.md` feature table).
- Live vector effects and 29 of 57 Photoshop-style raster effect filters (Film Grain, blurs, distort/pixelate/texture/brush-stroke sets etc.; the Effect Gallery itself is not implemented) (`crates/effects`, `crates/engine/src/cmd/rasterfx.rs`; `ROADMAP.md` headline counts, `docs/effects-parity.md`).
- Initial live 3D effects: Revolve, Extrude & Bevel, Inflate, Rotate — no materials (`crates/three-d`, `ROADMAP.md` progress log 2026-10-12, gaps G3).
- Type: point/area/type-on-a-path, character/paragraph styles, threading, Hebrew/Arabic bidirectional layout; the interface ships in 14 languages plus Czech and Brazilian Portuguese menus (`crates/text`, `crates/engine/src/cmd/typecmd.rs`, `README.md:222-224`, `ROADMAP.md` Languages).
- Symbols, blends, envelopes, radial/grid/mirror Repeat, perspective grid, Image Trace, graphs (9 types), Variables/data-merge (partial) (`crates/engine/src/cmd/brushsym.rs`, `perspgrid.rs`, `crates/trace`, `crates/engine/src/cmd/graph.rs`).
- Layers, artboards, document setup, guides/grids/smart guides/snapping, undo with unlimited structural sharing (`crates/doc`, `crates/engine/src/cmd/layer.rs`, `layerpanel.rs`, `docsetup.rs`).
- Print (shared `craft-print` spooler), Package, Links, Data Recovery, Export for Screens/Asset Export (`crates/engine/src/cmd/print.rs`, `package.rs`, `links.rs`, `crates/engine/src/cmd/fileio/screens.rs`).

**Formats — import/open (implemented)** — canonical list in `OPEN_EXTS` (`crates/engine/src/cmd/fileio/mod.rs:592`):
- Native: `.vectorcraft`, legacy `.drawcraft` (JSON; readers keyed by magic bytes) — `crates/format/src/lib.rs`, loaded by `crates/engine/src/cmd/fileio/native.rs`.
- Vector/exchange: `.svg`, `.svgz`, `.pdf`, `.ai` (read from its PDF part and/or its embedded editing data), `.ait`, `.eps` (with PostScript fallback to embedded preview), `.dxf`, `.emf`, `.wmf` (`crates/svg`, `crates/pdf`, `crates/eps`, `crates/cad`, `crates/metafile`, `crates/engine/src/cmd/fileio/{svg,pdfimport,eps,dxfimport,metafile}.rs`).
- Raster as documents: `.png`, `.jpg/.jpeg`, `.gif`, `.webp`, `.tif/.tiff`, `.bmp`, `.psd`/`.psb` (PSD/PSB as their merged image) (`crates/engine/src/cmd/fileio/psdread.rs`, `crates/doc` decode paths).
- Affinity documents: `.af` (Affinity 3), `.afdesign`, `.afpub` and content-detected `.afphoto`; unsupported features are listed in an import warning; a file whose native data can't be read opens as its embedded preview (`crates/affinity`, `crates/engine/src/cmd/fileio/affinity.rs`, `crates/affinity/README.md`).
- File → Place additionally accepts `.txt` (as area type) — `PLACE_EXTS`/`TEXT_EXTS` in `crates/engine/src/cmd/fileio/mod.rs:638`.
- Explicitly NOT supported, with hints: `.dwg` and PICT (`.pict/.pct/.pic`) (`crates/engine/src/cmd/fileio/dxf.rs:84`, surfaced by `document.formats` → `unsupported`).

**Formats — save (implemented)** — `SAVE_FORMATS` (`crates/engine/src/cmd/fileio/save.rs:23`):
- `.vectorcraft` (default native, JSON, versions 1–4, optional gzip; atomic write via temp file + rename), `.vctemplate`, `.pdf`, `.svg`, `.svgz`, and `.ai` (**PDF-compatible only** — a PDF carrying the native document so VectorCraft reopens it editable; Illustrator's own editing data is never written). `document.save`/`file.saveAs`/`file.saveCopy`/`file.saveAsTemplate` (`crates/engine/src/cmd/fileio/save.rs`).

**Formats — export (implemented)** — `FORMATS` write:true entries + `export_extensions()` (`crates/engine/src/cmd/fileio/mod.rs:465-635`):
- Vector: `svg`, `svgz` (options: styling, outlineText, embed/link images, decimals, preserveEditing, useArtboards, embedFonts, Tiny 1.2, encodings), `pdf` (one page per artboard, PDF/X presets, live text or outlined), `eps`, `dxf`, `emf`, `wmf`.
- Raster: `png`, `png8` (indexed), `jpg` (quality/CMYK/image-map), `webp`, `gif`, `tiff`, `bmp`, `tga`, `psd` (layered, with max-editability option). Scale/ppi/artboard range options throughout.
- Other: `txt` (text stories), `vectorcraft`/`template` (native copy/template).

**Automation surface (implemented — this is VectorCraft's strongest area)**
- **Everything is a command**: every user-visible action has an id, label, menu path, shortcut, params doc and enabled-state in the registry (`crates/engine/src/cmd/mod.rs`, `crates/ui-egui/src/menus.rs` `UI_COMMANDS` for UI-only commands). Enumerate with `document.formats`, `engine.commands`, or MCP `command_list`/`list_commands`. Unknown param keys are rejected with "did you mean" suggestions, so misspellings fail loudly (docs/mcp.md §Parameter keys).
- **CLI** `vectorcraft-cli`: subcommands `mcp`, `run`, `commands`, `convert`, `info`, `bench`, `perf` (`apps/vectorcraft-cli/src/main.rs:67`).
- **MCP server** (stdio JSON-RPC): `vectorcraft-cli mcp [--connect 127.0.0.1:7979 | --headless] [--automation-read-root DIR] [--automation-write-root DIR]`. ~30 tools: `command_list`/`command_run`/`command_batch` (incl. `$N.path` result references and `atomic` batches), `doc_inspect`, `render_preview`, `draw_shape`, `draw_path`, `set_paint`, `add_text`, `apply_effect`, `pathfinder`, `transform`, `create_graph`, `text_wrap`, `open_file`, `save_file`, `export`, `screenshot`, `press_key`, `pointer_gesture`, `ui_*`, plus legacy names `list_commands`/`run_command`/`inspect_document`/`inspect_ui` (`crates/mcp/src/tools.rs:79`, `docs/mcp.md`).
- **Control channel**: `vectorcraft --control <port>` (default port in examples 7979), one JSON request per line on loopback only, no authentication — enable only while in use (`apps/vectorcraft/src/control_server.rs`, `docs/control-protocol.md`).
- **File clamping**: `--automation-read-root`/`--automation-write-root` (desktop and CLI) confine every path automation reads/writes; the person at the keyboard is not confined (`crates/engine/src/file_access.rs`, `docs/mcp.md` §Confining file access).
- **WASM plug-ins**: sandboxed `.wasm` object filters and live effects (wasmi interpreter, ABI v1, `plugin.*` commands) (`crates/plugins`, `docs/plugins.md`).
- Scripts for the *reference app* (ExtendScript `.jsx` etc.) are only **checked/reported**, never run: `script.check` (`crates/scriptcheck`, docs/mcp.md §Checking scripts).

**Platforms**
- Desktop + WebAssembly web build of the same UI (`apps/vectorcraft-web`, Trunk; WebGPU with WebGL2 fallback; `?webgl` query flag). No TCP control channel in the browser; open/save/export go through the browser File APIs (`apps/vectorcraft-web/src/main.rs`).
- FreeBSD tarball and Linux AppImage/Flatpak/deb/rpm packaging exist (`packaging/`).
- Quality gates: `cargo xtask ci` (fmt, clippy with no-panic lints, tests, layer checks, wasm) (`AGENTS.md`).

## Known limitations and not-implemented

Do not assign VectorCraft these jobs; they are verified absent or partial at HEAD (`docs/gaps.md` ranked list, `ROADMAP.md` "What's missing"):

- **Writing Illustrator-native data**: Save As `.ai` writes a *PDF-compatible* file only; layer/group editing data that Illustrator expects is not written (G9, `docs/file-format-parity.md`). Illustrator 2018+ may open it without layers/groups.
- **Reading real-world `.ai`/EPS**: layer structure can come in wrong (e.g. 109 layers instead of 14), guides are missing, large files can be slow, legacy PostScript type and live effects/brushes/symbols don't come in as live objects (G9).
- **No scripting engine**: no way to run ExtendScript/JS/AppleScript inside the app; `script.check` only reports what a foreign script uses (docs/mcp.md §Checking scripts; ROADMAP "What's missing: scripting").
- **Generative AI**: 0% — no picture generation or vector generation features (G18).
- **Raster effects**: 29 of 57 Photoshop-style filters exist, so 28 are still missing; no Effect Gallery browser (G2, `docs/effects-parity.md`, `README.md:232`).
- **3D and Materials**: only the initial live effects (Revolve/Extrude & Bevel/Inflate/Rotate); materials and advanced 3D missing (G3).
- **Type**: CJK composition for vertical type missing; vertical type itself only initial (G4, `docs/type-parity.md`).
- **Localization gaps**: Hindi, Arabic (no RTL interface) and Indonesian missing; several catalogs unreviewed by native speakers (`ROADMAP.md` Languages).
- **Known correctness gaps** (G1/G11): interaction-fidelity pass never done (no side-by-side with Illustrator — clean-room); Shape Builder misses some planar regions; interior-anchor deletion behaviour differs; a few preferences (~15) are still inert (G12).
- **Affinity write**: import only; VectorCraft never writes `.af*` files (`crates/affinity/README.md`).
- **DWG/PICT**: explicitly unsupported (see `document.formats` → `unsupported`).
- **Web build**: no control server, no window capture; saves/exports are browser downloads (`apps/vectorcraft-web/src/main.rs`).
- **macOS packaging**: `/Applications/VectorCraft.app` contains only the GUI app; the CLI/MCP binary is a separate release asset (`docs/mcp.md` §From an installed release).
- **Stability (G10)**: start-up failures on some Windows/Linux machines, Wayland quirks; never a panic in shipped code, but driver/windowing failures are possible (`docs/gaps.md` G10).
- **Claimed but unverified** (README marketing numbers I could not verify without building/running): "20,000 shapes in ~27 ms at 120 fps", and the readiness percentages — treat them as the project's self-assessment, not measurements.

## How to operate

**Launch on macOS**
```sh
open -a VectorCraft                                   # plain GUI
open -a VectorCraft --args --control 7979             # + JSON control channel
# or directly, to get stderr (recommended when automating):
/Applications/VectorCraft.app/Contents/MacOS/VectorCraft --control 7979 [file.svg …]
```
- Real flags (verified in `apps/vectorcraft/src/main.rs:621`): `--control <port>` (or `VECTORCRAFT_CONTROL_PORT`), `--automation-read-root <dir>`, `--automation-write-root <dir>` (env `VECTORCRAFT_AUTOMATION_READ_ROOT`/`_WRITE_ROOT`), `--in-window-menus`, `--version`, plus positional files to open. A bad root or port stops the app before any service starts.
- Agent-safe env: `VECTORCRAFT_NO_PREFS=1` (no preferences/log/recovery writes — use for test runs), `VECTORCRAFT_CONFIG_DIR=<dir>` (isolated config profile).
- Port 7979 is shared convention with sibling Craft apps: if the log says it failed to bind, pick another port.

**Document model**: one window, multiple documents as tabs (`crates/ui-egui/src/chrome.rs:368`, `ui.inspect`→`documents`); each document has artboards, layers/sublayers, objects. Coordinates are **points, y down, origin at the first artboard's top-left; a new document is 612×792** (`crates/mcp/src/server.rs:32`). Before interacting, read state: MCP `doc_inspect`/`inspect_document` + `render_preview`; control `ui.inspect`/`document.inspect`; CLI `vectorcraft-cli info FILE`.

**Core workflow** (app, CLI, MCP and control channel all reach the same commands):
1. Open or create: `file.new`, `document.open`/`app.open`, `file.newFromTemplate`. Readable formats list above.
2. Edit **only through commands** (e.g. `shape.rectangle {x,y,width,height}`, `paint.setFill`, `object.align`, `pathfinder.unite`). Query ids/params rather than guessing: `engine.commands`, `document.formats`, MCP `command_list`, or `vectorcraft-cli commands` (prints the catalogue as JSON). Batch steps can reference earlier results (CLI: `--cmd … --params …`; MCP `command_batch` with `"$1.id"`; engine `crates/engine/src/steps.rs`).
3. Save in a save format (native/PDF/SVG/SVGZ/AI/template) or export in any writable format. The extension picks the format; `format`/`options` override. A document opened from/once saved as SVG or PDF saves as that format again.
4. Verify: `render_preview`/`ui.render`/`ui.screenshot` (needs a presented frame), `vectorcraft-cli info` (warnings, artboards, fonts), and the replies' `warnings` arrays — **read them**; they name what a format lost and what import left out.
5. Close: `file.close`/`app.quit` open a `saveChanges` dialog when modified (control: answer with `ui.dialog.confirm` / set `discard`).

**Keyboard shortcuts**: do not assume any. Each command's shortcut lives in the registry and is listed by `engine.commands`/`command_list` and `ui.menu.list`; users can override via Edit → Keyboard Shortcuts and import `.kys` shortcut sets (`crates/ui-egui/src/shortcuts.rs`, `crates/engine/src/cmd/shortcutset.rs`). Query before sending keys.

**Headless batch examples**
```sh
vectorcraft-cli run --in examples/dusk-poster.vectorcraft --cmd object.align --params '{"horizontal":"left"}' --export out.svg
vectorcraft-cli convert in.svg out.pdf --range 1-2
vectorcraft-cli info file.ai
```

## Working with an AI agent

Legitimate agent work around VectorCraft:
- **Automate edits**: prefer `vectorcraft-cli mcp --headless` (fast, no GUI, CPU renderer) for generation and conversion, or `--connect 127.0.0.1:7979` when the user wants to watch. Confine with `--automation-read-root`/`--automation-write-root`. Use `command_list` → `command_run` rather than inventing command ids; use the dedicated draw/export tools for common tasks.
- **Prepare inputs**: generate SVG (hand-written or from another tool) for open/place; convert sources (raster → PNG/JPG/TIFF/BMP/WebP/GIF, vector → SVG/PDF/EPS/DXF/EMF/WMF) into supported formats with `vectorcraft-cli convert`; check whether a file will import cleanly with `info` first and report its `warnings`.
- **Generate assets in the examples' style**: `examples/*.vectorcraft` were built entirely through the command API, so they are valid reference inputs (and openable documents).
- **Inspect/repair native files**: `.vectorcraft` is JSON (`{"format":"vectorcraft","version":N,…}`) — parseable, diffable, and safe to patch offline for bulk changes. Preserve unknown keys (newer versions keep them via `Document::extra`), keep embedded `data` blobs intact, and prefer repairing through `document.open` + `document.save` so the version/compression rules apply (`crates/format/src/lib.rs`).
- **Verify output**: reopen exports (`info`, `run --in … --cmd document.inspect`), rasterize (`render_preview`), and compare against source geometry; treat empty `warnings` as the pass signal.

Do **not**:
- drive the GUI blind: inspect first (`ui.inspect`), because dialogs, the save sheet and `fileDialog` state change what commands do (`docs/control-protocol.md`); on macOS a command needing a file dialog returns `"cancelled"` unless given a `path`.
- assume Illustrator parity: `.ai` round-trips lose Illustrator structure; EPS may open as a preview image; Affinity/PSD/PSB bring reduced data.
- claim scripting support, generative AI, DWG import or native `.ai` writing.
- use Adobe applications or their files to test/compare (project-wide clean-room rule, `AGENTS.md`); never launch Illustrator.
- modify `contributors/contributors.json` (generated) or the brand assets in `docs/brand/` (`AGENTS.md`).

## Verification protocol

Alpha-software discipline — apply all of it:
1. **Throwaway round-trip first**: new document → one edit (draw + paint) → `document.save` to a scratch `.vectorcraft` → reopen with `info`/`doc_inspect` → export to SVG/PDF → reopen the export. Confirm the edit survived and warnings are empty. Do this before touching the user's real file.
2. **Never trust a silent export**: always read `warnings` (format losses) and, on import, `importWarnings`. `vectorcraft-cli convert` refuses `OUT == IN` when reading the input left things out unless `--replace-lossy` is given — honour that signal.
3. **Version and back up per session**: keep a dated copy (or git) of the project before bulk/agent edits; `.vectorcraft` files from newer builds can't be read by older ones (readers reject newer versions — `crates/format/src/lib.rs:93`). When saving for older VectorCraft versions, `version: 1..4` is available; compression needs version ≥ 3.
4. **Save is atomic but only as far as it got**: a failed save keeps the old file and reports in a dialog; after any failed save/export, verify the file on disk before assuming state.
5. **Update the app only between projects** (launcher auto-updates): a version jump can change rendering/effects subtly; verify one file after updating instead of discovering it mid-project.
6. **On trouble**: logs are `logs/vectorcraft.log` under the preferences folder (`~/Library/Application Support/VectorCraft/logs/` on macOS); unsaved work after a crash lands in Data Recovery next to the preferences (`apps/vectorcraft/src/main.rs:203`, `crates/engine/src/cmd/recovery.rs`).

## Sources & evidence

- Repo: https://github.com/storytold/vectorcraft — inspected at HEAD `0a33cff3f6e2a1e9e672f4c3816f58cd8d3d032e` ("Release 0.11.0"), 2026-10-14. Installed bundle: `/Applications/VectorCraft.app` v0.10.0 (`CFBundleIdentifier ai.storyteller.vectorcraft`) — HEAD is ahead of the installed release; verify against your installed version.
- Key files read: `README.md`, `ROADMAP.md`, `AGENTS.md`, `Cargo.toml`, `docs/gaps.md`, `docs/mcp.md`, `docs/control-protocol.md`, `docs/plugins.md`, `docs/architecture.md`, `docs/target-app-parity.md`, `apps/vectorcraft/src/main.rs`, `apps/vectorcraft-cli/src/main.rs`, `apps/vectorcraft-web/src/main.rs`, `crates/mcp/src/tools.rs`, `crates/format/src/lib.rs`, `crates/engine/src/cmd/fileio/{mod,load,save,export,dxf}.rs`, `crates/engine/src/cmd/mod.rs`, `crates/ui-egui/src/control.rs`, `crates/ui-egui/src/chrome.rs`, `crates/engine/src/file_access.rs`.
- Companion file: `evidence.md` (claim → path → tier table).
