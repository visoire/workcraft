// npm run versions: which version of every catalog app is where.
//
//   npm run versions                 offline: scans versions/ (Rust source trees <app>-<ver>/ and web builds <app>-web-<ver>/),
//                                    compares with public/releases.json (the office apps) and public/web-builds.json (the rest)
//   npm run versions -- --remote     also asks GitHub for the newest release of every repository in src/ecosystems/catalog.json
//   npm run versions -- --remote --token   sends GITHUB_TOKEN (optional, lifts the 60 requests an hour to 5,000)
//   npm run versions -- --strict     exit code 1 when anything is newer than what is installed (for CI or a reminder)
//
// The remote check uses the release logic of apicraft, ported in src/server/apicraft.ts (version parsing and comparison as
// PEP 440, latest release, rate-limit guard, cache), the same code WorkCraft's update check runs on. When GitHub's anonymous
// quota is used up, the public releases.atom feed of the repository answers instead (it does not count against the quota).
// Nothing is downloaded and nothing is written: installing a newer build is `npm run apps:fetch -- --yes` or `apps:import`.
//
// Run through tsx (the npm script does), because it imports TypeScript.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubAPIError, githubService, isVersionNewer } from '../src/server/apicraft.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/ecosystems/catalog.json'), 'utf8'));
const RELEASES = JSON.parse(readFileSync(join(ROOT, 'public/releases.json'), 'utf8'));
const BUILDS = existsSync(join(ROOT, 'public/web-builds.json')) ? JSON.parse(readFileSync(join(ROOT, 'public/web-builds.json'), 'utf8')).builds : [];
const SET = join(ROOT, RELEASES.set || 'versions');

/** What versions/ holds: { id: { web: [versions], source: [versions] } } from the folder names. */
export function scanVersions(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  const roots = [
    dir,
    join(dir, 'artcraft'),
    join(dir, 'community'),
    join(dir, 'independent'),
    join(dir, 'web-builds')
  ].filter((d) => existsSync(d));
  for (const r of roots) {
    for (const d of readdirSync(r, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const m = d.name.match(/^([a-z][a-z-]*?)(-web)?-(\d+\.\d+\.\d+(?:-[\w.]+)?)$/);
      if (!m) continue;
      const e = (out[m[1]] ??= { web: [], source: [] });
      const list = m[2] ? e.web : e.source;
      if (!list.includes(m[3])) list.push(m[3]);
    }
  }
  // ascending: x sorts before y when y is the newer one
  const newest = (a) => a.sort((x, y) => (x === y ? 0 : isVersionNewer(x, y, true) ? -1 : 1)).at(-1) ?? null;
  for (const e of Object.values(out)) {
    e.web = newest(e.web);
    e.source = newest(e.source);
  }
  return out;
}

/** Newest release tag from the repository's public atom feed (no API quota). */
export async function latestFromFeed(repo) {
  const res = await fetch(`https://github.com/${repo}/releases.atom`, { headers: { 'user-agent': 'workcraft-check-versions' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`feed answered ${res.status}`);
  const xml = await res.text();
  const tag = xml.match(/<link[^>]+href="[^"]*\/releases\/tag\/([^"]+)"/)?.[1];
  if (!tag) throw new Error('no release in the feed');
  return decodeURIComponent(tag).replace(/^v/i, '');
}

async function latestOf(repo) {
  const [owner, name] = repo.split('/');
  try {
    const r = await githubService.fetchLatestRelease(owner, name, true, flag('token') ? process.env.GITHUB_TOKEN : null);
    return { version: r.latest, via: 'api', prerelease: r.prerelease };
  } catch (e) {
    if (!(e instanceof GitHubAPIError) || !['github_rate_limited', 'github_quota_exhausted', 'github_unreachable', 'github_timeout'].includes(e.code ?? '')) {
      if (e instanceof GitHubAPIError) return { error: e.message };
      throw e;
    }
    try {
      return { version: await latestFromFeed(repo), via: 'feed' };
    } catch (f) {
      return { error: `${e.message} (feed: ${f.message})` };
    }
  }
}

async function main() {
  const local = scanVersions(SET);
  const remote = flag('remote');
  const rows = [];
  for (const a of CATALOG.apps) {
    const office = RELEASES.apps.find((r) => r.app === a.id);
    const registered = office ? (office.webVersion || office.version) : BUILDS.find((b) => b.app === a.id)?.version ?? null;
    const l = local[a.id] ?? { web: null, source: null };
    const row = { id: a.id, origin: a.origin, channel: a.channel, registered, folder: l.web, source: l.source, upstream: null, via: '', note: [] };
    if (l.web && registered && isVersionNewer(registered, l.web, true)) row.note.push(`versions/ has ${l.web}: ${office ? 'update public/releases.json' : 'npm run apps:import -- --yes'}`);
    if (l.web && !registered) row.note.push(office ? 'in versions/, not in releases.json' : 'in versions/, not imported: npm run apps:import -- --yes');
    if (!l.web && !registered) row.note.push(a.channel === 'source' ? 'built from source only' : 'no web build yet');
    if (l.source && l.web && l.source !== l.web && isVersionNewer(l.web, l.source, true)) row.note.push(`source ${l.source} is newer than the web build ${l.web}`);
    rows.push(row);
  }
  if (remote) {
    // The catalog repositories one after the other, at most 8 at once, each through the ported release logic
    const queue = rows.map((r) => ({ r, app: CATALOG.apps.find((a) => a.id === r.id) }));
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (let q = queue.shift(); q; q = queue.shift()) {
        const got = await latestOf(q.app.repo);
        if (got.error) q.r.note.push(`upstream: ${got.error}`);
        else {
          q.r.upstream = got.version;
          q.r.via = got.via;
          const have = q.r.folder ?? q.r.registered;
          if (have && isVersionNewer(have, got.version, true)) q.r.note.push(`upstream ${got.version} is newer: ${q.app.channel === 'release' ? 'npm run apps:fetch -- --yes --app ' + q.r.id : 'build it and drop it into versions/'}`);
          if (!have && q.app.channel === 'release') q.r.note.push(`upstream ${got.version} can be installed: npm run apps:fetch -- --yes --app ${q.r.id}`);
        }
      }
    }));
  }
  const cols = ['id', 'origin', 'registered', 'folder', 'source', ...(remote ? ['upstream'] : [])];
  const w = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c] ?? '-').length))]));
  console.log(cols.map((c) => c.padEnd(w[c])).join('  ') + '  note');
  for (const r of rows) console.log(cols.map((c) => String(r[c] ?? '-').padEnd(w[c])).join('  ') + '  ' + r.note.join('; '));
  const newer = rows.filter((r) => r.note.some((n) => /newer|not imported|update public|can be installed|not in releases|versions\/ has/.test(n)));
  console.log(`\n${rows.length} apps. ${newer.length ? `${newer.length} with something newer or missing.` : 'Everything in versions/ is registered' + (remote ? ' and current.' : '.')}${remote ? ` GitHub requests left this hour: ${githubService.lastRateLimitRemaining ?? 'unknown'}.` : ' Add --remote to ask GitHub.'}`);
  if (flag('strict') && newer.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
