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

## [0.1.0-alpha.6] - 2026-11-18

### Changed

- **One setting for color.** Settings, **Color** (Blue, Indigo, Ice, Teal, Amber, Coral, Emerald, Mono) now sets the accent of the whole workspace (buttons, switches, highlights, the send button), not only of the chat, and the little helper in the chat takes the same color. Blue is the default and sets nothing, so it is exactly the workspace blue. The extra switch "Chat accent follows Blip" is gone. Apps inside panels keep their own colors. Verified in a desktop browser (accent on the root, Blip, back to Blue); not looked at app by app.

### Changed

- **docs/PUBLISHING.md** describes the files of a release (`workcraft-local`, `workcraft-web`, `SHA256SUMS.txt`, `npm run pack:release`) and the private website release (`npm run release:site`, `scripts/vps-update.sh`).
- **A flaky test:** `tests/server/lan.test.ts` compared a token with itself one time in 32.

## [0.1.0-alpha.5] - 2026-11-18

### Added

- **Set it up with one double-click, or with your AI assistant.** `Start WorkCraft.cmd` (Windows), `Start WorkCraft.command` (macOS) and `start-workcraft.sh` (Linux) set WorkCraft up, start it, open the browser and offer to start it when you sign in: a Startup entry, a LaunchAgent or an autostart file of your own user, never a system service and never administrator rights (`scripts/setup.mjs`, `scripts/launcher/`, `npm run setup`). Without Node 22 they fetch a private copy from nodejs.org into `.runtime/` and check it against nodejs.org's checksums. `--status --json`, `--stop`, `--remove-autostart`, `--lan`, `--dry-run`. [SETUP-AI.md](SETUP-AI.md) is the page for an AI assistant: tell it "set up WorkCraft". Verified on Windows (started in 4 seconds, stopped, autostart written and removed, no hanging pipes when an agent runs it); the macOS and Linux scripts are written the same way and tested only through their generated files.
- **Voice input in the browser and on an iPad: a Speech server.** Settings, Voice input accepts the address of any server with the OpenAI transcription API (a Whisper server of your own, or Groq and OpenAI with your key, kept in memory only) and sends the recording there. The desktop version forwards the request, so servers without CORS headers work. Automatic: Handy, then the speech server, then the browser (`src/core/speech-endpoint.ts`, `POST /api/voice/remote`, tests/server/speech-endpoint.test.ts). Not tried: a real Groq or OpenAI key, a Whisper server, Safari on an iPad.
- **Back up everything (ZIP) and Restore from a backup** (project menu and command palette): one file with every project, files, chats and layout, and a manifest; a restore only adds, a name that is taken comes back as a copy. On an iPad it goes through the share sheet (Save to Files, iCloud Drive). The idea is from OwlLuna (see SOURCES.md).
- **Sync safeguards from OwlLuna's iCloud sync:** a file that iCloud has not downloaded yet (`.name.icloud`) or a half written upload is never copied and never counts as deleted, and a pass that would delete more than 20 files or more than half of a project at once deletes nothing and asks ("Let the deletions through" or "Keep the files").
- **`docs/IPAD-TEST-LIST.md`:** the list of what to try on a real iPad, section by section, with what you should see.

### Changed

- **Handy 0.10.1** is the version WorkCraft is built and tested for: a real transcription through `--list-models --json` and `--transcribe-file --json` ran with it.
- **Blip's color and the accent.** Changing Blip's color now reaches every Blip on screen at once (the big one on the empty chat stayed on the old color). "Blue" is the color of the workspace itself (it used to switch to a lighter blue); Indigo and Ice have accents of their own. (0.1.0-alpha.6 then made this one Color setting for the whole workspace.)
- **Releases:** each release carries the browser build (`workcraft-web`), the run-it-yourself bundle (`workcraft-local`) and checksums, and links workcraft.cc/app for the full browser version with every app.

## [0.1.0-alpha.4] - 2026-11-18

### Added

