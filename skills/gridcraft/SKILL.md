---
name: gridcraft
description: "GridCraft is an open-source, clean-room Microsoft Excel-style spreadsheet app (XLSX-native, pure Rust) for macOS, Windows, Linux, BSD and the web, built to be driven by agents via a CLI, an MCP server and a localhost JSON control channel. Trigger this skill whenever the user mentions GridCraft by name; asks about its capabilities, file formats or keyboard shortcuts; wants to create, edit, convert, evaluate, format, chart, pivot, print or verify spreadsheet data in it; wants to automate or script it (MCP, CLI, control channel); or needs to troubleshoot an export it produced — even if they don't name the app but describe the job ('make an Excel file', 'edit this workbook', 'calculate this in a sheet', 'convert this CSV to XLSX')."
---

# GridCraft

## Overview

GridCraft is a clean-room, open-source reimplementation of Microsoft Excel: an XLSX-native spreadsheet with formulas, formatting, tables, charts, PivotTables, printing and a JSON automation surface. It is written in pure Rust by the ArtCraft team and runs natively on macOS, Windows, Linux and BSD plus in the browser via WebAssembly (README.md; Cargo.toml workspace). It is **alpha** software: the six core workflows pass end to end, but breadth is ~75% and "ready for real work" is estimated at ~50% (ROADMAP.md "Headline numbers"). Source: https://github.com/storytold/gridcraft. HEAD inspected is `0.7.0` while the app installed at `/Applications/GridCraft.app` is `0.6.1` — **verify against your installed version**; this skill describes repo HEAD (`d9d09f0`).

GridCraft's distinguishing asset for agents: **everything user-visible is a command** in one registry, reachable over MCP, the CLI, or a localhost control channel — no GUI scripting is needed for most work (AGENTS.md "Everything is a command"; crates/engine/src/cmd/mod.rs:123 `command_specs()`).

## Capabilities (verified)

### Engine and editing
- XLSX-native workbook model; ~340 registered engine command ids (`cmd!` macros across `crates/engine/src/cmd/*.rs`; registry at `crates/engine/src/cmd/mod.rs:123`), covering Excel's ribbon namespaces (`home.bold`, `insert.chart`, `data.sort`) plus primitives (`cell.set`, `range.setValues`). 274 / 290 of Excel's ribbon catalog is implemented, per the generated `docs/parity-checklist.md` (source: `crates/engine/src/catalog.rs`).
- Formula engine: 513 of Excel's 523 worksheet function names present, 504 working (`docs/function-parity.md`); dynamic arrays/spilling, LET, LAMBDA, MAP/REDUCE/SCAN/BYROW/BYCOL/MAKEARRAY, structured table references (`crates/calc/src/eval.rs` `SPECIAL_FUNCTIONS`; README "Capable"). Cached-value "calc oracle" comparison against Excel-saved files lives in `gridcraft-cli check` (`apps/gridcraft-cli/src/check.rs`).
- Full Excel number-format language (`crates/numfmt`); 47 cell styles, all conditional-format kinds; cell styles, borders, alignment (`crates/engine/src/cmd/format.rs`).
- Editing: undo/redo, clipboard with Paste Special, fill (series/fill handle), multi-level sort, AutoFilter, Flash Fill, Text to Columns, Remove Duplicates, data validation, outlining/subtotals, find/replace, Go To, freeze panes, merged cells (`crates/engine/src/cmd/{edit,data,format}.rs`).
- Tables with header/total rows, banded styles, structured references, table AutoFilter + slicer criteria (`crates/engine/src/cmd/insert.rs`, `crates/engine/src/cmd/slicer.rs`).
- PivotTables: field list, layouts, report filters, date grouping, show-values-as, calculated fields, PivotCharts; XLSX round trip (`crates/engine/src/cmd/pivot.rs`; README "PivotTables"). Slicers can be inserted/toggled in-session but are **not written to XLSX** (`crates/engine/src/cmd/slicer.rs`; `crates/xlsx/src/passthrough.rs:135` drops slicer parts — see limitations).
- Charts: 25 kinds modelled including column/bar/line/pie/area/scatter/bubble/radar/histogram/waterfall/funnel/treemap/sunburst/box/stock/combo (`crates/model/src/features.rs:370` `ChartKind`); sparklines; trendlines; chart sheets are kept byte-for-byte on save but cannot be edited or created (`crates/xlsx/src/passthrough.rs`, README).
- Objects: floating and in-cell pictures (PNG/JPEG; ≤16 MiB, ≤8192 px/side — `crates/engine/src/cmd/insert.rs`, `docs/cell-pictures.md`), shapes, text boxes, Draw ink, symbols, cell checkboxes, hyperlinks (opening is restricted to http/https/mailto — `crates/engine/src/links.rs`).
- Review: notes, threaded comments with replies/resolve, spell check, thesaurus, workbook statistics, accessibility check, sheet/workbook protection with Excel-compatible password hashes, Allow Edit Ranges (`crates/engine/src/cmd/{review,extra}.rs`).
- Analysis: Goal Seek, Scenario Manager, Data Table, Advanced Filter, Consolidate, Solver (Simplex LP with integer/binary, a local nonlinear method and Evolutionary; sensitivity/population reports missing), Analysis ToolPak (13 of 19 tools), Forecast Sheet (`crates/engine/src/cmd/{whatif,solver,analysis,forecast}.rs`; `docs/gaps.md` §13).
- Print & PDF: page setup, print areas/titles, headers/footers, Page Layout and Page Break Preview, native printing via the system print dialog (craft-print), PDF export through GridCraft's own PDF 1.7 writer (`crates/engine/src/cmd/print.rs:22` `file.exportPdf`; `crates/pdf/src/lib.rs`; README "Page Break Preview"). Caution: only the 14 standard PDF fonts, no embedding — **non-Latin text does not export** (`docs/file-format-parity.md`).
- Multiple workbooks per session plus extra windows (`file.open` appends documents, `window.activate {index}` switches — `crates/engine/src/cmd/file.rs`; `view.newWindow` opens a linked second window — `crates/engine/src/cmd/extra.rs:144`).
- UI chrome translated in 11 selectable languages (en, es, zh, ja, ko, ru, pt-BR, de, cs, fr, sr — `crates/ui-egui/src/i18n.rs:24`); coverage is partial (~12% of ~2,200 strings, ribbon/menus mostly) and formulas/number formats are en-US only (`docs/localization-parity.md`).

