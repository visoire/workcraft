# Ecosystems, shared storage and web builds

How WorkCraft groups its 44 apps into workspaces, how files are shared between them, how an app reaches the browser (and
the iPad), where the versions come from, and what to do when an app or a source project releases something new. For the
file-by-file map see [AGENTS.md](../AGENTS.md); for the iPad measures see [IPADOS-COMPAT.md](IPADOS-COMPAT.md).

## The idea in four lines

- One **catalog** (`src/ecosystems/catalog.json`) lists every app, who makes it, its licence, the file types it opens or imports
  and its iPad traits.
- An **ecosystem** is a named group of apps (ten are built in, or you create one). It decides the rail, the launcher and where a
  double click opens a file. It stores nothing in a project, so one project works in every ecosystem.
- **Storage is the project.** There is no second store per app. The same file opens in every app that reads its type.
- An app's **web build** is data, not code: `npm run apps:import` or `npm run apps:fetch` installs it, `public/web-builds.json`
  records it, and the registry, the build, the dev server and the service worker pick it up from there.

## Where the apps come from

| Origin (`origin`) | Apps | Notes |
| :--- | :--- | :--- |
| `artcraft` (17) | WordCraft, GridCraft, DeckCraft, PdfCraft, PhotoCraft, LightCraft, VectorCraft, FilmCraft, EffectCraft, SoundCraft, DesignCraft, FigCraft, CADCraft, TextureCraft, MaterialCraft, **AniCraft**, **Craft Anything** | Made by the ArtCraft team, MIT OR Apache-2.0. The four office apps run from `versions/` directly (`public/releases.json`); the others are imported into `versions/web-builds/`. AniCraft 0.2.1 has a Rust source tree but **no web build yet**, so it is listed and dimmed. |
| `community` (2) | SolidCraft, **MailCraft** | Community apps the ArtCraft launcher lists (SolidCraft: tangency-labs, MailCraft: UCS-Care-Group), MIT OR Apache-2.0. |
| `independent` (25) | TraceDraw, LightCraft Classic, FireCraft, PaintCraft, Paint.RS, ProCraft, PixelCraft, NoteCraft, TextCraft, MatCraft, Picasso Suite, Align, SubCraft, ClothCraft, HumanMotionCraft, OxyBrush, Retake, Lemon Studio, Honeydew, Suhina, Pro Wave, OxiGuitar, Transit, MixStudio, EarthCraft | Third-party apps of a public collection of independent apps (see SOURCES.md) (`tools.yaml`), each with its own repository and licence: MIT, MIT OR Apache-2.0 or **GPL-3.0** (Paint.RS, Picasso Suite, Align, HumanMotionCraft, Retake, Lemon Studio, Honeydew, Suhina, Pro Wave, OxiGuitar). They are fetched on your machine, never committed, and the launcher shows the licence. They are web apps only: no CLI, no MCP server of their own. |

`channel` says how a web build is obtained:

- `release`: the repository publishes a web zip (default asset `*-web-<version>.zip`, or the regex in `asset`). `npm run apps:fetch`
  installs it. These are the ArtCraft and community apps, plus LightCraft Classic (its repository moved to `emmertex/chromaforge`, asset
  `chromaforge-web-<version>.zip`), FireCraft, Paint.RS, Lemon Studio and Honeydew (a 1.36 GB web zip: `apps:fetch` skips anything over 300 MB
  unless you pass `--max-mb`).
- `pages`: no web zip, but the app itself is deployed on GitHub Pages (`pages` in the catalog is its URL): **TraceDraw** and **SubCraft**.
  `apps:fetch` mirrors that site (`scripts/mirror-pages.mjs`: it follows the page to its scripts and WebAssembly files inside the same folder
  tree, nothing from another host, at most 300 files and 400 MB) and versions it by the repository's newest release tag.
- `source`: the repository publishes no web zip and no Pages app (the Pages sites of Picasso Suite, OxyBrush, Pro Wave, OxiGuitar, HumanMotionCraft are
  documentation, not the app); the upstream collection compiles the app from source with its patches (a Rust and wasm
  toolchain). `apps:fetch` cannot get these 18 apps. A build folder `versions/<id>-web-<version>/` that you made (or copied from an
  independent deployment) is imported like any other with `apps:import`. Until then the app is listed and dimmed, and
  `open-in-app` and `list-craft-apps` say exactly that.

