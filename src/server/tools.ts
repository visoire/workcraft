// Runs the backend tools (GridCraft, WordCraft, DeckCraft, PdfCraft, code, terminal).
// The arguments are already checked by the Zod schemas from src/mcp/schemas.ts.

import { extname } from 'node:path';
import { readProjectFile, writeProjectFile, existsInProject, listTree, readMetaFile, writeMetaFile } from './projects.js';
import { normProjectPath } from './paths.js';
import { readSheet, writeSheet, sheetToMarkdown } from './office/sheets.js';
import { readDocument, markdownToDocx } from './office/docs.js';
import { buildPptx, readPptxText, type DeckSpec, type SlideSpec } from './office/slides.js';
import { readPdf, signPdf } from './office/pdf.js';
import { runCommand } from './terminal.js';
import { search } from './search.js';
import { addNote } from './memory.js';
import { graph } from './graph.js';
import { PDFDocument } from 'pdf-lib';
import { readSkill, skills } from './skills.js';
import { driveFetch, driveList, driveSend, type CloudError } from './cloud.js';

export interface ToolContext {
  root: string;
  origin: string;
  progress(message: string, step?: number, total?: number): Promise<void>;
}

export interface ToolOutput {
  text: string;
  data?: Record<string, unknown>;
  changed?: string[];
}

type Args = Record<string, unknown>;
const ext = (p: string) => extname(p).slice(1).toLowerCase();
const str = (v: unknown) => String(v ?? '');
const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'html', 'htm', 'xml', 'svg', 'yml', 'yaml', 'toml', 'py', 'sh', 'sql', 'ini', 'log', 'tex', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'gitignore']);

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function needExt(path: string, allowed: string[], tool: string) {
  if (!allowed.includes(ext(path))) throw new ToolError('BAD_TYPE', `${tool} supports ${allowed.map((e) => '.' + e).join(', ')}, not ${path}`);
}

async function mustRead(root: string, path: string) {
  if (!existsInProject(root, path)) throw new ToolError('NOT_FOUND', `File not found: ${path}`);
  return readProjectFile(root, path);
}

const deckSpecName = (path: string) => `decks/${normProjectPath(path).slice(1).replace(/[^\w.-]+/g, '_')}.json`;

