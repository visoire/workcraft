# MCP tools

The WorkCraft chat works on your files through MCP tools. The same tools are available to any other
MCP client, such as Claude Desktop or Claude Code, while WorkCraft runs.

Every tool is defined once, as a Zod schema in `TOOL_DEFS` in [`src/mcp/schemas.ts`](../src/mcp/schemas.ts).
That one definition feeds the backend MCP server, the browser orchestrator, the `/` commands in the
chat and the tool definitions sent to the models.

## The tools

All paths are project paths such as `/sheets/finances.xlsx`.

### GridCraft

| Tool | Arguments | Does |
| :--- | :--- | :--- |
| `read-sheet` | `path`, `sheet?`, `range?` (for example `A1:D20`) | reads calculated values as rows; formulas and dynamic arrays are evaluated |
| `write-sheet` | `path`, `sheet?`, `cells` (map such as `{"B1": "=SUM(B2:B9)"}`), `mode` (`merge` or `replace`) | writes values or formulas, creates the file if needed |

### WordCraft

| Tool | Arguments | Does |
| :--- | :--- | :--- |
| `read-document` | `path` | reads `.docx`, `.md`, `.txt` or the text of `.odt` as Markdown |
| `write-document` | `path`, `markdown`, `mode` (`replace` or `append`), `title?` | writes Markdown as `.docx` or `.md` (headings, lists, tables, bold, italic) |

### DeckCraft

| Tool | Arguments | Does |
| :--- | :--- | :--- |
| `read-slides` | `path` | reads the texts of all slides of a `.pptx` |
| `create-slide` | `path`, `title?`, `slides` (1 to 30, each with `title`, `bullets`, `notes?`), `mode` (`append` or `replace`) | creates slides in a `.pptx` |

### PdfCraft

| Tool | Arguments | Does |
| :--- | :--- | :--- |
| `read-pdf` | `path`, `pages?` (for example `1-3,5`) | reads the text of a PDF |
| `sign-pdf` | `path`, `name`, `page?`, `position` (`unten-rechts`, `unten-links`, `oben-rechts`), `output?` | places a visible signature block and saves a signed copy. **Needs approval.** |
| `images-to-pdf` | `images` (1 to 60 paths), `output`, `title?` | combines images and scans into one PDF, one image per page |

`sign-pdf` adds a visible signature block (name, date, line), not a cryptographic signature.

### Project and code

| Tool | Arguments | Does |
| :--- | :--- | :--- |
| `list-files` | `dir` | lists files and folders |
| `search-files` | `query`, `dir` | searches text in text and code files |
| `read-file` | `path` | reads a text or code file |
| `write-file` | `path`, `content` | writes a text or code file and creates folders |
| `search-project` | `query`, `mode` (`hybrid`, `text`, `semantic`), `limit` | full-text and semantic search across documents, sheets, slides, PDFs, code and chats |
| `remember` | `note` | keeps a note in the project memory |
| `file-history` | `path` | versions of a file and which tool step wrote it from which inputs |

### Terminal and panels

| Tool | Arguments | Does |
| :--- | :--- | :--- |
| `run-command` | `command`, `cwd` | runs a shell command in the project folder (60 s limit). **Needs approval.** |
| `open-panel` | `app`, `path?` | opens a panel and optionally a file in it (runs in the browser) |
| `panel-status` | `app` | open file, loaded, minimized, unsaved changes (runs in the browser) |
| `list-craft-apps` | `type?`, `ecosystem?`, `origin?`, `available?`, `app?` | the 44 apps (ArtCraft, community, independent): kind, origin, licence, ecosystems, version, web build status; names the active ecosystem and the ecosystem ids. `type` and `app` add the file types opened and imported; an app without a build comes with the command that gets one (runs in the browser). Each app also carries `ai_access`: tools through the desktop app (with the tool count), desktop app found but not connected (with the reason) or switched off, or project files only (runs in the browser) |
| `open-in-app` | `app`, `path?` | opens a project file in any app that reads its type and has a web build here; otherwise the answer names the apps that do and how to get this one (runs in the browser) |
| `recent-files` | `limit?` | the files opened last in this project, newest first, with the app of each (runs in the browser) |

