// PdfCraft tools in the backend: read text (unpdf) and sign locally (pdf-lib).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

function pageSet(spec: string | undefined, total: number): number[] {
  if (!spec) return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let p = a!; p <= (b ?? a!); p++) if (p >= 1 && p <= total) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

export async function readPdf(data: Uint8Array, pages?: string): Promise<{ pages: number; text: { page: number; text: string }[] }> {
  if (!data.byteLength) return { pages: 0, text: [] }; // an empty file has no pages
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const list = Array.isArray(text) ? text : [text];
  return { pages: totalPages, text: pageSet(pages, totalPages).map((p) => ({ page: p, text: (list[p - 1] || '').trim() })) };
}

export async function signPdf(data: Uint8Array, opts: { name: string; page?: number; position: 'unten-rechts' | 'unten-links' | 'oben-rechts' }): Promise<{ bytes: Uint8Array; page: number }> {
  const doc = await PDFDocument.load(data);
  const pages = doc.getPages();
  const index = Math.min(Math.max(1, opts.page ?? pages.length), pages.length) - 1;
  const page = pages[index]!;
  const { width, height } = page.getSize();
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const boxW = 220;
  const x = opts.position === 'unten-links' ? 56 : width - boxW - 56;
  const y = opts.position === 'oben-rechts' ? height - 120 : 64;
  const date = new Date().toLocaleDateString('de-DE');
  page.drawText(opts.name, { x, y: y + 34, size: 20, font: italic, color: rgb(0.08, 0.08, 0.12) });
  page.drawLine({ start: { x, y: y + 26 }, end: { x: x + boxW, y: y + 26 }, thickness: 0.8, color: rgb(0.08, 0.72, 0.65) });
  page.drawText(`Signed locally on ${date} · WorkCraft`, { x, y: y + 12, size: 8, font: regular, color: rgb(0.4, 0.43, 0.5) });
  doc.setModificationDate(new Date());
  return { bytes: await doc.save(), page: index + 1 };
}

/** Simple text PDF (sample project). */
export async function textPdf(title: string, pagesText: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('WorkCraft');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const lines of pagesText) {
    const page = doc.addPage([595.28, 841.89]);
    let y = 770;
    lines.forEach((ln, i) => {
      const isHead = i === 0 || /^\d+\.\s/.test(ln);
      page.drawText(ln, { x: 72, y, size: i === 0 ? 20 : 11, font: isHead ? bold : font, color: rgb(0.05, 0.05, 0.07) });
      y -= i === 0 ? 34 : 18;
    });
  }
  return doc.save();
}
