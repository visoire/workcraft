# Architecture

How WorkCraft is put together: what runs in your browser, what runs on your computer, how the
two talk, and where your data ends up. For the file-by-file map, see [AGENTS.md](../AGENTS.md).

## Two halves

WorkCraft has two parts that always run on the same machine (or on your home network):

| Part | Runs in | Built with | Does |
| :--- | :--- | :--- | :--- |
| **Frontend** | your browser | strict TypeScript, Vite | the workspace, the four apps as WebAssembly panels, the code editor, the chat, the MCP orchestrator |
| **Backend** | Node.js 20+ on your computer | TypeScript, Hono | files and projects, the terminal, the AI router, the MCP server and the MCP client (your servers, plugins and the Craft apps), skills, cloud sync, search, memory, snapshots, the audit log |

The apps (44 in the catalog: WordCraft, GridCraft, DeckCraft and PdfCraft ship with the repository, the others are added with `npm run apps:import` or
`npm run apps:fetch`, the 25 independent apps only when a web build exists) are compiled from Rust to WebAssembly and
run entirely in the browser. They draw with WebGPU when the browser offers it and fall back to WebGL2
otherwise. Your documents are never processed on a server.

The backend listens on `127.0.0.1` only. It exists for the things a browser cannot do safely on its
own: read and write a project folder, run a shell, keep API keys out of the page, and talk to
AI providers, the Craft apps and the cloud services you connect.

```
Browser                                              Your computer
+-------------------------------------------+        +--------------------------------+
| app/   workspace shell (src/app)          |  REST  | src/server/  Hono on 127.0.0.1 |
|  - panels: WordCraft GridCraft DeckCraft  |<------>|  files, projects,              |
|            PdfCraft (WebAssembly iframes) |  SSE   |  terminal, AI router,          |
|  - code editor, terminal, settings        |  WS    |  MCP server (/mcp), search,    |
|  - chat, Full Chat Mode, Team Mode        |  MCP   |  memory, snapshots, audit      |
|  - MCP orchestrator (src/mcp)             |        |            |                   |
+-------------------------------------------+        |            v                   |
                                                     |  ~/workcraft (your files)      |
                                                     +--------------------------------+
```

## Channels

| Channel | Path | Carries |
| :--- | :--- | :--- |
| REST | `/api/*` | files, projects, settings, chats, layout, search, usage, trash, snapshots |
| Server-Sent Events | `/api/ai/chat` | streamed tokens, reasoning and tool calls from the AI router |
| WebSocket | `/ws` | live file events for panel sync, terminal input and output, tool activity |
| MCP (Streamable HTTP) | `/mcp` | every project tool, for the built-in chat and for external MCP clients |

In development, Vite serves the frontend on port 5175 and forwards `/api`, `/mcp` and `/ws` to the
backend on port 5176. In production (`npm start`) the backend serves everything on port 5175.

## What happens when you ask the AI to do something

1. You type a prompt in the chat, maybe with `@finances.xlsx` or `/read-sheet`.
2. The chat (`src/chat/agent.ts`) builds the request: system prompt, tool schemas sorted by name, the
   project context, the history, then your message. This order keeps the provider's prompt cache warm.
3. The backend's AI router (`src/server/ai.ts`) sends it to the provider you picked, through a native
   adapter (`src/chat/adapters/`), and streams the answer back over SSE.
4. When the model calls a tool, the MCP orchestrator (`src/mcp/orchestrator.ts`) validates the
   arguments with the tool's Zod schema, asks for your approval if the tool needs it, and calls the
   backend's MCP server or the browser's panel server.
5. The tool writes the file into the project. The backend announces the change over the WebSocket,
   and every open panel showing that file loads the new version without restarting the app.
6. Before the first write of an answer, the backend takes a snapshot, so **Undo changes** under the
   answer can restore every file at once.

## Where data lives

The backend owns `~/workcraft` (on Windows `C:\Users\<name>\workcraft`; change it with
`WORKCRAFT_HOME`).

