// Code editor: text area with highlighting, line numbers, auto-save and live sync.

import { h, esc, extname, debounce, clock, modKey } from '../../app/util.js';
import { toast } from '../../app/notifications.js';
import { fs } from '../../project/fs.js';
import type { PanelContext, PanelInstance } from '../registry.js';
import { toolbar, emptyState, askPath } from './common.js';
import { allowScribble } from '../pencil.js';
import { t as tr } from '../../app/i18n.js';
import { fim } from '../../chat/complete.js';
import { bus } from '../../app/bus.js';

type Rule = [string, RegExp];
const KW = 'async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield|def|elif|lambda|pass|None|True|False|null|true|false|undefined|fn|pub|impl|struct|enum|use|mod|match|package|func|type|interface';
const RULES: Record<string, Rule[]> = {
  js: [
    ['com', /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ['str', /`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y],
    ['num', /\b\d+(?:\.\d+)?\b/y],
    ['kw', new RegExp(`\\b(?:${KW})\\b`, 'y')],
    ['fn', /\b[A-Za-z_$][\w$]*(?=\s*\()/y],
  ],
  css: [
    ['com', /\/\*[\s\S]*?\*\//y],
    ['str', /"[^"\n]*"|'[^'\n]*'/y],
    ['kw', /@[\w-]+/y],
    ['fn', /[\w-]+(?=\s*:)/y],
    ['num', /#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg)?\b/y],
  ],
  html: [
    ['com', /<!--[\s\S]*?-->/y],
    ['kw', /<\/?[\w-]+|\/?>/y],
    ['fn', /\b[\w-]+(?==)/y],
    ['str', /"[^"]*"|'[^']*'/y],
  ],
  py: [
    ['com', /#[^\n]*/y],
    ['str', /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y],
    ['num', /\b\d+(?:\.\d+)?\b/y],
    ['kw', new RegExp(`\\b(?:${KW})\\b`, 'y')],
    ['fn', /\b[A-Za-z_]\w*(?=\s*\()/y],
  ],
  sh: [
    ['com', /#[^\n]*/y],
    ['str', /"(?:\\.|[^"\\])*"|'[^']*'/y],
    ['kw', /\b(?:if|then|else|fi|for|do|done|while|case|esac|function|export|echo|cd)\b/y],
  ],
  md: [
    ['kw', /^#{1,6} [^\n]*/my],
    ['str', /`[^`\n]*`/y],
    ['fn', /\*\*[^*\n]+\*\*/y],
    ['com', /^> [^\n]*/my],
  ],
};
const LANG: Record<string, string> = { js: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', jsx: 'js', json: 'js', rs: 'js', go: 'js', java: 'js', c: 'js', cpp: 'js', h: 'js', css: 'css', html: 'html', htm: 'html', xml: 'html', svg: 'html', py: 'py', sh: 'sh', yml: 'sh', yaml: 'sh', toml: 'sh', gitignore: 'sh', ini: 'sh', md: 'md', markdown: 'md' };

export function highlight(text: string, ext: string): string {
  const rules = RULES[LANG[ext] || ''];
  if (!rules || text.length > 400_000) return esc(text);
  let out = '';
  let plain = '';
  let i = 0;
  const word = /[A-Za-z_$][\w$-]*|\s+|./y;
  while (i < text.length) {
    let hit: [string, string] | null = null;
    for (const [cls, re] of rules) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length) {
        hit = [cls, m[0]];
        break;
      }
    }
    if (hit) {
      out += esc(plain) + `<span class="t-${hit[0]}">${esc(hit[1])}</span>`;
      plain = '';
      i += hit[1].length;
    } else {
      word.lastIndex = i;
      const tok = word.exec(text)![0];
      plain += tok;
      i += tok.length;
    }
  }
  return out + esc(plain);
}

export async function mount(el: HTMLElement, ctx: PanelContext): Promise<PanelInstance> {
  const root = h('div.ce');
  el.append(root);
  let path: string | null = null;
  let savedAt = '';
  let dirty = false;
  let saving: Promise<void> | null = null;

  const lang = h('span.pill.ce-lang.mono');
  const altKey = modKey === '⌘' ? '⌥' : 'Alt';
  const bar = toolbar([{ icon: 'save', label: tr('Save'), hint: `${modKey} S`, run: () => void save() }, { icon: 'filePlus', label: tr('New file'), run: () => void createNew() }, { icon: 'spark', label: tr('AI completion at the cursor'), hint: `${altKey} \\`, run: () => void suggest() }, '->', lang]);
  const gutter = h('div.ce-gutter.mono', { 'aria-hidden': 'true' });
  const pre = h('pre.ce-hl.mono', { 'aria-hidden': 'true' });
  const ta = h<'textarea'>('textarea.ce-input.mono', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', 'aria-label': 'Code' });
  // Scribble stays on: handwriting with the Apple Pencil becomes code text
  allowScribble(ta);
  ta.setAttribute('autocapitalize', 'off');
  const editor = h('div.ce-editor', gutter, h('div.ce-layers', pre, ta));
  root.append(bar, editor);

  // ---------------------------------------------------------------- AI completion (FIM)
  // The suggestion shows as ghost text in the highlight layer at the cursor. Tab accepts it (one undo
  // step), Escape or any other key dismisses it. DeepSeek fills the gap with its FIM endpoint.
  let ghost: { at: number; text: string } | null = null;
  let pendingFim: AbortController | null = null;
  function clearGhost() {
    pendingFim?.abort();
    pendingFim = null;
    if (!ghost) return;
    ghost = null;
    root.classList.remove('has-ghost');
    paint();
  }
  async function suggest() {
    if (!path) return;
    clearGhost();
    const at = ta.selectionStart;
    const before = ta.value.slice(Math.max(0, at - 12_000), at);
    const after = ta.value.slice(ta.selectionEnd, ta.selectionEnd + 6_000);
    const ac = new AbortController();
    pendingFim = ac;
    root.classList.add('is-completing');
    ctx.setBadge(tr('completing'));
    try {
      const r = await Promise.race([fim({ prompt: before, suffix: after }), new Promise<never>((_, rej) => ac.signal.addEventListener('abort', () => rej(new DOMException('Stopped', 'AbortError'))))]);
      if (ac.signal.aborted || ta.selectionStart !== at) return;
      bus.emit('ai:usage', r.usage);
      if (!r.text) return void toast(tr('No suggestion at this position'), 'info');
      ghost = { at, text: r.text };
      root.classList.add('has-ghost');
      paint();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast(tr('AI completion failed'), 'error', (e as Error).message);
    } finally {
      if (pendingFim === ac) pendingFim = null;
      root.classList.remove('is-completing');
      ctx.setBadge(null);
    }
  }
  function acceptGhost() {
    if (!ghost) return;
    const g = ghost;
    ghost = null;
    root.classList.remove('has-ghost');
    ta.focus();
    ta.setSelectionRange(g.at, g.at);
    document.execCommand('insertText', false, g.text);
  }

  let paintQueued = false;
  function paint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      const ext = extname(path || '');
      pre.innerHTML = ghost ? highlight(ta.value.slice(0, ghost.at), ext) + `<span class="t-ghost">${esc(ghost.text)}</span>` + highlight(ta.value.slice(ghost.at), ext) + '\n' : highlight(ta.value, ext) + '\n';
      const n = ta.value.split('\n').length;
      if (gutter.dataset.n !== String(n)) {
        gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
        gutter.dataset.n = String(n);
      }
      syncScroll();
      status();
    });
  }
  function status() {
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    ctx.setStatus(`${tr('Line {line}, column {col} · {n} lines', { line, col, n: ta.value.split('\n').length })}${savedAt ? ' · ' + tr('saved {time}', { time: savedAt }) : ''}${dirty ? ' · ' + tr('changed') : ''}`);
  }
  function syncScroll() {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }
  ta.addEventListener('scroll', syncScroll, { passive: true });
  ta.addEventListener('input', () => {
    if (ghost || pendingFim) clearGhost();
    dirty = true;
    ctx.setDirty(true);
    paint();
    queueSave();
  });
  ta.addEventListener('keyup', status);
  ta.addEventListener('click', () => (clearGhost(), status()));
  ta.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === '\\' || e.code === 'Backslash')) {
      e.preventDefault();
      return void suggest();
    }
    if (ghost) {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        return acceptGhost();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        return clearGhost();
      }
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) clearGhost();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    } else if (e.key === 'Enter' && !e.isComposing) {
      const before = ta.value.slice(0, ta.selectionStart);
      const indent = (before.split('\n').pop() || '').match(/^\s*/)![0];
      const extra = /[{[(:]\s*$/.test(before) ? '  ' : '';
      e.preventDefault();
      document.execCommand('insertText', false, '\n' + indent + extra);
    }
  });

  async function save() {
    if (!path || !dirty) return;
    const p = path;
    const text = ta.value;
    saving = (async () => {
      try {
        await fs.write(p, text, ctx.origin);
        if (ta.value === text) {
          dirty = false;
          ctx.setDirty(false);
        }
        savedAt = clock();
        status();
      } catch (e) {
        toast(tr('Saving failed'), 'error', (e as Error).message);
      }
    })();
    await saving;
    saving = null;
  }
  const queueSave = debounce(() => void save(), 900);

  async function load(p: string | null) {
    if (path && dirty) {
      queueSave.cancel();
      await save();
    }
    path = p;
    ctx.setPath(p);
    root.querySelector('.tool-empty')?.remove();
    editor.hidden = bar.hidden = !p;
    if (!p) {
      root.append(emptyState(ctx, { newLabel: tr('New file'), create: () => void createNew() }));
      ctx.setStatus(tr('No file'));
      return;
    }
    ta.value = fs.exists(p) ? await fs.readText(p) : '';
    dirty = false;
    ctx.setDirty(false);
    lang.textContent = (extname(p) || 'text').toUpperCase();
    paint();
  }
  async function createNew() {
    const p = await askPath('/code/new.js', tr('New file'));
    if (!p) return;
    if (!fs.exists(p)) await fs.write(p, '', ctx.origin);
    await load(p);
  }

  await load(ctx.path);
  if (ctx.restore?.scroll) requestAnimationFrame(() => ((ta.scrollTop = ctx.restore!.scroll!.top), (ta.scrollLeft = ctx.restore!.scroll!.left), syncScroll()));

  return {
    open: (p) => load(p),
    canUnload: () => !dirty,
    async externalChange(p, kind) {
      if (p !== path || kind === 'delete') return;
      if (saving) await saving;
      if (dirty) return;
      const text = await fs.readText(p);
      if (text === ta.value) return;
      const pos = ta.selectionStart;
      const top = ta.scrollTop;
      ta.value = text;
      ta.setSelectionRange(Math.min(pos, text.length), Math.min(pos, text.length));
      ta.scrollTop = top;
      ctx.setBadge(tr('new'));
      setTimeout(() => ctx.setBadge(null), 2000);
      paint();
    },
    status: () => ({ file: path, lines: ta.value.split('\n').length, changed: dirty }),
    getScroll: () => ({ top: ta.scrollTop, left: ta.scrollLeft }),
    setScroll(s) {
      ta.scrollTop = s.top;
      ta.scrollLeft = s.left;
      syncScroll();
    },
    async beforeClose() {
      queueSave.cancel();
      await save();
      return true;
    },
    async unmount() {
      clearGhost();
      queueSave.cancel();
      await save();
      root.remove();
    },
  };
}
