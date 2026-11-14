// WordCraft tools in the backend: read documents (docx through mammoth) and write Markdown as .docx.
import mammoth from 'mammoth';
import { Document, HeadingLevel, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, LevelFormat, AlignmentType } from 'docx';
import { unzipSync, strFromU8 } from 'fflate';

export async function readDocument(data: Uint8Array, ext: string): Promise<string> {
  if (!data.byteLength) return ''; // an empty file is an empty document
  if (ext === 'docx') {
    const res = await (mammoth as unknown as { convertToMarkdown(i: { buffer: Buffer }): Promise<{ value: string }> }).convertToMarkdown({ buffer: Buffer.from(data) });
    return res.value.replace(/\\([.\-()#!])/g, '$1').trim() + '\n';
  }
  if (ext === 'odt') {
    const files = unzipSync(data);
    const xml = files['content.xml'] ? strFromU8(files['content.xml']) : '';
    return (
      xml
        .replace(/<text:h[^>]*text:outline-level="(\d)"[^>]*>/g, (_m, l: string) => '\n' + '#'.repeat(Number(l)) + ' ')
        .replace(/<text:p[^>]*>/g, '\n\n')
        .replace(/<text:list-item>/g, '\n- ')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim() + '\n'
    );
  }
  return new TextDecoder().decode(data);
}

// ---------------------------------------------------------------- Markdown -> docx

function runs(text: string): TextRun[] {
  const out: TextRun[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun(text.slice(last, m.index)));
    const t = m[0];
    if (t.startsWith('**') || t.startsWith('__')) out.push(new TextRun({ text: t.slice(2, -2), bold: true }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas' }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun(text.slice(last)));
  return out.length ? out : [new TextRun('')];
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

export function markdownToBlocks(md: string): (Paragraph | Table)[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: (Paragraph | Table)[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i]!;
    if (!ln.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(ln)) {
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) out.push(new Paragraph({ children: [new TextRun({ text: lines[i++]!, font: 'Consolas' })] }));
      i++;
      continue;
    }
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(new Paragraph({ heading: HEADINGS[h[1]!.length - 1], children: runs(h[2]!) }));
      i++;
      continue;
    }
    if (/^\|.*\|\s*$/.test(ln) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const rows = [cells(ln)];
      i += 2;
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      const width = Math.max(...rows.map((r) => r.length));
      out.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (r, ri) =>
              new TableRow({
                tableHeader: ri === 0,
                children: Array.from({ length: width }, (_, ci) => new TableCell({ children: [new Paragraph({ children: ri === 0 ? [new TextRun({ text: r[ci] ?? '', bold: true })] : runs(r[ci] ?? '') })] })),
              })
          ),
        })
      );
      continue;
    }
    const li = ln.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[1]!);
      out.push(new Paragraph({ children: runs(li[2]!), numbering: { reference: ordered ? 'num' : 'bullet', level: 0 } }));
      i++;
      continue;
    }
    if (/^>\s?/.test(ln)) {
      out.push(new Paragraph({ children: runs(ln.replace(/^>\s?/, '')), indent: { left: 567 }, style: 'Quote' }));
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|\s*([-*+]|\d+[.)])\s+|\||>)/.test(lines[i]!)) buf.push(lines[i++]!);
    out.push(new Paragraph({ children: runs(buf.join(' ')), spacing: { after: 120 } }));
  }
  return out;
}

export async function markdownToDocx(md: string, title = 'Dokument'): Promise<Uint8Array> {
  const doc = new Document({
    creator: 'WorkCraft',
    title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        { reference: 'bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections: [{ children: markdownToBlocks(md) }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
