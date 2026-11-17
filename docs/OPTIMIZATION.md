# Making WorkCraft faster

WorkCraft runs many independent apps as panels of one window, next to a code editor, a terminal and an AI assistant. That is more than a normal web page asks of a computer, and it is still alpha, so it can feel slow on some devices. This guide lists what helps, most effective first. You do not need all of it: the first two sections fix most problems.

Everything here is advice, not a guarantee. Where a tip depends on your device or browser version, it says so.

## 1. The biggest lever: fewer panels open

Every open app costs memory and CPU, and the heavy ones (photo, video, 3D, CAD, music) cost a lot.

- Keep 2 to 4 panels open instead of 8 to 10, and close what you are not working in.
- **Hide is not close.** The X of a panel only hides it: the app stays loaded and keeps its state, so it still uses memory. To give the memory back, open the panel's menu (right-click the header, a long press on iPad, or the app's icon in the rail) and choose **Close and free memory** (red). Save first.
- A heavy app makes room for itself: it pauses the apps you are not looking at, and on an iPad it opens fewer apps together. Hidden apps pause and keep their state.
- Opening a workspace starts nothing by itself. Open only the apps you need ("Open the first apps" opens one or two, depending on the device).
- Close other browser tabs, especially video, dashboards and other web apps, and quit desktop programs you do not need.

### The memory guard

WorkCraft watches its own memory use and how responsive it is. When it gets tight, a badge appears in the top bar. Click it to open the monitor (**Settings > Overview > Memory and GPU**), which shows what each app uses and what the guard did.

- **Memory guard** (Settings > Overview > Memory and GPU): Automatic, On or Off.
- What it does when memory is short (the setting "memory action"): free hidden, saved apps by itself, or offer them in a notice, or only warn. It never saves or frees an app with unsaved work on its own: it asks.
- If the last session ended from outside (the browser closed the tab), the next session starts with a lower budget.

## 2. Choose the right browser

| Device | Best choice | Why |
| :--- | :--- | :--- |
| iPad | **Safari** | WorkCraft's iPadOS layer (touch, Apple Pencil, Magic Keyboard, Stage Manager, a memory governor) was built and tested against WebKit. Every iPad browser uses WebKit, so raw speed is similar, but Safari has the best integration, battery use and memory handling. |
| Windows, macOS, Linux | **Chrome or Edge** | Canvas and WebGL tools, many panels and the assistant usually run best on Chromium. Edge is often a little leaner on Windows. |
| Any desktop | **Brave** | Chromium underneath, so close to Chrome, with more tracker blocking by default. |
| Any desktop | Firefox, Safari (Mac) | Supported. Firefox can feel heavier with many panels; Safari on a Mac is kind to the battery but usually slower with many heavy panels. |

Tip: use a separate browser profile or window for WorkCraft, so other tabs and extensions do not compete with it.

## 3. Browser and system settings

### Hardware acceleration (important)

- Chrome, Edge, Brave: **Settings > System > Use graphics acceleration when available**, then restart the browser.
- Keep your graphics driver up to date (Windows and Linux in particular). WebGL 2 or WebGPU helps the creative apps; apps that need it fall back by themselves when it is missing.
- On a laptop with two graphics chips, make sure the browser uses the fast one. On Windows: **Settings > System > Display > Graphics**, add `chrome.exe` or `msedge.exe` and choose **High performance**.

### Memory and tabs

- Turn on Memory Saver (tab sleeping) for your *other* tabs, but keep the WorkCraft tab active.
- Remove extensions you do not need. Ad blockers and script blockers inspect every page change and can slow a page with many panels. On an iPad, switch content blockers off for `workcraft.cc`.
- Clear the site data of `workcraft.cc` now and then, especially after an alpha update, so stale cached files do not linger.

### Power

- On a laptop, plug in and choose a high performance power mode. Avoid Low Power Mode or Battery Saver while you work.

### Advanced, desktop browsers only

These are for people who are comfortable changing browser settings. Test one at a time and undo it if it does not help.

- `chrome://flags` (or `edge://flags`, `brave://flags`): **Override software rendering list** (use the GPU even on a driver the browser distrusts), **GPU rasterization**, **Zero-copy rasterizer**. On Windows, try the other **ANGLE graphics backend** if heavy CAD or 3D panels stutter.
- Memory: a Chromium tab has a default limit for its JavaScript heap. If a very large project makes the page freeze while it cleans up, you can raise it in the browser's shortcut with `--js-flags="--max-old-space-size=8192"` (only on a machine with 16 GB of RAM or more).
- Background throttling: `--disable-renderer-backgrounding` and `--disable-background-timer-throttling` stop the browser from slowing WorkCraft down when you glance at another window.
- A window of its own: start the browser with `--app=https://workcraft.cc/app/` for a window without an address bar or tabs.
- Windows Defender scans every change in a project folder. If you run WorkCraft from source, add the project folder and the Node.js folder to the exclusions of **Virus & threat protection** to cut that cost.
- With 4 to 8 GB of RAM, a fixed page file of 8 to 16 GB on a fast SSD helps to survive memory peaks.

## 4. The AI assistant

The assistant is the other big cost, especially with a team of agents.

