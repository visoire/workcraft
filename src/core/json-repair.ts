// Lightweight repair pass for model output, used before a tool call or a structured answer is given up:
// tool arguments wrapped in Markdown fences or prose, single quotes, unquoted keys, Python literals,
// comments, trailing commas, raw line breaks in strings, and JSON cut off in the middle (max_tokens).
// When the repair cannot produce valid JSON, the caller feeds a structured error back to the model for
// one self-correction turn (src/chat/agent.ts). Shared by backend and interface, no DOM.

export interface RepairResult {
  value: unknown;
  /** The text needed changes before it parsed */
  repaired: boolean;
  /** Short notes on what was changed (for the step card) */
  notes: string[];
}

function tryParse(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Takes the JSON part out of fenced or chatty output. */
function extract(text: string, notes: string[]): string {
  let s = text.replace(/^﻿/, '').trim();
  const fence = s.match(/```[\w-]*[ \t]*\r?\n?([\s\S]*?)(?:```|$)/);
  if (fence && fence[1]!.trim()) {
    s = fence[1]!.trim();
    notes.push('removed Markdown fence');
  }
  const start = s.search(/[{[]/);
  if (start > 0) {
    s = s.slice(start);
    notes.push('removed text before the JSON');
  }
  return s;
}

const WORDS: Record<string, string> = { True: 'true', False: 'false', None: 'null', undefined: 'null', NaN: 'null' };

/** Rewrites the text into strict JSON, closing what was left open. */
function normalize(src: string, notes: string[]): string {
  let out = '';
  const stack: string[] = [];
  let i = 0;
  const note = (n: string) => !notes.includes(n) && notes.push(n);
  // In an object, is the next token a key?
  let expectKey = false;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      const q = c;
      let str = '';
      i++;
      let closed = false;
      while (i < src.length) {
        const d = src[i]!;
        if (d === '\\') {
          const e = src[i + 1];
          if (e === undefined) break;
          str += q === "'" && e === "'" ? "'" : d + e;
          i += 2;
          continue;
        }
        if (d === q) {
          closed = true;
          i++;
          break;
        }
        if (d === '"' && q === "'") str += '\\"';
        else if (d === '\n') (str += '\\n', note('escaped line breaks in strings'));
        else if (d === '\r') str += '\\r';
        else if (d === '\t') str += '\\t';
        else str += d;
        i++;
      }
      if (q === "'") note('converted single quotes');
      if (!closed) note('closed an unterminated string');
      out += '"' + str + '"';
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      note('removed comments');
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      note('removed comments');
      continue;
    }
    // A new object where a key should be: the previous object was never closed (a model forgot its "}"),
    // as in [{"a":1,"list":[1],{"a":2}]. Close it first, then start the next one.
    if (c === '{' && expectKey && stack[stack.length - 1] === '}' && /,\s*$/.test(out)) {
      out = out.replace(/,\s*$/, '') + '},';
      stack.pop();
      note('closed an object that was left open');
    }
    if (c === '{' || c === '[') {
      stack.push(c === '{' ? '}' : ']');
      expectKey = c === '{';
      out += c;
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      // Trailing comma before the closing bracket
      if (/,\s*$/.test(out)) {
        out = out.replace(/,\s*$/, '');
        note('removed trailing commas');
      }
      if (stack.length && stack[stack.length - 1] === c) stack.pop();
      out += c;
      i++;
      expectKey = false;
      continue;
    }
    if (c === ',') {
      expectKey = stack[stack.length - 1] === '}';
      out += c;
      i++;
      continue;
    }
    if (c === ':') {
      expectKey = false;
      out += c;
      i++;
      continue;
    }
    const num = src.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (num) {
      out += num[0];
      i += num[0].length;
      continue;
    }
    const word = src.slice(i).match(/^[A-Za-z_$][\w$-]*/);
    if (word) {
      const w = word[0];
      const after = src.slice(i + w.length).match(/^\s*:/);
      if (expectKey && after) {
        out += JSON.stringify(w);
        note('quoted keys');
      } else if (WORDS[w]) {
        out += WORDS[w];
        note('converted literals');
      } else if (w === 'true' || w === 'false' || w === 'null') out += w;
      else {
        out += JSON.stringify(w);
        note('quoted bare words');
      }
      i += w.length;
      continue;
    }
    out += c;
    i++;
  }
  // Cut off in the middle: drop a dangling comma or key, then close the open brackets
  if (stack.length) {
    out = out.replace(/,\s*$/, '');
    if (/[{,]\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/.test(out) && stack[stack.length - 1] === '}') {
      out = /:\s*$/.test(out) ? out + 'null' : out.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*$/, '');
    } else if (/:\s*$/.test(out)) out += 'null';
    out += stack.reverse().join('');
    note('closed brackets of truncated JSON');
  }
  return out;
}

/**
 * Parses model JSON, repairing it when needed. Returns null when even the repaired text is not JSON.
 *   repairJson('```json\n{path: \'/a.md\', ok: True,}\n```') -> { value: { path: '/a.md', ok: true }, repaired: true }
 */
export function repairJson(text: string): RepairResult | null {
  const direct = tryParse(text);
  if (direct.ok) return { value: direct.value, repaired: false, notes: [] };
  const notes: string[] = [];
  const extracted = extract(text, notes);
  const second = tryParse(extracted);
  if (second.ok) return { value: second.value, repaired: true, notes };
  if (!/^[{[]/.test(extracted)) return null;
  const fixed = tryParse(normalize(extracted, notes));
  return fixed.ok ? { value: fixed.value, repaired: true, notes } : null;
}

/** Tool arguments: a JSON object, repaired when possible. */
export function repairArgs(text: string): { args: Record<string, unknown>; repaired?: string[] } | { argsError: string } {
  if (!text.trim()) return { args: {} };
  const r = repairJson(text);
  if (r && r.value && typeof r.value === 'object' && !Array.isArray(r.value)) return r.repaired ? { args: r.value as Record<string, unknown>, repaired: r.notes } : { args: r.value as Record<string, unknown> };
  return { argsError: text };
}

/** Closes a Markdown code fence the model left open (odd number of ``` fence lines). */
export function closeOpenFences(markdown: string): { text: string; closed: boolean } {
  const fences = markdown.match(/^ {0,3}(```|~~~)/gm) || [];
  if (fences.length % 2 === 0) return { text: markdown, closed: false };
  const last = fences[fences.length - 1]!.trim();
  return { text: markdown.replace(/\s*$/, '') + '\n' + last, closed: true };
}