export const HANDLERS: Record<string, (a: Args, ctx: ToolContext) => Promise<ToolOutput>> = {
  async 'list-skills'() {
    const list = skills(true);
    return { text: list.length ? list.map((s) => `- ${s.name}: ${s.description.slice(0, 200)}`).join('\n') : 'No skills are installed.', data: { skills: list.map((s) => ({ name: s.name, description: s.description, origin: s.origin })) } };
  },

  async 'cloud-list'(a) {
    try {
      const items = await driveList({ folder: a.folder ? str(a.folder) : undefined, query: a.query ? str(a.query) : undefined, limit: Number(a.limit) || 30 });
      return { text: items.length ? items.map((i) => `- ${i.name} [${i.kind}] id=${i.id}${i.modified ? ` modified ${i.modified.slice(0, 10)}` : ''}`).join('\n') : 'No files found.', data: { items } };
    } catch (e) {
      throw new ToolError((e as CloudError).code || 'CLOUD', (e as Error).message);
    }
  },

  async 'cloud-import'(a, ctx) {
    try {
      await ctx.progress('downloading from Google Drive');
      const f = await driveFetch(str(a.id));
      const folder = { docx: '/documents', xlsx: '/sheets', pptx: '/presentations', pdf: '/pdf' }[ext(f.name) as 'docx'];
      const path = normProjectPath(a.to ? str(a.to) : `${folder || ''}/${f.name}`);
      await writeProjectFile(ctx.root, path, f.data, ctx.origin);
      return { text: `${f.name} (${f.from === 'file' ? 'file' : 'Google ' + f.from + ' exported'}) saved as ${path}.`, changed: [path] };
    } catch (e) {
      throw new ToolError((e as CloudError).code || 'CLOUD', (e as Error).message);
    }
  },

  async 'cloud-export'(a, ctx) {
    const path = normProjectPath(str(a.path));
    const data = await mustRead(ctx.root, path);
    try {
      await ctx.progress('uploading to Google Drive');
      const item = await driveSend(path.split('/').pop()!, data, { folder: a.folder ? str(a.folder) : undefined, convert: !!a.convert });
      return { text: `${path} is in Google Drive as "${item.name}" (${item.kind})${item.url ? `: ${item.url}` : ''}.`, data: { item } };
    } catch (e) {
      throw new ToolError((e as CloudError).code || 'CLOUD', (e as Error).message);
    }
  },

  async 'read-skill'(a) {
    try {
      return { text: readSkill(skills(), str(a.name), a.file ? str(a.file) : undefined) };
    } catch (e) {
      throw new ToolError('NOT_FOUND', (e as Error).message);
    }
  },

  async 'read-sheet'(a, ctx) {
    const path = normProjectPath(str(a.path));
    needExt(path, ['xlsx', 'csv', 'tsv'], 'read-sheet');
    await ctx.progress(`reading ${path}`);
    const d = await readSheet(await mustRead(ctx.root, path), ext(path), { sheet: a.sheet as string | undefined, range: a.range as string | undefined });
    await ctx.progress(`${d.rows.length} rows evaluated`);
    return { text: sheetToMarkdown(d), data: { ...d } };
  },

  async 'write-sheet'(a, ctx) {
    const path = normProjectPath(str(a.path));
    needExt(path, ['xlsx', 'csv', 'tsv'], 'write-sheet');
    const cells = a.cells as Record<string, string | number | boolean | null>;
    await ctx.progress(`writing ${Object.keys(cells).length} cells into ${path}`);
    const existing = existsInProject(ctx.root, path) ? await readProjectFile(ctx.root, path) : null;
    const bytes = await writeSheet(existing, ext(path), { sheet: a.sheet as string | undefined, cells, mode: (a.mode as 'merge' | 'replace') || 'merge' });
    await writeProjectFile(ctx.root, path, bytes, ctx.origin);
    return { text: `${Object.keys(cells).length} cells written into ${path}.`, changed: [path] };
  },

  async 'read-document'(a, ctx) {
    const path = normProjectPath(str(a.path));
    needExt(path, ['docx', 'md', 'markdown', 'txt', 'odt', 'html', 'htm'], 'read-document');
    await ctx.progress(`reading ${path}`);
    const md = await readDocument(await mustRead(ctx.root, path), ext(path));
    return { text: md.length > 60000 ? md.slice(0, 60000) + '\n[shortened]' : md, data: { path, characters: md.length } };
  },

  async 'write-document'(a, ctx) {
    const path = normProjectPath(str(a.path));
    needExt(path, ['docx', 'md', 'markdown', 'txt'], 'write-document');
    let md = str(a.markdown);
    if (a.mode === 'append' && existsInProject(ctx.root, path)) {
      await ctx.progress(`reading the existing content of ${path}`);
      md = (await readDocument(await readProjectFile(ctx.root, path), ext(path))).trimEnd() + '\n\n' + md;
    }
    await ctx.progress(`creating ${path}`);
    const bytes = ext(path) === 'docx' ? await markdownToDocx(md, str(a.title) || path.split('/').pop()) : new TextEncoder().encode(md.endsWith('\n') ? md : md + '\n');
    await writeProjectFile(ctx.root, path, bytes, ctx.origin);
    return { text: `${path} written (${md.length} characters).`, changed: [path] };
  },

  async 'create-slide'(a, ctx) {
    const path = normProjectPath(str(a.path));
    needExt(path, ['pptx'], 'create-slide');
    const slides = a.slides as SlideSpec[];
    let spec: DeckSpec = { title: str(a.title) || path.split('/').pop()!.replace(/\.pptx$/i, ''), slides: [] };
    if (a.mode !== 'replace') {
      const saved = await readMetaFile(ctx.root, deckSpecName(path));
      if (saved) spec = JSON.parse(saved) as DeckSpec;
      else if (existsInProject(ctx.root, path)) {
        // presentation not made by WorkCraft: keep its texts so nothing is lost
        spec.slides = readPptxText(await readProjectFile(ctx.root, path)).map((s) => ({ title: s.texts[0] || `Slide ${s.slide}`, bullets: s.texts.slice(1) }));
      }
    }
    if (a.title) spec.title = str(a.title);
    spec.slides.push(...slides);
    for (let i = 0; i < slides.length; i++) await ctx.progress(`Slide ${spec.slides.length - slides.length + i + 1}: ${slides[i]!.title}`, i + 1, slides.length);
    await writeProjectFile(ctx.root, path, await buildPptx(spec), ctx.origin);
    await writeMetaFile(ctx.root, deckSpecName(path), JSON.stringify(spec, null, 2));
    return { text: `${slides.length} ${slides.length === 1 ? 'slide' : 'slides'} created in ${path} (${spec.slides.length} in total).`, data: { slides: spec.slides.length }, changed: [path] };
  },

  async 'read-slides'(a, ctx) {
    const path = normProjectPath(str(a.path));
    needExt(path, ['pptx'], 'read-slides');
    const slides = readPptxText(await mustRead(ctx.root, path));
    return { text: slides.map((s) => `Slide ${s.slide}: ${s.texts.join(' | ')}`).join('\n') || 'No texts found.', data: { slides } };
  },

  async 'read-pdf'(a, ctx) {
    const path = normProjectPath(str(a.path));
    needExt(path, ['pdf'], 'read-pdf');
    await ctx.progress(`reading ${path}`);
    const r = await readPdf(await mustRead(ctx.root, path), a.pages as string | undefined);
    const text = r.text.map((p) => `Page ${p.page}:\n${p.text}`).join('\n\n');
    return { text: text.length > 60000 ? text.slice(0, 60000) + '\n[shortened]' : text, data: { pages: r.pages } };
  },

  async 'sign-pdf'(a, ctx) {
    const path = normProjectPath(str(a.path));
    needExt(path, ['pdf'], 'sign-pdf');
    const out = normProjectPath(str(a.output) || path.replace(/\.pdf$/i, '-signiert.pdf'));
    await ctx.progress(`signing ${path}`);
    const r = await signPdf(await mustRead(ctx.root, path), { name: str(a.name), page: a.page as number | undefined, position: (a.position as 'unten-rechts') || 'unten-rechts' });
    await writeProjectFile(ctx.root, out, r.bytes, ctx.origin);
    return { text: `Signature placed on page ${r.page}. Saved as ${out}.`, changed: [out] };
  },

  async 'images-to-pdf'(a, ctx) {
    const out = normProjectPath(str(a.output));
    needExt(out, ['pdf'], 'images-to-pdf');
    const doc = await PDFDocument.create();
    doc.setTitle(str(a.title) || out.split('/').pop()!.replace(/\.pdf$/i, ''));
    doc.setProducer('WorkCraft');
    const list = a.images as string[];
    for (const [i, raw] of list.entries()) {
      const p = normProjectPath(raw);
      needExt(p, ['png', 'jpg', 'jpeg'], 'images-to-pdf');
      await ctx.progress(`page ${i + 1}: ${p}`, i + 1, list.length);
      const data = await mustRead(ctx.root, p);
      const img = ext(p) === 'png' ? await doc.embedPng(data) : await doc.embedJpg(data);
      // A4 in the orientation of the image, the image fills the page with a margin
      const land = img.width > img.height;
      const [W, H] = land ? [841.89, 595.28] : [595.28, 841.89];
      const s = Math.min((W - 48) / img.width, (H - 48) / img.height);
      const page = doc.addPage([W, H]);
      page.drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s });
    }
    await writeProjectFile(ctx.root, out, await doc.save(), ctx.origin);
    return { text: `${list.length} ${list.length === 1 ? 'image' : 'images'} combined into ${out}.`, changed: [out] };
  },

  async 'search-project'(a, ctx) {
    await ctx.progress('searching the project index');
    const r = await search(ctx.root, str(a.query), { mode: (a.mode as 'hybrid') || 'hybrid', limit: Number(a.limit) || 6 });
    const text = r.hits.map((h, i) => `${i + 1}. ${h.source} (${h.loc}, score ${h.score.toFixed(2)})\n${h.text.slice(0, 900)}`).join('\n\n');
    return { text: (text || 'No matches.') + (r.error ? `\n\nNote: ${r.error}` : ''), data: { hits: r.hits.length, mode: r.mode, semantic: r.semantic } };
  },

  async remember(a, ctx) {
    const n = addNote(ctx.root, str(a.note), 'ai');
    return { text: `Saved in the project memory: ${n.text}`, data: { id: n.id } };
  },

  async 'file-history'(a, ctx) {
    const path = normProjectPath(str(a.path));
    const l = graph.lineage(ctx.root, path);
    if (!l.node) return { text: `No history for ${path} yet. WorkCraft records versions from the first write on.` };
    const vers = l.node.versions.map((v) => `v${v.v} ${v.at.slice(0, 16).replace('T', ' ')} ${v.size} B by ${v.tool || v.origin}${v.chain ? ` (chat step ${v.chain})` : ''}`).join('\n');
    const from = l.derivedFrom.map((e) => `${e.from} -> ${e.to} via ${e.tool}`).join('\n');
    const used = l.usedBy.map((e) => `${e.from} -> ${e.to} via ${e.tool}`).join('\n');
    return { text: `Versions of ${path}:\n${vers}${from ? `\n\nDerived from:\n${from}` : ''}${used ? `\n\nUsed for:\n${used}` : ''}`, data: { versions: l.node.versions.length } };
  },

  async 'list-files'(a, ctx) {
    const dir = normProjectPath(str(a.dir) || '/');
    const all = (await listTree(ctx.root)).filter((e) => dir === '/' || e.path.startsWith(dir + '/'));
    return { text: all.map((e) => `${e.kind === 'dir' ? 'd' : 'f'} ${e.path}${e.kind === 'file' ? ` (${e.size} B)` : ''}`).join('\n') || '(empty)', data: { count: all.length } };
  },

  async 'search-files'(a, ctx) {
    const q = str(a.query).toLowerCase();
    const dir = normProjectPath(str(a.dir) || '/');
    const hits: string[] = [];
    for (const e of await listTree(ctx.root)) {
      if (e.kind !== 'file' || !TEXT_EXT.has(ext(e.path)) || e.size > 2_000_000 || !(dir === '/' || e.path.startsWith(dir + '/'))) continue;
      const lines = new TextDecoder().decode(await readProjectFile(ctx.root, e.path)).split('\n');
      lines.forEach((l, i) => l.toLowerCase().includes(q) && hits.length < 200 && hits.push(`${e.path}:${i + 1}: ${l.trim().slice(0, 160)}`));
    }
    return { text: hits.join('\n') || 'No matches.', data: { hits: hits.length } };
  },

  async 'read-file'(a, ctx) {
    const path = normProjectPath(str(a.path));
    if (!TEXT_EXT.has(ext(path)) && ext(path)) throw new ToolError('BAD_TYPE', `${path} is not a text file. Use read-sheet, read-document, read-slides or read-pdf.`);
    const t = new TextDecoder().decode(await mustRead(ctx.root, path));
    return { text: t.length > 80000 ? t.slice(0, 80000) + '\n[shortened]' : t };
  },

  async 'write-file'(a, ctx) {
    const path = await writeProjectFile(ctx.root, str(a.path), str(a.content), ctx.origin);
    return { text: `Saved: ${path}`, changed: [path] };
  },

  async 'run-command'(a, ctx) {
    await ctx.progress(`$ ${str(a.command)}`);
    const { resolveIn } = await import('./paths.js');
    const r = await runCommand(str(a.command), resolveIn(ctx.root, str(a.cwd) || '/'));
    return { text: `Exit code ${r.code}${r.timedOut ? ' (time limit reached)' : ''}\n${r.output}`, data: { code: r.code } };
  },

};

