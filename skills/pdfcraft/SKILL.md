---
name: pdfcraft
description: >
  Use this skill whenever the user mentions PdfCraft (or "the PDF workbench"), asks what PdfCraft
  can do, asks about its supported file formats, CLI flags, MCP/agent tools, or keyboard shortcuts,
  or wants to inspect, render, search, organize, combine, split, comment on, fill, sign, protect,
  redact, OCR, compare, print or export PDFs with it. Trigger it for automate/script/verify/
  troubleshoot requests around PdfCraft, and even when the app is not named but the job is
  Acrobat-style document work (merge these PDFs, add page numbers, make this scan
  searchable, strip metadata, fill this form, check this signature, annotate this contract).
  All claims in this skill are grounded in the source repo storytold/pdfcraft; read
  references/ for the full automatable feature list before promising a capability.
---

# PdfCraft

## Overview

PdfCraft is a PDF workbench: a clean-room, pure-Rust reimplementation of Adobe Acrobat (explicit
target: Acrobat Pro, `docs/roadmap.md` header), built by ArtCraft (storytold) — source at
github.com/storytold/pdfcraft. It reads, renders, edits, organizes, combines, splits, comments on,
fills, signs, protects, redacts, OCRs, compares, prints and exports PDFs; the PDF object graph is
the document model, so there is no separate project format (`docs/architecture.md` §Data model).
Workspace version at HEAD is 0.8.0 (`Cargo.toml:8`); the project self-describes as **alpha**
(ROADMAP.md:3, docs/roadmap.md alpha gate). Runs natively on macOS, Windows, Linux and FreeBSD,
plus a WebAssembly browser build (`apps/pdfcraft-web`, `docs/architecture.md` §Shape). Rendering is
currently borrowed from the vendored `hayro` family while PdfCraft's own renderer is built
(`docs/gaps.md` gap 2) — factor that into fidelity claims.

Line numbers below are for the inspected commit (see §Sources); confirm against your installed
version — the locally installed app may be older than HEAD.

## Capabilities (verified)

### Core viewing, text and navigation
- PDF viewing with tiled rendering, continuous/single/two-up layouts, rotation, full screen and
  Read mode; themes light/dark/system (`README.md` §Read; `crates/ui-egui/src/lib.rs:2448-2600`
  startup view options). Pages are rendered on the CPU by vendored hayro and uploaded to the GPU
  (`docs/architecture.md` §Rendering and text).
- Reading-order text extraction (columns, RTL runs, vertical CJK), find-as-you-type, next/previous
  match, text selection/copy (`crates/render`, `docs/architecture.md` §Rendering and text;
  shortcuts ⌘F/⌘G/⇧⌘G in `crates/ui-egui/src/canvas.rs:1930-1980`).
- Search the corpus: `pdfcraft-cli text <file.pdf>`; find tool `text_find` with page/line rects
  (`apps/pdfcraft-cli/src/main.rs:315-377`, `crates/automation/src/tools.rs` text_find).
- Bookmarks (nested, searchable), page thumbnails, document page labels (`README.md` §Navigate).

### Page organization, combine, split, create
- Rotate, delete, move, duplicate, replace, insert blank/file pages; crop/boxes; page labels
  (tools `page_rotate`, `page_delete`, `page_move`, `page_duplicate`, `page_replace`,
  `page_insert_blank`, `page_insert_file`, `page_set_box`, `page_number` —
  `crates/automation/src/tools.rs`; Organize pages UI in `README.md` §Organize).
- Combine (bookmark per file, links/fields/layers/attachments carried), extract, split by every N
  pages / before pages / bookmarks / max size (`doc_combine`, `page_extract`, `doc_split` tools;
  CLI `combine|extract|split`, `apps/pdfcraft-cli/src/main.rs:479-525`).
- Create PDFs from blank pages, images (PNG/JPEG/TIFF incl. multi-page, GIF, BMP, JP2/J2K/JPX) and
  `.txt`/`.text` (`doc_create`, `doc_create_multiple`; extensions list
  `crates/create/src/lib.rs:488`).

### Comments, forms, layers, attachments
- All Acrobat markup types: note, highlight, underline, strikeout, squiggly, replace, rectangle,
  oval, line, arrow, ink, textbox, stamp (static and dynamic), polygon, cloud, polyline, callout,
  caret, attachment; replies, review status, checkmarks, locking, summarize, flatten
  (`comment_*` tools, `crates/automation/src/comments.rs`; `crates/annot`).
