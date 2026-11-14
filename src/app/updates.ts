// Release check: is WorkCraft, or one of the four apps, older than its newest GitHub release?
// The backend runs the release logic of apicraft (src/server/apicraft.ts) against GitHub, only when the check is switched
// on in Settings, Status. This module builds the list, keeps the last answer, and tells the user once per new version.
import { api, backend } from './backend.js';
import { bus } from './bus.js';
import { notify } from './notifications.js';
import { t } from './i18n.js';
import { VERSION } from './status.js';
import { AVAILABLE, RELEASES, TOOLS, releaseOf } from '../workspace/registry.js';
import { appById, type CraftId } from '../ecosystems/catalog.js';

export type VersionState = 'newest' | 'ready' | 'outdated' | 'missing';

/**
 * Version status of a catalog app:
 * - 'newest' (green): newest upstream release available and installed
 * - 'outdated' (amber): a newer upstream release exists, or the web build lags the release tag
 * - 'ready' (blue/teal): installed and ready local/community build
 * - 'missing': no web build in this installation
 */
export function appVersionState(id: CraftId): VersionState {
  if (!AVAILABLE.has(id)) return 'missing';
  const a = appById(id);
  const repoName = a?.repo.split('/')[1] || id;
  const live = last?.results.find((r) => r.repo === id || r.repo === repoName);
  if (live?.isOutdated === true) return 'outdated';
  const rel = releaseOf(id);
  if (rel?.webVersion && rel.webVersion !== rel.version) return 'outdated';
  if (live?.isOutdated === false) return 'newest';
  if (a?.channel === 'release') return 'newest';
  return 'ready';
}

export function appVersionTitle(id: CraftId): string {
  const st = appVersionState(id);
  const v = TOOLS[id]?.version || '?';
  if (st === 'newest') return t('Newest version installed (v{v})', { v });
  if (st === 'outdated') return t('Update available (installed v{v})', { v });
  if (st === 'ready') return t('Ready and installed (v{v})', { v });
  return t('No web build here yet');
}

export interface UpdateResult {
  owner: string;
  repo: string;
  current: string;
  latest: string | null;
  isOutdated: boolean | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  error: string | null;
}
export interface UpdateReport {
  state: 'ok' | 'off' | 'error' | 'unavailable';
  checkedAt: string | null;
  results: UpdateResult[];
  message?: string;
}

const SEEN_KEY = 'workcraft.updates.seen';
let last: UpdateReport | null = null;
let timer = 0;

export const updates = {
  get last(): UpdateReport | null {
    return last;
  },
  /** The workspace result, if the check ran. */
  get workspace(): UpdateResult | undefined {
    return last?.results.find((r) => r.repo === 'workcraft');
  },
  /** Apps whose build here is older than the newest release. */
  get apps(): UpdateResult[] {
    return (last?.results || []).filter((r) => r.repo !== 'workcraft');
  },
  get outdated(): UpdateResult[] {
    return (last?.results || []).filter((r) => r.isOutdated);
  },
};

/** What the backend is asked about: the workspace and the app builds this workspace runs. */
export function reposToCheck(): { owner: string; repo: string; current: string }[] {
  return [{ owner: 'visoire', repo: 'workcraft', current: VERSION }, ...RELEASES.map((r) => ({ owner: 'storytold', repo: r.app, current: r.webVersion ?? r.version }))];
}

export async function checkNow(force = false): Promise<UpdateReport> {
  if (backend.browser) {
    last = { state: 'unavailable', checkedAt: null, results: [], message: t('The release check needs the desktop backend.') };
  } else {
    try {
      last = await api.send<UpdateReport>('POST', '/api/updates/check', { repos: reposToCheck(), force });
    } catch (e) {
      last = { state: 'error', checkedAt: null, results: [], message: (e as Error).message };
    }
  }
  bus.emit('updates:change');
  return last;
}

const seenSet = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
};

/** One notification per new version, never repeated for the same one. */
function announce(r: UpdateReport) {
  if (r.state !== 'ok') return;
  const seen = seenSet();
  const fresh = r.results.filter((x) => x.isOutdated && x.latest && !seen.has(`${x.repo}@${x.latest}`));
  if (!fresh.length) return;
  const ws = fresh.find((x) => x.repo === 'workcraft');
  const apps = fresh.filter((x) => x.repo !== 'workcraft');
  if (ws) {
    notify({
      level: 'info',
      title: t('WorkCraft {v} is available', { v: ws.latest || '' }),
      message: t('You run {c}. The newest release is {v}.', { c: ws.current, v: ws.latest || '' }),
      actions: [{ label: t('Release notes'), primary: true, run: () => void window.open(ws.releaseUrl || 'https://github.com/visoire/workcraft/releases', '_blank', 'noopener') }],
      timeout: 0,
    });
  }
  if (apps.length) {
    notify({
      level: 'info',
      title: apps.length === 1 ? t('A newer app version is out') : t('{n} newer app versions are out', { n: apps.length }),
      message: apps.map((a) => `${a.repo} ${a.current} → ${a.latest}`).join(', '),
      actions: [{ label: t('Open Settings, Status'), run: () => bus.emit('open-settings', 'status') }],
      timeout: 12000,
    });
  }
  for (const x of fresh) seen.add(`${x.repo}@${x.latest}`);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-40)));
  } catch {
    /* storage blocked: the notice may repeat on the next start */
  }
}

/** First check a few seconds after the start, then every six hours (the backend caches for 15 minutes). */
export function startUpdateChecks() {
  const run = async () => announce(await checkNow());
  setTimeout(() => void run(), 6000);
  window.clearInterval(timer);
  timer = window.setInterval(() => void run(), 6 * 3600 * 1000);
}
