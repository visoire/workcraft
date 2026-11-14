# SoundCraft evidence table

Repo: https://github.com/storytold/soundcraft · HEAD `3a28a657692c1b98b28c276d8f61df9471074f0f` (2026-10-14)
Installed app: `/Applications/SoundCraft.app` 0.6.1 vs workspace 0.7.0 (HEAD ahead of release).

| # | Capability claim | Evidence (repo-relative) | Status |
|---|---|---|---|
| 1 | Stage pre-alpha; alpha gate fails on interface recording, MIDI recording, session interchange | `ROADMAP.md` (headline numbers, "Why pre-alpha"), `docs/roadmap.md` (Alpha gate table) | Implemented as documented claim |
| 2 | Every action is a command; ~296 unique ids at HEAD (test enforces >150); undo per document-changing command | `crates/engine/src/cmd/mod.rs` (`command_specs`, `ids_are_unique_and_documented`), `crates/engine/src/lib.rs` (`Engine::execute` catch_unwind + undo) | Implemented |
| 3 | Native session = `.scraft` JSON + `Audio Files/` float32 WAV; atomic saves; `Backups/` newest-ten roll | `crates/model/src/session.rs:11` (`SESSION_EXTENSION`), `crates/engine/src/io.rs` (`write_session`, `replace_file`, `back_up`) | Implemented |
| 4 | Web saves ONE bundle `<name>.scraftz` (zip of session + audio) | `crates/engine/src/io.rs` (`BUNDLE_EXTENSION`, `session_bundle`, `save_session_bundle`), `apps/soundcraft-web/src/main.rs` docs | Implemented (wasm only) |
| 5 | Audio import formats: WAV/BWF/RF64/BW64, AIFF/AIFF-C, FLAC, MP3, Ogg, AAC/M4A/MP4, ALAC, CAF, MKV/WebM | `crates/audio-io/src/lib.rs` (crate docs, `detect_format`, `detect_by_ext`) | Implemented |
| 6 | Audio encode/bounce formats: WAV/BWF (RF64 >4 GiB), AIFF/AIFF-C fl32, FLAC only; TPDF dither; channel mask | `crates/audio-io/src/lib.rs` (`ENCODE_EXTENSIONS`, `encode`, `encode_wav_rf64`, `encode_with_channel_mask`) | Implemented |
| 7 | Bounce reports `peak_db`/`true_peak_db`/`lufs`; `source` bus, normalize, fold-down, 16/24/32f | `crates/engine/src/cmd/file.rs` (`bounce_job`, `bounce`, `file.bounce_mix` spec) | Implemented |
| 8 | MIDI SMF import/export with controllers and `tracks` filter | `crates/midi/src/smf.rs` (`read_smf`, `write_smf`), `crates/engine/src/io.rs:304` (`export_midi`), test `midi_export_keeps_controllers_and_honours_tracks` in `crates/engine/src/cmd/file.rs` | Implemented (docs/file-format-parity marks write "🟡" — stale at HEAD) |
| 9 | MusicXML export + SVG score print | `crates/engine/src/score.rs:234` (`musicxml`), `:331` (`svg`); commands `file.export_sibelius`, `file.print_score` in `crates/engine/src/cmd/file.rs` | Implemented |
| 10 | Audio-to-MIDI monophonic pitch tracking | `crates/engine/src/cmd/audio_midi.rs` (`edit.copy_audio_as_midi`), `crates/dsp/src/pitch_detect.rs` (`audio_to_notes`) | Implemented |
| 11 | 27 built-in plugins (24 processors + 3 instruments incl. sampler) | `crates/dsp/src/plugins/mod.rs` (`REGISTRY`, `instantiate`), printed by `soundcraft-cli plugins` (`apps/soundcraft-cli/src/main.rs`) | Implemented (docs/plugin-parity "sampler PR open" is stale) |
| 12 | CLAP/VST3/AU hosting with state in session; AU editors, VST3-on-Linux, mac VST3 entitlement missing | `crates/clap-host`, `crates/vst3-host/src/ffi.rs` (editor paths), `crates/au-host/src/lib.rs` ("Not hosted yet: Audio Unit editor views"), `docs/gaps.md` G-05, `docs/plugin-parity.md` hosting table | Implemented with partial editors |
| 13 | 10 inserts + 10 sends per track; formats Mono…9.1.6 + Ambisonics 1–7 | `crates/model/src/mixer.rs:6-7` (`INSERT_SLOTS`/`SEND_SLOTS`), `ChannelFormat::ALL` | Implemented |
| 14 | CLI subcommands info/convert/run/script/commands/describe/app/mcp/parity/plugins (hand-rolled args) | `apps/soundcraft-cli/src/main.rs` (module doc = `--help`; `main()` match) | Implemented |
| 15 | Control channel JSON-lines methods incl. synthetic input + `ui.screenshot`; port printed on stderr/stdout | `crates/ui-egui/src/control.rs` (method match), `apps/soundcraft/src/control_server.rs` (`SOUNDCRAFT_CONTROL_PORT=` print), `docs/control-protocol.md` | Implemented (partial: `soundcraft-cli app` shorthand omits `ui.scroll`/`ui.zoom` — `main.rs` `is_control_method`) |
| 16 | MCP server (stdio) + `--automation-read-root`/`--automation-write-root` confinement | `apps/soundcraft-cli/src/main.rs` (`mcp`, `parse_mcp_args`), `crates/engine/src/file_access.rs`, `docs/mcp.md` | Implemented |
| 17 | Recording: record/punch/loop/monitor; BUT default devices only, fixed 512-sample block, takes in RAM, no MIDI device layer | `crates/engine/src/cmd/transport.rs`, `crates/engine/src/cmd/options.rs` (`quickpunch`, pre/post-roll), `docs/roadmap.md` (Alpha gate), `docs/gaps.md` G-01/G-02/G-06 | Partial / alpha blockers |
| 18 | Video track + Video window decode MP4/MOV H.264, ProRes, Motion JPEG (no HEVC/DNx/AV1, no video bounce) | `crates/video/src/lib.rs` (crate docs), `crates/engine/src/cmd/video.rs`, `docs/gaps.md` G-17 | Implemented with limits |
| 19 | Keyboard shortcuts: Space, Cmd+Space, F1–F4 modes, F5–F10 tools, Cmd+= Mix/Edit, Enter marker, single-key Commands Focus | `crates/ui-egui/src/shortcuts.rs` (`fixed`, `commands_focus`, `parse`), shortcut strings in `crates/engine/src/cmd/*.rs` (e.g. `edit.rs`, `transport.rs`, `file.rs`) | Implemented |
| 20 | No `.ptx`/AAF/OMF; no MP3/AAC export; English only; no control surfaces/sync | `docs/gaps.md` G-03, G-09, G-10, G-11, G-21; `docs/file-format-parity.md`; `ROADMAP.md` languages table | Not implemented |
| 21 | WebAssembly build exists (no filesystem/TCP; demo on start; `?webgl`/`?empty` flags) | `apps/soundcraft-web/src/main.rs`, `apps/soundcraft-web/` (trunk) | Implemented |
| 22 | Demo song synthesised in code (no third-party media) | `crates/engine/src/demo.rs` (header, `demo_engine`/`demo_session`) | Implemented |
| 23 | Logs to stderr + settings `logs/soundcraft.log` (rotating, 16 MiB cap); env vars `RUST_LOG`, `SOUNDCRAFT_NO_PREFS`, `SOUNDCRAFT_CONFIG_DIR`, `SOUNDCRAFT_CONTROL_PORT` | `README.md` Logs, `apps/soundcraft/src/logging.rs`, `docs/control-protocol.md`, `apps/soundcraft/src/main.rs` (arg/env parsing) | Implemented |
| 24 | README performance claims ("120 fps, seventy-odd tracks", "parallel mix engine") | `README.md` only; no benchmark/harness in repo (`docs/gaps.md` G-07) | Claimed but unverified |

Notes for the orchestrator:
- The installed bundle is 0.6.1 while the repo workspace is 0.7.0; release notes/roadmap logs lag too (ROADMAP says v0.4.0 as latest), so HEAD is the ground truth used here.
- Two doc-stale contradictions were resolved in favour of code at HEAD: MIDI export (controllers + track filter work; test in `cmd/file.rs`) and the sampler (in `crates/dsp/src/plugins/mod.rs`).
- `soundcraft-cli` is not inside the app bundle; it is a separate release artifact (`README.md` Downloads).
