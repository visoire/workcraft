// Context budget: makes a request fit into the context window of the model instead of letting the API
// fail with a context-length error. Ported from the compaction plugins of DeepSeek Harness:
//   - provider usage stays the authority; this check only runs before a request,
//   - tool results are pruned deterministically (head 4096, tail 1024 characters past 8192, with a
//     marker in the middle), so the same history always gives the same prompt prefix,
//   - cuts in the history only happen where no tool call waits for its result (tool pairing),
// plus a step of its own for WorkCraft: large @-file attachments (<entry> blocks) are chunked head and
// tail with a note that tells the model how to read the rest through the tools.
// Shared by backend (src/server/ai.ts) and interface (pre-flight in the chat footer). No DOM.

import type { BudgetReport, ChatRequest, ChatTurn } from './types.js';
import { countRequest } from './usage.js';

export const PRUNE = { thresholdChars: 8192, headChars: 4096, tailChars: 1024 } as const;
export const PRUNE_MARKER = '\n\n[... tool result middle pruned to fit the context window ...]\n\n';
/** Smallest answer budget before the input is shortened instead of max_tokens */
export const MIN_RESERVE = 4096;
/** Room for the tokens the template adds around tool schemas and images */
const MARGIN = 256;

export interface FitOptions {
  window: number;
  /** Desired max_tokens of the answer */
  reserve: number;
  count?: ((text: string) => number) | null;
}

export interface FitResult {
  req: ChatRequest;
  report: BudgetReport;
  /** Still too large after every step (system prompt and tools alone exceed the window) */
  overflow: boolean;
}

const codePoints = (s: string) => Array.from(s);

/** Head and tail of a long text with the marker in between (by code point, never inside a surrogate pair). */
export function pruneText(text: string, head: number = PRUNE.headChars, tail: number = PRUNE.tailChars, marker = PRUNE_MARKER): string {
  const cp = codePoints(text);
  if (cp.length <= head + tail + marker.length) return text;
  return cp.slice(0, head).join('') + marker + cp.slice(cp.length - tail).join('');
}

const ENTRY = /(<entry\b[^>]*>\n)([\s\S]*?)(\n<\/entry>)/g;

/** Shortens the attachment blocks of a user message so about `cut` tokens go away, biggest first. */
function shrinkEntries(content: string, cut: number, count: (s: string) => number): { content: string; notes: string[] } {
  const blocks = [...content.matchAll(ENTRY)].map((m) => ({ full: m[0], open: m[1]!, body: m[2]!, close: m[3]!, tokens: count(m[2]!) }));
  blocks.sort((a, b) => b.tokens - a.tokens);
  const notes: string[] = [];
  let left = cut;
  let out = content;
  for (const b of blocks) {
    if (left <= 0) break;
    if (b.tokens < 400) continue;
    const keepTokens = Math.max(200, b.tokens - left - 120);
    if (keepTokens >= b.tokens) continue;
    const cp = codePoints(b.body);
    const keepChars = Math.max(400, Math.floor((cp.length * keepTokens) / b.tokens));
    const head = Math.floor(keepChars * 0.8);
    const tail = keepChars - head;
    const path = b.open.match(/path="([^"]*)"/)?.[1] || b.open.match(/ref="([^"]*)"/)?.[1] || 'the attachment';
    const omitted = b.tokens - keepTokens;
    const marker = `\n\n[... about ${omitted} tokens of ${path} left out to fit the context window. Read the missing part with the tools (for example read-sheet with a range, read-document or read-file). ...]\n\n`;
    const body = cp.slice(0, head).join('') + marker + cp.slice(cp.length - tail).join('');
    out = out.replace(b.full, b.open + body + b.close);
    notes.push(`${path}: kept the first and last part, about ${omitted} tokens left out`);
    left -= omitted;
  }
  return { content: out, notes };
}

/** Index of the last turn that starts a new user request (where the current tool chain begins). */
const lastUserIndex = (turns: ChatTurn[]) => turns.map((t) => t.role).lastIndexOf('user');

