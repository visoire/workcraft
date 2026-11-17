<!-- page: introduction | Get started | Introduction | WorkCraft is a unified local-first workspace for documents, spreadsheets, presentations and PDFs, with a private AI assistant that works across every file. -->

WorkCraft is a unified local-first workspace for real work. Documents, spreadsheets, presentations and PDFs open side by side in one window, next to a project tree, a code editor, a terminal and an AI assistant works across all of them through the Model Context Protocol (MCP). The four office panels are the open-source apps **WordCraft**, **GridCraft**, **DeckCraft** and **PdfCraft**, and 40 more apps (44 in all: imaging, paint, video and audio, music, design, 3D and CAD and more) run in ready-made [workspaces](#workspaces). You can use WorkCraft in two ways. In the **browser**, at [workcraft.cc/app](https://workcraft.cc/app/), with nothing to install: your projects stay in your browser. Or **on your computer**, where a small Node.js backend on `127.0.0.1` keeps your projects, your keys and your history, and adds the terminal, local models and the desktop apps.

:::cards
- [Quickstart](#quickstart) Install, start and open WorkCraft in two minutes.
- [Your data and API keys](#privacy) What stays on the device and what leaves it.
- [Local-only mode](#local-only) One switch that blocks every cloud provider, for fully air-gapped work with Ollama.
- [Search and memory](#search) Find any passage in documents, sheets, slides, PDFs and chats.
- [Snapshots and undo](#snapshots) Undo an AI answer across all apps at once.
- [Plugin API](#plugins) Add PhotoCraft, Blender, ComfyUI and more as MCP servers.
- [AI providers](#providers) Local models with Ollama, or your own key for DeepSeek, Claude, ChatGPT, Gemini and any compatible endpoint.
- [Team Mode](#team) A Team Leader and specialist agents working in parallel.
- [iPad and Apple Pencil](#ipad) Pair with your desktop over Wi-Fi, or work on the iPad alone.
- [Keyboard shortcuts](#shortcuts) Every shortcut, plus the `@` and `/` operators of the chat.
- [Light and dark mode](#theme) One switch for the workspace and every app that supports both modes.
:::

> [!NOTE]
> This guide describes WorkCraft 0.1 (alpha; the current version is on the Status page). Every feature on these pages works without an account and without the cloud. Cloud models are optional and you can switch them off completely.

## What makes WorkCraft different

- **Local first.** Projects are folders in `~/workcraft/projects`. The backend listens on `127.0.0.1` only.
- **AI is part of the workspace.** The assistant reads and edits your documents, sheets, slides and PDFs. Run it fully local with Ollama at no cost, or add your own key for DeepSeek, Claude, ChatGPT, Gemini and more.
- **Your keys stay here.** API keys live in `~/workcraft/config.json` and reach the browser only masked.
- **You see what leaves.** The [audit log](#audit) lists every request that went to a provider, with metadata only.
- **One undo for everything.** Before the AI writes, WorkCraft keeps a [snapshot](#snapshots) of the whole project.

<!-- page: quickstart | Get started | Quickstart | Install WorkCraft, start the backend and open the workspace. -->

Do you only want to try it? Open [workcraft.cc/app](https://workcraft.cc/app/): all 44 apps and every workspace are there, nothing is installed, and your files stay in your browser (no terminal and no local models there). To run it on your computer:

:::steps
1. **Install Node.js 22 or newer and Git.** On Windows, macOS and Linux.
2. **Install the dependencies.** Run `npm install` in the project folder.
3. **Start WorkCraft.** `npm run dev` for development or `npm run build` and `npm start` for production.
4. **Open WorkCraft.** Go to `http://localhost:5175/`. Your own empty project opens. Import your files, or press **Load sample data** to open a separate sample project with a document, a spreadsheet, slides and a PDF.
5. **Pick a model.** Settings, AI models: add an API key, your own endpoint, or start Ollama for fully local work.
6. **Install the other apps (optional).** The repository holds the four office apps. `npm run apps:fetch` lists the other 40 and `npm run apps:fetch -- --yes` installs their official web builds (about 1.5 GB; they come from their own repositories under their own licences). Until then their panels say "No web build here yet".
:::

```sh
npm install
npm run dev        # backend on :5176, interface on :5175
npm run build && npm start   # production on :5175
```

> [!TIP]
> Use `localhost` instead of `127.0.0.1` in the browser. Then the website and the workspace share the light or dark choice.

## Your own projects and the sample data

Every installation, and every browser in browser mode, starts with an empty project of its own called **My project**. Nobody shares demo files, and your documents stay in your own data folder.

**Load sample data** (in the empty project tree, or the project menu) opens the bundled sample project: a document, a spreadsheet with formulas, a presentation, a PDF and a bit of code. It is a project of its own, so trying things there never touches your files. Switch back in the project menu. **New project** in the same menu can also start a project with the sample files.

## Data folder

| Path | Content |
|---|---|
| `~/workcraft/projects/<id>/` | the files of a project |
| `<project>/.workcraft/` | chats, layout, memory, search index, snapshots, project graph |
| `~/workcraft/config.json` | settings and API keys (mode 0600 on macOS and Linux) |
| `~/workcraft/audit.jsonl` | audit log (metadata only) |
| `~/workcraft/.trash/` | deleted projects and files, 30 days |
| `~/workcraft/plugins/` | plugins (MCP servers) |

Set `WORKCRAFT_HOME` to move the folder, `WORKCRAFT_PORT` for the backend port and `WORKCRAFT_SHARE_PORT` for the home-network share (default 5179).

<!-- page: workspaces | Get started | Workspaces and Craft apps | Ten workspaces for different kinds of work, your own workspaces, recent files, and how the other apps reach the browser and the iPad. -->

## Workspaces for every kind of work

WorkCraft groups its 44 apps into **workspaces** so you only see the apps for the work you are doing: **Office & Documents** (WordCraft, GridCraft, DeckCraft, PdfCraft, MailCraft), **Notes, Text & Maths** (NoteCraft, TextCraft, WordCraft, MatCraft), **Imaging & Photography** (PhotoCraft, LightCraft, LightCraft Classic, VectorCraft), **Paint & Pixel Art** (PaintCraft, Paint.RS, PixelCraft, ProCraft, FireCraft), **Video, Motion & Audio** (FilmCraft, EffectCraft, SoundCraft, AniCraft, Picasso Suite, Align), **Music Production** (SoundCraft, Retake, Lemon Studio, Honeydew, Suhina, Pro Wave, Transit, OxiGuitar, MixStudio), **Design, UI & Publishing** (DesignCraft, FigCraft, VectorCraft, TraceDraw), **3D, CAD & Materials** (CADCraft, TextureCraft, MaterialCraft, SolidCraft, SubCraft), **3D Sculpt & Characters** (OxyBrush, ClothCraft, HumanMotionCraft, SubCraft, TextureCraft) and **Explore & Build** (EarthCraft, Craft Anything). The apps come from the ArtCraft team, from community apps its launcher lists (SolidCraft, MailCraft) and from independent developers (25 third-party apps, each with its own licence, shown in the launcher). A picker asks where to start the first time. Closing it keeps Office & Documents.

On the first start an **onboarding page** comes before anything else loads (no project, project tree, chat or rail yet): a welcome with a way to support the project, the workspace (or **Create your own**), and where your files are saved (only on this computer, or also in the cloud, which opens Settings, Cloud storage right after the start). The answer is kept in the browser and the question is not asked again; **Skip setup** keeps Office & Documents. Switch later with the grid button on the rail (then **Switch workspace**) or the command palette. A link such as `/?ecosystem=imaging` opens a workspace directly. **Create your own** makes a workspace from any apps and a name you choose (the apps are grouped by origin and a search box narrows them); you can edit or remove it later. Your files do not belong to a workspace: they stay in the project, and any project opens in any workspace.

A new workspace and a new project start on the **welcome page**: nothing opens by itself, so the machine stays fast (several apps starting together are heavy). The page names the workspace, lists the apps to choose from, the panels you hid (one click brings each back as you left it) and your recent files. Open an app from the page, from the tool rail or from the project tree. **Open the first apps** opens the first two apps side by side on a wide stage, or one in a small window; that is your choice, never automatic. Switching workspace hides the open apps of the one you left (hidden, not closed, so nothing is lost). A layout you saved comes back as it was.

## The launcher and recent files

The grid button opens the launcher: the apps of the current workspace, the files you opened last in this project (a tap reopens a file in the app it was last open in) and **Keep these apps offline**, which loads the engines of the workspace onto the device so an iPad works without a network. Recent files are paths into the project, never copies.

## One file, several apps

**Open with** in the project tree lists every app that reads the file type, the apps of the current workspace first: a `.png` in PhotoCraft, LightCraft or FilmCraft, a `.docx` in WordCraft or imported into DesignCraft. A double click opens an office file in its office app always, and a type of another app in that app only when it belongs to the current workspace. The AI uses the same rules with `open-in-app`, and sees what exists with `list-craft-apps` and `recent-files`.

## Web builds of the other apps

WordCraft, GridCraft, DeckCraft and PdfCraft ship with WorkCraft, and all 40 additional apps in the catalog have web builds installed and registered in `public/web-builds.json` (44 of 44 apps ready). Source trees and web builds are organized by origin under `versions/{artcraft,community,independent,web-builds,zip}`: `npm run apps:import` copies builds from `versions/`, patches known upstream browser issues (`scripts/patch-apps.mjs`), and updates `public/web-builds.json`, while `npm run apps:fetch` downloads newer builds from GitHub releases. `npm run versions` shows which version of every app is where, and with `--remote` what GitHub has newer. Engines made for the independent apps' browser storage save into the project through the same files, so they need no change. See `docs/ECOSYSTEMS.md` in the repository for the update steps and what has been tested.
<!-- page: architecture | Get started | Architecture | How the interface, the backend, MCP and the apps work together. -->

The interface is a strict TypeScript app (Vite). The backend is Hono on Node.js. They talk over four channels:

| Channel | Use |
|---|---|
| REST `/api/*` | files, projects, settings, search, trash, snapshots, audit log |
| SSE `/api/ai/chat` | token streaming from the AI router |
| WebSocket `/ws` | live file events, terminal, tool activity |
| MCP `/mcp` | all project tools over Streamable HTTP, also for external MCP clients |

The AI router (`src/chat/providers.ts`) talks to Claude, ChatGPT, Gemini, DeepSeek, Grok, GLM, Mistral, Groq, OpenRouter, Together AI, Ollama, LM Studio and any OpenAI-compatible endpoint. Requests go from the backend to the provider, never straight from the browser. Only browser mode on the iPad, without a desktop, sends requests from the browser.

> [!INFO]
> The apps are WebAssembly builds. Most expose no command API, so the AI works on the files and the apps show the new state live.

Nothing is loaded from a CDN. Fonts, icons, the apps, the tokenizer data and the service worker all come from your own computer.

<!-- page: theme | Get started | Light and dark mode | One switch for the workspace and every app that supports both modes; apps with one look keep it. -->

The round switch in the top bar (and **Settings, Appearance and layout, Color scheme**) is the one place where you choose light, dark or the system setting. It decides for the workspace, the chat and every app panel that can follow it. The apps change in place: nothing reloads and the open document stays as it is.

Not every app can follow. The page **Settings, Appearance and layout** has a list that says what each app does:

| What the list says | What it means |
|---|---|
| **Follows the switch** | The app has both looks and takes the one of the workspace. WordCraft, GridCraft, DeckCraft, PdfCraft, FigCraft, MailCraft, Paint.RS, PixelCraft, NoteCraft, OxiGuitar, Transit and Align do. **PhotoCraft, FilmCraft and EffectCraft** do too: they have a moon button of their own that cycles Dark, Auto and Light, and WorkCraft presses it to Auto when they start, so they follow the switch live from then on. |
| **Own setting, dark** (or light) | The app has a light and dark choice inside the app, usually under Preferences or Settings, Appearance, and its web build gives no way to set it from outside. The app shows the look it ships on until you change it there. If you pick "Sync with System" (or Auto) inside the app, it follows the switch from then on. LightCraft and SoundCraft are examples. |
| **Always dark** (or light) | The app has one look only. It keeps it, and the panel around it is painted to match, so a dark app in a light workspace does not sit in a light frame. |

The website has its own switch, separate from the workspace.

> [!NOTE]
> An app that styles its dark mode with a CSS `prefers-color-scheme` rule used to follow the operating system instead of the switch. WorkCraft now rewrites those rules, so such an app (Align) follows the switch too.

For people who add apps: the guide `docs/THEMING.md` explains how an app is classified (`media`, `switch`, `css`, `own`, `fixed`), how to measure it (`npm run apps:audit`) and what to change.

<!-- page: shortcuts | Get started | Keyboard shortcuts | Every shortcut of the workspace, the code editor and the chat. -->

On a Mac or an iPad with a Magic Keyboard, use `Cmd` where the table says `Ctrl`.

The workspace keeps its own shortcuts to a minimum on purpose. Keys that browsers use themselves (`F2`, `Ctrl J` for downloads, `Ctrl Shift J`, `K`, `E`, `M`, `P` for browser tools and private windows, `Alt 1` to `Alt 9` for tabs) are not used, so nothing you press is taken from the browser. Everything else is in the command palette, the menus and the buttons.

| Shortcut | Does |
|---|---|
| `Ctrl K` | command palette: every action of the workspace is in it (chat, Full Chat Mode, search, picture in picture, focus mode, top bar, minimize, maximize) |
| `Ctrl \` | show or hide the project tree |
| `Alt Enter` | full screen for the focused panel (again to leave) |
| `Alt \` | AI completion at the cursor in the code editor (`Tab` accepts, `Escape` dismisses) |
| `Enter`, `Shift Enter` | send the chat message, new line |

## The panel menu

The header of a panel has two buttons: **Maximize** and **X**. X only **hides** the panel (its state and tab stay, one click brings it back). **Close and free memory** (red, in the panel menu) closes it for good and unloads the app; **Unload and free memory** (also red) keeps the tab. Everything else is in the panel menu, the one the project tree already had. Open it with a **right click** on the panel header (the name, not a button), on its **tab**, or on the app's **icon in the tool rail**; with the Apple Pencil's barrel button; or with a **long press** (about half a second) with a finger on an iPad. A double click on the header also maximizes.

- **Window**: Maximize, Full screen, Minimize to the dock, Picture in picture, Open in a separate window. A hidden or minimized panel offers **Show** instead, because the other actions would act on something nobody sees.
- **File**: Open in the desktop app (when it is installed), **Show in the project tree** (opens the tree, opens the folders above the file, selects it and scrolls to it), Show in the file manager (the computer that runs WorkCraft only), Copy path.
- **Engine** (apps): **Reload** starts the app again from its file and asks first when there are unsaved changes; Unload frees the memory and keeps the tab; **Panel info** lists the app and version, its state, window and file, the start time, the WebAssembly, GPU and JavaScript memory, and what the engine itself reports.
- **Leaving**: Hide, and Close and free memory (red) for apps and the code editor; the project tree and the chat are only hidden.

A right click on the rail icon of an app that is not open offers Open (and the desktop app). Moving a panel to another workspace is not part of the menu yet.

## Settings and Developer options

Settings lists five sections: **AI models**, **Personas and context**, **Appearance and layout**, **Privacy** and **Cloud storage**. Everything else sits behind **Developer options** at the end of the list: status, updates, health check, memory, Team Mode, search, usage, audit log, history, trash, sharing, MCP servers, Craft apps, other IDEs, plugins, logs and iPad settings. Nothing was removed; the fold only keeps the first screen short. It opens by itself when a link or the status chips point to one of those sections, and it remembers whether you left it open.

## Arranging the tool rail

The rail shows the apps of the workspace in use. **Drag an icon up or down** (mouse or pen) to put it where you want it; a line shows where it lands. With a finger, press and hold the icon and choose **Move up** or **Move down**. The order is kept per workspace, and the rail scrolls when there are more icons than room.

## The top bar

The top bar has one button for the AI chat, the command palette, the **+** button, the color scheme, **Settings** (top right) and the main menu. **+** lists the apps of the workspace in use and the files you opened last in them. The project tree is the first button of the tool rail (`Ctrl \`); project search, Full Chat Mode and hiding the top bar are in the main menu and the command palette.

## Full screen and separate windows

Every app and the code editor has two buttons in its header besides maximize and picture in picture:

- **Full screen** makes the panel fill the whole window: no top bar, tool rail, project tree, chat, tabs or other panels, and not even the header of the panel. The browser goes to full screen as well. Move the pointer to the top edge for a moment to get **Exit full screen** back, or press `Esc`. `Alt Enter` does the same from the keyboard. Full screen is never saved with the layout.
- **Open in a separate window** moves the app into a browser window of its own, for example onto a second display. The app is saved first, then started in the new window, where it fills the window like in full screen. Files, live sync and saving work as before, because both windows talk to the same local backend. In the workspace the panel becomes a card with **Show window** and **Bring back**; it loads again here when the window closes (also when you close it with the X). The AI still sees what you typed there: before it reads a file, unsaved changes of the separate window are saved too.

With a second display connected, the command palette and the main menu also offer **Open the focused panel on the other display** (Chrome and Edge ask once for the permission to see your displays). Separate windows need the desktop backend and allowed pop-up windows. The chat has its own pop-out into an always-on-top window (see Chat views).

## Chat operators

| Type | To |
|---|---|
| `@file.xlsx`, `@folder/` | attach a file or a folder listing |
| `@wordcraft`, `@gridcraft`, `@deckcraft`, `@pdfcraft`, `@terminal` | attach the state of a panel and point the AI at its tools |
| `@team`, `@leader` | run the prompt in [Team Mode](#team) |
| `@grid-agent`, `@word-agent`, `@deck-agent`, `@pdf-agent`, `@dev-agent`, `@photocraft-agent` and one `@<app>-agent` for every other app | give the prompt to one specialist |
| `/read-sheet`, `/create-slide`, `/sign-pdf`, ... | run an MCP tool; with complete arguments it runs without a model |
| `/clear`, `/new`, `/history`, `/export-chat`, `/model`, `/help` | chat housekeeping, see [Chat and attachments](#chat) |

Arrow keys, `Tab` and `Enter` move through the `@` and `/` menus. Without a hardware keyboard, the header and the chat show quick buttons for the command palette, `@` and `/`.

<!-- page: ipad | Get started | iPad and Apple Pencil | Pair the iPad with your desktop over Wi-Fi, or use browser mode on the iPad alone. -->

WorkCraft runs on iPad mini, Air and Pro in Safari, or as a full-screen app from the Home Screen (Share, **Add to Home Screen**). It picks one of two modes on its own:

| Mode | When | What works |
|---|---|---|
| Home network | the desktop shares WorkCraft on Wi-Fi and the iPad is paired | everything: desktop projects, terminal, Ollama on the desktop, all MCP tools |
| Browser | no desktop answers | all the apps, projects stored on the iPad (large files in the Origin Private File System, the rest in IndexedDB), the chat with your own key, file import and export, the Apple Pencil in PdfCraft |

## Pair the iPad with your desktop

:::steps
1. **Share WorkCraft on Wi-Fi.** On the desktop, open Settings, **iPad and network**, switch on **Share on Wi-Fi** and restart. Or start WorkCraft with `npm run dev` or `npm start`, which share it on the home network by default (`npm run dev:local` and `npm run start:local` do not). If Windows asks, allow Node.js on private networks.
2. **Open the pairing link.** The desktop shows an address such as `http://192.168.178.20:5175/pair?token=...`. Open it once in Safari on the iPad.
3. **Work.** From then on `http://<your PC>:5175/` opens WorkCraft with your desktop projects.
:::

Every device except the desktop needs the access token. **Renew** in the settings disconnects all paired devices.

## HTTPS for WebGPU, offline use and fast storage

Over `http://` Safari offers no WebGPU, no offline cache, no Origin Private File System and no persistent storage. With a certificate the iPad trusts, all of that works:

:::steps
1. **Make the certificate.** Install [mkcert](https://github.com/FiloSottile/mkcert) on the desktop, then run `npm run lan:cert`. It writes `cert.pem` and `key.pem` for this computer's addresses.
2. **Trust it on the iPad, once.** Send the `rootCA.pem` that the command names to the iPad with AirDrop, install the profile, then switch it on under Settings, General, About, **Certificate Trust Settings**.
3. **Start with HTTPS.** `npm run start:lan -- --https` (or `npm run dev:lan -- --https`). The pairing address now starts with `https://`.
:::

The server warns at start when the certificate is expired, expires soon or is not valid for the pairing address (run `npm run lan:cert` again after the computer gets a new address). Settings, Status shows the result.

## Apple Pencil

- The pencil works like a precise mouse in the apps: cell ranges in GridCraft, shapes in DeckCraft and WordCraft, text selection. A hover ring shows where it will land.
- **PdfCraft pencil view**: sign, write notes, highlight and redact on the page with pressure and tilt. Redaction rebuilds the page as an image, so covered text is really removed.
- A finger scrolls, a long press opens the context menu, two fingers zoom. Palm rejection ignores your hand while the pencil writes or hovers.
- Scribble works in the chat input, search fields and the code editor, so handwritten prompts become text.
- WorkCraft learns what your pencil can do. The Apple Pencil (USB-C) and pens such as the Logitech Crayon have no pressure sensor, so WorkCraft draws pressure from the speed of your stroke. Hover shows on iPads that send it (M2 or newer) and barrel roll on the Apple Pencil Pro.

## Keyboard, screen and windows

- The Magic Keyboard has every shortcut with `Cmd`, see [Keyboard shortcuts](#shortcuts).
- **Touch keys.** FilmCraft and ProCraft are worked with shortcuts. Without a keyboard their panel shows a bar of buttons (Split, Delete, Undo and the tools in FilmCraft; Undo, Redo, brush, eraser, color picker, selection, brush size, layers in ProCraft). A button sends the key a keyboard would send and leaves the focus in the app; **Shift** is a latch for the next key; the arrow button docks the bar at the top or the bottom and the keyboard button folds it away. **Settings, Apple Pencil and touch, Touch keys** is Auto (until you use a hardware keyboard), Always or Never.
- When an app saves an export, the notice **Saved: ...** has **Share or save to Files**, which opens the share sheet (Save Video, Save to Files, AirDrop). The file is in the project either way.
- The apps render at the iPad's full Retina resolution with correct sizes and pointer positions.
- Stage Manager, Split View, Slide Over and rotation resize the workspace without reloading the apps. Below 700 pixels width the project tree and the chat become drawers.
- In Slide Over (520 pixels and narrower) the tool rail is hidden; the main menu then starts with **Apps, recent files and workspaces** and **Switch workspace**.
- The chat, the `@` and `/` menus and the terminal stay above the on-screen keyboard.

## Memory and crashes

Safari ends a tab without a message when it uses roughly 1.5 to 2.5 GB. The **memory guard** adds up the memory of the loaded apps. Above 640 MB it tells you once. Above 800 MB it unloads apps that are hidden and saved, the least recently shown first, and above 1100 MB it also asks hidden apps with unsaved changes to save first. It never unloads an app you can see and never throws away unsaved work. A click on an unloaded panel loads it again. The guard runs on every device. It also watches how fast the page answers: a page that stays slow frees one hidden, saved app at a time. An app with unsaved changes is never unloaded without a question: a notice names it and its **Unload** button saves it first. A chip in the top bar ("Memory" or "Slow") shows up only while it matters. Settings, **Memory and GPU** has the switch (on by default), a choice between unloading by itself, asking first and only warning, a budget in MB and the list of what was unloaded and why.

If Safari closes the tab and reloads the page, WorkCraft tells you once (**The page was reloaded**) and keeps the memory limits 20 % lower for that session. On an iPad a workspace does not start two heavy apps together at the beginning (a heavy app opens with a light one); the other is one click away in the launcher. If an app's sound is blocked until the first tap, its panel says **Sound is off. Tap the app once to turn it on.** **Keep these apps offline** checks the free storage first and says how much is needed.

If Safari loses the graphics of an app, WorkCraft reloads the app after 2.5 seconds, or shows a **Reload** banner when there are unsaved changes.

Safari may delete the data of a site you did not open for seven days. An app added to the Home Screen is exempt, and WorkCraft asks Safari to keep its data. Export a project as ZIP for a backup.

> [!NOTE]
> Over plain HTTP on the home network, Safari allows neither WebGPU, offline caching nor the Origin Private File System. The apps then start with WebGL2, WorkCraft runs without an offline cache and keeps browser mode files in IndexedDB. HTTPS with mkcert (above) brings all of it back.

## API keys in browser mode

Without a desktop there is no protected key store. Keys stay in memory until you reload. Under Settings, **iPad and network** you can choose to keep them in this browser's storage; WorkCraft warns you first, because anything with access to the browser profile could read them. Use keys with a spending limit.

<!-- page: privacy | Privacy and security | Your data and API keys | What stays on your computer, what leaves it, and when. -->

WorkCraft is built so that you always know where your data is.

## API keys stay local

- Keys are stored by the backend in `~/workcraft/config.json`. On macOS and Linux the file has mode `0600`, on Windows it is protected by your user profile.
- The interface only ever sees a masked hint such as `…a1b2`.
- A key leaves the computer only inside a request to the provider it belongs to.
- In browser mode (iPad without desktop) keys stay in memory until a reload, unless you explicitly allow storing them in this browser.

## What a cloud model receives

When you chat with a cloud model (Claude, ChatGPT, Gemini, DeepSeek or a remote endpoint), the provider receives:

- your message and the earlier messages of the chat,
- the text of files you mention with `@` or attach, and images you attach,
- the results of tool calls in that answer, for example the rows of a sheet the AI read,
- the passages the [project memory](#memory) adds, and your [personal context](#personas),
- the list of tool definitions.

> [!WARNING]
> Data that reaches a cloud provider is handled under that provider's terms. Use [local-only mode](#local-only) or Ollama for confidential material.

## What never leaves

- Local document data, spreadsheet formulas, presentation slides, and PDF content remain strictly on your device and are never sent to external servers by WorkCraft.
- Optional third-party AI providers (Anthropic, OpenAI, Google, DeepSeek) process only data explicitly submitted by the user through their configured API keys.
- Your project files, unless they are part of a chat request as above.
- The search index and embeddings: they are computed by Ollama on this computer.
- Usage numbers, logs and metrics.
- Snapshots, the trash and the project graph.

## Check it yourself

The [audit log](#audit) lists every outgoing request with destination, model, size and the names of attached files. Blocked attempts are listed too.

<!-- page: local-only | Privacy and security | Local-only mode | One switch that blocks every cloud provider. Only Ollama and local files. -->

Local-only mode is the strongest trust switch in WorkCraft. Find it in **Settings, Privacy**.

When it is on:

- **The backend refuses every cloud provider.** Chat requests, connection tests and the automatic provider choice skip Claude, ChatGPT, Gemini, DeepSeek and remote endpoints. A blocked attempt shows a clear message and lands in the audit log with status *blocked* and zero bytes sent.
- **Local models keep working.** Ollama and your own endpoints on `localhost`, `127.x`, `10.x`, `172.16-31.x`, `192.168.x` or `.local` names stay allowed.
- **Remote MCP servers are blocked.** Plugins over HTTP must point to this computer or the home network.
- **The browser is locked down too.** The page adds a strict Content Security Policy that allows connections only to itself, this computer and the paired desktop. Switching the mode off needs a reload, because browsers cannot loosen a policy.

> [!TIP]
> A lock badge in the top bar and in the chat header shows while the mode is on. Click it to open the privacy settings.

## Local models

1. Install Ollama from ollama.com and start it.
2. Pull a model with tool support, for example `ollama pull qwen2.5:7b`.
3. In Settings, AI models, make Ollama the default.

<!-- page: audit | Privacy and security | Audit log | What left this device? Every outgoing request with metadata only. -->

The audit log answers one question: **what left this device?** Open it in **Settings, Audit log**.

Every entry has:

| Field | Meaning |
|---|---|
| Time | when the request started |
| Destination | the host, for example `api.anthropic.com` |
| Local or cloud | whether the host is this computer or the home network |
| Provider and model | for example Claude, `claude-sonnet-5-5` |
| Sent | size of the request body in bytes, number of images |
| Files | names, kinds and sizes of mentioned or attached files and memory passages, **never their content** |
| Result | sent, blocked or error, with input and output tokens |

Logged events: chat requests, connection tests, blocked attempts, local embeddings, home-network shares (every new device), syncs and calls of remote MCP servers.

The log lives in `~/workcraft/audit.jsonl` (browser mode: IndexedDB) and keeps the last 5000 entries. Export it as CSV or clear it. You can switch it off under Privacy, but keeping it costs nothing.

<!-- page: wipe | Privacy and security | One-click wipe | Delete API keys, projects and chat history securely, for demo devices or handing a device over. -->

**Settings, Privacy, One-click wipe** removes in one step:

- all API keys, your own endpoints and the home-network token,
- all projects with their chats, memory, snapshots, search index and the trash,
- usage statistics and metrics,
- the audit log and the logs,
- the personal context and personas,
- optionally plugins and MCP servers.

Type the confirmation word and press **Delete everything now**. WorkCraft overwrites each file with random data before it removes it, then starts again with an empty project.

> [!WARNING]
> Overwriting is a best effort. SSDs, copy-on-write file systems, snapshots of the operating system and backups can keep old blocks. For devices you hand over, use full-disk encryption as well.

In browser mode the wipe deletes all projects, chats, keys and settings of this browser.

<!-- page: security | Privacy and security | Security and sandbox | Network rules, Content Security Policy and the MCP sandbox. -->

## Network

- The backend listens on `127.0.0.1` and rejects foreign `Host` headers (DNS rebinding) and foreign `Origin` headers.
- Home-network mode is opt-in. Other devices need the access token; cookies count only from the PC's own address.
- The share server for read-only links is a separate small server on its own port. It only answers `GET` below `/s/<token>/`.

## Content Security Policy

The workspace pages carry a policy in the page and, in production, as an HTTP header: scripts only from the same origin, no plugins (`object-src 'none'`), no framing by other sites (`frame-ancestors 'self'`), forms only to the same origin. The apps get their own policy with `wasm-unsafe-eval`, which WebAssembly needs. Local-only mode adds a stricter `connect-src`. The server also sends `X-Content-Type-Options: nosniff`, a same-origin referrer policy and a permissions policy that only allows the camera for document scans.

## MCP sandbox

External MCP servers and plugins run with a sandbox level:

| Level | What it does |
|---|---|
| `strict` | clean environment (no API keys or tokens of the backend), working folder of the plugin, and for Node servers the Node permission model: read the plugin folder and the project, write only the project, no child processes |
| `standard` | clean environment and its own working folder |
| `off` | the full environment of the backend, only for servers you trust |

Every server also has an approval rule: `ask` (every call needs your confirmation), `read` (read-only tools run freely) or `all`. The backend checks a single-use approval token, so a client cannot skip the dialog. Calls time out after 120 seconds and results are capped at 200 KB.

> [!NOTE]
> The Node permission model applies to servers started with `node`. Other programs get the clean environment and the approval rule but no file system limits. Run untrusted tools in a container.

<!-- page: search | Productivity | Search | Full-text and semantic search across documents, sheets, slides, PDFs and chats. -->

Use the search button in the top bar, type `/find` in the chat or use the command palette. The search covers:

- documents (`.docx`, `.odt`), Markdown and text,
- spreadsheets (`.xlsx`, `.csv`), with sheet and row range,
- presentations (`.pptx`), per slide,
- PDFs, per page,
- code files, per block of lines,
- the chats of the project.

Every hit names its place, for example *page 3*, *slide 2* or *Quarters rows 1-25*. Enter opens the file in its app.

## Modes

| Mode | How it ranks |
|---|---|
| Smart | full text and, with embeddings on, meaning combined |
| Exact words | BM25 full text with prefixes and German compounds |
| By meaning | embeddings only |

Without embeddings the full text already understands German and English word forms and a small set of business terms in both languages: "Umsatzprognose" finds "revenue forecast" and the other way round.

## Semantic search with Ollama

1. Start Ollama and run `ollama pull nomic-embed-text`.
2. Settings, Search and memory: switch on **Embeddings with Ollama**.
3. The index computes a vector per passage on this computer. Then "find the part with the revenue forecast" finds the right section even with other words.

The index lives in `.workcraft/index.json` of the project and updates a few seconds after a file changes. The AI can use the same search with the tool `search-project`.

<!-- page: trash | Productivity | Trash | Deleted projects and files stay 30 days and can be restored. -->

Deleting a file in the project tree or a whole project moves it into the trash (`~/workcraft/.trash`). Open **Settings, Trash** or the project menu.

- **Restore** puts a file back at its old path. If that path is taken, it comes back as `name (restored).ext`. A project comes back under its old ID or a new one.
- **Delete for good** overwrites and removes one entry. **Empty the trash** does it for all.
- Entries older than 30 days are removed on start and every six hours.

Snapshot restores and syncs also move replaced files into the trash, so nothing disappears silently.

<!-- page: snapshots | Productivity | Snapshots and undo | Undo across all tools: one snapshot of the whole project and the chats. -->

A snapshot keeps the whole project folder and the chats. Files are stored once in a content-addressed store (`.workcraft/objects`), so snapshots of unchanged files cost no extra space.

## Undo an AI answer

Before the AI writes the first file of an answer, the backend takes an automatic snapshot of that answer. Under the answer you then see **Undo changes**. One click restores every file the answer changed in WordCraft, GridCraft, DeckCraft, PdfCraft and the code editor, and moves files it created into the trash. `/undo` in the chat does the same for the last answer.

## Manual snapshots

- `/snapshot before the big rewrite` in the chat, the command palette, or **Settings, History and snapshots**.
- **Differences** shows what changed, what is new and what was deleted since.
- **Restore** brings back files and chats. Before every restore WorkCraft takes a safety snapshot, so a restore can be undone too.

WorkCraft keeps the last 30 automatic snapshots. **Free unused storage** removes objects that no snapshot and no file version uses.

<!-- page: export | Productivity | Export formats | ZIP, static HTML gallery, PDF portfolio and Markdown documentation folder. -->

Find all formats in the project menu, in the command palette and in **Settings, Share and sync**.

| Format | Result |
|---|---|
| ZIP | the project folder with chats and layout, importable again |
| HTML gallery | `index.html` with cards for every file, one page per file with its content as HTML, originals in `files/`; opens in any browser, no server needed |
| PDF portfolio | cover, contents, every document as text pages, sheets as tables, existing PDFs merged and images embedded |
| Markdown folder | `README.md` as index, one `.md` per file (documents, sheets, slides and PDFs converted), originals in `assets/`, chats in `chats/` |

All formats are built locally. The REST call is `GET /api/projects/<id>/export/<format>` with `html`, `pdf` or `markdown`.

<!-- page: share | Productivity | Home network share and sync | A temporary read-only link on your Wi-Fi, and two-way sync between desktop and iPad. -->

## Read-only link

**Settings, Share and sync, Create link** shows the current project to someone on the same Wi-Fi, without the cloud and without an account.

- A separate small server listens on port 5179 only while a link is active.
- It answers only `GET` requests below `/s/<token>/`: a file list, a preview per file and, if allowed, the original.
- No API, no MCP, no writes. Hidden folders such as `.workcraft` and `.git` are never served.
- Links expire after the time you choose (15 minutes to 8 hours) and end at once when you revoke them.
- Every new device that opens a link lands in the [audit log](#audit).

## Sync between devices

The sync compares both sides with the state of the last sync (three-way):

- changed on one side: copied to the other,
- changed on both sides: the newer version keeps the name, the other one becomes `name (conflict <device> <date>).ext` on both sides,
- deleted on one side and unchanged on the other: deleted there too, into the trash.

**Desktop to desktop:** switch on home-network sharing on the other PC, then enter its IP address and access token under Share and sync. **iPad in browser mode:** under Settings, Share and sync, **Sync now** syncs the browser project with the same project on the paired desktop.

> [!INFO]
> From a page served over HTTPS, browsers block plain HTTP requests to the home network (mixed content). Open WorkCraft over `http://` on the iPad, or put the desktop behind HTTPS.

<!-- page: providers | AI | AI providers and models | Claude, ChatGPT, Gemini, DeepSeek, Grok, GLM, Ollama and your own endpoints, with reasoning, caching and token numbers. -->

Pick a provider in **Settings, AI models**, or switch it for one chat with `/model` or the model menu in the chat header.

| Provider | What you need | Reasoning | Prompt cache |
|---|---|---|---|
| Claude | Anthropic API key | adaptive thinking with an effort level | marked on the tools, the system prompt and large documents |
| ChatGPT | OpenAI API key | reasoning effort with summaries | per chat |
| Gemini | Google AI API key | thinking level or budget | automatic |
| DeepSeek | DeepSeek API key | thinking mode, shown as **Thought process** | prefix cache |
| Grok | xAI API key | shown as **Thought process** when the model sends it | automatic prefix cache |
| GLM | Z.ai API key | thinking switch with effort Low, High or Max, shown as **Thought process** | automatic prefix cache |
| Mistral, Groq, OpenRouter, Together AI | the host's API key | depends on the model | depends on the host |
| LM Studio | LM Studio on this computer | depends on the model | local |
| Ollama | Ollama on this computer or your network | depends on the model | local |
| Custom | base URL, optional key and a model name of any OpenAI-compatible endpoint | depends on the endpoint | depends on the endpoint |

**Test connection** checks a key or endpoint and lists its models. Requests go from the local backend straight to the provider, never through WorkCraft. Only browser mode on the iPad sends them from the browser.

## Effort

The model chip in the prompt bar sets the effort per provider: Auto, Off, Low, Medium, High or Max. WorkCraft translates it into each API's own setting.

## Attachments

PDFs and images you attach go to Claude, Gemini and ChatGPT as real documents and images (up to 8 per message, 20 MB each). DeepSeek, Ollama and custom endpoints get the extracted text.

## Token numbers and costs

- DeepSeek counts are exact, thanks to a built-in V4 tokenizer. ChatGPT counts are exact too. Claude and Gemini are estimated (marked ≈), unless you switch on **Remote counting**, which asks their counting endpoints and sends the text to the provider.
- The chat footer shows the tokens of the chat, the cache hit ratio and the size of the next request while you type. The bar turns orange when the backend will shorten the request to fit, red when even that is not enough.
- **Settings, Usage and telemetry** breaks it all down per provider and model. Costs appear once you enter your provider's rates; local models always cost $0.00.

## Saving tokens

- **Tools for the question.** The model gets the workspace tools and the tools of the apps the question is about (an app you name, a file type, a word from a tool's name, tools used before). The rest, for example the tools of connected Craft apps, stay out of the request and one `find-tools` call away. Each answer shows `saved ≈ n` when something was held back.
- **A history that shrinks.** Behind each new question, older tool results, attached text, open-panel notes and images shrink; the latest question stays whole. The model calls a tool again when it needs a cut result.
- **Team Mode.** The leader reviews with the model only what the automatic checks doubt (review mode **Smart**), and a short request about one app goes straight to that specialist without planning, review or summary.
- The prompt prefix stays the same from round to round, so the caches of Claude, ChatGPT, Gemini, Grok, DeepSeek and GLM keep hitting. Details per provider: `docs/AI-TOKENS.md`.

## Voice input

The microphone next to Send turns speech into text in the draft. Tap to start, tap again to stop; Escape cancels. The text is never sent by itself.

- **Handy** (offline, on your computer) is used when it is installed with a speech model; the audio never leaves the computer. **Browser speech** shows words while you speak but uses the speech service of the browser maker. Settings, Interface, *Voice input* chooses.
- Say "at gridcraft" for `@gridcraft`, "at finances dot xlsx" for `@finances.xlsx`, "slash read sheet" at the start of a sentence for `/read-sheet`.
- If the browser speech service cannot be reached (error "network"), WorkCraft switches to Handy by itself when Handy is ready, and says so in the voice strip. Without Handy the message explains the setup: install Handy, download a model, set Voice engine to Handy in Settings.
- On iPad the page needs HTTPS for the microphone. With a paired desktop the recording goes to the Handy of the desktop PC. Guide: `docs/VOICE.md`.

## DeepSeek presets

Standard chat, Thinking, Deep thinking, and Coding and FIM. The last one powers `Alt \` completions in the code editor. Overrides for max tokens, temperature and effort are in Settings, AI models.

> [!WARNING]
> A cloud provider receives what you send in the chat, see [Your data and API keys](#privacy). [Local-only mode](#local-only) blocks every cloud provider.

<!-- page: team | AI | Team Mode | A Team Leader plans, specialist agents work in parallel, and the leader reviews every result. -->

The switch in the chat header changes between **Single** (one agent) and **Team**. In Team Mode a Team Leader plans your prompt as a task graph, specialist agents work at the same time, and the leader reviews each result before it writes the answer.

| Role | Mention | Works with |
|---|---|---|
| Team Leader | `@leader` | plans, reviews and answers, no tools of its own |
| Data and Sheet Specialist | `@grid-agent` | GridCraft tools |
| Document and Copy Specialist | `@word-agent` | WordCraft tools |
| Presentation Specialist | `@deck-agent` | DeckCraft tools |
| PDF and Compliance Specialist | `@pdf-agent` | PdfCraft tools |
| Code and System Specialist | `@dev-agent` | code, terminal and external MCP servers |

Every specialist can also read the project and the skills: `list-files`, `search-files`, `search-project`, `panel-status`, `list-skills`, `read-skill`, `list-craft-apps` and `recent-files`.

## One specialist for every app

Every app of the catalog has its own specialist, named `@<app>-agent`: `@photocraft-agent`, `@vectorcraft-agent`, `@soundcraft-agent`, `@oxybrush-agent` and so on (`@gridcraft-agent`, `@wordcraft-agent`, `@deckcraft-agent` and `@pdfcraft-agent` reach the four office specialists above). A specialist works only in its own app and receives exactly the tools of that app:

- **An app with a command line tool** (the 19 ArtCraft and community apps): the specialist gets the `ext-<app>-*` tools of that app's MCP server, so it can open, inspect, edit, render and export. The Code and System Specialist now keeps only the MCP servers that are not Craft apps.
- **A web-only app** (the independent apps): there is no tool interface, so the specialist prepares and reads the app's files in the project (`read-file`, `write-file`), opens the app with `open-in-app` and says plainly which steps only you can do inside it. It never pretends to press buttons.

Each specialist has its own instructions for the kind of work: non-destructive edits for photos, units and one feature at a time for CAD, levels and small moves for audio, and so on. A request that names an app or a file type (`@photo.jpg`, "in PhotoCraft") reaches the right specialist; when two enabled apps read the same type, the leader plans instead of guessing.

## One team per workspace

Under **Settings, Team Mode, Team** the group **One team per workspace** has a ready-made team for each of the ten workspaces (Office and Documents, Imaging and Photography, Video, Motion and Audio, Design, 3D and CAD and the others): the leader plus one specialist for every app of that workspace. **This workspace** builds the team of the workspace you are in, also for a workspace you made yourself. **App specialists** lists the specialists on the current team, and **Add a specialist for another app** puts any other app on it.

## The roster

Open it with the roster button next to the switch, `/roster`, or **Settings, Team Mode**. Give the leader and each specialist its own provider, model and effort, for example a cloud leader with local Ollama specialists. Switch specialists on or off, set how many work at once (1 to 6), the review mode and the retries per task. Presets: Full Studio Team, Executive Launch Team, Financial Audit Team, Fullstack Dev Team, Fast Local/Hybrid Team, Document Pipeline, Approved Launch Team and one team per workspace. **Save as** keeps your own.

## How a team run works

:::steps
1. **Plan.** The leader turns your prompt and its `@` attachments into tasks with dependencies and target files.
2. **Work.** Every task whose dependencies are done starts at once, each specialist in its own thread with its own model.
3. **Review.** Each result is checked automatically. In the default review mode (**Smart**) the leader looks at results the checks doubt and can send one specialist back with a precise instruction; **Team Leader reviews each result** looks at all of them. Then the leader answers.
:::

- **Files stay consistent.** Reads never wait. Two writes to the same file wait in line; writes to different files run in parallel.
- **Approvals.** `run-command` and `sign-pdf` ask on top of Mission Control, with the agent, the tool and its arguments: **Allow**, **Allow for this run** (that tool needs no question again until the run ends) or **Deny**. The other agents keep working.
- **Mission Control** shows the phase, a chip per agent (color, icon, model and what it does: thinking, using a tool, waiting for you, finished, failed; the `@` on a chip writes its name into the message box), the progress, the task graph, one lane per specialist with its current tool and file, the shared memory the agents read, and tokens, cache hits and cost per role. **Stop all agents** and **Cancel** per worker are always there.
- With Team Mode on, the agents of the team are chips above the input: a tap writes `@name`.
- Open panels show a badge such as "WordCraft · writing" while an agent writes their file, then reload it.

`@team`, `@leader` or `/team` run the whole team for one prompt. One specialist mentioned alone, such as `@word-agent shorten the summary in @report.docx`, works directly without planning. The team does the same by itself for a short request about exactly one app (setting **Straight to one specialist**); Mission Control says so and offers **Plan with the whole team**.

## Your own agents and patterns

Under **Settings, Team Mode, Your agents**, **New agent** creates an agent with a name, a line the leader reads when it assigns work, its own instructions, provider, model and effort, the groups of tools it may use, a color and an icon. Switch it on for the team like any specialist, and address it directly with `@name`. Delete it and it leaves every team. Save a team with **Save as** to reuse it.

**Working together** picks how the agents cooperate:

| Pattern | What happens |
| :--- | :--- |
| Supervisor and workers | The leader plans, independent tasks run in parallel, the leader reviews each result |
| Sequential | One agent after the other in the order of the plan; each receives the results before it |
| Parallel | Every agent starts at once on its own task |
| Human in the loop | The plan waits in Mission Control for **Approve and start** or **Reject**; nothing runs before you decide |

With **Shared memory** on, what a finished agent reported (and the files it changed) is shown to every agent that starts later. Each agent card says what it is doing: thinking, using a tool (with the icon of the app), waiting for you, finished or failed.

<!-- page: connect | AI | Craft apps, skills and other IDEs | Connect the Craft apps on your computer, read skills, and use WorkCraft from Antigravity, Trae, Cursor, Claude and others. -->

## Craft apps

**Settings, Craft apps** lists the 19 Craft apps that come with a command line tool. WorkCraft finds the ones installed on this computer and connects them as MCP servers, so the AI and your teams can open, edit and save their files: WordCraft, GridCraft, DeckCraft, PdfCraft, PhotoCraft, VectorCraft, LightCraft, DesignCraft, FilmCraft, EffectCraft, SoundCraft, CADCraft, FigCraft, MailCraft, TextureCraft, MaterialCraft, SolidCraft, AniCraft and Craft Anything. The independent apps have no such tool; the AI works on their files in the project. A server that does not start is tried again by itself after a growing delay, and a call that finds its app closed starts it once more. The document suite and every installed app of the workspace you are in are on by default (a server you switched off stays off). Each row shows why an app is not connected, the tools it offers when it is, and **Reconnect**; **Reconnect all** forgets the waiting time of failed servers. Connected servers are checked every 45 seconds: a closed or hung app is replaced before the AI calls it, and a window you open later is picked up by itself. `list-craft-apps` tells the AI for each app whether it has tools, why not, or that it works through project files. **Open** starts an app with its control port, so the AI drives the open window instead of working on files. Their tools are called `ext-<app>-<tool>` and show the app icon on tool cards. Reading runs freely and changes ask first; you can change that rule on the same page.

## Skills

A skill is a folder with a `SKILL.md` that explains how to drive an app or do a task. WorkCraft ships the 13 skills of the Craft apps. The AI sees a one-line index and reads a skill with `read-skill` only when it needs it. Your own skills go into `~/workcraft/skills`; skills installed for other agents in `~/.agents/skills` and `~/.claude/skills` are found too.

## Cloud storage

**Settings, Cloud storage** keeps a project in the cloud as well as on this computer. It syncs both ways a few seconds after a change, every five minutes and on **Sync now**. A file changed on both sides keeps both versions, and nothing is overwritten silently.

**The simple way: the guide.** Choose **Save in the cloud** in the main menu (the command palette has it, **Guided setup** in Settings opens it, and so does the last step of the first-start page when you pick "Also in the cloud"). Pick the service you already use: **Google Drive, iCloud Drive, OneDrive, Dropbox, MEGA, Proton Drive** or **Another service** (pCloud, Nextcloud, Box and others). Each opens three short steps and one button, and no password is typed into WorkCraft: the service's own app syncs a folder, and WorkCraft keeps a copy of the project in a folder called WorkCraft inside it. What the button does depends on the device:

- **A computer with the desktop backend.** WorkCraft looks for the folder of the service (Dropbox, OneDrive including company folders, Google Drive for desktop, MEGA, Proton Drive, iCloud Drive). When it finds it, **Use this folder** is the whole setup. Otherwise install the service's desktop app (the guide links to it), press **Check again** or paste the folder.
- **A browser on its own** (browser mode). In Chrome and Edge **Choose the folder** opens the browser's folder picker once. In Safari and Firefox there is no folder access, so the ZIP route applies.
- **iPad, iPhone and any device without folder access.** **Save ZIP** opens the share sheet: **Save to Files** lists iCloud Drive and every cloud app that is installed (Google Drive, OneDrive, Dropbox, MEGA, Proton Drive ...). Do it again whenever you want a fresh copy; the project also stays on the device.
- **Everywhere:** a ZIP is also offered next to a folder, so there is always a way out, also for a service that is not in the list. The ZIP holds files, chats and layout.

Google Drive can still be connected directly with your own OAuth client (below; the guide's **Advanced** link opens it). A service with a Linux or macOS mount (rclone, for example) works through **Another service**: choose its mount folder.

- **Google Drive.** Create an OAuth client of type Desktop app in Google Cloud Console, enable the Drive API, paste its ID and secret and press **Connect**. The client is yours; the tokens stay in `config.json`. By default only files WorkCraft creates are visible; choose all of Drive to open existing Google Docs. The AI uses `cloud-list`, `cloud-import` and `cloud-export` for Docs, Sheets and Slides (they become .docx, .xlsx and .pptx; sending a file asks for your approval).
- **iCloud Drive.** Apple offers no file API for other apps, so WorkCraft mirrors the project into `WorkCraft/<project>` inside the iCloud Drive folder that iCloud for Windows or macOS keeps. On an iPad open the same folder in Files.
- **Other folders.** OneDrive, Dropbox or a network drive work the same way.

**Local only, in the cloud as well, or opened from the cloud.** A project stays local only until you keep it in the cloud. Kept in the cloud, it lives in both places and the two stay in step (the local copy works offline). **Open a project from the cloud** (below the project list) opens a project that lives in Google Drive or a folder on another computer, browser or iPad: this device gets its own copy and keeps it in step.

**In the browser alone** (for example an iPad without the desktop) the same page works. **Google Drive** is signed in from the page: create an OAuth client of type "Web application", add the redirect address that the page shows, paste the client ID and press Connect; the sign-in stays in this browser for about an hour and is asked for again after that. In Chrome and Edge **a folder of the computer** can be the cloud side (your iCloud Drive, OneDrive or Dropbox folder); the browser asks you to allow it, and again after a restart (press Sync now). Safari and Firefox cannot keep a folder in sync: there use Google Drive, or Export as ZIP and save the file in iCloud Drive with the Files app. One project syncs at a time, the one that is open.

Local-only mode blocks Google Drive. Every request to Google is in the audit log.

## Connect other IDEs

**Settings, Connect other IDEs** shows the MCP address of WorkCraft and ready snippets for Antigravity, Trae, Cursor, Windsurf, Claude Code, Claude Desktop, OpenCode and ZCode. Those tools then work on your project files through the same tools as the built-in assistant. It can also install the 13 skills where Codex, ZCode, Antigravity or Claude Code look for them.
<!-- page: chat | AI | Chat and attachments | Mentions, slash commands, attachments, timeline and multi-step chains. -->

- `@` mentions attach content: `@finances.xlsx`, `@sheets/`, `@wordcraft`, `@terminal`.
- `/` picks a tool or a command. With complete arguments a tool runs directly without a model.
- Attach files with the **+** button, drag and drop or paste. They are saved under `/attachments/`.
- Tool calls show as timeline cards with parameters, duration and result.
- The empty chat asks **What are you working on?** and offers up to three questions that fit the apps of the workspace in use. A tap puts the question and the request "ask me one short question at a time" into the message box; nothing is sent until you press Send.
- The chat header has a New chat button and one menu. Search in the chat, token usage, export, clear, history and Full Chat Mode are in that menu. With no model set up there is no red icon; the banner under the header says what is missing.

## Commands

| Command | Does |
|---|---|
| `/find revenue forecast` | opens the project search |
| `/persona reviewer` | switches the persona |
| `/context client` | switches the named context (`/context off` switches it off) |
| `/remember Prices are net` | keeps a note in the project memory |
| `/memory` | shows the project memory |
| `/undo` | undoes the file changes of the last answer |
| `/snapshot label` | takes a project snapshot |
| `/team write the Q3 report and slides` | runs one prompt in [Team Mode](#team) |
| `/roster` | opens the team configuration |
| `/search term` | searches the messages of this chat |
| `/clear`, `/new`, `/history`, `/export-chat`, `/model`, `/help` | chat housekeeping |

## Prompt bar and approvals

Under the input sit four controls:

- **+** opens a menu: attach files, add a picture, add a link (on iPad and iPhone also scan a document), mention a file or app with `@`, use a tool or command with `/`. A number on the button counts the attachments.
- The **model chip** picks the provider and the reasoning effort. For local models that think (Qwen3.5, DeepSeek-R1 and others) it switches thinking on or off.
- The **approval chip** sets how much the AI may do without asking:
  - **Manual** (default): the AI asks before it runs a shell command or places a signature, and a step that fails waits for you: retry, edit the arguments, report the error to the AI, or cancel.
  - **Auto** (the approval chip next to the model chip; the menu and the tooltip say Auto approval) is full access: commands and signatures run without asking, and a failed step goes straight back to the model, which tries again. An answer that fails three times in a row with the same call stops with a note. The chip turns red while it is on. The first time you switch it on, WorkCraft explains what it means. Snapshots and `/undo` still work, so use it in projects you can restore.
- The round **send button** turns into a **stop button** with a turning ring while the AI works (also `Esc`).

The mode applies to the chat of this workspace, to Team Mode and to external MCP servers started by WorkCraft. Other MCP clients that call `/mcp` still need a single-use approval token for risky tools.

## Chat views

The chat docks left or right of the workspace, fills the window as **Full Chat Mode** (the chat's own menu, the main menu or the command palette), or floats above a document as a picture-in-picture window. In desktop Chrome and Edge it can also pop out into its own always-on-top window. Switching views keeps a running answer and your draft.

<!-- page: vision | AI | Vision and scanning | Images, screenshots and document scans in the chat, for models that read images. -->

Drag images or screenshots into the chat, paste them, or choose **Add a picture** (or **Scan a document** on iPad and iPhone) in the **+** menu:

- On iPad and iPhone the button opens the camera. On desktops it opens the file dialog.
- A scan is cleaned up on the device: scaled to at most 2400 pixels, converted to grayscale and the contrast is stretched so text reads well.
- The image goes to the model as image content (scaled to at most 1568 pixels) and is saved under `/attachments/`.

Ask for example:

- "Extract the table from the screenshot into `/sheets/scan.xlsx`" (GridCraft, tool `write-sheet`)
- "Combine the scans into `/pdf/receipts.pdf`" (PdfCraft, tool `images-to-pdf`)

> [!NOTE]
> Images reach the model only if it reads images, for example Claude, GPT-5, Gemini or Ollama models such as `llava` or `qwen2.5vl`. Text-only models answer from the text.

<!-- page: personas | AI | Personas and personal context | Your own roles and system prompts, and the context the AI always knows. -->

**Settings, Personas and context** holds three things: a persona (a role), your context (facts) and, on top of it, named contexts you switch.

## Personal context

A short text about you that goes into every chat: your role, your company, the language and units you prefer. You write it once and do not repeat yourself.

## Contexts

Named sets of facts: your studio, a client, a subject. Add one with **Add context** (or start from *My work*, *A client project*, *Studies*, *Private*) and switch between them in the chat header or with `/context client`; `/context off` switches it off. One context is in use at a time, next to the always-sent text above.

## Personas

Roles with their own system prompt. WorkCraft ships 19 you can edit, in four groups: **Work** (Financial analyst, Copywriter, Strict reviewer, Technical writer, Data analyst, Project manager, Researcher, Editor and proofreader, Contract reader), **Create** (Creative director, Presentation coach, Photo retoucher, Sound engineer, CAD and 3D engineer), **Build** (Developer, Code reviewer) and **Learn** (Teacher, Translator, Brief answers). A new version adds its new personas to your list; what you edited stays, and **Reset to the original** brings a built-in prompt back. Add your own with **Add persona**, copy one with **Duplicate**, find one with the search and the group buttons. **For this workspace** shows the personas that suit the apps of the workspace you are in.

**Export** saves your personas and contexts as one file, **Import** reads it back (on another computer, for example). The card **What every request carries** shows the exact text that is added to the system prompt and its size in tokens: short is cheaper. Team Mode specialists receive the same text.

Switch the persona in the chat header or with `/persona reviewer`. The menu in the header is short on purpose: **Standard**, up to five personas that suit the workspace you are in (and the one in use), and **All personas and context…**, which opens this page. Contexts are switched here or with `/context`. The answer shows which persona wrote it.

> [!WARNING]
> The personal context and the persona prompt go to the model of the chat. With a cloud model they leave the device; with local-only mode they do not.

<!-- page: memory | AI | Project memory | The chat keeps the context of the current project on its own (RAG). -->

Before every question the chat adds a `<project_memory>` block with:

1. **Pinned notes and decisions.** Keep them with `/remember`, the **Remember** button under an answer, or Settings, Search and memory. The AI can save decisions itself with the tool `remember`.
2. **Recent AI steps.** Which tool wrote which file from which inputs, from the [project graph](#graph).
3. **Relevant passages.** The best passages of the [search index](#search) for this question, with path and place.

The memory lives in the project (`.workcraft/memory.json` and the local index), travels with the project ZIP (notes) and never leaves the device unless it goes to a cloud model as part of a chat. Under an answer you see how many notes and passages were used. Switch it off or set the number of passages in Settings, Search and memory.

<!-- page: graph | AI | Project graph | Assets, dependencies, version history and which file came from which MCP step. -->

The project graph is more than the file tree. For every file it keeps:

- **Versions.** The last 20 versions with time, size, origin (editor, app, tool, sync, snapshot) and the content in the object store, so any version can be restored.
- **Producer.** Which MCP step wrote it: the tool, its call ID and the chat answer (chain).
- **Dependencies.** Edges "derived from": a step that read `/sheets/finances.xlsx` and wrote `/documents/report.docx` links the two.

That makes multi-step pipelines traceable and reliable: you see where a slide came from and can roll back one file without touching the rest. Open it in **Settings, History and snapshots**, or ask the AI with the tool `file-history`.

<!-- page: plugins | Developers | Plugin API | Add PhotoCraft, ArtCraft, Blender headless, ComfyUI and more as MCP servers. -->

A plugin is a folder in `~/workcraft/plugins/<name>/` with an `workcraft.plugin.json`. WorkCraft starts it as an MCP server, adds its tools to the chat under `/` and keeps the core unchanged.

```json
{
  "name": "comfyui",
  "title": "ComfyUI",
  "version": "0.1.0",
  "description": "Image generation with a local ComfyUI",
  "mcp": { "transport": "http", "url": "http://127.0.0.1:8188/mcp" },
  "sandbox": "strict",
  "approval": "ask",
  "accent": "#A855F7"
}
```

## Fields

| Field | Values |
|---|---|
| `name` | lowercase letters, digits and dashes |
| `mcp.transport` | `stdio` with `command`, `args`, `env`, or `http` with `url` |
| `sandbox` | `strict`, `standard`, `off`, see [Security and sandbox](#security) |
| `approval` | `ask`, `read`, `all` |
| `accent` | color of the tool cards |

`${pluginDir}` and `${home}` in `command` and `args` are replaced. A stdio example:

```json
{
  "name": "photocraft",
  "title": "PhotoCraft",
  "mcp": { "transport": "stdio", "command": "node", "args": ["${pluginDir}/server.js"], "env": {} },
  "sandbox": "strict",
  "approval": "read"
}
```

**Settings, Plugins and sandbox** lists installed plugins with their status, the sandbox that applies and their tools, and a catalog with templates for ComfyUI, Blender headless, PhotoCraft, ArtCraft and the MCP test server. Templates start switched off, so you can check the command first.

Tool names of plugins get the prefix `ext-<server>-`. Files the tools write show in the apps like any other change.

<!-- page: tools | Developers | MCP tools | The tools the AI and external MCP clients can call. -->

WorkCraft is itself an MCP server at `http://localhost:5175/mcp` (Streamable HTTP), and an MCP client for your own servers and the Craft apps on your computer (their tools are named `ext-<app>-<tool>`). Every call is checked with a Zod schema.

| Tool | App | Does |
|---|---|---|
| `read-sheet`, `write-sheet` | GridCraft | read calculated values, write values and formulas |
| `read-document`, `write-document` | WordCraft | read as Markdown, write Markdown as `.docx` or `.md` |
| `read-slides`, `create-slide` | DeckCraft | read slide texts, create slides |
| `read-pdf`, `sign-pdf` | PdfCraft | read text, place a signature block (needs approval) |
| `images-to-pdf` | PdfCraft | combine images and scans into a PDF |
| `search-project` | project | full-text and semantic search across files and chats |
| `remember` | project | keep a note in the project memory |
| `file-history` | project | versions and lineage of a file |
| `list-files`, `search-files`, `read-file`, `write-file` | code | files and text |
| `run-command` | terminal | shell command with approval |
| `list-skills`, `read-skill` | project | list and read the skills that explain how to drive the apps |
| `cloud-list`, `cloud-import`, `cloud-export` | project | Google Drive: list files, copy a file in (Docs become .docx), send a file out (needs approval) |
| `open-panel`, `panel-status`, `list-craft-apps`, `open-in-app`, `recent-files` | workspace | panels and the 44 apps in the browser (`list-craft-apps` filters by file type, workspace, origin or availability) |

Add it to Claude Code with `claude mcp add --transport http workcraft http://localhost:5175/mcp`, or to any MCP client that speaks Streamable HTTP. Requests from other devices need the access token, like the REST API.

<!-- page: api | Developers | REST API | The endpoints of the local backend. -->

All paths are below `/api` on the backend port. From another device in the home network they need the access token (`x-oc-token` header or the pairing cookie).

| Endpoint | Use |
|---|---|
| `GET /search?q=&mode=&kinds=` | project search |
| `GET /search/status`, `POST /search/reindex` | index state, rebuild |
| `GET /memory`, `POST /memory`, `POST /memory/context` | project memory |
| `GET /trash`, `POST /trash/<id>/restore`, `DELETE /trash/<id>` | trash |
| `GET /snapshots`, `POST /snapshots`, `POST /snapshots/<id>/restore` | snapshots |
| `GET /snapshots/chain/<answer>` | the automatic snapshot of a chat answer |
| `GET /graph`, `GET /graph/file?path=`, `POST /graph/restore` | project graph and versions |
| `GET /projects/<id>/export/<format>` | export formats: `html`, `pdf`, `markdown` |
| `GET /share`, `POST /share`, `DELETE /share/<token>` | read-only links (desktop only) |
| `GET /sync/<id>/manifest`, `GET`, `PUT` or `DELETE /sync/<id>/file`, `POST /sync/peer` | home-network sync |
| `GET /plugins`, `POST /plugins/install`, `PUT /plugins/<name>` | plugins |
| `PUT /config/privacy`, `PUT /config/personal`, `PUT /config/search` | settings |
| `GET /audit`, `GET /audit/export`, `DELETE /audit` | audit log |
| `GET /logs`, `GET /metrics`, `GET /metrics/report` | observability |
| `GET /health/full`, `GET /health/resources` | health check, resources |
| `POST /wipe` with `{"confirm":"WIPE"}` | one-click wipe (desktop only) |

<!-- page: observability | Developers | Logs and metrics | A local log panel and optional performance metrics that never leave the device. -->

**Settings, Logs and metrics** shows one log of the backend and the interface: errors, warnings, MCP tool calls with their latency, AI requests with tokens, app start times, connection changes. Filter by level and text, save as a text file or clear it. The log is only on this computer; the backend keeps the last 2000 lines in memory.

## Performance metrics

Optional and off by default. When you switch them on, WorkCraft records locally in `~/workcraft/metrics.json`:

- start time of each WebAssembly app (`app:gridcraft`),
- latency per MCP tool (`mcp:read-sheet`),
- time to the first token per provider (`ttft:anthropic`),
- search time and the load time of the workspace.

The table shows p50, p95 and the maximum. **Export the anonymized report** writes a JSON file with tool and app names and numbers only, no file names, paths, host names or content. Nothing is sent anywhere; you decide whether to share the file.

<!-- page: health | Developers | Health check and monitor | Backend, MCP, WebAssembly, WebGPU, service worker and Ollama at a glance, plus memory per app. -->

## Health check

**Settings, Health check** runs these checks at once:

| Check | What it tells |
|---|---|
| Backend | version, Node, uptime, memory |
| MCP server | the backend connects to its own `/mcp`, counts tools and measures the list time |
| External MCP servers | status and tools of plugins |
| Ollama | reachable, version, models, embedding model present |
| Terminal, disk, system memory | the tools WorkCraft needs |
| WebAssembly | ready, SIMD, threads |
| WebGPU | adapter and GPU, otherwise the apps use WebGL2 |
| WebGL2 | renderer |
| Service worker | offline cache |
| Browser storage, secure context | quota and HTTPS |

## Memory and GPU monitor

**Settings, Memory and GPU** updates every two seconds and shows for each app panel the WebAssembly memory, an estimate of its GPU memory (WebGPU buffers and textures, WebGL buffers and textures), the start time and the state. **Kill** unloads one app at once; **Emergency stop** unloads all apps. A warning appears when the apps use more than about a third of the device memory. The memory guard acts on every device: it unloads hidden, saved apps when the total passes its budget or the page stays slow, and offers apps with unsaved changes instead of unloading them (see [iPad and Apple Pencil](#ipad)).

> [!NOTE]
> GPU values are estimates from what the apps allocate. Browsers do not report the real GPU memory of a page.

<!-- page: faq | Help | FAQ | Short answers to common questions. -->

## Does WorkCraft send my files to the cloud?

Only when you chat with a cloud model and the file is part of that chat: mentioned with `@`, attached, read by a tool in that answer, or added as a memory passage. The [audit log](#audit) shows each case. With [local-only mode](#local-only) nothing goes to the cloud.

## "Model or endpoint not found" (HTTP 404)

The name of the model does not exist at that provider (an Ollama model you never pulled, a retired model id, a typo), or the address is wrong. WorkCraft now asks the provider which models it has and repeats the request once with the closest one: the same name with another tag, the same family, or the best chat model on the list. The answer says which model replied, and **Keep** makes it the setting. When the model list itself does not answer, the message names the address (OpenAI-compatible addresses usually end in `/v1`); when the provider lists no model, it says so (for Ollama, pull one with `ollama pull qwen3:4b`).

## "/api/config/team is not available in browser mode"

Fixed. Team settings and agents are now saved in the browser (like the personas) when no desktop backend is running; the team editor works the same way.

## Where are my API keys?

In `~/workcraft/config.json` on your computer. The interface sees only a mask. The [one-click wipe](#wipe) removes them.

## Can I undo what the AI did?

Yes. **Undo changes** under the answer, `/undo`, or a [snapshot](#snapshots).

## Does the search need Ollama?

No. Full-text search works without it. Ollama adds search by meaning.

## Does this documentation chat send my question somewhere?

The chat on these pages searches the documentation in your browser. When the WorkCraft backend runs, it asks your default model with the best passages; with a cloud model that question leaves the device like any chat and appears in the audit log. Without the backend it answers with the matching sections only.

## Are WorkCraft, Microsoft, and Adobe related?

No. WorkCraft is an independent project and is not affiliated with, endorsed by, or sponsored by Adobe Inc., Microsoft Corporation, or their affiliates. All product names, logos, and brands (such as Microsoft Word, Excel, PowerPoint, Adobe Acrobat, Photoshop) are the property of their respective owners. References to file formats (`.docx`, `.xlsx`, `.pptx`, `.pdf`) are used solely for technical compatibility descriptions.

## How are WorkCraft and the crafting engines separated?

WorkCraft provides the workspace shell, window management, project tree, local companion server, and Model Context Protocol (MCP) orchestration layer. WordCraft, GridCraft, DeckCraft, and PdfCraft are independent open-source engines developed by storytold and the ArtCraft team ([github.com/storytold](https://github.com/storytold)) under `MIT OR Apache-2.0`. All upstream copyright notices and license references are maintained intact.

## What warranty and liability protections apply?

WorkCraft, local companion server, and embedded crafting engines are provided "as is", without warranty of any kind, express or implied. For intellectual property notices or DMCA takedown requests, rights holders may email `visoire@proton.me`. Complete terms and disclaimers are set forth in [docs/LEGAL.md](https://github.com/visoire/workcraft/blob/main/docs/LEGAL.md).
