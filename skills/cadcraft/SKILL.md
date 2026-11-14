---
name: cadcraft
description: >
  CADCraft is an open-source, clean-room AutoCAD-style CAD and drafting app (pure Rust; command
  line, object snaps, layers, dimensions, hatches, blocks, layouts, DXF/DWG, MCP/CLI automation).
  Trigger this skill whenever the user mentions CADCraft; wants to draw, edit, inspect, convert or
  batch-process CAD drawings; works with DXF or DWG files (floor plans, mechanical parts, site
  plans); asks about CAD commands, layers, dimensions, plotting or CAD file formats; wants to
  automate, script, MCP-drive or headlessly render a CAD app; or needs to prepare/verify CAD
  imports and exports — even if they never say "CADCraft" but describe 2D drafting work.
---

# CADCraft

## Overview

CADCraft is a clean-room, open-source reimplementation of Autodesk AutoCAD (target: AutoCAD 2027),
written in pure Rust with an egui front end and its own geometry, DXF, font, render and constraint
engines (`README.md`; `docs/architecture.md`). It runs natively on macOS, Windows, Linux and
FreeBSD, plus a WebAssembly browser build (`apps/cadcraft-web/Cargo.toml`). Status is **pre-alpha**:
the repo's own assessment is ≈38% "ready for real work" and 50% menu breadth (245/491 AutoCAD for
Mac menu items with a live command), with four of five core workflows failing its alpha gate
(`ROADMAP.md`). Source: GitHub org `storytold`, repo `cadcraft` (MIT OR Apache-2.0). Everything a
user can do is registered as a command, and every command is reachable from the GUI, the command
line, scripts, the CLI, the JSON control channel and MCP (`AGENTS.md`; `crates/engine/src/cmd/mod.rs`).

*Version note:* repo HEAD is 0.7.0 (commit fc4e983, "Release 0.7.0"); the app installed at
`/Applications/CADCraft.app` is 0.6.2 (`Info.plist`, bundle id `ai.storyteller.cadcraft`) — verify
behaviour against your installed version.

## Capabilities (verified)

### Drawing and editing core
- **Command line** is the primary interface: points `x,y`, relative `@dx,dy`, polar `@dist<angle`,
  absolute `#x,y`, direct distance entry, keywords, Enter/space repeat, transparent commands
  (`crates/engine/src/prompt.rs:62,246`; README "What works today").
- **≈400 engine command ids** registered via `CommandSpec` (401 unique `CommandSpec::new("…")` ids
  counted in `crates/engine/src/cmd/` at HEAD; `docs/architecture.md` counted 295 on 2026-10-10),
  plus 56 UI-only ids in `crates/ui-egui/src/menus.rs:17` (counted at HEAD).
- **Draw**: LINE, PLINE (arcs, widths), CIRCLE (2P/3P/TTR/TTT), ARC, RECTANG, POLYGON, ELLIPSE,
  SPLINE, POINT, XLINE, RAY, DONUT, TEXT, MTEXT (`crates/engine/src/cmd/draw.rs`, `draw2.rs`).
- **Modify**: ERASE, MOVE, COPY, ROTATE, SCALE, MIRROR, STRETCH, OFFSET, TRIM, EXTEND, FILLET,
  CHAMFER, BREAK, JOIN, EXPLODE, rectangular/polar/path ARRAY, draw order, OVERKILL
  (`crates/engine/src/cmd/modify.rs`, `modify2.rs`, `trimextend.rs`, `array.rs`, `overkill.rs`).
- **Precision**: object snaps (endpoint, midpoint, center, node, quadrant, intersection,
  insertion, perpendicular, tangent, nearest, geometric center; tracking/extension/parallel landed
  per `docs/gaps.md` history), polar/ortho, grid snap, grips (`crates/engine/src/snap.rs`,
  `grips.rs`, `gripcmds.rs`).
- **Layers & properties**: Layers palette + Layer Properties Manager, isolate/freeze/off/lock/match
  tools, Properties palette editing, linetypes, lineweights, colour index and true colour
  (`crates/engine/src/cmd/layer.rs`, `props.rs`).
- **Annotation**: DIM* commands with DIMSTYLE variables/overrides and associative dimensions,
  DIMBREAK/DIMJOGGED/QDIM/DIMEDIT, MLEADER, LEADER, TOLERANCE frames, TABLE with formulas/CSV
  data links, TrueType text, MTEXT formatting codes, our own stroke font
  (`crates/engine/src/cmd/annotate.rs`, `annotate_dimedit.rs`, `tolerance.rs`, `table/`).