- Forms: field listing, filling with regenerated appearances, field creation (text/date/checkbox/
  radio/combo/list/button/image/signature), properties, tab order, calculations, field
  JavaScript, automatic field detection, data import/export
  (`crates/forms`, `crates/automation/src/forms.rs`; tools `form_*`, `doc_export_data`,
  `doc_import_data`, `form_detect_fields`).
- Fill & Sign without preparing fields: typed text, checks/crosses/dots/lines, dates, typed or
  image signatures and initials, photo-signature scanning (`fill_sign_add` tool).
- Acrobat JavaScript in a sandbox (boa): console, document scripts, field scripts, button scripts
  (`crates/js`; tools `js_run`, `js_document_scripts`, `js_set_document_script`,
  `form_set_script`, `js_enabled`). XFA: static/dynamic layout, FormCalc, data import
  (`crates/xfa`, `crates/automation/src/tools.rs` js_run/XFA notes).

### Protect, redact, sanitize, audit
- Standard security handler R2–R6: RC4-40/128, AES-128/256, user/owner passwords with SASLprep,
  permissions (`crates/crypt`; `doc_protect`, `doc_unprotect`; CLI `--password`).
- Redaction: mark by rect/find/words/pattern/whole pages with FOIA/Privacy Act codes, apply with a
  verification pass that fails if readable content remains; sanitize/remove hidden information
  (`crates/redact/src/lib.rs:12`; tools `redact_mark`, `redact_apply`, `redact_clear`,
  `doc_hidden_info`, `doc_remove_hidden`).
- Faux-redaction audit: finds text hidden under painted boxes and unapplied marks; CLI `audit`
  exits non-zero on findings (`doc_audit_redactions`; `apps/pdfcraft-cli/src/main.rs:158-179`;
  `crates/audit`).

### Signatures
- Sign with .p12/.pfx digital IDs, macOS Keychain identities or Windows certificate store; PAdES
  B-B, SHA-256/384; certification signatures; visible signatures with image/text/drawn graphic;
  create self-signed digital IDs; trust list; validation reporting (valid/unknown/invalid, changes
  after signing) (`crates/sign`; tools `sign_document`, `sign_id_create`, `sign_keychain_ids`,
  `sign_windows_ids`, `sign_list`, `sign_trust`).

### OCR, camera cleanup, print, export, optimize, standards, accessibility
- OCR (English, unaccented Latin): searchable-image text layer, batch recognition, camera-image
  straighten/clean-up (`crates/ocr`; tools `ocr_recognize`, `ocr_recognize_files`,
  `ocr_status`, `page_enhance_camera`). Needs models: `cargo xtask models` for source builds,
  `PDFCRAFT_MODELS` override (`crates/ocr/src/lib.rs:4-66`).
- Print: full Print-dialog model (ranges, subset, reverse, fit/actual/shrink/custom, multiple,
  booklet, poster, comments/forms, paper sizes, copies, duplex, grayscale, CUPS driver options),
  or write a print-ready PDF (`crates/print`, craft-print spooler; tools `doc_print`, `printers`,
  `printer_options`, `print_readiness`).
- Export: pages as PNG/JPEG/TIFF (150 dpi default, incl. unsaved edits), all embedded images,
  text; Word .docx, PowerPoint .pptx, HTML, RTF (`crates/export`; tools `doc_export_images`,
  `doc_export_all_images`, `doc_export_text`, `doc_export_office`).
- Optimize: Reduce File Size and full Optimizer (downsample/compress images, discard options);
  space audit (`crates/optimize`; tools `doc_reduce`, `doc_optimize`, `doc_audit_space`).
- Standards: PDF/A-2b/3b verify and convert (`crates/preflight/src/lib.rs:304,549`; tools
  `pdfa_verify`, `pdfa_convert`).
- Accessibility: 32-rule checker, HTML report, review records/sidecars, figure alt text, tag
  property/sibling-order edits, text-only auto-tagging (`crates/a11y`; tools
  `accessibility_*`).
- Compare: text diff (with optional visual-region diff), PDF report, mark differences as comments
  (`crates/compare`; tools `doc_compare*`).
