// Unit tests of the shared core: three-way sync plan and search ranking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, conflictName, runSync, type SyncAdapter, type SyncFile } from '../../src/core/sync.ts';
import { tokens, chunkText, buildIndex, rank, queryTerms, type Chunk } from '../../src/core/search.ts';
import { mdToHtml } from '../../src/core/md.ts';

const f = (path: string, hash: string, mtime = 1): SyncFile => ({ path, hash, mtime, size: 1 });

test('Sync plan: one-sided changes, deletions, conflicts', () => {
  const base = { '/same': 'h1', '/l': 'h1', '/r': 'h1', '/both': 'h1', '/dl': 'h1', '/dr': 'h1', '/dl-changed': 'h1' };
  const local = [f('/same', 'h1'), f('/l', 'h2'), f('/r', 'h1'), f('/both', 'h2', 5), f('/dr', 'h1'), f('/new-l', 'x'), f('/dl-changed', 'h9')];
  const remote = [f('/same', 'h1'), f('/l', 'h1'), f('/r', 'h3'), f('/both', 'h3', 2), f('/dl', 'h1'), f('/new-r', 'y')];
  const plan = Object.fromEntries(planSync(local, remote, base).map((a) => [a.path, a.op + (a.winner ? ':' + a.winner : '')]));
  assert.deepEqual(plan, { '/l': 'push', '/r': 'pull', '/both': 'conflict:local', '/dl': 'delete-remote', '/dr': 'delete-local', '/new-l': 'push', '/new-r': 'pull', '/dl-changed': 'push' });
  assert.equal(conflictName('/docs/a.md', 'iPad', new Date('2026-10-21')), '/docs/a (conflict iPad 2026-10-21).md');
});

test('Sync run: both sides end equal', async () => {
  const mem = (name: string, files: Record<string, string>): SyncAdapter & { files: Record<string, string> } => ({
    name,
    files,
    manifest: async () => Object.entries(files).map(([p, c]) => f(p, c, c.length)),
    read: async (p) => new TextEncoder().encode(files[p]!),
    write: async (p, d) => void (files[p] = new TextDecoder().decode(d)),
    remove: async (p) => void delete files[p],
  });
  const a = mem('a', { '/x': 'one', '/y': 'A' });
  const b = mem('b', { '/x': 'one', '/y': 'BB', '/z': 'new' });
  const r = await runSync(a, b, null, { hash: async (d) => new TextDecoder().decode(d) });
  assert.equal(r.conflicts, 1);
  assert.deepEqual(Object.keys(a.files).sort(), Object.keys(b.files).sort());
  const again = await runSync(a, b, r.base, { hash: async (d) => new TextDecoder().decode(d) });
  assert.equal(again.actions.length, 0, 'nothing to do after a sync');
});

test('Search: German and English, compounds, places', () => {
  assert.deepEqual(tokens('Die Umsatzprognose für Q3'), ['umsatzprognose', 'q3']);
  assert.ok(queryTerms('Umsatz').some((t) => t.term === 'revenue'));
  const chunks: Chunk[] = [
    { id: '1', source: '/documents/plan.docx', kind: 'document', loc: 'Umsatzprognose 2027', text: 'Wir erwarten 310000 Euro.' },
    { id: '2', source: '/sheets/costs.xlsx', kind: 'sheet', loc: 'Sheet1 rows 1-25', text: 'Rent | 1200\nPower | 300' },
    { id: '3', source: '/notes.md', kind: 'text', loc: 'line 1', text: 'Shopping list: milk, bread' },
  ];
  const idx = buildIndex(chunks);
  assert.equal(rank(chunks, idx, 'finde den Teil mit den Umsatzprognosen')[0]!.chunk.id, '1');
  assert.equal(rank(chunks, idx, 'revenue forecast')[0]!.chunk.id, '1');
  assert.equal(rank(chunks, idx, 'costs rent')[0]!.chunk.id, '2');
  assert.equal(rank(chunks, idx, 'unrelated zebra').length, 0);
  // embeddings: a close vector wins in semantic mode
  const v = chunks.map((c, i) => ({ ...c, vec: i === 2 ? [1, 0, 0] : [0, 1, 0] }));
  assert.equal(rank(v, buildIndex(v), 'groceries', { mode: 'semantic', qvec: [1, 0.05, 0] })[0]!.chunk.id, '3');
  assert.ok(chunkText('a'.repeat(3000)).length >= 2);
});

test('Markdown export escapes HTML', () => {
  const h = mdToHtml('# Title\n\n<script>alert(1)</script> **bold** [x](javascript:alert(1))\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.ok(!h.includes('<script>'));
  assert.ok(!h.includes('javascript:'));
  assert.match(h, /<h1 id="title">Title<\/h1>/);
  assert.match(h, /<table>/);
});