| Path | Content |
| :--- | :--- |
| `projects/<id>/` | the files of each project |
| `<project>/.workcraft/` | chats, layout, memory, search index, snapshots, object store, project graph |
| `config.json` | settings, API keys, agents and teams, cloud account tokens (file mode `0600` on macOS and Linux) |
| `skills/` | your own skills (the 13 Craft skills ship with the application in `skills/`) |
| `audit.jsonl` | one line per outgoing request, metadata only |
| `usage.json`, `metrics.json` | token numbers and optional performance metrics |
| `.trash/` | deleted projects and files, kept for 30 days |
| `plugins/` | plugins that add MCP servers |

None of this is ever part of the repository.

### API keys

- **Desktop with the backend running:** keys are stored by the backend in `config.json`. The page only
  ever receives a masked hint such as `...a1b2`, so a script in the page cannot read a key. A key
  leaves the computer only inside a request to the provider it belongs to.
- **Browser mode (iPad without a desktop):** there is no protected key store. Keys stay in memory
  until a reload. Keeping them in the browser's `localStorage` is an explicit opt-in, shown with a
  warning that anything with access to the browser profile can read them.

## Craft apps, skills and the cloud

- **Craft apps.** `src/server/craft.ts` finds the 19 Craft apps that ship a CLI and connects `<app>-cli mcp` as MCP servers named
  `ext-<app>-<tool>` (a live window when the app runs with `--control`). The approval rule defaults to reading
  freely and asking before changes. `src/server/mcp.ts` pages through `tools/list`, retries a failed server with a growing delay,
  reconnects once when a call finds the connection gone, and lets overlapping syncs share one run (see [MCP-TOOLS.md](MCP-TOOLS.md)).
  `src/chat/economy.ts` decides which of these tools a request carries (the file types come from the catalog, at most 120 tools).
  The apps of the workspace in use are reported to the backend (`PUT /api/craft { workspace }`, `config.craft.workspace`) and
  their servers are on unless you switched them off. `healthCheck()` pings every connected server every 45 s, replaces a dead
  one and picks up a new live window; `POST /api/craft/reconnect` is the Reconnect button. `/api/craft` reports per app why it
  is not connected, when the next try happens and how many tools it offers.
- **Specialists.** `src/chat/app-roles.ts` generates one team specialist per catalog app; the tools of a Craft app belong to its
  specialist (`toolAllowed`), see [AI-SUPPORT-REFERENCE.md](AI-SUPPORT-REFERENCE.md).
- **Skills.** `src/server/skills.ts` scans `~/workcraft/skills`, `~/.agents/skills`, `~/.claude/skills` and the bundled
  `skills/`; the prompt carries a one-line index and `read-skill` returns the rest.
- **Cloud.** `src/server/cloud.ts` binds a project to Google Drive, iCloud Drive or a synced folder. Each is a
  `SyncAdapter` of the three-way sync in `src/core/sync.ts` (the same one that syncs two desktops). The local copy
  stays; Google Drive uses your own OAuth client and is blocked in Local-only mode. A project that lives in the cloud can be opened
  on another computer (`POST /api/cloud/remote`, `/api/cloud/open`). Browser mode serves the same routes inside the browser
  (`src/app/cloud-browser.ts`, see Browser mode below).
- **Release check.** `src/server/apicraft.ts` is the release logic of apicraft ported function by function; it asks
  GitHub directly and treats an alpha build as a pre-release. `npm run versions` (`scripts/check-versions.mjs`) uses the same
  code to compare the `versions/` folder and the newest GitHub release of every app of the catalog.

## Browser mode

When `/api/health` does not answer, `src/app/offline.ts` serves the same `/api` paths from IndexedDB:
projects, files, chats, layout and settings. Files of 128 KB and more go to the Origin Private File System
through a worker (`src/ipados/opfs.ts`); IndexedDB keeps the metadata and a blob id. The four apps, the
chat (with your own key), file import and export and the Apple Pencil in PdfCraft keep working. The
terminal and the office tools of the AI need the desktop. The Status page shows **Browser mode**, and a
notice offers to switch back as soon as the desktop is reachable.

