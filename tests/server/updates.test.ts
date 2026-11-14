// Release check with the apicraft logic ported into the workspace: version rules as in packaging.version,
// the GitHub lookups with caching and error mapping, the allowlist, off by default, nothing sent when off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WORKCRAFT_HOME = mkdtempSync(join(tmpdir(), 'wc-updates-'));
const { updateConfig } = await import('../../src/server/config.ts');
const { checkReleases, validateItems } = await import('../../src/server/updates.ts');
const { isVersionNewer, normalizeVersionString, GitHubService, githubService } = await import('../../src/server/apicraft.ts');

const items = [
  { owner: 'visoire', repo: 'workcraft', current: '1.0.0' },
  { owner: 'storytold', repo: 'wordcraft', current: 'v0.9.0' },
];

test('versions compare as in apicraft (PEP 440 rules, tag prefixes, pre-releases)', () => {
  assert.equal(normalizeVersionString(' v1.2.3 '), '1.2.3');
  assert.equal(isVersionNewer('0.9.0', '0.11.0'), true, 'numeric, not text, order');
  assert.equal(isVersionNewer('1.0', '1.0.0'), false, 'trailing zeros are equal');
  assert.equal(isVersionNewer('1.0.0', '1.0.1'), true);
  assert.equal(isVersionNewer('1.0.1', '1.0.0'), false);
  assert.equal(isVersionNewer('1.0.0', '1.1.0rc1'), false, 'a pre-release is no update for a stable build');
  assert.equal(isVersionNewer('1.0.0', '1.1.0rc1', true), true, 'unless pre-releases are wanted');
  assert.equal(isVersionNewer('1.1.0b1', '1.1.0rc1'), true, 'a pre-release may move to a later pre-release');
  assert.equal(isVersionNewer('1.1.0rc1', '1.1.0'), true);
  assert.equal(isVersionNewer('1.0.0', '1.0.0.post1'), true);
  assert.equal(isVersionNewer('1.0.0', 'artcraft-v1.2.0'), true, 'a tag prefix is ignored');
  assert.equal(isVersionNewer('0.9', 'nightly'), true, 'non-version tags fall back to inequality');
  assert.equal(isVersionNewer('nightly', 'nightly'), false);
});

test('only the workspace and the four apps may be asked about, with plain version numbers', () => {
  assert.equal(validateItems(items)[1]!.current, '0.9.0');
  assert.throws(() => validateItems([{ owner: 'evil', repo: 'thing', current: '1.0.0' }]), /not allowed/);
  assert.throws(() => validateItems([{ owner: 'visoire', repo: 'workcraft', current: '1.0.0; drop' }]), /Invalid version/);
  assert.throws(() => validateItems([]), /1 to 8/);
});

test('off by default: nothing leaves the machine', async () => {
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => (calls++, new Response('{}'))) as typeof fetch;
  try {
    assert.equal((await checkReleases(validateItems(items))).state, 'off');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = real;
  }
});

const release = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, html_url: `https://github.com/x/y/releases/tag/${tag}`, published_at: '2026-10-25T13:30:52Z', prerelease: false, ...extra });

test('GitHub is asked directly, once per repository, with the optional token, and the answer is cached', async () => {
  githubService.clear();
  updateConfig((c) => void ((c.updates.enabled = true), (c.updates.githubToken = 'github_pat_test_123456')));
  const seen: { url: string; auth: string | null; ua: string | null }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: URL, init: RequestInit) => {
    const h = new Headers(init.headers);
    seen.push({ url: String(url), auth: h.get('authorization'), ua: h.get('user-agent') });
    if (String(url).includes('/visoire/workcraft/')) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(release('v0.11.0')), { status: 200, headers: { 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) } });
  }) as typeof fetch;
  try {
    const r = await checkReleases(validateItems(items), true);
    assert.equal(r.state, 'ok');
    assert.equal(r.results[1]!.latest, '0.11.0');
    assert.equal(r.results[1]!.isOutdated, true);
    assert.match(r.results[0]!.error || '', /not found/, 'a repository without a release is reported, the batch goes on');
    assert.equal(seen.length, 2);
    assert.ok(seen.every((s) => s.url.startsWith('https://api.github.com/repos/') && s.auth === 'Bearer github_pat_test_123456' && s.ua === 'workcraft'));
    await checkReleases(validateItems(items));
    assert.equal(seen.length, 2, 'the second call comes from the cache');
  } finally {
    globalThis.fetch = real;
  }
});

