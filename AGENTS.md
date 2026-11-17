# AGENTS.md: WorkCraft

Context for AI coding agents (Claude Code, Codex, Cursor and others) and for people new to the code.
Read it fully before you change anything. When this file and the code disagree, the code wins; fix
this file in the same change.

## What this repository is

The open-source WorkCraft workspace (MIT OR Apache-2.0): a unified local-first workspace in the browser
for every kind of work: documents, spreadsheets, presentations and PDFs (WordCraft, GridCraft, DeckCraft and
PdfCraft) and dozens more open-source apps for photos, vector art, video, audio, music, design and 3D (all as WebAssembly
panels, in ready-made workspaces; the catalog in `src/ecosystems/catalog.json` is the one list), next to a code editor, a terminal and an AI assistant that drives
every tool over MCP and runs local (Ollama) or with the user's own API keys. A Node.js server (Hono) on
`127.0.0.1` serves files, projects, the terminal, the AI router and the MCP server.

It is the main project of three:

| Project | Visibility | Role |
| :--- | :--- | :--- |
| `visoire/workcraft` | public, open source | this workspace: the main project |
| `visoire/workcraft-home` | private, not open source | the main homepage (homepage, changelog page, portal, dashboard, PHP backend) |
| `visoire/workcraft-ai` | public, open source (MIT OR Apache-2.0), alpha | WorkCraft AI: the desktop-only AI chat in Rust (egui, CLI, MCP server), formerly called WorkCraft chat |
| `visoire/workcraft-monorepo` | private | the workspace and the website together; `scripts/split-repos.mjs` there writes the first two |

Changes usually start in the monorepo and are mirrored here. A pull request against this repository
is welcome and gets carried back. Every GitHub repository the project uses or learned from is listed in `SOURCES.md`.

## Versioning, changelog and docs: do this with every change

The project is in its **alpha phase**: versions look like `0.1.0-alpha.N`, the first public one is `0.1.0-alpha.1`, and there is no stable release
yet. The maintainer decides when a version is cut. Until then every change adds to `## [Unreleased]` in `CHANGELOG.md`. Do this in the same change as the
code, without being asked:

1. **Describe it.** Add a line (or a few) under `## [Unreleased]` at the top of `CHANGELOG.md`: what changed and why it matters to a user, in plain words,
   what is verified and what is not. Never rewrite a released entry.
2. Update every Markdown file that describes the change: `README.md`, this file, `docs/*.md`, `src/docs/content.md`
   (the in-app documentation) and, for interface text, `src/app/i18n-de.ts`. `npm run check:docs` checks the links.
3. Update `SOURCES.md` when a dependency, engine, protocol, SDK or idea from another repository is added.
4. Run typecheck, test, check:clean, check:docs and build (and test:e2e when the interface changed) before you say it is done.

**Cutting a release is the maintainer's job** (or an agent asked to prepare one): `[Unreleased]` becomes `## [0.1.0-alpha.N] - YYYY-MM-DD`, and the number
changes in `package.json`, `package-lock.json` (two places), `src/core/version.ts` and the version line of `README.md`
(`tests/server/projects.test.ts` keeps `version.ts` and `package.json` equal); `docs/releases/<version>.md` holds the release notes
(`docs/PUBLISHING.md`). Do not raise the version in an ordinary change. The website (a private project) takes the same version in its own files.

**Why 0.1.0-alpha.1 and not 1.0.0-alpha.1:** this is the first public release. A `1.0` would promise a stable surface the project does not have yet, and the old internal history
of this repository used `1.0.0-alpha.N` numbers and carries a `v1.0.0` tag, which `1.0.0-alpha.1` would sort below. `0.1.0-alpha.1` is a clean start;
`1.0.0` is for the day the maintainer calls the project stable.

## Publishing

