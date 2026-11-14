# GridCraft — evidence table

For the orchestrator's spot-check. All paths are repo-relative in `storytold/gridcraft` at HEAD `d9d09f0baa912e88c5111107903fc8c640214b57` (2026-10-14). Tiers: **implemented** = code path exists and is wired into UI/CLI; **partial** = visibly incomplete; **claimed** = stated in docs/README but not confirmed in code.

| # | Capability claim | Evidence (file) | Tier |
|---|---|---|---|
| 1 | XLSX is the native read/write format (cells, styles, formulas, tables, CF, validation, comments, charts, pivots, print settings round-trip) | `crates/engine/src/io.rs` (`FileKind`), `crates/xlsx/src/read.rs`, `crates/xlsx/src/write.rs`, `docs/file-format-parity.md` | implemented |
| 2 | ~340 engine commands registered; every UI action is a command reachable by CLI/MCP/control channel | `crates/engine/src/cmd/mod.rs:123` `command_specs()`; count of `cmd!` ids in `crates/engine/src/cmd/*.rs`; `AGENTS.md` | implemented |
| 3 | 274/290 of Excel's ribbon catalog implemented (94.5%) | `docs/parity-checklist.md` (generated from `crates/engine/src/catalog.rs`) | implemented (breadth only; README's "89%" figure is stale) |
| 4 | 513/523 Excel worksheet function names present, 504 working; dynamic arrays, LET/LAMBDA | `docs/function-parity.md`; `crates/functions/src/*.rs`, `crates/calc/src/eval.rs` | implemented (presence measured; depth estimated) |
| 5 | `.xls` (BIFF8) import: values, formulas, number formats, merges, sizes, names; no styles/charts/pictures; never written | `crates/xlsx/src/xls/`, `docs/file-format-parity.md`, `docs/cli.md` | partial (import only; no write) |
| 6 | `.xlsb` and `.ods`: values-only data import, cached formula results instead of formulas; no write | `crates/xlsx/src/xlsb.rs`, `crates/xlsx/src/ods.rs`, `docs/xlsb-import.md`, `docs/ods-import.md` | partial (values only) |
| 7 | Password-encrypted workbooks open (Agile/Standard AES); saving writes them without the password; RC4 refused | `crates/xlsx/src/crypto.rs`, `docs/file-format-parity.md`, `docs/control-protocol.md` | partial (read-only) |
| 8 | `.xlsm`/`.xltm` keep the VBA project byte-for-byte; macros never run | `crates/xlsx/src/tests/roundtrip.rs` (`vba_project_roundtrip`), `crates/engine/src/io.rs`, `docs/file-format-parity.md` | implemented (preservation; execution deliberately absent) |
| 9 | CSV/TSV read with encoding + delimiter detection; export writes displayed values, CRLF, caps at 512 MiB | `crates/xlsx/src/csv.rs`, `crates/engine/src/io.rs:234` `csv()`, `docs/file-format-parity.md` | implemented |
| 10 | PDF export via own PDF 1.7 writer; 14 standard fonts only — non-Latin text does not export | `crates/pdf/src/lib.rs`, `crates/engine/src/cmd/print.rs:22` `file.exportPdf`, `docs/file-format-parity.md` | partial (font/script limits) |
| 11 | Control channel: JSON-lines on 127.0.0.1, `engine.execute` for all commands, `ui.click/key/dialog/screenshot` for real input | `apps/gridcraft/src/control_server.rs:15`, `crates/ui-egui/src/control.rs`, `docs/control-protocol.md` | implemented |
| 12 | MCP server (stdio) with 21 tools incl. `execute_command`, ranges, charts, tables, sort/filter, screenshot; headless or bridged to a live window | `crates/mcp/src/tools.rs`, `docs/mcp.md` | implemented |
| 13 | Headless CLI: `info/convert/eval/cat/check/run/commands/functions/mcp/send` | `apps/gridcraft-cli/src/main.rs`, `apps/gridcraft-cli/src/check.rs`, `docs/cli.md` | implemented |
| 14 | `check` calc oracle: compares GridCraft's recalculation to Excel's cached values + XLSX round-trip categories, exit code 0/1/2, JSON schema `gridcraft-check/1` | `apps/gridcraft-cli/src/check.rs`, `docs/cli.md` | implemented |
| 15 | PivotTables with field list, grouping, show-values-as, calculated fields, PivotCharts, XLSX round trip | `crates/engine/src/cmd/pivot.rs`, `ROADMAP.md` progress log 2026-10-11 | partial (unverified in real Excel; no calculated items / GETPIVOTDATA) |
| 16 | Slicers can be inserted, toggled and cleared, but are dropped on XLSX save | `crates/engine/src/cmd/slicer.rs`; `crates/xlsx/src/passthrough.rs:135` (`slicer`/`slicercache` in `REWRITTEN`) | partial |
| 17 | 25 chart kinds modelled (`ChartKind`); sparklines; trendlines; chart sheets preserved on save but not editable | `crates/model/src/features.rs:370`; `crates/chart/src/render.rs`; `crates/xlsx/src/passthrough.rs` | partial (advanced kinds lose kind on round trip — `docs/gaps.md` §4) |
| 18 | ~100 MB XLSX files fail to open; recalculation single-threaded | `docs/gaps.md` §2 (#175) | not implemented (limitation) |
| 19 | XLSX save drops slicers, timelines, data model, table query tables, unmodelled `extLst`, chart details; Excel repair-prompt behaviour never verified | `docs/gaps.md` §1 & §3, `crates/xlsx/src/passthrough.rs` | partial / claimed-unverified |
| 20 | 11 UI languages selectable (`app.language.set`), coverage ~12% (ribbon/menus); formulas and number formats en-US only | `crates/ui-egui/src/i18n.rs:24`, `docs/localization-parity.md` | partial |
| 21 | Web (WASM) build exists (`apps/gridcraft-web`, trunk; `?sample=sales`); multi-window `view.newWindow`; samples `sales/budget/grades` | `apps/gridcraft-web/src/{main,web}.rs`, `apps/gridcraft-web/Trunk.toml`; `crates/engine/src/cmd/extra.rs:144`; `crates/engine/src/sample.rs` | implemented |
| 22 | Missing Excel commands (generated list): SmartArt, Screenshot, Maps, Timeline, WordArt, Signature Line, Object, Equation; From Web, Stocks, Geography, Relationships, Analyze Data; Smart Lookup, Translate, Show Changes | `docs/parity-checklist.md` | not implemented |
| 23 | Get & Transform ~10%: no Power Query editor, connections, refresh, data model | `docs/gaps.md` §12, `docs/file-format-parity.md` "Import sources" | not implemented / partial |

Notes for the orchestrator:
- Docs and code disagree slightly at this commit: `docs/gaps.md` §8 still lists `insert.slicer` as missing, but `crates/engine/src/cmd/slicer.rs` registers it (implemented in-session, dropped on save). Likewise `docs/roadmap.md`'s alpha-gate table calls slicers missing while the code has them. Trust `gridcraft-cli commands` output / code over prose docs where they conflict.
- `docs/file-format-parity.md` contains a stale duplicate CSV row ("we write raw values") contradicted by its own revision history and by `crates/engine/src/io.rs:244` (`display::value_text`) — export writes displayed values.
- Installed app on the authoring machine is 0.6.1 vs HEAD 0.7.0; numbers above are HEAD.
