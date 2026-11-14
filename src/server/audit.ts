// Audit log "What left this device?": one line per outgoing request in ~/workcraft/audit.jsonl.
// Holds metadata only (destination, provider, model, sizes, names of attached files), never
// message text or file content. Requests that stay on this computer or in the home network
// (Ollama, local endpoints, LAN share) are logged too and marked as local.

import { appendFileSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { HOME } from './paths.js';
import { config, isLocalUrl } from './config.js';

export const AUDIT_FILE = join(HOME, 'audit.jsonl');
const MAX_LINES = 5000;

export interface AuditFile {
  name: string;
  kind: string;
  /** characters of extracted text or bytes of an image */
  size: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  kind: 'ai' | 'ai-test' | 'embed' | 'share' | 'sync' | 'mcp' | 'blocked';
  /** host the request went to */
  destination: string;
  /** true: stayed on this computer or in the home network */
  local: boolean;
  provider?: string;
  model?: string;
  /** bytes of the request body */
  bytes: number;
  files: AuditFile[];
  images: number;
  tools?: number;
  status: 'ok' | 'error' | 'blocked';
  tokens?: { input: number; output: number };
  note?: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function auditRecord(e: Omit<AuditEntry, 'id' | 'at' | 'local' | 'destination' | 'files' | 'images'> & { url: string; files?: AuditFile[]; images?: number; local?: boolean }): AuditEntry {
  const { url, ...rest } = e;
  const entry: AuditEntry = { id: randomBytes(6).toString('hex'), at: new Date().toISOString(), files: [], images: 0, ...rest, destination: hostOf(url), local: e.local ?? isLocalUrl(url) };
  entry.files = (e.files || []).slice(0, 50).map((f) => ({ name: String(f.name).slice(0, 200), kind: String(f.kind).slice(0, 30), size: Math.max(0, Math.round(Number(f.size) || 0)) }));
  if (!config().privacy.audit) return entry;
  try {
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
    rotate();
  } catch (err) {
    console.warn('audit.jsonl', (err as Error).message);
  }
  return entry;
}

let checks = 0;
function rotate() {
  if (++checks % 200 !== 0) return;
  try {
    if (statSync(AUDIT_FILE).size < 2_000_000) return;
    const lines = readFileSync(AUDIT_FILE, 'utf8').trim().split('\n');
    if (lines.length > MAX_LINES) writeFileSync(AUDIT_FILE, lines.slice(-MAX_LINES).join('\n') + '\n');
  } catch {
    /* next time */
  }
}

export function auditList(opt: { cloudOnly?: boolean; limit?: number } = {}): AuditEntry[] {
  if (!existsSync(AUDIT_FILE)) return [];
  const out: AuditEntry[] = [];
  for (const line of readFileSync(AUDIT_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as AuditEntry;
      if (opt.cloudOnly && e.local) continue;
      out.push(e);
    } catch {
      /* broken line */
    }
  }
  return out.reverse().slice(0, opt.limit || 1000);
}

export function auditClear(): void {
  writeFileSync(AUDIT_FILE, '');
}

export function auditCsv(entries: AuditEntry[]): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['time', 'kind', 'destination', 'local', 'provider', 'model', 'bytes', 'files', 'images', 'status', 'input_tokens', 'output_tokens', 'note'];
  const rows = entries.map((e) => [e.at, e.kind, e.destination, e.local ? 'yes' : 'no', e.provider, e.model, e.bytes, e.files.map((f) => `${f.name} (${f.kind}, ${f.size})`).join('; '), e.images, e.status, e.tokens?.input, e.tokens?.output, e.note].map(q).join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}
