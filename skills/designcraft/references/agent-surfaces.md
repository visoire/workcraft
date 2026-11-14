# DesignCraft agent surfaces at a glance

All paths are repo-relative to https://github.com/storytold/designcraft.

## 1. CLI (`designcraft-cli`)

Source: `apps/designcraft-cli/src/main.rs` (usage block lines 38–39, behaviors below).
Not inside the macOS `.app` — install the separate `designcraft-cli-<ver>-macos-<arch>.zip`
release asset or build `cargo build --release -p designcraft-cli` (`docs/mcp.md`).

```text
designcraft-cli run [--in FILE | --sample] [--cmd ID[=JSON]]... [--page N] [--scale S]
                    [--pdf-options JSON] [--export OUT] [--all-pages DIR]
designcraft-cli commands [FILTER]        # all commands as JSON
designcraft-cli describe COMMAND         # label, menu, shortcut, params for one command
designcraft-cli script [FILE|-] [--in FILE | --sample] [--connect PORT]
                       [--save OUT] [--export OUT] [--keep-going]
designcraft-cli app [--port PORT] COMMAND [JSON]
designcraft-cli app [--port PORT] --method METHOD [JSON]
designcraft-cli mcp [--connect PORT] [--sample]
designcraft-cli perf [--pages N] ... [--strict]
designcraft-cli bench FILE [--runs N]
designcraft-cli validate-pdf FILE.pdf    # built-in PDF/X-4 checks
designcraft-cli links
designcraft-cli --version
```

- `run`: `--page`, `--scale`, `--pdf-options` apply to the exports that follow; `.jpg` → JPEG,
  other raster → PNG, `.designcraft` → native save, `.idml` → IDML, `.pdf` → PDF, `.epub` → EPUB.
  `--cmd id={"json"}` runs commands with `$N.path` result references; results print as JSON.
- `app` defaults to port 7979 (`--port`/`--connect`).
- Exit status is non-zero on failure; `script --keep-going` records errors per step instead.
- `perf`/`bench` measure budgets on a synthetic stress document or a real file
  (`apps/designcraft-cli/src/perf.rs`).

## 2. Script syntax (`designcraft-cli script`)

Source: `apps/designcraft-cli/src/main.rs` `SCRIPT_HELP`; `crates/engine/src/script.rs`;
`docs/agents.md`.

```text
command.id {"param": 1}            # one step per line; also command.id={json} or bare id
{"command": "command.id", "params": {...}}    # JSON-lines form, or a JSON array
# comment / // comment             # blank lines skipped; UTF-8 ± BOM; LF or CRLF
```

- `"$N.path"` = value at `path` of step N's result (0-based; comments/blank lines are not
  steps); `"$last.path"` = previous step; `"${N.path}"` interpolates inside a longer string.
- Text parameters: `\n` = new paragraph, `\u2028` = forced line break, `\t` = tab.
- Result: `{"completed": n, "results": [...]}`, plus `failedIndex`/`failedCommand`/`error` on
  failure; `--keep-going` converts failures to `{"error": ...}` results.
- MCP `batch` accepts the same script text or `commands: [{command, params}]`.

## 3. MCP tools (`designcraft-cli mcp`)

Source: `crates/mcp` (`tools.rs`, `server.rs`, `headless.rs`, `backend.rs`); `docs/mcp.md`.
Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout (`2025-06-18`, also `2025-03-26`,
`2024-11-05`); logs on stderr.

- Headless: in-process `designcraft_engine::Session`, starts with an empty Letter document;
  `--sample` opens the sample magazine.
- Connected: `--connect PORT` (or `HOST:PORT`) proxies to the running app; window tools
  (`screenshot`, `click`, `drag`, `menu_list`, `ui_inspect`, `ui_set`, `dialog_*`) return an
  error in headless mode (`docs/mcp.md` “Modes”).

| Tool | Purpose |
|---|---|
| `list_commands` | every command (id, label, menu, shortcut, params, enabled), with filter |
| `execute` | run any command `{command, params}` |
| `batch` | ordered commands or script text; stops at first error (`failedIndex`) |
| `inspect_document` | pages, spreads, items, stories (overset), layers, styles, swatches, selection |
| `get_story` / `set_story_text` | read a story (text, frames, paragraphs, lines, overset) / replace its text |
| `new_document` | `file.new` presets or `sample: true` |
| `open_document` / `save_document` | native `.designcraft` files |
| `place_image` | image from path or base64 into a frame or a new one |
| `render_page` / `export_png` | page → image content / file (JPEG by extension) |
| `screenshot` | whole window (connected only) |
| `select_tool`, `pointer`, `key`, `type_text` | tools and input events |
| `click`, `drag`, `menu_list`, `ui_inspect`, `ui_set`, `dialog_set/confirm/cancel` | connected only |

