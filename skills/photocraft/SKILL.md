---
name: photocraft
description: >
  PhotoCraft is a native, pure-Rust image editor: an open-source clean-room reimplementation of
  Adobe Photoshop on macOS/Windows/Linux plus a WebAssembly web build, with PSD/PSB read+write,
  layers, masks, adjustment layers, layer styles, type, vectors, a brush engine, filters, a
  headless CLI (photocraft-cli), a JSON control channel, and an MCP server. Use this skill
  whenever the user mentions PhotoCraft, .pcraft, photocraft-cli, or Photoshop-style layer/PSD
  work; asks what PhotoCraft can or cannot do, its file formats or shortcuts; wants to automate,
  batch, script, or batch-convert images through it; needs importable assets prepared for it;
  wants PhotoCraft output verified or repaired; or troubleshoots it. Also trigger on generic
  image-editing or PSD-conversion tasks ("edit this photo", "make a PNG with transparency",
  "convert PSD to WebP", "batch-resize a folder") when PhotoCraft may be the tool.
---

# PhotoCraft

## Overview

PhotoCraft is a native, offline image editor written entirely in Rust (no Electron/Tauri/webview),
targeting 1:1 Photoshop parity with better performance and full agent drivability. It is a
clean-room reimplementation of Adobe Photoshop (behaviour and look only, from public specs), the
image-editing sibling of ArtCraft/VectorCraft/FilmCraft/LightCraft. Source: GitHub org
`storytold`, repo `photocraft` (README.md). Desktop UI is egui/eframe on wgpu; the same engine
compiles to WebAssembly for the browser (apps/photocraft-web, `docs/architecture.md`).

Maturity: **early alpha**, version 0.8.2 (workspace `Cargo.toml`; installed bundle
`/Applications/PhotoCraft.app` reports 0.8.2). The README is explicit: "much of Photoshop's
feature surface exists in some form, but it is not yet a Photoshop replacement for daily
professional work" (README.md "Status"). Measured numbers: feature breadth ~76%, ready for real
work ~45%, 953 open issues, 22 of 25 performance budgets missed (ROADMAP.md). The repo is HEAD of
main; the installed app may lag (launcher auto-updates) — **verify against your installed
version** where behaviour matters (`PhotoCraft ▸ About` / `photocraft --version`).

Rule the app lives by, and the agent should too: never crash, never panic on bad input; commands
validate params and return errors (AGENTS.md "Golden rules"). Expect graceful `Err`s, not crashes.

## Capabilities (verified)

### Documents, layers, editing
- RGB, Grayscale, CMYK and Lab documents at 8/16/32-bit; depth and mode are runtime data
  (README.md "Any colour, any depth"; `crates/doc`).
- Layers: groups, clipping masks, pixel and vector masks, fill layers, adjustment layers,
  27 Photoshop blend modes + 6 Paint.NET variants, opacity/fill, locks, colour labels, alpha
  channels, Quick Mask; merge/flatten/rasterize; Artboards, layer comps, snapshots
  (README.md "Layers, done properly"; `crates/doc`, `crates/engine/src/layer_cmds*`).
- 16 adjustment layers (Curves, Levels, Hue/Saturation, Vibrance, …) plus destructive
  equivalents; 10 layer-style effects live on any layer incl. type
  (README.md "Edit without regret", "Styles that sell the shot").
- Selections: marquees, lassos, Magic Wand, Quick/Object Selection, Select Subject (classical,
  no ML), Select and Mask dialog, feather/expand/contract/smooth/grow (README.md "Selections…";
  `crates/algo`).
- Type: point + paragraph text, on-canvas editing, Character/Paragraph controls, Warp Text;
  type layers round-trip through PSD (README.md "Type that sets beautifully").
