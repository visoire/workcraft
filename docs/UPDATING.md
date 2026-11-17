# Updating apps and adding new ones

A step-by-step guide for people and AI agents. Read it fully, then follow it in order. When this file and the code disagree, the
code wins: fix this file in the same change. Everything below was done by hand; the commands are real.

**Two tasks, two sections:** "Update the apps" (section 2) and "Add a new app" (section 3). Sections 1 and 4 to 7 apply to both.
If you were told "update all apps", do section 2 only. If you were told "add app X", do section 3, then the checks of section 6.

---

## 1. How versions work here

### The rule

**No version number lives in code.** A version is a folder name plus one record in a manifest. An update is data, never a code change.
(`AGENTS.md`, "Do not": never keep an app list or a version number anywhere but the files named below.)

### Where things live

| What | File or folder | Written by | Tracked in Git |
| :--- | :--- | :--- | :--- |
| The list of apps, who makes them, licence, file types, iPad traits, how a build is obtained | `src/ecosystems/catalog.json` (and `CRAFT_IDS` in `src/ecosystems/catalog.ts`) | you, by hand | yes |
| Release data of the four **office** apps (WordCraft, GridCraft, DeckCraft, PdfCraft): version, date, web folder, zip size, Windows downloads | `public/releases.json` | you, by hand | yes |
| Web builds of **every other app**: version, folder, source, fixes | `public/web-builds.json` | `scripts/fetch-apps.mjs` (never by hand) | yes (the manifest) |
| The source folders and web builds you were given or downloaded | `versions/{artcraft,community,independent}/` and `versions/web-builds/` | you, or the user | only the four office web builds |
| The installed copies of the non-office web builds | `versions/web-builds/<app>-web-<ver>/` | `npm run apps:import` / `apps:fetch` | no (git-ignored) |
| Icons | `public/assets/logos/<id>.webp` (office), `public/assets/craft/<id>.png` (all others, 128 px) | you | yes |
| The service worker's cache name for the office apps | `const APPS = 'workcraft-apps-vN'` in `public/sw.js`, and `appsCache` in `public/releases.json` | you, by hand | yes |
| Desktop CLI list (MCP servers) | `CRAFT_APPS` in `src/server/craft.ts` | you, by hand | yes |
| The release/version logic of apicraft (used to ask GitHub) | `src/server/apicraft.ts` | ported from `artcraft/apicraft`, do not rewrite | yes |

### The `versions/` folder (organized by origin)

```
versions/
  <app>-web-<ver>/             web builds of the four office apps (tracked)
  web-builds/<app>-web-<ver>/  installed, patched web builds of the other 40 apps (not tracked)
  artcraft/<app>-<ver>/        Rust source trees of ArtCraft apps (not tracked)
  community/<app>-<ver>/       Rust source trees of Community apps (not tracked)
  independent/<app>-<ver>/     Rust source trees of independent apps (not tracked)
  zip/{artcraft,community,independent}/  only archives that nothing else holds: an older build kept for rollback, a build nobody installed (not tracked)
```

**Nothing is kept twice.** A web build is the folder that runs (the office folder at the root, or `web-builds/`); a source tree is the extracted Rust source; neither is
also kept as a zip, and a web build is not also kept extracted next to its zip. `fetch` and a manual unzip can leave such a second copy behind: delete the copy that
duplicates another, after checking that the other one is complete (the same file list). What stays in `zip/` is only what no folder holds: the previous version of an
app that was just updated (the rollback), or a build that was never installed. The source tree of an app and its web build are different things (code, and what the
browser runs), not duplicates.

- `import` and `fetch` copy or download into `versions/web-builds/` and never touch the office folders at the root. Rollback of an office app is Git (the old folder
  is in the history); of any other app, the zip of the previous version in `zip/`, or `apps:fetch` with the old release (see Rollback).
- The four office apps are served **directly** from `versions/<app>-web-<ver>/` (`officeWebDir()` in `scripts/releases.mjs`) and
  tracked in Git byte for byte (`.gitattributes`: `/versions/** -text`, because their `index.html` carries Subresource Integrity hashes).
- Not an app of the catalog: `artcraft-launcher-web-*` (it installs desktop apps; it edits nothing). The importer lists it and skips it.

### Three ways a web build reaches the workspace (`channel` in `catalog.json`)