/** Text representation of a file for @ mentions in the chat. */
export async function fileContext(root: string, path: string, limit = 24000): Promise<{ text: string; kind: string }> {
  const p = normProjectPath(path);
  const e = ext(p);
  const data = await mustRead(root, p);
  let text: string;
  let kind = 'text';
  if (['xlsx', 'csv', 'tsv'].includes(e)) {
    text = sheetToMarkdown(await readSheet(data, e, {}), 120);
    kind = 'sheet';
  } else if (['docx', 'odt'].includes(e)) {
    text = await readDocument(data, e);
    kind = 'document';
  } else if (e === 'pptx') {
    text = readPptxText(data).map((s) => `Slide ${s.slide}: ${s.texts.join(' | ')}`).join('\n');
    kind = 'presentation';
  } else if (e === 'pdf') {
    const r = await readPdf(data);
    text = r.text.map((x) => `Page ${x.page}: ${x.text}`).join('\n\n');
    kind = 'pdf';
  } else if (TEXT_EXT.has(e) || !e) text = new TextDecoder().decode(data);
  else {
    text = `[Binary file, ${data.byteLength} bytes]`;
    kind = 'binary';
  }
  return { text: text.length > limit ? text.slice(0, limit) + `\n[shortened, ${text.length} characters in total]` : text, kind };
}