test('rate limits, redirects and network errors map to the apicraft messages and codes', async () => {
  const real = globalThis.fetch;
  try {
    const svc = new GitHubService();
    globalThis.fetch = (async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } })) as typeof fetch;
    await assert.rejects(() => svc.fetchLatestRelease('a', 'b'), (e: { code?: string; statusCode?: number; message: string }) => e.code === 'github_rate_limited' && e.statusCode === 429 && /60|5,000/.test(e.message));
    assert.equal(svc.quotaExhausted(), true);
    await assert.rejects(() => svc.fetchLatestRelease('a', 'c'), (e: { code?: string }) => e.code === 'github_quota_exhausted');

    const svc2 = new GitHubService();
    globalThis.fetch = (async () => new Response('', { status: 401 })) as typeof fetch;
    await assert.rejects(() => svc2.fetchLatestRelease('a', 'b', false, 'bad'), (e: { code?: string }) => e.code === 'github_token_rejected');

    const svc3 = new GitHubService();
    globalThis.fetch = (async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } })) as typeof fetch;
    await assert.rejects(() => svc3.fetchLatestRelease('a', 'b'), (e: { code?: string }) => e.code === 'github_bad_response');

    const svc4 = new GitHubService();
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const r = await svc4.checkBatchItem({ owner: 'a', repo: 'b', current: '1.0.0' });
    assert.match(r.error || '', /Network error/);
    assert.equal(r.latest, null);
  } finally {
    globalThis.fetch = real;
  }
});

test('pre-releases come from the list endpoint, and the changelog collects every newer release', async () => {
  const real = globalThis.fetch;
  const urls: string[] = [];
  const list = [release('v2.0.0-rc1', { prerelease: true, body: 'rc' }), release('v1.2.0', { body: 'Breaking: config moved' }), release('v1.1.0', { body: '- a' }), release('v1.0.0', { body: 'old' }), release('v0.9.0', { draft: true })];
  globalThis.fetch = (async (url: URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify(String(url).includes('per_page=1') ? [list[0]] : list), { status: 200 });
  }) as typeof fetch;
  try {
    const svc = new GitHubService();
    assert.equal((await svc.fetchLatestRelease('a', 'b', true)).latest, '2.0.0-rc1');
    assert.match(urls[0]!, /\/repos\/a\/b\/releases\?per_page=1$/);
    const log = await svc.changelog('a', 'b', '1.0.0');
    assert.deepEqual(log.entries.map((e) => e.tag), ['v1.2.0', 'v1.1.0'], 'drafts, pre-releases and the running version are left out');
    assert.equal(log.breakingChanges, true);
    assert.match(log.markdown, /^## v1.2.0/);
    assert.equal((await svc.changelog('a', 'b', '1.0.0', { includePrereleases: true })).entries[0]!.tag, 'v2.0.0-rc1');
  } finally {
    globalThis.fetch = real;
  }
});

test('an unreachable GitHub is reported, not thrown', async () => {
  githubService.clear();
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  try {
    const r = await checkReleases(validateItems([{ owner: 'storytold', repo: 'pdfcraft', current: '0.10.1' }]), true);
    assert.equal(r.state, 'error');
    assert.match(r.message || '', /Network error/);
  } finally {
    globalThis.fetch = real;
  }
});
test('an alpha build asks the pre-release list: 1.0.0-alpha.2 is older than 1.0.0-alpha.3, not than the stable app builds', async () => {
  githubService.clear();
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: URL) => {
    urls.push(String(url));
    if (String(url).includes('/visoire/workcraft/')) return new Response(JSON.stringify([release('v1.0.0-alpha.3', { prerelease: true })]), { status: 200 });
    return new Response(JSON.stringify(release('v0.15.2')), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await checkReleases(validateItems([{ owner: 'visoire', repo: 'workcraft', current: '1.0.0-alpha.2' }, { owner: 'storytold', repo: 'wordcraft', current: '0.15.2' }]), true);
    assert.equal(r.state, 'ok');
    assert.equal(r.results[0]!.latest, '1.0.0-alpha.3');
    assert.equal(r.results[0]!.isOutdated, true);
    assert.equal(r.results[1]!.isOutdated, false);
    assert.ok(urls.some((u) => u.endsWith('/repos/visoire/workcraft/releases?per_page=1')), 'the pre-release list is used for the alpha build');
    assert.ok(urls.some((u) => u.endsWith('/repos/storytold/wordcraft/releases/latest')), 'the stable apps keep /releases/latest');
    assert.equal(isVersionNewer('1.0.0-alpha.2', '1.0.0-alpha.10', true), true);
    assert.equal(isVersionNewer('1.0.0-alpha.2', '1.0.0', true), true, 'the stable release follows its alphas');
  } finally {
    globalThis.fetch = real;
  }
});
