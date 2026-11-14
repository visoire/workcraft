# PdfCraft evidence table (orchestrator review copy)

Repo: storytold/pdfcraft · HEAD inspected: `9931329b9fae0b05373b4dc3ac7c58541f0891a4`
("Release 0.8.0", 2026-10-14) · installed app on the authoring Mac: `/Applications/PdfCraft.app` v0.7.1.

Tier key: **implemented** = code path exists and is wired into UI/CLI/tool table;
**partial** = exists but visibly incomplete (scope stated); **claimed** = README/doc statement not
verifiable from code; **absent** = documented gap / no code path.

| # | Capability claim | Evidence | Tier |
|---|---|---|---|
| 1 | Renders PDFs (tiled, CPU raster), layouts single/continuous/two-up, rotation, Read mode, themes | `crates/render`; `docs/architecture.md` §Rendering and text; `apps/pdfcraft/src/main.rs:6-11` | implemented (renderer borrowed from vendored `hayro`; fidelity unmeasured — `docs/gaps.md` gap 2) |
| 2 | Reading-order text extraction (columns, vertical CJK) + find with page/line rects | `text_extract`/`text_find` in `crates/automation/src/tools.rs`; `pdfcraft-cli text` `apps/pdfcraft-cli/src/main.rs:315` | implemented |
| 3 | Page ops: rotate/delete/move/duplicate/replace/insert/boxes/labels | tools `page_*` `crates/automation/src/tools.rs:190-313,791-812`; `crates/organize` | implemented |
| 4 | Combine (bookmark per file), extract, split (N/before/bookmarks/size) | `Session::combine/extract/split` used in `apps/pdfcraft-cli/src/main.rs:479-525`; tools `doc_combine`, `page_extract`, `doc_split` | implemented |
| 5 | Create PDF from blank/images/TXT (PNG/JPEG/TIFF/GIF/BMP/JP2/J2K/JPX, .txt/.text) | `crates/create/src/lib.rs:488` (`CONVERTIBLE`), `doc_create` tool | implemented |
| 6 | Full comment markup set + replies/status/lock/summarize, XFDF/FDF import-export | `crates/annot`, `crates/automation/src/comments.rs`, `comment_add` schema `tools.rs:618-655`; `crates/xfdf/src/lib.rs:49-59` | implemented |
| 7 | Forms: list/fill/add/properties/tab order/detection/data exchange; sandboxed Acrobat JS; XFA layout | `crates/forms`, `crates/js`, `crates/xfa`; `form_*` tools; `js_run` schema (`tools.rs:967`) | implemented (XFA + JS object model partial — `docs/gaps.md` gap 15) |
| 8 | Fill & Sign (text/marks/date/signature image incl. photo-scan) | `fill_sign_add` `tools.rs:1085-1107`; `crates/ui-egui/src/fill_sign.rs`; `crates/engine/src/signature_image.rs`, `signature_scan.rs` | implemented |
| 9 | Passwords: standard security handler R2–R6 (RC4-40/128, AES-128/256, SASLprep) | `crates/crypt`; `doc_protect`/`doc_unprotect` `tools.rs:767-790` | implemented |
| 10 | Redaction with post-apply verification pass; sanitize/remove hidden info | `crates/redact/src/lib.rs:12`; tools `redact_mark`/`redact_apply`/`doc_remove_hidden` | implemented |
| 11 | Faux-redaction audit; CLI fails on findings | `crates/audit`; `apps/pdfcraft-cli/src/main.rs:158-179` (`audit`) | implemented |
| 12 | Signing: .p12/.pfx, macOS Keychain, Windows store; PAdES B-B; certification; validation | `crates/sign`; tools `sign_document`, `sign_id_create`, `sign_keychain_ids`, `sign_windows_ids`, `sign_list` | implemented (no PKCS#11/timestamps/online revocation — `docs/gaps.md` gap 10) |
| 13 | OCR to searchable image; batch; camera enhance | `crates/ocr`; tools `ocr_recognize`, `ocr_recognize_files`, `page_enhance_camera` (`tools.rs:200,1043-1070`) | partial: `language` enum is `["en"]` (unaccented Latin only — gap 7); needs models (`crates/ocr/src/lib.rs:57-66`) |
| 14 | Print with Acrobat-style options or write print-ready PDF | `crates/print` + `craft-print` dep `Cargo.toml:18`; `doc_print` schema `tools.rs:479-512` | implemented (web prints via browser dialog — `docs/gaps.md` gap 4 note) |
| 15 | Export pages as PNG/JPEG/TIFF, all images, text; Word/PPTX/HTML/RTF | `crates/export` (`lib.rs:360,584,725`, `pptx.rs:116`); tools `doc_export_images`, `doc_export_all_images`, `doc_export_text`, `doc_export_office` | implemented (Word layout lossy, no XLSX — gap 8) |
| 16 | Optimize / Reduce File Size / space audit | `crates/optimize`; tools `doc_reduce`, `doc_optimize`, `doc_audit_space` | implemented (signed docs refused — `doc_optimize` schema) |
| 17 | PDF/A-2b/3b verify + convert | `crates/preflight/src/lib.rs:304,549`; tools `pdfa_verify`, `pdfa_convert` | partial: only 2b/3b, structural rules; no Preflight, PDF/X, PDF/UA (gap 9) |
| 18 | Accessibility: 32-rule check, report, review records, alt text, tag edits, text-only autotag | `crates/a11y`; `accessibility_*` tools `tools.rs:876-963` | partial (mixed content/existing tags refused by autotag; gap 11) |
| 19 | Compare text (+visual regions), report, mark-as-comments; measure distance/area/perimeter + CSV | `crates/compare`, `crates/measure`; tools `doc_compare*`, `measure_*` | implemented (no side-by-side/filters — gap 21) |
| 20 | Edit existing text/images in place; add/edit text, images, links, headers/footers, watermark, background | `crates/edit`; tools `text_edit`, `text_paragraphs`, `text_lines`, `image_edit`, `content_*`, `link_*`, `doc_header_footer`, `doc_watermark`, `doc_background` | partial: Latin text usually, CJK/RTL fragile/refused; same-page multi-object moves only (gap 3) |
| 21 | CLI: info/render/text/edit/combine/extract/split/check/audit/batch/tools/run/ui/mcp | `apps/pdfcraft-cli/src/main.rs:49-74` (`USAGE`), command dispatch `:76-115` | implemented (`check` = dev robustness harness; `batch` limits in `docs/cli-batch.md`) |
| 22 | One tool table shared by CLI, JSON scripts, MCP, Rust API | `crates/automation/src/tools.rs` (163 tools extracted at HEAD), `crates/automation/README.md`, `docs/mcp.md` | implemented; MCP opt-in stdio only (`apps/pdfcraft-cli/Cargo.toml` features, default `mcp` on) |
| 23 | UI control channel: loopback + per-launch token; state/inspect/click/type/key/command/screenshot/dock/resize/quit | `crates/ui-egui/src/control.rs:276-360`; client + control-file safety `apps/pdfcraft-cli/src/main.rs:811-916` | implemented, opt-in via `--control` only |
| 24 | Safe saves: incremental append keeps original bytes; atomic swap; autosave + crash recovery every 60 s (encrypted recovery stays encrypted) | `docs/architecture.md` §Data model; `crates/ui-egui/src/recovery.rs:4-17` (`AUTOSAVE_SECS = 60.0`); `doc_save` description | implemented |
| 25 | Keyboard surface from a 194-command registry (⌘K palette, ⌘S/⇧⌘S, ⌘Z/⇧⌘Z, ⌘F/⌘G, ⌘D, ⌘J, ⌘,) | `crates/engine/src/commands.rs:163` (COMMANDS) `:186-197,217-224,322-323`; `canvas.rs:1978` | implemented (labels localize; ids stable) |
| 26 | WebAssembly browser build of the same shell | `apps/pdfcraft-web/` (`trunk build --release`), `docs/architecture.md` §Shape | implemented (no recovery store, no control channel, browser print; Japanese Gothic Regular only) |

## README/doc claims not verifiable from code (mark as claimed)

| Claim | Where | Note |
|---|---|---|
| Saves "independently checked with qpdf"; output verified with hayro/qpdf/poppler | `README.md:173-176,368` | dev/CI oracles, not a runtime product feature |
| Corpus sweeps: 983 pdf.js files, 963 open/render, 958 edit round trips | `README.md:364-367` | numbers from the pinned corpus harness (`xtask check`), not reproducible here |
| "0 crashes across the 983-file pdf.js corpus" | `README.md:115` | README claim; fuzzing still finds crashes/hangs (`README.md:425`) |
| Word-F1 0.98 against `pdftotext`; readiness percentages (alpha, ≈49%) | `docs/architecture.md:67,104`; `ROADMAP.md:50` | harness/assessment docs, not runtime guarantees |

## Spot-checks I could not run (no GUI launch per brief)

- Installed 0.7.1 bundle was inspected only via `Contents/Info.plist`; its exact menu/HUD text and
  feature set may differ from HEAD 0.8.0 (`--version` not executed to avoid launching).
- macOS `pdfcraft-cli` is not installed on the authoring machine (separate release zip), so CLI output
  samples come from source, not an executed binary.
- `CRAFT_FONTS_DIR`/`PDFCRAFT_MODELS` state of the installed app is unknown; Japanese UI and OCR
  availability in the installed build were not exercised.
