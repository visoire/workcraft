// Spoken text to chat text. Speech recognizers write "at grid craft" or "slash read sheet"; the chat wants
// @gridcraft and /read-sheet. Only names the workspace knows are converted, so "meet at five" stays as it is.
// Pure, no DOM.

export interface KnownNames {
  /** Names after @: apps, agents (grid-agent), files (finances.xlsx), folders */
  mentions: string[];
  /** Names after /: tools and chat commands (read-sheet, help, team) */
  commands: string[];
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, '');

/** Words as spoken to the shape of a name: "finances dot xlsx" gives "finances.xlsx". */
function spokenForms(words: string[]): string[] {
  const text = words.join(' ').toLowerCase().replace(/[,;:!?]+/g, '');
  const dotted = text.replace(/\s+dot\s+/g, '.').replace(/\s+punkt\s+/g, '.');
  const forms = new Set<string>([squash(dotted), squash(dotted.replace(/\s+/g, '-')), dotted.replace(/\s+/g, '-')]);
  return [...forms];
}

function lookup(index: Map<string, string>, words: string[]): string | null {
  for (const f of spokenForms(words)) {
    const hit = index.get(f) ?? index.get(squash(f));
    if (hit) return hit;
  }
  return null;
}

const strip = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '');

/**
 * Turns "at <name>" into @name and a leading "slash <name>" into /name when the name is known. Up to four spoken
 * words make one name ("at grid craft", "slash read sheet", "at finances dot xlsx"); the longest match wins.
 */
export function normalizeDictation(text: string, known: KnownNames): string {
  const source = text.replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const mentions = new Map(known.mentions.map((m) => [squash(m), m] as const));
  const commands = new Map(known.commands.map((m) => [squash(m), m] as const));
  const words = source.split(' ');
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = strip(words[i]!).toLowerCase();
    const isAt = w === 'at';
    // A command is spoken at the start of the message or of a sentence
    const isSlash = w === 'slash' && (out.length === 0 || /[.!?]$/.test(out[out.length - 1]!));
    if (isAt || isSlash) {
      const index = isSlash ? commands : mentions;
      let matched = false;
      for (let n = Math.min(4, words.length - i - 1); n >= 1; n--) {
        const parts = words.slice(i + 1, i + 1 + n).map(strip);
        if (parts.some((p) => !p)) continue;
        const hit = lookup(index, parts);
        if (!hit) continue;
        // Punctuation the recognizer put after the name stays (a comma, a full stop)
        const tail = words[i + n]!.match(/[,;:!?]+$/)?.[0] || '';
        out.push((isSlash ? '/' : '@') + hit + tail);
        i += n;
        matched = true;
        break;
      }
      if (matched) continue;
    }
    out.push(words[i]!);
  }
  return out.join(' ');
}

/**
 * Puts dictated text into the draft at the caret: one space between it and the words around it, none before
 * punctuation and none at the start of a line. Returns the new text and where the caret goes.
 */
export function insertDictation(draft: string, start: number, end: number, text: string): { value: string; caret: number } {
  const t = text.trim();
  if (!t) return { value: draft, caret: end };
  const before = draft.slice(0, start);
  const after = draft.slice(end);
  const lead = before && !/[\s(\[{"'“‘@/]$/.test(before) ? ' ' : '';
  const trail = after && !/^[\s.,;:!?)\]}"'”’]/.test(after) ? ' ' : '';
  const value = before + lead + t + trail + after;
  return { value, caret: (before + lead + t).length };
}
