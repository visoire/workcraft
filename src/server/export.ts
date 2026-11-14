// More export formats besides the ZIP of the project folder:
//   html      static HTML gallery (index page with cards, one page per file, originals in files/)
//   pdf       PDF portfolio (cover, contents, every document as text pages, PDFs and images merged)
//   markdown  Markdown documentation folder (README.md index, one .md per file, originals in assets/)
// Everything is built locally from the project files. Chats are included on request.

import { zipSync, type Zippable } from 'fflate';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { extname } from 'node:path';
import { getProject, listTree, readProjectFile, listMetaDir, readMetaFile, type ProjectMeta } from './projects.js';
import { readSheet, sheetToMarkdown } from './office/sheets.js';
import { readDocument } from './office/docs.js';
import { readPptxText } from './office/slides.js';
import { readPdf } from './office/pdf.js';
import { mdToHtml, escHtml } from '../core/md.js';

export type ExportFormat = 'zip' | 'html' | 'pdf' | 'markdown';
const ext = (p: string) => extname(p).slice(1).toLowerCase();
const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const CODE = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'json', 'xml', 'yml', 'yaml', 'toml', 'py', 'sh', 'sql', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'ini', 'log']);
const MAX = 40 * 1024 * 1024;
const ACCENT: Record<string, string> = { document: '#3B82F6', sheet: '#10B981', presentation: '#F97316', pdf: '#14B8A6', image: '#A855F7', code: '#335CFF', chat: '#64748B', other: '#94A3B8' };

