// GridCraft tools in the backend: read and write spreadsheets (.xlsx through exceljs, .csv).
import ExcelJS from 'exceljs';
import { Sheet, parseRef, refOf, display, type Scalar } from './formula.js';

export interface SheetData {
  sheets: string[];
  sheet: string;
  range: string;
  rows: (string | number | boolean | null)[][];
  formulas: number;
}

type CellValue = string | number | boolean | null;

// ---------------------------------------------------------------- CSV
export function parseCsv(text: string): { cells: Record<string, string>; delim: string } {
  const first = text.split(/\r?\n/)[0] || '';
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : first.includes('\t') ? '\t' : ',';
  const cells: Record<string, string> = {};
  let row = 0;
  let col = 0;
  let cur = '';
  let q = false;
  const put = () => {
    if (cur !== '') cells[refOf(col, row)] = cur;
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      put();
      col++;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      put();
      row++;
      col = 0;
    } else cur += ch;
  }
  put();
  return { cells, delim };
}

function toCsv(cells: Record<string, string>, delim = ','): string {
  let maxR = -1;
  let maxC = -1;
  for (const ref of Object.keys(cells)) {
    const p = parseRef(ref);
    if (!p) continue;
    maxR = Math.max(maxR, p.r);
    maxC = Math.max(maxC, p.c);
  }
  const lines: string[] = [];
  for (let r = 0; r <= maxR; r++) {
    const row: string[] = [];
    for (let c = 0; c <= maxC; c++) {
      let s = cells[refOf(c, r)] ?? '';
      if (s.includes(delim) || s.includes('"') || s.includes('\n')) s = '"' + s.replace(/"/g, '""') + '"';
      row.push(s);
    }
    lines.push(row.join(delim));
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- XLSX
function cellRaw(cell: ExcelJS.Cell): { raw: string; cached?: CellValue } | null {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean') return { raw: String(v) };
  if (typeof v === 'string') return { raw: v };
  if (v instanceof Date) return { raw: v.toISOString().slice(0, 10) };
  const o = v as { formula?: string; sharedFormula?: string; result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
  const f = o.formula ?? (o.sharedFormula ? cell.formula : undefined);
  if (f) {
    const res = o.result as unknown;
    const cached = res === undefined || res === null ? undefined : typeof res === 'object' ? ((res as { error?: string }).error ?? undefined) : (res as CellValue);
    return { raw: '=' + String(f).replace(/_xlfn\.(_xlws\.)?/g, ''), cached };
  }
  if (o.richText) return { raw: o.richText.map((t) => t.text).join('') };
  if (o.text !== undefined) return { raw: String(o.text) };
  if (o.error) return { raw: o.error };
  return { raw: String(v) };
}

async function loadWorkbook(data: Uint8Array | null): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  if (data && data.byteLength) await wb.xlsx.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  return wb;
}

export async function readSheet(data: Uint8Array, ext: string, opts: { sheet?: string; range?: string }): Promise<SheetData> {
  let raw: Record<string, string> = {};
  const cached: Record<string, CellValue> = {};
  let sheets = ['Sheet1'];
  let sheetName = 'Sheet1';
  if (ext === 'csv' || ext === 'tsv') raw = parseCsv(new TextDecoder().decode(data)).cells;
  else {
    const wb = await loadWorkbook(data);
    sheets = wb.worksheets.map((w) => w.name);
    const ws = opts.sheet ? wb.getWorksheet(opts.sheet) : wb.worksheets[0];
    // A workbook without sheets (an empty file) reads as one empty Sheet1; only a named sheet can be missing
    if (!ws && (opts.sheet || wb.worksheets.length)) throw new Error(`Sheet ${opts.sheet ?? '(first)'} not found. Available: ${sheets.join(', ') || 'none'}`);
    if (!sheets.length) sheets = ['Sheet1'];
    if (ws) {
      sheetName = ws.name;
      ws.eachRow({ includeEmpty: false }, (row) =>
        row.eachCell({ includeEmpty: false }, (cell) => {
          const c = cellRaw(cell);
          if (!c) return;
          raw[cell.address] = c.raw;
          if (c.cached !== undefined) cached[cell.address] = c.cached;
        })
      );
    }
  }
  const sheet = new Sheet(raw);
  const values: Record<string, Scalar> = { ...sheet.values };
  // Prefer the file's values when the engine does not know a function
  for (const [ref, v] of Object.entries(cached)) {
    const own = values[ref];
    if (own === undefined || (own && typeof own === 'object' && 'err' in own && own.err === '#NAME?')) values[ref] = v;
  }
  let maxR = 0;
  let maxC = 0;
  for (const ref of Object.keys(values)) {
    const p = parseRef(ref);
    if (!p) continue;
    maxR = Math.max(maxR, p.r);
    maxC = Math.max(maxC, p.c);
  }
  let r0 = 0;
  let c0 = 0;
  let r1 = Math.min(maxR, 499);
  let c1 = Math.min(maxC, 49);
  if (opts.range) {
    const [a, b] = opts.range.toUpperCase().split(':').map((x) => parseRef(x));
    if (!a) throw new Error(`Invalid range ${opts.range}`);
    const e = b || a;
    r0 = Math.min(a.r, e.r);
    c0 = Math.min(a.c, e.c);
    r1 = Math.max(a.r, e.r);
    c1 = Math.max(a.c, e.c);
  }
  const rows: CellValue[][] = [];
  for (let r = r0; r <= r1; r++) {
    const line: CellValue[] = [];
    for (let c = c0; c <= c1; c++) line.push(display(values[refOf(c, r)] ?? null));
    rows.push(line);
  }
  while (rows.length && rows[rows.length - 1]!.every((v) => v === null || v === '')) rows.pop();
  return { sheets, sheet: sheetName, range: `${refOf(c0, r0)}:${refOf(c1, r0 + Math.max(0, rows.length - 1))}`, rows, formulas: Object.values(raw).filter((v) => v.startsWith('=')).length };
}

export function sheetToMarkdown(d: SheetData, maxRows = 80): string {
  if (!d.rows.length) return `Sheet ${d.sheet} is empty.`;
  const fmt = (v: CellValue) => (v === null ? '' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v)).replace(/\|/g, '\\|');
  const width = Math.max(...d.rows.map((r) => r.length));
  const start = parseRef(d.range.split(':')[0]!)!;
  const head = Array.from({ length: width }, (_, i) => refOf(start.c + i, 0).replace(/\d+$/, ''));
  const lines = [`| # | ${head.join(' | ')} |`, `|---|${head.map(() => '---').join('|')}|`];
  d.rows.slice(0, maxRows).forEach((r, i) => lines.push(`| ${start.r + i + 1} | ${Array.from({ length: width }, (_, j) => fmt(r[j] ?? null)).join(' | ')} |`));
  if (d.rows.length > maxRows) lines.push(`… ${d.rows.length - maxRows} more rows`);
  return `Sheet ${d.sheet} (${d.range}, sheets: ${d.sheets.join(', ')}, ${d.formulas} formulas)\n\n${lines.join('\n')}`;
}

export async function writeSheet(
  existing: Uint8Array | null,
  ext: string,
  opts: { sheet?: string; cells: Record<string, CellValue>; mode: 'merge' | 'replace' }
): Promise<Uint8Array> {
  if (ext === 'csv' || ext === 'tsv') {
    const delim = ext === 'tsv' ? '\t' : ',';
    const base = existing && opts.mode === 'merge' ? parseCsv(new TextDecoder().decode(existing)).cells : {};
    for (const [ref, v] of Object.entries(opts.cells)) {
      const key = ref.toUpperCase();
      if (v === null || v === '') delete base[key];
      else base[key] = String(v);
    }
    return new TextEncoder().encode(toCsv(base, delim));
  }
  const wb = await loadWorkbook(opts.mode === 'merge' ? existing : null);
  const name = opts.sheet || wb.worksheets[0]?.name || 'Sheet1';
  let ws = wb.getWorksheet(name);
  if (!ws) ws = wb.addWorksheet(name);
  for (const [ref, v] of Object.entries(opts.cells)) {
    const cell = ws.getCell(ref.toUpperCase());
    if (v === null || v === '') cell.value = null;
    else if (typeof v === 'string' && v.startsWith('=')) cell.value = { formula: v.slice(1) } as ExcelJS.CellFormulaValue;
    else if (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim())) cell.value = Number(v.replace(',', '.'));
    else cell.value = v;
  }
  if (!wb.creator) wb.creator = 'WorkCraft';
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
