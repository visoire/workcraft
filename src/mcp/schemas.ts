// Zod schemas of all MCP tools. One source for:
// - the MCP server in the backend (registerTool, validation in the SDK),
// - the orchestrator in the frontend (check before every call, correction form),
// - the / commands in the chat and the tool definitions for the language models.
// Texts are English (they also go to the models). The frontend switches Zod messages to German
// when the interface is German (src/mcp/orchestrator.ts).

import { z } from 'zod';
import type { ToolApp, ToolSpec } from '../chat/types.js';
import { repairJson } from '../core/json-repair.js';


const path = z.string().trim().min(1).describe('Path in the project, for example /sheets/revenue.xlsx');
const cellRef = /^[A-Za-z]{1,3}[0-9]{1,7}$/;
const rangeRef = /^[A-Za-z]{1,3}[0-9]{1,7}(:[A-Za-z]{1,3}[0-9]{1,7})?$/;
const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  app: ToolApp;
  /** server: MCP server in the backend, client: MCP server in the browser (panels) */
  side: 'server' | 'client';
  input: z.ZodObject;
  /** Call only after the user confirms */
  approval?: boolean;
  /** Argument that names the edited file (for the status card and live sync) */
  pathArg?: string;
  /** writes files (panels with this file are refreshed) */
  writes?: boolean;
}

const def = (d: ToolDef): ToolDef => d;

