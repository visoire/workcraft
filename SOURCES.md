# Sources

Every GitHub repository this project is built on, ships, connects to or learned from. Keep this file current:
when you add a dependency, an engine, a protocol, a provider SDK or an idea taken from another project, add its
repository here in the same change (see the rules in [README.md](README.md) and [AGENTS.md](AGENTS.md)).

Links were checked on 2026-11-05. A repository marked *private* or *not published yet* returns 404 for visitors.

## The WorkCraft projects

| Project | Visibility | Role |
| :--- | :--- | :--- |
| [visoire/workcraft](https://github.com/visoire/workcraft) | public, MIT OR Apache-2.0 | This repository: the open-source workspace and the main project |
| [visoire/workcraft-home](https://github.com/visoire/workcraft-home) | private, not open source | The WorkCraft homepage, portal and dashboard (main website) |
| [visoire/workcraft-ai](https://github.com/visoire/workcraft-ai) | not published yet | The desktop-only AI chat in Rust; starts once the workspace is stable |
| [visoire/apicraft](https://github.com/visoire/apicraft) | public | GitHub release API; its release logic is ported into `src/server/apicraft.ts` |

## The Craft apps (engines and apps WorkCraft embeds or connects)

The four office engines run as WebAssembly panels (builds in `versions/`, release data in `public/releases.json`); the other 40 apps of the catalog are listed with author and licence in [docs/LEGAL.md](docs/LEGAL.md), Appendix A, and below.
All 44 apps are grouped into ecosystems (`src/ecosystems/catalog.json`): all 40 non-office web builds are installed in `versions/web-builds/` and registered in `public/web-builds.json` alongside their source trees (`versions/{artcraft,community,openplayground}/`) and archives (`versions/zip/{artcraft,community,openplayground}/`) via `npm run apps:fetch` and `npm run apps:import`, and the installed desktop apps are found on the computer and connected as MCP servers (`src/server/craft.ts`). See [docs/ECOSYSTEMS.md](docs/ECOSYSTEMS.md).

| Repository | App |
| :--- | :--- |
| [storytold/wordcraft](https://github.com/storytold/wordcraft) | WordCraft, documents (embedded) |
| [storytold/gridcraft](https://github.com/storytold/gridcraft) | GridCraft, spreadsheets (embedded) |
| [storytold/deckcraft](https://github.com/storytold/deckcraft) | DeckCraft, presentations (embedded) |
| [storytold/pdfcraft](https://github.com/storytold/pdfcraft) | PdfCraft, PDF (embedded) |
| [storytold/photocraft](https://github.com/storytold/photocraft) | PhotoCraft, photos |
| [storytold/vectorcraft](https://github.com/storytold/vectorcraft) | VectorCraft, vector art |
| [storytold/lightcraft](https://github.com/storytold/lightcraft) | LightCraft, RAW photos |
| [storytold/designcraft](https://github.com/storytold/designcraft) | DesignCraft, layout |
| [storytold/filmcraft](https://github.com/storytold/filmcraft) | FilmCraft, video |
| [storytold/effectcraft](https://github.com/storytold/effectcraft) | EffectCraft, motion |
| [storytold/soundcraft](https://github.com/storytold/soundcraft) | SoundCraft, audio |
| [storytold/cadcraft](https://github.com/storytold/cadcraft) | CADCraft, CAD |
| [storytold/figcraft](https://github.com/storytold/figcraft) | FigCraft, figures |
| [storytold/texturecraft](https://github.com/storytold/texturecraft) | TextureCraft, 3D textures (web build) |
| [storytold/materialcraft](https://github.com/storytold/materialcraft) | MaterialCraft, procedural materials (web build) |
| [tangency-labs/solidcraft](https://github.com/tangency-labs/solidcraft) | SolidCraft, 3D CAD, made by tangency-labs, not by the ArtCraft team (the web build asset is named `solidcraft-web-<version>.zip`; the `storytold/solidcraft` repository does not exist) |
| [UCS-Care-Group/mailcraft](https://github.com/UCS-Care-Group/mailcraft) | MailCraft, mail (community app; the workspace runs its 0.13.0 web build; the 0.12.0 web build panicked in the browser on std::time, 0.13.0 does not, see CHANGELOG) |
| [storytold/anicraft](https://github.com/storytold/anicraft) | AniCraft, 2d animation (source tree only, no web build yet) |
| [storytold/craft-anything](https://github.com/storytold/craft-anything) | Craft Anything, reverse engineering |

### Community apps of OpenPlayground

These 25 apps are not made by the ArtCraft team. The list, the repositories, the licences, the file types and the icons come from
[daijro/OpenPlayground](https://github.com/daijro/OpenPlayground) (`tools.yaml`, `icons/`; the repository exists, checked 2026-11-12; the user states it is
open source and free to use, but no licence file was found at its root, in the repository or in the local copy, so the licence of OpenPlayground's own
files is to be confirmed. What is used here is data about the apps: names, repositories, licence ids, file-type lists and the apps' own icons). Each app keeps its own licence: ten are **GPL-3.0**.
WorkCraft does not copy or link any of their code; `npm run apps:fetch` downloads the web build the repository publishes onto the user's machine
(never into Git), and the launcher shows the licence. Nothing has been downloaded for them yet. Their names are their own; the products they are
alternatives to are trademarks of their owners and are not used here.

| Repository | App | Licence | Web build |
| :--- | :--- | :--- | :--- |
| [tracedraw/tracedraw](https://github.com/tracedraw/tracedraw) | TraceDraw, vector drawing | MIT OR Apache-2.0 | built from source only |
| [emmertex/chromaforge](https://github.com/emmertex/chromaforge) (earlier `emmertex/lightcraft-classic`, renamed) | LightCraft Classic, raw catalog | MIT | web zip from the releases (`chromaforge-web-<version>.zip`) |
| [aliasfoxkde/FireCraft](https://github.com/aliasfoxkde/FireCraft) | FireCraft, screen graphics | MIT OR Apache-2.0 | web zip from the releases |
| [replicraft/PaintCraft](https://github.com/replicraft/PaintCraft) | PaintCraft, simple paint | MIT | built from source only |
| [daijro/paint.rs](https://github.com/daijro/paint.rs) | Paint.RS, image editing | GPL-3.0-or-later | web zip from the releases |
| [artcraft-android/procraft](https://github.com/artcraft-android/procraft) | ProCraft, digital painting | MIT OR Apache-2.0 | built from source only |
| [asad-albadi/PixelCraft](https://github.com/asad-albadi/PixelCraft) | PixelCraft, pixel art | MIT | built from source only |
| [AlienTechSoftware/notecraft](https://github.com/AlienTechSoftware/notecraft) | NoteCraft, notebooks | MIT OR Apache-2.0 | built from source only |
| [cmspeedau/NoteCraft](https://github.com/cmspeedau/NoteCraft) | TextCraft, text | MIT | built from source only |
| [NibrasAz7/matcraft](https://github.com/NibrasAz7/matcraft) | MatCraft, maths | MIT OR Apache-2.0 | built from source only |
| [fabox-os/Picasso-Suite](https://github.com/fabox-os/Picasso-Suite) | Picasso Suite, video editing | GPL-3.0-or-later | built from source only |
| [FedyaLight/align](https://github.com/FedyaLight/align) | Align, audio sync | GPL-3.0-only | built from source only |
| [Aalzard/subcraft](https://github.com/Aalzard/subcraft) | SubCraft, 3d painting | MIT OR Apache-2.0 | built from source only |
| [erythrofr/ClothCraft](https://github.com/erythrofr/ClothCraft) | ClothCraft, cloth | MIT | built from source only |
| [YalKouassi/HumanMotionCraft](https://github.com/YalKouassi/HumanMotionCraft) | HumanMotionCraft, character motion | GPL-3.0-or-later | built from source only |
| [crisprintsstuff/OxyBrush](https://github.com/crisprintsstuff/OxyBrush) | OxyBrush, sculpting | MIT OR Apache-2.0 | built from source only |
| [geekcastradio/altered-audio-editor](https://github.com/geekcastradio/altered-audio-editor) | Retake, audio editing | GPL-3.0-or-later | built from source only |
| [daijro/Lemon-Studio-web](https://github.com/daijro/Lemon-Studio-web) | Lemon Studio, music production | GPL-3.0-or-later | web zip from the releases |
| [daijro/honeydew](https://github.com/daijro/honeydew) | Honeydew, music sketching | GPL-3.0-or-later | web zip from the releases |
| [suhina-daw/suhina-daw](https://github.com/suhina-daw/suhina-daw) | Suhina, live music | GPL-3.0-or-later | built from source only |
| [fabox-os/Pro-Wave](https://github.com/fabox-os/Pro-Wave) | Pro Wave, music arranging | GPL-3.0-or-later | built from source only |
| [mateusrdp/oxiguitar](https://github.com/mateusrdp/oxiguitar) | OxiGuitar, tablature | GPL-3.0-or-later | built from source only |
| [transit-audio/transit](https://github.com/transit-audio/transit) | Transit, music production | MIT OR Apache-2.0 | built from source only |
| [soulspin/MixStudio](https://github.com/soulspin/MixStudio) | MixStudio, dj mixes | MIT | built from source only |
| [therichronicles/EarthCraft](https://github.com/therichronicles/EarthCraft) | EarthCraft, globe | MIT | built from source only |

## ArtCraft platform and shared libraries (studied, not shipped)

| Repository | Used for |
| :--- | :--- |
| [storytold/artcraft](https://github.com/storytold/artcraft) | The ArtCraft studio and monorepo the Craft apps come from; control-channel and MCP conventions |
| [storytold/craft-launcher](https://github.com/storytold/craft-launcher) | Installer of the Craft apps; the install paths searched in `src/server/craft.ts` |
| [storytold/artcraft-services](https://github.com/storytold/artcraft-services) | Studied (ArtCraft service layer) |
| [storytold/craft-libs](https://github.com/storytold/craft-libs) | Studied (shared Craft crates) |
| [storytold/craft-i18n](https://github.com/storytold/craft-i18n) | Studied (translation catalogs) |
| [storytold/craft-ai-integrations](https://github.com/storytold/craft-ai-integrations) | Studied (model integrations of the Craft apps) |
| [storytold/craft-common-actions](https://github.com/storytold/craft-common-actions) | Studied (shared CI actions) |

## Skills, MCP extensions and community projects

| Repository | Used for |
| :--- | :--- |
| [midasmatterhorn/artcraft-skills](https://github.com/midasmatterhorn/artcraft-skills) | The 13 skills in `skills/` (agentskills.io format), read with `read-skill` |
| [agentskills/agentskills](https://github.com/agentskills/agentskills) | The agent skills format (`SKILL.md` with front matter) |
| [smoermeow/artcraft-mcp](https://github.com/smoermeow/artcraft-mcp) | Community MCP adapter of the ArtCraft AI studio (reference) |
| [sawizzle/creative-apps-claude-plugin](https://github.com/sawizzle/creative-apps-claude-plugin) | Community Claude plugin for the Craft apps (reference for `<app>-cli mcp`) |
| [robertdominik618/chatgpt-craft-export](https://github.com/robertdominik618/chatgpt-craft-export) | Browser extension that exports ChatGPT answers to WordCraft and PdfCraft (reference) |
| [totec448-spec/chat-on-steroids](https://github.com/totec448-spec/chat-on-steroids) | Chat client with MCP support, studied in the `mcp` folder |
| [wildrcat/filmcraft-ipad](https://github.com/wildrcat/filmcraft-ipad) (FilmCraft for iPad, unofficial), a community build of FilmCraft 0.17.1 for the iPad by wildrcat; MIT OR Apache-2.0 like FilmCraft | The idea and the FilmCraft key table of the **touch keys bar** (`src/ipados/touch-keys.ts`, `src/workspace/touch-keys-ui.ts`): buttons that send the key press a hardware keyboard would, that keep the focus on the editor (`pointerdown` with `preventDefault`), a Shift latch, a bar that docks at the top or the bottom and folds away, Cmd on Apple platforms and Ctrl elsewhere; and the idea of handing a finished export to the iPad share sheet (Save Video, Save to Files, AirDrop), now an action of the "Saved" notice in `src/workspace/panels/craftapp.ts`. Everything was written again for this code base (no file or function copied). **Taken as ideas:** buttons that dispatch `KeyboardEvent`s (`key`, `code`, modifiers) to the canvas, a Shift latch that applies to the next key, Meta on Apple platforms and Ctrl elsewhere (an iPad reports itself as a Mac, so the user agent counts), a bar that docks at the top or the bottom and folds to one button, the list of FilmCraft keys (Space, Cmd K split, Delete, Shift Delete ripple, V and C tools, I and O, = and -), and `navigator.canShare` and `navigator.share` with the exported file. **Not taken, because WorkCraft already has it:** the file picker opened from inside the app's frame loop, the panic overlay, `navigator.storage.persist()`, the WebGL fallback and the service worker. **Not taken, because it does not fit:** the gzip-compressed wasm unpacked with `DecompressionStream`, the link to a music site and the standalone Home Screen manifest of one app. The build itself is FilmCraft 0.17.1; the workspace runs a newer one, so no file of it was used |
| [artcraft-android/procraft](https://github.com/artcraft-android/procraft) (the source tree in `versions/independent/procraft-0.1.0`, and the older 0.0.5-beta tree) | `crates/core/src/keys.rs`, the shortcut map of ProCraft, read to build the paint key table of the touch keys bar |
| [surfrpt1/procraft](https://github.com/surfrpt1/procraft) (the earlier, separate ProCraft 0.11.0, MIT) | Looked at and not used: a different code base (egui, own `.procraft` file format) that the ArtCraft ProCraft replaced |

## Protocols, provider SDKs and agent platforms

The offline snapshot of these lives in `artcraft/artifical-intelligence`; [docs/AI-SUPPORT-REFERENCE.md](docs/AI-SUPPORT-REFERENCE.md)
condenses it. WorkCraft talks to every provider with plain `fetch`; the SDK repositories are the reference for wire
formats, not dependencies.

| Repository | Used for |
| :--- | :--- |
| [modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol) | The MCP specification |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | `@modelcontextprotocol/server` and `client`: the `/mcp` server and the client for external servers |
| [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk) | Reference |
| [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector) | Testing MCP servers |
| [anthropics/anthropic-sdk-typescript](https://github.com/anthropics/anthropic-sdk-typescript), [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) | Claude Messages API: thinking blocks, signatures, caching |
| [openai/openai-node](https://github.com/openai/openai-node), [openai/openai-python](https://github.com/openai/openai-python) | Responses and Chat Completions |
| [openai/openai-agents-js](https://github.com/openai/openai-agents-js), [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | Agent and hand-off patterns |
| [openai/codex](https://github.com/openai/codex) | Codex CLI, agent configuration |
| [googleapis/js-genai](https://github.com/googleapis/js-genai), [googleapis/python-genai](https://github.com/googleapis/python-genai) | Gemini API: thought signatures, function calling |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli), [google-gemini/cookbook](https://github.com/google-gemini/cookbook) | Gemini agent CLI and recipes |
| [xai-org/xai-sdk-python](https://github.com/xai-org/xai-sdk-python) | Grok API |
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek agent harness: tool loop, truncated-call handling, caching |
| [anomalyco/opencode](https://github.com/anomalyco/opencode) | OpenCode: `opencode.jsonc` MCP block used by the IDE bridge |
| [ollama/ollama](https://github.com/ollama/ollama) | Local models: native `/api/chat`, `num_ctx`, `think`, `keep_alive` |
| [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp), [vllm-project/vllm](https://github.com/vllm-project/vllm) | Other local runtimes (LM Studio preset, local endpoints) |

Z.ai (GLM) publishes its SDKs at `zai-org`; the repository names in the snapshot (`z-ai-sdk-python`, `z-ai-sdk-java`)
did not resolve on 2026-11-05, so only the documentation site is listed under Other sources.

## Ideas taken from other projects

| Repository | Idea |
| :--- | :--- |
| [openclaw/openclaw](https://github.com/openclaw/openclaw) | Tool Search, repeated-failure stop, model fallback, Ollama notes |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | Studied in `other-documentations` (agent platform docs) |
| [cppalliance/runvil](https://github.com/cppalliance/runvil) | Studied in `other-documentations` (agent platform docs) |
| [samanhappy/mcphub](https://github.com/samanhappy/mcphub) | Smart tool routing across MCP servers |
| [mcp-use/mcp-use](https://github.com/mcp-use/mcp-use) | Studied in the local-LLM snapshot (MCP client and server library) |
| [HenryLinyy/local-llm-mcp](https://github.com/HenryLinyy/local-llm-mcp) | Memory guard before a local call |
| [sethuram2003/mcp-ollama_server](https://github.com/sethuram2003/mcp-ollama_server) | Studied in the local-LLM snapshot (Ollama MCP server) |
| [mudler/MCPs](https://github.com/mudler/MCPs) | Studied in the local-LLM snapshot (collection of small MCP servers) |
| [nkapila6/mcpsurfr](https://github.com/nkapila6/mcpsurfr) | Studied in the local-LLM snapshot (web search MCP server) |
| [FiloSottile/mkcert](https://github.com/FiloSottile/mkcert) | Local certificate authority for HTTPS on the home network. `scripts/lan-cert.mjs` calls it when installed; it is not bundled |
| visoire/workcraft-ai (Rust, `crates/agents/src/config.rs`: `app_agents`, `apps_team`) | MIT OR Apache-2.0 (same owner) | One agent per Craft app and the apps team (a leader plus one agent per app); the reconnect-with-cooldown idea of its MCP hub | `src/chat/app-roles.ts`, `ecosystemTeam()` in `src/chat/team.ts`, `reconnectNow()` in `src/server/mcp.ts` |
| [cjpais/Handy](https://github.com/cjpais/Handy) | Offline speech to text for voice input: WorkCraft runs the installed program headless (`handy --transcribe-file --json`) next to its models; nothing of Handy is bundled |
| [open-webui/open-webui](https://github.com/open-webui/open-webui) | Chat design patterns studied (message header with the model, action row under a message, code block header); no code copied |
| [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) | Chat design patterns studied (model selector, message actions, tool call cards); no code copied |
| [steveruizok/perfect-freehand](https://github.com/steveruizok/perfect-freehand) | Studied for the pressure simulation of pens without a sensor (`src/ipados/pen-calibration.ts` uses the same idea, speed lowers pressure); the library itself is not a dependency |
## Ecosystems, storage and web builds

What the ecosystem, shared-storage and web-build work builds on or learned from. Licences matter here: nothing from a source
whose licence does not fit MIT OR Apache-2.0 was copied. The 17 web builds themselves are upstream engines with their own MIT OR Apache-2.0 licences and notices, kept next to them (`LICENSE-*`, `NOTICE`, `ATTRIBUTION.md`). Where the code lives and how to update it is in
[docs/ECOSYSTEMS.md](docs/ECOSYSTEMS.md).

| Source | Licence | Taken | Where in WorkCraft |
| :--- | :--- | :--- | :--- |
| OpenPlayground (local copy `artcraft/other/open/openplayground-main`; open source, public and free to use per the maintainer; **its repository address and licence file still have to be added here**: the local copy has no licence file at its root, only the licences of its app patches) | open source (exact licence to be confirmed) | The `globalThis.playgroundFiles` contract (`open`, `saveAs`, `write`, `read`, `files`, `remove`, `download`, `setUnsaved`, `onOpen`), the `browser:/path` scheme, the `opens` / `imports` file-type lists per app, the web-zip asset name `<app>-web-<version>.zip`, per-path write queues, a recent-documents idea. Contract and conventions followed; WorkCraft's code is written independently | `src/storage/`, `public/craft-files.js`, `scripts/fetch-apps.mjs`, `src/ecosystems/catalog.json` |
| [ranuts/document](https://github.com/ranuts/document) (`document-0.0.9`) | AGPL-3.0 | Idea only: local-first browser editor, reopen recent work from the browser, agent tools in the browser. No code | `src/storage/recent.ts` (idea) |
| [ONLYOFFICE/web-apps](https://github.com/ONLYOFFICE/web-apps), [DocumentServer](https://github.com/ONLYOFFICE/DocumentServer), [DesktopEditors](https://github.com/ONLYOFFICE/DesktopEditors) | AGPL-3.0 | Studied for touch and mobile editor ideas. No code | none |
| `craft-ipad-apps-1.0.0` (local, no licence file) | not stated | Studied: a native Swift wrapper (local asset server, Files app, Save to Files) as the alternative to the web path. Not used | none; the browser path (PWA, OPFS) is the chosen route |
| visoire/workcraft-ai, `crates/agents/src/craft/spec.rs` | MIT OR Apache-2.0 (same owner) | The 17-app registry: ids, aliases, file formats read and written, which kind of specialist each app is | `src/ecosystems/catalog.json`, `lookupApp` |
| [cjpais/Handy](https://github.com/cjpais/Handy) | see its repository | Offline voice input, unchanged here | `src/server/voice.ts` |

## Cloud storage (studied, not shipped; icons shipped)

Where the guided cloud setup (`src/app/cloud-guide.ts`) got its ideas. From the reference index for cloud work that came with the CraftCloud project (`artcraft/cloudcraft/github_reference_index_for_ai_agents.md`, a local file). Nothing here is a dependency and no code was copied: WorkCraft keeps a project in a folder that the service's own app syncs, or hands out a ZIP; it has no sync engine of its own for these services. Check each repository's licence before you reuse anything.

| Repository | Idea or use |
| :--- | :--- |
| [jonasbove/craftcloud](https://github.com/jonasbove/craftcloud) | CraftCloud: two-way sync with guarded writes, a version history and conflict copies, `craftcloud://` links. The model for "a copy that stays in step, nothing overwritten silently" in the cloud card, and the likely target of a later native provider |
| [AtalayaLabs/OxiCloud](https://github.com/AtalayaLabs/OxiCloud) | The self-hosted server inside CraftCloud's image (WebDAV, REST, OpenID Connect). Studied only |
| [simple-icons/simple-icons](https://github.com/simple-icons/simple-icons) | CC0 1.0: the six service icons in `public/assets/cloud/` (Google Drive, iCloud, OneDrive from 11.14.0, Dropbox, MEGA, Proton Drive), stored locally, downloaded 2026-11-17; the logos themselves are the owners' trademarks (`docs/LEGAL.md`) |
| [rclone/rclone](https://github.com/rclone/rclone) | Reference for provider quirks (Google Drive, OneDrive, iCloud, Dropbox, WebDAV): why a synced folder is the simplest, most robust route. A service WorkCraft does not list can be mounted as a folder with rclone and used through "Another service" |
| [apache/opendal](https://github.com/apache/opendal) | One storage interface across many services: the candidate for a future native provider layer in place of per-service code. Not used yet |
| [tpluharik/Tuxindrive](https://github.com/tpluharik/Tuxindrive) | Multi-cloud client over rclone with files on demand and per-provider rules. Studied only |
| [cberner/fuser](https://github.com/cberner/fuser) | FUSE library named for online-only placeholder files (a later "files on demand" stage). Studied only |
| [storytold/craft-libs](https://github.com/storytold/craft-libs), [storytold/craft-launcher](https://github.com/storytold/craft-launcher) | `craft-web-host` (the `?host=parent` iframe message bridge for open, save, dirty) and the launcher catalog: the contract behind WorkCraft's own `playgroundFiles` bridge and the app list |
| [bhimio1/CreativeCraft](https://github.com/bhimio1/CreativeCraft), [cryptpad/cryptpad](https://github.com/cryptpad/cryptpad) | Community wrapper (apps, cloud sync, MCP) and an end-to-end encrypted collaboration suite: studied as references for later work |

## npm dependencies of the workspace

| Repository | Package |
| :--- | :--- |
| [honojs/hono](https://github.com/honojs/hono), [honojs/node-server](https://github.com/honojs/node-server) | `hono`, `@hono/node-server`, `@hono/node-ws`: the backend |
| [colinhacks/zod](https://github.com/colinhacks/zod) | `zod`: every tool schema |
| [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) | `@xterm/xterm`, `@xterm/addon-fit`: the terminal |
| [dolanmiu/docx](https://github.com/dolanmiu/docx), [mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js) | `docx`, `mammoth`: write and read documents |
| [exceljs/exceljs](https://github.com/exceljs/exceljs) | `exceljs`: sheets |
| [gitbrent/PptxGenJS](https://github.com/gitbrent/PptxGenJS) | `pptxgenjs`: slides |
| [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib), [unjs/unpdf](https://github.com/unjs/unpdf) | `pdf-lib`, `unpdf`: PDF |
| [101arrowz/fflate](https://github.com/101arrowz/fflate) | `fflate`: ZIP |
| [niieani/gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) | `gpt-tokenizer`: exact OpenAI token counts |
| [fontsource/fontsource](https://github.com/fontsource/fontsource) | `@fontsource/*`: fonts without a CDN |
| [cozmo/jsQR](https://github.com/cozmo/jsQR) | `jsqr` (tests of the QR encoder) |
| [privatenumber/tsx](https://github.com/privatenumber/tsx), [microsoft/TypeScript](https://github.com/microsoft/TypeScript), [vitejs/vite](https://github.com/vitejs/vite) | `tsx`, `typescript`, `vite`: build and tests |

## Other sources (not on GitHub)

Provider documentation: [modelcontextprotocol.io](https://modelcontextprotocol.io), [docs.anthropic.com](https://docs.anthropic.com),
[platform.openai.com/docs](https://platform.openai.com/docs), [ai.google.dev](https://ai.google.dev/gemini-api/docs),
[api-docs.deepseek.com](https://api-docs.deepseek.com), [docs.x.ai](https://docs.x.ai), [docs.z.ai](https://docs.z.ai),
[ollama.com](https://ollama.com). Cloud: [Google Drive API](https://developers.google.com/drive/api) and
[OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app). Release data:
[GitHub REST API](https://docs.github.com/en/rest). The Craft apps: [getartcraft.com](https://getartcraft.com).
iPadOS layer: [Pointer Events](https://www.w3.org/TR/pointerevents3/) and [touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)
(MDN), the [WebKit pointer events notes](https://webkit.org/blog/), the [File System Standard](https://fs.spec.whatwg.org/)
(OPFS and synchronous access handles in workers) and [Cross-Origin Isolation](https://web.dev/articles/coop-coep).
