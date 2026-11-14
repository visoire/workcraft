# Running and hosting WorkCraft yourself

WorkCraft has no account and no cloud of its own. You can run it three ways. Pick the one that matches what you need.

| | 1. Use the hosted workspace | 2. Run it on your computer | 3. Host the browser version yourself |
| :--- | :--- | :--- | :--- |
| How | open [workcraft.cc/app](https://workcraft.cc/app/) | `git clone`, `npm install`, `npm run dev` | `npm run build`, put `dist/` on a static host |
| Needs | a modern browser | Node.js 20 or newer | any HTTPS static web server |
| Where your files live | in your browser (IndexedDB and OPFS) | in a folder you own (`~/workcraft`) | in each visitor's browser |
| Terminal and code runner | no | yes | no |
| Local models (Ollama) | no | yes | no |
| Your own AI key | yes (kept in memory until you reload) | yes (kept by the local server) | yes |
| Desktop Craft apps next to the panels | no | yes | no |
| Google Drive or a synced folder | yes | yes | yes |
| iPad | yes, alone | yes, paired over your home network | yes, alone |

If you only want to try WorkCraft, use the first way. If you want everything, use the second. The third is for a team or a school that wants its own copy of the browser version.

## 2. Run it on your computer

```sh
git clone https://github.com/visoire/workcraft.git
cd workcraft
npm install
npm run dev          # http://localhost:5175/ (the backend listens on 127.0.0.1:5176)
```

For a production-style run from a build: `npm run build`, then `npm start` (`npm run start:local` keeps it to this computer; the default also shares WorkCraft on your home network behind a pairing token, see the [iPadOS guide](IPADOS-GUIDE.md)).

| Variable | Meaning | Default |
| :--- | :--- | :--- |
| `WORKCRAFT_HOME` | the data folder: projects, chats, settings, keys | `~/workcraft` |
| `WORKCRAFT_PORT` | backend port | `5176` |
| `WORKCRAFT_UI_PORT` | interface port (development) | `5175` |
| `WORKCRAFT_LAN=1` | listen for the home network (same as `--lan`) | off |
| `WORKCRAFT_HTTPS=1` | HTTPS with the certificate from `npm run lan:cert` | off |
| `WORKCRAFT_FIRST_PROJECT=sample` | start with the sample project instead of an empty one | empty project |

> **Do not put this server on the internet.** It has a real terminal, reads and writes files and starts programs. It listens on `127.0.0.1` for a reason, and the home network mode needs a pairing token. Never forward its port, never run it on a public server, never put it behind a public reverse proxy.

## 3. Host the browser version

The workspace is a static single page app. Without a backend it detects that nothing answers on `/api/health` and runs in **browser mode**: projects in the browser, no server. This is exactly what [workcraft.cc/app](https://workcraft.cc/app/) serves.

```sh
git clone https://github.com/visoire/workcraft.git
cd workcraft
npm ci
npm run build        # dist/ is the whole site
```

Upload the contents of `dist/` to any path of a static web server, for example `https://example.org/workcraft/`. All paths are relative, so the folder can have any name. What the host must do:

1. **Serve over HTTPS.** Service workers, the offline cache, OPFS and WebGPU only exist on secure origins (`localhost` counts for testing).
2. **Send `.wasm` files as `application/wasm`.** The engines are WebAssembly. Compression (gzip or brotli) is worth enabling; the largest file is about 58 MB uncompressed.
3. **Not cache `index.html`, `sw.js` and `precache.json`** for long (`Cache-Control: no-cache`), so a visitor gets a new version. Files under `assets/` have a hash in their name and can be cached for a year.
4. **Not rewrite unknown paths to `index.html`.** The workspace probes `/api/health` to find out whether a backend exists; a 404 is the right answer.

You do not need to set cross-origin isolation headers: the service worker adds them where an app needs them.

Apache (`.htaccess` next to `index.html`):

```apache
AddType application/wasm .wasm
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE application/wasm application/javascript text/css application/json image/svg+xml
</IfModule>
<FilesMatch "^(index\.html|sw\.js|precache\.json|releases\.json|web-builds\.json)$">
  Header set Cache-Control "no-cache"
</FilesMatch>
```

nginx (inside the `server` block, for a site at `/workcraft/`):

```nginx
location /workcraft/ {
    alias /var/www/workcraft/;
    types { application/wasm wasm; }
    gzip on;
    gzip_types application/wasm application/javascript text/css application/json image/svg+xml;
    location ~ ^/workcraft/(index\.html|sw\.js|precache\.json|releases\.json|web-builds\.json)$ {
        add_header Cache-Control "no-cache";
    }
}
```

**Which apps are in the build.** A fresh clone contains the four office engines (WordCraft, GridCraft, DeckCraft, PdfCraft). The other web builds are not part of the repository: most come from other people's projects under their own licences (ten are GPL-3.0), so `npm run apps:fetch` lists them and installs only with `--yes`. Read the licence of each before you serve it to others. Without a build the workspace says "No web build here yet" for that app.

**Google Drive in browser mode** uses a Google OAuth *Web* client that belongs to the person using it (WorkCraft ships none). In Google Cloud, add the sign-in landing page of your host as an authorized redirect URI: `https://<your host>/<folder>/oauth-callback.html`.

**Check it:** open the address in a private window. You should see the welcome page ("Welcome Office & Documents"), nothing started. Click WordCraft and it opens in a few seconds. `…/docs/` is the documentation page.

## Updating

Pull, `npm ci`, `npm run build`, upload `dist/` again. A visitor's browser loads the new service worker on the next visit. Projects stored in the browser stay.

Next: the [architecture](ARCHITECTURE.md), the [iPadOS guide](IPADOS-GUIDE.md), and how to [update the apps](UPDATING.md).
