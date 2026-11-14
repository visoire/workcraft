// HTTPS for the home network: when it switches on, what it refuses, and what it says about a bad certificate.
//   npx tsx --test tests/server/tls.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { resolveTls, certProblems, schemeOf } from '../../src/server/tls.js';
import { pairUrl } from '../../src/server/lan.js';

const HOME = join('data', 'home');
const CWD = join('work', 'tree');
const fakeFs = (files: Record<string, string>) => ({
  exists: (p: string) => p in files,
  read: (p: string) => Buffer.from(files[p] ?? ''),
});

test('Nothing changes without a request: plain HTTP', () => {
  const r = resolveTls({ env: {}, argv: ['--lan'], home: HOME, cwd: CWD, ...fakeFs({ [join(HOME, 'certs', 'cert.pem')]: 'c', [join(HOME, 'certs', 'key.pem')]: 'k' }) });
  assert.deepEqual(r, { enabled: false });
});

test('--https finds cert.pem and key.pem in the data folder first, then in ./certs', () => {
  const inHome = resolveTls({ env: {}, argv: ['--https'], home: HOME, cwd: CWD, ...fakeFs({ [join(HOME, 'certs', 'cert.pem')]: 'C1', [join(HOME, 'certs', 'key.pem')]: 'K1', [join(CWD, 'certs', 'cert.pem')]: 'C2', [join(CWD, 'certs', 'key.pem')]: 'K2' }) });
  assert.ok(inHome.enabled);
  if (inHome.enabled) assert.equal(inHome.tls.cert.toString(), 'C1');
  const inCwd = resolveTls({ env: { WORKCRAFT_HTTPS: '1' }, argv: [], home: HOME, cwd: CWD, ...fakeFs({ [join(CWD, 'certs', 'cert.pem')]: 'C2', [join(CWD, 'certs', 'key.pem')]: 'K2' }) });
  assert.ok(inCwd.enabled);
  if (inCwd.enabled) assert.equal(inCwd.tls.key.toString(), 'K2');
});

test('Explicit files win and a missing file is reported, never a crash', () => {
  const ok = resolveTls({ env: { WORKCRAFT_TLS_CERT: 'a.pem', WORKCRAFT_TLS_KEY: 'b.pem' }, argv: [], home: HOME, cwd: CWD, ...fakeFs({ [resolve(CWD, 'a.pem')]: 'A', [resolve(CWD, 'b.pem')]: 'B' }) });
  assert.ok(ok.enabled);
  const viaArgs = resolveTls({ env: {}, argv: ['--tls-cert=a.pem', '--tls-key=b.pem'], home: HOME, cwd: CWD, ...fakeFs({ [resolve(CWD, 'a.pem')]: 'A', [resolve(CWD, 'b.pem')]: 'B' }) });
  assert.ok(viaArgs.enabled);
  const missing = resolveTls({ env: {}, argv: ['--https'], home: HOME, cwd: CWD, ...fakeFs({}) });
  assert.equal(missing.enabled, false);
  assert.match(missing.enabled ? '' : missing.reason || '', /npm run lan:cert/);
  const half = resolveTls({ env: { WORKCRAFT_TLS_CERT: 'a.pem' }, argv: [], home: HOME, cwd: CWD, ...fakeFs({ [resolve(CWD, 'a.pem')]: 'A' }) });
  assert.equal(half.enabled, false);
});

test('Pairing addresses carry the scheme', () => {
  assert.equal(schemeOf(true), 'https');
  assert.equal(schemeOf(false), 'http');
  assert.equal(pairUrl('192.168.1.2', 5175, 'tok', 'https'), 'https://192.168.1.2:5175/pair?token=tok');
  assert.equal(pairUrl('192.168.1.2', 5175, 'tok'), 'http://192.168.1.2:5175/pair?token=tok');
});

test('Certificate problems are named: unreadable, expired, expiring, wrong address', () => {
  assert.match(certProblems(Buffer.from('not a certificate'), ['localhost'])[0]!, /not a valid PEM/);
  const now = new Date('2026-11-05T00:00:00Z');
  const cert = (validTo: string, covers: string[]) => () => ({ validTo, checkIP: (h: string) => (covers.includes(h) ? h : undefined), checkHost: (h: string) => (covers.includes(h) ? h : undefined) });
  assert.deepEqual(certProblems(Buffer.alloc(0), ['localhost', '192.168.1.20'], now, cert('Jan 1 00:00:00 2030 GMT', ['localhost', '192.168.1.20'])), []);
  assert.match(certProblems(Buffer.alloc(0), ['localhost'], now, cert('Jan 1 00:00:00 2026 GMT', ['localhost']))[0]!, /expired/);
  assert.match(certProblems(Buffer.alloc(0), ['localhost'], now, cert('Nov 20 00:00:00 2026 GMT', ['localhost']))[0]!, /expires on/);
  // the usual mkcert mistake: made for localhost, used on the Wi-Fi address
  const wrong = certProblems(Buffer.alloc(0), ['localhost', '192.168.1.20'], now, cert('Jan 1 00:00:00 2030 GMT', ['localhost']));
  assert.equal(wrong.length, 1);
  assert.match(wrong[0]!, /192\.168\.1\.20/);
});
