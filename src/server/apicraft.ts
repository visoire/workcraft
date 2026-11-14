// The release logic of apicraft, ported function by function so WorkCraft asks GitHub itself and no
// longer depends on an apicraft server being up. Source: apicraft/app/github_client.py (version parsing,
// fetch_latest_release, check_repo, check_batch_item, verify_token, rate-limit guard) and the changelog
// route of apicraft/app/extra_routes.py. Behavior, messages and error codes are kept as in the original;
// the Python names are noted next to each function. When apicraft gets a new release logic, port the
// changed function here and bump the note below.
//
// Ported from apicraft as of 2026-11-05.

import { log } from './logs.js';

const GITHUB_API = 'https://api.github.com';
const TIMEOUT_MS = 10_000; // github_timeout_seconds
const CACHE_TTL_MS = 300_000; // cache_ttl_seconds
const NEGATIVE_TTL_MS = 60_000; // negative_cache_ttl_seconds
const CACHE_MAX = 5000; // cache_max_size
const MAX_CONCURRENCY = 25; // max_concurrency
const QUOTA_RESERVE = 5; // github_quota_reserve
const USER_AGENT = 'workcraft';

export class GitHubAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public rateLimitRemaining: number | null = null,
    public rateLimitReset: number | null = null
  ) {
    super(message);
    this.name = 'GitHubAPIError';
  }
}

// ---------------------------------------------------------------- Versions (normalize_version_string, _parse_version, is_version_newer)

export function normalizeVersionString(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned[0] === 'v' || cleaned[0] === 'V') cleaned = cleaned.slice(1).trim();
  return cleaned;
}

/** PEP 440 version, the part of packaging.version.Version that release comparison needs. */
interface Version {
  epoch: number;
  release: number[];
  pre: [number, number] | null; // [rank a=0 b=1 rc=2, number]
  post: number | null;
  dev: number | null;
  local: string | null;
}

// The pattern of packaging.version.VERSION_PATTERN
const VERSION_RE = /^\s*v?(?:(?:(\d+)!)?(\d+(?:\.\d+)*)([-_.]?(alpha|a|beta|b|preview|pre|c|rc)[-_.]?(\d+)?)?((?:-(\d+))|(?:[-_.]?(post|rev|r)[-_.]?(\d+)?))?([-_.]?(dev)[-_.]?(\d+)?)?)(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?\s*$/i;

function tryVersion(s: string): Version | null {
  const m = VERSION_RE.exec(s);
  if (!m) return null;
  const preLetter = m[4]?.toLowerCase();
  const rank = preLetter === undefined ? null : preLetter === 'alpha' || preLetter === 'a' ? 0 : preLetter === 'beta' || preLetter === 'b' ? 1 : 2;
  return {
    epoch: m[1] ? Number(m[1]) : 0,
    release: m[2]!.split('.').map(Number),
    pre: rank === null ? null : [rank, m[5] ? Number(m[5]) : 0],
    post: m[7] !== undefined ? Number(m[7]) : m[8] ? (m[9] ? Number(m[9]) : 0) : null,
    dev: m[11] ? (m[12] ? Number(m[12]) : 0) : null,
    local: m[13] ?? null,
  };
}

/** Python: Version(s), then a search for a version-looking part; null stands for InvalidVersion. */
export function parseVersion(raw: string): Version | null {
  const s = normalizeVersionString(raw);
  const direct = tryVersion(s);
  if (direct) return direct;
  const m = /\d+(?:\.\d+)+(?:[-+.]?[A-Za-z0-9]+)*/.exec(s);
  return m ? tryVersion(m[0]) : null;
}

const isPrerelease = (v: Version) => v.pre !== null || v.dev !== null;

function cmpList(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

function compareVersions(a: Version, b: Version): number {
  if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
  const r = cmpList(a.release, b.release);
  if (r) return r;
  // pre: a dev release without pre/post sorts before every pre-release; no pre sorts after all of them
  const preKey = (v: Version): number[] => (v.pre === null && v.post === null && v.dev !== null ? [-1, 0] : v.pre === null ? [3, 0] : v.pre);
  const p = cmpList(preKey(a), preKey(b));
  if (p) return p;
  const postKey = (v: Version) => (v.post === null ? -1 : v.post);
  if (postKey(a) !== postKey(b)) return postKey(a) < postKey(b) ? -1 : 1;
  const devKey = (v: Version) => (v.dev === null ? Infinity : v.dev);
  if (devKey(a) !== devKey(b)) return devKey(a) < devKey(b) ? -1 : 1;
  if (a.local !== b.local) return a.local === null ? -1 : b.local === null ? 1 : a.local < b.local ? -1 : 1;
  return 0;
}

/** True for a pre-release such as 0.1.0-alpha.2 (the workspace is in its alpha line, its releases are GitHub pre-releases). */
export function isPrereleaseVersion(raw: string): boolean {
  const v = parseVersion(raw);
  return !!v && isPrerelease(v);
}

export function isVersionNewer(currentRaw: string, latestRaw: string, allowPrerelease = false): boolean {
  const current = normalizeVersionString(currentRaw);
  const latest = normalizeVersionString(latestRaw);
  const cur = parseVersion(current);
  const lat = parseVersion(latest);
  if (!cur || !lat) return latest !== current; // non-PEP440 tags: simple inequality
  if (isPrerelease(lat) && !allowPrerelease && !isPrerelease(cur)) return false;
  return compareVersions(lat, cur) > 0;
}

// ---------------------------------------------------------------- Service (GitHubService)

export interface LatestRelease {
  owner: string;
  repo: string;
  latest: string;
  releaseUrl: string;
  publishedAt: string | null;
  prerelease: boolean;
  rateLimitRemaining: number | null;
}

export interface ReleaseCheck {
  owner: string;
  repo: string;
  current: string;
  latest: string | null;
  isOutdated: boolean | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  prerelease: boolean;
  error: string | null;
}

export interface RepoQueryItem {
  owner: string;
  repo: string;
  current: string;
  includePrereleases?: boolean;
}

export interface ChangelogEntry {
  tag: string;
  name: string;
  publishedAt: string | null;
  url: string;
  breaking: boolean;
  body: string;
}

class TtlCache<V> {
  private m = new Map<string, { at: number; v: V }>();
  constructor(private ttl: number) {}
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttl) return void this.m.delete(k);
    return e.v;
  }
  set(k: string, v: V) {
    if (this.m.size >= CACHE_MAX) this.m.delete(this.m.keys().next().value as string);
    this.m.set(k, { at: Date.now(), v });
  }
  clear() {
    this.m.clear();
  }
}

