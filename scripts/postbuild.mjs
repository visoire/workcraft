#!/usr/bin/env node
// After `vite build` and `copy-apps.mjs`: optional website steps and the offline list of the workspace.
//   scripts/error-pages.mjs   error pages 403, 404, 500 (only when the website is present)
//   scripts/precache.mjs      dist/precache.json for the service worker of the workspace
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const steps = ['scripts/error-pages.mjs', 'scripts/precache.mjs'];
for (const step of steps) {
  if (!existsSync(step)) {
    console.log(`skipped: ${step} (not present)`);
    continue;
  }
  const r = spawnSync(process.execPath, [step], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`${step} failed (code ${r.status}).`);
    process.exit(r.status || 1);
  }
}
