#!/usr/bin/env node
// Writes the theme map of public/craft-theme.js from src/ecosystems/catalog.json ("theme" of every app).
//
//   npm run themes:sync          rewrite the block between /*THEMES:begin*/ and /*THEMES:end*/
//   npm run themes:sync -- --check   exit 1 when the block is stale (tests/server/theme.test.ts does the same)
//
// The script runs inside every app page and cannot import modules, so the facts it needs are embedded. Change the catalog, run this,
// commit both. docs/THEMING.md explains the fields.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const catalog = JSON.parse(readFileSync(join(root, 'src/ecosystems/catalog.json'), 'utf8'));

/** The text between the markers: one line per app, [modes, via, look]. */
export function block(apps = catalog.apps) {
  const lines = apps.map((a) => `    ${JSON.stringify(a.id)}: ${JSON.stringify([a.theme?.modes ?? 'dark', a.theme?.via ?? 'fixed', a.theme?.look ?? ''])},`);
  return `  /*THEMES:begin*/\n  var THEMES = {\n${lines.join('\n')}\n  };\n  /*THEMES:end*/`;
}

const file = join(root, 'public/craft-theme.js');
const re = /  \/\*THEMES:begin\*\/[\s\S]*?\/\*THEMES:end\*\//;

export function current(src = readFileSync(file, 'utf8')) {
  return src.replace(/\r\n/g, '\n').match(re)?.[0] ?? null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const raw = readFileSync(file, 'utf8');
  const crlf = raw.includes('\r\n');
  const src = raw.replace(/\r\n/g, '\n');
  if (!re.test(src)) {
    console.error('public/craft-theme.js has no THEMES block.');
    process.exit(2);
  }
  const next = src.replace(re, block());
  if (process.argv.includes('--check')) {
    if (next !== src) {
      console.error('public/craft-theme.js is out of step with the catalog: run npm run themes:sync');
      process.exit(1);
    }
    console.log('Theme map is current.');
  } else {
    writeFileSync(file, crlf ? next.replace(/\n/g, '\r\n') : next);
    console.log(`Theme map written for ${catalog.apps.length} apps.`);
  }
}
