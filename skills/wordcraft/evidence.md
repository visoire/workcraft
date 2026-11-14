# Evidence index — wordcraft SKILL.md

Repo: https://github.com/storytold/wordcraft · HEAD `fc41918814f62645b6746ed68e71e8c2c2e85d6f`
("Release 0.7.0", 2026-10-14) · read 2026-10-14. Installed app: `/Applications/WordCraft.app`
0.6.1 (`Contents/Info.plist CFBundleShortVersionString`) — older than HEAD.

| # | Claim in SKILL.md | Evidence | Tier |
|---|---|---|---|
| 1 | Clean-room Rust reimplementation of Microsoft Word; alpha | `README.md:13-21,202`; `ROADMAP.md:3,46-52` | claimed (project docs) |
| 2 | Every action is a command; registry built from one module per area | `crates/engine/src/cmd/mod.rs:58-103` (`registry()`); `crates/engine/src/lib.rs:103-135` (`Registry`) | implemented |
| 3 | 617 command ids at HEAD (README says 422 — older measure) | grep `CommandSpec::new("[^"]*"` in `crates/engine/src/cmd/*.rs` = 617 unique; `README.md:98` says 422 | implemented (count from source) |
| 4 | `wordcraft-cli commands` lists id/label/shortcut/location; `--json` dumps params docs | `apps/wordcraft-cli/src/main.rs:292-306` | implemented |
| 5 | `.docx`/`.docm`/`.dotx`/`.dotm` read + write | `crates/engine/src/io_ext.rs:8,25`; `crates/docx/src/lib.rs:29-32` (`read`, `write_as`); `docs/file-format-parity.md` (~65% fidelity, corpus untested) | implemented / untested on real-world corpus (`gaps.md` #1) |
| 6 | `.doc`/`.dot` read-only; Word 6/95 & RC4/XOR refused | `crates/docbin/src/lib.rs:73` (only `read`); `docs/file-format-parity.md` `.doc` row; `docs/gaps.md` #14 | partial (read only) |
| 7 | PDF export with selectable text, links, bookmarks, Print Markup; no PDF/A | `crates/pdf/src/lib.rs:97` (`export`); `crates/engine/src/io_ext.rs:32-35`; `docs/file-format-parity.md` PDF row | implemented |
| 8 | PNG page render/export (`page`, `scale`) | `crates/engine/src/io_ext.rs:42` (`render_png`); `crates/engine/src/cmd/file.rs:60` (`file.exportPng`) | implemented |
| 9 | ODT/RTF/HTML/Markdown/LaTeX/TXT read+write via one crate | `crates/formats/src/lib.rs:26,29-58`; extension list `io.rs:9-31` | implemented (ODT/RTF ~50%, no notes/comments/revisions — file-format-parity) |
| 10 | `.xml`: Flat OPC read/write; Word 2003 XML read + write (write drops shapes, charts, ink, equations, OLE) | `crates/docx/src/lib.rs:28-31` (`write_flat`, `write_wordml2003`, `read_xml`); `crates/docx/src/flat.rs`, `wordml2003_write.rs`; `docs/file-format-parity.md` `.xml` rows; `ROADMAP.md:142` | implemented / partial (2003 write) |
| 11 | `.json` document model for agents | `crates/engine/src/io.rs:122,234` (serde `Document`); `docs/file-format-parity.md` `.json` row | implemented |
| 12 | Password-protected `.docx` (ECMA-376 agile) open/save; `file.encrypt`; only Word packages | `crates/docx/src/crypt.rs:58` (`is_encrypted`), tests at `crypt.rs:876`; `io.rs:96` (`can_encrypt`), `io.rs:109-115,244-250`; `cmd/file.rs:48` (`file.encrypt`) — note `docs/gaps.md` #9 is stale | implemented (code ahead of docs; verify installed 0.6.1) |
| 13 | CLI surface: convert/info/text/inspect/render/run/commands/parity/mcp/zotero + all flags | `apps/wordcraft-cli/src/main.rs:13-46` (USAGE), handlers `:184-403` | implemented |
| 14 | MCP tools (headless + app-only) | `crates/mcp/src/tools.rs:171-270`; `docs/mcp.md:83-97` | implemented |
| 15 | Control channel JSON-lines with key file, 1 MiB/line, 30 s auth | `apps/wordcraft/src/control_server.rs`; `docs/control-protocol.md:3-47`; key path `crates/control-key/src/lib.rs:11,42-43` | implemented |
| 16 | Macros record/replay command sequences (not VBA) | `crates/engine/src/cmd/tools.rs:349-363` (`tools.recordMacro`, `tools.macros`); `:724-750`; `docs/gaps.md` #22 (no VBA) | implemented / no VBA |
| 17 | Zotero integration via running Zotero desktop; CLI subcommand | `crates/zotero`; `docs/zotero.md`; `apps/wordcraft-cli/src/main.rs:360-398` | implemented (requires Zotero running) |
| 18 | Mail merge recipients: CSV/TSV, typed lists, `.xlsx`/`.xlsm`/`.ods`; no xls/Access/Outlook | `crates/engine/src/cmd/mailings.rs:39-137`; `crates/formats/src/sheet.rs:92`; `docs/gaps.md` #21 | implemented / partial (sources) |
| 19 | Templates: blank/sample/letter/resume/report | `crates/engine/src/cmd/file.rs:149-153`; `crates/mcp/src/tools.rs:211` | implemented |
| 20 | Web/WASM build; no TCP control channel, browser file picker, downloads | `apps/wordcraft-web/src/main.rs:5-10`; `Trunk.toml:10` (port 8771); `README.md:146` | implemented (with browser limits) |
| 21 | Native printing through craft-print + `file.printPdf`; dialog depth missing | `apps/wordcraft/src/print.rs`; `apps/wordcraft/Cargo.toml:70`; `docs/control-protocol.md:77-99`; `docs/gaps.md` #6 | implemented / partial (depth) |
| 22 | One document per window; `file.open` replaces current document | `crates/engine/src/cmd/file.rs` `open()` → `s.set_document(doc)`; single `Session` per `WordApp` (`crates/ui-egui/src/lib.rs`) | implemented |
| 23 | AutoSave limited to docx family/odt/rtf/json/xml + saved path | `crates/ui-egui/src/lib.rs:1792-1798` (`keeps_everything`); `crates/ui-egui/src/chrome.rs:225-250` | implemented |
| 24 | Beta-blocking gaps: DOCX corpus untested, ink/OLE/charts, crashes/hangs field reports, pagination ≠ Word, dialog depth, printing depth, proofing languages | `docs/gaps.md` ranked table #1-#8 (dated 2026-10-10, updated 2026-10-13) | claimed/partial (tracked gap list) |
| 25 | Typing parity pinned by tests; `=rand()`/`=lorem()` | `docs/typing-parity.md:13-23`; `crates/engine/src/tests_typing.rs` | implemented |
| 26 | Proofing: English, Polish, Portuguese (pt-BR), Italian only | `crates/proof`; `docs/gaps.md` #8; revision history 2026-10-12 | partial |
| 27 | Chart/SmartArt/OLE: Word-made charts read-only, unsupported types placeholder, OLE picture-only, 3D dropped | `docs/gaps.md` #2,#13; `docs/file-format-parity.md` charts/OLE/3D rows; `crates/engine/src/cmd/chart.rs` | partial |
| 28 | Never-crash policy: no panics in non-test code, `Result` errors, hostile-params test | `AGENTS.md` (Never crash); `crates/engine/src/tests.rs::hostile_params_never_panic`; crate-root `#![deny(clippy::unwrap_used, …)]` | implemented (policy) |
| 29 | Logs at `~/Library/Application Support/WordCraft/logs/wordcraft.log`, rotating, 16 MiB cap | `README.md:165-176`; `apps/wordcraft/src/logging.rs`; `apps/wordcraft/src/main.rs:124-131` | implemented |
| 30 | Parity: 487/502 catalog features live (97%) | `docs/parity-checklist.md:5`; enforced floor `crates/engine/src/catalog.rs:572-578` (≥90.4%) | implemented (measured) |