- **Hatch & blocks**: pick-point boundaries with islands, pattern/solid/gradient fills from
  CADCraft's own pattern library (23 patterns, not Autodesk's), BLOCK/INSERT/attributes/BATTMAN,
  static Block Editor (BEDIT), xrefs (XATTACH/-XREF/XBIND/XOPEN), groups
  (`crates/engine/src/cmd/hatch.rs`, `blocks.rs`, `blocks/`, `groups.rs`; `crates/doc/src/library.rs`).
- **Parametric constraints**: geometric + dimensional constraints, AUTOCONSTRAIN, PARAMETERS with
  expressions, conflict detection, re-solve after every edit (`crates/constraints/`,
  `crates/engine/src/cmd/constraints.rs`).
- **Layouts & plotting**: paper-space layouts, viewports (scale/lock/per-VP freeze, polygonal,
  clipped), MSPACE/PSPACE, page setups, PLOT, EXPORTPDF, PUBLISH, PLOTWINDOW, plotter devices in
  our own JSON format (`crates/engine/src/cmd/layout.rs`, `plotters.rs`, `exchange.rs`).

### File formats (from `crates/io/src/lib.rs` and per-format modules)
- **Open/read**: DXF one reader for all versions — ASCII R12–2018, binary R13+ (binary R12 not
  read) (`crates/io/src/dxf_read.rs`; `crates/dxf/src/lib.rs`; `docs/file-format-parity.md`);
  DWG R13–2018 via the `acadrust` bridge crate, native targets only
  (`crates/dwg/src/lib.rs`, README); SVG/SVGZ import as entities/layers (`crates/io/src/svg_read.rs`).
- **Save/project**: DXF R2000–R2018, ASCII or binary, default 2018 (`write_with`, `SaveOptions`
  in `crates/io/src/lib.rs:86`); DWG 2000–2018 through the bridge (`crates/io/src/lib.rs:100`);
  `.dwt` templates for NEW/QNEW (`crates/engine/src/cmd/file/template.rs`). DXF keeps unknown
  entities/objects as raw tags since #528 (`crates/io/src/dxf_raw.rs`; `docs/file-format-parity.md`).
- **Export**: EXPORT command formats `dxf, dwg, svg, png, pdf` (`crates/engine/src/cmd/exchange.rs:25,96`);
  PNG at 2400×1600, SVG, vector PDF with real embedded TrueType text subsets, OCG layers and
  multi-sheet PUBLISH (`crates/io/src/pdf.rs`, `svg.rs`; `docs/file-format-parity.md`).
- **User assets**: `.pgp` alias files (ALIASEDIT), user `.lin`/`.pat` files, AutoLISP `.lsp`
  (`crates/engine/src/cmd/file/pgp.rs`, `crates/doc/src/library.rs`, `docs/autolisp.md`).

### Automation surfaces
- **CLI `cadcraft-cli`**: `info`, `convert` (dxf|dwg|svg|png|pdf with `--window`/`--view` framing),
  `run` (`--script`, `--script-file`, `--cmd 'id {json}'`, `--save`, `--export`), `commands`,
  `perf`, `sample bracket|floorplan`, `mcp` (`apps/cadcraft-cli/src/main.rs:58`).
- **MCP server over stdio** (`cadcraft-cli mcp`, or `--connect HOST:PORT [--lazy] [--launch]` to
  bridge a running app): tools `command_line`, `script`, `execute`, `list_commands`,
  `inspect_drawing`, `query_entities`, `render` (PNG), `find_text`, `new_drawing`, `open`, `save`,
  `cancel`, plus `screenshot`/`ui_inspect`/`ui_click` when connected
  (`crates/mcp/src/tools.rs`; `docs/mcp.md`).
- **JSON control channel** with `--control PORT` on `127.0.0.1`: methods `cmdline.input/script/key/state`,
  `engine.execute/commands`, `drawing.inspect`, `ui.inspect/elements/menu.*/pointer/click/move/drag/key/text/set/screenshot/render`,
  `app.open/save/quit`, `control.methods`, `ping` (`docs/control-protocol.md`; `crates/ui-egui/src/control.rs`,
  `apps/cadcraft/src/control_server.rs`).
- **Scripts**: SCRIPT command (alias `scr`) runs `.scr` text through the same engine as CLI/MCP
  (`crates/engine/src/cmd/file.rs:176`).
- **AutoLISP subset**: `.lsp` routines, `(defun c:NAME …)`, `(load)`, APPLOAD, `lisp` command,
  `acad.lsp`/`acaddoc.lsp` from the settings `support` folder (`crates/engine/src/cmd/lisp.rs`,
  `apps/cadcraft/src/main.rs:334`; `docs/autolisp.md`).
