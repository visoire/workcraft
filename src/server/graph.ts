// Project graph: more than a file tree. For every file it keeps the version history (content in
// the object store, so a version can be restored), which tool step wrote it (MCP tool, chat
// chain, call ID), and edges "derived from": a step that read A and B and wrote C links A -> C and
// B -> C. That makes multi-step pipelines traceable (which file came from which MCP step).
// Stored in .workcraft/graph.json of the project.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { META_DIR } from './paths.js';
import { putObject, getObject, hasObject } from './objects.js';

export const MAX_VERSIONS = 20;

export interface FileVersion {
  v: number;
  at: string;
  hash: string;
  size: number;
  /** ui, panel:<id>, tool:<callId>, snapshot, sync, trash, disk … */
  origin: string;
  tool?: string;
  callId?: string;
  chain?: string;
  /** content kept in the object store */
  stored: boolean;
}
export interface GraphNode {
  path: string;
  created: string;
  deleted?: string;
  versions: FileVersion[];
}
export interface GraphEdge {
  from: string;
  to: string;
  tool: string;
  at: string;
  callId?: string;
  chain?: string;
}
export interface GraphStep {
  callId: string;
  tool: string;
  chain?: string;
  at: string;
  ms: number;
  ok: boolean;
  inputs: string[];
  outputs: string[];
}
export interface ProjectGraph {
  version: 1;
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  steps: GraphStep[];
}

const cache = new Map<string, ProjectGraph>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const fileOf = (root: string) => join(root, META_DIR, 'graph.json');
/** Steps that run right now: callId -> tool, chain (set by the MCP server before the handler) */
const running = new Map<string, { tool: string; chain?: string }>();
/** Files read per chain (one AI answer): the inputs of later writes */
const chainReads = new Map<string, Set<string>>();

function load(root: string): ProjectGraph {
  let g = cache.get(root);
  if (g) return g;
  try {
    g = existsSync(fileOf(root)) ? (JSON.parse(readFileSync(fileOf(root), 'utf8')) as ProjectGraph) : undefined;
  } catch {
    g = undefined;
  }
  if (!g || g.version !== 1) g = { version: 1, nodes: {}, edges: [], steps: [] };
  cache.set(root, g);
  return g;
}
function save(root: string, now = false) {
  const write = () => {
    timers.delete(root);
    const g = cache.get(root);
    if (!g) return;
    try {
      mkdirSync(join(root, META_DIR), { recursive: true });
      writeFileSync(fileOf(root), JSON.stringify(g));
    } catch (e) {
      console.warn('graph.json', (e as Error).message);
    }
  };
  clearTimeout(timers.get(root));
  if (now) write();
  else timers.set(root, setTimeout(write, 400));
}

export const graph = {
  get: (root: string) => load(root),
  /** The MCP server announces a tool step before its handler runs. */
  beginStep(callId: string, tool: string, chain?: string) {
    running.set(callId, { tool, chain });
  },
  /** Reads by tools: inputs of the chain */
  recordRead(chain: string | undefined, path: string) {
    if (!chain) return;
    const s = chainReads.get(chain) || new Set<string>();
    s.add(path);
    chainReads.set(chain, s);
    if (chainReads.size > 200) chainReads.delete(chainReads.keys().next().value!);
  },
  endStep(root: string, callId: string, r: { ok: boolean; ms: number; inputs: string[]; outputs: string[] }) {
    const st = running.get(callId);
    running.delete(callId);
    if (!st) return;
    const g = load(root);
    const at = new Date().toISOString();
    const inputs = [...new Set([...r.inputs, ...(st.chain ? [...(chainReads.get(st.chain) || [])] : [])])];
    g.steps.push({ callId, tool: st.tool, chain: st.chain, at, ms: Math.round(r.ms), ok: r.ok, inputs, outputs: r.outputs });
    if (g.steps.length > 500) g.steps.splice(0, g.steps.length - 500);
    for (const to of r.outputs) for (const from of inputs) if (from !== to && !g.edges.some((e) => e.from === from && e.to === to && e.tool === st.tool)) g.edges.push({ from, to, tool: st.tool, at, callId, chain: st.chain });
    if (g.edges.length > 2000) g.edges.splice(0, g.edges.length - 2000);
    for (const p of r.inputs) graph.recordRead(st.chain, p);
    save(root);
  },
  recordWrite(root: string, path: string, data: Uint8Array, origin: string) {
    try {
      const g = load(root);
      const now = new Date().toISOString();
      const node = (g.nodes[path] ||= { path, created: now, versions: [] });
      delete node.deleted;
      const { hash, stored } = putObject(root, data);
      const last = node.versions.at(-1);
      if (last && last.hash === hash) return;
      const callId = origin.startsWith('tool:') ? origin.slice(5) : undefined;
      const st = callId ? running.get(callId) : undefined;
      node.versions.push({ v: (last?.v || 0) + 1, at: now, hash, size: data.byteLength, origin: origin.replace(/^tool:.*/, 'tool'), ...(st ? { tool: st.tool, chain: st.chain } : {}), ...(callId ? { callId } : {}), stored });
      if (node.versions.length > MAX_VERSIONS) node.versions.splice(0, node.versions.length - MAX_VERSIONS);
      save(root);
    } catch (e) {
      console.warn('Project graph:', (e as Error).message);
    }
  },
  recordDelete(root: string, path: string) {
    const g = load(root);
    const now = new Date().toISOString();
    for (const [p, n] of Object.entries(g.nodes)) if (p === path || p.startsWith(path + '/')) n.deleted = now;
    save(root);
  },
  recordRename(root: string, from: string, to: string) {
    const g = load(root);
    for (const [p, n] of Object.entries(g.nodes)) {
      if (p !== from && !p.startsWith(from + '/')) continue;
      const np = to + p.slice(from.length);
      delete g.nodes[p];
      g.nodes[np] = { ...n, path: np };
    }
    for (const e of g.edges) {
      if (e.from === from) e.from = to;
      if (e.to === from) e.to = to;
    }
    save(root);
  },
  /** Content of a version (null when it was too large to keep). */
  versionData(root: string, path: string, v: number): Uint8Array | null {
    const ver = load(root).nodes[path]?.versions.find((x) => x.v === v);
    if (!ver || !ver.stored || !hasObject(root, ver.hash)) return null;
    return getObject(root, ver.hash);
  },
  /** Hashes in use (object store GC). */
  hashes(root: string): Set<string> {
    const s = new Set<string>();
    for (const n of Object.values(load(root).nodes)) for (const v of n.versions) s.add(v.hash);
    return s;
  },
  /** Lineage of a file: steps and files it came from, recursively (at most 6 levels). */
  lineage(root: string, path: string) {
    const g = load(root);
    const seen = new Set<string>();
    const up: GraphEdge[] = [];
    const walk = (p: string, depth: number) => {
      if (depth > 6 || seen.has(p)) return;
      seen.add(p);
      for (const e of g.edges.filter((x) => x.to === p)) {
        up.push(e);
        walk(e.from, depth + 1);
      }
    };
    walk(path, 0);
    const down = g.edges.filter((e) => e.from === path);
    return { node: g.nodes[path] || null, derivedFrom: up, usedBy: down, steps: g.steps.filter((s) => s.outputs.includes(path) || s.inputs.includes(path)).slice(-30) };
  },
  flush(root?: string) {
    for (const r of root ? [root] : [...cache.keys()]) save(r, true);
  },
  forget(root: string) {
    clearTimeout(timers.get(root));
    timers.delete(root);
    cache.delete(root);
  },
};
