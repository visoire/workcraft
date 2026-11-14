// File attachments in the chat input: file picker, drag and drop from the operating system and
// pasting from the clipboard. Every file shows a preview card before sending.
//
// On send the files are saved into the project under /attachments/, so the AI and the apps can
// work with them: documents, sheets, slides, PDFs and text become @ mentions (their text goes to
// the model as context), images go to the model as image content (scaled down to at most
// 1568 pixels) and keep a small preview in the message.

import { h, esc, extname, formatBytes } from '../app/util.js';
import { icon } from '../app/icons.js';
import { toast } from '../app/notifications.js';
import { fs } from '../project/fs.js';
import { toolMark } from '../workspace/registry.js';
import type { TurnImage } from './types.js';
import { t as tr } from '../app/i18n.js';

export type AttachKind = 'image' | 'pdf' | 'text' | 'sheet' | 'doc' | 'slides' | 'other';

export interface PendingFile {
  id: string;
  file: File;
  kind: AttachKind;
  url?: string;
  snippet?: string;
}

export const MAX_FILES = 8;
const MAX_BYTES = 25 * 1024 * 1024;
const IMAGE_MAX = 1568;

export function kindOf(name: string, type = ''): AttachKind {
  const e = extname(name);
  if (/^image\/(png|jpeg|gif|webp)$/.test(type) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (['xlsx', 'xls', 'ods', 'csv', 'tsv'].includes(e)) return 'sheet';
  if (['docx', 'doc', 'odt', 'rtf'].includes(e)) return 'doc';
  if (['pptx', 'ppt', 'odp'].includes(e)) return 'slides';
  if (['txt', 'md', 'markdown', 'json', 'js', 'ts', 'css', 'html', 'xml', 'yml', 'yaml', 'log', 'py', 'sql'].includes(e) || type.startsWith('text/')) return 'text';
  return 'other';
}

const MARK: Partial<Record<AttachKind, string>> = { pdf: 'pdfcraft', sheet: 'gridcraft', doc: 'wordcraft', slides: 'deckcraft' };

/** Names safe for @ mentions: no spaces, no special characters. */
export function safeName(name: string): string {
  const e = extname(name);
  const base = (e ? name.slice(0, -(e.length + 1)) : name)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file';
  return e ? `${base}.${e.toLowerCase()}` : base;
}

export class AttachmentTray {
  readonly el = h('div.att-tray', { hidden: true, role: 'list', 'aria-label': tr('Attached files') });
  private items: PendingFile[] = [];
  private seq = 0;
  constructor(private onChange: () => void) {}

  get files(): PendingFile[] {
    return this.items;
  }
  get count(): number {
    return this.items.length;
  }

  async add(list: Iterable<File>): Promise<void> {
    for (const file of list) {
      if (this.items.length >= MAX_FILES) {
        toast(tr('At most {n} files per message', { n: MAX_FILES }), 'warning');
        break;
      }
      if (file.size > MAX_BYTES) {
        toast(tr('{name} is larger than 25 MB', { name: file.name }), 'warning');
        continue;
      }
      const kind = kindOf(file.name, file.type);
      const item: PendingFile = { id: `att${++this.seq}`, file, kind };
      if (kind === 'image') item.url = URL.createObjectURL(file);
      if (kind === 'text' || extname(file.name) === 'csv') item.snippet = await snippet(file);
      this.items.push(item);
    }
    this.render();
  }

  remove(id: string): void {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [it] = this.items.splice(i, 1);
    if (it?.url) URL.revokeObjectURL(it.url);
    this.render();
  }

  clear(): void {
    for (const it of this.items) if (it.url) URL.revokeObjectURL(it.url);
    this.items = [];
    this.render();
  }

  private render(): void {
    this.el.hidden = !this.items.length;
    this.el.replaceChildren(
      ...this.items.map((it) => {
        const thumb = it.kind === 'image' ? h('img.att-thumb', { src: it.url, alt: '' }) : h('span.att-ic', { html: MARK[it.kind] ? toolMark(MARK[it.kind]!, 22) : icon(it.kind === 'text' ? 'file' : 'clip', { size: 18 }) });
        return h(
          'div.att-card.frame.sm',
          { role: 'listitem', 'data-kind': it.kind, title: it.file.name },
          h(
            'div.well.att-well',
            thumb,
            h('div.att-meta', h('span.att-name', it.file.name), h('span.att-sub.mono', `${extname(it.file.name).toUpperCase() || it.kind} · ${formatBytes(it.file.size)}`), it.snippet ? h('span.att-snip.mono', it.snippet) : null),
            h('button.icon-btn.att-x', { type: 'button', 'aria-label': tr('Remove {name}', { name: it.file.name }), title: tr('Remove'), html: icon('close', { size: 14 }), onclick: () => this.remove(it.id) })
          )
        );
      })
    );
    this.onChange();
  }

  /**
   * Saves the files into the project and returns what the message needs: @ mentions for
   * documents, image content for the model and small previews.
   */
  async commit(): Promise<{ mentions: string[]; images: TurnImage[]; previews: string[]; saved: string[] }> {
    const mentions: string[] = [];
    const images: TurnImage[] = [];
    const previews: string[] = [];
    const saved: string[] = [];
    for (const it of this.items) {
      const path = fs.uniquePath(`/attachments/${safeName(it.file.name)}`);
      try {
        await fs.write(path, await it.file.arrayBuffer(), 'chat');
        saved.push(path);
      } catch (e) {
        toast(tr('{name} could not be saved', { name: it.file.name }), 'error', (e as Error).message);
        continue;
      }
      if (it.kind === 'image') {
        try {
          const img = await prepareImage(it.file);
          images.push(img.image);
          previews.push(img.preview);
        } catch {
          mentions.push(path.slice(1));
        }
      } else mentions.push(path.slice(1));
    }
    this.clear();
    return { mentions, images, previews, saved };
  }
}

async function snippet(file: File): Promise<string> {
  try {
    const text = await file.slice(0, 600).text();
    return text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 2).join(' · ').slice(0, 140);
  } catch {
    return '';
  }
}