| `channel` | Meaning | Command |
| :--- | :--- | :--- |
| `release` | the repository publishes a web zip (`<app>-web-<ver>.zip`, or the regex in `asset`) | `npm run apps:fetch -- --yes --app <id>` |
| `pages` | the app itself is deployed on GitHub Pages (`pages` = its URL); no zip | `npm run apps:fetch -- --yes --app <id>` (mirrors the site: `scripts/mirror-pages.mjs`) |
| `source` | no web release, no Pages app; only built from source | none to fetch: you provide a build folder, then `npm run apps:import` |

A local folder always works too: put `<id>-web-<version>/` into `versions/` and run `npm run apps:import -- --yes --app <id>`.

### What the install changes (so an upstream build works unmodified in a panel)

Applied by `scripts/fetch-apps.mjs`, recorded per app in `public/web-builds.json` under `fixes`:

- host files are dropped (`.htaccess`, `_headers`, `.br`/`.gz` copies of files that exist uncompressed), `brand/` folders are never copied;
- `app-snippets`: a split build (PhotoCraft) gets `snippets/` copied to `app/snippets/` too (still needed in 0.23.1);
- `relative-paths`: an `index.html` that names its files from the site root (`/firecraft-web-<hash>.js`) is rewritten to `./...`
  (FireCraft 0.2.5; without it the app never starts under `apps/<id>/`).

If a new build fails to start because of its layout, add a **pure, tested** fix next to these (see `relativizeRootPaths`), never edit
the files in `versions/web-builds/` by hand (they are overwritten by the next install).

---

## 2. Update the apps ("update all apps")

Work in this order. Do not skip step 1 or step 9.

1. **Look first, change nothing.**
   ```bash
   npm run versions                  # versions/ against releases.json and web-builds.json (offline)
   npm run versions -- --remote      # + the newest GitHub release of every catalog repository (apicraft logic)
   ```
   It lists, per app: what is registered, what the `versions/` folder holds, what upstream has, and the command that fixes each gap.
   Anonymous GitHub access is 60 requests an hour; the command falls back to each repository's public `releases.atom` feed when the
   quota is gone. `GITHUB_TOKEN` plus `--token` lifts the limit. Nothing is downloaded or written.
2. **Get the new builds** into `versions/` (the user may already have put them there). For a release channel app you can skip this
   and let `apps:fetch` download it in step 4. Never download an app the user did not ask for: community apps come from third-party
   repositories with their own licences (ten are GPL-3.0); `apps:fetch` lists first and downloads only with `--yes`.
3. **Office apps** (WordCraft, GridCraft, DeckCraft, PdfCraft), by hand:
   - edit `public/releases.json`: `version`, `tag`, `date`, `web` (`<app>-web-<ver>`), `webZipBytes` (size of `versions/zip/<app>-web-<ver>.zip`),
     `windows` (the exact asset sizes of the GitHub release; only the architectures the release has; x64 and ARM64 since 2026-11);
   - change `appsCache` in the same file **and** `const APPS` in `public/sw.js` (next number) and the comment above it: the old
     WebAssembly caches must leave the devices;
   - the README table "App releases" (`README.md`): version, date, folder size, zip size, Windows sizes. `tests/server/releases.test.ts` checks every cell;
   - `.gitignore` already tracks `/versions/<app>-web-*/` for the four apps; check that no file is over 100 MB (`npm run check:clean` warns from 50 MB).
4. **All other apps**:
   ```bash
   npm run apps:import                                # list what versions/ holds and what would be copied
   npm run apps:import -- --yes                       # copy the newest build of every non-office app (no network)
   npm run apps:import -- --yes --app mailcraft,photocraft
   npm run apps:fetch                                 # list upstream builds (release and pages channels), downloads nothing
   npm run apps:fetch -- --yes --app <id>[,<id>]      # install them (the sha256 GitHub reports is verified)
   npm run apps:fetch -- --yes --max-mb 2000          # builds above 300 MB are skipped unless you raise this (Honeydew's web zip is 1.36 GB)
   ```
   Both write `public/web-builds.json`. Run `npm run versions` again: nothing should be left to import.
5. **If an app got a new file type or changed formats**, update its `opens` / `imports` in `src/ecosystems/catalog.json` (the lists are
   lower case, an extension is either in `opens` or in `imports`, never both). Do not touch them for a plain version bump.
