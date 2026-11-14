# Changelog

All notable changes to WorkCraft. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version
numbers follow [Semantic Versioning](https://semver.org/).

**Alpha phase.** WorkCraft is in its alpha phase. Versions look like `0.1.0-alpha.N`. There is no stable release yet, and settings,
data formats and tools may change between alphas. Every change goes under `## [Unreleased]` first; the maintainer turns it into a
numbered entry when a release is cut ([docs/PUBLISHING.md](docs/PUBLISHING.md)).

**Why the numbering starts at `0.1.0-alpha.1`.** This is the first public release, and the numbers start fresh. A `1.0` would promise
a stable surface the project does not have yet, and the old internal history of this repository used `1.0.0-alpha.N` numbers and carries a
`v1.0.0` tag, which `1.0.0-alpha.1` would sort below. `0.1.0-alpha.1` is a clean start; `1.0.0` is for the day the maintainer calls the project
stable. The long internal changelog from before the first public release is not part of this repository.

## [Unreleased]

### Changed

- **Documentation brought up to date for the 44 apps.** The README, the in-app documentation, ARCHITECTURE, the iPad guides, SECURITY, SOURCES and the repository description no longer
  speak of four apps only; they explain that the repository holds the four office apps, that all 44 apps open in the browser at [workcraft.cc/app](https://workcraft.cc/app/) and that
  `npm run apps:fetch` installs the other 40 on your own computer. The in-app documentation says "WorkCraft 0.1 (alpha)" instead of "1.0".
- **Legal notice.** [docs/LEGAL.md](docs/LEGAL.md) covers all 44 apps: their separation from the workspace, where each is distributed from, the hosted browser version, and Appendix A with the
  author, licence and source repository of every app (ten are GPL-3.0). Date: November 14, 2026.

## [0.1.0-alpha.1] - 2026-11-14

The first public alpha of WorkCraft: a local-first workspace for real work. It runs in your browser from a small server on your own computer (**Node.js 22 or newer**), or
as a browser-only version ([workcraft.cc/app](https://workcraft.cc/app/)) with nothing to install. All 44 apps and every workspace are available in the browser version; on your own
computer the repository holds the four office apps and `npm run apps:fetch -- --yes` installs the other 40.

### What is in it

- **One workspace.** WordCraft (documents), GridCraft (sheets), DeckCraft (slides) and PdfCraft (PDFs) as panels of one window, next to a file tree,
  a code editor and a terminal. Split, maximize, float, send to the dock, full screen, or open a panel in a window of its own. Every panel has a
  right-click menu (header, tab, the app's icon in the tool rail, a long press on a touch screen): reload, unload, panel info, show in the project
  tree, copy path and more. A new workspace starts on a welcome page and starts no app by itself.
- **Workspaces for every kind of work.** A catalog of 44 apps in ready-made workspaces (office, notes, imaging, paint, video and audio, music, design,
  3D and CAD, and more) or one of your own. Only the four office apps are part of this repository; for the others, `npm run apps:fetch` lists the web
  builds and installs them on request, with the licence of each shown first.
- **An assistant that works in your files.** Through the Model Context Protocol (MCP) it reads and writes documents, sheets, slides and PDFs, shows each
  step, and is covered by snapshots and undo. Local models with Ollama or your own key for Claude, ChatGPT, Gemini, DeepSeek, Grok, GLM, Mistral, Groq,
  OpenRouter, Together AI, LM Studio or any OpenAI-compatible endpoint. Single or Team mode (supervisor, sequential, parallel, human in the loop), one
  specialist per app, personas and contexts, voice input, and an MCP server so other tools can work in your projects too.
- **Private by default.** No account, no telemetry, no CDN. Files live in a folder you own (or in your browser in the browser-only version), API keys stay
  on the local server, an audit log lists every request that leaves the machine, and Local-only mode blocks every cloud provider.
- **Cloud when you want it.** A project can stay local, live in Google Drive (your own OAuth client) or in iCloud Drive, OneDrive or any synced folder, or
  in both with two-way sync and conflict copies. In the browser-only version Google Drive signs in from the browser and a folder of the computer is
  available in Chrome and Edge.
- **Light and dark mode that follows you.** One switch for the workspace; apps with both looks follow it, apps with one look keep it and say so.
- **Windows, macOS, Linux and iPadOS.** On the iPad: touch, Apple Pencil with pressure and tilt, Magic Keyboard shortcuts, Stage Manager and Split View,
  touch keys for apps that need keys, memory guard, and apps rendered 1:1 at Retina resolution. Pair an iPad with your computer over the home network or
  use the browser-only version on the iPad alone.
- **English and German interface.** English is the default.
- **Documentation.** The README, the guides in [docs/](docs/README.md) and an in-app documentation page; `npm run check:docs` keeps the links true.

### What is checked, and what is not

- Checked on every change: strict TypeScript, 384 backend tests (378 run, 6 skipped), 103 end-to-end checks in a Chromium-family browser with a mock model,
  66 checks at iPad sizes in WebKit, a clean-repository check (no keys, no private files) and the docs link check. CI runs the type check, the backend tests, the clean check, the
  docs check and the build on Linux and Windows; the end-to-end runs happen on the maintainer's computer before a release. Windows is the platform the
  maintainer uses; macOS and Linux get the automated checks and less hands-on time.
- **Not checked on real hardware:** iPadOS (all iPad checks run in WebKit on a desktop at iPad sizes, with simulated touch and pen events), the Apple
  Pencil and Magic Keyboard, and a real finger long press. iPadOS support is built, not proven.
- **Not checked against a real account:** Google Drive sync (it is tested against an in-memory folder and a mock), and the folder picker of a real browser.
- **Third-party web builds vary.** Some of the 40 apps beyond the four office apps come from other people's projects and some of their web builds do not
  start in every browser. [docs/ECOSYSTEMS.md](docs/ECOSYSTEMS.md) says what was tried.
- WebGPU is used where the browser has it; WebGL2 is the fallback. A headless browser has no WebGPU, so the automated checks run on WebGL2.

### Licence and credits

MIT OR Apache-2.0. WordCraft, GridCraft, DeckCraft and PdfCraft are separate open-source engines by the ArtCraft team ([github.com/storytold](https://github.com/storytold))
with their own licence files, kept intact. Every repository this project builds on, ships or learned from is in [SOURCES.md](SOURCES.md); the ideas taken
from the community iPad build of FilmCraft by wildrcat (touch keys) are credited there too.