const kindOf = (p: string) => {
  const e = ext(p);
  if (['docx', 'odt', 'md', 'markdown', 'txt', 'rtf'].includes(e)) return 'document';
  if (['xlsx', 'csv', 'tsv'].includes(e)) return 'sheet';
  if (e === 'pptx') return 'presentation';
  if (e === 'pdf') return 'pdf';
  if (IMG.has(e)) return 'image';
  if (CODE.has(e)) return 'code';
  return 'other';
};
const slugify = (s: string) => s.replace(/^\//, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g, '-') || 'file';
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

interface Item {
  path: string;
  kind: string;
  size: number;
  mtime: number;
  data: Uint8Array;
  md: string;
}
interface ChatItem {
  id: string;
  title: string;
  updated: string;
  md: string;
}

/** Markdown view of one file. */
export async function fileToMarkdown(path: string, data: Uint8Array, assetLink?: string): Promise<string> {
  const e = ext(path);
  const name = path.split('/').pop()!;
  try {
    if (['docx', 'odt', 'md', 'markdown', 'txt'].includes(e)) return await readDocument(data, e);
    if (['xlsx', 'csv', 'tsv'].includes(e)) {
      const first = await readSheet(data, e, {});
      const parts: string[] = [];
      for (const s of first.sheets.length ? first.sheets : [first.sheet]) parts.push(sheetToMarkdown(s === first.sheet ? first : await readSheet(data, e, { sheet: s }), 200));
      return parts.join('\n\n');
    }
    if (e === 'pptx') return readPptxText(data).map((s) => `## Slide ${s.slide}: ${s.texts[0] || ''}\n\n${s.texts.slice(1).map((t) => `- ${t}`).join('\n')}`).join('\n\n');
    if (e === 'pdf') return (await readPdf(data)).text.map((p) => `## Page ${p.page}\n\n${p.text}`).join('\n\n');
    if (IMG.has(e)) return assetLink ? `![${name}](${assetLink})` : `Image ${name}`;
    if (CODE.has(e)) return '```' + e + '\n' + new TextDecoder().decode(data).slice(0, 200_000) + '\n```';
  } catch (err) {
    return `The content of ${name} could not be read: ${(err as Error).message}`;
  }
  return assetLink ? `[${name}](${assetLink}) (${fmtBytes(data.byteLength)})` : `${name} (${fmtBytes(data.byteLength)})`;
}

async function collect(id: string, withChats: boolean): Promise<{ meta: ProjectMeta; items: Item[]; chats: ChatItem[] }> {
  const { meta, root } = getProject(id);
  const items: Item[] = [];
  for (const e of await listTree(root)) {
    if (e.kind !== 'file' || e.size > MAX) continue;
    const data = await readProjectFile(root, e.path);
    items.push({ path: e.path, kind: kindOf(e.path), size: e.size, mtime: e.mtime, data, md: '' });
  }
  const chats: ChatItem[] = [];
  if (withChats) {
    for (const f of await listMetaDir(root, 'chats')) {
      try {
        const j = JSON.parse((await readMetaFile(root, `chats/${f}`)) || '') as { id: string; title?: string; updated?: string; messages?: { role: string; text: string; created?: string }[] };
        const md = (j.messages || []).map((m) => `### ${m.role === 'user' ? 'You' : 'AI'}${m.created ? ` · ${m.created.slice(0, 16).replace('T', ' ')}` : ''}\n\n${m.text}`).join('\n\n');
        if (md) chats.push({ id: j.id, title: j.title || 'Chat', updated: j.updated || '', md });
      } catch {
        /* broken chat */
      }
    }
  }
  return { meta, items, chats };
}

// ---------------------------------------------------------------- HTML gallery

export type ExportTheme = 'light' | 'dark';
export const exportTheme = (v: unknown): ExportTheme => (v === 'dark' ? 'dark' : 'light');

const TOKENS: Record<ExportTheme, string> = {
  light: '--bg:#ffffff;--fg:#111114;--mut:#5f6068;--line:#e4e4e8;--card:#f6f6f7;--code:#f0f0f2;--hover:#ececef',
  dark: '--bg:#0b0b0b;--fg:#ededed;--mut:#9a9a9a;--line:#2a2a2a;--card:#151515;--code:#1c1c1c;--hover:#1f1f1f',
};
const css = (theme: ExportTheme) =>
  `:root{${TOKENS[theme]};color-scheme:${theme}}*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Inter,sans-serif;background:var(--bg);color:var(--fg);-webkit-font-smoothing:antialiased}` +
  `.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:12px max(20px,calc(50% - 540px));background:var(--bg);border-bottom:1px solid var(--line)}.bar b{font-weight:600;letter-spacing:-.01em}.bar a{color:var(--mut);text-decoration:none;font-size:14px}.bar a:hover{color:var(--fg)}.bar .sp{flex:1}` +
  `main{max-width:1080px;margin:0 auto;padding:36px 20px 88px}a{color:var(--fg);text-underline-offset:3px;text-decoration-color:var(--line)}a:hover{text-decoration-color:var(--fg)}a:focus-visible,.card:focus-visible{outline:2px solid var(--fg);outline-offset:3px;border-radius:6px}` +
  `h1{font-size:clamp(26px,4vw,38px);line-height:1.15;letter-spacing:-.02em;margin:0 0 6px}h2,h3,h4{letter-spacing:-.01em;line-height:1.25}.mut{color:var(--mut)}p.mut{margin:0 0 4px}` +
  `.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-top:28px}.card{display:flex;flex-direction:column;gap:2px;min-height:112px;border:1px solid var(--line);border-top:3px solid var(--c);border-radius:14px;background:var(--card);padding:16px;text-decoration:none;color:inherit;transition:background-color .15s,transform .2s}.card:hover{background:var(--hover);transform:translateY(-2px)}.card b{display:block;word-break:break-word;font-weight:600}.card img{width:100%;height:140px;object-fit:cover;border-radius:8px;margin-bottom:8px}` +
  `.tag{display:inline-block;font:500 12px/1.6 ui-monospace,"DM Mono",monospace;padding:0 9px;border-radius:99px;border:1px solid var(--line);color:var(--mut);margin-top:auto}` +
  `article{border:1px solid var(--line);border-radius:14px;padding:clamp(18px,4vw,36px);background:var(--card);overflow:auto;margin-top:20px}article>:first-child{margin-top:0}article p,article li{max-width:76ch}blockquote{margin:1em 0;padding:.1em 1em;border-left:3px solid var(--line);color:var(--mut)}hr{border:0;border-top:1px solid var(--line);margin:1.6em 0}` +
  `pre{background:var(--code);padding:14px;border-radius:10px;overflow:auto;border:1px solid var(--line)}code{font-family:ui-monospace,"DM Mono",Consolas,monospace;font-size:13px}:not(pre)>code{background:var(--code);padding:1px 6px;border-radius:5px}` +
  `.table{overflow:auto}table{border-collapse:collapse;font-size:13.5px;width:max-content;min-width:100%}td,th{border:1px solid var(--line);padding:6px 10px;text-align:left}th{background:var(--code);font-weight:600}tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--code) 55%,transparent)}img{max-width:100%;height:auto}nav{margin-bottom:18px}` +
  `footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:var(--mut);font-size:13px}@media(max-width:560px){main{padding:24px 16px 64px}.grid{grid-template-columns:1fr}}@media print{.bar{position:static}body{background:#fff;color:#000}.card,article{break-inside:avoid}}`;

const page = (title: string, body: string, depth = 0, theme: ExportTheme = 'light', project = '') => {
  const back = depth ? `<a href="${'../'.repeat(depth)}index.html">Overview</a>` : '';
  const csp = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-src 'self'";
  return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${theme}"><meta name="theme-color" content="${theme === 'dark' ? '#0b0b0b' : '#ffffff'}"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escHtml(title)}</title><style>${css(theme)}</style></head><body><header class="bar"><b>${escHtml(project || title)}</b><span class="sp"></span>${back}</header><main>${body}<footer>Exported with WorkCraft</footer></main></body></html>`;
};

export async function exportHtml(id: string, withChats = true, theme: ExportTheme = 'light'): Promise<{ name: string; bytes: Uint8Array }> {
  const { meta, items, chats } = await collect(id, withChats);
  const files: Zippable = {};
  const cards: string[] = [];
  for (const it of items) {
    const original = `files${it.path}`;
    files[original] = it.data;
    const slug = slugify(it.path);
    const md = await fileToMarkdown(it.path, it.data, `../${original}`);
    const name = it.path.split('/').pop()!;
    const extra = it.kind === 'pdf' ? `<p><a href="../${escHtml(original)}">Open the original PDF</a></p>` : it.kind === 'image' ? '' : `<p><a href="../${escHtml(original)}" download>Download the original (${fmtBytes(it.size)})</a></p>`;
    files[`pages/${slug}.html`] = new TextEncoder().encode(page(name, `<h1>${escHtml(name)}</h1><p class="mut">${escHtml(it.path)} · ${fmtBytes(it.size)} · ${new Date(it.mtime).toISOString().slice(0, 10)}</p>${extra}<article>${mdToHtml(md)}</article>`, 1, theme, meta.name));
    const thumb = it.kind === 'image' ? `<img src="${escHtml(original)}" alt="" loading="lazy">` : '';
    cards.push(`<a class="card" style="--c:${ACCENT[it.kind]}" href="pages/${escHtml(slug)}.html">${thumb}<b>${escHtml(name)}</b><span class="mut">${escHtml(it.path)}</span><br><span class="tag">${it.kind}</span> <span class="mut">${fmtBytes(it.size)}</span></a>`);
  }
  for (const c of chats) {
    files[`chats/${slugify(c.id)}.html`] = new TextEncoder().encode(page(c.title, `<h1>${escHtml(c.title)}</h1><p class="mut">Chat · ${escHtml(c.updated.slice(0, 16).replace('T', ' '))}</p><article>${mdToHtml(c.md)}</article>`, 1, theme, meta.name));
    cards.push(`<a class="card" style="--c:${ACCENT.chat}" href="chats/${escHtml(slugify(c.id))}.html"><b>${escHtml(c.title)}</b><span class="tag">chat</span></a>`);
  }
  files['index.html'] = new TextEncoder().encode(page(meta.name, `<h1>${escHtml(meta.name)}</h1><p class="mut">${items.length} files${chats.length ? `, ${chats.length} chats` : ''} · exported ${new Date().toISOString().slice(0, 10)}</p><div class="grid">${cards.join('')}</div>`, 0, theme));
  return { name: `${slugify(meta.name)}-gallery.zip`, bytes: zipSync(files, { level: 6 }) };
}

// ---------------------------------------------------------------- Markdown folder

export async function exportMarkdown(id: string, withChats = true): Promise<{ name: string; bytes: Uint8Array }> {
  const { meta, items, chats } = await collect(id, withChats);
  const files: Zippable = {};
  const index: string[] = [`# ${meta.name}`, '', `Exported with WorkCraft on ${new Date().toISOString().slice(0, 10)}. ${items.length} files${chats.length ? `, ${chats.length} chats` : ''}.`, ''];
  const groups = new Map<string, string[]>();
  for (const it of items) {
    const asset = `assets${it.path}`;
    files[asset] = it.data;
    const mdPath = `docs${it.path.replace(/\.[^./]+$/, '')}.md`;
    const depth = mdPath.split('/').length - 1;
    const body = await fileToMarkdown(it.path, it.data, '../'.repeat(depth) + asset);
    files[mdPath] = new TextEncoder().encode(`# ${it.path.split('/').pop()}\n\nSource: \`${it.path}\` · ${fmtBytes(it.size)} · [original](${'../'.repeat(depth)}${asset})\n\n${body}\n`);
    const folder = it.path.split('/').slice(0, -1).join('/') || '/';
    groups.set(folder, [...(groups.get(folder) || []), `- [${it.path.split('/').pop()}](${mdPath}) (${it.kind}, ${fmtBytes(it.size)})`]);
  }
  for (const [folder, list] of [...groups].sort()) index.push(`## ${folder}`, '', ...list, '');
  if (chats.length) {
    index.push('## Chats', '');
    for (const c of chats) {
      const p = `chats/${slugify(c.id)}.md`;
      files[p] = new TextEncoder().encode(`# ${c.title}\n\n${c.md}\n`);
      index.push(`- [${c.title}](${p})`);
    }
  }
  files['README.md'] = new TextEncoder().encode(index.join('\n') + '\n');
  return { name: `${slugify(meta.name)}-docs.zip`, bytes: zipSync(files, { level: 6 }) };
}

// ---------------------------------------------------------------- PDF portfolio

const A4: [number, number] = [595.28, 841.89];

/** Replaces characters the standard PDF fonts cannot draw. */
function safeText(font: PDFFont, s: string, cache: Map<string, boolean>): string {
  let out = '';
  for (const ch of s.replace(/\t/g, '  ')) {
    let ok = cache.get(ch);
    if (ok === undefined) {
      try {
        font.encodeText(ch);
        ok = true;
      } catch {
        ok = false;
      }
      cache.set(ch, ok);
    }
    out += ok ? ch : ch === '≈' ? '~' : ch === '→' ? '->' : ch === '…' ? '...' : '?';
  }
  return out;
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (font.widthOfTextAtSize(next, size) > width && line.trim()) {
        out.push(line.trimEnd());
        line = w.trimStart();
        while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

export async function exportPdf(id: string, withChats = false, theme: ExportTheme = 'light'): Promise<{ name: string; bytes: Uint8Array }> {
  const { meta, items, chats } = await collect(id, withChats);
  const doc = await PDFDocument.create();
  doc.setTitle(`${meta.name} portfolio`);
  doc.setProducer('WorkCraft');
  doc.setCreator('WorkCraft');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const cache = new Map<string, boolean>();
  const dark = theme === 'dark';
  const ink = dark ? rgb(0.93, 0.93, 0.93) : rgb(0.06, 0.07, 0.09);
  const mut = dark ? rgb(0.62, 0.62, 0.62) : rgb(0.4, 0.42, 0.47);
  // Pages made here (cover, contents, text) are black in dark mode; merged PDFs keep their own pages
  const paper = (p: PDFPage): PDFPage => {
    if (dark) p.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: rgb(0.043, 0.043, 0.043) });
    return p;
  };
  const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

  // cover
  const cover = paper(doc.addPage(A4));
  cover.drawRectangle({ x: 0, y: A4[1] - 12, width: A4[0], height: 12, color: dark ? rgb(0.93, 0.93, 0.93) : hex('#335CFF') });
  cover.drawText(safeText(bold, meta.name, cache), { x: 64, y: 600, size: 32, font: bold, color: ink, maxWidth: 470 });
  cover.drawText('Project portfolio', { x: 64, y: 560, size: 16, font, color: mut });
  cover.drawText(`${items.length} files · ${new Date().toISOString().slice(0, 10)} · WorkCraft`, { x: 64, y: 530, size: 11, font, color: mut });

  const toc: { title: string; page: number; kind: string }[] = [];
  const tocPage = paper(doc.addPage(A4));
  let pg: PDFPage = tocPage;
  let y = 0;
  const newPage = () => {
    pg = paper(doc.addPage(A4));
    y = A4[1] - 64;
  };
  const line = (text: string, f: PDFFont, size: number, color = ink, gap = 1.45) => {
    if (y < 64) newPage();
    pg.drawText(safeText(f, text, cache), { x: 56, y, size, font: f, color });
    y -= size * gap;
  };
  const section = (title: string, sub: string, kind: string) => {
    newPage();
    toc.push({ title, page: doc.getPageCount(), kind });
    pg.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: hex(ACCENT[kind] || '#94A3B8') });
    line(title, bold, 18, ink, 1.6);
    line(sub, font, 10, mut, 2.2);
  };

  for (const it of items) {
    const name = it.path.split('/').pop()!;
    section(name, `${it.path} · ${fmtBytes(it.size)}`, it.kind);
    if (it.kind === 'pdf') {
      try {
        const src = await PDFDocument.load(it.data, { ignoreEncryption: false });
        const pages = await doc.copyPages(src, src.getPageIndices().slice(0, 200));
        line(`${pages.length} pages follow.`, font, 11, mut);
        for (const p of pages) doc.addPage(p);
        continue;
      } catch (e) {
        line(`The PDF could not be merged (${(e as Error).message}). Its text follows.`, font, 10, mut);
      }
    }
    if (it.kind === 'image' && ['png', 'jpg', 'jpeg'].includes(ext(it.path))) {
      try {
        const img = ext(it.path) === 'png' ? await doc.embedPng(it.data) : await doc.embedJpg(it.data);
        const s = Math.min((A4[0] - 112) / img.width, (y - 64) / img.height, 1);
        pg.drawImage(img, { x: 56, y: y - img.height * s, width: img.width * s, height: img.height * s });
        continue;
      } catch (e) {
        line(`The image could not be embedded (${(e as Error).message}).`, font, 10, mut);
        continue;
      }
    }
    const md = await fileToMarkdown(it.path, it.data);
    const isTable = it.kind === 'sheet' || it.kind === 'code';
    const f = isTable ? mono : font;
    const size = isTable ? 8 : 10.5;
    for (const raw of md.split('\n').slice(0, 4000)) {
      const head = raw.match(/^(#{1,4})\s+(.*)/);
      if (head) {
        y -= 4;
        line(head[2]!.replace(/\*\*/g, ''), bold, head[1]!.length <= 2 ? 13 : 11.5);
        continue;
      }
      const text = isTable ? raw : raw.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^\s*[-*]\s+/, '• ');
      for (const l of wrap(f, safeText(f, text, cache), size, A4[0] - 112)) line(l, f, size);
    }
  }
  for (const c of chats) {
    section(c.title, 'Chat', 'chat');
    for (const raw of c.md.split('\n').slice(0, 3000)) for (const l of wrap(font, safeText(font, raw.replace(/^###\s+/, ''), cache), 10, A4[0] - 112)) line(l, raw.startsWith('###') ? bold : font, 10);
  }

  // contents
  let ty = A4[1] - 72;
  tocPage.drawText('Contents', { x: 56, y: ty, size: 20, font: bold, color: ink });
  ty -= 36;
  let tp = tocPage;
  // contents longer than one page shift the page numbers by the extra contents pages
  const perPage = Math.floor((A4[1] - 72 - 36 - 64) / 18);
  const extra = Math.max(0, Math.ceil(toc.length / perPage) - 1);
  for (const e of toc) {
    if (ty < 64) {
      tp = paper(doc.insertPage(doc.getPages().indexOf(tp) + 1, A4));
      ty = A4[1] - 72;
    }
    tp.drawRectangle({ x: 56, y: ty - 1, width: 6, height: 10, color: hex(ACCENT[e.kind] || '#94A3B8') });
    tp.drawText(safeText(font, e.title, cache).slice(0, 80), { x: 70, y: ty, size: 11, font, color: ink });
    tp.drawText(String(e.page + extra), { x: A4[0] - 80, y: ty, size: 11, font, color: mut });
    ty -= 18;
  }
  return { name: `${slugify(meta.name)}-portfolio.pdf`, bytes: await doc.save() };
}
