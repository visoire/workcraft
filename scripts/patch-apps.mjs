#!/usr/bin/env node
// Startup fixes for app web builds, applied to <set>/web/<build>/ in place before packing and
// building. The patches are listed per app in public/releases.json ("patches"); the script is
// idempotent and refuses to touch a build whose bytes do not match what a patch expects.
//
// Kind "oncelock-instance-id" (DeckCraft, storytold/deckcraft#959):
//   instance_id() in crates/engine/src/recovery.rs fills a OnceLock<u64> with a hash that includes
//   std::process::id(). On wasm32-unknown-unknown that call panics ("no pids on this platform"),
//   so the web build stops at startup. The patch writes a random id (low 24 bits clear, below 2^53,
//   the same rules the source enforces) and the OnceLock state COMPLETE (3) into the module's memory
//   right before __wbindgen_start(), so the initialiser never runs. The wasm itself stays unchanged.
//   "id" and "state" are the memory addresses of the OnceLock value and its state byte; the script
//   checks them against the code of the wasm (state load, compare with 3, then the id address).
//   After editing the glue it updates the integrity hash of the modulepreload link in index.html.
//
// Usage: node scripts/patch-apps.mjs [--check]   (--check: report only, exit 1 when a patch is missing)
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASES, officeWebDir } from './releases.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSIONS_DIR = join(ROOT, 'versions');
const MARK = 'workcraft-patch:oncelock-instance-id';
// Builds patched before the rename carry this marker; they stay valid (and byte for byte) as they are.
const LEGACY_MARK = 'opencraft-patch:oncelock-instance-id';

const sleb = (v) => {
  const out = [];
  let more = true;
  while (more) {
    let b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) more = false;
    else b |= 0x80;
    out.push(b);
  }
  return out;
};

/** Byte pattern of the OnceLock fast path: i32.const state; i32.load8_u; i32.const 3; i32.ne; if; local.get 0; i32.const id */
export function onceLockPattern(id, state) {
  return Buffer.from([0x41, ...sleb(state), 0x2d, 0x00, 0x00, 0x41, 0x03, 0x47, 0x04, 0x40, 0x20, 0x00, 0x41, ...sleb(id)]);
}

function glueSnippet(p) {
  return `    // ${MARK} (${p.issue}): instance_id() calls std::process::id(), which panics on
    // wasm32-unknown-unknown. Pre-fill its OnceLock with a random id (low 24 bits clear, below 2^53)
    // and the state COMPLETE, so the initialiser never runs. Added by WorkCraft (scripts/patch-apps.mjs).
    try {
        if (instance.exports && instance.exports.memory) {
            const id = BigInt(1 + Math.floor(Math.random() * 0x1ffffffe)) << 24n;
            new DataView(instance.exports.memory.buffer).setBigUint64(${p.id}, id, true);
            new Uint8Array(instance.exports.memory.buffer)[${p.state}] = 3;
        }
    } catch (_) {}
`;
}

const sri = (text) => 'sha384-' + createHash('sha384').update(text).digest('base64');

function readLEB128(b, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (true) {
    const byte = b[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result >>> 0, next: pos };
}

function writeLEB128(val) {
  const out = [];
  let v = val >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return Buffer.from(out);
}

function findBuildDirs(prefix) {
  const out = [];
  for (const sub of ['web-builds', 'community', 'independent', 'artcraft', '']) {
    const base = sub ? join(VERSIONS_DIR, sub) : VERSIONS_DIR;
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (d.isDirectory() && d.name.startsWith(prefix)) {
        out.push(join(base, d.name));
      }
    }
  }
  return out;
}

/**
 * MailCraft 0.12.0's web build calls `std::time::Instant::now()` in several places (the mail poll every frame, deadlines and
 * timeouts). On `wasm32-unknown-unknown` that panics ("time not implemented on this platform"), so the app dies at start. An earlier
 * version of this script cut the trap out of the wasm; that cannot work: the compiler deleted everything after the call (it never
 * returns), so execution fell into code that is not meant to run and corrupted the heap (dlmalloc "assertion failed: psize <= size +
 * max_overhead", the panel drew once and then nothing was clickable). A web build cannot be repaired by patching the binary.
 * It is a fault of that build: the script now only reports a build that has it (the first `call; unreachable` of the trap), and
 * the workspace runs MailCraft 0.11.1, the newest official web build that does not use Instant (checked: starts, answers clicks).
 */
function patchMailCraftDir(dir, check, report) {
  const files = readdirSync(dir);
  const wasmFile = files.find((f) => f.startsWith('mailcraft-web-') && f.endsWith('_bg.wasm'));
  if (!wasmFile) return;
  const wasm = readFileSync(join(dir, wasmFile));
  const callSeq = Buffer.from([0x10, 0xd2, 0x7f, 0x00]);
  if (wasm.includes(callSeq)) {
    report.push({ app: 'mailcraft', state: 'missing', detail: `${join(dir, wasmFile)} uses std::time::Instant on wasm32 and panics at start (upstream fault of 0.12.0, not patchable): install 0.11.1` });
    return;
  }
  report.push({ app: 'mailcraft', state: 'ok', detail: `${wasmFile}: no Instant::now trap` });
}