6. **If the app ships a CLI with an MCP server** and its flags changed, read `versions/<app>-<ver>/apps/<app>-cli/src/main.rs` and
   update its line in `CRAFT_APPS` (`src/server/craft.ts`) and the table in `docs/MCP-TOOLS.md`. Flags differ per app; never copy another app's.
7. **Icons**: only if the app's icon changed. Render `versions/<app>-<ver>/assets/app-icon/hicolor/256x256/apps/*.png` to 128 px into
   `public/assets/craft/<id>.png`. Keep the existing file otherwise.
8. **Rebuild and run the checks** of section 6.
9. **Start every updated app in a panel** (section 6) before you say it is done. An update that does not start is not an update.
10. **Documentation and changelog** (section 5). Raise the alpha number.

### When an upstream build is broken

Typical, seen in practice:

| Symptom | Cause | What the workspace does | What you do |
| :--- | :--- | :--- | :--- |
| Panel says "Start failed … a Rust panic" | `RuntimeError: unreachable`: the engine's own code panicked (MailCraft 0.12.0 and SubCraft: `time not implemented on this platform`; Chromaforge/LightCraft Classic 26.46.2 to 26.47.1: `no pids on this platform`) | the panel shows the message and the build's version | Serve the **unmodified** upstream build on its own (a static server) to prove it is upstream. If so, keep it installed, write it into the changelog under "Known problems", and re-check at the next update. Do not patch the wasm to cut out a panic: the compiler deletes the code after a call that never returns, so a cut-out ends in a corrupted heap (MailCraft 0.12.0 did, a dead engine behind a picture). Install an older or newer official web build that works instead (MailCraft ran 0.11.1 until 0.13.0 fixed it) and say so in the changelog |
| "already open in another tab" | a one-window app (Web Lock) while another panel holds the same lock (LightCraft and LightCraft Classic share `lightcraft-library`) | the panel names the conflict | close the other panel, reload; document the pair |
| "needs Cross-Origin-Opener-Policy …" | the engine needs shared memory (catalog `isolated: true`, Lemon Studio) | the panel says so and offers the isolation switch (service worker, HTTPS or localhost) | none, unless you can test with a real service worker |
| App never leaves "loading" | usually a root-absolute path in `index.html`, or a missing file | the start timeout message | open `/apps/<id>/` on its own, read the console, add a layout fix (section 1) |

The previous good build is still in the flat `versions/` folder: roll back with section 7.

---

## 3. Add a completely new app

Do **all** of these. The test suite fails when one is missing (`tests/server/ecosystems.test.ts`, `ai-workspace.test.ts`).

1. **Find the facts** (do not guess): repository, licence (SPDX id from its `LICENSE`), how its web build is published (release zip,
   Pages, nothing), the file types it opens, what it needs (WebGPU, shared memory, audio). For a repository you do not know, read its
   README and releases; `npm run apps:fetch` and the `releases` API (through `src/server/apicraft.ts`) tell what assets exist.
2. **`src/ecosystems/catalog.json`**: one object in `apps` (copy a neighbour). Fields: `id` (lower case letters, digits, hyphen, at most
   24 characters: the service worker refuses longer ids), `name`, `kind`, `accent`, `repo`, `folder`, `origin` (`artcraft` / `community` /
   `independent`), `license`, `channel` (+ `asset` regex or `pages` URL), `isolated` if it needs shared memory, `blurb`, `opens`,
   `imports`, `traits` (`weight`: light/medium/heavy, `pen`: precise/pressure, `audio`, `needsFiles`).
   No version number in this file (a test fails on one).
3. **`CRAFT_IDS` in `src/ecosystems/catalog.ts`**: the same id, in the same position as in `catalog.json` (a test compares the two).
4. **Ecosystems**: add the id to the `apps` of every ecosystem it belongs to in `catalog.json` (a new app should be in at least one; the
   picker lists all apps in "Create your own" regardless). A new ecosystem needs a unique `id` and an `accent`; the five old ids
   (`office`, `imaging`, `motion`, `design`, `cad`) must stay.
5. **Icon**: `public/assets/craft/<id>.png`, 128 px. (Office apps: `public/assets/logos/<id>.webp`.) Without a file the app shows a monogram.
6. **Get the build**: section 2, step 4. Then `npm run versions` shows it as registered.
7. **File routing**: check `opens` does not steal a type that another app of the same ecosystem should keep (a double click picks the
   first app that opens the type natively, in catalog order; `TextCraft` opens `.txt`, `.md`, `.log` only so WordCraft and the code editor keep the rest).