/**
 * Fits a request into the window. Order of the steps:
 *   1. lower max_tokens when the input fits with at least MIN_RESERVE tokens left for the answer,
 *   2. prune tool results of earlier requests,
 *   3. chunk the attachments of the latest user message,
 *   4. leave out the oldest requests, at user turns only (no tool call is separated from its result),
 *   5. prune tool results of the current chain.
 */
export function fitRequest(input: ChatRequest, opts: FitOptions): FitResult {
  const count = opts.count || null;
  const measure = (r: ChatRequest) => countRequest(r, count).total;
  const exact = !!count;
  const before = measure(input);
  const actions: string[] = [];
  const limit = (reserve: number) => opts.window - reserve - MARGIN;
  const done = (req: ChatRequest, after: number, maxTokens?: number): FitResult => ({
    req,
    report: { window: opts.window, reserve: maxTokens ?? opts.reserve, before, after, exact, actions, ...(maxTokens !== undefined ? { maxTokens } : {}) },
    overflow: after > limit(maxTokens ?? Math.min(opts.reserve, MIN_RESERVE)),
  });
  if (before <= limit(opts.reserve)) return done(input, before);
  if (before <= limit(MIN_RESERVE)) {
    const maxTokens = Math.max(MIN_RESERVE, opts.window - before - MARGIN);
    actions.push(`answer limit lowered to ${maxTokens} tokens`);
    return done(input, before, maxTokens);
  }
  const req: ChatRequest = { ...input, turns: input.turns.map((t) => (t.role === 'tool' ? { ...t, results: t.results.map((r) => ({ ...r })) } : { ...t })) as ChatTurn[] };
  let now = before;
  const target = () => limit(MIN_RESERVE);
  const finish = () => {
    const maxTokens = Math.max(MIN_RESERVE, Math.min(opts.reserve, opts.window - now - MARGIN));
    return done(req, now, maxTokens < opts.reserve ? maxTokens : undefined);
  };
  const pruneTools = (from: number, to: number, label: string) => {
    let n = 0;
    for (let i = from; i < to && now > target(); i++) {
      const t = req.turns[i]!;
      if (t.role !== 'tool') continue;
      for (const r of t.results) {
        if (codePoints(r.content).length <= PRUNE.thresholdChars) continue;
        r.content = pruneText(r.content);
        n++;
      }
      now = measure(req);
    }
    if (n) actions.push(`${n} ${label} pruned to head and tail`);
  };

  // 2. Tool results of earlier requests
  const cur = lastUserIndex(req.turns);
  pruneTools(0, Math.max(0, cur), 'earlier tool results');
  if (now <= target()) return finish();

  // 3. Attachments of the latest user message
  const last = req.turns[cur];
  if (last && last.role === 'user') {
    const c = count || ((s: string) => Math.ceil(s.length / 4));
    for (let round = 0; round < 4 && now > target(); round++) {
      const r = shrinkEntries(last.content, now - target(), c);
      if (!r.notes.length) break;
      last.content = r.content;
      actions.push(...r.notes);
      now = measure(req);
    }
  }
  if (now <= target()) return finish();

  // 4. Oldest requests, cut only before a user turn
  let dropped = 0;
  while (now > target()) {
    const userStarts = req.turns.map((t, i) => (t.role === 'user' ? i : -1)).filter((i) => i > 0);
    // The latest user turn always stays (it becomes the first turn at the latest)
    const cut = userStarts[0];
    if (cut === undefined || cut > lastUserIndex(req.turns)) break;
    dropped += cut;
    req.turns.splice(0, cut);
    now = measure(req);
  }
  if (dropped) {
    const first = req.turns[0];
    if (first?.role === 'user') req.turns[0] = { ...first, content: `[Earlier part of this chat left out to fit the context window: ${dropped} messages.]\n\n${first.content}` };
    actions.push(`${dropped} earlier messages left out`);
    now = measure(req);
  }
  if (now <= target()) return finish();

  // 5. Tool results of the current chain
  pruneTools(lastUserIndex(req.turns), req.turns.length, 'tool results of this answer');
  return finish();
}