Resources: `designcraft://document`, `designcraft://commands` (`docs/mcp.md`).

## 4. Control channel (`designcraft --control PORT`)

Source: `apps/designcraft/src/control_server.rs`; `crates/ui-egui/src/control.rs`;
`docs/control-protocol.md`. JSON lines on `127.0.0.1`; one request/one reply per line.
Rules that matter: only requests are read; bad lines get one error reply and close the
connection; max 16 connections; no authentication (enable only while in use); the web build
has no control channel.

| Method | Params / purpose |
|---|---|
| `engine.execute` / `ui.menu.invoke` | `{command, params}`; `ui.menu.invoke` without params acts like choosing the menu item (opens dialogs) |
| `engine.commands` | full command list |
| `document.inspect` | pages, spreads, items, stories (overset), styles, swatches, selection |
| `ui.inspect` | tool, UI state, view, canvas rect, perf |
| `ui.menu.list` / `ui.tool.list` / `ui.tool.select` | menus / tools |
| `ui.pointer` | `{events:[{kind: down\|drag\|up\|move\|doubleclick, x, y, space?, clicks?}], mods?}` through the active tool |
| `ui.key` / `ui.text` | synthetic keyboard input / typing |
| `ui.move` / `ui.click` / `ui.drag` | real egui pointer input (reaches widgets/menus) |
| `ui.set` | brightness, panel, rulers, guides, frameEdges, baselineGrid, textThreads, screenMode, zoom, page, fit |
| `ui.dialog.open` / `.set` / `.confirm` / `.cancel` | fill and close dialogs by id |
| `ui.screenshot` / `ui.render` | window PNG / headless page render (PNG or base64) |
| `app.open` / `app.save` / `app.export` | files (export = PNG) |
| `app.quit` | quits without asking; the ⌘Q command asks |

Notes: default shortcuts owned by the macOS native menu (incl. Command-Z) are skipped by the
egui shortcut handler; after a drag wait for both the expected document state and
`document.inspect.canUndo` before testing undo; `ui.key` does not synthesize Cocoa menu events —
use `ui.menu.invoke` to test a menu command (`docs/control-protocol.md`).

Headless window screenshots with no visible window:
`cargo run -p designcraft-ui-egui --example ui_shot -- script.jsonl`
(`crates/ui-egui/examples/ui_shot.rs`; documented in `docs/control-protocol.md`).

## 5. Coordinates and text offsets

- Points (1/72 in), y down, spread space; page indices for `render_page`/`export_png` are
  0-based; commands that create items take `spread` (body index or
  `{"kind":"parent","index":0}`) (`docs/mcp.md`).
- Story text positions are UTF-8 byte offsets (é = 2 bytes; `は` = 3): `anchor`/`focus`,
  `start`/`end`, `pos`, story `length`, overset position; an offset inside a character snaps to
  its start (`docs/mcp.md` “Text offsets”).

## 6. Sample commands that create content

| Command | Params (from the command registry) |
|---|---|
| `file.new` | `{preset?, width?, height?, pages?, facingPages?, columns?, gutter?, margins?, bleed?, title?}` |
| `file.newSample` | `{}` — multi-page magazine (`crates/engine/src/sample.rs`) |
| `frame.create` | `{rect: [x0,y0,x1,y1], content: "text"\|…, text?, spread?}` |
| `text.thread` | `{from?, to?, rect?, spread?, autoflow?}` → `{story, from, to, overset, pagesAdded}` |
| `text.unthread` / `text.removeFromThread` | `{frame?, side?}` / `{frame?}` |
| `file.place` | `{path\|base64, name?, frame?, spread?, x?, y?, width?, pdfPage?, pdfCrop?, layoutPage?}` — text files and `.xlsx` flow into frames/tables |
| `file.exportPdf` | `{path?, pages?, flatten?, spreads?, bleed?, marks?, standard?: "none"\|"x4"\|"a2b", tagged?, …}` → `{path, bytes, pages, warnings}` |
| `file.exportEpub` / `file.exportFixedEpub` | `{path?, title?, author?, language?, cover?}` |
| `file.exportIdml` | `{path?, embedImages?}` |
| `data.source.select` → `data.merge` | link CSV/TSV/xlsx, then merge into a new document (`docs/agents.md`) |

Ground truth for params: `designcraft-cli describe <command-id>` — the `params` field is the
command's own documentation string (`crates/engine/src/cmd/mod.rs` `CommandSpec.params`).