- Measure: calibrated 2D distance/perimeter/area annotations and readouts, scale viewports, CSV
  export (`crates/measure`; tools `measure_*`).
- Editing existing content: text paragraphs/lines in-place rewrite (Western fonts, or Japanese
  via embedded fallback faces), image move/rotate/flip/replace/delete, added text/image/link
  content editing (`crates/edit`; tools `text_edit`, `text_lines`, `text_paragraphs`,
  `page_images`, `image_edit`, `content_*`, `link_*`).
- Headers/footers (with Bates numbering), watermarks (text or image), backgrounds
  (`doc_header_footer`, `doc_watermark`, `doc_background`, `doc_remove_marks`).

### Automation surfaces (three front doors, one tool table)
- **CLI** `pdfcraft-cli` — `info`, `render` (png/jpg/tif/pam), `text`, `edit`, `combine`,
  `extract`, `split`, `check` (child-process robustness sweep), `audit`, `batch`
  (convert/ocr/optimize over folders, `docs/cli-batch.md`), `tools`, `run` (single tool, `key=value`
  or `--script steps.json`), `ui` (drive a running app), `mcp` (`USAGE` in
  `apps/pdfcraft-cli/src/main.rs:49-74`).
- **Tool table**: 163 JSON-Schema tools at HEAD, each with read_only/destructive hints and,
  where one exists, a registry command id (`crates/automation/src/tools.rs`; full list in
  `references/automation-tools.md`; `pdfcraft-cli tools` prints the live set for your version).
  194 commands in the registry carry menus, shortcuts and enabled-state
  (`crates/engine/src/commands.rs:163`, COMMANDS).
- **MCP server**: opt-in, stdio only, no port, `pdfcraft-cli mcp [--root DIR] [--compact]`;
  tools/list + tools/call + resources (open-document info/text/page images); default-on `mcp`
  Cargo feature can be compiled out (`crates/automation/src/mcp.rs`, `docs/mcp.md`,
  `apps/pdfcraft-cli/Cargo.toml` features).
- **UI control channel**: opt-in `pdfcraft --control FILE`; loopback random port + per-launch
  token in an owner-only file; methods `ui.state, inspect, click, focus, resize, quit, move,
  drag, type, key, command, commands, set, open, screenshot`, plus docking; driven by
  `pdfcraft-cli ui --control FILE <method> …` (`crates/ui-egui/src/control.rs:276-360`,
  `README.md` §Driving the app itself; client + control-file safety checks in
  `apps/pdfcraft-cli/src/main.rs:811-916`).
- All engine entry points are wrapped in a last-resort `catch_unwind`
  (`crates/engine/src/lib.rs:2551`).

## Known limitations and not-implemented

- **Renderer fidelity unmeasured and borrowed** — pages drawn by vendored hayro; own renderer
  incomplete; comparison against Acrobat not yet measured (`docs/gaps.md` gaps 2 & 12).
- **Editing existing text is fragile beyond simple cases**: robust CJK/RTL, rotated text,
  lists, superscript, keep-tags-on-edit, vector editing, arrange/align are missing or planned
  (`docs/gaps.md` gap 3; `text_edit` refuses text no available font can show).
- **Office import absent; Office export lossy**: no Create-PDF-from-Word/Excel/PPT/HTML/web/
  PostScript; Word export can lose layout; no .xlsx export; no SVG/EPS/PS/JPEG-2000 export
  (`docs/gaps.md` gap 8; `crates/create/src/lib.rs:488` lists only images/text as convertible).
- **OCR is English/unaccented-Latin only**; no other scripts/accents, no OCR in the browser, no
  work without models (`docs/gaps.md` gap 7; `crates/automation/src/tools.rs` ocr_recognize
  `language` enum is `["en"]`).
- **No Preflight**; PDF/A only 2b/3b (partial: CMYK docs get no output intent); no PDF/X,
  PDF/UA verify, PDF/E, PDF/VT, transparency flattening (`docs/gaps.md` gap 9).
- **Signatures**: no PKCS #11/smart cards on macOS/Linux, no timestamp-server configuration, no
  online OCSP/CRL fetching (LTV only with caller-supplied evidence), no OS trust store, no EU
  Trusted Lists, no signing in the browser (`docs/gaps.md` gap 10).