8. **MCP** (only if the app ships `<id>-cli` with an `mcp` command): one line in `CRAFT_APPS` in `src/server/craft.ts` with the flags
   read from its CLI source, a unique control port (the test checks), and a row in `docs/MCP-TOOLS.md`. Apps without a CLI need nothing:
   the AI reaches their files through the project tools and `open-in-app`.
9. **Rust chat** (separate repository): one `AppSpec` in `workcraft-ai/crates/agents/src/craft/spec.rs`.
10. **German**: UI strings are in `src/app/i18n-de.ts`; blurbs and kinds fall back to English, which is acceptable, say so in the changelog.
11. Sections 5 and 6.

### Common pitfalls

- **A hyphen in the id**: the MCP tool name is `ext-<id without hyphens>-<tool>` (`craft-anything` is `ext-craftanything-…`).
  Use `groupKey()` / `appOfGroup()` from `catalog.ts`; never split a tool name on hyphens yourself.
- **Two apps, one lock or one storage name**: two panels that open the same IndexedDB or Web Lock refuse each other. Test both open at once.
- **Root-absolute paths** in `index.html` (`/app.js`): fixed by the `relative-paths` install fix; check a new build's `index.html`.
- **`opens` and `imports` overlap**: a type is in one list or the other.
- **Version in `catalog.json`**: not allowed. Versions come from the manifests.
- **Downloading on your own initiative**: community apps are third-party code under their own licence; fetch only what the user asked for, keep them out of Git.
- **Editing `versions/web-builds/` by hand**: overwritten by the next install; fix it in the script instead.
- **Counting apps in copy**: the numbers (44 apps, 19 desktop CLIs, ten workspaces) appear in README, `docs/ECOSYSTEMS.md`, `docs/ARCHITECTURE.md`,
  `docs/MCP-TOOLS.md`, `src/docs/content.md`, `AGENTS.md` and the home repository. Search for the old number (`grep -rn "44 apps"`).

---

## 4. AI and MCP: what must be true so the AI can use an app

| Need | Where | Check |
| :--- | :--- | :--- |
| The AI knows the app exists, its file types, origin, licence, whether it has a build | `catalog.json` is read by `list-craft-apps` (`src/ecosystems/describe.ts`, `src/mcp/panel-server.ts`) | call `list-craft-apps` with `app: "<id>"` or `type: "<ext>"` |
| The AI can open it with a file | `open-in-app` resolves names with spaces and dots (`lookupApp`: `Pro Wave`, `Paint.RS`, `Craft Anything`) | `open-in-app { app, path }`; an app without a build answers with how to get one |
| The tools of its CLI reach the model | `CRAFT_APPS` in `src/server/craft.ts` → `src/server/mcp.ts` connects `<id>-cli mcp` as `ext-<id>-<tool>` | Settings, Craft apps; `GET /api/mcp/external` shows `status`, `attempts`, `retry_in_s` |
| The model gets the app's tools for a question | `routeTools` in `src/chat/economy.ts` offers a group when the question names the app (also "craft anything"), uses a keyword of a tool, or refers to a file the app **opens** (from `catalog.json`); never more than `MAX_TOOLS` (120) | `tests/server/economy.test.ts` |
| Icon on tool cards and team lanes | `public/assets/craft/<id>.png` through `craftIdOfTool()` in `src/chat/craft-icons.ts` (reads the catalog) | open a chat, call a tool of the app |
| Display name | `name` in `catalog.json` (also used by the picker, launcher, rail, palette) | |
| Tools of the **workspace** itself (`read-sheet`, …) | `src/mcp/schemas.ts` (`TOOL_DEFS`, never reorder, append only), implementation in `src/server/tools.ts` or `src/mcp/panel-server.ts`, a test, a line in `docs/MCP-TOOLS.md` and `src/docs/content.md` | only for new workspace tools, not for a new app |

Reliability you get for free, and must not break: `tools/list` paging, retry of a failed server (15 s … 5 min), one reconnect and repeat
of a call that finds its process gone, one shared sync run (`src/server/mcp.ts`). Provider limits: at most 120 tools per request
(`docs/AI-PROVIDERS.md`). Single and Team mode use the same tool list; nothing app-specific is needed for Team Mode.

---

## 5. Documentation and changelog (every change)

