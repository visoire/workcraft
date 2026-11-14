import { defineConfig, createLogger } from 'vite';
import { resolve, relative, dirname, sep } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dataHome } from './scripts/data-home.mjs';
import { resolveTls } from './src/server/tls.ts';
import { releaseFiles, releasePlaceholders, RELEASES, PRESENT_BUILDS } from './scripts/releases.mjs';
import { cleanUrls } from './scripts/clean-urls.mjs';
import { svgIcon, logoSvg, markSvg } from './src/app/icons.js';

// The website chrome (header, menu, footer) and the go/<app>/<to> redirects belong to the website.
// The open-source workspace repository (workcraft) has neither, so both load only when present.
// (a computed URL, so the config bundler does not try to resolve a file that is not there)
const optional = (p) => (existsSync(resolve(__dirname, p)) ? import(pathToFileURL(resolve(__dirname, p)).href) : null);
const site = await optional('scripts/partials.mjs');
const redirects = await optional('scripts/redirects.mjs');
const goUrl = site?.goUrl || ((base, app, to) => `${base}go/${app}/${to}`);

// One build for the website and the workspace:
//   index.html                      the workspace (TypeScript, backend under /api, /mcp, /ws)
//   docs/index.html                 documentation
// Pages are found on their own: every HTML file in the root folder and every index.html in a
// first-level sub folder. If a page is missing (for example in a clone without the website),
// Vite builds the others.

const ROOT = __dirname;
// Ports: interface 5175, backend 5176 (change them with WORKCRAFT_UI_PORT and WORKCRAFT_PORT)
const UI_PORT = Number(process.env.WORKCRAFT_UI_PORT) || 5175;
const API = `127.0.0.1:${Number(process.env.WORKCRAFT_PORT) || 5176}`;

// HTTPS for the home network in development (npm run dev:lan -- --https, certificate from npm run lan:cert).
// Same rules as the production server (src/server/tls.ts). A request without a usable certificate stops
// here instead of silently serving HTTP, because the backend would then print https pairing addresses.
const TLS = resolveTls({ env: process.env, argv: [], home: dataHome(), cwd: process.cwd() });
if (process.env.WORKCRAFT_HTTPS === '1' && !TLS.enabled) throw new Error(TLS.reason || 'HTTPS requested without a certificate');

const NOT_PAGES = new Set(['node_modules', 'dist', 'dist-server', 'public', 'src', 'scripts', 'tests', 'versions', 'private', 'backup', 'repos', 'test-results', '.git', '.githooks', '.github', '.vite']);

function pages() {
  const input = {};
  for (const d of readdirSync(ROOT, { withFileTypes: true })) {
    if (d.isFile() && d.name.endsWith('.html')) input[d.name === 'index.html' ? 'home' : d.name.replace(/\.html$/, '')] = resolve(ROOT, d.name);
    else if (d.isDirectory() && !NOT_PAGES.has(d.name) && !d.name.startsWith('.') && existsSync(resolve(ROOT, d.name, 'index.html'))) input[d.name] = resolve(ROOT, d.name, 'index.html');
  }
  return input;
}

// The website links to the workspace and docs/ only when this checkout contains the workspace; a
// website-only build (workcraft-home) links to GitHub instead (ideLinks in scripts/partials.mjs).
const HAS_IDE = existsSync(resolve(__dirname, 'src', 'app', 'main.ts'));

/** Path from a page back to the root: '' for index.html, '../' for contact/index.html. */
function baseFor(file) {
  const depth = relative(ROOT, dirname(file)).split(sep).filter(Boolean).length;
  return '../'.repeat(depth);
}

