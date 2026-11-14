---
name: designcraft
description: DesignCraft is a desktop page-layout and publishing app (clean-room reimplementation of Adobe InDesign) for macOS, Windows, Linux and the web. Trigger whenever the user mentions DesignCraft, .designcraft or .idml files, InDesign-style layout (magazines, books, brochures, flyers, posters, newsletters), threading text across frames, placed images and swatches, print/PDF output, or asks to create, convert, export, automate, script (CLI/MCP/control channel), verify or troubleshoot a page-layout document — even when they do not name the app. Also trigger when preparing assets (images, Word/Excel/CSV) for layout, or checking whether a layout file can be opened or exported somewhere else.
---

# DesignCraft

## Overview

DesignCraft is a clean-room reimplementation of Adobe InDesign — page layout and publishing —
written in pure Rust and shipped for macOS, Windows, Linux and WebAssembly (`README.md`).
It mirrors InDesign's model: spreads and parent pages, frames and threaded stories, the Control
panel, paragraph/character/object styles, swatches, text wrap (`README.md`; `docs/architecture.md`).
Maturity is **pre-alpha**: `ROADMAP.md` says the alpha gate fails only on Primary Text Frame
autoflow adding undeletable pages (#165, ~5–7 h away); "ready for real work" is estimated at ~47%.
Source: GitHub org `storytold`, repo `designcraft` (`Cargo.toml` `repository`).
The app on the authoring machine is 0.7.1 while repo HEAD is 0.8.0 — verify against your installed version
(see `## Verification protocol`).

## Capabilities (verified)

### Core editing and layout

- Document model: spreads/pages (facing or not), parent pages with page-number markers, sections,
  layers, frames (text/graphic/unassigned), threaded stories, five style kinds with based-on chains
  and groups, swatches (process/spot/tints/gradients), corner options, text wrap, effects
  (`crates/doc`; `docs/target-app-parity.md` "Appendix: what works today").
- Text engine: Knuth–Plass paragraph composer plus single-line composer, dictionary hyphenation
  (English, Spanish), word/letter/glyph-scaling justification, keeps, baseline grid, columns,
  tabs, bullets/list numbering, drop caps, nested/GREP styles, footnotes/endnotes, tables,
  cross-references, index, TOC, text variables, text on a path, vertical/CJK text, RTL/Arabic
  basics (`crates/compose`; `docs/typography-parity.md`, `docs/cjk.md`, `docs/arabic-typography.md`).
- Threading works by hand plus commands: `text.thread`, `text.unthread`, `text.removeFromThread`
  (`crates/engine/src/cmd/thread.rs`); autoflow adds pages up to 2000 (`AUTOFLOW_MAX_PAGES`).
- Tools: Selection, Direct Selection, Type, Pen/Pencil, Rectangle/Ellipse/Polygon (+ frame
  variants), Line, Hand, Zoom, Gap, Scissors, Gradient, Eyedropper, Page tool
  (`crates/tools`; `docs/target-app-parity.md`; control channel `ui.tool.select`).
- Effects/transparency: drop/inner shadow, glows, feathers, bevel, satin, gradient feather,
  transparency flattener, separations/overprint preview, PDF output-keeping soft effects
  (`crates/engine/src/cmd/object.rs`, `docs/target-app-parity.md`).
- Data Merge from a linked CSV/TSV/text/`.xlsx` source; placeholders for text, image, QR,
  hyperlink; `data.merge` creates a new document and leaves the template unchanged
  (`crates/engine/src/cmd/datamerge`; `docs/agents.md#data-merge`).

### Import / open

- Native **`.designcraft`** documents and **`.idml`** (InDesign Markup) — `file.open` dispatches
  on `.idml`; `file.openIdml` opens IDML packages; `file.openBytes` takes base64 for either
  (`crates/engine/src/cmd/file.rs:160-234`, `crates/engine/src/cmd/interchange.rs:10-18`).
- Placed graphics: PNG, JPEG, GIF, WebP, TIFF (incl. CMYK), BMP, PSD/PSB composite, SVG, PDF (a
  chosen page, first page by default), PDF-compatible Illustrator `.ai`, EPS (shown through its
  preview only — no PostScript interpreter); media files become media frames
  (`crates/images`; `crates/engine/src/cmd/file.rs` place filters; `apps/designcraft/src/main.rs`
  `open_filters`).
- Placed text: Word `.docx` (styles by name), RTF, plain text, Markdown, `.xlsx` as a table,
  InDesign Tagged Text (`crates/textimport/src/lib.rs:93-117`; `crates/engine/src/cmd/place_text.rs`).
- Resources: `.ase` swatch exchange load/save; `.icc`/`.icm` profiles
  (`crates/color`; `docs/file-format-parity.md`).

### Save / native project format

- `.designcraft` is a zip: `mimetype` (stored) `application/vnd.designcraft+zip`, `meta.json`
  (format version), `document.json` (pretty JSON), `assets/<id>.<ext>` byte-for-byte (one copy per
  distinct file, unreferenced assets dropped). Format `VERSION = 2`; older JSON documents still
  open and old versions are upgraded on load; a newer format version refuses to open
  (`crates/format/src/lib.rs:1-144`; save/open in `crates/engine/src/cmd/file.rs`).

### Export

- **PDF** via `file.exportPdf`: real selectable text with subset fonts, DeviceCMYK/RGB, spot
  separations, bleed/marks, spreads, tagged PDF, PDF/X-4 with output intent and built-in checks,
  PDF/A-2b, compressed images, interactive extras (links, buttons, AcroForm fields, page
  transitions, media) (`crates/pdf`; `crates/engine/src/cmd/export.rs:11-13`).
- **IDML** via `file.exportIdml` (embedded images optional; verified opening in InDesign 2026 by
  the project, no real-file corpus yet) (`crates/engine/src/cmd/interchange.rs:12-13`;
  `docs/file-format-parity.md`).
- **EPUB**: reflowable `file.exportEpub` and fixed-layout `file.exportFixedEpub`
  (`crates/epub/src/lib.rs`; fixed-layout is page images with text kept for search).
- **HTML**: `file.exportHtml` — one self-contained page in reading order (`crates/engine/src/cmd/export.rs:25-27`).
- **Text**: `file.exportText` as `txt`, `rtf` or `tagged` (`crates/engine/src/cmd/export.rs:28-30`).
- **XML**: `file.exportXml` / `file.importXml` (`crates/engine/src/cmd/xml.rs`).
- **Raster**: PNG from the UI (`app.exportPng`, ⌘E) and CLI; JPEG from the CLI only at quality 90
  (`apps/designcraft-cli/src/main.rs:297-318`; `docs/file-format-parity.md`).
- **Booklet** printer spreads as PDF (`file.printBooklet`); **Package** writes links, document
  fonts, IDML, optional PDF and a report (`crates/engine/src/cmd/package.rs`;
  `crates/engine/src/cmd/export.rs:22-24`).

### Automation surfaces (all verified in code)

- **Every user-visible action is a command**: 446 engine commands (188 placed in menus) + 99 UI
  commands; menu bar 9 menus / 49 submenus / 340 items (`crates/engine/src/cmd/mod.rs:150-211`;
  `crates/ui-egui/src/menus.rs` `UI_COMMANDS` & `MENUS`; `docs/target-app-parity.md` measured).
  Discover them at runtime: `designcraft-cli commands [FILTER]` and
  `designcraft-cli describe <id>` (label, menu, shortcut, params).
- **CLI** `designcraft-cli`: `run`, `commands`, `describe`, `script`, `app`, `mcp`, `perf`,
  `bench`, `validate-pdf`, `links`, `--version` (`apps/designcraft-cli/src/main.rs:38-39`).
  Scripts support `$N.path` references to earlier step results (`docs/agents.md`).
- **MCP server**: `designcraft-cli mcp [--connect PORT] [--sample]`, newline-delimited JSON-RPC
  on stdio; tools include `list_commands`, `execute`, `batch`, `inspect_document`, `get_story`,
  `set_story_text`, `new_document`, `open_document`, `save_document`, `place_image`,
  `render_page`, `export_png`, `screenshot`, `select_tool`, `pointer`, `key`, `type_text`,
  `click`, `drag`, `menu_list`, `ui_inspect`, `ui_set`, `dialog_set/confirm/cancel`
  (`crates/mcp`; `docs/mcp.md`).
- **Control channel**: desktop app with `--control <port>` (or `DESIGNCRAFT_CONTROL_PORT`)
  speaks JSON lines on `127.0.0.1` — `engine.execute`, `engine.commands`,
  `document.inspect`, `ui.inspect`, `ui.pointer`, `ui.key`, `ui.text`, `ui.click`, `ui.drag`,
  `ui.screenshot`, `ui.render`, `ui.dialog.*`, `ui.menu.invoke`, `app.open/save/export/quit`
  (`apps/designcraft/src/control_server.rs`; `crates/ui-egui/src/control.rs`; `docs/control-protocol.md`).
  No authentication; malformed lines close the connection.
- **Web build**: same UI in WASM via trunk, WebGPU with WebGL2 fallback; open/place through the
  browser picker or drag-and-drop; **no control channel** (`apps/designcraft-web`; `README.md`).

### Platform notes

- macOS is the primary, best-tested platform; Windows/Linux work but have known failures
  (`docs/hardware-parity.md`). Canvas rasterizes on CPU (vello_cpu, multithreaded); GPU only
  presents (wgpu: Metal/DX12/Vulkan/OpenGL) (`docs/architecture.md`).
- Localization partial: e.g. Japanese 95%, most others 83–85%, pt-BR 61%; Hindi/Indonesian/
  Korean/Vietnamese none (`ROADMAP.md`; `docs/localization-parity.md`).
- Crash recovery: unsaved documents written every 30 s (default `recovery_minutes: 0.5`) into a
  per-run locked folder and reopened after a crash (`crates/ui-egui/src/lib.rs:909-916`;
  `crates/engine/src/recovery.rs`; `apps/designcraft/src/profile.rs`).

## Known limitations and not-implemented

- **Not InDesign parity; pre-alpha.** Alpha gate fails on Primary Text Frame autoflow (#165);
  expect missing depth across areas (`ROADMAP.md`; `docs/gaps.md`).
- **`.indd` cannot be opened** (nor `.indt`, `.indb`, `.indl`, `.idms`, `.icml`, QuarkXPress,
  PageMaker). No INDD-reading code exists; only IDML is exchanged (`docs/gaps.md` #2;
  `docs/file-format-parity.md`; grep confirms no `.indd` reader).
- **No ExtendScript/UXP compatibility**: InDesign scripts do not run; only DesignCraft's own
  command/script/MCP API. No plug-in model (`docs/gaps.md` #22–23).
- **PDF/print gaps:** no PDF/X-1a or X-3, no `.joboptions`/PDF presets, no PDF/UA validation, no
  PostScript import or export; printing is PDF → CUPS (macOS/Linux) / Windows spooler, physical
  print output unvalidated (`docs/file-format-parity.md`; `docs/gaps.md` #9–10).
- **Editing bugs on Windows/Linux:** object copy/paste and right-click context menus fail for
  several users; Paste in Place can land on page 1; caret formatting can be discarded
  (`docs/gaps.md` #1; `docs/ui-parity.md`). macOS does not have these copy/paste failures.
- **No canvas IME** for Chinese/Japanese/Korean (#322) (`docs/gaps.md` #8).
- **Typography fidelity unmeasured:** no comparison against InDesign's line breaks; optical
  kerning falls back to metrics; a frame goes overset where InDesign only needs the baseline;
  hyphenation only English/Spanish; spelling English only (`docs/typography-parity.md`;
  `docs/gaps.md` #4, #13).
- **Startup can crash on some GPUs** (Intel Mac Metal, some Windows drivers) despite a backend
  fallback via `gpu.json` (`docs/gaps.md` #5; `README.md` “Graphics backend”).
- **Installed fonts not always found** (user font folders, font managers, Adobe Fonts) — text can
  fall back to Source Sans 3 (`docs/gaps.md` #6).
- **Web build** has no control channel, no folder-based document fonts (`docs/control-protocol.md`;
  `README.md`).
- **Long documents shallow:** Books basic; no book-wide TOC/index (`docs/gaps.md` #15).
- **No in-app media playback**; placed video/audio are poster/placeholder plus PDF/EPUB embedding
  (`docs/target-app-parity.md`).
- **macOS bundle quirk (verified):** `packaging/macos/Info.plist.in` declares the document UTI
  with extension **`pcraft`** (a leftover from the sibling app's template) and the bundle has no
  `CFBundleDocumentTypes` — confirmed identical in the installed 0.7.1 bundle. Do not rely on
  Finder double-click or drag-on-icon to open `.designcraft` files (also open bug #211 for IDML);
  open from inside the app or pass the path on the command line instead.
- Claimed but unverified by this review: real IDML round-trip fixtures, line-break identity with
  InDesign for specific documents, and print fidelity — `docs/file-format-parity.md` labels these
  `~` / open (`#193, #338, #339, #340`).

## How to operate

### Launch on macOS

- Launch the app: `open -a "DesignCraft"` (bundle `/Applications/DesignCraft.app`,
  id `ai.storyteller.designcraft`, installed 0.7.1).
- Open documents at launch by passing paths (and flags) to the executable:
  `/Applications/DesignCraft.app/Contents/MacOS/DesignCraft [--sample] [--control PORT] [FILE…]`
  — positional files are opened with `file.open`; `--sample` opens the built-in magazine;
  `--version` prints and exits (`apps/designcraft/src/main.rs:242-260,343-350`).
- Prefer the **CLI/headless** route for automation; the macOS `.app` ships only the desktop
  binary, the CLI is a separate release asset (`docs/mcp.md`).
- A locked/unfocused screen still renders offscreen: use `ui.render` or
  `designcraft-cli run --sample --all-pages DIR` (`docs/control-protocol.md`;
  `apps/designcraft-cli/src/main.rs:283-290`).

### Environment variables (verified)

| Variable | Effect |
|---|---|
| `DESIGNCRAFT_CONTROL_PORT` | starts the control channel like `--control` (`apps/designcraft/src/main.rs:246`) |
| `DESIGNCRAFT_CONFIG_DIR` | isolates settings/recovery in a directory (`apps/designcraft/src/profile.rs:10-33`; `docs/control-protocol.md`) |
| `DESIGNCRAFT_NO_PREFS` | reads/writes no preference files (`apps/designcraft/src/main.rs:95`) |
| `WGPU_BACKEND` | forces `metal`/`dx12`/`vulkan`/`gl` for the compositing window (`README.md`) |
| `RUST_LOG` | log levels; logs also go to `logs/designcraft.log` in the settings dir (`README.md`) |

### Files and settings (macOS)

- Settings dir: `~/Library/Application Support/DesignCraft/` — `ui.json`, `prefs.json`,
  `gpu.json`, `logs/designcraft.log` (rotated, capped 16 MiB), `Recovery/` (`README.md`).
- Coordinates in commands/scripts are **points (1/72 in), y down, in spread space**: a single
  page’s top-left is (0,0); on a facing spread the right page starts at x = page width
  (`docs/mcp.md` “Coordinates”). Text positions are **UTF-8 byte offsets**, not character counts
  (`docs/mcp.md` “Text offsets”).

### Core workflow concepts

- Multiple documents open at once in tabs (`file.activate`/`file.close` in
  `crates/engine/src/cmd/file.rs:55-63`; ⌘F6 cycles in `crates/ui-egui/src/menus.rs`).
- A frame is drawn with the Rectangle/Ellipse/Polygon Frame tools or `frame.create`; a story
  lives on one or more frames via threads; the loaded text cursor is what the port-click gesture
  uses (`README.md`; `crates/engine/src/cmd/thread.rs`).
- Parent pages hold repeated items; ⌘⇧-click a parent item to override it on a page
  (`docs/target-app-parity.md`).
- Undo is one step per gesture; commands are journaled and replayable as scripts
  (`docs/architecture.md`).

### Open / save / export flows

```sh
# GUI: File → Open (⌘O), Save (⌘S), Save As (⌘⇧S); File → Export PDF…, Export EPUB…, Export IDML…
# Headless CLI (from a checkout or the CLI release asset):
designcraft-cli run --sample --all-pages out/                    # one PNG per page
designcraft-cli run --in doc.designcraft --export out.pdf
designcraft-cli run --in doc.idml --export out.designcraft       # IDML → native
designcraft-cli script page.dcs --in template.designcraft --save merged.designcraft --export page.pdf
designcraft-cli app --method ui.screenshot '{"path": "/tmp/w.png"}'   # running app, port 7979
```

- `run` applies `--page`, `--scale`, `--pdf-options` to the exports that follow them; `.jpg`
  selects JPEG, anything else raster is PNG; `.designcraft` writes native, `.idml` IDML,
  `.pdf` PDF, `.epub` EPUB (`apps/designcraft-cli/src/main.rs:220-318`).
- Every command is callable in the running app: `designcraft-cli app <command.id> '<json>'`,
  or directly JSON-lines on the control port (`docs/agents.md`).
- Frequently used verified shortcuts: ⌘N New, ⌘O Open, ⌘S Save, ⌘⇧S Save As, ⌘W Close,
  ⌘D Place, ⌘Z/⌘⇧Z Undo/Redo, ⌘C/⌘X/⌘V clipboard, ⌘⇧V Paste without Formatting, ⌘F Find/Change,
  ⌘K Preferences, ⌘E Export Page as PNG, ⌘Return Quick Apply, ⌘J Go to Page, Tab/⇧Tab hide/show
  panels (`crates/engine/src/cmd/*.rs` shortcut fields;
  `crates/ui-egui/src/menus.rs` UI_COMMANDS). Do not assume other InDesign shortcuts exist —
  query `designcraft-cli describe <id>`.

## Working with an AI agent

Legitimate, evidence-backed jobs:

- **Preferred integration: headless CLI or MCP in headless mode** (`designcraft-cli mcp`), which
  needs no window and returns page images as PNG (`docs/mcp.md`). Connected mode
  (`--connect PORT`) drives the live app and the change is visible in the window.
- **Compose whole documents from commands**: `file.new` → `frame.create` → `text.insert`/
  `story.setText` → `type.*`/`style.*` → `file.place` → `file.exportPdf`, all documented by
  `designcraft-cli describe` and `docs/mcp.md`.
- **Prepare importable assets:** rasterize/convert images to PNG/JPEG/TIFF/WebP, keep CMYK
  TIFF/JPEG when ink fidelity matters (`docs/file-format-parity.md`); convert text sources to
  `.docx`/`.rtf`/`.txt` or CSV/TSV/`.xlsx` for Data Merge; unsupported inputs (HEIC, `.xls`,
  `.indd`, `.doc`, `.qxd`) must be converted elsewhere first.
- **Interpret/repair native projects:** `.designcraft` is zip + `document.json` (serde model in
  `designcraft-doc`), assets under `assets/<id>.<ext>`, `meta.json.format/version`
  (`crates/format/src/lib.rs`); format ≤ 2 loads, > 2 errors with “update DesignCraft”. Repair by
  editing JSON only in a copy, then reopen with `file.open` in a throwaway session.
- **Verify exports:** check the command result (`file.exportPdf` returns `pages`, `bytes`,
  `warnings`), run `designcraft-cli validate-pdf out.pdf` for PDF/X-4, reopen IDML/EPUB/HTML
  outputs, and render pages with `ui.render`/`render_page` for visual checks.
- **Batch at scale:** `script` files and MCP `batch` with `$N.path` references; run one
  `$CARGO_TARGET_DIR` per parallel agent in a checkout (`docs/agents.md`; `AGENTS.md`).

Must NOT / cautions:

- Do not drive the **GUI blind**: keyboard/menu state depends on focus and platform; prefer
  commands, CLI, MCP or the control channel, and look at `ui.screenshot` before and after UI
  gestures (`docs/control-protocol.md`).
- Do not assume `.indd`, ExtendScript/UXP, `.joboptions`, PDF/X-1a/X-3, IME input or live
  HTML animation exist (see limitations).
- Do not use `app.quit` to close the app when unsaved work matters — `app.quit` quits without
  asking, unlike the ⌘Q/menu command (`docs/control-protocol.md` method table).
- Do not rely on Finder double-click opening `.designcraft` (macOS bundle declares `pcraft`).
- Do not use the control port on untrusted networks: it is loopback-only but unauthenticated
  (`docs/control-protocol.md`).

## Verification protocol

1. **Throwaway round-trip before real work:** new → add content → save `.designcraft` → export
   PDF/PNG → reopen the saved file and an exported IDML in a fresh session; confirm page count,
   story lengths (`document.inspect`) and bytes before trusting an output.
2. **Never trust a silent export:** read the returned `warnings` array (PDF export, `file.open`
   font warnings) and open the artifact elsewhere; PDF conformance for X-4 via
   `designcraft-cli validate-pdf`.
3. **Version and back up project files per session:** recovery autosaves every 30 s but is not a
   backup; save explicit copies (`file.saveACopy`) before large edits, and remember HEAD (0.8.0)
   may be newer than the installed app (0.7.1) — features in this skill can be absent or
   different in your install.
4. **Update the app only between projects**, never mid-layout; older documents open (format 1/2
   upgrade on load) but newer-than-install files refuse with “please update”.
5. **Exercise the alpha blocker:** long stories in a Primary Text Frame document can gain pages
   that cannot be deleted (#165) — thread manually (`text.thread`) or keep primary-text-frame
   autoflow out of test documents.

## Sources & evidence

- Repo: https://github.com/storytold/designcraft (org `storytold`), inspected at HEAD
  `11a51d5b665aec8d6e675bd107a8a01514f10d00` (“Release 0.8.0”), on 2026-10-14.
- Installed app: `/Applications/DesignCraft.app` 0.7.1 (`CFBundleShortVersionString`,
  `DesignCraftBuildCommit` 3624f488192a8eeade11bd27609c9e5056214e75) — **verify against your
  installed version**.
- Key files read: `README.md`, `Cargo.toml`, `ROADMAP.md`, `AGENTS.md`,
  `docs/agents.md`, `docs/mcp.md`, `docs/control-protocol.md`, `docs/architecture.md`,
  `docs/gaps.md`, `docs/target-app-parity.md`, `docs/typography-parity.md`,
  `docs/file-format-parity.md`, `docs/ui-parity.md`, `docs/hardware-parity.md`, `docs/roadmap.md`,
  `apps/designcraft/src/main.rs`, `apps/designcraft/src/profile.rs`,
  `apps/designcraft-cli/src/main.rs`, `crates/engine/src/cmd/mod.rs`, `file.rs`, `export.rs`,
  `interchange.rs`, `thread.rs`, `crates/format/src/lib.rs`, `crates/textimport/src/lib.rs`,
  `crates/ui-egui/src/menus.rs`, `crates/ui-egui/src/control.rs`,
  `packaging/macos/Info.plist.in`.
- Deeper surface reference: `references/agent-surfaces.md` (CLI, MCP, control channel, script
  syntax at a glance). Ground truth is always the running app itself:
  `designcraft-cli commands` / `describe`.