- Vector: shape layers, Pen/Freeform/Curvature pens, combine modes, vector masks, strokes/fills;
  SVG opens as shape layers and places as a vector Smart Object (README.md "Pixel-perfect
  vectors"; `crates/io/src/svg.rs`).
- Smart objects with smart filters, lossless transforms/warps; History + History Brush, Toggle
  Last State; Actions record/replay; Fade (README.md; `crates/ops`, `crates/engine`).
- Filters: 70+ incl. Blur Gallery, distortions, Stylize, Render, live previews through the
  selection (README.md "See it before you commit"; `crates/algo`, `crates/engine/src/filter_cmds*`).
- Colour management in-house (`crates/cms`): embedded ICC, Assign/Convert to Profile, soft
  proofing and Gamut Warning (README.md "Any colour, any depth").
- 67 tools listed in the README; per `docs/gaps.md` (2026-10-13) the only Photoshop tool still
  missing is Art History Brush. (`ROADMAP.md` "12 missing" is stale — docs disagree; trust
  `docs/gaps.md` §G6.)

### Open / import formats (module that handles each)
- PSD/PSB, read+write — `crates/io/src/psd_import.rs`, `psd_export.rs`; `crates/psd`.
- Layered TIFF (Photoshop layer data), read+write — `crates/io/src/tiff_layers.rs`.
- OpenRaster `.ora`, read+write — `crates/io/src/ora.rs`. Paint.NET `.pdn` (read only, PDN3,
  editable layers + blend modes) — `crates/io/src/pdn.rs`. Krita `.kra`/`.krz` (read only) —
  `crates/io/src/kra.rs`. Affinity `.af`/`.afdesign`/`.afphoto`/`.afpub` (read only; unsupported
  parts warn) — `crates/io/src/affinity.rs`.
- SVG/SVGZ (opens as shape layers; placeable as vector Smart Object) — `crates/io/src/svg.rs`.
- Flat formats read+write: PNG (8/16-bit), JPEG, TIFF (8/16/32f), WebP (lossless default; lossy
  with a quality), GIF, BMP, TGA, ICO (≤256²), Netpbm (PBM/PGM/PPM/PAM/PFM), QOI, OpenEXR
  (F16/F32), Radiance HDR, FITS, DPX — `crates/codecs` (`format.rs` `caps()` is the authority;
  `crates/codecs/README.md` capability matrix). Read-only: PCX, XPM, DDS.
- HEIC/HEIF read-only (official builds enable the `heif` feature; no write); AVIF write-only
  behind the non-default `avif` feature (no read in any build) — `crates/codecs/src/format.rs`
  `FormatCaps`, `crates/heif`.
- Camera raw read: DNG, CR2, NEF, NRW, ARW, SRF, SR2, PEF, ORF, RW2, RAF — `crates/raw/src/lib.rs:142`.
- Photoshop Actions `.atn` import (112 mapped events) — `crates/engine/src/atn_cmds.rs`.

### Native project format
- `.pcraft`: a lossless bundle — a ZIP of STORE entries **or** a directory with the same layout:
  `manifest.json` (versioned document tree, migrations in `crates/format/src/migrate.rs`),
  content-addressed `tiles/<blake3>.zst` + `blobs/<blake3>.zst`, optional `thumb.png` and
  `composite/preview.png` (`crates/format/src/lib.rs` module docs; `docs/development.md` "Native
  format"). Incremental save (`PcraftWriter`), atomic writes, autosave + crash recovery
  (`crates/format/src/autosave.rs`; desktop `Recovery` folder; **web build has no crash
  recovery**).

### Save / export
- File ▸ Save writes back only to the document's own PSD, PSB or `.pcraft` (`docs/control-protocol.md`);
  Save As chooses a format; Save a Copy leaves the document untitled.
- PSD/PSB export with warnings for anything dropped; layered TIFF when asked; `.pcraft` always.
- Export As dialog: PNG, JPG, WebP, TIFF, TGA, ICO with quality/transparency/scale + size estimate
  (`crates/ui-egui/src/export_dialog.rs:16`); plus Quick Export as PNG, Save for Web (Legacy)
  with GIF/PNG-8 palette editing (`docs/control-protocol.md`).
- Exporting a layered document to a flat format can flatten/drop things — the export returns
  warnings; read them (`docs/control-protocol.md` `app.save` `warnings`).

### Automation surfaces
- **Every user-visible action is an engine command** (~700 registered; `crates/engine/src/commands.rs`,
  `docs/architecture.md` "Current state"). UI, CLI, control channel and MCP dispatch the same ids.
  Discover them with `photocraft-cli commands --filter <text>`, `engine.commands` over the control
  channel, or MCP `command_list` (reply shape documented in `docs/control-protocol.md`).
- **CLI `photocraft-cli`** (headless; `apps/photocraft-cli/src/lib.rs` `USAGE`): `convert`,
  `info`, `run`, `batch`, `droplet`, `commands`, `mcp`, `serve`. Exit codes 0 ok / 1 failure /
  2 usage; unknown flags are errors (no silent fallback).
- **JSON control channel** in the desktop app (`--control <port>`): authenticated loopback TCP,
  one JSON line per request; methods `engine.execute`, `engine.commands`, `ui.inspect`, `ui.set`,
  `ui.pointer`, `ui.click`, `ui.key`, `ui.screenshot`, `ui.menu.invoke`, `ui.dialog.*`,
  `app.open`/`app.save`, `jobs.*` (`apps/photocraft/src/control_server.rs`,
  `crates/ui-egui/src/control.rs`, `docs/control-protocol.md`).
- **MCP server** (`photocraft-cli mcp`): headless in-process session, or `--bridge
  127.0.0.1:<port>` to a running app. Tools include `command_list`, `command_run`,
  `command_batch`, `doc_open/new/place/save/export/inspect/render_preview/select/close`,
  `jobs_list`, `jobs_cancel`; bridge adds `ui_inspect`, `ui_screenshot`, `ui_pointer`,
  `ui_menu_invoke`, `ui_set` (`docs/mcp.md`, `docs/development.md` "MCP (agents)").
- **Actions/batch/droplets**: recordable Actions (persist as `actions.json`), `.atn` load/save,
  `batch --actions <file> --action <name> --in <dir> --out <dir>`, `.pcdroplet` files via
  `photocraft-cli droplet` (`apps/photocraft-cli/src/lib.rs`).
- **Plug-ins**: sandboxed WebAssembly plug-ins, ABI v1, `plugin.*` commands
  (`docs/plugins.md`); no native/Photoshop plug-in hosting.

### Platform notes
- Desktop: macOS, Windows, Linux, FreeBSD (README.md Downloads). Web: WebAssembly via trunk
  (`apps/photocraft-web`, `packaging/web`), preferences in `localStorage`, no filesystem, no
  crash recovery (`docs/development.md`).
- macOS specifics: pen tablet support via an AppKit event monitor — pressure, tilt, rotation,
  eraser end (`crates/tablet/src/macos.rs`, AGENTS.md; the one crate allowed `unsafe`).

## Known limitations and not-implemented

- **Not a Photoshop replacement yet.** Alpha; ready-for-real-work ~45%; 953 open issues; PSDs it
  writes are not always accepted by Photoshop (#1281, #2469) and Photoshop-authored files do not
  always render identically (oracle 145/258) — `docs/gaps.md` G1, `ROADMAP.md`.
- **No AI/generative features**: no Generative Fill/Expand, Neural Filters, Sky Replacement, ML
  Select Subject; there is no ML runtime. Classical substitutes only (`docs/gaps.md` G15).
- **No Photoshop plug-in compatibility**: no `.8BF`, CEP or UXP hosting; only the repo's own
  wasm plug-in ABI v1 (`docs/plugins.md`, `docs/gaps.md` G16).
- **Type depth**: no type on a path, no paragraph-direction UI, no OpenType Numerals/Stylistic
  Sets submenus, no live Warp Text preview, no text free transform (`docs/gaps.md` G8).
- **Workspaces are dialogs**: Select and Mask, Content-Aware Fill, Vanishing Point and most Blur
  Gallery pin editors are parameter dialogs, not Photoshop's full-screen workspaces (only Field
  Blur has on-canvas pins) — `docs/gaps.md` G7.
- **Performance**: 22 of 25 budgets missed on a loaded machine (layer move, paste, opacity
  changes, big-brush lag); the 150-layer nudge can crash the GPU compositor (`docs/gaps.md` G2).
- **Formats missing**: JPEG Options dialog, Photoshop PDF read/write, JPEG XL, JPEG 2000,
  Cineon, DICOM, EPS/DCS, Photoshop Raw, AVIF read, HEIC write, multi-page PDF I/O, layered
  TIFF extra alpha channels; `.asl`/`.shc`/`.csh` presets; C2PA (`docs/gaps.md` G10).
- **Camera Raw depth**: CR3 detected but unsupported; compressed RAF, lossy DNG, lens profiles,
  `.xmp` sidecars missing (`crates/raw/src/lib.rs`, `docs/gaps.md` G14).
- **PSD byte-identity**: a re-saved PSD is not byte-identical to its source (image resources,
  layer records and composite are rewritten). Only the standalone `photocraft-psd` crate tests
  byte-exact parse/write round trips (`README.md` "PSD without compromise").
- **Localization**: 17 languages ship with full UI strings (9 of the 12 key languages + 8 more),
  but engine/error messages stay English; Hindi, Arabic (0% strings) and Vietnamese are missing,
  and RTL layout is not implemented (`ROADMAP.md` Languages, `docs/gaps.md` G13).
- **Linux Wayland**: files dropped on the window do not open (winit limitation); use File ▸ Open
  or paste (README.md Get started).
- **Control-channel/watchdog timeouts**: a request queued while the window isn't drawing (asleep
  display, occluded window on Wayland) times out; `timeout: not run` is safe to resend,
  `timeout: no reply in 60s` may have applied — inspect the document before resending
  (`docs/control-protocol.md`).

### Claimed but unverified
- README claims PSD re-save "keeps the render of 307 of the 309 psd-tools test files"; the
  measured floor in `docs/gaps.md` (2026-10-12) reads psd-tools 236/309 and round trips ~100% —
  the two metrics differ; inspect `crates/io/tests/corpus.rs` and the fetched corpus yourself.
- README calls the command palette ⌘F; at HEAD both `edit.search` and `filter.lastFilter`
  default to ⌘F and tests show Last Filter wins until remapped
  (`crates/ui-egui/src/kys_import_tests.rs:157`). Check the installed version before relying on it.
- `ROADMAP.md` says 12 tools are missing while `docs/gaps.md` (newer) says only Art History
  Brush is; docs disagree — uncertain, see both.
- Menu-coverage counts ("628/628" in older docs vs the current generated
  `docs/parity-checklist.md` "631 of 631 menu items live") describe **menu wiring only**, not
  behaviour — the checklist says so itself, and README's Status note repeats it.

## How to operate

### Launch on macOS
```sh
open -a "PhotoCraft"                       # app bundle (ai.storyteller.photocraft, 0.8.2)
open -a "PhotoCraft" ~/Pictures/edit.psd   # positional paths open documents
"/Applications/PhotoCraft.app/Contents/MacOS/PhotoCraft" --version
```
App flags parsed by the binary (`apps/photocraft/src/main.rs`): `--control <port>`
(env `PHOTOCRAFT_CONTROL_PORT`), `--control-token <64-hex>`, `--control-token-file <path>`,
`--automation-read-root <dir>`, `--automation-write-root <dir>`, `--safe-gpu`,
`--in-window-menus`, `--version`; anything else that isn't a known flag is treated as a file
path to open. A bad `--control` port exits 2 without opening a window.
**Do not launch the GUI on headless machines** — it needs a display adapter; use the CLI/MCP.

### CLI (installed separately)
The CLI is not inside the .app bundle; it ships as `photocraft-cli-<ver>-macos-universal.zip`
(signed/notarized, README.md › macOS) or build from source:
`cargo run --release -p photocraft-cli -- <subcommand>` (binary `target/release/photocraft-cli`).
```sh
photocraft-cli info photo.psd --compact          # JSON: size, mode, depth, layer tree, warnings
photocraft-cli convert in.psd out.pcraft         # any supported format -> any
photocraft-cli convert in.psd out.jpg --quality 90
photocraft-cli run in.png --cmd filter.blur.gaussianBlur --params '{"radius":3}' --out out.psd
photocraft-cli run --new '{"width":800,"height":600}' --cmd document.inspect
photocraft-cli batch --actions set.atn --action "My Action" --in raw/ --out graded/ --format jpg
photocraft-cli droplet recipe.pcdroplet photo.png
photocraft-cli commands --filter blur            # discover command ids (~700)
photocraft-cli mcp --automation-read-root ... --automation-write-root ...
photocraft-cli serve --port 7878                 # JSON-lines headless session
```
`convert` flags: `--format`, `--quality 1..100` (JPEG; WebP becomes lossy), `--tiff-layers`,
`--tga-bits 24|32`, `--dpx-bits 8|10|12|16`. `run` prints one JSON line per command. `batch`
refuses `--out` == `--in` unless `--in-place`; recognised inputs include `.pcraft .psd .psb
.pdn .ora .kra .krz .af .afdesign .afphoto .afpub` + all readable codecs.

### Document model and workflows
- Multiple open documents in tabs; extra windows per document (`ui.window.open`), Window menu
  lists them (`docs/control-protocol.md`).
- File ▸ New params: `{"width":1..300000,"height":1..300000,"mode":"rgb|gray|grayscale|cmyk|lab",
  "depth":8|16|32,"background":"white|black|backgroundColor|transparent|#rrggbb",
  "resolution":dpi,"name":str}` (`crates/engine/src/commands.rs:402`).
- Keyboard shortcuts come from `crates/ui-egui/src/menu_catalog.rs` + the registry and are fully
  remappable (`edit.keyboardShortcuts`, `.kys` import). A safe sample: ⌘N/⌘O/⌘S/⇧⌘S (New/Open/
  Save/Save As), ⌘Z/⇧⌘Z (Undo/Redo, `crates/engine/src/commands.rs:452`), ⌘J (Layer via Copy,
  `crates/engine/src/edit_cmds.rs:982`), ⌘Y/⇧⌘Y (Proof Colors / Gamut Warning,
  `crates/engine/src/color_cmds.rs:1184,1193`). Tool letters follow Photoshop (V move, B brush,
  E eraser, T type, …; `crates/ui-egui/src/state.rs` `Tool::key`). Prefer `commands --json` over
  memorised keys.
- Preferences live in `preferences.json` under `~/Library/Application Support/Photocraft`
  (override `PHOTOCRAFT_CONFIG_DIR`); autosaves in its `Recovery` folder; UI state in `ui.ron`
  (`docs/control-protocol.md`).

### Open / save / export flow
- Open: drag-drop (not Wayland), File ▸ Open, or `app.open {path}` / CLI / `doc_open`.
- Save: File ▸ Save writes the document's own PSD/PSB/`.pcraft`; Save As/Export As for anything
  else; exports report warnings (shown in the status bar and `ui.inspect.notices`).
- **Automation caveat:** over the control channel, path-based `file.*` commands are refused by
  design (ambient filesystem access); use `app.open` / `app.save` inside the granted
  `--automation-read-root` / `--automation-write-root` (`docs/control-protocol.md` §Engine
  commands, `crates/automation/src/workspace.rs`). Absolute paths outside the roots are refused.
- Drive a running app (exact shape from `docs/development.md`):
```sh
printf '%s\n' "{\"id\":\"auth\",\"method\":\"auth\",\"params\":{\"token\":\"$TOKEN\"}}" \
  '{"id":1,"method":"engine.execute","params":{"command":"layer.newAdjustmentLayer.hueSaturation","params":{"hue":30}}}' \
  '{"id":2,"method":"ui.screenshot","params":{"path":"evidence/shot.png"}}' | nc 127.0.0.1 7878
```
`ui.screenshot` raises the window first (macOS stops rendering occluded windows) and captures the
app's own window — this is the supported way for an agent to "see" the app.

## Working with an AI agent

Legitimate jobs around the app:
- **Batch convert/prepare inputs**: `photocraft-cli batch` or `convert` — e.g. normalise a folder
  to PNG/TIFF, pick JPEG quality, keep TIFF layers with `--tiff-layers`. Probe first with
  `photocraft-cli info <file> --compact` and read `warnings`.
- **Author assets programmatically**: build layered documents headlessly with `run --new ... --cmd
  ... --out ...`, or record Actions in the app and replay them via `batch`/MCP; `.atn` files from
  Photoshop import (112 events; unmapped steps fail by name with a warning).
- **Drive the engine over MCP or the control channel** rather than the GUI: `command_run` /
  `engine.execute` with ids discovered from `command_list` (`enabled`/`disabledReason`/
  `needsDocument` tell you if you must open a document first). Use `doc_render_preview` /
  `ui.screenshot` for visual verification, `doc_inspect` for structure, `jobs_list` to wait.
- **Inspect/repair native files**: `.pcraft` is documented and versioned (`crates/format/src/`;
  `manifest.json` + blake3-addressed tiles/blobs, migrations in `migrate.rs`, `TooNew` refusal for
  newer bundles). You may read/salvage the manifest; recover crashed sessions from the `Recovery`
  folder rather than editing tiles. Never hand-edit `tiles/`/`blobs/` — hashes are the identity.
- **Verify exports**: reopen them (`info`, `convert` to PNG, `document.pixel`/`render_preview`),
  and parse warnings; for PSD deliverables, verify in Photoshop itself when acceptance matters.

Must NOT attempt:
- Blind GUI automation (synthetic clicks/CGEvent on the window) — drive the control channel/MCP
  instead; for visual checks screenshot the app's own window (`ui.screenshot`), never a screen
  region (it can grab other apps).
- Assuming Photoshop features: AI/generative, `.8BF`/UXP plug-ins, type on a path, full-screen
  Select and Mask/Content-Aware workspaces, JPEG XL, Photoshop PDF, AVIF read, HEIC write.
- Assuming a re-saved PSD is byte-identical or Photoshop-accepted (verify).
- Treating unknown CLI flags/params as tolerated: the parser errors (exit 2), and strict commands
  reject unknown param keys (`crates/engine/src/param_check.rs`).
- Hand-editing `.pcraft` tiles/blobs (content hashes are the identity; edits corrupt the bundle),
  or editing `preferences.json` while the app runs (the app rewrites it on change).

## Verification protocol

Alpha discipline — every deliverable gets one throwaway round trip and evidence:
1. **Round-trip test**: `photocraft-cli run --new '{"width":256,"height":256}' --cmd ... --out
   check.pcraft` → `convert check.pcraft check.png` → `info check.png --compact`; or open → edit →
   save → reopen in PhotoCraft and (when it matters) in the target consumer app.
2. **Never trust a silent export**: warnings are the contract (`warnings` in replies, `warning:`
   lines on stderr). An export that flattens adjustment layers, drops metadata or reduces 16-bit
   to 8-bit says so — read it. `crates/codecs` `fidelity_warnings` exists precisely so you can
   predict loss before writing.
3. **Version and back up project files per session**: keep a `.pcraft` (or PSD) per iteration
   rather than overwriting; the app is alpha (953 open issues, 22/25 perf budgets missed) and the
   launcher auto-updates — update the app between projects, not mid-project. Record
   `photocraft --version` (build SHA included) with any automation result.
4. **Headless first, live app second**: prove a pipeline with `photocraft-cli`/MCP-headless
   (deterministic, no window); only then bridge to the live app for UI-level steps. For live
   automation, always check `ui.inspect` state before and after, and prefer document-scoped
   commands over screen coordinates.
5. **On failure, keep the artifacts**: failed jobs leave the document unchanged and recovery
   files intact (`docs/development.md`), so preserve the input and error text for triage.

## Sources & evidence

- Repo: https://github.com/storytold/photocraft — HEAD inspected:
  `7250e6e29a9248ac17bc0cb20296e03e7cbed86a` (2026-10-14); workspace version 0.8.2.
- Installed app inspected: `/Applications/PhotoCraft.app` (CFBundleShortVersionString 0.8.2,
  `ai.storyteller.photocraft`), Info.plist document types: `.pcraft`, `.ora`, `.pdn`, `.psb`,
  `.qoi` + standard image types.
- Key files read: `README.md`, `Cargo.toml`, `ROADMAP.md`, `AGENTS.md`;
  `docs/architecture.md`, `docs/control-protocol.md`, `docs/gaps.md`, `docs/roadmap.md`,
  `docs/mcp.md`, `docs/development.md`, `docs/parity-checklist.md`, `docs/plugins.md`;
  `apps/photocraft-cli/src/lib.rs`, `apps/photocraft/src/main.rs`;
  `crates/format/src/lib.rs`, `crates/io/src/lib.rs`, `crates/codecs/src/format.rs`,
  `crates/codecs/README.md`, `crates/raw/src/lib.rs`, `crates/engine/src/commands.rs`,
  `crates/ui-egui/src/menu_catalog.rs`, `crates/ui-egui/src/shortcuts.rs`,
  `crates/ui-egui/src/tool_shortcuts.rs`, `crates/ui-egui/src/state.rs`.
- Shared libraries (`craft-libs`: craft-ui, craft-print) are pinned by git revision in
  `Cargo.toml`; nothing about the document/file-format behaviour needed them beyond what the
  repo documents.
