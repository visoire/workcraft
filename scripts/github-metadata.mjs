#!/usr/bin/env node
// GitHub repository metadata (About text, homepage, topics) for the three WorkCraft repositories
// (workcraft, workcraft-home, workcraft-monorepo). Nothing is uploaded unless you run it with --apply.
//
//   node scripts/github-metadata.mjs            the repository of this checkout (from package.json)
//   node scripts/github-metadata.mjs --all      all three
//   node scripts/github-metadata.mjs --apply    run `gh repo edit` (needs the GitHub CLI, signed in
//                                               with `gh auth login`); without it the commands are printed
//
// Nothing here needs a token in a file: the GitHub CLI keeps its own sign-in.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const TOPICS = ['workcraft', 'workspace', 'local-first', 'privacy', 'ollama', 'ai-assistant', 'mcp', 'model-context-protocol', 'webassembly', 'webgpu', 'documents', 'spreadsheets', 'presentations', 'pdf', 'typescript', 'ipados', 'open-source'];

export const REPOS = {
  'workcraft': {
    description: 'A unified local-first workspace for documents, spreadsheets, presentations and PDFs, with a private AI assistant: local with Ollama or your own API keys. MIT OR Apache-2.0.',
    homepage: 'https://github.com/visoire/workcraft#readme',
    topics: TOPICS,
    visibility: 'public',
  },
  'workcraft-home': {
    description: 'WorkCraft website: homepage, contact, portal, admin panel, member dashboard, legal and error pages, PHP backend. Private.',
    homepage: 'https://github.com/visoire/workcraft',
    topics: TOPICS.filter((t) => t !== 'open-source').concat(['website', 'php']),
    visibility: 'private',
  },
  'workcraft-monorepo': {
    description: 'WorkCraft monorepo: the website and the open-source workspace together, with the build that splits them into workcraft-home and workcraft. Private.',
    homepage: 'https://github.com/visoire/workcraft',
    topics: TOPICS.filter((t) => t !== 'open-source').concat(['monorepo']),
    visibility: 'private',
  },
};

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const own = (() => {
  try {
    return JSON.parse(readFileSync('package.json', 'utf8')).name;
  } catch {
    return 'workcraft';
  }
})();
const names = argv.includes('--all') ? Object.keys(REPOS) : [REPOS[own] ? own : 'workcraft'];

const gh = spawnSync('gh', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
const hasGh = gh.status === 0;

for (const name of names) {
  const r = REPOS[name];
  const args = ['repo', 'edit', `visoire/${name}`, '--description', r.description, '--homepage', r.homepage, ...r.topics.flatMap((t) => ['--add-topic', t])];
  console.log(`\n${name} (${r.visibility})`);
  console.log(`  About:    ${r.description}`);
  console.log(`  Homepage: ${r.homepage}`);
  console.log(`  Topics:   ${r.topics.join(', ')}`);
  if (apply && hasGh) {
    const res = spawnSync('gh', args, { stdio: 'inherit', shell: false });
    if (res.status !== 0) process.exitCode = 1;
  } else {
    if (apply) console.log('  The GitHub CLI is not installed or not signed in (https://cli.github.com, then gh auth login). Run:');
    console.log('  gh ' + args.map((a) => (/[\s,()]/.test(a) ? JSON.stringify(a) : a)).join(' '));
  }
}
