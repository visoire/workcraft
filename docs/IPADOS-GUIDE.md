# iPadOS guide

WorkCraft runs on iPad mini, iPad Air and iPad Pro (11 and 13 inch) in Safari, or as a full-screen app
from the Home Screen. This guide covers the two modes, pairing with a desktop, the Apple Pencil, the
Magic Keyboard and the known limits.

## Two modes

WorkCraft picks the mode on its own, and the Status page (Settings, Status) shows which one is active.

| Mode | When | What works |
| :--- | :--- | :--- |
| **Home network (Wi-Fi)** | the desktop shares WorkCraft on Wi-Fi and the iPad is paired | everything: the desktop's projects, the real terminal, Ollama on the desktop, all MCP tools |
| **Browser (offline)** | no desktop answers: on the road, or the PWA offline | every app, projects stored on the iPad in IndexedDB, the chat with your own API key, file import and export, the Apple Pencil in PdfCraft |

Projects of the two modes are kept apart. Move a project between them with ZIP export and import, or
use **Sync now** under Settings, Share and sync.

## Pair the iPad with your desktop

1. **On the desktop**, open Settings, **iPad and network** and switch on **Share on Wi-Fi**, then
   restart the backend. Or start it directly with:

   ```sh
   npm run dev          # development
   npm start            # production build
   ```

   Both share WorkCraft on your home network by default (`npm run dev:local` and `npm run start:local` listen on this
   computer only). The first time, Windows asks whether Node.js may use private networks: allow it, or the iPad cannot connect.

   The backend then listens on your network and prints a pairing address such as
   `http://192.168.178.20:5175/pair?token=...`.
2. **On the iPad**, open that address once in Safari. You can also enter the desktop's IP address,
   port and access token under Settings, **iPad and network**, **Connect to desktop**.
3. From then on, `http://<your PC>:5175/` opens WorkCraft with your desktop projects.

The pairing address also appears as a QR code in Settings, iPad and network. It contains the access token, so show it only to your own devices; renewing the token cancels old pairings.
4. Optional: Share, **Add to Home Screen** gives a full-screen app without browser bars.

How it stays safe: the desktop itself works as before. Every other device needs the token, stored as
an `HttpOnly`, `SameSite=Strict` cookie for that address. A cookie only counts when the request comes
from the desktop's own address, so other web pages on the same Wi-Fi cannot use it. **Renew** in the
settings disconnects all paired devices. The network settings and the token can only be changed on the
desktop.

## HTTPS on the home network (recommended)

