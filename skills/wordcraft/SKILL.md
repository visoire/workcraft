---
name: wordcraft
description: >-
  WordCraft is a native, pure-Rust word processor — a clean-room, open-source reimplementation of
  Microsoft Word with ribbon UI, .docx read/write, PDF/PNG export, and first-class scripting.
  Trigger this skill whenever anyone mentions WordCraft by name; asks to create, open, edit,
  convert, compare, proof, print or export a word-processing document (.docx, .docm, .dotx/.dotm,
  .doc, .odt, .rtf, .html, .md, .tex, .txt, .json, .xml, PDF, page PNG); wants to automate a word
  processor, batch-convert documents, drive an editor headlessly via CLI/MCP/control channel, or
  have an AI agent write/review a document with tracked changes; asks about WordCraft's
  capabilities, file formats, keyboard shortcuts, commands or limitations; or needs to verify,
  repair or troubleshoot a WordCraft file or export. Even if the user never names the app:
  "edit this .docx and export a PDF", "convert these RTF files to Markdown", "add a table of
  contents to this report" → this skill.
---

# WordCraft

## Overview

WordCraft is an open-source, clean-room reimplementation of Microsoft Word, rebuilt from public
specifications in pure Rust — "Writing and document design" with Word's ribbon, styles, tables,
track changes, references and mail merge (`README.md:13-21`). It is a Rust workspace (v0.7.0,
MIT OR Apache-2.0, `Cargo.toml:7-11`) at <https://github.com/storytold/wordcraft>, currently in
**alpha**: it covers ~97% of Word's ribbon features with commands (487/502,
`docs/parity-checklist.md:5`) but self-estimates only **~60% "ready for real work"**
(`ROADMAP.md:21`). It ships natively on macOS/Windows/Linux/BSD and in the browser via
WebAssembly (`README.md:19`). The installed app at `/Applications/WordCraft.app` is **0.6.1**
while this repo is HEAD **0.7.0** — *verify against your installed version*; behaviour below is
from HEAD unless stated.

## Capabilities (verified)

Every user-visible action is a command with an id. The registry is built in
`crates/engine/src/cmd/mod.rs:58` (`registry()`, one module per area, 617 `CommandSpec::new`
ids at HEAD); the same ids drive the ribbon, shortcuts, `wordcraft-cli`, the MCP server and the
control channel (`README.md:98-100`). `wordcraft-cli commands` prints the live list with each
id's label, shortcut and ribbon location (`apps/wordcraft-cli/src/main.rs:292-306`).

### Editing and formatting core
- **Writing**: typing, IME, smart quotes, AutoCorrect/AutoFormat, `=rand()`/`=lorem()` expansion;
  typing behaviour is pinned to Word's observed behaviour in `docs/typing-parity.md` and
  `crates/engine/src/tests_typing.rs`. Commands: `crates/engine/src/cmd/text.rs`,
  `cmd/caret.rs`, `cmd/edit.rs` (undo/redo incl. `edit.undoTo`/`edit.undoHistory`),
  `cmd/paste.rs`.
- **Character and paragraph formatting**: fonts, sizes, bold/italic/underline/strike, sub/sup,
  caps, highlight, colours, spacing; alignment, indents, spacing, tabs, borders, shading.
  `cmd/format.rs`, `cmd/font.rs`, `cmd/para.rs`; the full `CharProps`/`ParaProps` JSON schema is
  documented in `docs/mcp.md:101-178`.
- **Styles, themes, lists**: built-in style set, gallery, Styles pane, `styles.modify`; bullets,
  numbering, multilevel. `cmd/lists.rs`, `cmd/design.rs`; `crates/doc`.
- **Tables**: insert, merge/split, styles, banded rows, borders, header-row repeat, sort,
  formulas, text↔table, Draw Table/Eraser, mouse resize. `cmd/table.rs`, `cmd/table_style.rs`,
  `cmd/table_draw.rs`, `cmd/table_resize.rs`, `cmd/table_mouse.rs`.
- **Pages/sections**: margins, orientation, columns, breaks, headers/footers, page numbers,
  watermark, line numbers, drop caps, hyphenation. `cmd/page.rs`, `cmd/column.rs`.
- **Objects**: pictures (crop, recolour, styles, rotate), shapes, text boxes, WordArt,
  connectors, drawing canvas, ink (pen/highlighter/lasso/Ink-to-Shape), charts and SmartArt made
  in WordCraft. `cmd/objects.rs`, `cmd/wordart.rs`, `cmd/connectors.rs`, `cmd/canvas.rs`,
  `cmd/draw.rs`, `cmd/chart.rs`, `cmd/smart_art.rs`; WMF/EMF insertion via `crates/metafile`.