**Cloud in browser mode** (`src/app/cloud-browser.ts`): the `/api/cloud` routes are answered inside the browser, so the Settings page is the
same. Google Drive is signed in from the browser (OAuth 2.0 for client-side web apps with your own "Web application" client; the
landing page is `public/oauth-callback.html` and `.js`; the token lives in `localStorage` for about an hour), and a folder of the computer
(File System Access API, Chrome and Edge) can be the cloud side for iCloud Drive, OneDrive or Dropbox folders. Both are `SyncAdapter`s of
`src/core/sync.ts` against the active project of the browser. `installBrowserCloud` syncs a few seconds after a change and every five
minutes. Tested without a browser in `tests/server/cloud-browser.test.ts` (in-memory folder handles, no network).

## Ecosystems and shared storage

The 44 apps are not forced into one workspace. `src/ecosystems/` groups them (ten built in: Office & Documents, Notes, Text &
Maths, Imaging & Photography, Paint & Pixel Art, Video, Motion & Audio, Music Production, Design, UI & Publishing, 3D, CAD &
Materials, 3D Sculpt & Characters, Explore & Build; and workspaces you create) from one data file, `catalog.json`, which also
says who makes each app (`origin`: ArtCraft, community, independent), its licence and how a web build is obtained (`channel`);
the active ecosystem decides the rail, the launcher and where a double click opens a file (`toolForPath`), and stores nothing in a project.

```
 catalog.json --> catalog.ts (pure) --> registry.ts (TOOLS for all 44, AVAILABLE) --> rail, launcher, Open with
 public/releases.json (4 office apps) ----^   describe.ts (pure) -----------------> MCP: list-craft-apps, open-in-app
 public/web-builds.json (apps:import / fetch) --^                                                 recent-files
 versions/ (flat: source trees, web builds, zips) --> npm run versions, apps:import
 engine page --playgroundFiles--> bridge (src/storage) --> project files (desktop REST | IndexedDB + OPFS)
```

