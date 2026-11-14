# Evidence table — PhotoCraft SKILL.md

Repo: https://github.com/storytold/photocraft · HEAD inspected: `7250e6e29a9248ac17bc0cb20296e03e7cbed86a` (2026-10-14)
Installed app: `/Applications/PhotoCraft.app` 0.8.2 (`ai.storyteller.photocraft`).
Status: **implemented** = code path exists and is wired; **partial** = exists but visibly incomplete/one-way/feature-gated; **claimed** = stated in docs but not fully verified in code here.

| # | Capability claim | Evidence | Status |
|---|---|---|---|
| 1 | Native `.pcraft` = ZIP-STOR or directory bundle: `manifest.json` + blake3-addressed zstd tiles/blobs, versioned with migrations, incremental + atomic saves | `crates/format/src/lib.rs` (module docs), `crates/format/src/{manifest,migrate,store,atomic,autosave}.rs`; `docs/development.md` › Native format | implemented |
| 2 | PSD/PSB open + save (layers, masks, groups, text, smart objects, adjustments, effects) | `crates/io/src/lib.rs` `import_stages`/`export_stages`; `crates/io/src/psd_import.rs`, `psd_export.rs`; `crates/psd`; README "PSD without compromise" | implemented (fidelity gaps: `docs/gaps.md` G1) |
| 3 | Layered TIFF read + write (Photoshop layer data); flat TIFF otherwise | `crates/io/src/tiff_layers.rs` (`export_layered`, `would_write_layers`, read path in `flat.rs`/import) ; CLI `--tiff-layers` in `apps/photocraft-cli/src/lib.rs` | implemented |
| 4 | ORA read+write; PDN3 read-only; KRA read-only; Affinity read-only (exports refused with actionable errors) | `crates/io/src/lib.rs` `import_stages` + `export_stages` refusals; `crates/io/src/{ora,pdn,kra,affinity}.rs` | implemented (one-way where noted) |
| 5 | Flat codec capability matrix incl. 8/16/32f depths: PNG, JPEG, TIFF, WebP (lossless default/lossy opt), GIF, BMP, TGA, ICO, PNM, QOI, EXR, HDR, FITS, DPX r/w; PCX/XPM/DDS read-only; AVIF write-only (feature), HEIF read-only (feature) | `crates/codecs/src/format.rs` `caps()` + `ASYMMETRIC_EXCEPTIONS`; `crates/codecs/README.md` capability matrix | implemented (verify feature flags in your build) |
| 6 | Camera raw read: DNG, CR2, CR3(detected/unsupported), NEF, NRW, ARW, SRF, SR2, PEF, ORF, RW2, RAF | `crates/raw/src/lib.rs:142` `EXTENSIONS`; `docs/gaps.md` G14 (CR3 unsupported) | partial |
| 7 | Everything is a command: ~700 registered engine commands; UI/CLI/control/MCP all dispatch by id | `crates/engine/src/commands.rs`; `docs/architecture.md` "Current state"; `docs/control-protocol.md` | implemented |
| 8 | CLI `photocraft-cli`: `convert`, `info`, `run`, `batch`, `droplet`, `commands`, `mcp`, `serve`; strict flag parsing; exit 0/1/2 | `apps/photocraft-cli/src/lib.rs` `USAGE`, `SUBCOMMANDS`, `parse`, `run` | implemented |
| 9 | JSON control channel: authenticated loopback TCP, one JSON line per request; `engine.execute`, `ui.inspect/set/pointer/key/screenshot`, `app.open/save`, `jobs.*` | `apps/photocraft/src/control_server.rs`; `crates/ui-egui/src/control.rs`; `docs/control-protocol.md` | implemented |
| 10 | MCP server, headless + bridge to live app (`command_list/run/batch`, `doc_*`, `jobs_*`, bridge `ui_*`) | `docs/mcp.md`; `docs/development.md` › MCP; `crates/automation` | implemented |
| 11 | Actions record/replay; `.atn` import maps 112 Photoshop events; unmapped steps fail at playback by name; Batch + droplets via CLI | `crates/engine/src/actions_cmds.rs`, `atn_cmds.rs`; `apps/photocraft-cli/src/lib.rs` `load_actions_file`, `batch`, `droplet`; `docs/gaps.md` G11 | partial (unmapped `.atn` steps) |
| 12 | Scoped filesystem for automation: `app.open`/`app.save` under granted roots; path-based `file.*` and `prefs.set` file sections refused over control | `docs/control-protocol.md` §Engine commands; `crates/automation/src/workspace.rs` | implemented |
| 13 | Multi-document tabs; per-document views; Window menu lists open documents | `crates/ui-egui/src/state.rs:1177` (`views` index-aligned with session documents); `docs/control-protocol.md` (`window.document.<index>`) | implemented |
| 14 | Editing depth: RGB/Gray/CMYK/Lab @ 8/16/32; 16 adjustment layers; 10 layer effects; 27 blend modes + 6 Paint.NET; smart objects; artboards; channels/Quick Mask; history/snapshots | `README.md` ("Any colour, any depth", "Layers, done properly", "Edit without regret"); `crates/doc`, `crates/engine/src/{adjust_cmds,layer_cmds*,comps_cmds}.rs` | implemented |
| 15 | Colour management: ICC engine, Assign/Convert to Profile, soft proofing ⌘Y, Gamut Warning ⇧⌘Y | `crates/cms`; `crates/engine/src/color_cmds.rs:1184,1193`; `README.md` | implemented |
| 16 | Export As formats PNG/JPG/WebP/TIFF/TGA/ICO; Quick Export as PNG; Save for Web (Legacy) GIF/PNG-8 with palette edits | `crates/ui-egui/src/export_dialog.rs:16` (`FORMATS`); `crates/ui-egui/src/menus.rs:420`; `docs/control-protocol.md` | implemented |
| 17 | Web build (WebAssembly) of engine + UI via trunk; prefs in localStorage; no filesystem, no crash recovery on web | `apps/photocraft-web/index.html` (`data-trunk`, `wasm-release`, `heif`); `docs/development.md`; `README.md` Downloads › Web | implemented |
| 18 | Autosave + crash recovery on desktop (`Recovery` folder, per-launch entries, recovered doc adopts its entry) | `crates/format/src/autosave.rs`; `docs/development.md` › Native format; `docs/control-protocol.md` (prefs dir) | implemented |
| 19 | Wasm plug-in ABI v1 (`plugin.install/list/run/remove/reload`), no `.8BF`/CEP/UXP hosting | `docs/plugins.md`; `crates/engine/src/plugin_cmds.rs`; `docs/gaps.md` G16 | implemented (scope: own ABI only) |
| 20 | Photoshop menu wiring 631/631 items live — wiring only, not behaviour | `docs/parity-checklist.md` header (generated by `cargo xtask parity`) | implemented (wiring metric) |
| 21 | Alpha maturity: breadth ~76%, ready ~45%, 953 issues, 22/25 perf budgets missed; PSD acceptance by Photoshop not guaranteed | `ROADMAP.md`; `docs/gaps.md` G1/G2/G3 | assessment (docs) |
| 22 | README claim "keeps the render of 307 of the 309 psd-tools files" vs gaps.md floor 236/309 — metrics disagree | `README.md` line ~217 vs `docs/gaps.md` G1; `crates/io/tests/corpus.rs` | claimed (unverified which metric) |

Notable doc discrepancies found while grounding (kept in the SKILL as "claimed but unverified"):
- Toolbox count: `docs/gaps.md` (2026-10-13): only Art History Brush missing (67 of 68); `ROADMAP.md`: "12 missing" (stale).
- Command palette ⌘F: README says ⌘F; HEAD has `edit.search` and `filter.lastFilter` both defaulting to ⌘F (`crates/ui-egui/src/kys_import_tests.rs:157,220`).
- Menu count: 628/628 in older docs vs generated `docs/parity-checklist.md` 631/631 at HEAD.
- `README.md` says installers are code-signed; `docs/gaps.md` G17 lists Windows code signing as missing — unresolved.