Which repository has which release was read from GitHub on 2026-11-12 (`npm run versions -- --remote`, and a search of the release assets of all
25 community repositories). All 44 apps now have web builds installed in `versions/web-builds/` and registered in `public/web-builds.json` (plus the 4 office apps in `public/releases.json`), and all source trees and archives are organized by origin under `versions/{artcraft,community,independent,web-builds,zip}`. What runs and what does not is in the
table under "What is verified".

## The ecosystems

| Ecosystem (id) | Apps | Notes |
| :--- | :--- | :--- |
| Office & Documents (`office`) | WordCraft, GridCraft, DeckCraft, PdfCraft, MailCraft | The default. The four office apps ship with the repository (`versions/`) and have their own MCP tools (`read-sheet`, `write-doc`, ...). |
| Notes, Text & Maths (`notes`) | NoteCraft, TextCraft, WordCraft, MatCraft | |
| Imaging & Photography (`imaging`) | PhotoCraft, LightCraft, LightCraft Classic, VectorCraft | Brush apps: Apple Pencil pressure matters. Heavy. |
| Paint & Pixel Art (`paint`) | PaintCraft, Paint.RS, PixelCraft, ProCraft, FireCraft | |
| Video, Motion & Audio (`motion`) | FilmCraft, EffectCraft, SoundCraft, AniCraft, Picasso Suite, Align | Sound: needs `audio-unlock` on iPad. Heavy (FilmCraft, EffectCraft, Picasso Suite). |
| Music Production (`music`) | SoundCraft, Retake, Lemon Studio, Honeydew, Suhina, Pro Wave, Transit, OxiGuitar, MixStudio | Audio on every app. Lemon Studio needs cross-origin isolation (`isolated` in the catalog; the engine signals `needs-isolation`, and the iPad layer turns it on). |
| Design, UI & Publishing (`design`) | DesignCraft, FigCraft, VectorCraft, TraceDraw | VectorCraft is in two ecosystems on purpose. |
| 3D, CAD & Materials (`cad`) | CADCraft, TextureCraft, MaterialCraft, SolidCraft, SubCraft | WebGPU matters most here. |
| 3D Sculpt & Characters (`sculpt`) | OxyBrush, ClothCraft, HumanMotionCraft, SubCraft, TextureCraft | |
| Explore & Build (`explore`) | EarthCraft, Craft Anything | |
| Custom | any apps you pick | Created in the picker (grouped by origin, with a search box), kept in this browser (`workcraft.prefs`), editable. |

The five ids `office`, `imaging`, `motion`, `design` and `cad` are the ones earlier versions had; saved choices and
`?ecosystem=` links keep working. An app can be in several ecosystems. An app without a web build stays listed and dimmed.

## Choosing a workspace

- First run: the onboarding page (welcome and support, the workspace, where the files are saved) comes first and nothing else is loaded yet. "Skip setup" keeps Office & Documents. Later runs and a `/?ecosystem=` link skip it; `/?onboarding=1` shows it again.
- Later: the grid button on the rail (launcher, then Switch workspace) or the command palette (Switch workspace, or
  `Workspace: <name>`).
- A link: `/?ecosystem=<id>` (any id of the table above, or `custom-<name>`). It counts as the choice, so the picker stays
  closed. Automated browsers (`navigator.webdriver`) never see the picker.
- The launcher's tooltip for an app names its origin, licence and version.

### What the stage shows: the welcome page, never a pile of loading apps

**Entering a workspace opens nothing.** A new project and a new workspace show the **welcome page** of the workspace, and you open the
apps you want, from the page, from the tool rail or from the project tree. Several engines starting together (WebAssembly, GPU) make
the machine laggy, so no app loads by itself. The decisions are small pure functions in `src/ecosystems/stage-plan.ts` (tested in
`tests/server/stage-plan.test.ts`); `src/ecosystems/enter.ts` moves the panels. Never open apps from anywhere else.