Say what changed, in the same change (`AGENTS.md`, "Versioning, changelog and docs"):

1. The version number is raised only when a release is cut (`0.1.0-alpha.N` → `N+1` in `package.json`, `package-lock.json` (two places), `src/core/version.ts`, the version line of `README.md`;
   `tests/server/projects.test.ts` keeps `version.ts` and `package.json` equal). An app update goes under `## [Unreleased]` until then.
2. `CHANGELOG.md`: a line under `## [Unreleased]` at the **top**. Never rewrite a released entry. Say: which apps moved to which
   version, what was added, **what is verified and what is not**, known problems (upstream breakage by name and version). Plain words,
   no em dashes, no exclamation marks.
3. Files to touch, by change:

   | Change | Update |
   | :--- | :--- |
   | any version | `README.md` (table "App releases"), `public/releases.json` / `public/web-builds.json`, `CHANGELOG.md` |
   | new or removed app | `docs/ECOSYSTEMS.md` (tables of origins and ecosystems, counts), `README.md` (workspace table), `docs/ARCHITECTURE.md`, `src/docs/content.md` (in-app docs), `SOURCES.md` (repository, licence), `AGENTS.md` (counts), this file if the process changed |
   | MCP / CLI | `docs/MCP-TOOLS.md` (tool table, "How the CLIs are started"), `docs/AI-SUPPORT-REFERENCE.md` section 8 |
   | AI provider or tool routing | `docs/AI-PROVIDERS.md`, `docs/AI-TOKENS.md` |
   | iPad-relevant (memory, audio, pen, isolation) | `docs/IPADOS-COMPAT.md` (register of measures), `docs/IPADOS-GUIDE.md` |
   | interface text | `src/app/i18n-de.ts` (German), English is the source text |
   | new dependency or repository | `SOURCES.md` |

4. **Keep WorkCraft home in step** (separate repository `workcraft-home`): the same version in `public/workspace.json`, a new release at the top
   of `public/changelog.json`, `public/releases.json` (office apps) with `public/api/knowledge.json` and its README table, `public/craft-apps.json`
   (versions of the other apps mirror `public/web-builds.json`; logos in `public/assets/apps/<id>.png`), its `CHANGELOG.md`,
   and `npm run seo:llms` after the FAQ or counts change. Run its `npm test`.
5. Write the verification honestly. "Verified" means you ran it and saw it. Everything else goes under "Not verified".

---

## 6. Testing checklist

Run these from the repository root. Do not run tests against the dev server on ports 5175 and 5176 (real user data); the e2e suite starts its own stack on 5185 and 5186.

```bash
npm run typecheck
npm test                 # backend tests (WORKCRAFT_NO_CRAFT_DISCOVERY=1 keeps it from finding installed desktop apps)
npm run check:clean      # keys, personal paths, files over 100 MB
npm run build            # dist/ and dist-server/; copies the apps into dist/apps/
npm run test:e2e         # Playwright
```

Then **look at it**:

- [ ] `npm run versions` shows nothing left to import or update (or says why).
- [ ] Start the stack on test ports (`WORKCRAFT_HOME=<temp folder> WORKCRAFT_PORT=5186 WORKCRAFT_UI_PORT=5185 WORKCRAFT_NO_CRAFT_DISCOVERY=1 node scripts/dev.mjs`) and open
      `/?ecosystem=<id of an ecosystem that has the app>`.
- [ ] The picker shows the app with its icon, equal-height neutral cards, status line "N of M apps ready" at the bottom edge.
- [ ] Launcher → the app → the panel starts: no "Start failed", the canvas is drawn (a screenshot, not only the DOM). A hidden browser pane throttles `requestAnimationFrame`:
      timings and canvas sizes measured there mean little; read the panel text instead.
- [ ] Open a file the app opens from the project tree (double click, or **Open with**). Save it back. (Only PhotoCraft was ever checked this way; say so if you skip it.)
- [ ] Two apps of the same ecosystem open at once do not lock each other.
- [ ] `list-craft-apps` with `app: "<id>"` and `open-in-app` answer correctly; with the app's CLI installed, `GET /api/mcp/external` shows it `connected`.
- [ ] Memory: open three heavy apps, hide two; the top bar chip appears only when memory is high or the page is slow; an unsaved hidden panel is **offered**, never freed silently.
- [ ] Light and dark theme: the four office apps follow the workspace; the others keep their own theme (say so, it is expected).

