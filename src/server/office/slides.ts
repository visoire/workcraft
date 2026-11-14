// DeckCraft tools in the backend: create slides as .pptx (pptxgenjs) and read slide texts.
import PptxGenJS from 'pptxgenjs';
import { unzipSync, strFromU8 } from 'fflate';

export interface SlideSpec {
  title: string;
  bullets: string[];
  notes?: string;
}
export interface DeckSpec {
  title: string;
  slides: SlideSpec[];
}

// Narrow types for the pptxgenjs functions used (the package types do not fit NodeNext)
interface PptxSlide {
  background: { color: string };
  addShape(shape: string, opts: Record<string, unknown>): void;
  addText(text: string | { text: string; options: Record<string, unknown> }[], opts: Record<string, unknown>): void;
  addNotes(notes: string): void;
}
interface PptxPres {
  layout: string;
  title: string;
  company: string;
  addSlide(): PptxSlide;
  write(opts: { outputType: 'nodebuffer' }): Promise<unknown>;
}

const INK = '0D0D12';
const MUTED = '666D80';
const ACCENT = 'F97316';

export async function buildPptx(spec: DeckSpec): Promise<Uint8Array> {
  const mod = PptxGenJS as unknown as { default?: unknown };
  const Ctor = (mod.default ?? PptxGenJS) as unknown as new () => PptxPres;
  const pres = new Ctor();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = spec.title;
  pres.company = 'WorkCraft';
  spec.slides.forEach((s, i) => {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape('rect', { x: 0.6, y: 0.55, w: 0.12, h: 0.75, fill: { color: ACCENT }, line: { color: ACCENT } });
    slide.addText(s.title, { x: 0.9, y: 0.45, w: 11.6, h: 0.95, fontFace: 'Inter', fontSize: i === 0 && !s.bullets.length ? 40 : 30, bold: true, color: INK });
    if (s.bullets.length) {
      slide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: { indent: 18 }, breakLine: true } })),
        { x: 0.9, y: 1.65, w: 11.4, h: 5.2, fontFace: 'Inter', fontSize: 20, color: INK, valign: 'top', paraSpaceAfter: 10 }
      );
    }
    slide.addText(`${i + 1}`, { x: 12.2, y: 6.95, w: 0.6, h: 0.35, fontFace: 'DM Mono', fontSize: 11, color: MUTED, align: 'right' });
    if (s.notes) slide.addNotes(s.notes);
  });
  const out = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- Sample presentation

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Sample presentation for the sample project: title, agenda, bar chart made of shapes,
 * KPI tiles, next steps and closing. Charts are rectangles and text, so they look
 * the same in DeckCraft, PowerPoint and LibreOffice.
 */