export const TOOL_DEFS: ToolDef[] = [
  // ---------- GridCraft ----------
  def({
    name: 'read-sheet',
    title: 'Read sheet',
    app: 'gridcraft',
    side: 'server',
    pathArg: 'path',
    description: 'Reads calculated values from a spreadsheet (.xlsx, .csv) as rows. Formulas are evaluated, dynamic arrays too.',
    input: z.object({
      path,
      sheet: z.string().optional().describe('Name of the sheet, default: first sheet'),
      range: z.string().regex(rangeRef, 'Range like A1:D20').optional().describe('Range, for example A1:D20'),
    }),
  }),
  def({
    name: 'write-sheet',
    title: 'Write sheet',
    app: 'gridcraft',
    side: 'server',
    pathArg: 'path',
    writes: true,
    description: 'Writes values or formulas into a spreadsheet (.xlsx, .csv). Creates the file if it is missing. Formulas start with =.',
    input: z.object({
      path,
      sheet: z.string().optional(),
      cells: z.record(z.string().regex(cellRef, 'Cell address like B2'), cellValue).describe('Map of cell address to value, for example {"A1": "Revenue", "B1": "=SUM(B2:B9)"}'),
      mode: z.enum(['merge', 'replace']).default('merge').describe('merge adds, replace clears the sheet first'),
    }),
  }),

  // ---------- WordCraft ----------
  def({
    name: 'read-document',
    title: 'Read document',
    app: 'wordcraft',
    side: 'server',
    pathArg: 'path',
    description: 'Reads a document (.docx, .md, .txt, .odt text only) as Markdown.',
    input: z.object({ path }),
  }),
  def({
    name: 'write-document',
    title: 'Write document',
    app: 'wordcraft',
    side: 'server',
    pathArg: 'path',
    writes: true,
    description: 'Writes Markdown as a Word document (.docx) or a Markdown file (.md). Supports headings, paragraphs, lists, tables, bold and italic.',
    input: z.object({
      path,
      markdown: z.string().min(1).describe('Content in Markdown'),
      mode: z.enum(['replace', 'append']).default('replace'),
      title: z.string().optional().describe('Document title in the properties'),
    }),
  }),

  // ---------- DeckCraft ----------
  def({
    name: 'create-slide',
    title: 'Create slides',
    app: 'deckcraft',
    side: 'server',
    pathArg: 'path',
    writes: true,
    description: 'Creates one or more slides in a presentation (.pptx). With mode append, slides are added to a presentation created by WorkCraft.',
    input: z.object({
      path,
      title: z.string().optional().describe('Title of the presentation'),
      slides: z
        .array(
          z.object({
            title: z.string().min(1),
            bullets: z.array(z.string()).max(12).default([]),
            notes: z.string().optional(),
          })
        )
        .min(1)
        .max(30),
      mode: z.enum(['replace', 'append']).default('append'),
    }),
  }),
  def({
    name: 'read-slides',
    title: 'Read slides',
    app: 'deckcraft',
    side: 'server',
    pathArg: 'path',
    description: 'Reads the texts of all slides of a presentation (.pptx).',
    input: z.object({ path }),
  }),

  // ---------- PdfCraft ----------
  def({
    name: 'read-pdf',
    title: 'Read PDF',
    app: 'pdfcraft',
    side: 'server',
    pathArg: 'path',
    description: 'Reads the text of a PDF, optionally only some pages.',
    input: z.object({ path, pages: z.string().regex(/^\d+(-\d+)?(,\d+(-\d+)?)*$/, 'Pages like 1-3,5').optional() }),
  }),
  def({
    name: 'sign-pdf',
    title: 'Sign PDF',
    app: 'pdfcraft',
    side: 'server',
    pathArg: 'path',
    writes: true,
    approval: true,
    description: 'Places a visible signature block (name, date, line) on a PDF page, locally, and saves a signed copy.',
    input: z.object({
      path,
      name: z.string().min(2).describe('Name for the signature'),
      page: z.number().int().min(1).optional().describe('Page, default: last page'),
      position: z.enum(['unten-rechts', 'unten-links', 'oben-rechts']).default('unten-rechts'),
      output: z.string().optional().describe('Target path, default: <name>-signiert.pdf'),
    }),
  }),

  def({
    name: 'images-to-pdf',
    title: 'Images to PDF',
    app: 'pdfcraft',
    side: 'server',
    pathArg: 'output',
    writes: true,
    description: 'Combines images (.png, .jpg, scans or screenshots from the project, for example from /attachments) into one PDF, one image per page, for PdfCraft.',
    input: z.object({
      images: z.array(z.string().min(1)).min(1).max(60).describe('Image paths in the project, in page order'),
      output: z.string().min(1).describe('Target path, for example /pdf/scan.pdf'),
      title: z.string().optional(),
    }),
  }),

  // ---------- Project and code ----------
  def({
    name: 'list-files',
    title: 'List files',
    app: 'project',
    side: 'server',
    description: 'Lists files and folders in the project.',
    input: z.object({ dir: z.string().default('/') }),
  }),
  def({
    name: 'search-files',
    title: 'Search files',
    app: 'project',
    side: 'server',
    description: 'Searches text in the text and code files of the project.',
    input: z.object({ query: z.string().min(2), dir: z.string().default('/') }),
  }),
  def({
    name: 'read-file',
    title: 'Read file',
    app: 'code',
    side: 'server',
    pathArg: 'path',
    description: 'Reads a text or code file.',
    input: z.object({ path }),
  }),
  def({
    name: 'write-file',
    title: 'Write file',
    app: 'code',
    side: 'server',
    pathArg: 'path',
    writes: true,
    description: 'Writes a text or code file and creates folders.',
    input: z.object({ path, content: z.string() }),
  }),

  def({
    name: 'search-project',
    title: 'Search project',
    app: 'project',
    side: 'server',
    description: 'Full-text and semantic search across all project files (Word, Excel, PowerPoint, PDF, Markdown, code) and the chats. Returns the best passages with path and place (page, slide, sheet rows). Use it to find content by meaning, for example "the part with the revenue forecast".',
    input: z.object({
      query: z.string().min(2).describe('What to look for, in your own words'),
      mode: z.enum(['hybrid', 'text', 'semantic']).default('hybrid').describe('hybrid uses embeddings when they are switched on'),
      limit: z.number().int().min(1).max(20).default(6),
    }),
  }),
  def({
    name: 'remember',
    title: 'Remember',
    app: 'project',
    side: 'server',
    description: 'Saves a short note or decision in the project memory. It comes back as context in later chats of this project. Use it for decisions, preferences and facts the user wants kept.',
    input: z.object({ note: z.string().min(3).max(1200).describe('One clear sentence, for example "Prices in the proposal are net, without VAT"') }),
  }),
  def({
    name: 'file-history',
    title: 'File history',
    app: 'project',
    side: 'server',
    pathArg: 'path',
    description: 'Shows the version history of a file and where it came from: which tool step wrote it, from which input files, in which chat.',
    input: z.object({ path }),
  }),

  // ---------- Terminal ----------
  def({
    name: 'run-command',
    title: 'Run command',
    app: 'terminal',
    side: 'server',
    approval: true,
    description: 'Runs a shell command in the project folder (time limit 60 s) and returns the output. Needs the user to confirm.',
    input: z.object({ command: z.string().min(1), cwd: z.string().default('/') }),
  }),

  // ---------- Panels (MCP server in the browser) ----------
  def({
    name: 'open-panel',
    title: 'Open panel',
    app: 'workspace',
    side: 'client',
    pathArg: 'path',
    description: 'Opens a tool panel (wordcraft, gridcraft, deckcraft, pdfcraft, code, terminal) and optionally a file in it.',
    input: z.object({ app: z.enum(['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft', 'code', 'terminal']), path: z.string().optional() }),
  }),
  def({
    name: 'panel-status',
    title: 'Panel status',
    app: 'workspace',
    side: 'client',
    description: 'State of a panel: open file, loaded, minimized, unsaved changes.',
    input: z.object({ app: z.enum(['wordcraft', 'gridcraft', 'deckcraft', 'pdfcraft', 'code', 'terminal']) }),
  }),

  // ---------- Skills (agentskills.io format; the 13 artcraft-skills ship with WorkCraft) ----------
  def({
    name: 'list-skills',
    title: 'List skills',
    app: 'project',
    side: 'server',
    description: 'Lists the installed skills (name and what each is for). Skills explain how to drive an app or a task: commands, file formats, pitfalls.',
    input: z.object({}),
  }),
  def({
    name: 'read-skill',
    title: 'Read skill',
    app: 'project',
    side: 'server',
    description: 'Reads a skill before you use the app or task it describes. Without file it returns SKILL.md and lists the extra files (references/...); pass file to read one of them.',
    input: z.object({ name: z.string().min(2).describe('Skill name, for example wordcraft or photocraft'), file: z.string().optional().describe('A file inside the skill, for example references/commands.md') }),
  }),

  // ---------- Cloud (Google Drive, connected in Settings, Cloud) ----------
  def({
    name: 'cloud-list',
    title: 'List cloud files',
    app: 'project',
    side: 'server',
    description: 'Lists files in the connected Google Drive: the files of a folder (folder id, default the top level) or a search by name. Includes Google Docs, Sheets and Slides. Returns id, name, kind (doc, sheet, slides, folder, file) and link.',
    input: z.object({ folder: z.string().optional().describe('Drive folder id'), query: z.string().optional().describe('Part of a file name'), limit: z.number().int().min(1).max(100).default(30) }),
  }),
  def({
    name: 'cloud-import',
    title: 'Import from cloud',
    app: 'project',
    side: 'server',
    writes: true,
    pathArg: 'to',
    description: 'Copies a file from Google Drive into the project. Google Docs become .docx, Sheets .xlsx and Slides .pptx; other files are copied as they are. Without "to" the file goes into /documents, /sheets, /presentations or /pdf by type.',
    input: z.object({ id: z.string().min(5).describe('Drive file id from cloud-list'), to: z.string().optional().describe('Path in the project, for example /documents/plan.docx') }),
  }),
  def({
    name: 'cloud-export',
    title: 'Send to cloud',
    app: 'project',
    side: 'server',
    approval: true,
    pathArg: 'path',
    description: 'Uploads a project file to Google Drive (folder WorkCraft/exports unless you give a Drive folder id). With convert, .docx, .xlsx and .pptx become native Google Docs, Sheets and Slides. Needs the user to confirm.',
    input: z.object({ path, folder: z.string().optional().describe('Drive folder id'), convert: z.boolean().default(false) }),
  }),

  // ---------- Ecosystems (the workspace's own tools; the Craft and independent apps of src/ecosystems/catalog.json) ----------
  def({
    name: 'list-craft-apps',
    title: 'List Craft apps',
    app: 'workspace',
    side: 'client',
    description: 'Lists the apps (ArtCraft, community, independent): id, kind, origin, ecosystems, version, web build here or not, and the active ecosystem. Filter by type, ecosystem, origin or available; app gives one app in full. Use it to pick an app for a file type.',
    input: z.object({
      type: z.string().optional().describe('Only apps that read this file type, for example png'),
      ecosystem: z.string().optional().describe('Only the apps of this ecosystem id, for example imaging or music'),
      origin: z.enum(['artcraft', 'community', 'independent']).optional().describe('Only apps of one origin'),
      available: z.boolean().optional().describe('true: only apps with a web build in this workspace'),
      app: z.string().optional().describe('One app by id or name: full detail with its file types and licence'),
    }),
  }),
  def({
    name: 'open-in-app',
    title: 'Open in app',
    app: 'workspace',
    side: 'client',
    pathArg: 'path',
    description: 'Opens a project file in an app panel of any ecosystem (photocraft, mailcraft, transit, ...). The app must read the file type and have a web build here; otherwise the answer says which apps can and how to get this one.',
    input: z.object({ app: z.string().min(2).describe('App id or name, for example photocraft'), path: z.string().optional().describe('Project file; without it the app opens empty') }),
  }),
  def({
    name: 'recent-files',
    title: 'Recent files',
    app: 'workspace',
    side: 'client',
    description: 'The files the user opened last in this project, newest first, with the app each was opened in.',
    input: z.object({ limit: z.number().int().min(1).max(30).default(10) }),
  }),
];

