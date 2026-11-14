# FilmCraft — evidence table

Repo: `storytold/filmcraft` · HEAD `cee1feb185e675a108f78067f71ad86a640ace3d` (shallow clone) ·
inspected 2026-10-14 · workspace version 0.7.2 (Cargo.toml:7) · installed app 0.7.2,
build commit `71438c6` (not in this shallow clone) — HEAD may be ahead of the installed release.

| # | Capability claim | Evidence (repo-relative) | Tier | Notes |
|---|---|---|---|---|
| 1 | Native project format `.fcproj`: UTF-8 JSON, `"format":"filmcraft.project"`, `schema_version` **15** at HEAD, migration chain v1→v15 | `crates/format/src/lib.rs:54-66` (`MIGRATIONS`, `SCHEMA_VERSION`); docs/project-files.md:8-15 (docs list 13 — code is newer) | implemented | Newer-than-build files refused (lib.rs:205); atomic writes `crates/format/src/atomic.rs` |
| 2 | Atomic saves, auto-save ring, crash-recovery journal with lock files | `crates/format/src/atomic.rs`; `crates/engine/src/autosave.rs`; docs/project-files.md:88-166 | implemented | Data dir `~/Library/Application Support/FilmCraft` (`autosave.rs:494-508`) |
| 3 | Import: MP4/MOV, MKV/WebM, AVI (OpenDML), MXF, MPEG TS/PS, Ogg, Y4M, raw APV + audio/still lists | `crates/media/src/lib.rs:175-179` (extension lists); `crates/codecs/src/lib.rs:135-137` (`openers()`); `crates/codecs/src/avi.rs` | implemented | Docs `file-format-parity.md` still says "AVI: no demuxer" — stale vs HEAD |
| 4 | Import interchange docs via `file.import` (EDL/xmeml/fcpxml/otio/aaf/omf) with one-undo merge + media linking | `crates/engine/src/commands.rs:1373-1385`; `crates/engine/src/interchange.rs:29-113` | implemented | Import runs documents through `filmcraft_interchange::detect` |
| 5 | Export formats enum incl. H.264, ProRes, DNxHR, APV, MJPEG, MXF OP1a/OP-Atom, PNG/TIFF/BMP/JPEG/Targa/DPX/OpenEXR sequences, GIF, WAV, AIFF, AAC, FLAC | `crates/export/src/lib.rs:64-134`; params doc `crates/engine/src/export_tools.rs:1602` | implemented | CLI extension→format map is smaller (`apps/filmcraft-cli/src/main.rs:204-219`) |
| 6 | HEVC & AV1 export only with a registered hardware encoder (no software encoder) | `crates/export/src/lib.rs:69-79` (`available`/probe); `crates/platform/src/lib.rs:72-92` (VideoToolbox/NVENC registration) | partial | macOS HEVC = 8-bit SDR VideoToolbox; NVENC HEVC incl. Main 10 HDR (Windows) |
| 7 | Interchange export: CMX 3600 EDL (+ per-track), FCP7 XML, FCPXML 1.9–1.11, OTIO, AAF, OMF | `crates/interchange/src/lib.rs:52-107` (Format), `:377-421` (export, per-track EDL); `crates/engine/src/commands.rs:1444-1491` | implemented | AAF/OMF never validated in Avid/Pro Tools (docs/gaps.md G15) |
| 8 | Captions: SRT, WebVTT, SCC, MCC (608/708), EBU STL, TTML/DFXP import+export; burn-in | `crates/captions/src/lib.rs:63-80`; `crates/captions/src/burn.rs`; commands `crates/engine/src/captions.rs:491,499` | implemented | `.xml` may be TTML (captions) or FCP XML (interchange) — detection order in `file.import` decides |
| 9 | `filmcraft-cli` subcommands: exec, run, commands, describe, inspect, import, export, render, probe, bench-decode, mcp | `apps/filmcraft-cli/src/main.rs:63-121` (HELP), dispatch `:283-497` | implemented | Exit codes 0/1/2 documented at `:118-121` |
| 10 | Control channel: loopback-only JSON-lines server, `--control`/`FILMCRAFT_CONTROL_PORT`, `--control-input-only` isolation | `apps/filmcraft/src/control_server.rs:27-34` (bind 127.0.0.1); `apps/filmcraft/src/args.rs:7-26`; docs/control-protocol.md:4-17 | implemented | No auth; malformed line closes the connection |
| 11 | MCP server (stdio, headless or bridge) with 17 tools + 2 resources | `crates/automation/src/server.rs:304-550` (`#[tool]` list), `:587-591` (resources); `.mcp.json` | implemented | Strict unknown-argument errors; progress/cancel for `file.exportMedia wait=true` |
| 12 | WebAssembly browser build; `window.filmcraft` agent API; single-threaded, thread-needing commands error | `apps/filmcraft-web/Cargo.toml`; docs/web.md:1-34, 57-62, 107-126 | partial | WebCodecs decode when available; OPFS recovery |
| 13 | Exact integer time base: 254,016,000,000 ticks/second; commands accept seconds/frame/timecode | README.md:85; docs/agents.md:165; `crates/time` | implemented | Ticks used in `.fcproj`, inspect output and MCP |
| 14 | Demo project (`--demo` / `filmcraft-cli mcp --demo`) | `crates/engine/src/demo.rs:41-51`; `apps/filmcraft/src/args.rs:86` | implemented | Synthetic footage, no external media needed |
| 15 | Undo/redo history | `crates/engine/src/commands.rs:1615-1616` (`edit.undo`/`edit.redo`); `crates/engine/src/lib.rs:202-210` | implemented | Capped at 200 steps (`lib.rs:842`, `commands.rs:1143`); README.md:86 says "unlimited" — claim is wrong |
| 16 | Graphics templates `.fcgt`; Adobe `.mogrt` refused by design | `crates/engine/src/graphic_templates.rs:99,1159`; `crates/project/src/gtemplate.rs:49` | implemented | `.mogrt` refusal is deliberate (clean-room rule) |
| 17 | Offline media: placeholder render + `offlineMedia` result + non-zero exit unless `--allow-offline` | `apps/filmcraft-cli/src/main.rs:531-552`; `crates/render/src/offline.rs`; docs/agents.md:223-230 | implemented | Prevents placeholder frames passing as a good render |
| 18 | `.prproj` (Premiere project) cannot be opened or written | docs/gaps.md G2; `rg -ri prproj crates apps` → no matches | not implemented | Beta blocker; bring work in via FCP7 XML/AAF/OTIO |
| 19 | No plugin hosting (VST3/AU/OpenFX); Settings ▸ Plugins is a stub | `crates/engine/src/settings.rs:1311-1315`; docs/gaps.md G11; `rg -rn 'vst3\|openfx\|audio unit' crates apps` → no matches | not implemented | Affects any "use my plugin" request |
| 20 | Speech-to-text (Whisper) and neural TTS (Kokoro) exist only behind off-by-default features; releases ship without them | `apps/filmcraft/Cargo.toml:13-18`; `crates/speech/src/lib.rs:127-139`; docs/gaps.md G19 | partial | Default `features = []`; no packaging reference to either feature |
| 21 | 10-bit / 4:2:2 camera media needs VideoToolbox; pure-Rust H.264 is 8-bit 4:2:0 | docs/gaps.md G3; `crates/h264/README.md` (per gaps.md) | partial | Fails to open on Windows/Linux without hardware decode |
| 22 | Export presets (~40 named) incl. YouTube/Vimeo/ProRes/DNxHR/MXF/image sequences/audio-only | `crates/export/src/presets.rs:95-190` | implemented | `export --list-presets` / `export.presets.list` |

## How the tiers were checked

- Only code paths (`crates/**/src`, `apps/**/src`), installed-bundle `Info.plist`, and in-repo docs
  were used. No GUI was launched; no app bundle internals inspected.
- "implemented" = the command/format is registered and reachable from CLI/control/MCP or UI wiring
  in code. "partial" = code exists but a stated capability is gated, missing a backend, or
  documented as untested. "not implemented" = searched and absent.
- Doc-vs-code drift found (docs lag HEAD): schema version (docs 13 vs code 15), AVI import
  (docs say none, code has `crates/codecs/src/avi.rs`), audio-format export list (docs say no FLAC
  export; `Format::Flac` exists at `crates/export/src/lib.rs:124-125`).
- Where the README overstates (e.g. "unlimited undo"), the code is treated as authoritative and the
  discrepancy is called out in `SKILL.md`.
