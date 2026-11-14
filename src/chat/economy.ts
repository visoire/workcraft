// Token economy of the assistant: send the model what it needs for this question, not everything there is.
//
// Where the tokens go in a tool loop (see docs/AI-TOKENS.md): the tool definitions go out with every request
// (WorkCraft's own 24 tools are about 3k tokens, but every connected Craft app adds 10 to 30 tools, 100 tools are 14k);
// old tool results and attached files are sent again with every later request; images are re-sent as base64.
// Everything here is pure, so it is tested without a browser:
//
//   routeTools()     which tools this question needs (always the workspace tools, an app's tools when the question
//                    names the app or its keywords, tools used before), the rest stay one `find-tools` call away
//   findTools()      the model's way to load more tools by keyword
//   compactSchema()  shorter descriptions in the schemas of tools from other MCP servers
//   compactTurns()   older tool results, attached text, open-panel blocks and images shrink after the question they served
//
// Everything is deterministic and only ever grows within one chat (a tool that was sent stays), so the prompt prefix stays
// stable and the cache of the providers (DeepSeek, OpenAI, Gemini automatically, Claude with cache_control) keeps hitting.

import type { ChatTurn, ToolSpec } from './types.js';
import { groupKey, nativeAppsOf } from '../ecosystems/catalog.js';

export const FIND_TOOLS = 'find-tools';

/** Estimated tokens of a text: about 3.6 characters per token for English and JSON, the same rule as src/chat/tokens.ts. */
export const tokensOf = (chars: number) => Math.round(chars / 3.6);

export interface RouteTool {
  name: string;
  /** server and client: the workspace's own tools; external: MCP servers, Craft apps */
  source: 'server' | 'client' | 'external';
  description: string;
  title?: string;
}

export interface RouteInput {
  tools: RouteTool[];
  /** The question (and the text of what is attached) */
  text: string;
  /** Files the question refers to (mentions, attachments) */
  paths: string[];
  /** Tools the model called earlier in this chat */
  used: string[];
  /** Tools sent earlier in this chat plus the ones loaded with find-tools: they stay */
  sent: string[];
  /** A / command picked a tool */
  forced?: string;
}

export interface RouteResult {
  send: string[];
  hidden: RouteTool[];
}

/** A file type names the Craft apps that work on it: the `opens` lists of src/ecosystems/catalog.json, so an app added to the
 *  catalog is routed without a change here. The group is the tool-name form of the id (craft-anything is craftanything). */
const groupsOfExt = (ext: string): string[] => nativeAppsOf(ext).map((a) => groupKey(a.id));

/** Words that say little about which tool is meant. */
const GENERIC = new Set(['open', 'list', 'get', 'set', 'file', 'files', 'info', 'tool', 'tools', 'create', 'export', 'import', 'read', 'write', 'save', 'new', 'all', 'project', 'document', 'status', 'help']);

/** Words of a question that never name a tool. */
const STOP = new Set(['the', 'this', 'that', 'with', 'from', 'like', 'into', 'your', 'what', 'for', 'and', 'you', 'can', 'please', 'have', 'would', 'could', 'about', 'there', 'then', 'them'])

const CLOUD = /\b(cloud|drive|icloud|onedrive|dropbox|sync(?:hronize|hronise)?)\b/i;

/** `ext-photocraft-crop` belongs to the group `photocraft`. */
export const groupOf = (name: string): string | null => /^ext-([a-z0-9]+)-/.exec(name)?.[1] ?? null;

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) || []);

/** The word is the name part or a form of it: crop and cropping, rotate and rotated. */
function hits(tok: string, ws: Set<string>): boolean {
  if (ws.has(tok)) return true;
  for (const w of ws) if ((w.length > tok.length && w.startsWith(tok)) || (w.length >= 5 && tok.length > w.length && tok.startsWith(w))) return true;
  return false;
}

/** Does the question mention something in the tool's own name (crop, histogram, trim)? */
function keywordHit(t: RouteTool, ws: Set<string>): boolean {
  const toks = t.name.replace(/^ext-[a-z0-9]+-/, '').split(/[-_]/).filter((x) => x.length >= 4 && !GENERIC.has(x));
  return toks.some((x) => hits(x, ws));
}

