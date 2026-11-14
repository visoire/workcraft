// Valid empty files for every format the workspace opens. A new "file.xlsx" must be a real package,
// not 0 bytes: the apps and the assistant tools cannot read an empty zip ("Could not find EOCD").
// No DOM and no Node: used by the project tree, the panels (browser mode too) and the tests.
import { strToU8, zipSync } from 'fflate';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006';
const CT = 'application/vnd.openxmlformats-officedocument';

const rels = (items: [string, string, string][]) => `${XML}<Relationships xmlns="${REL_NS}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${OD}/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const types = (overrides: [string, string][]) => `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('')}</Types>`;
const pack = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

export function blankXlsx(): Uint8Array {
  const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return pack({
    '[Content_Types].xml': types([
      ['/xl/workbook.xml', `${CT}.spreadsheetml.sheet.main+xml`],
      ['/xl/worksheets/sheet1.xml', `${CT}.spreadsheetml.worksheet+xml`],
      ['/xl/styles.xml', `${CT}.spreadsheetml.styles+xml`],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `${XML}<workbook xmlns="${S}" xmlns:r="${OD}/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'styles', 'styles.xml']]),
    'xl/worksheets/sheet1.xml': `${XML}<worksheet xmlns="${S}"><sheetData/></worksheet>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="${S}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  });
}

export function blankDocx(): Uint8Array {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return pack({
    '[Content_Types].xml': types([
      ['/word/document.xml', `${CT}.wordprocessingml.document.main+xml`],
      ['/word/styles.xml', `${CT}.wordprocessingml.styles+xml`],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/_rels/document.xml.rels': rels([['rId1', 'styles', 'styles.xml']]),
    'word/document.xml': `${XML}<w:document xmlns:w="${W}"><w:body><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`,
  });
}

export function blankPptx(): Uint8Array {
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const ns = `xmlns:a="${A}" xmlns:r="${OD}/relationships" xmlns:p="${P}"`;
  const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const clr = (name: string, hex: string) => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`;
  const fill3 = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3);
  const line3 = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'.repeat(3);
  const theme = `${XML}<a:theme xmlns:a="${A}" name="WorkCraft"><a:themeElements><a:clrScheme name="WorkCraft"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${clr('dk2', '1F2937')}${clr('lt2', 'F3F4F6')}${clr('accent1', '3B82F6')}${clr('accent2', '10B981')}${clr('accent3', 'F97316')}${clr('accent4', '14B8A6')}${clr('accent5', '6B7280')}${clr('accent6', '111827')}${clr('hlink', '2563EB')}${clr('folHlink', '6B7280')}</a:clrScheme><a:fontScheme name="WorkCraft"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="WorkCraft"><a:fillStyleLst>${fill3}</a:fillStyleLst><a:lnStyleLst>${line3}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fill3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  return pack({
    '[Content_Types].xml': types([
      ['/ppt/presentation.xml', `${CT}.presentationml.presentation.main+xml`],
      ['/ppt/slideMasters/slideMaster1.xml', `${CT}.presentationml.slideMaster+xml`],
      ['/ppt/slideLayouts/slideLayout1.xml', `${CT}.presentationml.slideLayout+xml`],
      ['/ppt/slides/slide1.xml', `${CT}.presentationml.slide+xml`],
      ['/ppt/theme/theme1.xml', `${CT}.theme+xml`],
    ]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `${XML}<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'slide', 'slides/slide1.xml'], ['rId3', 'theme', 'theme/theme1.xml']]),
    'ppt/slideMasters/slideMaster1.xml': `${XML}<p:sldMaster ${ns}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${group}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]),
    'ppt/slideLayouts/slideLayout1.xml': `${XML}<p:sldLayout ${ns} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/slides/slide1.xml': `${XML}<p:sld ${ns}><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]),
    'ppt/theme/theme1.xml': theme,
  });
}

/** One blank A4 page. The cross-reference table is computed, so the file is valid for every reader. */
export function blankPdf(): Uint8Array {
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<<>>>>'];
  let out = '%PDF-1.4\n';
  const at: number[] = [];
  objs.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

const BLANK: Record<string, () => Uint8Array> = { xlsx: blankXlsx, docx: blankDocx, pptx: blankPptx, pdf: blankPdf };

/** True for formats that must never be an empty file. */
export const needsBlank = (ext: string): boolean => ext.toLowerCase() in BLANK;

/** The content of a new, empty file: a valid package for office files and PDFs, an empty string otherwise. */
export function blankFor(ext: string): Uint8Array | string {
  const make = BLANK[ext.toLowerCase()];
  return make ? make() : '';
}
