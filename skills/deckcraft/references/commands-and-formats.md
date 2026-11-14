# DeckCraft reference: commands, control channel, MCP, shortcuts, formats, paths

All pointers are repo-relative to https://github.com/storytold/deckcraft at HEAD
`d78e657e4cb1e490ceb5445785c052d9cf5ad963` (0.7.0), inspected 2026-10-14. The installed app may
differ — verify against your installed version. The canonical live list is always
`deckcraft-cli commands [FILTER]` and `deckcraft-cli describe ID`.

## Command families

233 `cmd!` registrations are assembled by `command_specs()` (crates/engine/src/cmd/mod.rs:124-147);
each carries id, label, ribbon/menu path, shortcut, params doc and an enabled-reason. Families and
verified exemplar ids:

| Family | Module | Exemplar ids |
|---|---|---|
| File | crates/engine/src/cmd/file.rs:9-45 | `file.new`, `file.open`, `file.openBytes`, `file.save`, `file.saveAs`, `file.saveTemplate`, `file.saveBytes`, `file.export`, `file.info`, `file.render`, `file.close`, `file.properties`, `file.recovery.{save,list,open,discard}`, `file.revert`, `window.next` |
| Edit | crates/engine/src/cmd/edit.rs:13-22 | `edit.undo`, `edit.redo`, `edit.cut/copy/paste/pasteText`, `edit.duplicate`, `edit.delete`, `edit.selectAll`, `edit.deselect` |
| Slide | crates/engine/src/cmd/slide.rs:14-50 | `slide.new`, `slide.duplicate`, `slide.delete`, `slide.move`, `slide.go`, `slide.next/previous/first/last`, `slide.selectSlides`, `slide.hide`, `slide.layout`, `slide.reset`, `slide.notes`, `slide.rename`, `slide.fromOutline`, `section.*` |
| Insert | crates/engine/src/cmd/insert.rs:14-98 | `shape.insert`, `shape.presets`, `insert.textBox`, `insert.picture`, `insert.table`, `insert.chart`, `insert.audio`, `insert.video`, `insert.wordArt`, `insert.slideNumber`, `insert.dateTime`, `insert.symbol`, `insert.hyperlink`, `insert.smartArt`, `insert.actionButton`, `chart.type`, `chart.data`, `chart.options` |
| Shape Format | crates/engine/src/cmd/shape.rs:14+ | `shape.connect`, `shape.freeform`, `shape.sites`, `shape.move/resize/setBounds`, `shape.rotate/flip/adjust/change`, `shape.fill/line/effects`, `shape.rename`, `shape.altText`, `shape.visible`, `shape.inspect` |
| Merge | crates/engine/src/cmd/merge.rs:22-23 | `shape.merge` (`union|combine|fragment|intersect|subtract`) |
| Arrange | crates/engine/src/cmd/arrange.rs:12-54 | `arrange.bringToFront/bringForward/sendBackward/sendToBack`, `arrange.reorder`, `arrange.group/ungroup/regroup`, `arrange.align`, `arrange.distribute`, `arrange.rotateLeft/rotateRight`, `arrange.flipHorizontal/flipVertical`, `arrange.nudge` |
| Text | crates/engine/src/cmd/text.rs | `text.edit`, `text.insert`, `text.delete`, `text.move`, `text.select`, `text.selectAll/Word/Paragraph`, `text.get`, `text.commit`, `text.exit` |
| Format | crates/engine/src/cmd/format.rs:12-165 | `format.bold/italic/underline/strikethrough`, `format.case`, `format.color`, `format.size`, `format.grow/shrink`, `format.clear`, `format.spacing`, `format.alignLeft/Center/Right/Justify/align`, `format.bullets/numbering`, `format.indent/outdent`, `format.columns`, `format.autofit`, `format.anchor`, `format.wrap`, `format.margins`, `format.direction/rtl`, `format.highlight`, `format.textShadow`, `format.painter/painterApply`, `format.state` |
| Design | crates/engine/src/cmd/design.rs:17+ | `design.theme`, `design.themes`, `design.colors`, `design.fonts`, `design.background`, `design.hideBackgroundGraphics`, `design.headerFooter`, `design.slideSize` |
| Master | crates/engine/src/cmd/design.rs | `master.insertLayout`, `master.deleteLayout`, `master.insertPlaceholder`, `master.renameLayout`, `view.slideMaster`, `view.closeMaster` |
| Transitions | crates/engine/src/cmd/transition.rs:14-34 | `transition.set`, `transition.options`, `transition.timing`, `transition.applyAll`, `transition.list` |
| Animations | crates/engine/src/cmd/animation.rs:13-63 | `animation.set`, `animation.add`, `animation.remove`, `animation.move`, `animation.timing`, `animation.options`, `animation.clear`, `animation.painter/painterApply`, `animation.list`, `animation.get` |
| Table | crates/engine/src/cmd/table.rs:14+ | `table.insertRowBelow/Above`, `table.insertColumnLeft/Right`, `table.deleteRow/Column`, `table.merge`, `table.split`, `table.selectCells`, `table.rowHeight`, `table.columnWidth`, `table.distributeRows/Columns` |
| Review / Show | crates/engine/src/cmd/review.rs:13-40 | `comment.add/reply/delete/resolve/list`, `review.accessibility`, `review.spelling`, `show.fromStart`, `show.fromCurrent`, `show.setup`, `show.customShow` |
| Media | crates/engine/src/cmd/media.rs:13-38 | `media.play/pause/toggle/stop/seek/info`, `media.posterFrame`, `media.gifPlay` |
| Selection | crates/engine/src/cmd/selection.rs:10-24 | `selection.select`, `selection.showAll`, `selection.hideAll` |
| Inspect | crates/engine/src/cmd/inspect.rs:12-15 | `document.inspect`, `slide.inspect`, `shape.inspect`, `commands.list` |