export const TOOL_BY_NAME = new Map(TOOL_DEFS.map((t) => [t.name, t]));

/** JSON schema for the tool definitions of the language models. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export function toolSpecs(defs: ToolDef[] = TOOL_DEFS): ToolSpec[] {
  return defs.map((d) => ({ name: d.name, description: `[${d.title}] ${d.description}`, parameters: jsonSchemaOf(d.input) }));
}

const schemaCache = new Map<string, Record<string, unknown>>();

/**
 * Checks arguments before the call. Returns readable error texts per field. An array or object that arrived as
 * text (a model that wrote its JSON into a string, small local models do) is parsed first, repaired when needed.
 */
export function validateArgs(name: string, args: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; issues: string[] } {
  const d = TOOL_BY_NAME.get(name);
  if (!d) return { ok: false, issues: [`Unknown tool ${name}`] };
  let given = args ?? {};
  if (isObj(given)) {
    let js = schemaCache.get(name);
    if (!js) schemaCache.set(name, (js = jsonSchemaOf(d.input)));
    given = normalizeToolArgs(js, given as Record<string, unknown>, 'plain');
  }
  const r = d.input.safeParse(given);
  if (r.success) return { ok: true, data: r.data as Record<string, unknown> };
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const i of r.error.issues) {
    const where = i.path.join('.') || 'arguments';
    // One message per field: a text where an array belongs also trips the limits of the array (a second, confusing message)
    if (seen.has(where)) continue;
    seen.add(where);
    const wrongType = /expected (array|object), received string/.exec(i.message);
    if (wrongType) {
      issues.push(`${where}: expected ${wrongType[1] === 'array' ? 'an array' : 'an object'}, got text that is not valid JSON. Send the ${wrongType[1]} itself, not a string, and check that every bracket is closed.`);
      continue;
    }
    // Invalid keys (for example cell addresses): the inner message says more
    const inner = (i as { issues?: { message: string }[] }).issues?.[0]?.message;
    issues.push(i.code === 'invalid_key' && inner ? `${where}: invalid key "${String(i.path.at(-1))}" (${inner})` : `${where}: ${i.message}`);
  }
  return { ok: false, issues };
}

