// Project memory (RAG): the chat keeps context of the current project on its own.
// - Notes: decisions and facts the user pins (/remember, the pin button) or the AI saves with the
//   remember tool. Stored in .workcraft/memory.json of the project.
// - Recent steps: what the AI created or changed lately (from the project graph).
// - Relevant passages: the best chunks of the search index for the current question.
// The backend assembles this block; the chat puts it into the system prompt.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { META_DIR } from './paths.js';
import { search } from './search.js';
import { graph } from './graph.js';
import { config } from './config.js';
import { tokens } from '../core/search.js';

export interface MemoryNote {
  id: string;
  text: string;
  created: string;
  source: 'user' | 'ai' | 'chat';
  chat?: string;
}

const fileOf = (root: string) => join(root, META_DIR, 'memory.json');
const MAX_NOTES = 300;

export function notes(root: string): MemoryNote[] {
  try {
    return existsSync(fileOf(root)) ? (JSON.parse(readFileSync(fileOf(root), 'utf8')) as MemoryNote[]) : [];
  } catch {
    return [];
  }
}
function save(root: string, list: MemoryNote[]) {
  mkdirSync(join(root, META_DIR), { recursive: true });
  writeFileSync(fileOf(root), JSON.stringify(list.slice(0, MAX_NOTES), null, 2));
}

export function addNote(root: string, text: string, source: MemoryNote['source'] = 'user', chat?: string): MemoryNote {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (clean.length < 3) throw Object.assign(new Error('The note is empty'), { code: 'INVALID' });
  const list = notes(root);
  const dup = list.find((n) => n.text.toLowerCase() === clean.toLowerCase());
  if (dup) return dup;
  const n: MemoryNote = { id: randomBytes(5).toString('hex'), text: clean, created: new Date().toISOString(), source, ...(chat ? { chat } : {}) };
  save(root, [n, ...list]);
  return n;
}

export function removeNote(root: string, id: string): void {
  save(
    root,
    notes(root).filter((n) => n.id !== id)
  );
}

export function clearNotes(root: string): void {
  save(root, []);
}

/** Context block for a question: notes, recent AI steps, relevant passages. */
export async function memoryContext(root: string, query: string, opt: { chunks?: number; exclude?: string[] } = {}) {
  const cfg = config().search;
  if (!cfg.memory) return { enabled: false, block: '', notes: [], steps: [], passages: [] };
  const all = notes(root);
  // all notes when there are few, otherwise the ones that share words with the question, then the newest
  const q = new Set(tokens(query));
  const picked = all.length <= 12 ? all : [...all.filter((n) => tokens(n.text).some((t) => q.has(t))), ...all].filter((n, i, a) => a.indexOf(n) === i).slice(0, 12);
  const steps = graph
    .get(root)
    .steps.filter((s) => s.ok && s.outputs.length)
    .slice(-6)
    .reverse()
    .map((s) => ({ tool: s.tool, at: s.at, outputs: s.outputs, inputs: s.inputs }));
  const k = opt.chunks ?? cfg.ragChunks;
  let passages: { source: string; loc: string; text: string; score: number }[] = [];
  if (k > 0 && query.trim().length > 3) {
    try {
      const r = await search(root, query, { limit: k + 4 });
      passages = r.hits
        .filter((h) => h.score > 0.25 && !(opt.exclude || []).includes(h.source))
        .slice(0, k)
        .map((h) => ({ source: h.source, loc: h.loc, text: h.text.slice(0, 1200), score: Math.round(h.score * 100) / 100 }));
    } catch {
      /* the chat works without passages */
    }
  }
  const parts: string[] = [];
  if (picked.length) parts.push('Pinned notes and decisions of this project:\n' + picked.map((n) => `- ${n.text}`).join('\n'));
  if (steps.length) parts.push('Recent AI steps in this project:\n' + steps.map((s) => `- ${s.tool} wrote ${s.outputs.join(', ')}${s.inputs.length ? ` from ${s.inputs.join(', ')}` : ''} (${s.at.slice(0, 16).replace('T', ' ')})`).join('\n'));
  if (passages.length) parts.push('Passages from project files that may be relevant (search index, cite the path when you use them):\n' + passages.map((p) => `[${p.source}, ${p.loc}]\n${p.text}`).join('\n\n'));
  const block = parts.length ? `<project_memory>\n${parts.join('\n\n')}\n</project_memory>` : '';
  return { enabled: true, block, notes: picked, steps, passages };
}
