// Client for the local backend: REST, SSE (AI streaming) and WebSocket (live events).
//
// Two modes:
//   desktop  Node backend on the PC (same computer, or on the home network after pairing)
//   browser  no backend reachable (iPad on the road): src/app/offline.ts serves the same
//            /api paths from the IndexedDB. The switch happens by itself, without an error message.

import { bus } from './bus.js';
import { t as tr } from './i18n.js';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`;
  let message = res.statusText;
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    code = j.error?.code || code;
    message = j.error?.message || message;
  } catch {
    /* not JSON */
  }
  throw new ApiError(code, message, res.status);
}

export type BackendMode = 'desktop' | 'browser';
let mode: BackendMode = 'desktop';

export const backend = {
  get mode(): BackendMode {
    return mode;
  },
  get browser(): boolean {
    return mode === 'browser';
  },
  setMode(next: BackendMode, reason?: string): void {
    if (next === mode) return;
    mode = next;
    document.documentElement.dataset.backend = next;
    bus.emit('backend:mode', { mode: next, reason });
  },
  /**
   * Checks whether a desktop backend answers (same origin). Returns the answer of
   * /api/health or null. An Apache page without the Node backend answers with HTML or 404.
   */
  async probe(timeoutMs = 2500): Promise<{ ok: boolean; version: string; pty: boolean; lan?: boolean; remote?: boolean } | null> {
    try {
      const r = await fetch('/api/health', { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
      const j = (await r.json()) as { ok?: boolean; mode?: string; version: string; pty: boolean; lan?: boolean; remote?: boolean };
      return j.ok && j.mode !== 'browser' ? (j as { ok: boolean; version: string; pty: boolean }) : null;
    } catch {
      return null;
    }
  },
};

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  if (mode === 'browser') {
    const { handle } = await import('./offline.js');
    const res = await handle(path, init);
    if (!res.ok) await parse(res);
    return res;
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('BACKEND_DOWN', tr('The local backend does not answer.'));
  }
  if (res.status === 502 || res.status === 504) throw new ApiError('BACKEND_DOWN', tr('The local backend does not answer.'), res.status);
  if (!res.ok) await parse(res);
  return res;
}

export const api = {
  async get<T>(path: string): Promise<T> {
    return (await request(path)).json() as Promise<T>;
  },
  async text(path: string): Promise<string> {
    return (await request(path)).text();
  },
  async bytes(path: string): Promise<ArrayBuffer> {
    return (await request(path)).arrayBuffer();
  },
  async send<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const raw = body instanceof ArrayBuffer || body instanceof Uint8Array || body instanceof Blob || typeof body === 'string';
    const res = await request(path, {
      method,
      headers: raw ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : raw ? (body as BodyInit) : JSON.stringify(body),
    });
    const t = await res.text();
    return (t ? JSON.parse(t) : null) as T;
  },
};

/** Reads an SSE stream of a POST request (AI answers). */
export async function* postSse<T>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
  const res = await request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) yield JSON.parse(data) as T;
    }
  }
}

// ---------------------------------------------------------------- WebSocket

type ServerEvent =
  | { t: 'fs'; project: string; path: string; kind: 'change' | 'delete'; origin: string }
  | { t: 'project'; kind: string; id: string }
  | { t: 'tool'; phase: 'start' | 'progress' | 'end'; name: string; path?: string; message?: string; ok?: boolean; callId?: string }
  | { t: 'term:data'; id: string; data: string }
  | { t: 'term:exit'; id: string; code: number | null }
  | { t: 'term:shell'; id: string; kind: 'powershell' | 'cmd' | 'posix'; file: string }
  | { t: 'hello'; version: string; project: string | null };

let ws: WebSocket | null = null;
let connected = false;
let retry = 0;
const queue: string[] = [];
let projectId: string | null = null;

export const live = {
  get connected() {
    return connected;
  },
  connect(): void {
    if (mode === 'browser') return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      connected = true;
      retry = 0;
      bus.emit('ws:state', { connected: true });
      for (const m of queue.splice(0)) ws!.send(m);
    };
    ws.onclose = () => {
      const was = connected;
      connected = false;
      if (was) bus.emit('ws:state', { connected: false });
      if (mode === 'desktop') setTimeout(() => live.connect(), Math.min(10000, 500 * 2 ** retry++));
    };
    ws.onmessage = (e) => {
      const ev = JSON.parse(String(e.data)) as ServerEvent;
      if (ev.t === 'hello') {
        if (projectId && ev.project && ev.project !== projectId) bus.emit('project:changed');
        projectId = ev.project;
      } else if (ev.t === 'fs') {
        if (ev.project !== projectId) return;
        bus.emit('fs:file', { path: ev.path, kind: ev.kind, origin: ev.origin });
      } else if (ev.t === 'project') {
        if (ev.kind === 'switched' && ev.id !== projectId) bus.emit('project:changed');
      } else if (ev.t === 'tool') bus.emit('tool:activity', ev);
      else if (ev.t === 'term:data') bus.emit('term:data', ev);
      else if (ev.t === 'term:exit') bus.emit('term:exit', ev);
      else if (ev.t === 'term:shell') bus.emit('term:shell', ev);
    };
  },
  send(msg: unknown): void {
    if (mode === 'browser') return;
    const s = JSON.stringify(msg);
    if (ws && connected) ws.send(s);
    else queue.push(s);
  },
  setProject(id: string): void {
    projectId = id;
  },
};