### File formats (what the code actually reads/writes)
Handled by `crates/engine/src/io.rs` (`FileKind`), `crates/xlsx/src` and `crates/engine/src/cmd/file.rs`; full matrix in `docs/file-format-parity.md`.

| Format | Read | Write | Notes |
|---|---|---|---|
| `.xlsx`, `.xlsm` | yes | yes | XLSX is native. `.xlsm`/`.xltm` keep the VBA project byte-for-byte (never run); `.xlsx` never carries macros. Saved transitional even when opened from Strict Open XML |
| `.xltx`, `.xltm` | yes | partial | Saved with the template content type by extension; no "new from template" behaviour |
| `.xls`, `.xlt` | partial import | **no** | BIFF8 values, formulas, number formats, merges, sizes, names, print areas; no styles, charts, pictures, comments, CF, validation; BIFF5/encrypted refused; opens as unsaved import (Save As needed) |
| `.xlsb` | values-only import | **no** | Sheets, values, dates, merges, cached formula results; no formulas/formatting (`docs/xlsb-import.md`) |
| `.ods` | values-only import | **no** | Sheets, values, dates, merges, repeated cells, cached results; encrypted ODS refused (`docs/ods-import.md`) |
| `.csv` | yes | yes | UTF-8/UTF-16 BOM, Windows-1252 fallback, delimiter detection; export writes displayed values (General-format numbers written in full precision) with CRLF, no BOM; a file opened as `;`-separated stays `;` (`crates/xlsx/src/csv.rs`, `crates/engine/src/io.rs:234`) |
| `.tsv`, `.tab`, `.txt` | yes | yes | tab-delimited |
| `.json` | yes | yes | GridCraft's own workbook JSON (debug), not Power Query JSON (`FileKind::Json`, `crates/engine/src/io.rs`) |
| `.html`, `.htm` | yes | yes | one sheet as a table; >100,001 rows export fails (`crates/engine/src/io.rs` `to_html`) |
| `.pdf` | — | yes | export of the active sheet via Save As `.pdf` / `file.exportPdf` |
| Password-encrypted `.xlsx`/`.xlsm` (Agile/Standard) | yes | no | opens with `password`; saving writes it unencrypted as a new file (never overwrites the original); RC4 refused (`crates/xlsx/src/crypto.rs`) |

XLSX pass-through keeps custom XML, external links, connections, query tables, printer settings, form/ActiveX controls, OLE objects, sheet backgrounds and chart sheets (`crates/xlsx/src/passthrough.rs`). Dropped: slicers and slicer caches, timelines, the data model, table-attached query tables, unmodelled `extLst`, chart details (`docs/file-format-parity.md`).

