# Evidence table — effectcraft skill

Repo: `storytold/effectcraft` @ `549e9d825132986d6167c1432cd3328efcbb0278` (2026-10-14).
Tier key: **I** = implemented (code path wired to UI/CLI), **P** = partial/stub, **C** = claimed but unverified / docs-only, **N** = not implemented (documented gap).

| # | Capability claim | Evidence (repo-relative) | Tier |
|---|---|---|---|
| 1 | Clean-room, pure-Rust After Effects reimplementation; alpha, breadth ≈ 91% / ready ≈ 45% | `README.md` §What EffectCraft is, §Where it stands; `CLAUDE.md`; `ROADMAP.md` headline numbers | I (project fact) |
| 2 | All actions are engine commands reachable from menu, CLI, control channel and MCP | `CLAUDE.md` non-negotiables; `docs/agents.md` intro; `crates/engine` | I |
| 3 | Native project format `.ecproj`: versioned JSON, schema 2, repairs out-of-limit values on open | `crates/project/src/lib.rs:34` (`SCHEMA_VERSION`); `crates/engine/src/commands/file.rs:40-66` (`from_json_repaired`, newer-schema toast) | I |
| 4 | `.ecprojx` / `.xml` XML copies of the JSON project are read and written | `crates/engine/src/commands/file.rs:97-103`; `crates/engine/src/xml_project.rs` | I |
| 5 | 306 registered effects / 3,017 parameters; GPU for 280 of 306 | `docs/effects-parity.md:14`; registry `crates/effects/src/lib.rs:485`; `docs/hardware-parity.md:16` | I (count from repo measurement) |
| 6 | 38 blend modes | `crates/color/src/blend.rs:52` (`BlendMode::ALL: [BlendMode; 38]`) | I |
| 7 | Nine layer styles as property groups | `crates/project/src/styles.rs:4` | I |
| 8 | Layer kinds incl. model/primitive and Classic vs Advanced 3D renderer | `crates/project/src/lib.rs:335` (`Renderer::Classic3D/Advanced3D`), `:655` (`LayerSource`) | I |
| 9 | Keyframe interpolation: linear/Bezier/hold + auto/continuous Bezier, spatial tangents | `crates/keyframe/src/lib.rs:26,72,82` | I |
| 10 | Import extension sets (stills/video/audio/models/data) exactly as coded | `crates/media/src/lib.rs:62-80`; `crates/engine/src/commands/file.rs:562` (`DATA_EXTENSIONS`) | I |
| 11 | Lottie import/export incl. dotLottie, with warnings list | `crates/lottie/src/import.rs`, `export.rs`; `crates/engine/src/tests_lottie.rs:28-59`; `docs/agents.md` §CLI | I |
| 12 | Timeline interchange import/export (FCP7 XML/FCPXML/OTIO/EDL/AAF/OMF; not prproj) | `crates/interchange`; `crates/engine/src/commands/timeline.rs:25,133`; `docs/file-format-parity.md:90` | I |
| 13 | Render Queue: 13 output formats incl. H.264/HEVC/AV1/ProRes/WebM/seq/GIF/WAV/AIFF; field render + pulldown | `crates/project/src/render_queue.rs:531` (`OutputFormat::ALL`), `:99,139` (`FieldRender`, `Pulldown`) | I |
| 14 | Save Frame As Photoshop Layers (PSD) and ProEXR | `crates/engine/src/commands/frame_export.rs:1-7` | I |
| 15 | Essential Graphics `.ectemplate` + animation presets `.ecpreset` (own formats) | `crates/engine/src/commands/essential.rs:10,807`; `crates/engine/src/commands/animation.rs:16,478` | I |
| 16 | Headless CLI with documented subcommands/flags and exit codes 0/1/2 | `apps/effectcraft-cli/src/main.rs:92-124,285-297` | I |
| 17 | MCP server over stdio: headless, `--autosave`, `--bridge`, file confinement; shipped `.mcp.json` | `apps/effectcraft-cli/src/main.rs:604-627`; `crates/automation/src/server.rs`; `docs/mcp.md`; `.mcp.json` | I |
| 18 | Control channel `--control PORT`: localhost JSON-lines, engine.execute/ui.*/render.frame/screenshot | `docs/control-protocol.md`; `apps/effectcraft/src/main.rs:1-11,88-95`; `apps/effectcraft/src/control_server.rs` | I |
| 19 | JSX scripting with AE object model + ScriptUI; `#include`; no `.jsxbin` | `crates/script`; `docs/scripting-parity.md:21-27` | I / N for jsxbin |
| 20 | WASM browser build of the full app (single-threaded; workers for jobs) | `apps/effectcraft-web`; `docs/web.md:1-9,55,103`; `cargo xtask web|wasm` | I |
| 21 | Tracking suite: motion, mask/face tracking, Warp Stabilizer, 3D Camera Tracker, Roto Brush, Object Matte | `docs/agents.md` §Tracking suites; `crates/segment`; `crates/effects/src/object_matte.rs`, `camera_tracker.rs`, `face_track.rs`, `roto.rs`, `warp_stab.rs` | I |
| 22 | After Effects projects cannot be opened (`.aep`/`.aepx` no reader) | `docs/gaps.md` gap 1; no reader in `crates/`; `README.md` §Where it stands | N |
| 23 | After Effects plug-ins cannot run; only WASM effect plug-ins | `README.md`; `docs/gaps.md` gap 19; `crates/plugin` | N / I (own plugins) |
| 24 | `.mogrt`, `.ffx`, `.aet/.aetx`, `.ars/.aom`, `prproj`, `.jsxbin` unsupported | `docs/file-format-parity.md:25-34,90`; `docs/scripting-parity.md:28` | N |
| 25 | Missing media formats: AVI, camera raw, HEIF/AVIF, USD/USDZ, `.sbsar`, SGI/PICT etc.; Media Browser lists AVI (import refuses) | `docs/file-format-parity.md:54-84`; `docs/gaps.md` gap 17; `crates/media/src/lib.rs:62-80` | N / P |
| 26 | No hardware video decode/encode; HEVC/AV1 no B-frames; ProRes 4444 colour tag bug #340 | `docs/gaps.md` gaps 10,15,22; `docs/hardware-parity.md` | N / P |
| 27 | Fidelity vs After Effects largely unmeasured (one scalar-ease case, 168 samples) | `docs/gaps.md` gap 2; `docs/fidelity/README.md` | P |
| 28 | Open crash reports; no PR CI gate | `docs/gaps.md` gaps 3,4 | N |
| 29 | Missing-footage relinking implemented at HEAD (`file.relinkFootage`, plus rename-rescan) | `crates/engine/src/commands/relink.rs:12`; `crates/engine/src/commands/relink_moved.rs:196` | I (gaps.md gap 18 partly stale) |
| 30 | Web build URL flags (`?demo`, `?empty`, `?storage=…`) and no system fonts | `docs/web.md:44-49,68` | I |

Notes for the orchestrator:
- Claims 5, 8 and 27 rest on the repo's own measured docs (`docs/effects-parity.md`,
  `docs/gaps.md`), which are dated 2026-10-12 and re-audited against `upstream/main` 470ea7a3; the
  HEAD I inspected (549e9d8) is newer, and code spot-checks agreed (registry location, blend modes,
  schema version, render formats, CLI flags).
- "306 effects" was verified by locating the registry and the parity doc's counted figure; the count
  itself was not re-enumerated line-by-line from `registry()`.
- Installed app (Info.plist) is v0.9.2, same as workspace `Cargo.toml` version; no release/HEAD
  version skew observed at inspection time.
