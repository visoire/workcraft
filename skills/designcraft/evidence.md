# Evidence table — DesignCraft skill

Repo: `storytold/designcraft` · HEAD inspected: `11a51d5b665aec8d6e675bd107a8a01514f10d00` (“Release 0.8.0”, 2026-10-14)
Installed app at `/Applications/DesignCraft.app`: **0.7.1** (build commit `3624f488…`) — HEAD features may not exist in the install.
Tiers: **implemented** = code path exists and is wired into UI/CLI · **partial** = works with stated gaps · **claimed** = documented but not confirmed in this review.

| # | Capability claim (as in SKILL.md) | Evidence (repo-relative) | Tier |
|---|---|---|---|
| 1 | Native `.designcraft` = zip (`mimetype` `application/vnd.designcraft+zip`, `document.json`, `assets/`, `meta.json`), format version 2, upgrades old files, refuses newer | `crates/format/src/lib.rs:1-144` (`MIME`, `VERSION`, `save`, `load`, `upgrade`) | implemented |
| 2 | Open native `.designcraft` and `.idml`; IDML packages via `file.openIdml`/`file.openBytes`; fonts from a `Document Fonts` folder load per document | `crates/engine/src/cmd/file.rs:160-234`; `crates/engine/src/cmd/interchange.rs:10-18` | implemented |
| 3 | **`.indd` cannot be opened** (also `.indt/.indb/.indl/.idms/.icml`, QuarkXPress, PageMaker) | `docs/file-format-parity.md` table; `docs/gaps.md` #2; grep finds no `.indd` reader (only IDML export writes `{title}.indd` as a name: `crates/idml/src/export.rs:259`) | implemented absence (verified) |
| 4 | IDML import **and** export both ways | `crates/engine/src/cmd/interchange.rs`; `crates/idml/src/{import,export}.rs` | implemented; fidelity **partial** (no real-file corpus — `docs/file-format-parity.md`, `docs/gaps.md` #3) |
| 5 | PDF export: real text/subset fonts, CMYK/spot, bleed/marks, spreads, tagged PDF, PDF/X-4 (+checks), PDF/A-2b, interactive extras | `crates/pdf/src/{export,marks,pdfx,forms,links,transitions,text}.rs`; `crates/engine/src/cmd/export.rs:11-13` | implemented |
| 6 | No PDF/X-1a, X-3, `.joboptions`/PDF presets, PDF/UA, PostScript | `docs/file-format-parity.md` “Output”; `docs/gaps.md` #9 | implemented absence |
| 7 | EPUB 3 reflowable + fixed-layout export; HTML one self-contained page | `crates/epub/src/lib.rs` (`export_epub:684`, `export_fixed_epub:38`, `export_html:659`); `crates/engine/src/cmd/export.rs:25-27` | reflowable implemented; fixed-layout/HTML **partial** (page images / single page — `docs/gaps.md` #17) |
| 8 | Raster export: PNG from UI, JPEG CLI-only; `--all-pages DIR` writes `page-NNN.png` | `apps/designcraft-cli/src/main.rs:283-318`; `crates/ui-egui/src/menus.rs:19` (`app.exportPng`, ⌘E) | implemented |
| 9 | Place graphics: PNG/JPEG/GIF/WebP/TIFF/BMP/PSD composite/SVG/PDF page/AI; EPS preview only; media as media frames | place filters `apps/designcraft/src/main.rs:143-199`; `crates/images`; `crates/engine/src/cmd/file.rs:266-330` | implemented; EPS/PSD depth **partial** (`docs/gaps.md` #19) |
| 10 | Place text: DOCX/RTF/TXT/MD/XLSX/tagged; data merge CSV/TSV/XLSX | `crates/textimport/src/lib.rs:93-117`; `crates/engine/src/cmd/place_text.rs`, `datamerge/`; `docs/agents.md#data-merge` | implemented |
| 11 | 446 engine commands (188 in menus) + 99 UI commands; command registry; every action is a command | `crates/engine/src/cmd/mod.rs:150-211`; `crates/ui-egui/src/menus.rs` (`UI_COMMANDS`, `MENUS`); measured in `docs/target-app-parity.md` | implemented (counts measured by project docs; registry code verified) |
| 12 | CLI: `run`, `commands`, `describe`, `script`, `app`, `mcp`, `perf`, `bench`, `validate-pdf`, `links` | `apps/designcraft-cli/src/main.rs:38-39,92-138` | implemented |
| 13 | Scripts with `$N.path`/`$last` result references, `\n` paragraphs, `--keep-going`, partial-failure report | `apps/designcraft-cli/src/main.rs:42-70,346-436`; `crates/engine/src/script.rs` | implemented |
| 14 | MCP server (stdio JSON-RPC), headless or `--connect PORT`; listed tools incl. `batch`, `render_page`, `pointer` | `crates/mcp/src/{server,tools,headless,backend}.rs`; `docs/mcp.md` | implemented |
| 15 | Control channel `--control PORT`: `engine.execute`, `ui.pointer/key/text/click/drag`, `ui.screenshot/render`, dialogs, `app.*`; loopback, unauth., malformed line closes connection | `apps/designcraft/src/control_server.rs`; `crates/ui-egui/src/control.rs`; `docs/control-protocol.md` | implemented |
| 16 | Text engine: Knuth–Plass + single-line composer, hyphenation EN/ES, keeps, grids, columns, footnote/endnote, tables, xref, index, TOC; optical kerning falls back to metrics; overset rule differs | `crates/compose`; `docs/typography-parity.md`; `docs/gaps.md` #4 | implemented; fidelity **partial/unmeasured** |
| 17 | Threading by hand + `text.thread`/`unthread`/`removeFromThread`; Primary Text Frame autoflow still adds undeletable pages (#165) | `crates/engine/src/cmd/thread.rs:14-43`; `docs/gaps.md` #0; `ROADMAP.md` | implemented; alpha blocker **partial** (autoflow) |
| 18 | Copy/paste and context menus fail for some Windows/Linux users; Paste in Place wrong page; caret formatting discarded | `docs/gaps.md` #1; `docs/ui-parity.md`; `docs/roadmap.md` alpha-gate table | **partial** (user-reported; not reproduced in this review) |
| 19 | No canvas IME (#322); no ExtendScript/UXP; no plug-in model | `docs/gaps.md` #8, #22, #23 | implemented absence (documented) |
| 20 | Crash recovery: unsaved docs written every 30 s into a per-run locked dir; escaped panics become errors | `crates/ui-egui/src/lib.rs:909-916`; `crates/engine/src/lib.rs:203,251` (`recovery_minutes: 0.5`); `crates/engine/src/guard.rs`; `apps/designcraft/src/main.rs:77-92` | implemented |
| 21 | macOS bundle declares document extension **`pcraft`** (not `.designcraft`) and has no `CFBundleDocumentTypes`; installed 0.7.1 identical | `packaging/macos/Info.plist.in:48-71`; verified with `PlistBuddy` on the installed app | implemented quirk/bug |
| 22 | Web (WASM) build: same UI, WebGPU/WebGL2, file picker + drag-drop, save/export as downloads, **no control channel** | `apps/designcraft-web/` (`Trunk.toml`); `README.md` “Web”; `docs/hardware-parity.md` | implemented |
| 23 | Localization partial (JP 95%, most 83–85%, some 0%); Windows/Linux thinly tested; startup crashes on some GPUs with backend fallback | `ROADMAP.md` sections; `docs/localization-parity.md`; `docs/hardware-parity.md`; `docs/gaps.md` #5, #14 | **partial** (documented by project) |
| 24 | Printing: `file.print`/`file.printers` via shared `craft-print` (CUPS/Windows spooler), dry-run for agents; no PostScript/presets | `crates/engine/src/cmd/print.rs`; `Cargo.toml` (`craft-print` dep); `docs/gaps.md` #10 | implemented; print fidelity **unverified** |

Verification notes:
- Code paths were opened directly; project docs (`ROADMAP.md`, `docs/target-app-parity.md`, etc.)
  were used for measured counts and for user-reported issues, never as the sole basis for a code claim.
- "implemented absence" rows were checked by searching the crates for readers/parse code, not only the docs.
- The installed 0.7.1 bundle was inspected read-only (`Info.plist`); the GUI was not launched.
