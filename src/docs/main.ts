// WorkCraft documentation: a single page in the style of modern developer docs (navigation on the
// left, contents on the right, search with Ctrl/Cmd K, callouts, cards and steps) and an
// assistant that answers from these pages. The assistant searches the docs in the browser; when
// the WorkCraft backend runs on the same origin it asks the default model with the best
// passages, otherwise it answers with the matching sections.

import raw from './content.md?raw';
import { mdToHtml, inlineMd, escHtml } from '../core/md.js';
import { buildIndex, rank, chunkText, type Chunk } from '../core/search.js';
import { readTheme, writeTheme, resolveTheme } from '../app/theme-store.js';
import { svgIcon, wordmarkSvg } from '../app/icons.js';

interface Page {
  id: string;
  group: string;
  title: string;
  description: string;
  body: string;
}

const pages: Page[] = raw
  .split(/^<!-- page: /m)
  .filter((p) => p.trim())
  .map((block) => {
    const end = block.indexOf('-->');
    const [id, group, title, description] = block.slice(0, end).split('|').map((x) => x.trim());
    return { id: id!, group: group!, title: title!, description: description || '', body: block.slice(end + 3).trim() };
  });
const groups = [...new Set(pages.map((p) => p.group))];
const ic = (name: string, size = 16) => svgIcon(name, size);
const slug = (t: string) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------- Rendering with callouts, cards and steps

const CALLOUT: Record<string, [string, string]> = { NOTE: ['info', 'Note'], TIP: ['spark', 'Tip'], WARNING: ['alert', 'Warning'], INFO: ['info', 'Info'] };

