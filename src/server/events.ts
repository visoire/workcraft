// Live events over the WebSocket: file changes, project switches, tool status, terminal.

export type ServerEvent =
  | { t: 'fs'; project: string; path: string; kind: 'change' | 'delete'; origin: string }
  | { t: 'project'; kind: 'switched' | 'changed' | 'deleted'; id: string }
  | { t: 'tool'; phase: 'start' | 'progress' | 'end'; name: string; path?: string; message?: string; ok?: boolean; callId?: string }
  | { t: 'term:data'; id: string; data: string }
  | { t: 'term:exit'; id: string; code: number | null }
  | { t: 'term:shell'; id: string; kind: 'powershell' | 'cmd' | 'posix'; file: string }
  | { t: 'hello'; version: string; project: string | null };

export interface Peer {
  id: string;
  send(data: string): void;
}

const peers = new Map<string, Peer>();

export function addPeer(p: Peer): () => void {
  peers.set(p.id, p);
  return () => peers.delete(p.id);
}

const hooks = new Set<(ev: ServerEvent) => void>();
/** Listens to every event inside the backend (search index, project graph). */
export function onEvent(fn: (ev: ServerEvent) => void): () => void {
  hooks.add(fn);
  return () => hooks.delete(fn);
}

export function broadcast(ev: ServerEvent): void {
  for (const fn of hooks) {
    try {
      fn(ev);
    } catch {
      /* a hook never stops the broadcast */
    }
  }
  const msg = JSON.stringify(ev);
  for (const p of peers.values()) {
    try {
      p.send(msg);
    } catch {
      peers.delete(p.id);
    }
  }
}

export function sendTo(peerId: string, ev: ServerEvent): void {
  peers.get(peerId)?.send(JSON.stringify(ev));
}