export function routeTools(i: RouteInput): RouteResult {
  const ws = words(i.text);
  const keep = new Set([...i.used, ...i.sent, ...(i.forced ? [i.forced] : [])]);
  const named = new Set<string>();
  // "craft anything", "Craft-Anything" and "craftanything" all name the group craftanything
  const flat = i.text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const t of i.tools) {
    const g = groupOf(t.name);
    if (g && (ws.has(g) || i.text.toLowerCase().includes(g) || (g.length >= 8 && flat.includes(g)))) named.add(g);
  }
  for (const p of i.paths) for (const g of groupsOfExt(p.split('.').pop() || '')) named.add(g);
  const send: string[] = [];
  const hidden: RouteTool[] = [];
  for (const t of i.tools) {
    let show: boolean;
    if (keep.has(t.name)) show = true;
    else if (t.source !== 'external') show = !/^cloud-/.test(t.name) || CLOUD.test(i.text);
    else {
      const g = groupOf(t.name);
      show = (!!g && named.has(g)) || keywordHit(t, ws);
    }
    if (show) send.push(t.name);
    else hidden.push(t);
  }
  // Providers cap the tools of one request (OpenAI 128, others less); with 19 Craft apps connected a broad question can name
  // many groups. The workspace's own tools, tools used before and the forced one always stay; the rest fill up in name order
  // and what does not fit moves to the hidden list, one find-tools call away.
  if (send.length > MAX_TOOLS) {
    const byName = new Map(i.tools.map((t) => [t.name, t]));
    const must = send.filter((n) => keep.has(n) || byName.get(n)?.source !== 'external');
    const rest = send.filter((n) => !must.includes(n)).sort();
    const room = Math.max(0, MAX_TOOLS - must.length);
    for (const n of rest.slice(room)) hidden.push(byName.get(n)!);
    return { send: [...must, ...rest.slice(0, room)].sort(), hidden };
  }
  return { send: send.sort(), hidden };
}

/** Most tools sent in one request. Below the lowest hard limit of the providers (OpenAI: 128) with room for find-tools. */
export const MAX_TOOLS = 120;

/** The tools that match a keyword query, best first. Used by find-tools. */
export function findTools(query: string, tools: RouteTool[], limit = 12): RouteTool[] {
  const q = [...words(query)].filter((w) => !GENERIC.has(w) && !STOP.has(w));
  const raw = words(query);
  const terms = q.length ? q : [...raw];
  if (!terms.length) return [];
  const scored = tools
    .map((t) => {
      const name = t.name.toLowerCase();
      const body = `${t.title || ''} ${t.description}`.toLowerCase();
      let score = 0;
      for (const w of terms) {
        if (name.includes(w)) score += 3;
        if (groupOf(t.name) === w) score += 4;
        if (body.includes(w)) score += 1;
      }
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.t.name < b.t.name ? -1 : 1));
  return scored.slice(0, limit).map((x) => x.t);
}

/** The definition of find-tools, listing which groups are withheld. Only offered when something is. */
export function findToolsSpec(hidden: RouteTool[]): ToolSpec {
  const groups = [...new Set(hidden.map((t) => groupOf(t.name) || (t.name.startsWith('cloud-') ? 'cloud' : 'other')))].sort();
  return {
    name: FIND_TOOLS,
    description: `[Find tools] ${hidden.length} more tools exist (${groups.join(', ')}) but are not listed, to save tokens. Call find-tools with a short query such as "crop image" or "cloud" to load the matching tools; call them in your next step.`,
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What you want to do, or the app name.' } }, required: ['query'], additionalProperties: false },
  };
}

/** What find-tools answers: the loaded tools with one line each. */
export function foundText(query: string, found: RouteTool[]): string {
  if (!found.length) return `No tool matches "${query.slice(0, 80)}". Try another word or an app name.`;
  return [`Loaded ${found.length} tool(s). Call them now:`, ...found.map((t) => `- ${t.name}: ${(t.title ? t.title + '. ' : '') + firstSentence(t.description)}`)].join('\n');
}

const firstSentence = (s: string) => (/^(.{20,160}?[.!?])(\s|$)/.exec(s.trim())?.[1] ?? s.trim().slice(0, 160));