// ---------------------------------------------------------------- Provider-aware tool schemas
//
// One JSON Schema per MCP tool (from Zod above or from an external server), compiled per provider:
//   openai-strict     OpenAI strict function calling: additionalProperties false on every object, every
//                     property required, optional ones nullable ("type": ["string", "null"])
//   anthropic-strict  Claude strict tool use: additionalProperties false on every object, required as is
//   gemini            functionDeclarations parameters: the OpenAPI subset Gemini accepts (type, format-free
//                     description, properties, required, items, enum of strings, nullable), upper-case types
//   plain             the schema as it is (DeepSeek, Ollama, own endpoints)
// Validation keywords a target cannot express (pattern, lengths, ranges, item counts, defaults) move into
// the description, so the model still sees them; the Zod check before every call enforces them.
// Maps (z.record, additionalProperties with a schema) cannot be strict: such tools go out non-strict,
// and Gemini receives them as a JSON string that normalizeToolArgs parses back.

export type SchemaTarget = 'openai-strict' | 'anthropic-strict' | 'gemini' | 'plain';
type Json = Record<string, unknown>;

const CONSTRAINTS: [string, string][] = [
  ['minLength', 'min length'],
  ['maxLength', 'max length'],
  ['minimum', 'minimum'],
  ['maximum', 'maximum'],
  ['exclusiveMinimum', 'greater than'],
  ['exclusiveMaximum', 'less than'],
  ['multipleOf', 'multiple of'],
  ['minItems', 'min items'],
  ['maxItems', 'max items'],
  ['pattern', 'pattern'],
  ['format', 'format'],
  ['default', 'default'],
];
const DROP = new Set(['$schema', '$id', '$ref', '$defs', 'definitions', 'examples', 'title', 'readOnly', 'writeOnly', 'deprecated', 'contentEncoding', 'contentMediaType', 'propertyNames', 'unevaluatedProperties', 'const']);

