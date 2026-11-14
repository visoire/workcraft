// Home network mode: the iPad uses the projects, terminal and Ollama of the desktop PC over Wi-Fi.
//
// Without home network mode the backend listens on 127.0.0.1 only. With it (setting,
// WORKCRAFT_LAN=1 or --lan) it listens on 0.0.0.0. Other devices then need
// the local access token: once through /pair?token=… (sets an HttpOnly cookie with
// SameSite=Strict) or per request in the x-oc-token header. Static files of the interface are
// reachable without the token, all data (/api, /mcp, /ws) only with it.
//
// Requests from the desktop itself (sender 127.0.0.1 and host 127.0.0.1 or localhost) stay
// without a token as before, protected by the host and origin checks against DNS rebinding.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

export const LAN_COOKIE = 'oc_lan';

export const isLoopback = (addr?: string | null): boolean => {
  if (!addr) return false;
  const a = addr.trim().toLowerCase();
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('127.') || a === 'localhost';
};

/** Neues Zugangs-Token (192 Bit, URL-sicher). */
export const newToken = (): string => randomBytes(24).toString('base64url');

/** Vergleich in konstanter Zeit. */
export function tokenMatches(given: string | undefined | null, expected: string | undefined | null): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(header: string | undefined | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export interface RequestFacts {
  /** Sender address of the socket */
  remote?: string | null;
  /** x-forwarded-for (Vite proxy during development) */
  forwarded?: string | null;
  host: string;
  /** allowed local Host headers (127.0.0.1:port, localhost:port, [::1]:port) */
  localHosts: Set<string>;
}

/** Request from the desktop itself? Sender, forwarding chain and host must be local. */
export function isLocalRequest(f: RequestFacts): boolean {
  if (!isLoopback(f.remote)) return false;
  if (f.forwarded && !f.forwarded.split(',').every((x) => isLoopback(x.trim()))) return false;
  return f.localHosts.has(f.host);
}

/** Paths with data: they need the token on the home network. */
export const isProtectedPath = (path: string): boolean => path === '/mcp' || path.startsWith('/mcp/') || path === '/ws' || path.startsWith('/api/') || path === '/api';

export type LanDecision = { ok: true; via: 'local' | 'cookie' | 'header' | 'query' | 'static' } | { ok: false; status: 401 | 403; code: string; message: string };

/**
 * Decision for a request from the home network (not local).
 * origin: the Origin header if present. With cookie sign-in it must match the own address
 * (protection against foreign web pages on the same Wi-Fi).
 */
export function decideRemote(opt: {
  lanActive: boolean;
  token: string | undefined;
  path: string;
  host: string;
  origin?: string | null;
  cookie?: string | null;
  header?: string | null;
  query?: string | null;
}): LanDecision {
  if (!opt.lanActive) return { ok: false, status: 403, code: 'HOST', message: 'Host not allowed' };
  if (!isProtectedPath(opt.path)) return { ok: true, via: 'static' };
  if (tokenMatches(opt.header, opt.token)) return { ok: true, via: 'header' };
  const sameOrigin = !opt.origin || opt.origin === `http://${opt.host}` || opt.origin === `https://${opt.host}`;
  if (tokenMatches(opt.cookie, opt.token)) {
    if (!sameOrigin) return { ok: false, status: 403, code: 'ORIGIN', message: 'Origin not allowed' };
    return { ok: true, via: 'cookie' };
  }
  if (opt.path === '/ws' && tokenMatches(opt.query, opt.token) && sameOrigin) return { ok: true, via: 'query' };
  return { ok: false, status: 401, code: 'LAN_TOKEN', message: 'Access token missing or wrong. Pair the device with the address from the desktop settings (iPad and network).' };
}

/** IPv4 addresses of this computer on the local network (for the pairing address). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal || a.family !== 'IPv4') continue;
      out.push(a.address);
    }
  }
  return out;
}

export const pairUrl = (address: string, port: number, token: string, scheme: 'http' | 'https' = 'http') => `${scheme}://${address}:${port}/pair?token=${encodeURIComponent(token)}`;