/** Entries are namespaced per token so private data cannot leak between accounts (_scope). */
const scope = (token?: string | null) => (token ? 'T' + token.slice(-6) : 'anon');

export class GitHubService {
  private cache = new TtlCache<unknown>(CACHE_TTL_MS);
  private errorCache = new TtlCache<[number, string]>(NEGATIVE_TTL_MS);
  private active = 0;
  private waiting: (() => void)[] = [];
  lastRateLimitRemaining: number | null = null;
  lastRateLimitReset: number | null = null;
  lastRateLimitLimit: number | null = null;
  lastRateLimitUsed: number | null = null;
  constructor(private base = GITHUB_API) {}

  clear() {
    this.cache.clear();
    this.errorCache.clear();
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENCY) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private updateRateLimits(h: Headers) {
    const num = (k: string) => {
      const v = h.get(k);
      return v !== null && /^\d+$/.test(v) ? Number(v) : null;
    };
    this.lastRateLimitRemaining = num('x-ratelimit-remaining') ?? this.lastRateLimitRemaining;
    this.lastRateLimitReset = num('x-ratelimit-reset') ?? this.lastRateLimitReset;
    this.lastRateLimitLimit = num('x-ratelimit-limit') ?? this.lastRateLimitLimit;
    this.lastRateLimitUsed = num('x-ratelimit-used') ?? this.lastRateLimitUsed;
  }

  private error(message: string, status: number, code?: string): GitHubAPIError {
    return new GitHubAPIError(message, status, code, this.lastRateLimitRemaining, this.lastRateLimitReset);
  }

  /** True while GitHub told us we are (nearly) out of quota and the window has not reset (_quota_exhausted). */
  quotaExhausted(): boolean {
    const rem = this.lastRateLimitRemaining;
    const reset = this.lastRateLimitReset;
    if (rem === null || reset === null) return false;
    return rem <= QUOTA_RESERVE && Date.now() / 1000 < reset;
  }