// Shared header and footer of the website (scripts/partials.mjs) and icons for all pages.
// Placeholders: <!--HEAD-ICONS-->, <!--HEADER-->, <!--HEADER:contact/-->, <!--MENU-->, <!--FOOTER-->,
// <!--ICON:name:size-->, <!--LOGO:size-->, <!--MARK:size-->, <!--GO:app:to--> (clean redirect link),
// <!--REL:app:field--> and <!--DOWNLOADS--> (release data from public/releases.json)
function siteChrome() {
  return {
    name: 'workcraft-site-chrome',
    transformIndexHtml(html, ctx) {
      const file = ctx.filename || resolve(ROOT, (ctx.path || '/').replace(/^\//, '') || 'index.html');
      const base = baseFor(file);
      const out = releasePlaceholders(html, goUrl, base)
        .replace(/<!--GO:(\w+):([\w-]+)-->/g, (_, app, to) => goUrl(base, app, to))
        .replace(/<!--\s*HEAD(?:[-_]?ICONS)?\s*-->/g, () => (site ? site.headIcons(base, html) : ''))
        .replace(/<!--\s*HEADER(?::([^>]*?))?\s*-->/g, (_, cur) => (site ? site.header(base, cur || '') : ''))
        .replace(/<!--\s*MENU(?::([^>]*?))?\s*-->/g, (_, cur) => (site ? site.menu(base, cur || '') : ''))
        .replace(/<!--\s*FOOTER\s*-->/g, () => (site ? site.footer(base) : ''))
        .replace(/<!--ICON:(\w+):(\d+)-->/g, (_, n, s) => svgIcon(n, Number(s)))
        .replace(/<!--LOGO:(\d+)-->/g, (_, s) => logoSvg(Number(s)))
        .replace(/<!--MARK:(\d+)-->/g, (_, s) => markSvg(Number(s)));
      return site?.ideLinks ? site.ideLinks(out, HAS_IDE) : out;
    },
  };
}

// The backend restarts whenever a file in src/ changes (scripts/dev.mjs). For those few seconds every proxied
// request and the WebSocket fail with ECONNREFUSED / ECONNRESET, and Vite prints a stack for each one. Those two
// codes are the restart itself, not a fault: say it once per burst instead. Every other proxy error still prints.
const logger = createLogger();
const errorOnce = logger.error;
let lastRestartNote = 0;
logger.error = (msg, opts) => {
  const code = opts?.error?.code;
  if (/(http|ws) proxy (socket )?error/.test(String(msg)) && (code === 'ECONNREFUSED' || code === 'ECONNRESET')) {
    if (Date.now() - lastRestartNote > 8000) {
      lastRestartNote = Date.now();
      logger.info('[workcraft] backend not reachable (restarting after a change in src/): requests resume when it is back');
    }
    return;
  }
  errorOnce(msg, opts);
};

export default defineConfig({
  customLogger: logger,
  base: './',
  plugins: [cleanUrls(ROOT), siteChrome(), releaseFiles(), ...(redirects ? [redirects.goRedirects()] : [])],
  // App versions for the workspace registry (src/workspace/registry.ts). Code may not import files from
  // public/, so the release data of public/releases.json is inlined here (restart dev after a change).
  define: {
    __OC_RELEASES__: JSON.stringify(RELEASES.map(({ app, name, version, tag, date, web, webVersion, webNote, webZipBytes }) => ({ app, name, version, tag, date, web, webVersion, webNote, webZipBytes }))),
    // Web builds of the other Craft apps that are present on this machine (public/web-builds.json, npm run apps:fetch)
    __WC_BUILDS__: JSON.stringify(PRESENT_BUILDS.map(({ app, version, dir }) => ({ app, version, dir }))),
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    // The largest chunk is the pdf.js engine (about 1.7 MB, one vendor module that only loads for PDFs);
    // everything of our own stays far below this limit
    chunkSizeWarningLimit: 1800,
    rollupOptions: { input: pages() },
  },
  server: {
    port: UI_PORT,
    strictPort: false,
    // The engine builds under versions/ (and a build being installed by npm run apps:fetch / apps:import) are served by
    // the releaseFiles plugin, never imported by the page: watching them only reloads the page, and a folder that is renamed
    // while it is watched crashed the dev server (EBUSY).
    watch: { ignored: ['**/versions/**'] },
    https: TLS.enabled ? { key: TLS.tls.key, cert: TLS.tls.cert } : undefined,
    // The same basic security headers as the Node server (the full CSP header is set in production)
    headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()' },
    // Local backend of the workspace (src/server): REST, MCP, WebSocket
    // xfwd: the backend recognises devices from the home network (x-forwarded-for) and asks them for the token.
    proxy: {
      '/api': { target: `http://${API}`, xfwd: true },
      '/mcp': { target: `http://${API}`, xfwd: true },
      '/pair': { target: `http://${API}`, xfwd: true },
      '/ws': { target: `ws://${API}`, ws: true, xfwd: true },
    },
  },
});