- **Add to Home Screen, on iPad.** A short notice on the first visit in Safari (and **Add to Home Screen** in the main menu at any time) shows the four steps: Share, Add to Home Screen, Add, open WorkCraft from the icon. It runs full screen, without the Safari bars, and works better. It is shown on an iPad only, never in the installed app, once per fortnight (it leaves by itself after 20 seconds so it does not sit on the chat's Send button), and "Do not remind me" in the guide stops it for good. Pure rules in `src/app/install-tip-rules.ts`, the dialog in `src/app/install-tip.ts` (`tests/server/install-tip.test.ts`).
- **A real document scanner on iPad.** **Scan a document** in the + menu now opens a camera scanner of its own: it finds the page, you can drag the four corners, straightens it, offers Grey, Black and white or Colour, collects several pages and saves one PDF in `/Scans`. Safari cannot start the Scan Documents of iPadOS directly, so this is WorkCraft's own scanner (`src/core/scan.ts`, `src/project/doc-scanner.ts`; where the camera is not available it takes a photo from the picker instead). **Upload files** is unchanged on every device and, on an iPad, Apple's sheet is still reachable through it (Choose Files, then Scan Documents). Tests: `tests/server/scan.test.ts`. Not verified: the scanner with a real iPad camera.
- **A tidier pencil trail.** When you swipe with the Apple Pencil in an app, the blue trail is now one smooth line with a soft highlight instead of the beaded snake (`src/workspace/trail.ts`, `tests/server/trail.test.ts`).

### Changed

- **First-start page on iPad.** The second page (choose a workspace) sat lower than the first and its Continue button could be out of reach, because the page was taller than the visible Safari area. It is now as tall as the visible viewport, starts at the top and scrolls inside.
- **Focus mode button** moved to the top right and the panel title bars make room for it, so it no longer sits on top of the Apple Pencil tools.
- **Hover circle for the Apple Pencil** is now an empty circle in the colour of the tool.
- **The side chat is leaner.** The model button shows only the provider mark (and the effort when it is not automatic), the approval choice is one shield or bolt button, the menus list only the providers that are ready (a key saved, or a local model) and are set in the interface font. On an iPad the @ and / buttons and their menu entries are gone (you can still type them).

### Apps

- **Newer web builds installed:** OxyBrush 4.0.0-beta.16, Picasso Suite 0.8.0 and ProCraft 0.0.6-beta (through `npm run apps:import`).
- **Source trees added, no web build:** OxiGuitar 0.21.1, Retake 0.38.0, Transit 0.7.3 and ProCraft 0.0.7-beta are in `versions/independent/`; they need a build from source before they can run in the browser. Honeydew 0.5.4 (1.36 GB web zip) is still not installed.

### Verified

- The maintainer tried this build on a real iPad: touch and tap and hold work. Everything else on the iPad (scanner camera, Home Screen notice, Pencil tools, memory limits) is built and tested in WebKit at iPad sizes only.

## [0.1.0-alpha.3] - 2026-11-18

### Added

- **Bring a file in from the + menu.** Under the apps of the workspace and your recent files the menu now has **Upload files** (any device except an iPad: the file picker, files go to `/Uploads` and the first one opens in its app) or, on an iPad only, **Scan a document** (the picker sheet of iPadOS, which offers Scan Documents, Take Photo and the Files app; a scan lands in `/Scans`, a picture without a useful name becomes "Scan 2026-11-18 14-05.jpg"). `src/project/add-files.ts`, the pure rules in `add-files-rules.ts`. The scan path is built for iPadOS and not tried on a real iPad.
- **Make WorkCraft faster** (`docs/OPTIMIZATION.md`, an in-app page of the same name, and the same guide on workcraft.cc/docs/optimization): panels, the memory guard and its badge, browsers, hardware acceleration, the AI (single assistant, token economy, Ollama context, quantization), iPad, device sizes and what to put in a performance report.
- **Dropdowns for Model and Base URL** in Settings, AI models (`src/chat/model-choices.ts`, `src/workspace/panels/choice-field.ts`): the suggested models and the known addresses of each provider, the models the endpoint reports after Test connection (a local runtime is asked on its own), and "Other ..." for a name or an address that is not listed. An own endpoint offers the usual local servers (LM Studio, Ollama, llama.cpp, vLLM, Jan, LiteLLM) and a few hosted ones.

### Changed

- **The cloud guide is simpler.** Proton Drive comes first and larger (end-to-end encrypted, recommended, one button); a service whose folder was found on this computer is one row with a **Connect** button; every other service (Google Drive, iCloud, OneDrive, Dropbox, MEGA and the rest) is one line and one **Save a ZIP** button, plus **Choose the folder of your cloud app** where the browser can open a folder. The wall of seven tiles is gone. The first-start page says the same in one sentence.
- **The search lists no apps.** The command palette no longer has an "Open <app>" entry for every app (the + menu, the rail and the launcher do that, and they follow the workspace); with nothing typed it opens on your recent files.
- **Settings, AI models:** the red and yellow key icon on a provider without a key is gone (the empty key field says it).
- **The documentation speaks of every app, not of an office suite.** README, AGENTS.md, the in-app documentation and the docs describe a workspace for every kind of work with dozens of apps; counts are named as "44 at the time of writing" where one is needed.

### Apps

- **Newer builds installed:** SolidCraft 0.44.1, SubCraft 0.4.3 and TraceDraw 0.48.0 (from their releases and GitHub Pages) and NoteCraft 0.0.14 (the web build and the source tree you supplied).
- **Versions that were wrong.** Fifteen apps imported from a local folder carried the placeholder 0.1.0 (a bug report said the website showed OxiGuitar at 0.11 while the repository was at 0.19). They now carry the version of the source tree they were built from: Align 0.3.3, EarthCraft 0.2.0, HumanMotionCraft 0.3.0, MixStudio 0.30.0-beta, OxiGuitar 0.19.1, OxyBrush 4.0.0-beta.4, PaintCraft 0.2.0, Picasso Suite 0.7.0, PixelCraft 0.4.1, ProCraft 0.0.1, Pro Wave 0.2.2, Retake 0.24.0, Suhina 0.0.1, TextCraft 0.0.0 and Transit 0.7.0 (MatCraft and ClothCraft really are 0.1.0). This is read from the source trees, not measured on the builds.
- **Not updated, and why.** These apps have no web build upstream, so a newer version needs a build from their source: OxiGuitar 0.21.1, Retake 0.38.0, Picasso Suite 0.8.0, Transit 0.7.3, OxyBrush 4.0.0-beta.16, ProCraft 0.0.7-beta. Honeydew 0.5.4 has a 1.36 GB web zip and is not installed (0.5.3 stays). `npm run versions -- --remote` shows the full picture.

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
