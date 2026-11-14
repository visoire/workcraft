// Simple home-network share: a temporary read-only link to the current project, without cloud.
// A separate small server (port WORKCRAFT_SHARE_PORT, default 5179) listens on the Wi-Fi only
// while a share is active. It knows nothing but GET requests below /s/<token>/: a gallery of the
// files, a preview page per file (text of documents, sheets, slides and PDFs) and, when allowed,
// the original file. No API, no MCP, no WebSocket, no writes. Links expire (default 60 minutes)
// and can be revoked at once. Every first visit of a device lands in the audit log.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { extname } from 'node:path';
import { lanAddresses } from './lan.js';
import { getProject, listTree, readProjectFile } from './projects.js';
import { normProjectPath } from './paths.js';
import { fileToMarkdown } from './export.js';
import { mdToHtml, escHtml } from '../core/md.js';
import { auditRecord } from './audit.js';
import { log } from './logs.js';

export const SHARE_PORT = Number(process.env.WORKCRAFT_SHARE_PORT || 5179);

export interface Share {
  token: string;
  projectId: string;
  projectName: string;
  created: string;
  expires: string;
  download: boolean;
  visits: number;
  devices: string[];
}

const shares = new Map<string, Share>();
let server: Server | null = null;
let listening = false;
let lastError: string | undefined;
const hits = new Map<string, { n: number; reset: number }>();

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8' };

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function findShare(token: string): Share | null {
  for (const s of shares.values()) if (sameToken(s.token, token)) return Date.parse(s.expires) > Date.now() ? s : null;
  return null;
}

const CSS = `:root{--bg:#fff;--fg:#0f1115;--mut:#5b6170;--line:#e6e8ee;--card:#fafbfc;--acc:#335cff}@media(prefers-color-scheme:dark){:root{--bg:#121214;--fg:#eef0f4;--mut:#9aa1ad;--line:#2a2d33;--card:#1a1b1f}}*{box-sizing:border-box}body{margin:0;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--fg)}main{max-width:1000px;margin:0 auto;padding:28px 16px 60px}a{color:var(--acc)}.bar{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--mut);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:18px}.dot{width:8px;height:8px;border-radius:50%;background:#10b981}ul{list-style:none;padding:0;margin:0;border:1px solid var(--line);border-radius:12px;overflow:hidden}li{border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;padding:10px 14px}li:first-child{border-top:0}li span{color:var(--mut);font-size:13px;white-space:nowrap}article{border:1px solid var(--line);border-radius:12px;padding:20px;background:var(--card);overflow:auto}pre{overflow:auto;background:rgba(127,127,127,.12);padding:10px;border-radius:8px}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid var(--line);padding:3px 7px}img{max-width:100%}`;
const html = (title: string, body: string, s: Share) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escHtml(title)}</title><style>${CSS}</style></head><body><main><div class="bar"><span class="dot"></span>Read-only share of <b>${escHtml(s.projectName)}</b> from WorkCraft · until ${escHtml(new Date(s.expires).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}</div>${body}</main></body></html>`;

const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

async function handle(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: string | Uint8Array, type = 'text/html; charset=utf-8', extra: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'none'", ...extra });
    res.end(body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Read-only share', 'text/plain');
  const ip = req.socket.remoteAddress || '?';
  const h = hits.get(ip) || { n: 0, reset: Date.now() + 60_000 };
  if (h.reset < Date.now()) (h.n = 0), (h.reset = Date.now() + 60_000);
  if (++h.n > 240) return send(429, 'Too many requests', 'text/plain');
  hits.set(ip, h);
  const url = new URL(req.url || '/', 'http://share');
  const m = url.pathname.match(/^\/s\/([A-Za-z0-9_-]{20,64})(\/.*)?$/);
  const s = m ? findShare(m[1]!) : null;
  if (!s) return send(404, '<!doctype html><title>Not available</title><p style="font-family:system-ui;padding:24px">This share does not exist or has expired.</p>');
  s.visits++;
  if (!s.devices.includes(ip)) {
    s.devices.push(ip);
    auditRecord({ kind: 'share', url: `http://${ip}`, local: true, bytes: 0, status: 'ok', note: `device ${ip} opened the share of ${s.projectName}` });
  }
  const base = `/s/${s.token}`;
  const sub = m![2] || '/';
  let root: string;
  try {
    root = getProject(s.projectId).root;
  } catch {
    return send(410, 'The project no longer exists.', 'text/plain');
  }
  try {
    if (sub === '/' || sub === '') {
      const files = (await listTree(root)).filter((e) => e.kind === 'file');
      const list = files.map((f) => `<li><a href="${base}/view?path=${encodeURIComponent(f.path)}">${escHtml(f.path)}</a><span>${fmt(f.size)}</span></li>`).join('');
      return send(200, html(s.projectName, `<h1>${escHtml(s.projectName)}</h1><p style="color:var(--mut)">${files.length} files</p><ul>${list || '<li>Empty project</li>'}</ul>`, s));
    }
    const path = normProjectPath(url.searchParams.get('path') || '');
    if (path === '/' || path.split('/').some((x) => x === '.workcraft' || x === '.git')) return send(404, 'Not found', 'text/plain');
    const data = await readProjectFile(root, path);
    if (sub === '/view') {
      const e = extname(path).slice(1).toLowerCase();
      const raw = `${base}/raw?path=${encodeURIComponent(path)}`;
      const preview = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e) ? `<img src="${raw}" alt="">` : mdToHtml(await fileToMarkdown(path, data));
      const dl = s.download ? `<p><a href="${raw}" download>Download the original (${fmt(data.byteLength)})</a></p>` : '';
      return send(200, html(path, `<p><a href="${base}/">← All files</a></p><h1>${escHtml(path.split('/').pop())}</h1>${dl}<article>${preview}</article>`, s));
    }
    if (sub === '/raw') {
      const e = extname(path).slice(1).toLowerCase();
      const image = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e);
      if (!s.download && !image) return send(403, 'Downloads are switched off for this share.', 'text/plain');
      return send(200, data, MIME[e] || 'application/octet-stream', image ? {} : { 'content-disposition': `attachment; filename="${encodeURIComponent(path.split('/').pop()!)}"` });
    }
  } catch (e) {
    return send(404, escHtml((e as Error).message), 'text/plain; charset=utf-8');
  }
  return send(404, 'Not found', 'text/plain');
}