async function bitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(src: ImageBitmap | HTMLImageElement, max: number, type: string, quality = 0.86): string {
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const hh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const k = Math.min(1, max / Math.max(w, hh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(hh * k));
  const g = c.getContext('2d')!;
  if (type === 'image/jpeg') {
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, c.width, c.height);
  }
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL(type, quality);
}

/** Image for the model (at most 1568 pixels) and a preview of 160 pixels for the message. */
export async function prepareImage(file: File): Promise<{ image: TurnImage; preview: string }> {
  const src = await bitmap(file);
  const keepPng = file.type === 'image/png' && file.size < 1.5 * 1024 * 1024;
  const url = draw(src, IMAGE_MAX, keepPng ? 'image/png' : 'image/jpeg');
  const preview = draw(src, 160, 'image/jpeg', 0.8);
  const [head, data] = url.split(',');
  return { image: { mime: head!.match(/data:([^;]+)/)![1]!, data: data! }, preview };
}

/** Files from a drop or paste event (not paths from the project tree). */
export function filesOf(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  return [...dt.files];
}

export const attachmentLabel = (n: number) => esc(n === 1 ? tr('1 file') : tr('{n} files', { n }));

/**
 * Document scan from the camera (iPadOS, iOS) or a photo: scaled to at most 2400 pixels,
 * grayscale and automatic contrast (levels between the 2nd and 98th percentile), so text
 * reads well for the model and in PdfCraft. Returns a JPEG file named scan-<date>.jpg.
 */
export async function enhanceScan(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s);
    const hgt = Math.round(bmp.height * s);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0, w, hgt);
    bmp.close?.();
    const img = g.getImageData(0, 0, w, hgt);
    const d = img.data;
    const hist = new Uint32Array(256);
    const lum = new Uint8ClampedArray(w * hgt);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const y = (d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000;
      lum[j] = y;
      hist[lum[j]!]!++;
    }
    const total = w * hgt;
    let lo = 0;
    let hi = 255;
    for (let acc = 0; lo < 255 && (acc += hist[lo]!) < total * 0.02; lo++);
    for (let acc = 0; hi > 0 && (acc += hist[hi]!) < total * 0.02; hi--);
    const span = Math.max(24, hi - lo);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = Math.max(0, Math.min(255, ((lum[j]! - lo) * 255) / span));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    g.putImageData(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
    if (!blob) return file;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
    return new File([blob], `scan-${stamp}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
