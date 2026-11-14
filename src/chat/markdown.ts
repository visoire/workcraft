// Markdown to HTML (a CommonMark subset) with incremental rendering for token streaming.
// Finished blocks are rendered once and stay in the DOM. Only the last, still open
// block is rebuilt per frame. That keeps streaming smooth even for long answers.

import { esc } from '../app/util.js';

function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_\w])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => (/^(https?:|mailto:)/.test(u) ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>` : t));
  out = out.replace(/(^|\s)@([\w./-]+\.[a-z0-9]{1,6}|wordcraft|gridcraft|deckcraft|pdfcraft|terminal|code)\b/gi, '$1<span class="mention mono">@$2</span>');
  return out;
}

export function mdToHtml(md: string): string {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i]!;
    if (/^```/.test(ln)) {
      const lang = ln.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) buf.push(lines[i++]!);
      i++;
      out.push(`<pre class="mono"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const hm = ln.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const lvl = Math.min(6, hm[1]!.length + 2);
      out.push(`<h${lvl}>${inline(hm[2]!)}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)[\s*_-]*$/.test(ln)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^>\s?/.test(ln)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) buf.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(ln)) {
      const ordered = /^\s*\d+[.)]/.test(ln);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]!)) {
        const raw = lines[i++]!.replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const task = raw.match(/^\[( |x)\]\s+(.*)$/i);
        items.push(task ? `<li data-task="${task[1]!.toLowerCase() === 'x' ? 'done' : 'open'}">${inline(task[2]!)}</li>` : `<li>${inline(raw)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1]!)) {
      const row = (r: string) =>
        r
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const head = row(ln);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) body.push(row(lines[i++]!));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td class="${/^-?[\d.,]+\s*%?$/.test(c) ? 'num mono' : ''}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (!ln.trim()) {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s+|\|)/.test(lines[i]!)) buf.push(lines[i++]!);
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

/** Border between the finished and the open part: the last empty line outside a code block. */
function stableCut(text: string): number {
  let fence = false;
  let cut = 0;
  let pos = 0;
  for (const line of text.split('\n')) {
    const end = pos + line.length + 1;
    if (/^```/.test(line)) fence = !fence;
    else if (!fence && !line.trim() && end <= text.length) cut = end;
    pos = end;
  }
  return cut;
}

/** Renders streamed text into an element, at most once per frame. */
export class StreamRenderer {
  private text = '';
  private stableLen = 0;
  private stableEl: HTMLElement;
  private tailEl: HTMLElement;
  private queued = false;
  constructor(
    private host: HTMLElement,
    private onPaint?: () => void
  ) {
    this.stableEl = document.createElement('div');
    this.tailEl = document.createElement('div');
    this.stableEl.className = 'md-stable';
    this.tailEl.className = 'md-tail';
    host.replaceChildren(this.stableEl, this.tailEl);
  }
  set(text: string): void {
    this.text = text;
    this.schedule();
  }
  append(delta: string): void {
    this.text += delta;
    this.schedule();
  }
  get value(): string {
    return this.text;
  }
  private schedule() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => this.flush());
  }
  flush(): void {
    this.queued = false;
    const cut = stableCut(this.text);
    if (cut < this.stableLen) {
      this.stableEl.innerHTML = '';
      this.stableLen = 0;
    }
    if (cut > this.stableLen) {
      this.stableEl.insertAdjacentHTML('beforeend', mdToHtml(this.text.slice(this.stableLen, cut)));
      this.stableLen = cut;
    }
    this.tailEl.innerHTML = mdToHtml(this.text.slice(this.stableLen));
    this.onPaint?.();
  }
  /** Final render (at the end of the stream). */
  finish(): void {
    this.host.innerHTML = mdToHtml(this.text);
    this.onPaint?.();
  }
}
