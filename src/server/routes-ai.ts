// REST routes of the AI workspace features (mounted under /api): the Craft apps as MCP servers, skills, and the
// bridge for other IDEs and agent platforms (Antigravity, Trae, Cursor, Windsurf, Claude, OpenCode, ZCode).
import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { config, updateConfig } from './config.js';
import { connectedServers, externalStatus, reconnectNow, syncExternalServers } from './mcp.js';
import { CRAFT_APPS, craftReport, discover, openApp } from './craft.js';
import { installBundledSkills, skillIndex, skills } from './skills.js';
import { bridgeConfigs } from './bridge.js';
import { registerCloudRoutes } from './cloud-routes.js';
import { transcribe, voiceStatus, VoiceError } from './voice.js';

export interface AiRouteDeps {
  port: number;
  lan: boolean;
  isLocal(c: Context): boolean;
}

export function registerAi(api: Hono, deps: AiRouteDeps): void {
  // ---------------------------------------------------------------- Craft apps
  const craftState = async () => craftReport(await discover(), config().craft.apps, connectedServers(), externalStatus(), config().craft.workspace);
  api.get('/craft', async (c) => c.json({ apps: await craftState(), approval: config().craft.approval }));
  api.put('/craft', async (c) => {
    const b = z
      .object({ id: z.string().optional(), enabled: z.boolean().optional(), approval: z.enum(['ask', 'read', 'all']).optional(), workspace: z.array(z.string().max(40)).max(64).optional() })
      .parse(await c.req.json());
    let before = '';
    updateConfig((cfg) => {
      before = cfg.craft.workspace.join(',');
      if (b.id && b.enabled !== undefined) cfg.craft.apps[b.id] = b.enabled;
      if (b.approval) cfg.craft.approval = b.approval;
      // Only ids of the Craft apps with a CLI count; the interface sends the whole workspace
      if (b.workspace) cfg.craft.workspace = [...new Set(b.workspace)].filter((id) => CRAFT_APPS.some((a) => a.id === id));
    });
    // A workspace report that changes nothing needs no new connections
    if (b.workspace && !b.id && !b.approval && before === config().craft.workspace.join(',')) return c.json({ apps: await craftState(), approval: config().craft.approval, external: externalStatus() });
    await syncExternalServers();
    return c.json({ apps: await craftState(), approval: config().craft.approval, external: externalStatus() });
  });
  // Reconnect now: forget the back-off of failed servers, or restart the servers of the given apps
  api.post('/craft/reconnect', async (c) => {
    const b = z.object({ ids: z.array(z.string().max(40)).max(64).optional() }).parse(await c.req.json().catch(() => ({})));
    await reconnectNow(b.ids);
    return c.json({ apps: await craftState(), external: externalStatus() });
  });
  api.post('/craft/open', async (c) => {
    if (!deps.isLocal(c)) return c.json({ error: { code: 'FORBIDDEN', message: 'Apps open on the computer that runs WorkCraft only.' } }, 403);
    const b = z.object({ id: z.string(), file: z.string().optional() }).parse(await c.req.json());
    try {
      const message = await openApp(b.id, b.file);
      // The live bridge needs the control port, which opens a moment after the window
      setTimeout(() => void syncExternalServers(), 4000);
      return c.json({ message });
    } catch (e) {
      return c.json({ error: { code: 'CRAFT', message: (e as Error).message } }, 400);
    }
  });
  api.post('/craft/refresh', async (c) => {
    await syncExternalServers();
    return c.json({ apps: await craftState() });
  });

  // ---------------------------------------------------------------- Voice input (Handy, offline)
  const voiceReply = async (fresh = false) => ({ ...(await voiceStatus(config().voice.handyPath, fresh)), settings: { handyPath: config().voice.handyPath || '', model: config().voice.model || '' } });
  api.get('/voice', async (c) => c.json(await voiceReply(c.req.query('fresh') === '1')));
  api.put('/voice', async (c) => {
    if (!deps.isLocal(c)) return c.json({ error: { code: 'FORBIDDEN', message: 'Voice settings are changed on the computer that runs WorkCraft only.' } }, 403);
    const b = z.object({ handyPath: z.string().max(500).optional(), model: z.string().max(300).optional() }).parse(await c.req.json());
    updateConfig((cfg) => {
      if (b.handyPath !== undefined) cfg.voice.handyPath = b.handyPath.trim() || undefined;
      if (b.model !== undefined) cfg.voice.model = b.model.trim() || undefined;
    });
    return c.json(await voiceReply(true));
  });
  // The recording stays on this computer: it goes to the Handy program next to WorkCraft (an iPad sends it to its desktop PC)
  api.post('/voice/transcribe', async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    try {
      const out = await transcribe(bytes, { setting: config().voice.handyPath, model: c.req.query('model') || config().voice.model });
      return c.json(out);
    } catch (e) {
      if (e instanceof VoiceError) return c.json({ error: { code: e.code, message: e.message } }, e.code === 'TOO_LARGE' ? 413 : e.code === 'BAD_AUDIO' ? 400 : e.code === 'FAILED' || e.code === 'TIMEOUT' ? 502 : 409);
      throw e;
    }
  });

  // ---------------------------------------------------------------- Skills
  api.get('/skills', (c) => {
    const list = skills(c.req.query('fresh') === '1');
    return c.json({ skills: list.map((s) => ({ name: s.name, description: s.description, origin: s.origin })), index: skillIndex(list) });
  });
  api.post('/skills/install', async (c) => {
    if (!deps.isLocal(c)) return c.json({ error: { code: 'FORBIDDEN', message: 'Skills are installed on the computer that runs WorkCraft only.' } }, 403);
    const b = z.object({ target: z.enum(['agents', 'claude']).default('agents') }).parse(await c.req.json().catch(() => ({})));
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const installed = installBundledSkills(join(homedir(), b.target === 'claude' ? '.claude' : '.agents', 'skills'));
    return c.json({ installed });
  });

  // ---------------------------------------------------------------- IDE bridge
  api.get('/bridge', (c) => {
    const host = c.req.header('host') || `127.0.0.1:${deps.port}`;
    const local = deps.isLocal(c);
    return c.json(bridgeConfigs({ origin: `http://127.0.0.1:${deps.port}`, lan: deps.lan && local ? { token: config().lan.token || '' } : null, host }));
  });

  registerCloudRoutes(api, deps);
}