Community files (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`), issue forms, labels, `.github/repo.json` (description and topics), CI and release workflows and
`scripts/publish.ps1` / `publish.sh` (check, init, push, meta, labels, changelog, release; a dry run unless told `-Execute`) and `scripts/update-github.ps1` / `.cmd` (checks, commit, push, tag and a new pre-release in one go; never replaces a release) are in place; the guide is `docs/PUBLISHING.md`.
**An agent never pushes, tags or publishes unless the maintainer asks for it in the same conversation**, never puts a key or a personal path in a file, and runs
`scripts/publish.ps1 check` before it says the repository is ready. Keep these files in step with the monorepo (`workcraft-monorepo`).

## Directory map

```
index.html                 the workspace page (CSP meta tag, CSS links, src/app/main.ts); /ide/ redirects here
docs/index.html            documentation page, renders src/docs/content.md
docs/*.md                  guides for people and agents: ARCHITECTURE, MCP-TOOLS, AI-PROVIDERS, AI-SUPPORT-REFERENCE, IPADOS-GUIDE,
                           IPADOS-COMPAT (the register of iPadOS measures and the engine contract), LEGAL
SOURCES.md                 every GitHub repository the project builds on, ships, connects to or learned from
skills/                    the 13 artcraft-skills (agentskills.io format) the assistant reads with read-skill
src/app/                   shell
  main.ts                  entry: top bar, tool rail, menu, keyboard shortcuts, theme, boot (the onboarding runs first; settings button is top right)
  onboarding.ts, onboarding-state.ts  first start: welcome (support link), workspace, where files are saved; runs BEFORE project, tree, chat and rail load; the pure rules (who sees it, what is remembered,
                           localStorage workcraft.onboarding) are in onboarding-state.ts (tests/server/onboarding.test.ts)
  brand.js, icons.js       brand.js is GENERATED (traced W mark and wordmark, from assets/workcraft/build/make-icons.mjs,
                           outside this repository); icons.js draws them: markSvg, logoSvg, wordmarkSvg (currentColor)
  settings.ts              interface prefs (localStorage workcraft.prefs), prefs.get/set
  bus.ts                   typed event bus (settings:change, workspace:change, chat:view, ...)
  theme-store.js (+ .d.ts) light/dark per scope ('ide' or 'home'), read/write/watch
  i18n.ts, i18n-de.ts      t() and tn(); English text is the key, German dictionary
  long-press.ts            onContextAction(): right click, pencil barrel button or a timed finger long press (Safari sends no contextmenu for it) -> one handler; used by the panel menu
  select.ts                the one dropdown: every <select> becomes a button plus listbox
  ui.ts                    dialog(), menu(), popover() and the overlay manager (claimOverlay): one menu, list or card open at a time,
                           a second tap on the opening button closes it; menu items may carry a right-click menu (context)
  info-tip.ts              the (i) icon (infoTip), condenseHints() for Settings and the Team editor, statusChip()
  palette.ts, search-ui.ts command palette (Ctrl/Cmd K), project search (Ctrl/Cmd Shift K)
  backend.ts               REST and WebSocket client, browser mode switch
  offline.ts, offline-extra.ts  browser mode (IndexedDB projects, no server)
  cloud-browser.ts         cloud storage in browser mode: the /api/cloud routes answered in the browser (Google Drive sign-in, a folder of the computer, sync of the open project,
                           open a project from the cloud); public/oauth-callback.html/.js is the sign-in landing page (tests/server/cloud-browser.test.ts)
  device.ts, notifications.ts, sounds.ts, status.ts, privacy.ts, logs.ts, util.ts (ROOT, h())
src/workspace/
  layout.ts                window manager: split tree, modes (normal, minimized, hidden, maximized), full screen, PiP
  registry.ts              tool registry: TOOLS, APP_IDS, accents, app versions (__OC_RELEASES__)
  pip.ts                   floating panels and native Document PiP for the chat
  popout.ts                separate browser window for one panel (?popout=1, second display), BroadcastChannel sync
  pencil.ts, pdf-pen.ts    Apple Pencil and touch handling
  panel-menu.ts            pure: what the right-click menu of a panel offers (panelActions over the facts of the panel) and the rows of Panel info; layout.ts builds and runs the
                           menu (header, tab, rail icon), tests/server/panel-menu.test.ts. The header itself has only Maximize and X; the other
                           buttons (full, min, pip, pop, unload) exist but are not shown, the menu clicks them to follow their state
  panels/craftapp.ts       an engine in an iframe: load, save, live sync, theme, render loop pause; attaches the iPadOS adapter and the
                           playgroundFiles bridge (window.__workcraftFiles); makes room first for a heavy app (launch-relief)
  panels/unavailable.ts    the panel of an app that has no web build in this installation (explains, opens the desktop app if installed)
  panels/code.ts, terminal.ts, settings.ts, settings-extra.ts, common.ts
src/ecosystems/            ecosystems (workspaces) of the apps of the catalog (44 at the time of writing: ArtCraft, community, independent). Read docs/ECOSYSTEMS.md first.
  catalog.json             THE list of apps (file types, iPad traits, repo, folder) and the built-in ecosystems. No version numbers
                           (public/releases.json and public/web-builds.json own them); read by catalog.ts and the scripts
  theme.ts                 pure: what each app does with the light/dark switch (catalog.json "theme": modes, via, look): themeOf, lookIn, kindOf, scriptMap (tests/server/theme.test.ts)
  catalog.ts               pure: appsFor / defaultAppFor (Open with, routing), lookupApp (names with spaces and dots), groupKey / appOfGroup / nativeAppsOf (tool-name groups,
                           file types), makeCustomEcosystem, sanitizeCustom, availabilityOf; CRAFT_IDS = the ids of catalog.json in the same order (a test checks)
  describe.ts              pure: what list-craft-apps answers (filters) and why open-in-app cannot open an app without a build (tests/server/ecosystems.test.ts)
  ecosystems.ts            the ecosystem in use (prefs ecosystem, ecosystemsCustom, ecosystemChosen), setEcosystem, ?ecosystem= link
  rail-order.ts            pure: the order of the app icons in the tool rail (orderApps, moveApp, stepApp, dropIndex; pref railOrder per workspace); main.ts does the dragging
                           (tests/server/essentials.test.ts)
  stage-plan.ts            pure: planLeave (what gives way when a workspace is entered), planStage (for "Open the first apps": one or two by device and stage width), tabBelongs
                           (tests/server/stage-plan.test.ts). The ONLY place that decides what the stage shows
  enter.ts                 enterEcosystem (hides the apps of the workspace you left, opens NOTHING), openFirstApps (the welcome page button, an explicit choice)
  ui.ts                    picker (ecosystemPickerBody: the cards and Create your own, used by the Switch workspace dialog and the onboarding), launcher; re-exports enterEcosystem
  offline-apps.ts          Keep these apps offline: asks the service worker to cache the engines of an ecosystem (storage-fit.ts: the pure quota check)
src/storage/               one storage for every app: the project. paths.ts (browser:/x <-> /x), recent.ts (Recent files, pure + localStorage),
                           recent-view.ts (DOM list), app-files-bridge.ts (the independent apps' playgroundFiles contract on top of the project)
src/ipados/                iPadOS support layer between the workspace and the engines. Read docs/IPADOS-COMPAT.md first.
  compat.ts                register of every compatibility measure (id, layer, problem, fix, opt-out) and the engine capability
                           manifest (meta craft-capabilities / window.__craftCapabilities). Add a measure here AND to the doc
  capabilities.ts          probeCapabilities(), runtimeMode(), planFor(): pure, injectable environment
  adapter.ts               attachEngine(): pointer bridge per manifest, engine signals, sharpness check, engine report
  pen-calibration.ts       pressure-less pens, hover and barrel roll learned from events (shared instance `pen`)
  pen-input.ts             pure Pencil rules: palm rejection, finger/keyboard rule, PenToolState (pen, eraser, barrel button),
                           scratch-out, eraser hit testing, hover circle geometry (tests/server/pencil.test.ts)
  finger-keyboard.ts       a finger tap does not raise the keyboard while the pencil writes (inputmode none for that focus)
  pen-ui.ts                HoverRing, the tool chip (penFlash), installPencilUi() wiring to the settings
  memory.ts                budget, levels, planRelief() and the MemoryGovernor (unloads hidden saved panels)
  stage.ts                 pure: which apps a workspace opens together on an iPad (weight points) and the start timeout by weight
  touch-keys.ts            pure: the key tables of the touch keys bar (FilmCraft `video`, ProCraft `paint`, catalog `traits.keys`), the key events they make, when the bar shows (src/workspace/touch-keys-ui.ts is the bar;
                           tests/server/touch-keys.test.ts). Idea from the community iPad build of FilmCraft by wildrcat, see SOURCES.md
  session.ts               pure: did the last session end from outside (Safari closed the tab)? Lowers the memory budget of the next one
  opfs.ts, opfs.worker.ts  large files of browser mode in OPFS through a worker; used by app/offline.ts
  isolation.ts             cross-origin isolation on demand (the service worker adds COOP and COEP)
  index.ts                 the hub: installIpados(), the `ipados` object, window.__workcraftIpad
                           Rules: no engine version numbers anywhere (a test checks); never block an engine, report a failed
                           measure instead; keep compat.ts, craft-frame.js and docs/IPADOS-COMPAT.md in step (tests check)
src/chat/
  model-choices.ts         pure: what the Model and Base URL dropdowns of Settings > AI models offer (suggested models per provider, alternative addresses, the server presets of an own endpoint; mergeChoices keeps a saved value); the DOM part is src/workspace/panels/choice-field.ts (tests/server/model-choices.test.ts)
  sidebar.ts               chat UI: sidebar, Full Chat Mode, history drawer, tool cards, footer
  agent.ts                 the tool loop of one agent (validation, self-correction, approvals)
  app-roles.ts             pure: one specialist per catalog app (`@<app>-agent`), generated from catalog.json; office apps keep grid/word/deck/pdf
  model-recovery.ts        pure: a 404 for the model asks the provider's list and picks the closest model (providers.ts repeats the request once);
                           model-notice.ts shows the "Keep this model" notice; step-view.ts: tool card names, clock, totals
  team.ts, team-runner.ts, team-ui.ts   Team Mode: task DAG, scheduler, review, Mission Control; patterns (supervisor,
                           sequential, parallel, human), shared memory, agents you create (AgentProfile, registerAgents)
  essentials.ts            pure: the question cards of the empty chat (one per app of the workspace, welcomeCards) and the short persona list (suggestedPersonas)
  agents-ui.ts             editor of one agent (color, icon, tool groups); skills.ts (index for the prompt); craft-icons.ts
  adapters/claude.ts, gemini.ts, openai.ts, ollama.ts   raw-fetch provider adapters (no SDKs)
  providers.ts, models.ts, params.ts, config.ts, http.ts   provider list, model rules, parameters
  budget.ts, tokens.ts, usage.ts, telemetry.ts             context budget and token numbers
  mentions.ts, markdown.ts, attachments.ts, history.ts, complete.ts, deepseek.ts, approval.ts (manual / auto approval), loop-guard.ts
  economy.ts               token economy (pure): tool router + find-tools, compact schemas of foreign tools, compactTurns (tests/server/economy.test.ts)
  team-status.ts           status per agent, roster status and progress line of Mission Control (pure, tests/server/team-ux.test.ts)
  voice.ts, voice-audio.ts, voice-text.ts   voice input: state machine and recording, 16 kHz WAV and engine choice, "at gridcraft" to @gridcraft
  role-icons.ts            roleIcon(): Craft app logos, the WorkCraft mark, stroke icons for agents you create
  pet.ts, pet-state.ts     Blip, the chat companion (states incl. listening; color, accessory and accent from the prefs chatPetTheme, chatPetAccessory, chatPetAccent) (mascot kit in blip.js and styles/blip.css): which pose fits the moment
  tool-icons.ts            icon of a tool call (the tools of the apps keep their logo)
src/mcp/
  schemas.ts               every tool as a Zod schema (TOOL_DEFS); shared by server and browser
  orchestrator.ts          MCP client in the browser: validate, call, report, write locks
  locks.ts                 per-file write mutex (Team Mode)
  panel-server.ts, browser-server.ts, lazy.ts   MCP server for the panels inside the browser
src/project/               manager.ts (projects), fs.ts (file mirror), tree.ts (project tree)
src/server/                Hono backend (Node 22+)
  index.ts                 routes, security headers and CSP, static files from dist/, start
  ai.ts                    AI router and SSE streaming
  tools.ts, office/*       server side of the MCP tools (sheets, docs, slides, pdf, formula)
  mcp.ts                   Streamable HTTP MCP server at /mcp, MCP client for external servers and the Craft apps
  craft.ts, skills.ts      the 19 Craft apps with a CLI as MCP servers (discovery, live ports, the flags of each CLI); agentskills.io skills (skills/)
  mcp-validator.ts         the JSON Schema validator of the backend's MCP clients: Rust number formats (uint8 ...) do not print Ajv warnings (tests/server/mcp-validator.test.ts)
  cloud.ts, cloud-routes.ts  Google Drive (OAuth PKCE) and folder providers (iCloud Drive, OneDrive) as SyncAdapters
  bridge.ts, routes-ai.ts  snippets for other IDEs; REST routes of craft, skills, bridge, cloud
  apicraft.ts             release logic of apicraft ported 1:1 (versions, latest release, changelog); used by updates.ts
  voice.ts                 voice input on the desktop: finds Handy, lists its models, transcribes a WAV with `handy --transcribe-file --json`
  terminal.ts, projects.ts, search.ts, memory.ts, snapshots.ts, trash.ts, graph.ts,
  objects.ts, export.ts, share.ts, sync.ts, plugins.ts, audit.ts, logs.ts, usage.ts, config.ts,
  lan.ts (home network pairing), tls.ts (HTTPS for the home network, mkcert certificate checks), paths.ts, fsutil.ts,
  seed.ts (sample project), tokenizer.ts
src/core/                  no DOM, no Node: search ranking, three-way sync, Markdown, defaults,
                           JSON repair, BPE tokenizer
src/project/desktop.ts      the installed desktop Craft apps next to the panels: Open in the desktop app (tree menu, panel menu)
src/project/add-files.ts   the + menu: Upload files (every device but an iPad) or Scan a document (iPad: the picker sheet that offers Scan Documents); files go to /Uploads or /Scans and open; the pure rules are in add-files-rules.ts (tests/server/add-files.test.ts)
src/styles/                polish.css (loaded last: consistency pass, (i) tips, status chips, window header, Team Mode without glow), tokens.css (colors, fonts, radii), base.css, workspace.css, tools.css, chat-ui.css (chat polish,
                           loaded after tools.css), blip.css (the companion)
src/docs/                  content.md, main.ts (renderer, search, docs assistant), docs.css
public/
  voice-worklet.js         AudioWorklet that records the microphone for voice input (src/chat/voice.ts)
  craft-theme.js           runs inside each app: light/dark, theme scope, WordCraft/DeckCraft switches, the CSS bridge (@media prefers-color-scheme),
                           a one-look app told its look; embeds the per-app theme map (generated by scripts/sync-themes.mjs). Read docs/THEMING.md first
  craft-files.js           runs inside each app in a panel: globalThis.playgroundFiles (independent apps file contract) asked of the workspace; absent when the page is opened alone
  craft-frame.js           runs inside each app: viewport, pixel ratio, Retina fit, forced layout, gesture lock, resource meter,
                           signals (gpu-lost, needs-isolation); lists the measures it ran in __ocFrameInfo.measures
  sw.js                    service worker (offline cache; APPS cache name per release; COOP/COEP on demand)
  releases.json            single source of release data of the four office apps; web-builds.json is the same for the other apps (written by apps:fetch / apps:import)
  assets/                  icons, logos (.webp), sounds, tokenizers/deepseek-v4.bin
versions/                  organized by origin: artcraft/, community/, independent/ (Rust source trees), web-builds/<app>-web-<ver>/ (every installed web build),
                           and zip/{artcraft,community,independent}/ (source and web release archives). Only the four office web builds
                           (wordcraft-web-*, gridcraft-web-*, deckcraft-web-*, pdfcraft-web-*) are tracked in git, byte for byte (.gitattributes -text)
scripts/
  dev.mjs                  backend (tsx --watch-path=src) plus Vite (--lan, --https)
  lan-cert.mjs             npm run lan:cert: HTTPS certificate for the home network with mkcert
  copy-apps.mjs            web builds into dist/apps/, web zips into dist/downloads/
  patch-apps.mjs           startup fixes for web builds (.wasm.gz preload strip, direct streaming; idempotent) and a report of a MailCraft build that panics on std::time (no wasm patching: see docs/ECOSYSTEMS.md)
  sync-themes.mjs          npm run themes:sync: writes the theme map of public/craft-theme.js from catalog.json (the test fails when it is stale)
  audit-apps.mjs           npm run apps:audit: every app on its own in a real browser, OS theme opposite to the WorkCraft theme: does it start, does it follow
  audit-panels.mjs         npm run apps:audit-panels: every app inside a workspace panel on a desktop screen (dev server, temporary data folder)
  check-versions.mjs       npm run versions [--remote] [--strict]: versions/ against releases.json and web-builds.json, optionally against the newest GitHub
                           release of every catalog repository (apicraft release logic, releases.atom when the anonymous quota is used up); changes nothing
  fetch-apps.mjs           npm run apps:fetch (GitHub releases, per-app asset pattern, channel source skipped) and apps:import (a local folder, default versions/): lists by default,
                           --yes installs the web builds of the other apps into versions/web-builds/ and public/web-builds.json (zip
                           checks, no brand/ or host files, layout fix for split builds)
  releases.mjs             release data, Vite plugin for /apps/ and /downloads/
  precache.mjs, postbuild.mjs, clean-urls.mjs, check-clean.mjs, build-tokenizer.mjs,
  github-metadata.mjs, pack-web-zips.ps1, web-launcher/serve.ps1
tests/
  server/*.test.ts         node:test through tsx (npm test)
  e2e.mjs                  Playwright, the main end-to-end run (npm run test:e2e)
  e2e-features.mjs         Playwright, trust and privacy features
  e2e-ipad.mjs             Playwright WebKit at iPad sizes
```

## Commands

```sh
npm install
npm run dev            # http://localhost:5175/ (backend :5176)
npm run typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.server.json --noEmit
npm test               # backend tests
npm run test:e2e       # PLAYWRIGHT_MODULE=<playwright or playwright-core> CHROMIUM=<chrome or edge>
npm run check:clean    # also runs as the pre-commit hook: git config core.hooksPath .githooks
npm run build          # dist/ and dist-server/
npm start              # production server
```

Run all five checks before you call a change done: typecheck, test, test:e2e, check:clean, build.

## State management rules

1. **The workspace switch is the one source of truth for the theme** (docs/THEMING.md): an app that has both looks follows it, an app with one look
   keeps it and its panel is painted for it. Every app has a `theme` in `catalog.json`; a new app needs one (measure it with `npm run apps:audit`).
   **Two theme scopes.** The workspace (shell, Full Chat Mode, PiP, the apps inside panels) uses scope
   `ide`: localStorage `oc-ide-theme` plus `oc-ide-theme-at`, cookie `oc_ide_theme=<theme>.<ms>`,
   BroadcastChannel `oc-ide-theme-channel`. The website, the docs page and an app opened on its own
   use scope `home`: `oc-home-theme`, `oc_home_theme`, `oc-home-theme-channel`. Changing one never
   changes the other. Use `readTheme(scope)`, `writeTheme(theme, scope)`, `watchTheme(fn, scope)`
   from `src/app/theme-store.js`; the head scripts and `public/craft-theme.js` inline the same logic.
   In the workspace the theme is `prefs.get('theme')`; `applyTheme` in `main.ts` posts
   `{ type: 'workcraft:theme', scope: 'ide' }` to every app iframe, which switches in place.
2. **Prefs.** `localStorage` key `workcraft.prefs` (`src/app/settings.ts`). Change with `prefs.set`,
   react to `bus.on('settings:change', ({ key }) => ...)`. Never write the key directly.
3. **Language.** English is the default and the source text. `localStorage` `oc-ide-lang` = `de`
   switches to German after a reload. Wrap visible strings in `t()` (or `tr()` where `t` is taken)
   and add the German entry to `src/app/i18n-de.ts`. Server messages, MCP tool descriptions and
   everything sent to a model stay English.
4. **Data on disk.** The backend owns `~/workcraft` (`WORKCRAFT_HOME`): `projects/<id>/` files,
   `<project>/.workcraft/` chats, layout, memory, index, snapshots; `config.json` settings and API
   keys (the browser only ever sees masked keys); `audit.jsonl`, `usage.json`, `.trash/`.
5. **Release data.** `public/releases.json` only. Code in `src/` must never import from `public/`
   (Vite refuses it in dev); the workspace gets the data through the define `__OC_RELEASES__`.
6. **Panels and iframes.** Panels move by repositioning; never re-parent an app iframe, it would
   restart the WebAssembly app and lose unsaved state.

## MCP tool schema rules

- Every tool is one entry in `TOOL_DEFS` in `src/mcp/schemas.ts`: `name` (kebab-case, verb first,
  for example `read-sheet`), `title`, English `description`, `app`, `side` (`server` or `client`),
  a Zod `input` object, plus `pathArg` (the edited file), `writes` (panels refresh) and `approval`
  (needs a confirmation) where they apply.
- The same definitions feed the backend MCP server, the browser orchestrator, the `/` commands and
  the tool definitions sent to models. Do not duplicate a schema anywhere else.
- Keep the order of existing tools. Tool lists go to the models in a fixed, sorted order so the
  provider's prompt cache hits; the e2e test checks it.
- Provider differences are handled by `compileToolSchema` (strict schemas for OpenAI and Claude,
  `functionDeclarations` for Gemini) and `normalizeToolArgs`. Validate every call with
  `validateArgs` before it runs; invalid arguments go back to the model once for a self-correction.
- Writes to the same file are serialized by `src/mcp/locks.ts`; reads never wait.
- A new tool needs: the schema, the implementation (`src/server/tools.ts` or the panel server), a
  test in `tests/server/`, and a line in `src/docs/content.md` and `docs/MCP-TOOLS.md`.

## Conventions

- Strict TypeScript, ES modules, no `any` without a reason in a comment.
- English for code, comments, tests, commit messages and the sample project.
- Interface copy: plain words, no em dashes, no exclamation marks.
- Design: monochrome surfaces (light paper, dark carbon) with `.frame` and `.well`; app accents
  (`#335CFF` WorkCraft, `#3B82F6` WordCraft, `#10B981` GridCraft, `#F97316` DeckCraft, `#14B8A6`
  PdfCraft) only on app marks; DM Mono for labels and numbers; no gradients; links in ink with a
  quiet underline; 44 px touch targets on iPad; every color defined for light and dark.
- Selects are enhanced by `src/app/select.ts`, checkboxes are styled in `src/styles/tools.css`.
  Use plain `<select class="input">` and `<input type="checkbox">`; do not build another dropdown.
- No third-party scripts, no CDN. Fonts come from `@fontsource`.
- When rewriting files on Windows, keep UTF-8 and the existing line endings.

## Testing rules

- The e2e tests start their own stack on ports 5185, 5186 and 5299 with a temporary data folder.
  Never point a test at the dev server on 5175 and 5176: that one uses the real `~/workcraft`.
- Do not edit files under `src/` while an e2e run is going: the dev servers watch `src/` and reload.
- Mock model scripts strip the `<context>` and `<session>` blocks before matching keywords.
- A new installation starts with an empty **My project**. The test stacks set
  `WORKCRAFT_FIRST_PROJECT=sample` so they start with the sample project; a test that needs the
  default must leave it unset (see `tests/server/projects.test.ts`).
- The version the workspace reports lives in `src/core/version.ts` and must equal `package.json`.
- `tests/server/releases.test.ts` skips the website checks here (no homepage in this repository).

## Do not

- Commit `~/workcraft` data, `.env` files, keys or databases (`check:clean` stops most of it).
- Copy anything from an engine's `docs/brand/` folder, or use the ArtCraft name or logos as branding.
- Change files in `versions/` by hand; use `scripts/patch-apps.mjs` and `releases.json`.
- Add network calls to services the user did not configure.
- Keep an app list anywhere but `src/ecosystems/catalog.json` (and `CRAFT_IDS` in catalog.ts, which a test keeps equal), or put a version
  number in it. Versions live in `public/releases.json` (the four office apps) and `public/web-builds.json` (the rest, written by
  `npm run apps:fetch`). A new app build needs the fetch command, never a code change.
- Download the build of a community (the independent apps, `origin: independent`) app on your own initiative, or commit one: they come from third-party
  repositories with their own licences (ten are GPL-3.0). `npm run apps:fetch` lists first and downloads only with `--yes`, and `versions/web-builds/` is git-ignored.
- Add an app to `CRAFT_APPS` (`src/server/craft.ts`) without reading the flags of its `apps/<app>-cli` source: the `mcp` arguments differ per app.
- Copy code from a source whose licence does not fit MIT OR Apache-2.0 (ONLYOFFICE and ranuts/document are AGPL-3.0): follow the contract or idea, write it fresh, and name it in `SOURCES.md`.
- Track `versions/web-builds/` (git ignores it: one engine can exceed GitHub's 100 MB file limit) or unpack a zip without the checks of
  `scripts/fetch-apps.mjs`.
- Tie an iPadOS fix to an engine version, or patch an engine's files for iPadOS. Add a measure to `src/ipados/compat.ts`
  (and `public/craft-frame.js` or the adapter) that checks a capability or a signal, document it in
  `docs/IPADOS-COMPAT.md`, and let the engine opt out with a manifest token.