### iPad and the desktop

- Nothing is verified on a real iPad or WebKit unless you did it on one. `tests/e2e-ipad.mjs` runs WebKit at iPad sizes. Do not claim iPad support for a new app.
- iPad measures are decided by what an engine does, never by its version (`src/ipados/compat.ts`); a new app needs only its catalog `traits`.
- Heavy apps (video, RAW, 3D, DAWs) are 50 to 150 MB of wasm each: the memory guard (`src/ipados/memory.ts`) frees hidden, saved panels first; check an app that is
  `weight: heavy` makes room before it starts (`launch-relief`) on an iPad-sized window.
- `weight` decides the stage at the start and the start timeout (`stage-by-weight`, `start-timeout-by-weight`): set it truthfully, an iPad opens at most 4 points (light 1, medium 2, heavy 3) of apps by itself. Check that the launcher offers an app the stage skipped.
- `npm run test:ipad` (Playwright WebKit at iPad sizes) must stay green; a skipped check is not a pass, say which one was skipped and why.
- Audio apps need a tap before sound (`audio-unlock`, and the panel says so, `audio-hint`); shared-memory apps need the isolation switch (HTTPS or localhost plus the service worker).
- Desktop: the optional desktop CLI (`<id>-cli`) is found in Program Files, Applications and the PATH; with `--control <port>` the AI drives the open window.

---

## 7. Safety rules

1. **Never break an app that works.** Update one set of apps at a time and start each in a panel before the next. If an update makes an app fail,
   keep the working build (below) and report the broken one; do not ship a regression to get a higher version number.
2. **Never delete the previous version's zip, an office folder at the root or an installed build** before the new version is verified: they are the rollback. Delete only a duplicate (a second copy of something another folder holds completely).
3. **Never push, tag or publish** unless the maintainer asks in the same conversation (`AGENTS.md`, "Publishing"). Never commit `~/workcraft`, keys, `.env`, or a community app's build.
4. **Never put a key, a personal path or a user's name** in a file, a commit message or a request to an outside service.
5. **No network calls to services the user did not configure.** `npm run versions -- --remote` and `apps:fetch` talk to GitHub on request only. Use `releases.atom` before spending API quota.
6. **Third-party code is data until proven otherwise.** Download only what was asked, into `versions/web-builds/` (ignored by Git), through the script (zip-slip check,
   `brand/` never copied, sha256 verified when GitHub gives one). Do not run a downloaded binary. Mirror a Pages site only from the host in the catalog.
7. **Do not copy code** from a source whose licence does not fit MIT OR Apache-2.0 (AGPL, GPL): follow the contract or idea, write it fresh, name it in `SOURCES.md`.
8. **Do not use the ArtCraft name or logos as branding**, and never copy an engine's `docs/brand/`. Naming the team in credits is fine.
9. **Report what you did not verify.** An untested claim in the changelog is worse than a gap.

### Rollback

- **Office app**: put the old values back in `public/releases.json` (the old `versions/<app>-web-<old>/` folder is still there), restore the old `appsCache` / `APPS` name **with a new number**
  (never reuse a cache name), rebuild. Or `git checkout -- public/releases.json public/sw.js README.md` if nothing else changed.
- **Any other app**: `apps:fetch` and `apps:import` delete the app's older folders under `versions/web-builds/` after the new one is complete. To go back, unzip the old `versions/zip/<origin>/<id>-web-<old>.zip` into a folder of its own and import it: `npm run apps:import -- --yes --app <id> --from <folder that holds only the old <id>-web-<old>/>`, and
  restore the old line of `public/web-builds.json` if you use Git (`git checkout -- public/web-builds.json` plus the import).
- **A broken catalog change**: `git diff src/ecosystems/catalog.json src/ecosystems/catalog.ts` and revert the hunks; `npm test` tells you what disagrees.
- **After any rollback**: rebuild, run section 6, and write the rollback and its reason into the changelog entry.
- Nothing here is destructive to the user's projects: files live in the project folder, never in an app's build.

---

## Quick reference: the commands

```bash
npm run versions [-- --remote] [-- --strict] [-- --token]
npm run apps:import [-- --yes] [-- --app a,b] [-- --from <dir>]
npm run apps:fetch  [-- --yes] [-- --app a,b] [-- --force] [-- --max-mb N]
npm run typecheck && npm test && npm run check:clean && npm run build
```