- **Switching workspace** (`enterEcosystem`, also the `?ecosystem=` link): the visible apps of the workspace you left give way
  (hidden, their state is kept, `planLeave`). Nothing of the new workspace opens. The notice says how many of its apps are ready.
- **The welcome page** (`emptyStage` in `src/workspace/layout.ts`): the name of the workspace, **Hidden panels** (one click shows each as
  you left it), the apps of the workspace, recent files, **Open the first apps** and **Switch workspace**.
- **Open the first apps** is an explicit choice (`openFirstApps`, `planStage`): the first apps that have a web build here, two side by
  side on a wide stage, **one** in a compact window, a portrait iPad or when the stage is narrower than 640 px (about 320 px an app); on an
  iPad the weights of the apps decide too (`pickStageApps`, `src/ipados/stage.ts`, measures `stage-by-weight`).
- **A saved layout** is yours: what you had open comes back as it was. Only a layout that shows nothing shows the welcome page.
- **The tab strip** (`tabBelongs`) leaves out hidden panels of other workspaces' apps that never started; visible and minimized panels,
  Code, Terminal, Settings, the apps of this workspace and any loaded app stay.

### The picker

Neutral surfaces only (the workspace tokens `--card`, `--ink`, `--line`; no tinted dark blue). The title and the buttons stay in
place and only the content scrolls (`dialog.modal.wide`). A card: name, two-line blurb, app icons with the version as a status
dot (the legend explains the colors; the number is in the tooltip), a status line; the workspace in use has an **In use** pill.
A click anywhere on a card chooses the workspace: icons are not links inside it. The app groups are ArtCraft, Community and Independent (the apps of independent developers).

### Where a file opens

`toolForPath` (`src/workspace/registry.ts`) decides a double click:

1. an office file type always goes to its office app;
2. a type another app opens natively goes to that app only if the app is in the active ecosystem and has a web build here;
3. everything else goes to the code editor.

The tree's **Open with** lists every app that reads the type (`appsFor`), the active ecosystem first, then apps that open it
natively, then apps that import it. `open-in-app` (MCP) follows the same rules. Several apps now open the same type natively
(PNG: PhotoCraft, PaintCraft, Paint.RS, ProCraft, PixelCraft); the active ecosystem decides, then catalog order. TextCraft opens
`.txt`, `.md` and `.log` only, so WordCraft stays the home of those in the Notes workspace and a `.json` stays in the code editor.

## Shared storage

```
 engine page (iframe)                 workspace                          project
 playgroundFiles  --(craft-files.js)--> bridge (app-files-bridge.ts) --> fs  (REST on desktop,
 open saveAs write read files ...        paths browser:/a/b <-> /a/b            IndexedDB + OPFS in browser mode)
```

- **Project paths** (`/documents/a.docx`) are what the tree, the AI and the sync use. **App paths** (`browser:/documents/a.docx`)
  are what an independent-app style engine build passes; `src/storage/paths.ts` maps between them and never lets a path leave
  the project.
- **`globalThis.playgroundFiles`** exists only inside a workspace panel (`public/craft-files.js`, injected next to the iPad
  frame script). The calls and result shapes follow the independent apps' `shell/files.js`, so its patches work unchanged: `open`,
  `saveAs`, `write`, `read`, `files`, `remove`, `download`, `setUnsaved`, `onOpen`.
- **Writes** are queued per path and land in order; a read after a write sees the write; a failed write is reported with the
  bytes and the panel offers **Download instead**.
- **`onOpen`**: an engine that registers it receives files natively (other documents stay open in a multi-document app). An
  engine that does not gets the file as a drop on its canvas, as before.
- **`setUnsaved`**: when an engine reports its own unsaved state, the key and pointer guess stops.
- An engine that never looks for `playgroundFiles` is not affected; its downloads and file pickers are captured as before.

### Recent files

`src/storage/recent.ts`: one list in `localStorage` (`workcraft.recent`), each entry `{ path, tool, project, at }`, newest
first, 40 at most, no duplicates, files that no longer exist are left out when shown. It holds paths only, never bytes, so it
works with the desktop backend and in browser mode. Shown in the launcher and the empty stage; the AI reads it with
`recent-files`.

