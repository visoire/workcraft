# DeckCraft evidence table

Repo: https://github.com/storytold/deckcraft — HEAD `d78e657e4cb1e490ceb5445785c052d9cf5ad963` (0.7.0), inspected 2026-10-14.
Installed app inspected: `/Applications/DeckCraft.app` version **0.6.1** (`Contents/Info.plist`, `DeckCraftBuildCommit` 688c7ef) — one release behind the HEAD read here.
Tier: implemented = code path exists and is wired into UI/CLI; partial = visibly incomplete; claimed = asserted in docs but not (fully) verifiable in code.

| # | Capability claim | Evidence (repo-relative) | Tier |
|---|---|---|---|
| 1 | Clean-room, pure-Rust PowerPoint reimplementation, alpha stage, version 0.7.0 | README.md:13; Cargo.toml:7; ROADMAP.md:3 | claimed (docs) |
| 2 | ~230 programmatic commands; every action is a `CommandSpec` with id/label/menu/shortcut/params (`command_specs()`, 233 `cmd!` registrations at HEAD) | crates/engine/src/cmd/mod.rs:111-147 | implemented |
| 3 | 36 UI-only commands (`view.*`, `app.*`, `show.start` F5) dispatched through the same `app.run` path | crates/ui-egui/src/lib.rs:136-179 | implemented |
| 4 | CLI subcommands/flags: `info`, `render`, `render-transition`, `convert`, `run`, `commands`, `describe`, `app`, `mcp`, `links`, `--version` | apps/deckcraft-cli/src/main.rs:36-45,50-85 | implemented |
| 5 | Desktop flags `--control <port>`, `--sample`, `--show`, positional files; `DECKCRAFT_CONTROL_PORT`, `DECKCRAFT_NO_PREFS/RECOVERY/AUDIO` | apps/deckcraft/src/main.rs:3-4,141-157,60-127 | implemented |
| 6 | JSON-lines control channel bound to 127.0.0.1; method list (engine.*, ui.*, document.inspect, show.*, app.*) | apps/deckcraft/src/control_server.rs:14-21; docs/control-protocol.md:13-31; crates/ui-egui/src/control.rs:109-320 | implemented |
| 7 | MCP server over stdio (JSON-RPC 2.0), headless or `--connect PORT`; 25 tools | crates/mcp/src/lib.rs:3-14; crates/mcp/src/tools.rs:65-279 | implemented |
| 8 | Native `.deckcraft` = zip(`mimetype`, `presentation.json`, `media/<id>`); legacy `.slidecraft` accepted; `repair()` on load | crates/format/src/lib.rs:1-20,85-87,117-148 | implemented |
| 9 | PPTX import/export from ECMA-376; lenient reader; OOXML sniff via `[Content_Types].xml` anywhere in the zip | crates/pptx/src/lib.rs:1-9,40-55 | implemented |
| 10 | Opens `.txt`/`.md` outlines (tab = body level); exports outline back | crates/engine/src/cmd/file.rs:67-87; crates/format/src/lib.rs:150-215 | implemented |
| 11 | Export PNG/JPEG (scale, quality 92), PPTX, DeckCraft, outline, PDF; saves are temp-file + rename | crates/engine/src/cmd/file.rs:18,185-200,216-226,272-319 | implemented |
| 12 | PDF export: layouts slides/notes/handouts 1-9, dpi, hidden slides, real text layer, links, bookmarks — artwork rasterized | crates/pdf/src/lib.rs:1-6,42-65; crates/engine/src/cmd/file.rs:130-178 | implemented (artwork raster = partial fidelity) |
| 13 | 48/48 transitions incl. Morph Words-and-Characters, measured against PowerPoint frame by frame | docs/animation-parity.md:9-48; crates/model/src/anim.rs; crates/anim/src/transition_fx.rs:16-55 | implemented |
| 14 | 64 of ~190 animation effects; Animation Pane without editable timeline | docs/animation-parity.md:50-78 | partial |
| 15 | 183-entry preset-shape catalog, gallery via `shape.presets`, adjust handles, connectors glue, freeform, 5 merge ops | crates/geom/src/preset.rs:147+; crates/engine/src/cmd/insert.rs:183-187; crates/engine/src/cmd/merge.rs:147 | implemented |
| 16 | 8 themes, 11 layouts, sections, notes, headers/footers, slide masters/layout editing | crates/model/src/theme.rs:153-225; crates/model/src/defaults.rs:299-461; crates/engine/src/cmd/slide.rs:37-50 | implemented |
| 17 | Crash guard restores the document on any command panic; AutoRecover dir `~/Library/Application Support/DeckCraft/Recovery` | crates/engine/src/guard.rs:1-60; crates/engine/src/recovery.rs:1-30 | implemented |
| 18 | Pictures PNG/JPEG/GIF/WebP/BMP/TIFF; audio MP3/AAC/ALAC/WAV/AIFF/CAF/FLAC/Ogg/Opus; video H.264/HEVC/VP9/AV1 (software) | crates/engine/src/cmd/insert.rs:237-250; docs/file-format-parity.md:39-47 | implemented |
| 19 | SVG pictures don't render (PNG fallback only); EMF/WMF partial (no clip regions/EMF+) | docs/gaps.md:78-85 | partial / not implemented |
| 20 | PPTX never tested against a real-deck corpus; round trip loses comment threads, media options, animation rewind | docs/gaps.md:61-76; docs/file-format-parity.md:79-84 | partial (issues #70/#74/#77) |
| 21 | No printing (print goes through PDF), no video/GIF export, no embedded fonts, no `.ppt`/`.odp`/macro formats, English only, font faces only Regular/Bold/Italic, presenter view not auto-placed | docs/gaps.md:95-134,113-116,214-216; ROADMAP.md:85-106 | not implemented |
| 22 | Web (WASM) build shares the engine but has no TCP control channel, no persisted prefs; Save/Export are downloads | apps/deckcraft-web/src/main.rs:1-16 | implemented with limits |

## Spot-check hints for the orchestrator

- Fastest end-to-end check: `cargo run --release -p deckcraft-cli -- render --sample --all --scale 1 out/` then open a PNG (README.md:100-104).
- Live command list: `cargo run --release -p deckcraft-cli -- commands` (200+ JSON entries with menu, shortcut, params).
- The one contradiction to know about: `file.close` executed directly does not prompt on a dirty document (crates/engine/src/cmd/file.rs:342-347; docs/gaps.md:38-41) while the UI wraps it in a save prompt (crates/ui-egui/src/lib.rs:341). Docs also differ on the command count (226 vs 233 registrations at HEAD).