### Skills and cloud

| Tool | Arguments | Does |
| :--- | :--- | :--- |
| `list-skills` | none | lists the installed skills (name, what each is for) |
| `read-skill` | `name`, `file?` | reads `SKILL.md` of a skill, or a file under it such as `references/commands.md` |
| `cloud-list` | `folder?`, `query?`, `limit?` | lists files in the connected Google Drive, Google Docs, Sheets and Slides included |
| `cloud-import` | `id`, `to?` | copies a Drive file into the project; Docs, Sheets and Slides become .docx, .xlsx and .pptx |
| `cloud-export` | `path`, `folder?`, `convert?` | uploads a project file to Drive, optionally as a native Google file. **Needs approval.** |

Plugins add their own tools with the prefix `ext-<server>-`. The 19 Craft apps that ship a CLI with an `mcp` command, when found on the
computer (WordCraft, GridCraft, DeckCraft, PdfCraft, PhotoCraft, VectorCraft, LightCraft, DesignCraft, FilmCraft, EffectCraft,
SoundCraft, CADCraft, FigCraft, MailCraft, TextureCraft, MaterialCraft, SolidCraft, AniCraft, Craft Anything)
are connected the same way under their own name, for example `ext-photocraft-<tool>`; their approval rule is set in Settings,
Craft apps (default: reads run, changes ask). The server name keeps letters and digits only, so Craft Anything is
`ext-craftanything-<tool>`. The independent apps have no MCP server; the AI reaches their files through the
project tools.

### How the CLIs are started

| App | Without its window (headless) | With its window (`--control <port>`) |
| :--- | :--- | :--- |
| WordCraft, GridCraft, DeckCraft, DesignCraft | `<app>-cli mcp` | `mcp --connect <port>` (WordCraft only with its key file) |
| SoundCraft | `mcp --demo` | `mcp --connect <port>` |
| PdfCraft | `mcp --compact` | none |
| PhotoCraft, FigCraft | `mcp --automation-read-root ~ --automation-write-root ~` | FigCraft: `mcp --attach <port>` |
| VectorCraft, LightCraft, CADCraft | `mcp --headless` (VectorCraft), `mcp --compact` (LightCraft) | `mcp --connect 127.0.0.1:<port>` |
| FilmCraft, EffectCraft | `mcp` | `mcp --bridge 127.0.0.1:<port>` (FilmCraft), `mcp --bridge <port>` (EffectCraft) |
| MailCraft | `mcp` (an empty mailbox) | `mcp --connect 127.0.0.1:7991` |
| TextureCraft, MaterialCraft | `mcp --automation-read-root ~ --automation-write-root ~` | `mcp --bridge <port>` (7992, 7993) |
| SolidCraft | `mcp --headless` | `mcp --connect 127.0.0.1:7994` |
| AniCraft | `mcp` | none |
| Craft Anything | `mcp --restricted` (machine-acting tools off) | none |

The control ports are the defaults of `src/server/craft.ts`; a key file written by a running app (`control-key.local-<port>`) wins.
MailCraft, TextureCraft, MaterialCraft, SolidCraft, AniCraft and Craft Anything follow the flags in their own `apps/<app>-cli` sources; none was run live from here.

## Reliability of external servers

- **Paging.** `tools/list` is followed through its cursor (20 pages at most), so a server with dozens of tools is complete.
- **Retry.** A server that fails to start (an app that is not running yet, a missing CLI) is tried again on later syncs after 15 s,
  30 s, 60 s, 120 s, up to 5 minutes; a changed configuration is tried at once. `GET /api/mcp/external` and the Settings list show
  `attempts` and `retry_in_s`.