export async function buildSampleDeck(data: { quarters: string[]; revenue: number[]; costs: number[] }): Promise<Uint8Array> {
  const mod = PptxGenJS as unknown as { default?: unknown };
  const Ctor = (mod.default ?? PptxGenJS) as unknown as new () => PptxPres;
  const pres = new Ctor();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = 'Quarterly report';
  pres.company = 'WorkCraft';
  const PAPER = 'F4F5F7';
  const font = 'Inter';
  const total = data.revenue.reduce((a, b) => a + b, 0);
  const result = total - data.costs.reduce((a, b) => a + b, 0);
  const margin = (result / total) * 100;
  const growth = ((data.revenue.at(-1)! - data.revenue[0]!) / data.revenue[0]!) * 100;

  const frame = (title: string, eyebrow: string, n: number) => {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addText(eyebrow.toUpperCase(), { x: 0.9, y: 0.35, w: 8, h: 0.35, fontFace: 'DM Mono', fontSize: 11, color: MUTED, charSpacing: 1 });
    slide.addShape('rect', { x: 0.6, y: 0.75, w: 0.12, h: 0.7, fill: { color: ACCENT }, line: { color: ACCENT } });
    slide.addText(title, { x: 0.9, y: 0.65, w: 11.6, h: 0.9, fontFace: font, fontSize: 30, bold: true, color: INK });
    slide.addText(String(n), { x: 12.2, y: 6.95, w: 0.6, h: 0.35, fontFace: 'DM Mono', fontSize: 11, color: MUTED, align: 'right' });
    return slide;
  };

  // 1 Title
  const title = pres.addSlide();
  title.background = { color: PAPER };
  title.addShape('rect', { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: ACCENT }, line: { color: ACCENT } });
  title.addText('SAMPLE PROJECT · DECKCRAFT', { x: 1.1, y: 2.0, w: 10, h: 0.4, fontFace: 'DM Mono', fontSize: 13, color: MUTED, charSpacing: 1 });
  title.addText([
    { text: 'Quarterly report ', options: { color: INK } },
    { text: '2026', options: { color: MUTED } },
  ], { x: 1.1, y: 2.5, w: 11, h: 1.3, fontFace: font, fontSize: 54, bold: true });
  title.addText('Revenue, costs and result from /sheets/finances.xlsx', { x: 1.1, y: 3.9, w: 11, h: 0.6, fontFace: font, fontSize: 20, color: INK });
  title.addNotes('This presentation was generated with the sample project. Edit it in DeckCraft, or read and extend it in the chat with /read-slides and /create-slide.');

  // 2 Agenda
  const agenda = frame('Agenda', 'Overview', 2);
  agenda.addText(
    ['Revenue per quarter', 'Key figures of the year', 'Next steps'].map((t, i) => ({ text: `${i + 1}   ${t}`, options: { breakLine: true } })),
    { x: 0.9, y: 1.9, w: 11, h: 3.5, fontFace: font, fontSize: 26, color: INK, valign: 'top', paraSpaceAfter: 18 }
  );

  // 3 Bar chart made of shapes
  const chart = frame('Revenue per quarter', 'Trend', 3);
  const max = Math.max(...data.revenue);
  const baseY = 6.3;
  const height = 3.9;
  data.revenue.forEach((v, i) => {
    const h = (v / max) * height;
    const x = 1.6 + i * 2.7;
    chart.addShape('rect', { x, y: baseY - h, w: 1.6, h, fill: { color: i === data.revenue.length - 1 ? ACCENT : 'FDBA74' }, line: { color: 'FFFFFF' } });
    chart.addText(`€${fmt(v)}`, { x: x - 0.3, y: baseY - h - 0.45, w: 2.2, h: 0.4, fontFace: 'DM Mono', fontSize: 14, color: INK, align: 'center' });
    chart.addText(data.quarters[i]!, { x, y: baseY + 0.1, w: 1.6, h: 0.4, fontFace: font, fontSize: 16, bold: true, color: INK, align: 'center' });
  });
  chart.addShape('line', { x: 1.2, y: baseY, w: 10.6, h: 0, line: { color: 'C9CCD3', width: 1 } });
  chart.addNotes(`Revenue grew from €${fmt(data.revenue[0]!)} to €${fmt(data.revenue.at(-1)!)}.`);

  // 4 Key figure tiles
  const kpi = frame('Key figures of the year', 'Result', 4);
  const tiles: [string, string][] = [
    ['Annual revenue', `€${fmt(total)}`],
    ['Result', `€${fmt(result)}`],
    ['Margin', `${margin.toFixed(1)} %`],
    ['Growth Q1 to Q4', `+${growth.toFixed(1)} %`],
  ];
  tiles.forEach(([label, value], i) => {
    const x = 0.9 + (i % 2) * 5.9;
    const y = 1.9 + Math.floor(i / 2) * 2.4;
    kpi.addShape('roundRect', { x, y, w: 5.5, h: 2.0, fill: { color: PAPER }, line: { color: 'E4E6EB' }, rectRadius: 0.15 });
    kpi.addText(label.toUpperCase(), { x: x + 0.35, y: y + 0.3, w: 4.8, h: 0.4, fontFace: 'DM Mono', fontSize: 12, color: MUTED });
    kpi.addText(value, { x: x + 0.35, y: y + 0.8, w: 4.8, h: 0.9, fontFace: font, fontSize: 34, bold: true, color: i === 2 ? ACCENT : INK });
  });

  // 5 Next steps
  const next = frame('Next steps', 'Outlook', 5);
  next.addText(
    ['Keep the margin above 37 percent', 'Check costs per quarter every month', 'Extend the report in WordCraft (/documents)', 'Update the forecast in GridCraft'].map((t) => ({ text: t, options: { bullet: { indent: 18 }, breakLine: true } })),
    { x: 0.9, y: 1.9, w: 11.4, h: 4.5, fontFace: font, fontSize: 22, color: INK, valign: 'top', paraSpaceAfter: 12 }
  );
  next.addNotes('Tip: in the AI chat, "/create-slide" adds more slides to this file. DeckCraft shows them right away.');

  // 6 Closing
  const end = pres.addSlide();
  end.background = { color: INK };
  end.addText([
    { text: 'Thank you. ', options: { color: 'FFFFFF' } },
    { text: 'Questions?', options: { color: 'A0A6B5' } },
  ], { x: 0.9, y: 2.8, w: 11.5, h: 1.2, fontFace: font, fontSize: 48, bold: true });
  end.addText('Made with WorkCraft · DeckCraft', { x: 0.9, y: 4.1, w: 11.5, h: 0.5, fontFace: 'DM Mono', fontSize: 14, color: 'A0A6B5' });

  const out = (await pres.write({ outputType: 'nodebuffer' })) as Buffer;
  return new Uint8Array(out);
}

export function readPptxText(data: Uint8Array): { slide: number; texts: string[] }[] {
  if (!data.byteLength) return []; // an empty file has no slides
  const files = unzipSync(data);
  return Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((n, i) => {
      const xml = strFromU8(files[n]!);
      const paras = xml.split(/<a:p>|<a:p /).slice(1).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]!).join('')).filter(Boolean);
      return { slide: i + 1, texts: paras.map((t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')) };
    });
}