const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const typesOf = (s: Json): string[] => (Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === 'string' ? [s.type] : []);
const isMap = (s: Json) => (isObj(s.additionalProperties) || s.additionalProperties === true || !!s.propertyNames) && !isObj(s.properties);

/** Is a schema expressible in strict mode (no maps, no free-form objects)? */
function strictable(s: unknown): boolean {
  if (!isObj(s)) return true;
  if (typesOf(s).includes('object') || isObj(s.properties)) {
    if (isMap(s)) return false;
    if (!isObj(s.properties) && typesOf(s).includes('object')) return false;
  }
  for (const k of ['properties']) if (isObj(s[k])) for (const v of Object.values(s[k] as Json)) if (!strictable(v)) return false;
  if (s.items && !strictable(s.items)) return false;
  for (const k of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(s[k]) && !(s[k] as unknown[]).every(strictable)) return false;
  return true;
}

/** Moves validation keywords into the description text. */
function noteConstraints(s: Json, keep: Set<string>): Json {
  const out: Json = {};
  const notes: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    const c = CONSTRAINTS.find(([key]) => key === k);
    if (c && !keep.has(k)) notes.push(`${c[1]} ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    else if (!DROP.has(k)) out[k] = v;
  }
  if (s.const !== undefined) out.enum = [s.const];
  if (notes.length) out.description = [s.description, `(${notes.join('; ')})`].filter(Boolean).join(' ');
  return out;
}

function strictNode(s: unknown, target: 'openai-strict' | 'anthropic-strict', optional = false): Json {
  if (!isObj(s)) return {};
  let n = noteConstraints(s, new Set());
  for (const k of ['anyOf', 'oneOf']) if (Array.isArray(n[k])) n[k] = (n[k] as unknown[]).map((x) => strictNode(x, target));
  if (n.oneOf) (n.anyOf = n.oneOf), delete n.oneOf;
  if (isObj(n.items)) n.items = strictNode(n.items, target);
  if (isObj(n.properties)) {
    const props = n.properties as Json;
    const required = new Set((n.required as string[] | undefined) || []);
    const out: Json = {};
    for (const [k, v] of Object.entries(props)) out[k] = strictNode(v, target, target === 'openai-strict' && !required.has(k));
    n.properties = out;
    n.additionalProperties = false;
    n.required = target === 'openai-strict' ? Object.keys(props) : [...required].filter((k) => k in props);
    if (!typesOf(n).length) n.type = 'object';
  }
  if (optional) n = nullable(n);
  return n;
}

/** OpenAI strict: an optional property becomes required but may be null. */
function nullable(n: Json): Json {
  const t = typesOf(n);
  if (t.length) {
    if (!t.includes('null')) n.type = [...t, 'null'];
    if (Array.isArray(n.enum) && !(n.enum as unknown[]).includes(null)) n.enum = [...(n.enum as unknown[]), null];
    return n;
  }
  if (Array.isArray(n.anyOf)) return { ...n, anyOf: [...(n.anyOf as unknown[]), { type: 'null' }] };
  return { anyOf: [n, { type: 'null' }] };
}

function geminiNode(s: unknown): Json {
  if (!isObj(s)) return { type: 'STRING' };
  // Unions: a nullable type becomes nullable; other unions keep their first variant
  const union = (s.anyOf || s.oneOf) as unknown[] | undefined;
  if (Array.isArray(union) && union.length) {
    const variants = union.filter((v) => !(isObj(v) && typesOf(v).join() === 'null'));
    const base = geminiNode(variants[0] ?? { type: 'string' });
    if (variants.length < union.length) base.nullable = true;
    if (variants.length > 1) base.description = [base.description || s.description, `(also accepts other forms: ${variants.length} variants)`].filter(Boolean).join(' ');
    else if (s.description && !base.description) base.description = s.description;
    return base;
  }
  // Maps cannot be described in the subset: a JSON object as a string, parsed back after the call
  if (isMap(s)) return { type: 'STRING', description: [s.description, '(JSON object as a string)'].filter(Boolean).join(' ') };
  const n = noteConstraints(s, new Set());
  delete n.additionalProperties;
  const types = typesOf(n);
  const real = types.filter((t) => t !== 'null');
  const out: Json = {};
  let type = real[0] || (isObj(n.properties) ? 'object' : n.items ? 'array' : 'string');
  if (real.length > 1) {
    // ["string", "number", "boolean"]: one type only; numbers and booleans also arrive as text
    type = 'string';
    out.description = [n.description, `(${real.join(' or ')})`].filter(Boolean).join(' ');
  } else if (n.description) out.description = n.description;
  out.type = type.toUpperCase();
  if (types.includes('null')) out.nullable = true;
  if (Array.isArray(n.enum)) {
    const vals = (n.enum as unknown[]).filter((v) => v !== null);
    if (vals.every((v) => typeof v === 'string')) {
      out.type = 'STRING';
      out.enum = vals;
    } else out.description = [out.description, `(one of ${vals.map((v) => JSON.stringify(v)).join(', ')})`].filter(Boolean).join(' ');
    if (vals.length < (n.enum as unknown[]).length) out.nullable = true;
  }
  if (type === 'object') {
    const props = isObj(n.properties) ? (n.properties as Json) : {};
    if (!Object.keys(props).length) return { type: 'STRING', description: [out.description, '(JSON object as a string)'].filter(Boolean).join(' ') };
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, geminiNode(v)]));
    const req = ((n.required as string[] | undefined) || []).filter((k) => k in props);
    if (req.length) out.required = req;
  }
  if (type === 'array') out.items = geminiNode(n.items ?? { type: 'string' });
  return out;
}

/**
 * Tool parameters for one provider target. strict: whether the tool can be sent with strict: true.
 * Gemini: parameters is undefined for tools without arguments (an empty OBJECT is rejected).
 */
export function compileToolSchema(schema: Json, target: SchemaTarget): { parameters: Json | undefined; strict: boolean } {
  if (target === 'plain') return { parameters: schema, strict: false };
  if (target === 'gemini') {
    const props = isObj(schema.properties) ? Object.keys(schema.properties as Json) : [];
    return { parameters: props.length ? geminiNode({ ...schema, type: 'object' }) : undefined, strict: false };
  }
  if (!strictable(schema)) {
    const plain = { ...schema };
    delete plain.$schema;
    return { parameters: plain, strict: false };
  }
  return { parameters: strictNode({ ...schema, type: 'object', properties: isObj(schema.properties) ? schema.properties : {} }, target), strict: true };
}

/**
 * Arguments back in the shape of the original schema before the Zod check:
 * - openai-strict: null for an optional property means "not given"
 * - gemini: a map that went out as a JSON string comes back as an object, numbers sent as text
 *   for a number-only field become numbers again
 */
export function normalizeToolArgs(schema: Json, args: Record<string, unknown>, target: SchemaTarget): Record<string, unknown> {
  const walk = (s: unknown, v: unknown): unknown => {
    if (!isObj(s)) return v;
    if (typeof v === 'string' && (isMap(s) || (typesOf(s).includes('object') && !typesOf(s).includes('string')) || (typesOf(s).includes('array') && !typesOf(s).includes('string')))) {
      // Text that holds the array or object: parsed, and repaired when a bracket is missing or a quote is wrong.
      // When even that fails it stays text and the Zod check reports it.
      const parsed = repairJson(v)?.value;
      if (parsed && typeof parsed === 'object') v = parsed;
    }
    if (typeof v === 'string' && target === 'gemini' && /^-?\d+(\.\d+)?$/.test(v.trim()) && typesOf(s).every((t) => t === 'number' || t === 'integer') && typesOf(s).length) return Number(v);
    if (isObj(v) && isObj(s.properties)) {
      const required = new Set((s.required as string[] | undefined) || []);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (val === null && target === 'openai-strict' && !required.has(k)) continue;
        out[k] = walk((s.properties as Json)[k], val);
      }
      return out;
    }
    if (Array.isArray(v) && s.items) return v.map((x) => walk(s.items, x));
    return v;
  };
  const r = walk(schema, args);
  return isObj(r) ? r : args;
}

/** Color of the tool for status cards (app accent or workspace accent). */
export const APP_ACCENT: Record<ToolApp, string> = {
  wordcraft: '#3B82F6',
  gridcraft: '#10B981',
  deckcraft: '#F97316',
  pdfcraft: '#14B8A6',
  code: '#335CFF',
  terminal: '#335CFF',
  project: '#335CFF',
  workspace: '#335CFF',
};
