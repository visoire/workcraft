// REST routes of the cloud storage settings (mounted under /api/cloud).
import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { config, updateConfig } from './config.js';
import { listProjects } from './projects.js';
import { homedir } from 'node:os';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { detectSyncFolders } from './cloud-detect.js';
import { CloudError, bindProject, googleCallback, googleDisconnect, googleStart, googleStatus, icloudRoot, openRemoteProject, providerLabel, remoteProjects, syncProject, unbindProject } from './cloud.js';

interface Deps {
  isLocal(c: Context): boolean;
}

const fail = (c: Context, e: unknown) => {
  const err = e as CloudError;
  return c.json({ error: { code: err.code || 'CLOUD', message: err.message } }, err.code === 'NOT_BOUND' || err.code === 'NOT_FOUND' ? 404 : 400);
};

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f5f2;color:#161616}main{max-width:26rem;padding:24px;text-align:center}@media(prefers-color-scheme:dark){body{background:#121212;color:#eee}}</style><main><h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></main>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export function registerCloudRoutes(api: Hono, deps: Deps): void {
  const state = () => {
    const c = config().cloud;
    const ic = icloudRoot();
    return {
      google: googleStatus(),
      icloud: { found: !!ic, path: ic, custom: c.icloudPath || '' },
      folders: c.folders,
      bindings: Object.fromEntries(Object.entries(c.bindings).map(([id, b]) => [id, { ...b, label: providerLabel(b.provider), name: listProjects().find((p) => p.id === id)?.name || id }])),
      localOnly: config().privacy.localOnly,
    };
  };
  const localOnly = (c: Context) => (deps.isLocal(c) ? null : c.json({ error: { code: 'FORBIDDEN', message: 'Cloud accounts are set up on the computer that runs WorkCraft.' } }, 403));

  api.get('/cloud', (c) => c.json(state()));

  // Sync folders of the cloud services that are installed on this computer (Dropbox, OneDrive, Google Drive for desktop, MEGA, Proton Drive)
  api.get('/cloud/detect', (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const ic = icloudRoot();
    const found = detectSyncFolders({
      home: homedir(),
      env: process.env,
      platform: process.platform,
      exists: (p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      },
      list: (p) => {
        try {
          return readdirSync(p);
        } catch {
          return [];
        }
      },
      join,
    });
    return c.json({ found: [...(ic ? [{ id: 'icloud', name: 'iCloud Drive', path: ic }] : []), ...found] });
  });

  // Google: the user's own OAuth client
  api.put('/cloud/google', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const b = z.object({ clientId: z.string().min(10).max(200).optional(), clientSecret: z.string().min(4).max(200).optional(), scope: z.enum(['file', 'full']).optional() }).parse(await c.req.json());
    updateConfig((cfg) => {
      const g = cfg.cloud.google;
      const changed = (b.clientId && b.clientId !== g.clientId) || (b.scope && b.scope !== g.scope);
      if (b.clientId) g.clientId = b.clientId.trim();
      if (b.clientSecret) g.clientSecret = b.clientSecret.trim();
      if (b.scope) g.scope = b.scope;
      if (changed) {
        // A different client or scope needs a new sign-in
        g.accessToken = undefined;
        g.refreshToken = undefined;
        g.expiresAt = 0;
      }
    });
    return c.json(state());
  });
  api.post('/cloud/google/start', (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    try {
      const host = c.req.header('host') || '127.0.0.1';
      return c.json({ url: googleStart(`http://${host}/api/cloud/google/callback`) });
    } catch (e) {
      return fail(c, e);
    }
  });
  api.get('/cloud/google/callback', async (c) => {
    if (!deps.isLocal(c)) return c.html(page('Not allowed', 'Sign in on the computer that runs WorkCraft.'), 403);
    const err = c.req.query('error');
    if (err) return c.html(page('Google Drive was not connected', `Google answered: ${esc(err)}. You can close this tab.`), 400);
    try {
      const r = await googleCallback(c.req.query('code') || '', c.req.query('state') || '');
      return c.html(page('Google Drive is connected', `${r.email ? esc(r.email) + '. ' : ''}You can close this tab and go back to WorkCraft.`));
    } catch (e) {
      return c.html(page('Google Drive was not connected', esc((e as Error).message)), 400);
    }
  });
  api.post('/cloud/google/disconnect', (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    googleDisconnect();
    return c.json(state());
  });

  // iCloud Drive and other folders
  api.put('/cloud/icloud', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const b = z.object({ path: z.string().max(500) }).parse(await c.req.json());
    updateConfig((cfg) => void (cfg.cloud.icloudPath = b.path.trim() || undefined));
    return c.json(state());
  });
  api.post('/cloud/folders', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const b = z.object({ name: z.string().min(1).max(60), path: z.string().min(1).max(500) }).parse(await c.req.json());
    const id = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'folder';
    updateConfig((cfg) => void (cfg.cloud.folders = [...cfg.cloud.folders.filter((f) => f.id !== id), { id, name: b.name.trim(), path: b.path.trim() }]));
    return c.json(state());
  });
  api.delete('/cloud/folders/:id', (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const id = c.req.param('id');
    updateConfig((cfg) => {
      cfg.cloud.folders = cfg.cloud.folders.filter((f) => f.id !== id);
      for (const [p, b] of Object.entries(cfg.cloud.bindings)) if (b.provider === `folder:${id}`) delete cfg.cloud.bindings[p];
    });
    return c.json(state());
  });

  // Projects in the cloud
  api.post('/cloud/bind', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const b = z.object({ project: z.string(), provider: z.string(), auto: z.boolean().optional() }).parse(await c.req.json());
    try {
      const result = await bindProject(b.project, b.provider, b.auto ?? true);
      return c.json({ ...state(), result });
    } catch (e) {
      return fail(c, e);
    }
  });
  api.put('/cloud/bind/:project', async (c) => {
    const b = z.object({ auto: z.boolean() }).parse(await c.req.json());
    updateConfig((cfg) => {
      const x = cfg.cloud.bindings[c.req.param('project')];
      if (x) x.auto = b.auto;
    });
    return c.json(state());
  });
  api.delete('/cloud/bind/:project', (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    unbindProject(c.req.param('project'));
    return c.json(state());
  });
  // A project that lives in the cloud, opened here (a new computer): which ones exist, and open one
  api.post('/cloud/remote', async (c) => {
    const b = z.object({ provider: z.string() }).parse(await c.req.json());
    try {
      return c.json({ names: await remoteProjects(b.provider) });
    } catch (e) {
      return fail(c, e);
    }
  });
  api.post('/cloud/open', async (c) => {
    const deny = localOnly(c);
    if (deny) return deny;
    const b = z.object({ provider: z.string(), name: z.string().min(1).max(120) }).parse(await c.req.json());
    try {
      const r = await openRemoteProject(b.provider, b.name);
      return c.json({ ...state(), project: r.project, result: r.result });
    } catch (e) {
      return fail(c, e);
    }
  });  api.post('/cloud/sync', async (c) => {
    const b = z.object({ project: z.string(), dryRun: z.boolean().optional() }).parse(await c.req.json());
    try {
      return c.json({ result: await syncProject(b.project, { dryRun: b.dryRun }), ...state() });
    } catch (e) {
      return fail(c, e);
    }
  });
}