- **Single assistant first.** Use Team Mode only when a task really has several parts. A team runs several models at once and sends more text.
- **Cloud or local?** A cloud model (your own key) is usually quicker and better at long tool chains. A local model only makes sense if your machine is strong enough; small models struggle with long chains and make more mistakes. See [AI providers](AI-PROVIDERS.md).
- **Token economy.** WorkCraft sends the model only the tools that fit the task (a router with a "find tools" step), shortens the descriptions of tools from other servers and compacts old turns. That is why a chat stays fast longer. You help by keeping a chat on one subject and starting a new chat for a new one. See [AI tokens](AI-TOKENS.md).
- Do not run a heavy AI task while many visual panels (photo, video, CAD, 3D) are open.
- On an iPad the assistant can reach an Ollama on your desktop over your home network; keep the network steady.
- **Local-only mode** (Settings > Privacy) blocks every cloud provider. It does not make anything faster, but it makes sure a slow local model is not silently replaced.

### Local models (Ollama, LM Studio)

When a local model is slow, the cause is usually that it does not fit in the graphics memory.

- **Context size.** Settings > AI shows how many tokens the running model uses (`num_ctx` in Ollama) and how much of it sits in GPU memory. A multi-agent prompt is large; a context of 4096 to 8192 tokens is often a good balance, while 32768 or more can fill the graphics memory with the attention cache and push the model into slow system RAM. Choose a smaller context or a smaller model if the note says part of the model runs on the CPU.
- **Quantization.** A 4-bit model (for example `Q4_K_M`) is much lighter on memory bandwidth than Q8 or FP16 and is usually fast enough for tool work.
- **Ollama settings.** `OLLAMA_FLASH_ATTENTION=1` can speed up long inputs and lower memory use. `OLLAMA_KEEP_ALIVE=-1` (or for example `60m`) keeps the model loaded between steps, so the next answer does not wait for loading.
- Choose one model per job: a small fast model for edits and a larger one for planning, instead of one huge model for everything.

## 5. On an iPad

Chromium flags do not exist on iPadOS (all browsers use WebKit), but you can still help Safari:

- Use **Safari** and keep few panels open. The memory guard works on every device, and on an iPad a heavy app opens with fewer others around it.
- **Add to Home Screen** (Share, then Add to Home Screen) to run WorkCraft as a full-screen web app without the Safari bars. That is also how the workspace is installed.
- Switch off content blockers and script extensions for `workcraft.cc`.
- With an external display, use Safari full screen instead of several overlapping Stage Manager windows; resizing many windows with WebGL canvases uses a lot of graphics bandwidth.
- Keep free storage healthy and close other apps. In **Settings > General > Background App Refresh**, limiting other apps leaves more memory for the session.
- A recent iPad (M series) is clearly better than an older one.
- Files: large files of the browser version are kept in the browser's own storage and the guide **Save in the cloud** (Settings > Cloud) can keep a copy in your cloud service. If storage is tight, export a ZIP of a project you are not working on.

WorkCraft's iPad support is built and tested in an iPad-sized WebKit browser, but not yet proven on a physical iPad. If it is slow on your iPad, please report it (see section 8).

## 6. Device recommendations

| | Practical minimum | Comfortable |
| :--- | :--- | :--- |
| Desktop RAM | 8 GB | 16 GB or more |
| iPad | a recent model | M series |
| Storage | free space | do not run on a nearly full drive |
| Graphics | a GPU with WebGL 2 | a recent GPU for the creative apps |

Very large project folders and many open files add to the memory use.

## 7. Running it from source

WorkCraft also runs from source with Node.js 22 or newer, which adds the terminal, local models and the desktop apps (see [Self-hosting](SELF-HOSTING.md)).

- Use a production build (`npm run build`, then `npm start`) instead of `npm run dev`. The dev server serves unminified scripts and reloads modules on every change.
- Large project folders and many agents can need more memory in the backend: set `NODE_OPTIONS="--max-old-space-size=8192"` before starting.
- The optional **WorkCraft AI** desktop app (Rust) is a lighter place for the AI side if the browser is too heavy; the Craft apps can run natively next to it.
- MCP tools and file access stay on your machine. Network time only appears with a cloud model, or when an iPad reaches an Ollama on your desktop.

## 8. A checklist when it feels slow

1. Close the panels you do not use (menu: **Close and free memory**).
2. Close other tabs and desktop programs.
3. Check that hardware acceleration is on, and that the browser uses the fast graphics chip.
4. Restart the browser, or the device.
5. Clear the site data of `workcraft.cc`.
6. Use a lighter AI setup: one assistant, a stronger model, a smaller context.
7. Laptop: plug in and use a high performance mode.
8. iPad: use Safari, add WorkCraft to the Home Screen, free memory by closing other apps.

## Reporting a performance problem

A good report lets the team find the cause. Please include:

- the device and the operating system version,
- the browser and its version,
- how many panels were open, and which apps,
- whether the assistant was active (single or team, local or cloud, which model),
- the size of the project (number of files),
- what the memory badge or **Settings > Overview > Memory and GPU** showed.

Open an issue at [github.com/visoire/workcraft/issues](https://github.com/visoire/workcraft/issues/new/choose) or use the contact page of the website.
