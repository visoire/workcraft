# CADCraft SKILL.md — evidence table

Repo: https://github.com/storytold/cadcraft @ `fc4e98315a8d771b5ab832f0ade0b5e7b106df7f` ("Release 0.7.0", 2026-10-14).
Inspected 2026-10-14. Installed app `/Applications/CADCraft.app` = 0.6.2, bundle id `ai.storyteller.cadcraft`.
Tiers: **implemented** (code path wired into engine/CLI/UI), **partial/stub** (works with listed gaps), **not implemented/roadmap** (absent from code; claimed only in docs), **claimed but unverified** (docs only).

| # | Capability claim in SKILL.md | Evidence (repo-relative) | Tier |
|---|---|---|---|
| 1 | Command-line drafting: `x,y`, `@dx,dy`, `@dist<angle`, `#x,y`, direct distance, keywords, Enter/space repeat, aliases | `crates/engine/src/prompt.rs:62-64,246-254`; `crates/engine/src/cmd/mod.rs:167`; README "What works today" | implemented |
| 2 | ≈400 engine command ids, everything-is-a-command, one registry for GUI/CLI/control/MCP | `crates/engine/src/cmd/mod.rs` (`command_specs`, `CommandSpec`); 401 unique `CommandSpec::new("…")` ids grepped at HEAD; 56 UI-only ids in `crates/ui-egui/src/menus.rs:17` (`docs/architecture.md` counted 295 on 2026-10-10) | implemented |
| 3 | Draw set (LINE…MTEXT) and modify set (MOVE…OVERKILL, ARRAY, TRIM/EXTEND) | `crates/engine/src/cmd/draw.rs:14-84`, `draw2.rs`; `modify.rs`, `modify2.rs`, `trimextend.rs`, `array.rs`, `overkill.rs` | implemented (some prompt options still "not available yet" — `docs/gaps.md` F1) |
| 4 | Dimensions (DIM* + DIMSTYLE + associative), MLEADER/LEADER, TOLERANCE, TABLE, TrueType + stroke font | `crates/engine/src/cmd/annotate.rs`, `annotate_dimedit.rs`, `tolerance.rs`, `table/`, `mleader_edit.rs`; `crates/fonts/src/stroke.rs` | implemented (no FIELD/spell check, no DIMSTYLE dialog — `docs/gaps.md` F7-F10) |
| 5 | Hatch with islands/patterns/gradients from CADCraft's own 23-pattern library; blocks/attributes/BEDIT/xrefs/groups | `crates/engine/src/cmd/hatch.rs`, `blocks.rs`, `blocks/`, `groups.rs`; `crates/doc/src/library.rs` | implemented (no XCLIP, no dynamic-block authoring — `docs/gaps.md` F2, F3) |
| 6 | Parametric constraints (geometric + dimensional, AUTOCONSTRAIN, PARAMETERS, re-solve) | `crates/constraints/`; `crates/engine/src/cmd/constraints.rs` | implemented |
| 7 | Layers/properties palettes, linetypes, lineweights, colour index/true colour | `crates/engine/src/cmd/layer.rs`, `props.rs`; `crates/doc/src/tables.rs` | implemented |
| 8 | Layouts, viewports (incl. polygonal/clipped), PLOT/EXPORTPDF/PUBLISH (multi-sheet PDF, OCG layers) | `crates/engine/src/cmd/layout.rs:74-85`, `plotters.rs`, `exchange.rs`; `crates/io/src/pdf.rs`, `plotter.rs` | implemented |
| 9 | Read DXF: one reader, ASCII R12–2018, binary R13+ (binary R12 not read) | `crates/io/src/lib.rs:62-75`; `crates/io/src/dxf_read.rs`; `crates/dxf/src/lib.rs`; `docs/file-format-parity.md` | implemented |
| 10 | Write DXF 2000–2018 ASCII/binary; unknown entities kept raw; DWT templates | `crates/io/src/lib.rs:86-130`; `crates/io/src/dxf_raw.rs`; `crates/engine/src/cmd/file/template.rs` | implemented (36 header variables vs AutoCAD ≈280) |
| 11 | Read/write DWG R13–2018 via acadrust bridge, native only | `crates/dwg/src/lib.rs`; `crates/io/src/lib.rs:63-67,100-103`; `docs/file-format-parity.md` DWG table | partial (R13 untested; through DWG, custom classes/xdata/colour books/reactors are dropped — `docs/gaps.md` FF1; web: unavailable) |
| 12 | SVG/SVGZ import (shapes, paths, groups, Inkscape layers) | `crates/io/src/svg_read.rs`; `crates/io/src/lib.rs:69-70`; `docs/gaps.md` FF14 | partial (no CSS, `use`, fills, text, images) |
| 13 | Export PNG 2400×1600, SVG, vector PDF (embedded TrueType subsets); `--window`/`--view` framing | `crates/io/src/lib.rs:113-181`; `crates/io/src/svg.rs`, `pdf.rs`; `apps/cadcraft-cli/src/main.rs:58-76` | implemented |
| 14 | CLI: info, convert, run (--script/--cmd/--save/--export), commands, perf, sample, mcp | `apps/cadcraft-cli/src/main.rs:58-76,293-352,644-669` | implemented |
| 15 | MCP server (stdio) with command_line/execute/inspect/query/render/find_text/open/save + screenshot/ui_click when bridged | `crates/mcp/src/tools.rs`; `docs/mcp.md`; end-to-end test `crates/mcp/src/tests.rs` | implemented |
| 16 | JSON control channel `--control PORT`: cmdline.*, engine.execute/commands, drawing.inspect, ui.*, app.* | `docs/control-protocol.md`; `crates/ui-egui/src/control.rs`; `apps/cadcraft/src/control_server.rs`, `apps/cadcraft/src/main.rs:232-247` | implemented |
| 17 | AutoLISP subset (.lsp, defun c:, APPLOAD, lisp command, acad.lsp/acaddoc.lsp support folder) | `crates/engine/src/cmd/lisp.rs`; `docs/autolisp.md`; `apps/cadcraft/src/main.rs:334-340` | partial (no Visual LISP/vlax, DCL, reactors, .fas/.vlx — `docs/gaps.md` E1) |
| 18 | Scripts (.scr) via SCRIPT/`scr`; desktop autosave, Drawing Recovery, AUDIT, RECOVER | `crates/engine/src/cmd/file.rs:176-178`; `crates/engine/src/autosave.rs`, `audit.rs`, `cmd/audit.rs:13-23`; `crates/ui-egui/src/autosave.rs` | implemented (autosave desktop only; none on web — `docs/gaps.md` F4) |
| 19 | Multi-document file tabs + model/paper space; shortcuts (Cmd+S/W/P/Z…, F3-F12 drafting toggles); WebAssembly build; 13 UI languages | `crates/ui-egui/src/lib.rs:76,162,628`; `.key(…)` in `crates/engine/src/cmd/{file,edit,layout,settings}.rs`; `crates/ui-egui/src/menus.rs:17-74`; `apps/cadcraft-web/Cargo.toml`; `crates/ui-egui/src/i18n/*.tsv` | implemented (web: no DWG/autosave; engine + CLI replies untranslated — `docs/gaps.md` L1) |
| 20 | Status: pre-alpha, ≈38% ready, 50% menu breadth; no real-file corpus / no AutoCAD verification; no 3D; no PDF import, raster attach, DWF/DGN/STL/ACIS, SHX, binary .ctb/.stb/.pc3; no dynamic-block authoring/XCLIP; `.dxf` from Finder fails (#158) | `ROADMAP.md`; `docs/gaps.md` (FF5, FF6, F24, FF8-FF11, F2, F3, F14, U13); `docs/file-format-parity.md` §Tests | claimed (repo's own measurement) / not implemented (absent features) |

## Contradictions / uncertainties found while writing the skill

- README's "What works today" table is more optimistic than `ROADMAP.md`'s gate assessment (e.g. README lists full DIM* and modify sets; ROADMAP says 4/5 core workflows fail alpha and TRIM/EXTEND/OFFSET options were stubbed as of 2026-10-10, later narrowed by `docs/gaps.md` on 2026-10-13). The skill defers to `docs/gaps.md` (most recently updated) and labels this.
- `docs/gaps.md` F9 says existing MTEXT cannot be edited in the rich editor ("no DDEDIT/MTEDIT"), yet `TEXTEDIT` exists with aliases `ed`/`ddedit` and a params doc covering "text, mtext, attribute definitions, dimension text override" (`crates/engine/src/cmd/modify2.rs:76-80,2187-2195`). Interpreted as: content editing exists; the in-canvas rich editor is new-text-only. Uncertain — verify on the installed version.
- `docs/architecture.md` counted 295 commands on 2026-10-10; HEAD has grown (401 unique static ids via grep) — counts are point-in-time source greps, not runtime (`cadcraft-cli commands` gives the exact runtime catalog).
- ROADMAP's language table says English + partial Ukrainian/German, but `crates/ui-egui/src/i18n/` ships 13 `.tsv` catalogs — ROADMAP is stale there; control-protocol's language list matches the code.

## Method

No builds or runtime executions were performed (read-only brief). All code references were read at HEAD
`fc4e983`; docs cited were read in full where listed in SKILL.md "Sources & evidence". Installed bundle was
inspected via `Info.plist` and directory listing only; the GUI was never launched. File-extension inventory
came from `crates/io/src/lib.rs` (`read`, `write_with`, `write_framed`) and `crates/engine/src/cmd/exchange.rs`
(`EXPORT_FORMATS`), not from README alone.