- **Accessibility**: checker + alt text + tag edits + text-only auto-tag (refuses mixed content
  and existing tags); no reading-order/table editor, no Read Out Loud, app not fully
  keyboard-operable (`docs/gaps.md` gap 11).
- **Forms**: wider Acrobat JS object model incomplete, document actions/submit/debugger/barcode
  fields missing, XFA flattening absent (`docs/gaps.md` gap 15).
- **No scanners** (no TWAIN/WIA/ICA/SANE), **no GPU page rendering, no pen pressure, no
  Read Out Loud** (`docs/gaps.md` gap 20).
- **Compare** has no side-by-side view, filters, page ranges, or scanned-document handling
  (`docs/gaps.md` gap 21).
- **Preferences mostly missing** (only language, documents/view, identity, Fill & Sign,
  JavaScript areas) (`docs/gaps.md` gap 19).
- **No print production tools** (Output Preview, separations, ink manager, printer marks…)
  (`docs/gaps.md` gap 18).
- **Performance**: whole file is held in memory to view; editing peaks at ~2 copies, saving at
  ~3; no file-backed input yet (`docs/gaps.md` gap 13).
- **UI precision**: moving a multi-page selection across pages, rulers/grids/guides, in-app
  multiple windows and split view are still missing (`docs/gaps.md` gap 16); Arabic UI is not
  mirrored and no Hindi/Indonesian/Korean/Vietnamese catalogs (`docs/gaps.md` gap 14); Chinese
  UI may show missing-glyph boxes without an installed Chinese face (`docs/gaps.md` gap 5).
- **Web build limits**: no crash-recovery store (`crates/ui-egui/src/recovery.rs:11`), no control
  channel/`ui.open` (file system) (`crates/ui-egui/src/control.rs` wasm arms), printing goes
  through the browser dialog, embedded Japanese is Gothic Regular only
  (`docs/localization.md`; `docs/gaps.md` gap 4 closure note).
- **No AI features**: cloud AI is out of scope; a local/opt-in provider is only planned
  (`docs/gaps.md` gap 23).
- **Copy-protected documents**: text extraction and copy honour permissions — the owner password
  is required (`apps/pdfcraft-cli/src/main.rs:346-354`).
- **macOS CLI is not in the .app**: `pdfcraft-cli` ships as a separate release zip; the `.app`
  contains only the desktop app (`crates/automation/README.md` §From an installed release).

## How to operate

### Launch (macOS)
- Installed app: `/Applications/PdfCraft.app` (bundle id `ai.storyteller.pdfcraft`; binary
  `/Applications/PdfCraft.app/Contents/MacOS/PdfCraft`). Launch: `open -a PdfCraft`, or with a
  document `open -a PdfCraft /path/file.pdf`; pass app flags via
  `open -a PdfCraft --args --control ~/.pdfcraft-control.json`.
- Desktop flags (parsed in `apps/pdfcraft/src/main.rs:1-19,179-200`): files…, `--version`,
  `--control FILE`, `--create-images [images…]`, `--new-window`, `--page N`, `--zoom 150`,
  `--layout single|continuous|two-up|two-page`, `--continuous on|off`,
  `--panel comments|bookmarks|pages|fields|layers|attachments|none`, `--theme light|dark|system`,
  `--language auto|<code>`, `--mode all|read|edit|convert|sign`, `--tool <id>`, `--left open|closed`,
  `--organize on`, `--fields on`, `--dialog properties|shortcuts|about`, `--palette <query>`,
  `--home on`, `--cover on|off`, `--default-layout …`, `--default-continuous on|off`,
  `--default-zoom fit-width|fit-page|<percent>`, `--combine-view grid|list`, `--combine-zoom 60..200`.
- `pdfcraft-cli` (headless): download `pdfcraft-cli-<ver>-macos-universal.zip` from the GitHub
  release and put it on `PATH`; run `pdfcraft-cli --help` for the exact usage at that version.

### Document model and workflow
- One window, multiple documents as tabs (right-click a tab to close/reveal; dot marks unsaved
  changes). `--new-window` gives a launch its own window. Edits stay in memory as undo steps
  (`⌘Z` / `⇧⌘Z`), shown by name in the Edit menu; autosave writes recovery snapshots every 60 s to
  the settings folder and offers recovery after a crash; encrypted documents are recovered
  encrypted (`README.md` §Organize; `crates/ui-egui/src/recovery.rs:4-17`).
