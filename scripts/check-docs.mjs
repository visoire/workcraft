#!/usr/bin/env node
// Checks the Markdown of the repository: every relative link points at a file or folder that exists, and every
// #anchor points at a heading of the target file (GitHub's heading ids). External links are not fetched.
//   npm run check:docs
// Skipped: node_modules, dist, versions/ (third-party engine builds), test-results, .git, docs/releases (frozen notes).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', 'dist', 'dist-server', 'versions', 'test-results', '.git', 'private', 'backup']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP.has(e.name) || (e.name === 'releases' && dir.endsWith('docs'))) continue;
      walk(join(dir, e.name), out);
    } else if (e.name.endsWith('.md')) out.push(join(dir, e.name));
  }
  return out;
}

/** GitHub's heading id: lowercase, drop everything but letters, digits, space, hyphen and underscore, spaces to hyphens. */
const slug = (h) =>
  h
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, (c) => (c === '_' ? '_' : ''))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

const cache = new Map();
function anchorsOf(file) {
  if (cache.has(file)) return cache.get(file);
  const ids = new Set();
  const seen = new Map();
  let fence = false;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (m) {
      let id = slug(m[1]);
      const n = seen.get(id) || 0;
      seen.set(id, n + 1);
      ids.add(n ? `${id}-${n}` : id);
    }
    for (const a of line.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) ids.add(a[1]);
    // the in-app documentation (src/docs/content.md) links to its pages by id: <!-- page: id | group | title | blurb -->
    const pg = line.match(/^<!--\s*page:\s*([\w-]+)\s*\|/);
    if (pg) ids.add(pg[1]);
  }
  cache.set(file, ids);
  return ids;
}

const problems = [];
let links = 0;
for (const file of walk(ROOT)) {
  let fence = false;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const text = line.replace(/`[^`]*`/g, '');
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const raw = m[1];
      if (/^(https?:|mailto:|tel:|data:)/i.test(raw) || raw.startsWith('<')) continue;
      links++;
      const [pathPart, hash] = raw.split('#');
      const target = pathPart ? resolve(dirname(file), decodeURIComponent(pathPart.split('?')[0])) : file;
      const here = `${relative(ROOT, file).split(sep).join('/')}:${i + 1}`;
      if (target !== ROOT && !target.startsWith(ROOT + sep)) {
        problems.push(`${here}  ${raw}  leaves the repository`);
        continue;
      }
      if (!existsSync(target)) {
        problems.push(`${here}  ${raw}  no such file`);
        continue;
      }
      if (hash && statSync(target).isFile() && target.endsWith('.md') && !anchorsOf(target).has(decodeURIComponent(hash).toLowerCase())) {
        problems.push(`${here}  ${raw}  no such heading`);
      }
    }
  });
}

console.log(`check:docs  ${links} relative links in ${walk(ROOT).length} Markdown files`);
if (problems.length) {
  console.error(problems.map((p) => '  FAIL  ' + p).join('\n'));
  process.exit(1);
}
console.log('  ok  every relative link and anchor resolves');
