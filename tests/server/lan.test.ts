// Home network mode: rules for requests from the Wi-Fi (unit tests) and a real server start
// with WORKCRAFT_LAN=1, reached through this computer's network address like from the iPad.
//   npx tsx --test tests/server/lan.test.ts

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { isLoopback, isLocalRequest, decideRemote, tokenMatches, readCookie, isProtectedPath, lanAddresses, newToken, pairUrl } from '../../src/server/lan.js';

const hosts = new Set(['127.0.0.1:5175', 'localhost:5175', '[::1]:5175']);

test('Loopback addresses are recognised', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.5']) assert.ok(isLoopback(a), a);
  for (const a of ['192.168.178.20', '10.0.0.4', '::ffff:192.168.1.2', '', null, undefined]) assert.ok(!isLoopback(a), String(a));
});

test('A local request needs a local sender, local forwarding and a local host', () => {
  assert.ok(isLocalRequest({ remote: '127.0.0.1', host: '127.0.0.1:5175', localHosts: hosts }));
  assert.ok(isLocalRequest({ remote: '127.0.0.1', forwarded: '127.0.0.1', host: 'localhost:5175', localHosts: hosts }));
  // iPad through the Vite proxy: local sender, forwarded from the Wi-Fi
  assert.ok(!isLocalRequest({ remote: '127.0.0.1', forwarded: '192.168.178.31', host: '192.168.178.20:5175', localHosts: hosts }));
  // forged Host header from another device
  assert.ok(!isLocalRequest({ remote: '192.168.178.31', host: '127.0.0.1:5175', localHosts: hosts }));
  // DNS rebinding: local sender, foreign host
  assert.ok(!isLocalRequest({ remote: '127.0.0.1', host: 'evil.example:5175', localHosts: hosts }));
});

test('Token comparison and cookie reading', () => {
  const t = newToken();
  assert.ok(t.length >= 30);
  assert.ok(tokenMatches(t, t));
  // the last character is replaced by one that differs (a fixed 'x' was equal to the token one time in 32)
  assert.ok(!tokenMatches(t, t.slice(0, -1) + (t.endsWith('x') ? 'y' : 'x')));
  assert.ok(!tokenMatches('', t));
  assert.ok(!tokenMatches(t, undefined));
  assert.equal(readCookie('a=1; oc_lan=abc%3D; b=2', 'oc_lan'), 'abc=');
  assert.equal(readCookie('a=1', 'oc_lan'), null);
});

test('Decision for devices on the home network', () => {
  const token = 'x'.repeat(32);
  const base = { lanActive: true, token, host: '192.168.178.20:5175' };
  assert.equal(decideRemote({ ...base, lanActive: false, path: '/api/health' }).ok, false);
  assert.deepEqual(decideRemote({ ...base, path: '/ide/' }), { ok: true, via: 'static' });
  assert.equal(decideRemote({ ...base, path: '/api/projects' }).ok, false);
  assert.deepEqual(decideRemote({ ...base, path: '/api/projects', header: token }), { ok: true, via: 'header' });
  assert.deepEqual(decideRemote({ ...base, path: '/mcp', cookie: token, origin: 'http://192.168.178.20:5175' }), { ok: true, via: 'cookie' });
  // foreign website on the Wi-Fi with the iPad's cookie: rejected
  const csrf = decideRemote({ ...base, path: '/api/files/raw', cookie: token, origin: 'http://evil.local' });
  assert.equal(csrf.ok, false);
  assert.deepEqual(decideRemote({ ...base, path: '/ws', query: token }), { ok: true, via: 'query' });
  assert.equal(decideRemote({ ...base, path: '/api/files/raw', query: token }).ok, false);
  assert.ok(isProtectedPath('/api/x') && isProtectedPath('/mcp') && isProtectedPath('/ws') && !isProtectedPath('/apps/gridcraft/'));
  assert.equal(pairUrl('192.168.1.2', 5175, 'a b'), 'http://192.168.1.2:5175/pair?token=a%20b');
});

// ---------------------------------------------------------------- real server in home network mode

const PORT = 5293;
const HOME = mkdtempSync(join(tmpdir(), 'workcraft-lan-'));
const ADDR = lanAddresses()[0];
let proc: ChildProcess;

/** HTTP request with any Host header (fetch does not allow that). */
function raw(host: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const r = request({ host, port: PORT, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}

before(async () => {
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env: { ...process.env, WORKCRAFT_FIRST_PROJECT: 'sample', WORKCRAFT_HOME: HOME, WORKCRAFT_PORT: String(PORT), WORKCRAFT_DEV: '1', WORKCRAFT_LAN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await raw('127.0.0.1', '/api/health', { host: `127.0.0.1:${PORT}` });
      if (r.status === 200) break;
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(async () => {
  // The server may still be writing into its data folder when it is told to stop: wait for it to exit, then remove the folder with retries
  // (an ENOTEMPTY or EPERM race made this hook fail on CI and on Windows although every test had passed)
  if (proc && proc.exitCode === null) {
    const exited = new Promise<void>((resolve) => proc!.once('exit', () => resolve()));
    proc.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  rmSync(HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const token = () => (JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8')) as { lan: { token: string } }).lan.token;

test('Desktop itself: no token, home network data visible', async () => {
  const r = await raw('127.0.0.1', '/api/lan', { host: `127.0.0.1:${PORT}` });
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body) as { active: boolean; token: string };
  assert.equal(j.active, true);
  assert.equal(j.token, token());
});

test('iPad on the Wi-Fi: rejected without a token, pairing sets a cookie, then access', { skip: !ADDR && 'no network address in this environment' }, async () => {
  const host = `${ADDR}:${PORT}`;
  const denied = await raw(ADDR!, '/api/projects', { host });
  assert.equal(denied.status, 401);
  assert.match(denied.body, /LAN_TOKEN/);
  // a forged local Host header does not help
  assert.equal((await raw(ADDR!, '/api/projects', { host: `127.0.0.1:${PORT}` })).status, 401);
  // home network settings only on the desktop
  assert.equal((await raw(ADDR!, '/api/lan', { host, 'x-oc-token': token() })).status, 403);
  // wrong token while pairing
  assert.equal((await raw(ADDR!, '/pair?token=wrong', { host })).status, 401);
  const pair = await raw(ADDR!, `/pair?token=${encodeURIComponent(token())}`, { host });
  assert.equal(pair.status, 302);
  const cookie = String(pair.headers['set-cookie']);
  assert.match(cookie, /oc_lan=.+HttpOnly; SameSite=Strict/);
  const ok = await raw(ADDR!, '/api/projects', { host, cookie: cookie.split(';')[0]! });
  assert.equal(ok.status, 200);
  const health = JSON.parse((await raw(ADDR!, '/api/health', { host, 'x-oc-token': token() })).body) as { remote: boolean; lan: boolean };
  assert.equal(health.remote, true);
  assert.equal(health.lan, true);
  // cookie from a foreign website on the Wi-Fi: origin does not match
  assert.equal((await raw(ADDR!, '/api/projects', { host, cookie: cookie.split(';')[0]!, origin: 'http://evil.local' })).status, 403);
});