function patchWasmGzDir(app, dir, check, report) {
  const indexPath = join(dir, 'index.html');
  if (!existsSync(indexPath)) return;
  const src = readFileSync(indexPath, 'utf8');
  let next = src.replace(/<link[^>]+href="[^"]+\.wasm\.gz"[^>]*>/g, '');
  next = next.replace(
    'if (!url.pathname.endsWith(".wasm")) return fetchPlain(input, init);',
    'return fetchPlain(input, init);'
  );
  next = next.replace(
    'if (!type) return fetchPlain(input, init);',
    'return fetchPlain(input, init);'
  );
  if (next !== src) {
    if (check) {
      report.push({ app, state: 'missing', detail: `${indexPath} still probes .wasm.gz` });
      return;
    }
    writeFileSync(indexPath, next, 'utf8');
    report.push({ app, state: 'patched', detail: `index.html: direct .wasm streaming (${dir})` });
  } else {
    report.push({ app, state: 'ok', detail: `index.html: direct .wasm streaming (${dir})` });
  }
}

/** Applies (or with check=true only verifies) every patch. Returns a list of { app, state, detail }. */
export function patchApps({ check = false, webBuilds = !check } = {}) {
  const report = [];
  for (const r of RELEASES) {
    for (const p of r.patches || []) {
      const dir = officeWebDir(r);
      const gluePath = join(dir, p.glue);
      const wasmPath = join(dir, p.glue.replace(/\.js$/, '_bg.wasm'));
      const indexPath = join(dir, 'index.html');
      if (p.kind !== 'oncelock-instance-id') { report.push({ app: r.app, state: 'error', detail: `unknown patch kind ${p.kind}` }); continue; }
      if (![gluePath, wasmPath, indexPath].every(existsSync)) { report.push({ app: r.app, state: 'error', detail: `missing files in ${dir}` }); continue; }
      const wasm = readFileSync(wasmPath);
      const hits = [];
      const pat = onceLockPattern(p.id, p.state);
      for (let i = wasm.indexOf(pat); i >= 0; i = wasm.indexOf(pat, i + 1)) hits.push(i);
      if (hits.length !== 1 || !wasm.includes(Buffer.from('no pids on this platform'))) {
        report.push({ app: r.app, state: 'error', detail: `the wasm does not match the patch (${hits.length} matches of the OnceLock pattern for id ${p.id}, state ${p.state}); find the new addresses before shipping this build` });
        continue;
      }
      let glue = readFileSync(gluePath, 'utf8');
      let index = readFileSync(indexPath, 'utf8');
      const applied = glue.includes(MARK) || glue.includes(LEGACY_MARK);
      if (!applied) {
        if (check) { report.push({ app: r.app, state: 'missing', detail: `${gluePath} is not patched` }); continue; }
        const anchor = /\n(\s*)wasm\.__wbindgen_start\(\);/;
        if (!anchor.test(glue)) { report.push({ app: r.app, state: 'error', detail: 'no wasm.__wbindgen_start() in the glue' }); continue; }
        glue = glue.replace(anchor, (m) => `\n${glueSnippet(p)}${m.slice(1)}`);
        writeFileSync(gluePath, glue);
      }
      // The modulepreload link carries the glue's integrity hash: keep it in step with the file
      const link = new RegExp(`(<link[^>]+href="\\./${p.glue.replace(/[.]/g, '\\.')}"[^>]*integrity=")([^"]+)(")`);
      const want = sri(glue);
      const m = index.match(link);
      if (!m) { report.push({ app: r.app, state: 'error', detail: 'no modulepreload link with integrity for the glue in index.html' }); continue; }
      if (m[2] !== want) {
        if (check) { report.push({ app: r.app, state: 'missing', detail: 'integrity in index.html does not match the glue' }); continue; }
        index = index.replace(link, `$1${want}$3`);
        writeFileSync(indexPath, index);
      }
      report.push({ app: r.app, state: applied && m[2] === want ? 'ok' : 'patched', detail: `${p.glue}: OnceLock at ${p.id}/${p.state} (${p.issue})` });
    }
  }
  if (webBuilds) {
    for (const dir of findBuildDirs('mailcraft-web-')) {
      patchMailCraftDir(dir, check, report);
    }
    for (const dir of findBuildDirs('honeydew-web-')) {
      patchWasmGzDir('honeydew', dir, check, report);
    }
    for (const dir of findBuildDirs('paintrs-web-')) {
      patchWasmGzDir('paintrs', dir, check, report);
    }
  }
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const report = patchApps({ check, webBuilds: true });
  for (const x of report) console.log(`${x.state.padEnd(8)} ${x.app}: ${x.detail}`);
  if (!report.length) console.log('no app patches listed in releases.json');
  if (report.some((x) => x.state === 'error' || x.state === 'missing')) process.exit(1);
}