Over `http://192.168.x.x` Safari treats the page as insecure and switches off WebGPU, the service worker (so the offline
cache), OPFS and persistent storage. A certificate that the iPad trusts brings all of them back. WorkCraft uses
[mkcert](https://github.com/FiloSottile/mkcert) for that; WorkCraft never sees the certificate authority's key.

1. **On the desktop**, install mkcert once (`winget install FiloSottile.mkcert`, `brew install mkcert`), then run:

   ```sh
   npm run lan:cert
   ```

   It makes the certificate for `localhost`, `127.0.0.1`, this computer's network addresses and `<name>.local`, and writes
   `cert.pem` and `key.pem` to `<data folder>/certs/`. Run it again when the computer gets a new address.
2. **On the iPad**, once: send `rootCA.pem` (the command prints its location) to the iPad with AirDrop, open it, install the
   profile (Settings, General, VPN & Device Management), then switch the mkcert root on under Settings, General, About,
   **Certificate Trust Settings**.
3. **Start WorkCraft with HTTPS:**

   ```sh
   npm run start:lan -- --https      # production build
   npm run dev:lan -- --https        # development
   ```

   The pairing addresses now start with `https://`. The server warns at start when the certificate has expired, expires
   within 30 days, or is not valid for the pairing address. A missing certificate falls back to HTTP with a message.
   `--tls-cert=<file> --tls-key=<file>` (or `WORKCRAFT_TLS_CERT` and `WORKCRAFT_TLS_KEY`) use certificates from another source.

Settings, Status shows the result: secure context, service worker, WebGPU and the iPadOS layer line (mode, storage, renderer).

## Apple Pencil

WorkCraft separates pen, finger and mouse input (Pointer Events) and reads pressure, tilt, azimuth,
barrel roll and hover.

- **In the apps** the pencil works like a precise mouse: cell ranges and the fill handle in GridCraft,
  placing and reshaping vector shapes in DeckCraft and WordCraft, selecting text. A hover ring and a
  short trail in the app's color show where it will land.
- **PdfCraft pencil view** (`src/workspace/pdf-pen.ts`): sign, write notes, highlight and redact on
  the page with pressure and tilt. Applying writes the PDF into the project; PdfCraft shows the result
  without reloading. Redaction rebuilds the affected page as an image, so the covered text is removed
  from the file, not just hidden.
- **Fingers and palm**: a finger scrolls, a short tap clicks, a long press opens the context menu, two
  fingers zoom. A touch is ignored when it is a palm: a large contact, the pencil writing or just lifted, or a touch
  within 210 px of a hovering pencil. The other hand still pans while the pencil hovers.
- **Finger and keyboard**: once the Apple Pencil was used, a finger tap on a text field does not raise the on-screen
  keyboard (the pencil writes with Scribble). The keyboard button in the chat input brings it up on purpose. Settings,
  Apple Pencil and touch, Finger opens the keyboard: until the pencil is used (default), never, always.
- **Pen and eraser**: the eraser end of a pencil and the barrel button switch to the eraser while held (Settings,
  Pencil barrel button); E and the toolbar of the PdfCraft pencil view switch it too, and a chip names the tool. The
  eraser removes whole strokes and one undo brings them back. Scribbling a zig-zag over ink deletes that ink.
- **Hover circle**: the real width of the line for the pen, a dashed circle for the eraser, a band for the highlighter,
  stretched along the tilt. Only on iPads that send hover.
- **Scribble** works in every text field (chat input, search, code editor), so handwriting becomes
  text and scratching a word out deletes it. App canvases and drawing surfaces block it, so they get pencil input instead.
- **Voice**: the microphone next to Send needs HTTPS (a secure page) and the permission of Safari. Paired with a desktop, the
  recording goes to the Handy of the desktop PC and the text comes back (offline, no cloud); in browser mode the speech
  recognition of Safari is used. See [VOICE.md](VOICE.md).
- **Layout on iPad**: in portrait (under 900 px) the project tree and the chat open as drawers, one at a time. Tabs other
  than the active one show only their icon. The top bar and the tool rail can be hidden (menu, `Cmd \`, `Cmd Shift \`);
  a handle at the top edge brings the top bar back.

The apps have no drawing API of their own, so pressure and tilt shape the strokes in the PdfCraft
pencil view and the visual feedback, not ink inside the apps. Apple Pencil Pro squeeze and double tap
are not available to web pages.

**Which pencil you have.** WorkCraft learns from the pen's own events instead of assuming. Apple Pencil (USB-C) and pens
such as the Logitech Crayon have no pressure sensor and always report 0.5: after a few strokes WorkCraft simulates a
pressure from how fast you draw (slow is heavier), so lines are not one flat width. The hover ring appears only on iPads that
send hover (iPad Pro and Air with M2 or newer). Barrel roll needs the Apple Pencil Pro. Settings, Status shows what was
detected ("pen: pressure, hover, roll").

## Magic Keyboard and trackpad

All shortcuts work with `Cmd`:

| Shortcut | Does |
| :--- | :--- |
| `Cmd+K` | command palette: every action is in it (chat, Full Chat Mode, search, picture in picture, focus mode, top bar, minimize, maximize) |
| `Cmd+\` | project tree |
| `Alt+Enter` | full screen for the focused panel |

Browser shortcuts (`F2`, `Cmd+J`, `Cmd+Shift+J` and the like, `Alt+1` to `Alt+9`) are not used by WorkCraft, so nothing is taken from Safari.

Arrow keys, `Tab` and `Enter` move through the `@` and `/` menus. Without a hardware keyboard, the
header and the chat show quick buttons for the command palette, `@` and `/`.

## Screen, windows and keyboard

- **Retina at 1:1.** The apps' web builds sized their canvas in CSS pixels but rendered at the device
  pixel ratio, so on Retina screens their interface appeared twice as large. `public/craft-frame.js`
  runs inside each app before its WebAssembly module, lays the canvas out at physical size and scales
  it back, so sizes, sharpness and pointer positions are exact.
- **Stage Manager, Split View, Slide Over and rotation** resize the workspace without reloading the
  apps. Below 700 pixels width the project tree and the chat become drawers.
- **On-screen keyboard.** The workspace follows the visual viewport, so the chat, the `@` and `/`
  menus and the terminal stay above the keyboard.
- **Slide Over** (520 pixels and narrower) hides the tool rail; the main menu then starts with "Apps, recent files and workspaces" and "Switch workspace", so the launcher and the workspace picker stay reachable.
- **Touch targets** are at least 44 by 44 pixels. Gutters between panels snap to 50:50, 70:30 and
  30:70 when you drag them with a finger or the pencil.

## Memory, storage and crashes

- **Memory guard.** Safari ends a tab without a message when it uses roughly 1.5 to 2.5 GB. WorkCraft adds up the memory of
  all loaded apps. Above 640 MB it tells you once; above 800 MB it unloads apps that are **hidden and saved**, the
  least recently shown first (the panel shows "Memory freed. Click to load again."); an app with unsaved changes is offered in a notice with an
  **Unload** button that saves it first. It also watches how fast the page answers: a page that stays slow frees one hidden, saved app at a time. It never
  unloads an app you can see and never throws away unsaved work. If nothing is left to unload and memory is still full, it says so. A chip in the top bar shows
  "Memory" or "Slow" while it matters. Settings, Memory and GPU has the switch (on by default, on every device), a choice between freeing by itself, asking first and only
  warning, a budget in MB and the list of what was unloaded and why.
- **Safari reloaded the page.** Safari closes a tab that uses too much memory and reloads it without any message. WorkCraft notices that the last session never ended properly and tells you once ("The page was reloaded"),
  with a button to the memory monitor. For the rest of that session the memory limits are 20 % lower, so the same apps do not push it over again.
- **Lost graphics.** If Safari loses the graphics of an app, WorkCraft waits 2.5 seconds, then reloads that app. With unsaved
  changes it shows a banner with **Reload** instead.
- **Storage in browser mode.** Files of 128 KB and more live in the Origin Private File System, the rest and the project data
  in IndexedDB. A save is crash safe. Over plain HTTP, or when OPFS is not available, everything stays in IndexedDB.
- **Safari may delete site data after seven days without use** when WorkCraft runs in a Safari tab. An app added to the Home
  Screen is exempt. WorkCraft asks for persistent storage; Settings, Status shows the answer and the note "Add to Home Screen
  keeps your data". Export a project as ZIP (Settings, Share and sync) for a backup either way.
- **Multithreading.** The office apps do not need it. If a later app does, WorkCraft offers "Enable and reload", which needs HTTPS.

How the pieces fit, and how a new app release is checked, is in [IPADOS-COMPAT.md](IPADOS-COMPAT.md).

## Workspaces and the other Craft apps on the iPad

Besides the office apps, WorkCraft has workspaces for photos and vectors, video, motion and audio, design, and 3D and CAD
(see [ECOSYSTEMS.md](ECOSYSTEMS.md)). On an iPad without a desktop the whole thing runs in the browser:

- **Pick a workspace** with the grid button on the rail. The files stay in the project (browser mode: IndexedDB and OPFS), so
  one file opens in every app that reads it (Open with).
- **Keep the apps offline.** In the launcher, **Keep these apps offline** loads the engines of the workspace onto the iPad
  (needs HTTPS or the installed app, and one reload so the service worker runs). Add to Home Screen makes the storage persistent.
- **Heavy apps make room.** FilmCraft, EffectCraft, PhotoCraft, LightCraft and the 3D apps are far heavier than the office
  apps. Before one starts, hidden panels that are saved are unloaded; nothing visible or unsaved is touched.
- **Fewer apps open at the start.** A workspace opens two apps side by side by itself, but on an iPad two heavy apps do not start together (a heavy app opens with a light one, two medium ones still open side by side). The other
  stays one click away in the launcher. A heavy app also gets more time to start than a light one.
- **Sound.** Safari starts audio only after a tap; WorkCraft resumes the engines' audio on your first tap or key press. While an app's sound is blocked its panel says "Sound is off. Tap the app once to turn it on."
- **Offline needs room.** Before it caches the apps, **Keep these apps offline** asks for persistent storage and checks the free space; if the apps do not fit it says how much is needed and how much is free.
- **Checked in WebKit, not on an iPad:** `npm run test:ipad` runs Playwright WebKit at iPad sizes (portrait, landscape, Split View, Slide Over): layout, the menu in Slide Over, pen and finger rules, palm rejection, the stage, the crash notice,
  the audio hint and that the frame measures reach apps beyond Office. That WebKit is the Windows build, without Web Audio and without a GPU like an iPad.
- **Tried on a real iPad:** the maintainer used the app on a physical iPad and touch and tap and hold (the panel menu) work.
- **Not verified on a real iPad yet:** Apple Pencil pressure and tilt in the brush apps, the audio unlock, the memory numbers of the
  heavy apps, the offline cache, the scanner camera and the first-start page after the alpha.4 layout fix. (The 12 new web builds do start in a desktop browser with WebGPU.) Report what you see
  (Settings, Status, engine report).
- **Add to Home Screen.** On the first visit in Safari WorkCraft offers a short guide (Share, Add to Home Screen, Add, then open it from the icon); the same guide is in the main menu. The installed app runs full screen, keeps its storage and does not show the notice again. It shows once per fortnight and goes away by itself; "Do not remind me" in the guide stops it for good.
- **Scan a document.** The + menu has **Upload files** (Apple's sheet: Choose Files, Photo Library, Take Photo, and Scan Documents under the three dots of the file picker) and **Scan a document**, WorkCraft's own scanner: camera, page found and straightened (drag the corners), Grey, Black and white or Colour, several pages, one PDF in `/Scans`. Safari cannot call the Scan Documents of iPadOS directly, which is why the scanner is built in.
- **Pencil trail and hover circle.** The trail behind the Pencil in an app is one smooth line; the hover circle is empty and takes the colour of the tool. The Focus mode button is at the top right, away from the Pencil tools.
## Touch keys and exports

FilmCraft (video) and ProCraft (painting) are worked with shortcuts. Without a keyboard, the panel of those two apps shows a bar of buttons: Play, Split, Delete, Undo and the tools in FilmCraft; Undo, Redo, Brush, Eraser, Pick color, Select, Transform, brush size, Layers, Colors and the quick menu in ProCraft. A button sends the key press a keyboard would send (Cmd on the iPad), and it does not take the focus from the app. **Shift** is a latch: tap it, then the next key counts with Shift. The arrow button moves the bar to the top or the bottom, the keyboard button folds it away.

**Settings, Apple Pencil and touch, Touch keys:** Auto shows the bar on a touch screen until you use a Magic Keyboard (keys typed on the on-screen keyboard do not count); Always keeps it; Never hides it.

When an app saves an export (a rendered video, an image), the notice **Saved: ...** has the button **Share or save to Files**: it opens the iPad share sheet (Save Video, Save to Files, AirDrop). The file is in the project either way.

Both ideas come from the community build FilmCraft for iPad (unofficial), see [SOURCES.md](../SOURCES.md). Verified in WebKit on Windows at iPad sizes, not on a real iPad.

## Files and the cloud

With a desktop paired, cloud storage (Settings, Cloud storage) is set up on the desktop and the iPad sees the same
projects. For iCloud Drive the desktop mirrors a project into `WorkCraft/<project>` in its iCloud Drive folder, and the
iPad opens that folder in the Files app.

**On the iPad alone (browser mode)** Settings, Cloud storage works too. Sign in to **Google Drive** with your own
OAuth client of type "Web application" (the page shows the redirect address to add; the sign-in stays in Safari for an hour and is
asked for again after that). A project can then stay on the iPad only, live in Google Drive as well (two-way sync, the iPad keeps its own
copy and works offline), or be opened from Google Drive on another device (**Open a project from the cloud**). Safari cannot keep a
folder of the computer in sync (that needs Chrome or Edge on a computer), and iCloud Drive has no web file API: save an **Export as ZIP**
into iCloud Drive with the Files app, or use Google Drive. One project syncs at a time, the one that is open. Verified with unit tests
and a stand-in for the folder API, not against a real Google account or a physical iPad.

## Limits

- Over plain HTTP on the home network, Safari allows neither WebGPU, service workers, OPFS nor persistent
  storage. The apps then start with WebGL2, WorkCraft runs without an offline cache and keeps browser mode files in
  IndexedDB. [HTTPS with mkcert](#https-on-the-home-network-recommended) brings all of it back.
- From a page served over HTTPS, Safari blocks plain HTTP requests to the home network (mixed content). Sync from
  browser mode works when WorkCraft is opened over `http://`, or when the desktop serves HTTPS too and the iPad trusts
  its certificate.
- In browser mode the terminal and the AI's office tools (read-sheet, write-document,
  create-slide, the PDF tools) need the desktop.
- Browser mode has no protected key store. Keys stay in memory until a reload unless you choose to keep
  them in the browser after a warning. Use keys with a spending limit.

## Troubleshooting

| Problem | Try |
| :--- | :--- |
| The iPad cannot reach the desktop | Check that **Share on Wi-Fi** is on and the backend was restarted, both devices are on the same Wi-Fi, and the desktop firewall allows port 5175. Open the pairing link again. |
| WorkCraft opens in browser mode although the desktop runs | The pairing cookie is missing or was renewed. Open the pairing link from the desktop again. |
| An app looks blurry or twice as large | Reload the panel. If it persists, open Settings, Status: the apps tile shows `blurry` with the density; report that with your iPad model, iPadOS version and the app version. |
| Safari says the certificate is not trusted | The mkcert root is not switched on: Settings, General, About, Certificate Trust Settings. Or the certificate was made for another address: run `npm run lan:cert` again. |
| An app froze or went black | Safari lost its graphics. WorkCraft reloads the app on its own after 2.5 seconds; use the panel's reload if it did not. |
| A panel says "unloaded to save memory" | The memory guard freed an app you were not using. Click the panel to load it again. Raise the budget in Settings, Memory and GPU if you have an iPad with more memory. |
| Handwriting does not turn into text | Scribble works in text fields (chat, search, code editor), not on app canvases. |