function render(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push(mdToHtml(buf.join('\n')));
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const block = ln.match(/^:::(cards|steps)\s*$/);
    if (block) {
      flush();
      const items: string[] = [];
      while (++i < lines.length && !/^:::\s*$/.test(lines[i]!)) if (lines[i]!.trim()) items.push(lines[i]!);
      if (block[1] === 'cards') {
        out.push(
          `<div class="d-cards">${items
            .map((it) => {
              const m = it.match(/^-\s*\[([^\]]+)\]\((#[\w-]+)\)\s*(.*)$/);
              return m ? `<a class="d-card" href="${m[2]}"><strong>${escHtml(m[1])}</strong><span>${inlineMd(m[3]!)}</span>${ic('arrow', 14)}</a>` : '';
            })
            .join('')}</div>`
        );
      } else {
        out.push(`<ol class="d-steps">${items.map((it) => `<li>${inlineMd(it.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>`);
      }
      continue;
    }
    const call = ln.match(/^>\s*\[!(NOTE|TIP|WARNING|INFO)\]\s*$/);
    if (call) {
      flush();
      const body: string[] = [];
      while (i + 1 < lines.length && /^>/.test(lines[i + 1]!)) body.push(lines[++i]!.replace(/^>\s?/, ''));
      const [icon, label] = CALLOUT[call[1]!]!;
      out.push(`<div class="d-callout" data-kind="${call[1]!.toLowerCase()}"><span class="d-callout-ic">${ic(icon, 16)}</span><div><strong>${label}</strong>${mdToHtml(body.join('\n'))}</div></div>`);
      continue;
    }
    buf.push(ln);
  }
  flush();
  return out.join('\n');
}

// ---------------------------------------------------------------- Page

const root = document.getElementById('docs')!;
const el = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const header = el('header', 'd-top');
header.innerHTML = `<a class="d-brand" href="../" aria-label="WorkCraft, back to the workspace">${wordmarkSvg(18)}<span class="d-badge">Docs</span></a>
<button class="d-search-btn" type="button" data-act="search">${ic('search', 15)}<span>Search the docs</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} K</kbd></button>
<span class="d-spacer"></span>
<a class="d-link" href="../">${ic('external', 14)}<span>Open WorkCraft</span></a>
<button class="d-ask" type="button" data-act="ask">${ic('spark', 15)}<span>Ask AI</span></button>
<button class="d-icon" type="button" data-act="theme" aria-label="Light or dark"></button>
<button class="d-icon d-menu" type="button" data-act="menu" aria-label="Navigation">${ic('menu', 18)}</button>`;
const nav = el('nav', 'd-nav');
nav.setAttribute('aria-label', 'Documentation');
const main = el('main', 'd-main');
const toc = el('aside', 'd-toc');
const layout = el('div', 'd-layout');
layout.append(nav, main, toc);
root.append(header, layout);

nav.innerHTML = groups
  .map((g) => `<p class="d-group">${escHtml(g)}</p>${pages.filter((p) => p.group === g).map((p) => `<a class="d-nav-link" href="#${p.id}" data-page="${p.id}">${escHtml(p.title)}</a>`).join('')}`)
  .join('');

function show(id: string, anchor?: string) {
  const page = pages.find((p) => p.id === id) || pages[0]!;
  const i = pages.indexOf(page);
  const prev = pages[i - 1];
  const next = pages[i + 1];
  main.innerHTML = `<article class="d-article"><p class="d-eyebrow">${escHtml(page.group)}</p><h1>${escHtml(page.title)}</h1><p class="d-lead">${escHtml(page.description)}</p><div class="d-body">${render(page.body)}</div>
  <nav class="d-pager">${prev ? `<a href="#${prev.id}"><small>Previous</small><span>${escHtml(prev.title)}</span></a>` : '<span></span>'}${next ? `<a class="is-next" href="#${next.id}"><small>Next</small><span>${escHtml(next.title)}</span></a>` : ''}</nav>
  <footer class="d-foot">WorkCraft documentation · local-first, MIT licensed · <a href="../">Workspace</a> · <a href="../privacy/">Privacy policy</a></footer></article>`;
  // copy buttons on code blocks
  for (const pre of main.querySelectorAll('pre')) {
    const b = el('button', 'd-copy', ic('copy', 14));
    b.setAttribute('aria-label', 'Copy');
    b.onclick = () => void navigator.clipboard?.writeText(pre.textContent || '').then(() => ((b.innerHTML = ic('check', 14)), setTimeout(() => (b.innerHTML = ic('copy', 14)), 1200)));
    pre.append(b);
  }
  const heads = [...main.querySelectorAll<HTMLHeadingElement>('.d-body h2')];
  toc.innerHTML = heads.length ? `<p class="d-group">On this page</p>${heads.map((h) => `<a href="#${page.id}/${h.id}" data-h="${h.id}">${h.textContent}</a>`).join('')}` : '';
  for (const a of nav.querySelectorAll<HTMLAnchorElement>('.d-nav-link')) a.classList.toggle('is-active', a.dataset.page === page.id);
  document.title = `${page.title} · WorkCraft Docs`;
  root.classList.remove('nav-open');
  if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
  else window.scrollTo({ top: 0 });
  spy();
}

function route() {
  const [id, anchor] = location.hash.slice(1).split('/');
  show(id || pages[0]!.id, anchor);
}
addEventListener('hashchange', route);

// highlight the section in the contents while scrolling
function spy() {
  const heads = [...main.querySelectorAll<HTMLHeadingElement>('.d-body h2')];
  let cur = heads[0]?.id;
  for (const h of heads) if (h.getBoundingClientRect().top < 120) cur = h.id;
  for (const a of toc.querySelectorAll<HTMLAnchorElement>('a')) a.classList.toggle('is-active', a.dataset.h === cur);
}
addEventListener('scroll', () => requestAnimationFrame(spy), { passive: true });

// ---------------------------------------------------------------- Theme (the website's choice, scope 'home')

const themeBtn = header.querySelector<HTMLButtonElement>('[data-act="theme"]')!;
function applyTheme() {
  const th = resolveTheme(readTheme('home'));
  document.documentElement.dataset.theme = th;
  themeBtn.innerHTML = ic(th === 'dark' ? 'sun' : 'moon', 16);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', th === 'dark' ? '#121214' : '#FFFFFF');
}
themeBtn.onclick = () => {
  writeTheme(resolveTheme(readTheme('home')) === 'dark' ? 'light' : 'dark', 'home');
  applyTheme();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();
header.querySelector<HTMLButtonElement>('[data-act="menu"]')!.onclick = () => root.classList.toggle('nav-open');

// ---------------------------------------------------------------- Search index of the docs

const chunks: Chunk[] = pages.flatMap((p) => {
  const parts = p.body.split(/\n(?=## )/);
  return parts.flatMap((part, j) => {
    const head = part.match(/^## (.+)/)?.[1];
    const text = part.replace(/^:::\w+$|^:::$/gm, '').replace(/^> \[!\w+\]$/gm, '');
    return chunkText(text, 700).map((t, k) => ({ id: `${p.id}#${j}-${k}`, source: p.id, kind: 'document' as const, loc: head ? `${p.title} · ${head}` : p.title, text: (j === 0 && k === 0 ? `${p.title}. ${p.description}\n` : '') + t }));
  });
});
const index = buildIndex(chunks);
const anchorOf = (c: Chunk) => {
  const head = c.loc.split(' · ')[1];
  return `#${c.source}${head ? '/' + slug(head) : ''}`;
};

// ---------------------------------------------------------------- Search dialog (Ctrl/Cmd K)

const dlg = el('dialog', 'd-dialog') as HTMLDialogElement;
dlg.innerHTML = `<div class="d-dialog-box"><div class="d-dialog-head">${ic('search', 16)}<input type="search" placeholder="Search the documentation" aria-label="Search the documentation"><kbd>Esc</kbd></div><div class="d-results" role="listbox"></div></div>`;
document.body.append(dlg);
const q = dlg.querySelector('input')!;
const results = dlg.querySelector('.d-results')!;
let sel = 0;
function search() {
  const term = q.value.trim();
  const hits = term.length < 2 ? pages.slice(0, 8).map((p) => ({ href: `#${p.id}`, title: p.title, sub: p.group, snip: p.description })) : rank(chunks, index, term, { limit: 10 }).map((h) => ({ href: anchorOf(h.chunk), title: h.chunk.loc, sub: pages.find((p) => p.id === h.chunk.source)?.group || '', snip: h.snippet }));
  sel = 0;
  results.innerHTML = hits.length ? hits.map((h, i) => `<a class="d-hit${i === 0 ? ' is-sel' : ''}" href="${h.href}"><strong>${escHtml(h.title)}</strong><small>${escHtml(h.sub)}</small><span>${escHtml(h.snip)}</span></a>`).join('') : '<p class="d-empty">No results. Ask the AI instead.</p>';
}
q.oninput = search;
q.onkeydown = (e) => {
  const list = [...results.querySelectorAll<HTMLAnchorElement>('a')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sel = Math.max(0, Math.min(list.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
    list.forEach((a, i) => a.classList.toggle('is-sel', i === sel));
    list[sel]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') list[sel]?.click();
};
results.addEventListener('click', (e) => (e.target as Element).closest('a') && dlg.close());
dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
const openSearch = () => {
  q.value = '';
  search();
  dlg.showModal();
  q.focus();
};
header.querySelector<HTMLButtonElement>('[data-act="search"]')!.onclick = openSearch;
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSearch();
  }
});

// ---------------------------------------------------------------- Ask AI (assistant for the docs)

const ask = el('aside', 'd-assist');
ask.setAttribute('aria-label', 'Ask the documentation');
ask.innerHTML = `<div class="d-assist-head">${ic('spark', 16)}<strong>Ask the docs</strong><span class="d-assist-mode" data-mode="checking">checking …</span><button class="d-icon" type="button" data-act="close" aria-label="Close">${ic('close', 16)}</button></div>
<div class="d-assist-log" role="log" aria-live="polite"><div class="d-msg is-ai"><p>Ask anything about WorkCraft, for example <button type="button" class="d-chip">Do my API keys leave the computer?</button> <button type="button" class="d-chip">How do I undo what the AI changed?</button> <button type="button" class="d-chip">Wie aktiviere ich den Local-Only-Modus?</button></p></div></div>
<form class="d-assist-form"><textarea rows="2" placeholder="Your question" aria-label="Your question"></textarea><button type="submit" aria-label="Send">${ic('send', 16)}</button></form>`;
document.body.append(ask);
const log = ask.querySelector<HTMLElement>('.d-assist-log')!;
const form = ask.querySelector('form')!;
const input = ask.querySelector('textarea')!;
const modeEl = ask.querySelector<HTMLElement>('.d-assist-mode')!;
const toggleAsk = (open = !root.classList.contains('ask-open')) => {
  root.classList.toggle('ask-open', open);
  document.body.classList.toggle('ask-open', open);
  if (open) {
    void probe();
    input.focus();
  }
};
header.querySelector<HTMLButtonElement>('[data-act="ask"]')!.onclick = () => toggleAsk();
ask.querySelector<HTMLButtonElement>('[data-act="close"]')!.onclick = () => toggleAsk(false);
log.addEventListener('click', (e) => {
  const chip = (e.target as Element).closest('.d-chip');
  if (chip) {
    input.value = chip.textContent || '';
    form.requestSubmit();
  }
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

let backend: boolean | null = null;
async function probe(): Promise<boolean> {
  if (backend !== null) return backend;
  try {
    const r = await fetch('/api/ai/status', { signal: AbortSignal.timeout(2000), cache: 'no-store' });
    const j = r.ok && (r.headers.get('content-type') || '').includes('json') ? ((await r.json()) as { active?: { name: string; model: string; local: boolean } | null; localOnly?: boolean }) : null;
    backend = !!j?.active;
    modeEl.dataset.mode = backend ? (j!.active!.local ? 'local' : 'cloud') : 'offline';
    modeEl.textContent = backend ? `${j!.active!.name}${j!.active!.local ? ' · local' : ''}` : 'docs search only';
    modeEl.title = backend ? (j!.active!.local ? 'Answers come from a local model. Nothing leaves this computer.' : 'Answers come from your default cloud model. The question and the doc passages go to that provider and appear in the audit log.') : 'No WorkCraft backend with a model on this address: answers show the matching sections.';
  } catch {
    backend = false;
    modeEl.dataset.mode = 'offline';
    modeEl.textContent = 'docs search only';
  }
  return backend;
}

function addMsg(role: 'user' | 'ai', html: string): HTMLElement {
  const m = el('div', `d-msg is-${role}`, html);
  log.append(m);
  log.scrollTop = log.scrollHeight;
  return m;
}

const sourcesHtml = (hits: { chunk: Chunk }[]) => {
  const seen = new Set<string>();
  const links = hits
    .filter((h) => !seen.has(anchorOf(h.chunk)) && seen.add(anchorOf(h.chunk)))
    .slice(0, 4)
    .map((h) => `<a href="${anchorOf(h.chunk)}">${escHtml(h.chunk.loc)}</a>`);
  return links.length ? `<div class="d-sources"><small>Sources</small>${links.join('')}</div>` : '';
};

form.onsubmit = async (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  addMsg('user', escHtml(question));
  const hits = rank(chunks, index, question, { limit: 6 });
  const msg = addMsg('ai', '<p class="d-typing">Searching the docs …</p>');
  if (!(await probe()) || !hits.length) {
    msg.innerHTML = hits.length
      ? `<p>These sections answer it:</p>${hits
          .slice(0, 3)
          .map((h) => `<blockquote><strong>${escHtml(h.chunk.loc)}</strong><br>${escHtml(h.snippet)}</blockquote>`)
          .join('')}${sourcesHtml(hits)}`
      : '<p>I found nothing about that in the documentation. Try other words or browse the navigation.</p>';
    return;
  }
  const context = hits.map((h, i) => `[${i + 1}] ${h.chunk.loc} (${anchorOf(h.chunk)})\n${h.chunk.text}`).join('\n\n');
  const system = [
    'You answer questions about WorkCraft using only the documentation excerpts below. If they do not cover the question, say so in one sentence and point to the closest section.',
    'Answer in the language of the question, in two to six short sentences or a short list. Mention concrete settings paths (for example Settings, Privacy) and commands. Do not invent features.',
    '<docs>',
    context,
    '</docs>',
  ].join('\n');
  let text = '';
  try {
    const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system, turns: [{ role: 'user', content: question }], tools: [], toolChoice: 'none', meta: { files: hits.map((h) => ({ name: `docs: ${h.chunk.loc}`, kind: 'docs passage', size: h.chunk.text.length })) } }) });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf
          .slice(0, i)
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        buf = buf.slice(i + 2);
        if (!data) continue;
        const ev = JSON.parse(data) as { type: string; delta?: string; error?: { message: string } };
        if (ev.type === 'text') {
          text += ev.delta;
          msg.innerHTML = mdToHtml(text);
          log.scrollTop = log.scrollHeight;
        } else if (ev.type === 'error') throw new Error(ev.error?.message || 'error');
      }
    }
    msg.innerHTML = mdToHtml(text || 'No answer.') + sourcesHtml(hits);
  } catch (err) {
    msg.innerHTML = `<p class="d-err">${escHtml((err as Error).message)}</p><p>Closest sections:</p>${sourcesHtml(hits)}`;
  }
  log.scrollTop = log.scrollHeight;
};

route();