- **Lost connection.** When a call fails because the process or pipe is gone (closed, `EPIPE`, `ECONNRESET`, `ECONNREFUSED`,
  `ENOENT`), WorkCraft connects the server once more and repeats the call once. A tool that merely fails is never repeated.
- **One run at a time.** Overlapping syncs share a single run, so two requests never start the same server twice.
- **Limits.** Results over 200,000 characters are cut; one call may run 120 s; at most 120 tools go into one request (providers
  cap at 128), the rest is found with `find-tools`.

## Which tools the model sees

The model is not sent every tool in every request: the definitions are the biggest fixed cost of a tool loop. WorkCraft's own
tools are always listed, except the cloud tools, which come with words like drive, cloud or sync. The tools of other MCP servers
(the Craft apps) are listed when the question names the app (also written with spaces, as in "craft anything") or a file type it opens
(read from `src/ecosystems/catalog.json`), uses a word from the tool's name, or the tool was used earlier in the chat. At most 120
tools are sent in one request: workspace tools, tools used before and the forced tool stay, the rest fill up in name order. One more tool, `find-tools` (it exists only in the chat, not on the MCP server), is offered while
something is withheld: the model calls it with a few words and the matching tools are in the next request. The set only grows
within a chat and is sorted, so provider caches keep working. See [AI-TOKENS.md](AI-TOKENS.md).

## Using the tools in the chat

- Type `/` to list every tool and command. A tool picked with `/` is forced for that message.
- With complete arguments, a tool runs directly without a model:
  `/read-sheet @finances.xlsx range=A1:E6`.
- Type `@` to attach files, folders or panels. Mentioning an app, such as `@gridcraft`, points the
  model at that app's tools.

What happens with each call:

1. **Repair.** Tool JSON with Markdown fences, single quotes, trailing commas or a cut-off end goes
   through a repair pass first (`src/core/json-repair.ts`).
2. **Validate.** The arguments are checked against the Zod schema. Invalid arguments go back to the
   model once as a structured error, without running anything ("self-correction").
3. **Approve.** `run-command`, `sign-pdf` and tools of external servers that need it wait for your
   confirmation. The backend checks a single-use token, so no client can skip the dialog.
4. **Run.** Reads run in parallel. Writes to the same file wait in line (`src/mcp/locks.ts`).
5. **Show.** The tool card in the chat shows the arguments, the duration and a preview of the result.
   Panels showing the changed file reload it in place.

If a step still fails, the chain pauses with **Retry**, **Edit**, **Report the error to the AI** and
**Cancel**.

## Using the tools from another MCP client

While WorkCraft runs, it serves every tool at `http://localhost:5175/mcp` over Streamable HTTP.

```sh
claude mcp add --transport http workcraft http://localhost:5175/mcp
```

Requests from the same computer need nothing else. Requests from another device on your network need
the access token (the `x-oc-token` header), like the REST API. Approval tools still ask for
confirmation in WorkCraft.

The apps also ship their own command-line tools with MCP servers, independent of WorkCraft:

```sh
claude mcp add wordcraft -- wordcraft-cli mcp
claude mcp add gridcraft -- gridcraft-cli mcp
```

## Adding a tool

1. Add one `def({...})` entry to `TOOL_DEFS` in `src/mcp/schemas.ts`:
   - `name`: kebab-case, verb first (`read-sheet`);
   - `title` and an English `description`;
   - `app` and `side` (`server` or `client`);
   - a Zod `input` object;
   - `pathArg` for the file it edits, `writes: true` if panels should refresh, `approval: true` if it
     changes things outside the project.
2. **Append it. Never reorder existing tools:** the tool list goes to the models in a fixed order so
   the provider's prompt cache keeps hitting.
3. Implement it in `src/server/tools.ts` (server side) or the panel server (client side).
4. Add a test in `tests/server/` and a line to `src/docs/content.md` and to this file.

Provider differences are handled for you: `compileToolSchema` produces strict JSON Schema for OpenAI
and Claude and `functionDeclarations` for Gemini, and `normalizeToolArgs` maps the arguments back
before validation.
