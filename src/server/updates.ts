// Release check: is the workspace, or one of the four apps, older than its newest GitHub release?
// The lookup is the release logic of apicraft ported 1:1 (src/server/apicraft.ts), so WorkCraft asks
// GitHub itself and does not depend on a running apicraft server. Off until the user switches it on.
// Only repository names and version numbers leave the machine, one request per repository, cached for
// 5 minutes (as in apicraft) and for 15 minutes per report. A GitHub token is optional (it lifts the
// 60 requests per hour limit) and stays in config.json.
import { config } from './config.js';
import { githubService, isPrereleaseVersion, logGitHubError } from './apicraft.js';

/** The repositories the check may ask about: the workspace and the four apps, nothing else. */
const ALLOWED = /^(visoire\/workcraft|storytold\/(wordcraft|gridcraft|deckcraft|pdfcraft))$/;
const TTL_MS = 15 * 60 * 1000;

export interface CheckItem {
  owner: string;
  repo: string;
  current: string;
}
export interface CheckResult extends CheckItem {
  latest: string | null;
  isOutdated: boolean | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  error: string | null;
}
export interface UpdateReport {
  state: 'ok' | 'off' | 'error';
  checkedAt: string | null;
  results: CheckResult[];
  message?: string;
}

const cache = new Map<string, { at: number; report: UpdateReport }>();

export function validateItems(items: unknown): CheckItem[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > 8) throw new Error('Expected 1 to 8 repositories.');
  return items.map((x) => {
    const it = x as Partial<CheckItem>;
    const owner = String(it.owner || '');
    const repo = String(it.repo || '');
    const current = String(it.current || '').trim().replace(/^v/i, '');
    if (!ALLOWED.test(`${owner}/${repo}`)) throw new Error(`Repository not allowed: ${owner}/${repo}`);
    if (!/^\d+(\.\d+){0,3}([-+][\w.]+)?$/.test(current)) throw new Error(`Invalid version: ${current}`);
    return { owner, repo, current };
  });
}

export async function checkReleases(items: CheckItem[], force = false): Promise<UpdateReport> {
  const u = config().updates;
  if (!u.enabled) return { state: 'off', checkedAt: null, results: [] };
  const key = `${u.githubToken ? 't' : 'a'}|` + items.map((i) => `${i.owner}/${i.repo}@${i.current}`).join(',');
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.report;
  if (force) githubService.clear();
  try {
    // A pre-release build (0.1.0-alpha.N) is compared with the newest release including pre-releases: GitHub's /releases/latest skips them
    const checks = await githubService.checkBatch(items.map((i) => ({ ...i, includePrereleases: isPrereleaseVersion(i.current) })), u.githubToken || null);
    const results: CheckResult[] = checks.map((r) => ({
      owner: r.owner,
      repo: r.repo,
      current: r.current,
      latest: r.latest ? r.latest.replace(/^v/i, '') : null,
      isOutdated: r.isOutdated,
      releaseUrl: r.releaseUrl,
      publishedAt: r.publishedAt,
      error: r.error,
    }));
    // Every repository failed: GitHub is unreachable or the quota is used up. Say so instead of an empty list.
    if (results.length && results.every((r) => r.error)) {
      const message = results[0]!.error!;
      logGitHubError(new Error(message));
      return { state: 'error', checkedAt: null, results, message };
    }
    const report: UpdateReport = { state: 'ok', checkedAt: new Date().toISOString(), results };
    cache.set(key, { at: Date.now(), report });
    return report;
  } catch (e) {
    logGitHubError(e);
    return { state: 'error', checkedAt: null, results: [], message: `GitHub is not reachable: ${(e as Error).message}` };
  }
}