async function ensureServer(): Promise<void> {
  if (server && listening) return;
  server = createServer((req, res) => void handle(req, res).catch(() => res.end()));
  await new Promise<void>((resolve) => {
    server!.once('error', (e) => {
      lastError = `Port ${SHARE_PORT}: ${(e as Error).message}`;
      log('error', 'share', lastError);
      listening = false;
      resolve();
    });
    server!.listen(SHARE_PORT, '0.0.0.0', () => {
      listening = true;
      lastError = undefined;
      log('info', 'share', `Share server listens on 0.0.0.0:${SHARE_PORT}`);
      resolve();
    });
  });
  if (!listening) throw Object.assign(new Error(lastError || 'The share server did not start'), { code: 'SHARE' });
}

function stopIfIdle() {
  for (const [k, s] of shares) if (Date.parse(s.expires) <= Date.now()) shares.delete(k);
  if (!shares.size && server) {
    server.close();
    server = null;
    listening = false;
    log('info', 'share', 'Share server stopped (no active share)');
  }
}
setInterval(stopIfIdle, 30_000).unref();

const view = (s: Share) => ({ ...s, urls: lanAddresses().map((a) => `http://${a}:${SHARE_PORT}/s/${s.token}/`) });

export async function createShare(projectId: string, minutes = 60, download = true) {
  const { meta } = getProject(projectId);
  await ensureServer();
  const s: Share = { token: randomBytes(24).toString('base64url'), projectId, projectName: meta.name, created: new Date().toISOString(), expires: new Date(Date.now() + Math.min(24 * 60, Math.max(5, minutes)) * 60_000).toISOString(), download, visits: 0, devices: [] };
  shares.set(s.token, s);
  auditRecord({ kind: 'share', url: `http://0.0.0.0:${SHARE_PORT}`, local: true, bytes: 0, status: 'ok', note: `read-only share of ${meta.name} for ${minutes} minutes` });
  return view(s);
}

export function listShares() {
  stopIfIdle();
  return { port: SHARE_PORT, running: listening, error: lastError, addresses: lanAddresses(), shares: [...shares.values()].map(view) };
}

export function revokeShare(token: string): boolean {
  const ok = shares.delete(token);
  stopIfIdle();
  return ok;
}

export function revokeAll(): void {
  shares.clear();
  stopIfIdle();
}