## The `versions/` folder

The folder is flat, as the ArtCraft releases come:

```
versions/
  <app>-<ver>/          the Rust source tree of a release (crates/, apps/<app>-cli, assets/app-icon, docs/)
  <app>-web-<ver>/      its web build (index.html, wasm, snippets/); what the browser runs
  zip/                  the release zips (<app>-<ver>.zip, <app>-web-<ver>.zip)
  web-builds/           written by apps:import / apps:fetch: the installed builds of the non-office apps (not tracked)
```

On 2026-11-12 it holds 19 source trees and 19 web builds (all but AniCraft; the ArtCraft Launcher's web build is there too and is
not an app of the catalog). Only the four office web builds are tracked in Git; everything else is local (`.gitignore`).

```bash
npm run versions                           # offline: what versions/ holds against releases.json and web-builds.json
npm run versions -- --remote               # also asks GitHub for the newest release of every catalog repository
npm run versions -- --strict               # exit code 1 when anything is newer or not imported
```

`npm run versions` uses the release logic of apicraft, ported in `src/server/apicraft.ts` (version parsing and ordering as PEP 440,
latest release, rate-limit guard and cache), the same code the update check runs on. Anonymous GitHub access is 60 requests an
hour; when it runs out, the repository's public `releases.atom` feed answers instead (it does not count against the quota).
`--token` sends `GITHUB_TOKEN` (optional). Nothing is downloaded or written by this command.

## Web builds

```bash
# from a local folder of builds, no network (default versions/, or --from <dir>, or WORKCRAFT_APPS_WEB)
npm run apps:import                        # list what is in the folder and what would be copied
npm run apps:import -- --yes               # copy the newest build of every non-office app into versions/web-builds/
npm run apps:import -- --yes --app mailcraft,photocraft

# or from the GitHub releases named in the catalog
npm run apps:fetch                         # list what exists upstream and what is installed (downloads nothing)
npm run apps:fetch -- --yes                # download and install the newest build of every app that has one
npm run apps:fetch -- --yes --app lemon-studio,paintrs
npm run apps:fetch -- --yes --force        # install again
```

Both routes apply the same rules and write the same manifest.

- Each app's repository is in the catalog (`repo`). The asset is `<app>-web-<version>.zip` of the newest stable release (else
  the newest pre-release), or the app's own `asset` regex, the same convention the upstream collection builds on.
- The folder is unpacked into `versions/web-builds/<app>-web-<version>/` and recorded in `public/web-builds.json`
  (`{ app, version, dir, bytes, source, fetched }`). The folder is **not tracked** (one engine can exceed GitHub's 100 MB file
  limit); the manifest is. A fresh clone runs the command once.
- **What the install changes** (so an upstream zip works unmodified in a panel): host files are left out (`.htaccess`, `_headers`,
  precompressed `.br`/`.gz` copies; XAMPP would apply a `.htaccess` to the whole build), and a split build (PhotoCraft) gets its
  `snippets/` copied to `app/snippets/` as well, because the zip has them only at the root while its `app/` loader imports them
  from `app/` (still so in 0.23.1; the app never started without it). The fixes are recorded per app in the manifest (`fixes`).
- Safety: only repositories named in the catalog are asked; zip entries with `..`, absolute or backslash paths are refused;
  `brand/` folders are never unpacked; the sha256 GitHub reports for the asset is verified when present; the old folder is
  removed only after the new one is complete.
- A build counts as available only if its folder exists on this machine (`PRESENT_BUILDS` in `scripts/releases.mjs`), so a
  clone that has the manifest but not the files shows "no web build here yet" instead of a broken panel.
- **Caching on devices:** the service worker keeps files with a 16-digit hash in the name for good and checks everything else
  against the network first, so a new upstream build needs no change to `public/sw.js` beyond the `APPS` cache name of the four office apps.
- The office apps stay in `public/releases.json` (they also drive the homepage download table). Since 2026-11 their releases carry
  Windows portable builds for x64 and ARM64 only; a missing architecture is not listed.

### A build that does not start