UI-only commands (not in `command_specs`, run through the same `app.run` path; crates/ui-egui/src/lib.rs:136-179):
`view.normal/outline/sorter/notesPage/reading/notes/ruler/gridlines/guides/zoomIn/zoomOut/zoom/pane/tab/collapseRibbon/dark/grayscale`,
`show.start/show.presenter/show.end`, `app.home/backstage/closePresentation/print/about/palette/preferences/openDialog/insertPictureDialog/insertAudioDialog/insertVideoDialog/saveAsDialog/exportDialog/dialog/links`.

## Verified keyboard shortcuts (from command specs at HEAD)

| Shortcut | Command | Source |
|---|---|---|
| Cmd+N / Cmd+O / Cmd+S / Cmd+Shift+S | file.new / file.open / file.save / file.saveAs | crates/engine/src/cmd/file.rs:11-15 |
| Cmd+W / Cmd+` | file.close / window.next | crates/engine/src/cmd/file.rs:29,44 |
| Cmd+Shift+N | slide.new | crates/engine/src/cmd/slide.rs:14-21 |
| PageDown / PageUp / Home / End | slide.next / previous / first / last | crates/engine/src/cmd/slide.rs:27-30 |
| Cmd+Z / Cmd+Y | edit.undo / edit.redo | crates/engine/src/cmd/edit.rs:13-14 |
| Cmd+X / Cmd+C / Cmd+V / Cmd+Shift+V | edit.cut / copy / paste / pasteText | crates/engine/src/cmd/edit.rs:15-18 |
| Cmd+D / Delete / Escape / Cmd+A | edit.duplicate / delete / deselect / selectAll | crates/engine/src/cmd/edit.rs:19-22 |
| Cmd+B / Cmd+I / Cmd+U / Cmd+Shift+X | format.bold / italic / underline / strikethrough | crates/engine/src/cmd/format.rs:16-31 |
| Cmd+= / Cmd+Shift+= | format.subscript / superscript | crates/engine/src/cmd/format.rs:36-37 |
| Cmd+Shift+. / Cmd+Shift+, | format.grow / shrink | crates/engine/src/cmd/format.rs:40-41 |
| Shift+F3 / Cmd+Space | format.case / format.clear | crates/engine/src/cmd/format.rs:53-71 |
| Cmd+L / Cmd+E / Cmd+R / Cmd+J | align left / center / right / justify | crates/engine/src/cmd/format.rs:100-103 |
| Tab / Shift+Tab | format.indent / format.outdent | crates/engine/src/cmd/format.rs:122-123 |
| Cmd+Shift+C / Cmd+Shift+V | format.painter / painterApply | crates/engine/src/cmd/format.rs:164-165 |
| Cmd+Alt+G / Cmd+Alt+Shift+G / Cmd+Alt+J | arrange.group / ungroup / regroup | crates/engine/src/cmd/arrange.rs:25-27 |
| Cmd+Shift+] / Cmd+] / Cmd+[ / Cmd+Shift+[ | bringToFront / bringForward / sendBackward / sendToBack | crates/engine/src/cmd/arrange.rs:12-15 |
| Cmd+K | insert.hyperlink | crates/engine/src/cmd/insert.rs:52-60 |
| Cmd+Alt+M / F7 | comment.add / review.spelling | crates/engine/src/cmd/review.rs:13,19 |
| Cmd+Shift+Enter / Cmd+Enter | show.fromStart / show.fromCurrent | crates/engine/src/cmd/review.rs:20-21 |
| Alt+P / Alt+Shift+C | media.play / animation.painter | crates/engine/src/cmd/media.rs:13, crates/engine/src/cmd/animation.rs:52-61 |
| F5 | show.start (UI command) | crates/ui-egui/src/lib.rs:154 |
| Alt+F / Cmd+P / Cmd+Shift+P / Cmd+, / Cmd+F1 / Shift+F9 / Alt+F9 | app.backstage / app.print / app.palette / app.preferences / view.collapseRibbon / view.gridlines / view.guides | crates/ui-egui/src/lib.rs:158-166 |

Shortcut matching parses `Cmd+…`, `Shift+…`, `Alt+…` and bare keys like `Delete`/`F7`
(crates/engine/src/keys.rs:9-11, :306-312). Mac vs Windows/Linux differences for text keys are
handled by `Session::mac_keys` (docs/ui-parity.md:98-125).

## Control channel methods

From docs/control-protocol.md:13-31; dispatch in crates/ui-egui/src/control.rs:109-320. Transport:
newline-delimited JSON over TCP on 127.0.0.1 only (apps/deckcraft/src/control_server.rs:14-21).

| Method | Purpose |
|---|---|
| `engine.execute` / `ui.menu.invoke` / `command` | Run any command `{command, params}` |
| `engine.commands` | Every command with enabled state |
| `document.inspect` | Slides, sections, layouts, shapes, selection |
| `ui.inspect` | UI state, rects, dialog, slide-show state, perf |
| `ui.tool.select` | select / text / shape+preset / any preset / curve / freeform / scribble / pen / highlighter / eraser |
| `ui.pointer` | down/drag/up/move/doubleclick/tripleclick in slide points |
| `ui.key` / `ui.text` / `ui.ime` | Keyboard, text and IME input |
| `ui.move` / `ui.click` / `ui.drag` | Real egui pointer input (all widgets) |
| `ui.set` | tab/view/pane/notes/zoom/brightness/ruler/gridlines/guides |
| `ui.dialog.open` / `ui.dialog.close` | Dialogs by id, with pre-filled fields |
| `ui.screenshot` / `ui.render` | Window PNG / headless slide render |
| `ui.resize` / `ui.focus` | Window control |
| `show.start` / `show.end` | Slide show (`{from?, presenter?, reading?}`) |
| `app.open` / `app.save` / `app.export` / `app.quit` | Files |

## MCP tools

`deckcraft-cli mcp [--connect PORT] [--sample]` — JSON-RPC 2.0 over stdio (crates/mcp/src/lib.rs:3-14).
`list_commands`, `run_command`, `batch`, `new_presentation`, `open_presentation`,
`save_presentation`, `export`, `inspect_document`, `inspect_slide`, `render_slide`, `add_slide`,
`go_to_slide`, `add_shape`, `add_text_box`, `set_text`, `insert_picture`, `insert_table`,
`insert_chart`, `select`, `pointer`, `select_tool`, `key`, `type_text`, `screenshot` (app only),
`call_app` (app only) (crates/mcp/src/tools.rs:65-279).

New-presentation themes named by the tool: DeckCraft, Harbor, Ember, Meadow, Nocturne, Paper,
Coral Reef, Slate (crates/mcp/src/tools.rs:97).

## Save / export formats

`file.export` with `format: png|jpeg|pptx|deckcraft|outline|pdf` (crates/engine/src/cmd/file.rs:18);
with no `format`, the extension decides (`format_for_path`, crates/engine/src/cmd/file.rs:185-200 —
unknown extensions silently become native `.deckcraft`).

| Extension | Written as | Notes |
|---|---|---|
| `.deckcraft` (and unknown) | native zip | `mimetype` + `presentation.json` + `media/<id>` (crates/format/src/lib.rs:1-20) |
| `.pptx` / `.potx` / `.ppsx` | PPTX package | always a plain presentation content type (docs/gaps.md:87-93) |
| `.pdf` | PDF | layout `slides|notes|handouts`, `perPage` 1-9, `dpi` 36-600, `slides` list or range, `includeHidden`, `textLayer`, `frame` (crates/engine/src/cmd/file.rs:130-150) |
| `.png` / `.jpg` / `.jpeg` | raster | `scale` px/pt (default 2), JPEG quality 92; `slide` index or `all` (crates/engine/src/cmd/file.rs:276-307) |
| `.txt` / `.md` | outline text | titles unindented, body paragraphs tab-indented by level (crates/format/src/lib.rs:190-215) |

Read (open) formats: `.deckcraft`, `.slidecraft` (legacy), `.pptx`, `.potx`, `.ppsx`, `.txt`, `.md`
(crates/engine/src/cmd/file.rs:67-87).

## Paths (macOS) and environment

| Path / var | Meaning |
|---|---|
| `/Applications/DeckCraft.app` | GUI bundle (binary `Contents/MacOS/DeckCraft`; bundle id `ai.storyteller.deckcraft`) |
| `~/Library/Application Support/DeckCraft/ui.json`, `prefs.json` | UI/engine preferences (apps/deckcraft/src/main.rs:42-90) |
| `~/Library/Application Support/DeckCraft/logs/deckcraft.log` (+`.1`,`.2`) | log file, 16 MiB cap, `RUST_LOG` controls levels (README.md:125-141) |
| `~/Library/Application Support/DeckCraft/Recovery/<uid>.deckcraft` + `<uid>.json` | AutoRecover entries (crates/engine/src/recovery.rs:1-30) |
| `DECKCRAFT_CONTROL_PORT` | default control port (same as `--control`) |
| `DECKCRAFT_NO_PREFS` / `DECKCRAFT_NO_RECOVERY` / `DECKCRAFT_NO_AUDIO` | disable prefs, AutoRecover reopen, audio output |
| `RUST_LOG` | env_logger-style directives, e.g. `RUST_LOG=debug` |
| `WGPU_BACKEND` | Windows-only backend override for troubleshooting (README.md:178-191) |

CLI default control port for `deckcraft-cli app`: 7979 (crates/mcp/src/lib.rs:29).