- Open: PDF only as a document (Encrypted PDFs prompt for password). Create inserts images/text;
  Combine also accepts them.
- Save: `⌘S` writes an **incremental update appended to the same file** — original bytes stay
  untouched, prior signatures stay valid; Save As (⇧⌘S) or a new path is a full rewrite; writes
  are atomic (temp copy then replace); `doc_save` `full: true` forces a rewrite
  (`README.md` §Saves you can trust; `docs/architecture.md` §Data model; `doc_save` tool).
- Export: File menu / tools as listed under Capabilities; the extension of the target path picks
  the format for data export (`.xfdf/.fdf/.xml/.xdp/.csv/.txt`) and Office export
  (`.docx/.pptx/.html/.rtf`) — `crates/xfdf/src/lib.rs:49-59`, `doc_export_office`.
- Panels: comments, bookmarks, pages, fields, layers, attachments, signatures, accessibility,
  tags, search, compare (set with `--panel` or `ui.set panel=<name>`,
  `crates/ui-egui/src/lib.rs:2347-2362`).

### Keyboard (verified in the command registry, `crates/engine/src/commands.rs`)
⌘K command palette (`:197`) · ⌘F find / ⇧⌘F advanced search (`:195-196`) · ⌘G / ⇧⌘G next/previous
match (`crates/ui-egui/src/canvas.rs:1978`) · ⌘Z/⇧⌘Z undo/redo (`:193-194`) · ⌘S / ⇧⌘S save /
save as (`:186-187`) · ⌘O open, ⌘W close, ⇧⌘W close all (`:164,188-189`) · ⌘D document properties
(`:192`) · ⌘J JavaScript console (`:323`) · ⌘, preferences (`:322`) · ⌘L full screen (`:217`) ·
⌃⌘H Read mode (`:218`) · ⇧⌘N go to page (`:224`). Labels follow the interface language; machine
ids never change. For the live truth at a given version ask the tools: `command_list` returns
every command with menu, shortcut, enabled state and mapped automation tool.

### Headless recipes
```sh
pdfcraft-cli info report.pdf                       # JSON: pages, encryption, forms, layers, warnings
pdfcraft-cli text paper.pdf --page 3               # reading-order text
pdfcraft-cli render paper.pdf --page 1 --dpi 144 --out p1.png
pdfcraft-cli edit in.pdf --rotate 1,2:90 --delete 5 --title "Q3" --out out.pdf
pdfcraft-cli combine a.pdf b.pdf --out combined.pdf
pdfcraft-cli extract report.pdf --pages 1,3,5 --out highlights.pdf
pdfcraft-cli split report.pdf --every 10 --out-dir parts/
pdfcraft-cli batch scans --recursive --steps ocr,optimize --out-dir out --root .
pdfcraft-cli tools | jq '.[].name'                 # the current tool table
pdfcraft-cli run text_find doc=1 query=invoice
pdfcraft-cli run --script steps.json --root ./work # multi-step JSON script
pdfcraft-cli audit maybe-redacted.pdf              # exits non-zero on faux redactions
```
Scripts are `[{"tool": "doc_open", "args": {"path": "in.pdf"}}, {"tool": "page_rotate",
"args": {"doc": 1, "degrees": 90}}, {"tool": "doc_save", "args": {"doc": 1}}]` with an optional
per-step `"out"` for images; with `--root`, every read/write path must resolve inside it.
MCP: `claude mcp add pdfcraft -- pdfcraft-cli mcp --root <dir>` (stdio, opt-in).

## Working with an AI agent

**Legitimate work.**
- Drive the engine headlessly through `pdfcraft-cli run`/`--script` or MCP; prefer the tool table
  (`pdfcraft-cli tools`) as the capability contract for the installed version rather than this
  file, which tracks HEAD.
- Prepare inputs: images (PNG/JPEG/TIFF/GIF/BMP/JP2) and `.txt` for `doc_create`; XFDF/FDF/XML/
  CSV/TXT for `doc_import_data`/`form_merge_data`; `.p12`/`.pfx` for signing; openly licensed
  TrueType/OpenType files for `text_font_import` (the engine validates embedding permissions and
  refuses restricted fonts).