### Automation surface (the main reason to use GridCraft over Excel)
- **CLI** `gridcraft-cli` (headless): `info`, `convert`, `eval`, `cat`, `check`, `run`, `commands`, `functions`, `mcp`, `send`, `version` (`apps/gridcraft-cli/src/main.rs`; `docs/cli.md`). `check` recalculates formulas and compares to Excel's cached values plus XLSX round-trip fidelity with machine-readable `--json` (`apps/gridcraft-cli/src/check.rs`).
- **MCP server** on stdio: `gridcraft-cli mcp` (headless in-process session) or `gridcraft-cli mcp --connect 7979` (bridged to a running window); 21 tools including `execute_command`, `read_range`, `write_range`, `set_cell`, `evaluate_formula`, `format_range`, `insert_chart`, `create_table`, `sort_range`, `filter`, `open_workbook`, `save_workbook`, `screenshot`, `list_functions` (`crates/mcp/src/tools.rs`; `docs/mcp.md`).
- **Control channel** of the desktop app: JSON lines on `127.0.0.1:<port>`, bound localhost-only (`apps/gridcraft/src/control_server.rs:15`). `engine.execute` reaches every command; `ui.click`/`ui.cell.*`/`ui.key`/`ui.text`/`ui.dialog.*` drive real pointer/keyboard/dialogs; `ui.screenshot` returns a PNG; `document.inspect`, `sheet.read`, `cell.get`, `engine.journal` inspect state (`crates/ui-egui/src/control.rs`; `docs/control-protocol.md`).
- **In-workbook scripts**: `automate.recordActions`, `automate.newScript`, `automate.runScript`, `automate.allScripts`, `automate.deleteScript`; saved in the workbook; `engine.journal` returns a replayable command list with secrets stripped (`crates/engine/src/cmd/extra.rs`).
- **Sample workbooks** for tests: `file.new {"sample": "sales"|"budget"|"grades"}` (`crates/engine/src/sample.rs`).
- **Web build** (WebAssembly) exists and is a workspace member: `apps/gridcraft-web` (trunk; `?sample=sales`, browser file picker for open, download for save — README "Web").
- Offscreen UI render for CI/screenshots without a window: `cargo run -p gridcraft-ui-egui --example snapshot -- --sample sales out.png` (`crates/ui-egui/examples/snapshot.rs`).

## Known limitations and not-implemented