A panel reports **Start failed** when the engine's own WebAssembly code panics (`RuntimeError: unreachable`) or does not start
within the time limit, and says which build it was. **MailCraft 0.12.0 was such a build**: it called `std::time::Instant::now()` in many places, which panics on
`wasm32-unknown-unknown` (`time not implemented on this platform`). It does the same served on its own with none of WorkCraft's
scripts, so it is the upstream build, not this workspace. It cannot be repaired by patching the wasm (an earlier attempt cut the trap
out; the compiler had deleted everything after the call, so the app ran into code that was never meant to run and corrupted its heap:
a picture, then nothing clickable). **MailCraft 0.13.0 does not have the problem** (checked 2026-11-17 in a workspace panel: the mail list, the reminders and the folders
draw and answer; no panic; sha256 checked against the release), and the workspace runs it. 0.11.1 was the workaround in between; 0.12.0 stays in `versions/zip/community/`;
`npm run versions -- --remote` shows when a newer web build exists, and `scripts/patch-apps.mjs` reports any build that has the trap.

### When an app updates

Run `npm run versions`, put the new folder into `versions/`, then `npm run apps:import -- --yes` (or `npm run apps:fetch -- --yes`),
restart the dev server (or `npm run build`), add a changelog entry. For an office app also update `public/releases.json` and the
`APPS` cache name in `public/sw.js`. No catalog edit, no version number elsewhere.

### When an app is added

1. One entry in `src/ecosystems/catalog.json` (id, name, kind, accent, repo, folder, `origin`, `license`, `channel`, blurb, `opens`,
   `imports`, `traits`), its id in `CRAFT_IDS` (`catalog.ts`) and in the ecosystems it belongs to (`tests/server/ecosystems.test.ts`
   fails if they disagree, or if the icon, licence or origin is missing).
2. An icon `public/assets/craft/<id>.png` (128 px).
3. `npm run apps:import -- --yes --app <id>` (or `apps:fetch`).
4. If the app ships a CLI with an `mcp` command: one line in `CRAFT_APPS` (`src/server/craft.ts`) with the flags of that CLI.
5. For the Rust chat: one `AppSpec` in `workcraft-ai/crates/agents/src/craft/spec.rs`.

## The AI and the apps

- **`list-craft-apps`** answers from the catalog: id, kind, origin, licence, ecosystems, version, and whether a web build runs here.
  It filters by file type, ecosystem, origin or `available`, and `app` returns one app in full (its file types, and for an app
  without a build the command that fixes it). The plain list leaves out the long type lists to save tokens.
- **`open-in-app`** opens an app panel with a file, and when an app has no build it says which apps run now and how to get this one.
- **19 apps have a CLI with an MCP server** (`src/server/craft.ts`, six added in this release: MailCraft, TextureCraft, MaterialCraft,
  SolidCraft, AniCraft, Craft Anything). When one is installed on the computer, its tools join the AI as `ext-<app>-<tool>`; the
  tool router offers them when the question names the app, a keyword of a tool, or a file type the app opens (read from the
  catalog, so a new app needs no router change). Details and the limits: [MCP-TOOLS.md](MCP-TOOLS.md).
- **The apps of the workspace you are in are connected for the AI.** The workspace reports its apps to the backend; the MCP server of every
  installed one is switched on unless you switched it off in Settings, Craft apps, and each row shows why an app is not connected.
- **One team per workspace.** Team Mode has a ready-made team for every built-in workspace (`eco-<id>`) and **This workspace** for
  a custom one: the leader plus one specialist per app (`ecosystemTeam()` in `src/chat/team.ts`).
- The independent apps have no MCP server. The AI works on their files through the project (`read-file`,
  `write-file`) and opens them with `open-in-app`; what they save lands in the project through the shared storage.

## iPadOS

The new apps use the same layer as the old ones (`src/ipados/`), decided by what an engine does, never by its version.
What the catalog adds, as traits:

| Trait | Values | Used for |
| :--- | :--- | :--- |
| `weight` | `light`, `medium`, `heavy` | `launch-relief`: a heavy app unloads hidden, saved panels before it allocates (iPad, or the memory governor setting). |
| `pen` | `precise`, `pressure` | Brush apps (PhotoCraft, VectorCraft, DesignCraft, TextureCraft, PaintCraft, Paint.RS, ProCraft, OxyBrush, SubCraft) are the ones where pressure and tilt matter. |
| `audio` | `true`, `false` | Sound apps; the frame layer's `audio-unlock` runs for every engine unless it says `native-audio`. The nine music apps and the video apps are `true`. |
| `needsFiles` | `true`, `false` | Apps that work from their own state (CADCraft, TextureCraft, MaterialCraft, SubCraft, MatCraft, Lemon Studio, Craft Anything). |
| `keys` (optional) | `video`, `paint` | The app is worked with keyboard shortcuts: the key table of the touch keys bar on a screen without a keyboard (`touch-keys`, `src/ipados/touch-keys.ts`). FilmCraft is `video`, ProCraft `paint`. Add a table only from the app's own shortcut map. |

`weight` also decides what a workspace opens at the start and how long an app may take to start (`stage-by-weight`, `start-timeout-by-weight`, see [IPADOS-COMPAT.md](IPADOS-COMPAT.md)): an iPad takes 4 weight points
(light 1, medium 2, heavy 3), so two heavy apps do not open together there; give a new app its real weight. Keep these apps offline checks the free storage first (`offline-quota-check`), using the `bytes` of the build in
`public/web-builds.json`.

The traits of the 28 apps added on 2026-11-12 are estimates from what each app does; the memory governor measures the real
numbers. None of them has been run on an iPad.

Standalone iPad (no desktop): the workspace runs in browser mode (projects in IndexedDB and OPFS), the launcher's **Keep these
apps offline** asks the service worker to cache the engines of the active ecosystem, and Add to Home Screen makes the storage
persistent. A web build is a WebAssembly engine on WebGPU or WebGL2; heavy ones (video, RAW, 3D, the DAWs) are the ones to test on
a real device first. The ten music and the 3D apps are 20 to 100 MB of wasm each: keep one or two open on an iPad.

## How a panel knows an app has started

The four office engines announce themselves (`wasmBindings`, `TrunkApplicationStarted`). The others do not all do that: a split
build (PhotoCraft) fires the Trunk event for its small boot module long before the app runs, and FilmCraft, EffectCraft and LightCraft
never fire it. `panels/craftapp.ts` therefore treats an app with a loading element as started when it has taken over its canvas
(the buffer is no longer the 300 x 150 default) or has removed the loading element. A loading element that is only hidden does not
count (FilmCraft and EffectCraft keep it hidden for a while). FilmCraft's `window.filmcraftLoad.readyMs` counts too.

A Rust panic inside an engine (`RuntimeError: unreachable`) shows the Start failed box at once, whether the engine had started
or not.

## Offline cache