// ---------------------------------------------------------------- Schemas of foreign tools

function cut(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

/** A schema without what the model does not need: titles, examples, $schema, and long descriptions cut short. */
export function compactSchema(schema: unknown, maxDesc = 140): unknown {
  if (Array.isArray(schema)) return schema.map((x) => compactSchema(x, maxDesc));
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === '$schema' || k === 'title' || k === 'examples' || k === 'example') continue;
    if (k === 'description' && typeof v === 'string') out[k] = cut(v, maxDesc);
    else out[k] = compactSchema(v, maxDesc);
  }
  return out;
}

export function compactSpec(spec: ToolSpec, maxTool = 300, maxProp = 140): ToolSpec {
  return { name: spec.name, description: cut(spec.description, maxTool), parameters: compactSchema(spec.parameters, maxProp) as Record<string, unknown> };
}

// ---------------------------------------------------------------- Older turns

export interface CompactOptions {
  /** Tool results longer than this shrink */
  resultChars?: number;
  /** Attached text (an entry of the <context> block) longer than this shrinks */
  entryChars?: number;
  /** How many of the latest questions (with their answers and tool results) stay whole. Default 1. */
  keepRecent?: number;
}

export interface CompactStats {
  /** Characters taken out of the history */
  chars: number;
  /** Images and documents no longer sent */
  media: number;
}

/**
 * Shrinks what an earlier question left in the history. Call it when a new question starts, never in the middle of a
 * tool loop: the results of the current question stay whole. It changes the turns in place; the old tool results, the
 * attached text and the images were served to the model when they were new, and the model keeps its own notes about them in its answer.
 * An omission always says so and says how to get the content back (call the tool again, mention the file again).
 */
export function compactTurns(turns: ChatTurn[], opt: CompactOptions = {}): CompactStats {
  const { resultChars = 1500, entryChars = 900, keepRecent = 1 } = opt;
  const stats: CompactStats = { chars: 0, media: 0 };
  // The most recent questions stay whole: "and the second row?" needs what the last answer read
  let end = turns.length;
  for (let seen = 0, i = turns.length - 1; i >= 0 && seen < keepRecent; i--) {
    if (turns[i]!.role === 'user') (seen++, (end = i));
  }
  for (const t of turns.slice(0, end)) {
    if (t.role === 'tool') {
      for (const r of t.results) {
        if (r.content.length <= resultChars) continue;
        const head = r.content.slice(0, Math.round(resultChars * 0.65));
        const tail = r.content.slice(-Math.round(resultChars * 0.2));
        const left = r.content.length - head.length - tail.length;
        const next = `${head}\n[… ${left} characters of this earlier result left out; call ${r.name} again if you need them …]\n${tail}`;
        stats.chars += r.content.length - next.length;
        r.content = next;
      }
    } else if (t.role === 'user') {
      let content = t.content;
      // The state of that moment (open panels, memory): outdated now, and the next question brings a fresh one
      content = content.replace(/\n*<session>[\s\S]*?<\/session>/g, '');
      content = content.replace(/(<entry [^>]*>\n)([\s\S]*?)(\n<\/entry>)/g, (m, open: string, body: string, close: string) => (body.length <= entryChars ? m : `${open}${body.slice(0, Math.round(entryChars * 0.7))}\n[… ${body.length - Math.round(entryChars * 0.7)} characters of the attachment left out; mention the file again to read it …]${close}`));
      const notes: string[] = [];
      if (t.images?.length) {
        notes.push(`(${t.images.length} image${t.images.length > 1 ? 's were' : ' was'} attached to this message; not sent again.)`);
        stats.media += t.images.length;
        t.images = undefined;
      }
      if (t.docs?.length) {
        notes.push(`(Attached documents of this message: ${t.docs.map((d) => d.path).join(', ')}; not sent again, mention them to read them.)`);
        stats.media += t.docs.length;
        t.docs = undefined;
      }
      if (notes.length) content += `\n\n${notes.join(' ')}`;
      if (content !== t.content) {
        stats.chars += Math.max(0, t.content.length - content.length);
        t.content = content;
      }
    }
  }
  return stats;
}