  private async request(endpoint: string, params: Record<string, string | number>, token?: string | null): Promise<Response> {
    const url = new URL(this.base + endpoint);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT, 'x-github-api-version': '2022-11-28' };
    if (token) headers.authorization = `Bearer ${token}`;
    // redirect: 'manual' mirrors follow_redirects=False, the token is never forwarded to a redirect target
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401 && token) throw this.error('GitHub rejected your saved token (invalid, expired or revoked). Save a new one in Settings.', 403, 'github_token_rejected');
    return res;
  }

  /** Shared error mapping of fetch_latest_release and get_json. */
  private async send(endpoint: string, params: Record<string, string | number>, token: string | null | undefined, what: string): Promise<Response> {
    try {
      return await this.slot(() => this.request(endpoint, params, token));
    } catch (e) {
      if (e instanceof GitHubAPIError) throw e;
      if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') throw this.error(`Request to GitHub timed out for ${what}`, 504, 'github_timeout');
      throw this.error(`Network error while contacting GitHub for ${what}`, 502, 'github_unreachable');
    }
  }

  /** fetch_latest_release */
  async fetchLatestRelease(owner: string, repo: string, includePrereleases = false, token?: string | null): Promise<LatestRelease> {
    const key = `${scope(token)}|${owner.toLowerCase()}/${repo.toLowerCase()}:${includePrereleases}`;
    const hit = this.cache.get(key) as LatestRelease | undefined;
    if (hit) return { ...hit, rateLimitRemaining: this.lastRateLimitRemaining };
    const neg = this.errorCache.get(key);
    if (neg) throw this.error(neg[1], neg[0]);
    if (this.quotaExhausted()) throw this.error('GitHub quota exhausted; retry after the reset time.', 429, 'github_quota_exhausted');

    // /releases/latest never returns prereleases; use the list endpoint when requested.
    const [endpoint, params] = includePrereleases ? [`/repos/${owner}/${repo}/releases`, { per_page: 1 }] : [`/repos/${owner}/${repo}/releases/latest`, {}];
    const response = await this.send(endpoint, params, token, `${owner}/${repo}`);
    this.updateRateLimits(response.headers);
    const code = response.status;

    if ((code === 403 || code === 429) && (this.lastRateLimitRemaining === 0 || response.headers.has('retry-after'))) {
      const retry = response.headers.get('retry-after');
      const hint = retry ? `Retry after ${retry}s.` : 'Quota resets at the top of the hour.';
      const auth = !token ? 'Save your own GitHub token in Settings to unlock 5,000 requests/hour.' : "Your token's hourly quota is used up.";
      throw this.error(`GitHub rate limit reached. ${auth} ${hint}`, 429, 'github_rate_limited');
    }
    if (code === 404) {
      const msg = !token ? `Repository ${owner}/${repo} or release not found. If this repository is private, save your GitHub token with 'Contents: Read-only' in Settings.` : `Repository ${owner}/${repo} or release not found on GitHub.`;
      this.errorCache.set(key, [404, msg]);
      throw this.error(msg, 404, 'not_found');
    }
    if (code >= 300) throw this.error(`GitHub API returned unexpected status ${code} for ${owner}/${repo}.`, 502, 'github_bad_response');

    const payload = (await response.json()) as Record<string, unknown> | Record<string, unknown>[];
    let data: Record<string, unknown>;
    if (includePrereleases) {
      if (!Array.isArray(payload) || !payload.length) {
        const msg = `No releases found for ${owner}/${repo}.`;
        this.errorCache.set(key, [404, msg]);
        throw this.error(msg, 404, 'not_found');
      }
      data = payload[0]!;
    } else data = payload as Record<string, unknown>;

    const result: LatestRelease = {
      owner,
      repo,
      latest: normalizeVersionString(String(data.tag_name ?? '')),
      releaseUrl: String(data.html_url ?? ''),
      publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
      prerelease: !!data.prerelease,
      rateLimitRemaining: this.lastRateLimitRemaining,
    };
    this.cache.set(key, result);
    return result;
  }

  /** get_json: cached GET for read-only endpoints (changelog). */
  async getJson<T>(endpoint: string, params: Record<string, string | number> = {}, token?: string | null): Promise<T> {
    const key = `${scope(token)}|GET ${endpoint}?${Object.entries(params).sort().map(([k, v]) => `${k}=${v}`).join('&')}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit as T;
    const neg = this.errorCache.get(key);
    if (neg) throw this.error(neg[1], neg[0]);
    if (this.quotaExhausted()) throw this.error('GitHub quota exhausted; retry after the reset time.', 429, 'github_quota_exhausted');
    const response = await this.send(endpoint, params, token, 'this request');
    this.updateRateLimits(response.headers);
    const code = response.status;
    if ((code === 403 || code === 429) && (this.lastRateLimitRemaining === 0 || response.headers.has('retry-after'))) throw this.error('GitHub rate limit reached for this token. It resets at the top of the hour.', 429, 'github_rate_limited');
    if (code === 403) throw this.error('GitHub refused this request.', 403, 'github_forbidden');
    if (code === 404) {
      const msg = 'Not found on GitHub (or the repository is private). If private, save your GitHub token in Settings.';
      this.errorCache.set(key, [404, msg]);
      throw this.error(msg, 404, 'not_found');
    }
    if (code >= 300) throw this.error(`GitHub API returned unexpected status ${code}.`, 502, 'github_bad_response');
    const data = (await response.json()) as T;
    this.cache.set(key, data);
    return data;
  }

  /** verify_token: asks GitHub about a token via /rate_limit, which does not count against the quota. */
  async verifyToken(token: string): Promise<{ valid: boolean; limit?: number; remaining?: number; used?: number; reset?: number; message: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.base}/rate_limit`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw this.error('Network error while contacting GitHub.', 502, 'github_unreachable');
    }
    if (response.status === 401) return { valid: false, message: 'GitHub rejected this token: it is invalid, expired or revoked.' };
    if (response.status >= 300) throw this.error(`GitHub API returned unexpected status ${response.status}.`, 502, 'github_bad_response');
    const core = ((await response.json()) as { resources?: { core?: { limit: number; remaining: number; used: number; reset: number } } }).resources?.core;
    return { valid: true, limit: core?.limit, remaining: core?.remaining, used: core?.used, reset: core?.reset, message: 'Token is valid.' };
  }

  /** check_repo */
  async checkRepo(owner: string, repo: string, current: string, includePrereleases = false, token?: string | null): Promise<ReleaseCheck> {
    const info = await this.fetchLatestRelease(owner, repo, includePrereleases, token);
    return {
      owner,
      repo,
      current: normalizeVersionString(current),
      latest: info.latest,
      isOutdated: isVersionNewer(current, info.latest, includePrereleases),
      releaseUrl: info.releaseUrl,
      publishedAt: info.publishedAt,
      prerelease: info.prerelease,
      error: null,
    };
  }

  /** check_batch_item: one failing repository never fails the batch. */
  async checkBatchItem(item: RepoQueryItem, token?: string | null): Promise<ReleaseCheck> {
    try {
      return await this.checkRepo(item.owner, item.repo, item.current, item.includePrereleases ?? false, token);
    } catch (e) {
      if (!(e instanceof GitHubAPIError)) throw e;
      return { owner: item.owner, repo: item.repo, current: normalizeVersionString(item.current), latest: null, isOutdated: null, releaseUrl: null, publishedAt: null, prerelease: false, error: e.message };
    }
  }

  /** The batch route of apicraft: every item checked on its own, in order. */
  async checkBatch(items: RepoQueryItem[], token?: string | null): Promise<ReleaseCheck[]> {
    return Promise.all(items.map((i) => this.checkBatchItem(i, token)));
  }

  /** changelog route: notes of every release newer than `current`, newest first. */
  async changelog(owner: string, repo: string, current: string, opt: { includePrereleases?: boolean; limit?: number } = {}, token?: string | null): Promise<{ owner: string; repo: string; current: string; latest: string | null; count: number; breakingChanges: boolean; entries: ChangelogEntry[]; markdown: string }> {
    const limit = Math.min(50, Math.max(1, opt.limit ?? 20));
    const data = await this.getJson<Record<string, unknown>[]>(`/repos/${owner}/${repo}/releases`, { per_page: 50 }, token);
    const breaking = /breaking|migrat|deprecat|incompatible|removed support/i;
    const entries: ChangelogEntry[] = [];
    for (const r of data) {
      if (r.draft || (r.prerelease && !opt.includePrereleases)) continue;
      const tag = String(r.tag_name ?? '');
      if (!isVersionNewer(current, tag, opt.includePrereleases ?? false)) continue;
      const body = String(r.body ?? '').trim();
      entries.push({ tag, name: String(r.name || tag), publishedAt: typeof r.published_at === 'string' ? r.published_at : null, url: String(r.html_url ?? ''), breaking: breaking.test(body), body });
      if (entries.length >= limit) break;
    }
    const markdown = entries.map((e) => `## ${e.name} (${(e.publishedAt || '').slice(0, 10)})\n\n${e.body || '_No notes._'}`).join('\n\n').slice(0, 60_000);
    return { owner, repo, current: normalizeVersionString(current), latest: entries[0]?.tag ?? null, count: entries.length, breakingChanges: entries.some((e) => e.breaking), entries, markdown };
  }
}

export const githubService = new GitHubService();

/** Logs a failed lookup once; the callers show the message in the interface. */
export function logGitHubError(e: unknown) {
  log('warn', 'updates', (e as Error).message);
}