`public/sw.js` caches an app for offline use by following what its pages and scripts name (`assetPaths`: import and `new URL()`
strings, tags, and the lines of a split build's `app/parts.txt`), up to 120 files per app, own folder only. A name that turns out
to be no file (404) is skipped, not counted as a failure. The service worker keeps files with a 16-digit hash for good and checks
the rest against the network first. Engines that register a service worker of their own (EffectCraft, SolidCraft) are refused
inside a panel (`nested-service-worker`), so the workspace cache is the only one.

## What is verified and what is not

See the section "2026-11-12" of [CHANGELOG.md](../CHANGELOG.md) for the numbers of that pass. In short:

**Verified:** typecheck, the backend tests (including the catalog, routing, the picker data, `list-craft-apps`, the version
scripts, the MCP retry rules), the production build (`npm run build`), the picker, the launcher, the Create-your-own form with its
search, the `?ecosystem=` links and the start of the apps in a desktop Chromium with WebGPU.

**The six community builds installed on 2026-11-12, started in a workspace panel (Chromium with WebGPU):**

| App | Result |
| :--- | :--- |
| TraceDraw 0.44.2 (Pages) | starts, a document window is shown |
| FireCraft 0.2.5 | starts, after the install fix `relative-paths` (its `index.html` used root-absolute paths) |
| Paint.RS 0.7.3 | starts (canvas taken over) |
| Lemon Studio web.26 | does **not** start without cross-origin isolation (it draws its own "needs COOP and COEP" page); the panel says so and offers the isolation switch. Not tried with a service worker |
| LightCraft Classic 26.47.1 (26.46.3 and 26.46.2 did the same) | **upstream bug**: stops at startup with `no pids on this platform`; also refuses to run beside LightCraft (both hold the Web Lock `lightcraft-library`). Checked again on the newest build (26.47.1, 2026-11-17), in a workspace panel: the same message |
| SubCraft 0.3.6 (Pages) | **upstream bug**: panics at startup with `time not implemented on this platform` (the deployed site does the same) |

**Updated builds, checked in a workspace panel on 2026-11-14 (Chromium, WebGL2):** SolidCraft 0.41.0 starts (about 6 seconds) and keeps its own dark look in both workspace themes, as the catalog says; its Rust CLI flags were not re-read, because only the web build was installed. LightCraft Classic is the row above.

**Updated again on 2026-11-17 (Chromium, SwiftShader, in a workspace panel, each next to the others):** MailCraft 0.13.0 starts and works (see above), SolidCraft 0.43.0 starts and shows its start page, LightCraft Classic 26.47.1 stops with the same upstream message as before. Honeydew 0.5.4 was not installed (its web zip is 1.36 GB; `npm run apps:fetch -- --yes --max-mb 1461 --app honeydew` takes it). Other apps with a newer upstream tag have no web zip (they are built from source only); `npm run versions -- --remote` lists them.

**Not verified:**

- Anything on real WebKit or a real iPad (Pencil, audio, memory of the heavy engines, the offline cache, the memory guard).
- The 19 other independent apps: no build (18 only built from source, Honeydew not downloaded because of its size).
- A live run of the six new MCP CLIs (`mailcraft-cli`, `solidcraft-cli`, `texturecraft-cli`, `materialcraft-cli`, `anicraft-cli`,
  `craft-anything-cli`): the arguments follow their sources and are unit-tested, no desktop app was installed here.
- Opening files in apps other than PhotoCraft, saving from them back into the project, the German strings of the new apps'
  blurbs (they show in English), and the light and dark theme of the new apps (only the four office apps follow the workspace theme).

## Upstream sources

Everything this feature borrows is named in [SOURCES.md](../SOURCES.md) under "Ecosystems, storage and web builds", with the
file or idea taken and where it lives here. Short version:

| Source | Taken | Lives in |
| :--- | :--- | :--- |
| the public collection of independent apps (named in SOURCES.md, where its licence is checked) | `playgroundFiles` contract, `browser:` paths, `opens`/`imports` file-type lists, the list of community apps with their repositories and licences (`tools.yaml`), the app icons, the web-zip asset convention, per-path write queue | `src/storage/`, `public/craft-files.js`, `scripts/fetch-apps.mjs`, `catalog.json`, `public/assets/craft/` |
| apicraft (`artcraft/apicraft`) | the release and version logic used to check for newer versions | `src/server/apicraft.ts`, `scripts/check-versions.mjs` |
| [ranuts/document](https://github.com/ranuts/document) (AGPL-3.0) | idea only: reopen recent work from the browser, local-first editing, agent tools in the browser; no code, AGPL-3.0 does not fit MIT OR Apache-2.0 | `src/storage/recent.ts` |
| [ONLYOFFICE](https://github.com/ONLYOFFICE/web-apps) web-apps, DocumentServer, DesktopEditors (AGPL-3.0) | studied for touch and mobile editor ideas; nothing copied | none |
| [visoire/workcraft-ai](https://github.com/visoire/workcraft-ai) | the app registry (`spec.rs`): formats, aliases, specialist kinds | `catalog.json`, `lookupApp` |
| [storytold/*](https://github.com/storytold) app repositories, [UCS-Care-Group/mailcraft](https://github.com/UCS-Care-Group/mailcraft), [tangency-labs/solidcraft](https://github.com/tangency-labs/solidcraft) | the web builds and the CLI flags of the MCP servers | `versions/`, `versions/web-builds/`, `src/server/craft.ts` |
| [cjpais/Handy](https://github.com/cjpais/Handy) | offline voice input (earlier alpha) | `src/server/voice.ts` |