- Interpret and repair documents: the PDF *is* the project file. `doc_revisions` +
  `doc_open_revision` show what each incremental save appended; `doc_info.warnings` and
  `doc_inspect` expose repairs; `--full` rewrites only when needed (redaction, PDF/A, password
  change, Save As GC — `docs/architecture.md` §Data model).
- Verify outputs independently: `page_render`/`render_preview` for pixels, `text_extract` for
  text, `doc_audit_redactions` after redaction, `pdfa_verify` after PDF/A conversion, and
  external oracles qpdf/poppler/hayro as the repo itself uses (`README.md` §How it's built).
- For UI work, launch with `--control` and use `pdfcraft-cli ui inspect/click/type/key/command/
  screenshot`; `inspect` returns the accessibility tree with labels — click by unique label, and
  screenshot to confirm. `quit` never silently discards work.

**Must not.**
- Do not drive the GUI blind (clicks by guessed coordinates without `--control` + `inspect`);
  do not expect deterministic GUI state across launches.
- Do not assume unsupported conversions: no Office→PDF, no .xlsx, no SVG/EPS/PS export, no
  non-English OCR, no PDF/UA or PDF/X verification.
- Do not edit CJK/RTL/rotated existing text or promise layout fidelity for Word export.
- Do not rewrite signed documents destructively: saving in place is incremental and keeps
  signatures valid, but `doc_optimize` refuses signed files, and any full rewrite invalidates
  certification; keep the original bytes.
- Do not put the control file in a shared folder (`/tmp`) or enable the MCP server/control
  channel by default — both are opt-in and loopback-only (`README.md` §Driving the app itself).

## Verification protocol

Alpha-software discipline for every session:
1. **Throwaway round-trip first**: open → edit → `doc_save` to a *new* path → reopen that file
   elsewhere (`pdfcraft-cli info/text`, then Preview/Acrobat or `qpdf --check`). Reopening in
   PdfCraft alone proves nothing about other readers.
2. **Never trust a silent export**: re-render exported images, re-read exported text, and open
   exported .docx/.pptx in their real app before declaring success. Office export is known
   lossy — compare against the page images.
3. **Redaction**: always run `pdfcraft-cli audit` (or `doc_audit_redactions`) on the saved file;
   `redact_apply`'s internal verification pass is a gate, not a substitute for the audit.
4. **Backups and versions**: keep the original PDF (incremental saves preserve it, but keep a copy
   anyway before full rewrites); the installed app may lag HEAD (installed here: 0.7.1 vs repo
   0.8.0) — check `pdfcraft --version` / `pdfcraft-cli --version` before trusting flags or tools
   from this skill. Update apps only between projects, never mid-task.
5. **Large or hostile files**: render/check via child-process `pdfcraft-cli check` when a file
   misbehaves; fuzzing still finds crashes and hangs (`README.md` §What's next), so treat an
   unexpected exit as a bug, not a boundary.

## Sources & evidence

- Repo: https://github.com/storytold/pdfcraft · installed app: `/Applications/PdfCraft.app`
  v0.7.1 (`Contents/Info.plist`), repo HEAD version 0.8.0.
- Inspected commit: `9931329b9fae0b05373b4dc3ac7c58541f0891a4` ("Release 0.8.0"), 2026-10-14.
- Key files read: `README.md`, `ROADMAP.md`, `docs/{gaps,roadmap,architecture,development,mcp,cli-batch,localization}.md`, `Cargo.toml`, `apps/pdfcraft/src/main.rs`,
  `apps/pdfcraft-cli/src/main.rs`, `crates/automation/{README.md,src/tools.rs,src/lib.rs}`,
  `crates/engine/src/commands.rs`, `crates/ui-egui/src/{control.rs,recovery.rs,lib.rs,canvas.rs}`,
  `crates/create/src/lib.rs`, `crates/export/src/lib.rs`, `crates/xfdf/src/lib.rs`,
  `crates/preflight/src/lib.rs`, `crates/ocr/src/lib.rs`, `apps/pdfcraft-web/`,
  `apps/pdfcraft-cli/Cargo.toml`.
- Companion: `evidence.md` (claim → evidence → tier table) for spot-checking.
