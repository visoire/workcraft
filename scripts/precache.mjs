// After `vite build`: writes dist/precache.json with every file of the workspace.
// The service worker (public/sw.js) stores them on install for offline use.
// The apps under dist/apps/ are cached by the service worker on first open or on request.
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { RELEASES } from './releases.mjs';

const OUT = 'dist';
const SKIP = [/^apps\//, /^downloads\//, /^_local\//, /^precache\.json$/, /^sw\.js$/, /\.map$/, /^index\.html$/];

if (!existsSync(OUT)) {
  console.error('dist/ is missing. Run vite build first.');
  process.exit(1);
}

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const rel = relative(OUT, p).split(sep).join('/');
      if (!SKIP.some((re) => re.test(rel))) files.push('./' + rel);
    }
  }
};
walk(OUT);
files.sort();
// The app versions this build ships (the service worker's app cache name changes with them, see sw.js)
const apps = Object.fromEntries(RELEASES.map((r) => [r.app, r.webVersion || r.version]));
writeFileSync(join(OUT, 'precache.json'), JSON.stringify({ generated: new Date().toISOString(), apps, files }, null, 2));
console.log(`precache.json: ${files.length} files, apps ${Object.entries(apps).map(([a, v]) => `${a} ${v}`).join(', ')}`);