- **Recovery**: desktop autosave (SAVETIME/SAVEFILEPATH), Drawing Recovery, AUDIT, RECOVER
  (`crates/engine/src/autosave.rs`, `audit.rs`, `crates/ui-egui/src/autosave.rs`).

### Platform
- Native macOS/Windows/Linux/FreeBSD + WebAssembly build via `trunk`/`cargo xtask wasm`
  (`apps/cadcraft-web/`). **No DWG and no autosave in the web build** (`docs/file-format-parity.md`
  DWG web row; `docs/gaps.md` F4, FF12).
- 13 UI languages with `.tsv` catalogs (en, uk, pt-BR, de, es, cs, ru, fr, zh, it, ko, sv, ar) via
  `ui.language` (`crates/ui-egui/src/i18n/`; `docs/control-protocol.md`).

## Known limitations and not-implemented

Read `docs/gaps.md` (ranked work list) and `ROADMAP.md` before assigning work. Highlights:

- **Pre-alpha**: 4 of AutoCAD's 5 core workflows fail the repo's alpha gate; ≈38% ready for real
  work; no CI test run on PRs (`ROADMAP.md`; `docs/gaps.md` S1).
- **Lossy saves**: DXF now writes back unknown entities/objects raw, but through DWG the converter
  drops custom-class objects, xdata on table records/blocks, colour books and reactors; only 36
  header variables are written vs AutoCAD's ≈280 (`docs/gaps.md` FF1; `docs/file-format-parity.md`).
  "Opening a colleague's DWG and saving it still deletes some content" — the top-ranked gap.
- **No real-file validation**: all 36 file tests are synthetic; no CADCraft file has been opened in
  AutoCAD yet (`docs/file-format-parity.md` §Tests; alpha blocker FF5).
- **Geometry**: ellipse/spline intersections, offsets and closest points are tessellated; polyline
  offset ignores bulges (`docs/gaps.md` top-3, `docs/geometry-parity.md`).
- **Blocks/xrefs**: no dynamic-block authoring (references can change visibility states only); no
  XCLIP (references cannot be clipped); REFEDIT edits block references, not xrefs in place
  (`docs/gaps.md` F2, F3).
- **3D**: essentially absent (2% parity) — no UCS, 3D views, orbit, solids, surfaces, meshes,
  visual styles, rendering (`docs/gaps.md` F24).
- **Formats not read**: PDF import/underlays, raster image attach/display (the IMAGE entity exists
  but no attach/load path), DWF/DWFx, DGN, WMF, EPS, ACIS/STL, SHX shape/big fonts; binary
  `.ctb`/`.stb`/`.pc3`/`.pmp` (CADCraft has its own JSON plot styles/devices)
  (`docs/file-format-parity.md` Other formats; `docs/gaps.md` FF8–FF11, F14).
