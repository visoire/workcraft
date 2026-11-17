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

## [0.1.0-alpha.2] - 2026-11-17

### Added

- **A guided cloud setup** ("Save in the cloud": main menu, command palette, Settings, Cloud storage, and the last step of the first-start page). Pick Google Drive, iCloud Drive, OneDrive, Dropbox, MEGA, Proton
  Drive or Another service; each opens three short steps and one button, with a link to get the service's app. No password is typed into WorkCraft: the service's own app syncs a folder and WorkCraft keeps
  a copy of the project in a folder called WorkCraft inside it. On a computer with the desktop backend the folder is found for you (`GET /api/cloud/detect`: Dropbox, OneDrive including company folders, Google Drive for
  desktop, MEGA, Proton Drive, iCloud Drive) and **Use this folder** is the whole setup; in Chrome and Edge on their own **Choose the folder** opens the browser's folder picker; on iPad, iPhone, Safari and Firefox
  (no folder access) **Save ZIP** opens the share sheet (Save to Files lists iCloud Drive and every cloud app). A ZIP is also offered next to every folder route, so there is always a way out. The project is
  bound to the folder and its first sync runs right away. The icons of the six services are stored locally in `public/assets/cloud/` (CC0 Simple Icons set, downloaded 2026-11-17; the logos are their owners' trademarks, see `docs/LEGAL.md`), so the workspace loads nothing from the network for them. Pure rules in `src/app/cloud-providers.ts`, the finder in `src/server/cloud-detect.ts`, the dialog in `src/app/cloud-guide.ts`.
  Not verified: a real Dropbox, OneDrive, MEGA or Proton Drive folder (the finder is tested with a fake disk), the iPad share sheet, the browser folder picker with a real click.- **Onboarding.** The first start is a page in three steps that runs before anything else loads (no project, project tree, chat or tool rail yet): a welcome with a way to support the project, the
  workspace (or Create your own), and where the files are saved (only on this computer, or also in the cloud, which opens the cloud guide right after the start). The card is a landscape card on a computer, a smaller one on an iPad and the whole screen on a phone; only its body scrolls, and the workspaces are compact tiles. The answer is kept in the
  browser and not asked again. "Skip setup" keeps Office & Documents. Returning users, `/?ecosystem=` links and automated browsers skip it; `/?onboarding=1` shows it again.

### Fixed

- **Team configuration** had two scrollbars (the card and the list inside it); there is one now.
- **WordCraft and the other egui apps sometimes stayed black** until a click. The apps draw a frame only when asked, and a lost first frame left them waiting. The frame layer
  (`public/craft-frame.js`, measure `repaint-wake`) now sends a few "pointer left the canvas" events in the first seconds, which ask the app for a frame and cause no hover or click. In a test an idle
  WordCraft drew 1 frame in 1.5 s and 4 after the nudge. I could not make the black screen appear on demand, so the fix is not proven against it; the hosted copy gets it with the next build and deploy.

### Changed

- **App builds updated.** MailCraft 0.11.1 to **0.13.0** (0.12.0's web build panicked on `std::time` in the browser; 0.13.0 starts, draws the mail list and the reminders, no panic), SolidCraft 0.41.0 to **0.43.0**
  (starts, start page), LightCraft Classic 26.46.3 to **26.47.1** (still stops at startup with `no pids on this platform`, an upstream fault that is documented; it also refuses to run beside LightCraft).
  Installed with `npm run apps:fetch -- --yes --app solidcraft,mailcraft,lightcraft-classic` (sha256 checked) and started in a workspace panel (Chromium, SwiftShader). Not installed: Honeydew 0.5.4 (its web zip
  is 1.36 GB; `--max-mb 1461` takes it) and every app whose upstream tag has no web zip (they are built from source only; `npm run versions -- --remote` lists them). The CLI flags of SolidCraft and MailCraft
  were not re-read.- **The X of a panel only hides it**, no longer closes and unloads. Closing for good is a red "Close and free memory" in the panel menu (Unload and free memory is red too); Hide is in the menu as well.
- **Settings moved to the top right** of the top bar (it was at the bottom of the rail).
- **A simpler interface.** Fewer buttons, stronger defaults, the rest one right click away.
  - *Panels:* the header has two buttons, Maximize and X (for the project tree and the chat, X hides). The "More" button and the Hide eye are gone from the header; Full screen,
    Minimize, Picture in picture, separate window, file actions, Reload, Info and Hide are in the right-click menu (long press on a touch screen), which was already there.
  - *Top bar:* one AI button (Full Chat Mode is in the chat's menu), no second project-tree button next to the logo (the rail has it), no extra filter button for project search (main menu
    and palette), no "hide the bar" button (main menu). The **+** lists the apps of the workspace in use and its recent files, without "new" tags.
  - *Tool rail:* drag an app icon up or down to reorder (mouse and pen), or use Move up and Move down in its menu (finger). The order is kept per workspace (`railOrder`).
  - *Chat:* the header keeps New chat and one menu (search, usage, export, clear and Full Chat Mode moved into it); latency and MCP count show only when something is wrong; no red key icon
    when no model is set up (the banner says it). The persona menu is a short list: Standard, up to five personas for the workspace, the one in use, and "All personas and context…";
    descriptions, tags, groups and contexts left the menu, and the persona button is quiet text instead of a blue pill. The empty chat is a greeting ("What are you working on?") and one quiet line; the option cards are gone.
  - *Workspaces:* a chosen app (Create your own) and the workspace in use get a green outline, no check mark and no badge.
  - *Settings:* five sections up front (AI models, Personas and context, Appearance and layout, Privacy, Cloud storage); every other section is behind **Developer options**, which opens by itself
    when something links into it.
  - Verified: type check, `npm test` 394 (387 pass, 7 skipped, none failing, 10 new in `tests/server/essentials.test.ts`), both builds, `check:docs`, `check:clean`, the main browser run 103/103,
    the iPad run in WebKit 66/66, and a real-mouse drag of a rail icon in Edge. The features run has two failures (A2 project memory in the prompt, F2 monitor of a running app) that fail the same way
    on the last commit: F2 expects a GridCraft panel that no longer opens by itself. Not verified: a real finger long press and Move up and Move down on a real iPad.

- **Documentation brought up to date for the 44 apps.** The README, the in-app documentation, ARCHITECTURE, the iPad guides, SECURITY, SOURCES and the repository description no longer
  speak of four apps only; they explain that the repository holds the four office apps, that all 44 apps open in the browser at [workcraft.cc/app](https://workcraft.cc/app/) and that
  `npm run apps:fetch` installs the other 40 on your own computer. The in-app documentation says "WorkCraft 0.1 (alpha)" instead of "1.0".
- **Legal notice.** [docs/LEGAL.md](docs/LEGAL.md) covers all 44 apps: their separation from the workspace, where each is distributed from, the hosted browser version, and Appendix A with the
  author, licence and source repository of every app (ten are GPL-3.0). Date: November 14, 2026.
- **Dependencies.** Vite 6 to 8, Hono 4.13.18, docx 9.15, unpdf 2 (PDF text), gpt-tokenizer 4.1 and the GitHub Actions `checkout` and `setup-node` 7. Type check, unit tests, the build and the browser tests
  pass as before.

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