- **Alpha, ~50% "ready for real work"** (`ROADMAP.md`); the ranked work list is `docs/gaps.md`.
- **XLSX output is unproven in Excel**: no real-world corpus run; whether Excel opens GridCraft's output without a repair prompt is unknown (`docs/gaps.md` §1). Treat every saved file as suspect until verified (see verification protocol).
- **Large workbooks fail**: ~100 MB XLSX does not open; recalculation is single-threaded (#175; `docs/gaps.md` §2; no threading in `crates/calc`).
- **Lossy saves**: slicers/slicer caches, timelines, data model, table-attached query tables, unmodelled `extLst` and chart details are dropped on XLSX save (`docs/gaps.md` §3; `crates/xlsx/src/passthrough.rs` `REWRITTEN` list). Slicers can be inserted and used in-session but are not written to file.
- **Charts lose fidelity**: histogram, box, waterfall, funnel, treemap, sunburst and stock charts do not survive XLSX round trip; axis scaling, label options, error bars and per-point formatting not modelled (`docs/gaps.md` §4; `Chart` struct has only title/legend/axis titles — `crates/model/src/features.rs`).
- **Non-Latin text**: CJK/Thai/Hebrew have system-font fallback but no complex shaping (Arabic/Devanagari), no bidi; PDF export cannot carry any non-Latin script (`docs/gaps.md` §5; `docs/localization-parity.md`).
- **Calc correctness edge cases** exist (15-significant-digit equality, spill invalidation after structural edits, 3-D span deletion — `docs/gaps.md` §6). Verify numbers against an independent oracle for high-stakes work.
- **Legacy/foreign formats are read-only and partial**: `.xls` (no styles/objects, no write), `.xlsb`/`.ods` (values only, no write), encrypted workbooks cannot be saved with a password (`docs/gaps.md` §7).
- **No macros, no add-ins**: VBA is preserved byte-for-byte in `.xlsm`/`.xltm` but never executed; there is no VBA/COM/add-in model (`docs/file-format-parity.md`; `home.addIns` returns a hint pointing to MCP/scripts).
- **Get & Transform is minimal (~10%)**: no Power Query editor, connections, refresh, From Web, stocks/geography data types or data-model relationships (`docs/parity-checklist.md` missing list; `docs/gaps.md` §12).
- **Missing Excel catalog entries** (generated checklist): `insert.smartArt/screenshot/map/timeline/wordArt/signatureLine/object/equation`, `data.fromWeb/stocks/geography/relationships/analyzeData`, `review.smartLookup/translate/showChanges` (`docs/parity-checklist.md`).
- **PivotTables unverified in Excel**; calculated items and `GETPIVOTDATA` not implemented (`docs/gaps.md` §8; absent from `crates/functions/src` and `crates/engine/src/cmd/pivot.rs`).
- **Keyboard parity is partial**: ~60 shortcuts declared in the registry at this commit (62 unique `shortcut` strings) vs Excel's 200+ (`docs/gaps.md` §9); ribbon key tips cover only some Home/legacy paths (README "Ribbon access keys").
- No iOS/Android; no collaboration/co-authoring (`ROADMAP.md` "By dimension": platforms ~80%, the gap is mobile).

Claimed but unverified in code: the README's "89% of the Excel ribbon commands" figure is stale — the generated checklist in the same repo says 274/290 (94.5%) (`README.md` vs `docs/parity-checklist.md`).

## How to operate

Launch (macOS):
- `open -a GridCraft` or `/Applications/GridCraft.app/Contents/MacOS/GridCraft` (bundle id `ai.storyteller.gridcraft`; Info.plist). Do not launch the GUI when a headless path suffices — the CLI/MCP cover most agent work.
- Desktop flags actually parsed (`apps/gridcraft/src/main.rs:253`): `--version`/`-V`, `--control <port>`, `--sample [sales|budget|grades]`, and positional file paths (a bare `--sample` defaults to `sales`). Env: `GRIDCRAFT_CONTROL_PORT`, `GRIDCRAFT_NO_PREFS` (no saved prefs, stderr-only logs — use in agent test runs), `GRIDCRAFT_NO_NATIVE_MENU` (macOS), `RUST_LOG` (env_logger directives).
- The `gridcraft-cli` binary is not inside the app bundle: get it from GitHub releases (`gridcraft-cli-<ver>-macos-universal.zip`, signed/notarized) or build with `cargo install --path apps/gridcraft-cli` / `cargo run -p gridcraft-cli -- <subcommand>` (`docs/releasing.md`; README Downloads).
- Settings/logs on macOS: `~/Library/Application Support/GridCraft/` (`ui.json`, `prefs.json`, `logs/gridcraft.log` with two rotated backups — README "Logs").
- Document model: one app window with one or more open workbooks; open adds a document, `window.activate {"index": n}` switches, `view.newWindow` opens a second linked window. Sheets are workbook tabs (`sheet.activate`, `sheet.next/previous`); the `sheet` param selects a sheet by name in most commands.
- Files open via File → Open, Finder double-click/Open With, drag-and-drop onto the window, command-line paths, `file.open`, or MCP `open_workbook`. Imports (`.xls`, `.xlsb`, `.ods`, encrypted) open without a save path by design; Save then asks where to write.

Core workflows:
- Headless edit/convert: `gridcraft-cli run --in book.xlsx --cmd 'home.bold={"range":"A1:C1"}' --cmd 'cell.set={"cell":"D2","input":"=B2*C2"}' --out book.xlsx --print A1:D5` (`docs/cli.md`).
- Evaluate: `gridcraft-cli eval '=XLOOKUP("b",{"a","b"},{1,2})'` or `eval '=SUM(B2:B9)' --in book.xlsx`.
- Inspect: `gridcraft-cli info book.xlsx --json`; read: `gridcraft-cli cat book.xlsx --range B4:F15 --csv`.
- Drive the running app: start `gridcraft --control 7979`, then JSON lines like `{"id":1,"method":"engine.execute","params":{"command":"cell.set","params":{"cell":"B2","input":"=SUM(A1:A9)"}}}`, then `{"id":2,"method":"ui.screenshot","params":{"path":"/tmp/shot.png"}}` (`docs/control-protocol.md`). One request per line, one reply per line.
- MCP: `claude mcp add gridcraft -- gridcraft-cli mcp` (headless) or `--connect 7979` (drives the visible window; adds `screenshot`).
- Fonts: GridCraft bundles none; it uses system fonts (README "License and credits"). UI text for a chosen language falls back to English when untranslated.

## Working with an AI agent

Legitimate agent work:
- **Prepare inputs**: generate CSV/TSV data files for import; convert `.xls`/`.xlsb`/`.ods` sources to `.xlsx` via `gridcraft-cli convert`.
- **Build/edit workbooks headlessly**: use `gridcraft-cli run` scripts or MCP tools; they exercise the same command registry as the UI, so results are reproducible. Use `commands --json`/`functions --json` to discover parameters rather than guessing (never invent a command id or param).
- **Verify outputs**: re-open saved files (`info`, `cat`, `check`) and compare. `gridcraft-cli check` is the strongest oracle: it compares your recalculated values against the cached values an Excel-authored file ships, and round-trips the file, exiting non-zero on any difference (`docs/cli.md` §check).
- **Drive the real UI only with eyes open**: over the control channel prefer commands first; use `ui.*` input plus `ui.screenshot` only to verify UI state. Screenshots settle animations first, so one screenshot is a reliable final state (`docs/control-protocol.md`).
- **Inspect/repair project files**: `.xlsx` is a ZIP of XML you may inspect generically; GridCraft's own JSON export (`file.saveBytes {"format":"json"}` / `.json`) round-trips the workbook model and is useful for debugging, but is **not** an interchange format (notes and hyperlinks break export — `docs/file-format-parity.md`).

What an agent must NOT do:
- Never assume `.xls`, `.xlsb` or `.ods` can be written, or that macros run. Saving to these extensions returns an explicit error (`crates/engine/src/io.rs:190-208`).
- Never call `file.save`/`app.save` without a path when scripting: with no path it files a `UiRequest::Dialog(saveAs)` instead of writing (`crates/engine/src/cmd/file.rs:99-105`); programmatic runs should always pass `path`.
- Never trust an export silently — a save can drop slicers/timelines/data-model parts; PDF silently lacks non-Latin glyphs. Re-open and diff.
- Don't drive the GUI blind (clicking coordinates without `ui.inspect`/screenshot feedback); hit-testing depends on window size and scroll state.
- Don't build ranges from far-apart cells: a two-cell span across XFD1048576 expands to an enormous rectangle (CSV/TSV export refuses anything over 512 MiB with an error instead of allocating — `docs/file-format-parity.md` #528).

## Verification protocol

Alpha discipline — apply to every GridCraft artifact:
1. **Throwaway round trip**: start from a copy (or `--sample`), make one change, save, re-open in a fresh session (`gridcraft-cli info`/`cat`), and export again; confirm the change and the file size/type.
2. **Never trust a silent export**: for `.xlsx` use `gridcraft-cli check` (calc oracle + round-trip categories); for CSV/PDF open the exported file (text editor / PDF viewer) and spot-check values and scripts; for `.xlsm`, confirm macros are present but remember they never run.
3. **Version and back up per session**: work on copies (`book.working.xlsx`), keep the original untouched; there is no autosave/recovery soak yet (`docs/gaps.md` §10), so only what you save exists on disk.
4. **Version drift**: the installed app can lag repo HEAD (here: 0.6.1 installed vs 0.7.0 at HEAD) — verify against your installed version; update only between projects; re-run your round-trip test after an update.
5. **Cross-check numbers** for finance/science work: compare against an independent implementation or Excel, because calc edge cases exist (`docs/gaps.md` §6).

## Sources & evidence

- Repo: https://github.com/storytold/gridcraft — HEAD commit inspected: `d9d09f0baa912e88c5111107903fc8c640214b57` ("Release 0.7.0", 2026-10-14); installed app `/Applications/GridCraft.app` reports `0.6.1` (Contents/Info.plist).
- Key files read: `README.md`, `Cargo.toml`, `ROADMAP.md`, `AGENTS.md`; `apps/gridcraft/src/main.rs`, `apps/gridcraft/src/control_server.rs`, `apps/gridcraft-cli/src/main.rs`, `apps/gridcraft-cli/src/check.rs`; `crates/engine/src/io.rs`, `crates/engine/src/cmd/{mod,file,insert,print,slicer,extra,view}.rs`; `crates/model/src/features.rs`; `crates/ui-egui/src/{control,i18n}.rs`; `crates/mcp/src/tools.rs`; `crates/xlsx/src/{csv.rs,passthrough.rs}`; `apps/gridcraft-web/src/*`.
- Docs read: `docs/cli.md`, `docs/mcp.md`, `docs/control-protocol.md`, `docs/file-format-parity.md`, `docs/function-parity.md`, `docs/parity-checklist.md`, `docs/gaps.md`, `docs/localization-parity.md`, `docs/{xlsb,ods}-import.md`, `docs/cell-pictures.md`.
- Date: 2026-10-14.