- **DWG throughput**: a 10 MB DWG took ~2 minutes and failed (#57); size limits now fail early
  (`docs/gaps.md` FF6).
- **Real DWG scale caveat**: read path converts DWG → DXF in memory with a 512 MB DWG / 1 GB DXF
  cap (`crates/dwg/src/lib.rs` `Limits`).
- **AutoLISP**: no Visual LISP (`vlax-`/`vla-`), no DCL dialogs, no reactors; `.fas`/`.vlx`
  unsupported; no ObjectARX/.NET-equivalent plug-in API yet (`docs/gaps.md` E1, E4).
- **Annotation leftovers**: fields (FIELD) and spell check absent; TOLERANCE has no dialog; some
  prompt options still print "not available yet" (e.g. -ATTEDIT Position/Height/Angle/Style,
  -RENAME of materials/plot styles/viewport configurations, MVIEW Restore) (`docs/gaps.md` F1, F7–F10).
- **macOS gotcha**: opening `.dxf` from Finder fails (issue #158) — use the in-app Open dialog,
  drag-and-drop, a file argument, or the CLI (`docs/gaps.md` U13, P3).
- **Localization**: catalogs cover the UI; engine diagnostics and CLI/MCP replies stay English
  (`docs/gaps.md` L1).
- **Claimed but unverified**: README's "What works today" table is broader than `ROADMAP.md`'s
  gate assessment in places (README is the aspirational feature list; ROADMAP/gaps are the honest
  status). Where they conflict (e.g. TRIM/EXTEND option stubs), trust `docs/gaps.md`, which was
  updated most recently (2026-10-13).

## How to operate

**Launch (macOS).** `open -a "CADCraft"` or `open /Applications/CADCraft.app`. The binary is
`/Applications/CADCraft.app/Contents/MacOS/CADCraft`; the installed app has no `cadcraft` or
`cadcraft-cli` on `PATH` (verified on the authoring machine) — get the CLI from the GitHub release
`cadcraft-cli-<ver>-macos-universal.zip` or build it from source. Pass arguments with
`open -a CADCraft --args …`.

**Real desktop-app flags** (`apps/cadcraft/src/main.rs:228`): `--control PORT` (JSON control
channel; env `CADCRAFT_CONTROL_PORT`), `--sample` (open the sample bracket drawing), `--version`/`-V`;
any other argument is treated as a file path to open; drag-and-drop is enabled. Common env vars:
`CADCRAFT_CONFIG_DIR` (isolated profile), `RUST_LOG`, `CADCRAFT_SYSTEM_CURSOR=1`,
`FONTALT`/`FONTFALLBACK` (+ `CADCRAFT_` prefixed), `CADCRAFT_VSYNC` (README; `docs/control-protocol.md`).

**Headless runs** (no GUI):
```sh
cadcraft-cli run --sample --script 'CIRCLE 22,3 1\n' --save out.dxf --export out.png
cadcraft-cli info drawing.dxf
cadcraft-cli convert drawing.dwg detail.png --window 0,0,20000,15000
cadcraft-cli commands circle          # catalog: id, label, aliases, params, enabled
```
Image framing: default = drawing extents; `--window x0,y0,x1,y1` (lowest corner first) or
`--view extents|current`; `run --export` uses the current view if the script changed it
(`apps/cadcraft-cli/src/main.rs:58-76`; README).

**Bridge an agent to the running app** (watch it draw, screenshot, click):
```sh
open -a CADCraft --args --control 7979 &   # or run the built binary: cargo run --release -p cadcraft -- --control 7979
cadcraft-cli mcp --connect 127.0.0.1:7979
printf '%s\n' '{"id":1,"method":"cmdline.input","params":{"text":"circle 0,0 5"}}' | nc 127.0.0.1 7979
```

**Document/window model.** Multiple drawings in file tabs (`chrome::file_tabs`,
`crates/ui-egui/src/lib.rs:628`); `document.switch`, `close`, `closeall`. Each drawing has model
space and paper-space layouts with viewports (`Space::Model`, `crates/engine/src/cmd/layout.rs`).
Core concepts: layers/properties, linetypes/lineweights, text/dim/table/mleader styles, blocks with
attributes, xrefs, constraints/parameters, undo per command.

**Open/save/export flow.** Open = `OPEN` command / `ui.open` / File ▸ Open (native dialogs via
`rfd`; **programmatic calls never open dialogs** — `engine.execute` with JSON only). Save = QSAVE
(Cmd+S) writes back in the drawing's format from its extension; SAVEAS takes `version`
(2000–2018) and `binary` (DXF); default save format/version settable via `ui.saveformat` /
`ui.saveversion`. Export = `EXPORT {format: dxf|dwg|svg|png|pdf}` (returns base64 or writes a
path), `PLOT` (Cmd+P), `EXPORTPDF`, `PUBLISH` for multiple sheets. On save, CADCraft warns about
records it could not read and, for DWG, data it will not keep — watch stderr/warnings
(`apps/cadcraft-cli/src/main.rs:282-291`, `skipped_message`; `drops_unknown`).

**Key shortcuts (verified in specs):** Cmd+N new, Cmd+O open, Cmd+S save, Cmd+Shift+S save-as,
Cmd+W close, Cmd+P plot, Cmd+Z/Cmd+Shift+Z undo/redo, Cmd+A select all, Cmd+X/C/V clipboard,
Cmd+1 Properties, Cmd+3 Tool Sets, Cmd+8 QuickCalc, Cmd+9 command line, Cmd+Q quit, F1 command
reference, F2 history, F3 osnap, F5 isoplane, F7 grid, F8 ortho, F9 snap, F10 polar, F11 otrack,
F12 dynamic input (`crates/engine/src/cmd/{file,edit,layout,settings}.rs`; `crates/ui-egui/src/menus.rs`).

**Logs / settings.** macOS settings dir `~/Library/Application Support/CADCraft` (log
`logs/cadcraft.log`, rotated, 16 MiB cap) — attach the log to bug reports; `support/` there holds
AutoLISP startup files; `workspace.json` stores panel layout (README; `docs/control-protocol.md`).

## Working with an AI agent

- **Prefer headless for anything reproducible**: `cadcraft-cli run … --cmd/--script --save --export`
  or `cadcraft-cli mcp` (headless session). This never depends on GUI state, dialogs or focus.
- **Discover before scripting**: run `cadcraft-cli commands <filter>` or MCP `list_commands` to get
  exact ids, aliases and parameter docs; run `info` / `inspect_drawing` / `query_entities` to verify
  geometry after each edit, and `render`/`ui.screenshot` to *look* at the result. Ids are AutoCAD
  command names lower-cased (`crates/engine/src/cmd/mod.rs:1`).
- **Prepare inputs**: you can generate DXF files (readable by CADCraft's public-spec DXF reader) or
  SVG files (`OPEN`/`import` reads shapes/paths/groups/Inkscape layers — no CSS/`use`/fills/text),
  and batch-convert via `convert`. Only these are safe output targets: dxf, dwg, svg, png, pdf.
- **Repair/interpret project files**: DXF is text and handled by documented code
  (`crates/io/src/dxf_read.rs`/`dxf_write.rs`, `crates/dxf/`) — editing CADCraft's own DXF output is
  defensible. **Do not hand-edit DWG**: it is opaque binary here, converted by a third-party bridge;
  a mangled DWG can lose drawing content (top gap in `docs/gaps.md`).
- **Do not**: drive the GUI blind (screenshot/inspect after every UI action; replies to
  `cmdline.input`/`ui.*` confirm state), assume AutoCAD feature parity (consult the limitations
  above), assume rich format fidelity (PDF/PNG/SVG exports are view products, not CAD exchange),
  expect dialogs from JSON/CLI/MCP calls, or expect AutoCAD assets/fonts/patterns — CADCraft uses
  its own, and Autodesk files must never be copied into it (AGENTS.md, clean-room rules).
- **Crash safety**: hostile input returns errors by design (extended `#[deny]` lint set, `catch_unwind`
  guard in `crates/engine/src/guard.rs`); a failed command should not kill a session — but still
  back up before bulk edits.

## Verification protocol

1. **Round-trip before trusting**: new → edit → save → export → reopen *elsewhere*:
   `cadcraft-cli run --sample --cmd 'circle {"center":[0,0],"radius":5}' --save /tmp/t.dxf --export /tmp/t.png`
   then `cadcraft-cli info /tmp/t.dxf` and read the PNG. Reopen the saved file in a fresh session
   (or AutoCAD if licensed) before calling it good.
2. **Never trust a silent export**: read stderr — CADCraft reports unread records and withheld
   content on save (`skipped_message`, `not_saved_message` in
   `apps/cadcraft-cli/src/main.rs:282`; `crates/engine/src/cmd/file.rs`). A `wrote N bytes` line
   with no warning is not a fidelity guarantee.
3. **Version and back up**: copy project files before opening them in CADCraft, especially DWG;
   keep per-session backups; CADCraft autosaves (desktop) but web has none.
4. **Update only between projects**: launcher auto-update ships releases; HEAD ≠ installed
   (0.7.0 vs 0.6.2 here). Test a drawing on a throwaway copy after an update.
5. **File a reproducible trail**: command line/script used, `cadcraft-cli info` output, config dir,
   `CADCRAFT_BUILD_SHA` from `--version`, and the log file.

## Sources & evidence

- Repo: https://github.com/storytold/cadcraft — inspected at HEAD
  `fc4e98315a8d771b5ab832f0ade0b5e7b106df7f` ("Release 0.7.0", 2026-10-14); date of inspection
  2026-10-14. Workspace version 0.7.0 (`Cargo.toml`).
- Key files read: `README.md`, `ROADMAP.md`, `Cargo.toml`, `AGENTS.md`, `docs/architecture.md`,
  `docs/gaps.md`, `docs/file-format-parity.md`, `docs/control-protocol.md`, `docs/mcp.md`,
  `docs/autolisp.md`, `apps/cadcraft-cli/src/main.rs`, `apps/cadcraft/src/main.rs`,
  `crates/io/src/lib.rs`, `crates/dwg/src/lib.rs`, `crates/engine/src/cmd/mod.rs`,
  `crates/engine/src/prompt.rs`, `crates/mcp/src/tools.rs`, `crates/ui-egui/src/menus.rs`,
  `crates/ui-egui/src/control.rs`, `crates/ui-egui/src/autosave.rs`.
- Installed app: `/Applications/CADCraft.app` version 0.6.2, bundle id `ai.storyteller.cadcraft`
  (Info.plist; not launched).
- No builds or tests were run for this skill; all capability claims come from source, docs and
  static inspection as cited. Where uncertain, the text says so rather than guessing.