- **References**: TOC, footnotes/endnotes, citations + bibliography (12 styles), captions, index,
  cross-references. `cmd/references.rs`, `cmd/citations.rs`, `cmd/index.rs`, `cmd/fields.rs`.
- **Review**: comments in margin balloons, track changes (incl. formatting revisions and move
  tracking), accept/reject, compare, restrict editing, spelling/grammar/thesaurus, word count.
  `cmd/review.rs`, `cmd/protect.rs`, `cmd/inspector.rs`, `cmd/accessibility.rs`; proofing in
  `crates/proof`.
- **Mailings**: mail merge from CSV/TSV, typed lists, and Excel/OpenDocument spreadsheets;
  envelopes and labels. `cmd/mailings.rs`; spreadsheet cells read by `crates/formats/src/sheet.rs`.
- **View/UI**: print/web/draft/outline/read modes, zoom, Navigation pane, dark mode, interface in
  18 languages (most translated ~95%). `cmd/view.rs`, `cmd/outline.rs`, `cmd/options.rs`,
  `crates/ui-egui`.

### File formats (open → save)

Dispatch is by extension in `crates/engine/src/io.rs` — `OPEN_EXTS` at line 9, `SAVE_EXTS` at
line 31 — routed in `crates/engine/src/io_ext.rs:6-38`:

| Format | Read | Write | Handler | Notes |
|---|---|---|---|---|
| `.docx` (also `.docm`, `.dotx`, `.dotm`) | yes | yes | `crates/docx` (`read`/`write_as`) | Fidelity ~65%; never tested on a real-world corpus (`docs/gaps.md` #1); macros preserved, never run |
| `.doc`/`.dot` (Word 97-2003) | partial | **no** | `crates/docbin` (read-only, `lib.rs:73`) | No writer; Word 6/95 and RC4/XOR-encrypted refused (`docs/gaps.md` #14) |
| `.pdf` | **no** | yes | `wordcraft_pdf::export` (`crates/pdf/src/lib.rs:97`) | Selectable text, links, bookmarks; Print Markup with comment balloons; no PDF/A |
| `.png` page image | — | yes | `io_ext.rs:42` (`render_png`), `file.exportPng` | `page` (1-based), `scale` px/pt |
| `.odt` | partial | partial | `crates/formats/src/odt.rs` | ~50%: no footnotes, comments, tracked changes, fields or RTL (`docs/file-format-parity.md`) |
| `.rtf` | partial | partial | `crates/formats/src/rtf.rs` | ~50%; thin on comments, notes, revisions, sections |
| `.html`/`.htm` | partial | partial | `crates/formats/src/html.rs` | Tables, relative pictures (read from beside the file, sandboxed), MathML equations; no Word "Web Page + `_files`" round trip |
| `.md`/`.markdown` | yes | yes | `crates/formats/src/markdown.rs` | CommonMark subset + GFM tables/strikethrough |
| `.tex`/`.latex`/`.ltx` | yes | yes | `crates/formats/src/latex.rs` | Includes math |
| `.txt` | yes | yes | `crates/formats/src/txt.rs` | Encoding detection; any text file opens by content (#569) |
| `.json` (document model) | yes | yes | serde on `wordcraft_doc::Document` (`io.rs:122`) | For agents; not a Word format |
| `.xml` Flat OPC (Word XML Document) | yes | yes | `crates/docx` (`read_xml`, `write_flat`) | Format told apart by root element |
| `.xml` Word 2003 XML | partial | partial | `crates/docx/src/wordml2003*.rs` | Write drops shapes, text boxes, charts, SmartArt, ink, equations, OLE (`docs/file-format-parity.md`); never opened in Word yet |

Also: `.wcraft.json`-style names are just `.json`; encrypted/password-protected **.docx** opens
and saves with `password` via ECMA-376 agile encryption (`crates/docx/src/crypt.rs:58`,
`io.rs:109-115`, `file.encrypt` in `cmd/file.rs:48`) — note `docs/gaps.md` #9 still (stale) lists
this as missing, and only Word-package extensions can be encrypted (`io.rs:96`).

### Automation surfaces (verified, all wired)
- **CLI** `wordcraft-cli` (`apps/wordcraft-cli/src/main.rs:13-46` documents every flag):
  `convert <in> <out> [--markup] [--format wordml2003|flatopc]`, `info`, `text`, `inspect`,
  `render <file> <out.png> [--page N] [--scale S]`, `run [--file F|--template T]
  --cmd 'id={json}'… [--save OUT] [--print] [--author NAME]`, `commands [--json]`,
  `parity [--markdown]`, `mcp`, `zotero`, `--version`.
- **MCP server** over stdio (`crates/mcp/src/tools.rs:171-270`, `docs/mcp.md:83-97`). Headless:
  `list_commands`, `execute`, `batch`, `new_document`, `open_document`, `save_document`,
  `type_text`, `select_text`, `get_text`, `inspect_document`, `render_page`, `parity`. App-only
  (with `--connect`): `screenshot`, `click`, `key`, `ui_inspect`.
- **Control channel**: `wordcraft --control <port>` speaks JSON-lines on 127.0.0.1 with a key
  file (`apps/wordcraft/src/control_server.rs`, `docs/control-protocol.md`). Methods:
  `engine.execute`, `engine.commands`, `document.inspect`, `ui.inspect`, `ui.click`,
  `ui.clickText`, `ui.move`/`ui.drag`, `ui.press`/`ui.release`, `ui.wheel`, `ui.key`, `ui.text`,
  `ui.screenshot`, `ui.render`, `ui.parity`, `ui.resize`/`ui.focus`, `app.quit`.
- **Macros**: record/run any command sequence — `tools.recordMacro`, `tools.macros`
  (`crates/engine/src/cmd/tools.rs:349-363,724-750`).
- **Zotero**: live citation integration through the running Zotero desktop app
  (`crates/zotero`, `docs/zotero.md`); headless via `wordcraft-cli zotero <command> <file>`.
- **Templates**: `file.new` takes `blank|sample|letter|resume|report`
  (`crates/engine/src/cmd/file.rs:149-153`).
- **Web (WASM)**: same app in the browser — `apps/wordcraft-web` (`trunk serve`, port 8771,
  `Trunk.toml:10`). Differences verified in `apps/wordcraft-web/src/main.rs:5-10`: no TCP control
  channel; open/pictures use the browser picker; save/export download.
- **Native printing** through craft-print on macOS/Windows/Linux (`apps/wordcraft/src/print.rs`;
  dependency `apps/wordcraft/Cargo.toml:70`), plus `file.printPdf` and browser printing.

## Known limitations and not-implemented

Do not assign these without checking `docs/gaps.md` (ranked work list) and `ROADMAP.md`. The
biggest verified blockers as of the docs' last review (2026-10-10…13; HEAD may be ahead):

- **Real-world `.docx` is untested** — no corpus of Word/Google Docs/LibreOffice files has been
  opened and compared with Word; field reports have found fallout one by one (`docs/gaps.md` #1).
  Never promise "Word will show this identically".
- **Pagination differs from Word** — no Aptos-metric substitute, legacy compatibility options
  ignored; do not promise identical page counts or line breaks (`docs/gaps.md` #4).
- **Charts/SmartArt/OLE from Word are read-only** (shown from cached data or as a picture; OLE
  can't be opened); unsupported chart types (radar, stock, 3-D…) show a placeholder; 3D models
  are dropped on open; remaining Word-native ink forms are preserved but not rendered or edited
  (`docs/gaps.md` #2, #12, #13).
- **Stability is alpha-grade** — startup crash on some Intel UHD graphics, hang reports, etc.
  (`docs/gaps.md` #3). Save on a copy and keep backups; see Verification protocol.
- **`.doc` cannot be written**; Word 6/95 refused (`docs/gaps.md` #14). No MHT, Works/WordPerfect,
  no PDF Reflow (`docs/gaps.md` #23, #26); Strict OOXML is read but not written.
- **Proofing exists only for English, Polish, Portuguese (pt-BR) and Italian**; text in other
  languages is left unmarked (`docs/gaps.md` #8).
- **Incomplete feature depth**: tracked style-definition changes and content-control data
  binding; custom XML binding evaluation; form fields (`w:ffData`); bibliography sources not
  saved in `.docx` (#169); RTF/ODT thin; RTL and East Asian areas partial; ~135 of Word's ~250
  default shortcuts; 54 dialogs vs Word's ~100; no Side by Side windows, no Dictate
  (`docs/gaps.md` #5, #10, #11, #15–#19, #24, #27, #28).
- **No VBA execution, add-ins, cloud storage or co-authoring**; `.docm` macros are preserved but
  never run (`docs/gaps.md` #22). No in-app AI assistant (#25). Screen-reader exposure exists
  but has not been tried with real screen readers (#18).
- **UI shape**: one window, **one document** — `file.open` replaces the current document
  (`crates/engine/src/cmd/file.rs` `open` → `Session::set_document`); no tabs or multiple
  windows.
- **Web build**: no control channel, no filesystem — files enter/leave through the browser.

## How to operate

### Launch (macOS)
```sh
open -a WordCraft                       # installed 0.6.1 app (Start screen)
open -a WordCraft --args --sample       # sample document ("The Open Studio Handbook")
open -a WordCraft --args report.docx    # open a document
# binary directly: /Applications/WordCraft.app/Contents/MacOS/WordCraft
```
Desktop flags (`apps/wordcraft/src/main.rs:236-254`): `--control <port>` (or env
`WORDCRAFT_CONTROL_PORT`), `--sample`, `--version`, and any other argument = file to open.
macOS settings live in `~/Library/Application Support/WordCraft/`: `ui.json` (preferences),
`control-key.local-<port>` (control key, mode 0600, deleted on exit), `logs/wordcraft.log`
(rotating; attach to bug reports), `fonts/` (user-added fonts), `custom-dictionary.txt`.
`WORDCRAFT_NO_PREFS=1` runs a test instance that neither reads nor writes preferences.
`RUST_LOG` selects log levels (`README.md:178-182`).

### Headless CLI (docs' own tool; build from this repo or download the signed zip)
```sh
wordcraft-cli convert report.docx report.pdf          # formats: docx doc pdf odt rtf html md tex txt json png xml
wordcraft-cli convert report.docx out.html --markup   # Print Markup: comments appended
wordcraft-cli text report.docx                        # plain text (list labels kept)
wordcraft-cli inspect report.docx                     # structure as JSON
wordcraft-cli render report.docx page1.png --page 1 --scale 2.0
wordcraft-cli run --template letter --author "Claude (copyedit)" \
  --cmd 'text.insert={"text":"Dear Ada,"}' --cmd 'format.bold' --save out.docx
wordcraft-cli commands --json                         # every command + params docs
```
Exit status is 0/1; errors go to stderr as `wordcraft-cli: <message>`. Unknown flags are
rejected before any file access (`apps/wordcraft-cli/src/main.rs:478-482`).

### Agent bridge (MCP)
```sh
claude mcp add wordcraft -- wordcraft-cli mcp            # headless documents
wordcraft --control 7981 &                               # or drive the running app:
claude mcp add wordcraft-app -- wordcraft-cli mcp --connect 127.0.0.1:7981
```
Confine the headless server with `--automation-read-root DIR --automation-write-root DIR`
(a root left out grants no access of that kind; an error with `--connect`) —
`docs/mcp.md:27-79`. Name the agent's edits with `--author "Claude (copyedit)"` and turn tracking
on explicitly with `review.trackChanges {"value": true}` (`docs/mcp.md:18-26`). Verify work with
`get_text`/`inspect_document` instead of screenshots wherever possible.

### Control channel example
```sh
wordcraft --control 7981 &
KEY=$(cat ~/Library/Application\ Support/WordCraft/control-key.local-7981)
printf '%s\n' \
 "{\"id\":1,\"key\":\"$KEY\",\"method\":\"engine.execute\",\"params\":{\"command\":\"text.insert\",\"params\":{\"text\":\"Hello\"}}}" \
 "{\"id\":2,\"key\":\"$KEY\",\"method\":\"ui.render\",\"params\":{\"path\":\"/tmp/page1.png\",\"page\":1}}" \
 | nc 127.0.0.1 7981
```
Each line gets one JSON reply; a failed command leaves the document unchanged
(`docs/control-protocol.md:7-14`). Limits: 1 MiB/line, 30 s to authenticate, key required on
every request.

### Core concepts
- **One document per window**; File (Backstage) holds New/Open/Save As/Export/Print and the
  Start screen (`crates/ui-egui/src/backstage.rs`).
- **Save vs export**: `file.save`/`file.saveAs` write the document's own format (.docx family,
  .odt, .rtf, .xml, .json keep everything — `crates/ui-egui/src/lib.rs:1792`); PDF/PNG/HTML/MD/
  TXT are copies that leave the document unsaved. AutoSave only works for the "keeps everything"
  extensions and a saved path; it is greyed out with a reason otherwise
  (`crates/ui-egui/src/chrome.rs:225-250`).
- **Print Markup** (`file.printMarkup` or `markup: true` on saves): tracked changes marked up,
  comments in balloons beside PDF/PNG pages, comment list at the end of HTML/MD/TXT copies.
- **Passwords**: `file.encrypt` sets/changes a save password on Word-package formats only;
  opening an encrypted file with the wrong/missing password returns a specific error
  (`io.rs:86-98`).
- **Logs**: a start from Finder has no terminal; `logs/wordcraft.log` is the bug-report artifact
  (`README.md:165-176`).
- **Version check**: this skill describes HEAD (0.7.0); the installed app is 0.6.1 and may lack
  commands added since — before relying on a specific command, confirm it exists with
  `wordcraft-cli commands --json` (or `engine.commands`).

## Working with an AI agent

Legitimate and useful:
- **Write and review documents headlessly** through `wordcraft-cli run`, `mcp`, or the control
  channel on a *copy*. Chained commands are the intended pattern:
  `select.text={"text":"Membership"}` → `format.bold` → `file.save`.
- **Prepare inputs**: generate `.md`/`.html`/`.txt`/`.rtf`/`.csv` (mail merge) and import them;
  batch-convert a folder with `wordcraft-cli convert` (loop per file).
- **Round-trip and verify**: `inspect` (JSON structure) and `text` for exact reads, `render`
  for a page image; check `file.info` (`pages`, `words`, `paragraphs`) after edits.
- **Track agent edits**: `--author` / `file.setAuthor` + `review.trackChanges {"value": true}`
  so a human can review them in WordCraft or Word.
- **Repair/transform native files**: the `.json` document model is serde-serialisable and open
  (`io.rs:122`); also repair by convert-to-docx. Confine file access with the automation roots.
- **Zotero workflows** via `wordcraft-cli zotero` when Zotero desktop is running.

Do **not**:
- Drive the GUI blind (scripted clicks/keys through `ui.*`) when a headless command does the job;
  it's slower and brittle. GUI state can't be assumed if you didn't start the app.
- Assume unsupported formats: no writing `.doc`, no encrypted `.doc`, no PDF import, no
  `.mht`, no Strict OOXML write, no SVG/TIFF pictures, no spreadsheet number formatting.
- Edit a file in place without a backup, or trust a silent export — see below.
- Promise Word-identical pagination or DOCX fidelity on files you haven't round-tripped.

## Verification protocol

Alpha-software discipline:
1. **Always work on a throwaway copy** (`cp -f` or `--automation-write-root` to a scratch dir);
   version files per session (`report.v1.docx`) and keep the original untouched until verified.
2. **Round-trip test before reporting success**: new/blank → edit → `file.save` to `.docx` →
   reopen it (new process, `wordcraft-cli inspect`/`text`) → export the deliverable (PDF/PNG) →
   inspect the files exist and are non-empty. Never trust a silent export: check exit status,
   stderr, and the output file.
3. **Compare against the source of truth** when fidelity matters: `wordcraft-cli text in.docx`
   vs `text out.docx`, `inspect` JSON diff, or render the page and look at the PNG.
4. **Update the app only between projects** (launcher auto-update; 0.6.1 installed vs 0.7.0
   HEAD — an update can change commands and output).
5. **When something breaks**: check `~/Library/Application Support/WordCraft/logs/wordcraft.log`
   (the previous run's log is kept as `wordcraft.1.log`), do not lose the document — report the
   command id, params, input file and log.

## Sources & evidence

- Repo: <https://github.com/storytold/wordcraft> · HEAD inspected:
  `fc41918814f62645b6746ed68e71e8c2c2e85d6f` ("Release 0.7.0", 2026-10-14) · date read: 2026-10-14.
- Key files: `README.md`, `ROADMAP.md`, `docs/gaps.md`, `docs/parity-checklist.md`,
  `docs/file-format-parity.md`, `docs/mcp.md`, `docs/control-protocol.md`, `docs/zotero.md`,
  `Cargo.toml`; `crates/engine/src/io.rs`, `io_ext.rs`, `cmd/mod.rs`, `cmd/file.rs`,
  `cmd/tools.rs`; `crates/docx/src/lib.rs`, `crypt.rs`; `crates/docbin/src/lib.rs`;
  `crates/formats/src/lib.rs`, `sheet.rs`; `crates/pdf/src/lib.rs`; `crates/mcp/src/tools.rs`;
  `apps/wordcraft-cli/src/main.rs`; `apps/wordcraft/src/main.rs`, `print.rs`;
  `apps/wordcraft-web/src/main.rs`; `/Applications/WordCraft.app/Contents/Info.plist` (0.6.1).
- Companion index of claims: `evidence.md` (same directory).