- **Storage is the project.** One file opens in every app that reads its type. Engines that call `playgroundFiles`
  (the independent apps' browser-storage contract) are bridged to project files; `browser:/a/b` means `/a/b`.
- **Web builds are data.** An app without a build stays listed and says so; a build that arrives later needs no code.
- **Recent files** are paths in `localStorage`, shown in the launcher and read by the AI.

See [ECOSYSTEMS.md](ECOSYSTEMS.md) for the details, the update steps and what is verified.
## iPadOS layer

`src/ipados/` sits between the workspace and the embedded engines. It decides by what an engine does,
never by its version number, so a new engine release drops in through `public/releases.json` without a
change to the layer.

```
 engine page (iframe)                          workspace
 public/craft-frame.js  ── workcraft:* ──►  src/ipados/adapter.ts   (one per engine panel)
   viewport, pixel ratio, Retina fit,         capability manifest, pointer bridge, signals,
   gesture lock, resource meter, signals      sharpness check, engine report
                                              src/ipados/index.ts   (one per workspace)
                                                capabilities and plan, memory governor,
                                                OPFS storage, isolation on demand, pen calibration
```

- **Capability probe and plan** (`capabilities.ts`): mode (desktop, hybrid, standalone), storage (REST, OPFS,
  IndexedDB), renderer (WebGPU, WebGL2), isolation and the list of degradations, from an injectable environment.
- **Register** (`compat.ts`): every measure with its id, layer, problem and fix, and the engine capability
  manifest. `docs/IPADOS-COMPAT.md` is the readable form; a test keeps both and `craft-frame.js` in step.
- **Memory governor** (`memory.ts`, on every device): adds up the resource meter of all panels and watches how late a
  timer fires (`LagMonitor`); when memory is high or the page stays slow it unloads, or in ask mode offers to unload, hidden, saved
  panels, least recently shown first. A panel with unsaved changes is only offered, never freed silently. Every action leaves a line
  with its reason; a top bar chip and Settings, Memory and GPU show it. See [IPADOS-COMPAT.md](IPADOS-COMPAT.md), "Memory governor".
- **HTTPS for the home network** (`src/server/tls.ts`): an mkcert certificate gives the iPad a secure
  context, which WebGPU, the service worker and OPFS need.

See [IPADOS-COMPAT.md](IPADOS-COMPAT.md) for the engine contract and the steps for a new engine release.

## Nothing from a CDN

Every byte WorkCraft loads comes from your own computer:

- fonts (Inter and DM Mono) are bundled from npm (`@fontsource`);
- icons are inline SVGs from `src/app/icons.js`;
- the four apps, their workers and their WebAssembly modules are served from `versions/v9-10/web/`;
- the DeepSeek tokenizer data is `public/assets/tokenizers/deepseek-v4.bin`;
- the service worker (`public/sw.js`) caches WorkCraft and the apps for offline use.

There are no third-party scripts. Local-only mode (Settings, Privacy) adds a strict `connect-src`
policy on top, so the page cannot reach any cloud host.

## Security boundaries

- The backend rejects foreign `Host` headers (DNS rebinding) and foreign `Origin` headers.
- Every path is resolved inside the project folder; ZIP imports are checked for path traversal.
- `run-command` and `sign-pdf` need a confirmation per call, checked by the backend with a
  single-use token.
- External MCP servers and plugins run in a sandbox (clean environment, own folder, and for `strict`
  the Node permission model) with an approval rule per server.
- Home network mode is opt-in. Every device except the desktop itself needs the access token.

See [SECURITY.md](../SECURITY.md) for how to report a problem.

## Release data and the apps

`public/releases.json` is the single source of the app versions, dates and file sizes. The build, the
dev server and WorkCraft's app registry read it (`__OC_RELEASES__`); `tests/server/releases.test.ts`
checks the README and the service worker against it. `scripts/patch-apps.mjs` applies startup fixes
listed under `patches` in that file (none at the moment; DeckCraft 0.9.0 needed one,
[storytold/deckcraft#959](https://github.com/storytold/deckcraft/issues/959)); a `.wasm` file stays
byte for byte upstream.

| App | Version | Formats |
| :--- | :--- | :--- |
| WordCraft | 0.15.2 | `.docx`, `.odt`, `.md` and more |
| GridCraft | 0.16.1 | `.xlsx`, `.csv`, dynamic arrays |
| DeckCraft | 0.15.1 | `.pptx`, vector morph |
| PdfCraft | 0.18.2 | `.pdf`: deep zoom, local signing, redaction |

## Upstream engine separation and licensing

WorkCraft maintains a clear architectural and legal boundary between the workspace and the embedded engines:
- **WorkCraft:** The workspace shell, window manager, project tree, local companion server (Hono on 127.0.0.1), and MCP orchestration layer are developed as open-source software under `MIT OR Apache-2.0`.
- **Embedded Crafting Engines:** WordCraft, GridCraft, DeckCraft, and PdfCraft are independent open-source engines developed by storytold and the ArtCraft team ([github.com/storytold](https://github.com/storytold)) under `MIT OR Apache-2.0`.
- **Preservation of Notices:** All upstream copyright notices and license files remain intact within each engine package.
- **Trademark and Legal Documentation:** WorkCraft is an independent project and is not affiliated with Microsoft Corporation or Adobe Inc. File format designations (`.docx`, `.xlsx`, `.pptx`, `.pdf`) describe technical compatibility. See [LEGAL.md](LEGAL.md) for full trademark disclaimers, liability terms, and IP takedown contacts (`visoire@proton.me`).

## Related guides

- [MCP-TOOLS.md](MCP-TOOLS.md): every tool, its arguments and how to call it from other clients
- [AI-PROVIDERS.md](AI-PROVIDERS.md): providers, keys, reasoning, caching, token counts, Team Mode
- [AI-SUPPORT-REFERENCE.md](AI-SUPPORT-REFERENCE.md): the working AI reference (wire formats, teams, skills, Craft apps, IDE bridge, cloud)
- [SOURCES.md](../SOURCES.md): every GitHub repository the project builds on or learned from
- [IPADOS-GUIDE.md](IPADOS-GUIDE.md): pairing, HTTPS, Apple Pencil, Magic Keyboard, browser mode, memory
- [IPADOS-COMPAT.md](IPADOS-COMPAT.md): the iPadOS compatibility layer, the register of measures, the engine contract
- [ECOSYSTEMS.md](ECOSYSTEMS.md): ecosystems, shared storage, recent files, web builds and how to update them
- [LEGAL.md](LEGAL.md): legal notices, upstream engine attribution, trademark disclaimers, and liability terms
