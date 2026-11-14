// Team Mode: a Team Leader model plans, specialist sub-agents work in parallel, the leader reviews.
//
//   Stage 1  Plan     the leader turns the prompt into a task graph (JSON DAG: id, title,
//                     assignedAgent, dependencies, targetFiles, instructions)
//   Stage 2  Work     every task whose dependencies are done starts at once, up to the concurrency
//                     limit, each in its own sub-thread with its own model and a tool scope
//   Stage 3  Review   each finished task is checked (failed MCP calls, empty output) and reviewed by
//                     the leader; a rejected task gets a targeted retry instruction, then the leader
//                     writes the final answer
//
// No DOM here: roles, presets, the configuration schema, the task graph parser and the scheduler are
// shared by the interface (src/chat/team-runner.ts), the backend (config) and the tests. The model
// calls come in through a TeamDriver.

import { z } from 'zod';
import { repairJson } from '../core/json-repair.js';
import { addRoleUsage, type RoleUsage } from './usage.js';
import type { TokenUsage } from './types.js';
import { APPS, ECOSYSTEMS, appOfGroup, nativeAppsOf, type Ecosystem } from '../ecosystems/catalog.js';
import { APP_ROLES, BUILTIN_PROMPTS, OFFICE_ROLE, appOfRole, externalGroup, roleIdOfApp } from './app-roles.js';

// ---------------------------------------------------------------- Roles

/**
 * 'grid', 'word', 'deck', 'pdf', 'dev' (the five historic specialists), the id of an app of the catalog
 * (`photocraft`: see src/chat/app-roles.ts) or the id of an agent the user created (see AgentProfile).
 */
export type WorkerRoleId = string;
export type TeamRoleId = string;
export const WORKER_ROLES: WorkerRoleId[] = ['grid', 'word', 'deck', 'pdf', 'dev'];
export const TEAM_ROLES: TeamRoleId[] = ['leader', ...WORKER_ROLES];

export interface RoleDef {
  id: TeamRoleId;
  /** @ mention without the @ */
  mention: string;
  name: string;
  /** Short label for badges */
  short: string;
  /** App whose mark the card shows (workspace: the leader, code: the dev worker, catalog: an app specialist, custom: an agent you created) */
  app: 'workspace' | 'gridcraft' | 'wordcraft' | 'deckcraft' | 'pdfcraft' | 'code' | 'catalog' | 'custom';
  /** Accent color of the role */
  accent: string;
  /** Icon from src/app/icons.js */
  icon: string;
  scope: string;
  /** Tool apps (ToolMeta.app) the role may call */
  apps: string[];
  /** An agent the user created: its own system prompt and tool patterns */
  custom?: boolean;
  /** System prompt addition: custom agents, app specialists and the five historic specialists have one */
  prompt?: string;
  /** Tool name patterns of a custom agent: `*`, `read-*`, `ext-photocraft-*`, `app:gridcraft` */
  tools?: string[];
  /** The catalog app this specialist works in (its `ext-<app>-*` tools and project files) */
  appId?: string;
  /** The app of a specialist has no CLI: it is reached through the project files only */
  webOnly?: boolean;
}

export const ROLE_DEFS: Record<TeamRoleId, RoleDef> = {
  leader: { id: 'leader', mention: 'leader', name: 'Team Leader', short: 'Leader', app: 'workspace', accent: '#335CFF', icon: 'users', scope: 'Plans the work, assigns tasks, reviews every result and writes the final answer.', apps: [] },
  grid: { id: 'grid', mention: 'grid-agent', name: 'Data & Sheet Specialist', short: 'GridCraft', app: 'gridcraft', accent: '#10B981', icon: 'grid', scope: 'Spreadsheets: reading sheets, evaluating formulas, CSV and XLSX analysis, data modeling.', apps: ['gridcraft'], appId: 'gridcraft', prompt: BUILTIN_PROMPTS.grid },
  word: { id: 'word', mention: 'word-agent', name: 'Document & Copy Specialist', short: 'WordCraft', app: 'wordcraft', accent: '#3B82F6', icon: 'file', scope: 'Documents: drafting reports, .docx and .md formatting, editing text.', apps: ['wordcraft'], appId: 'wordcraft', prompt: BUILTIN_PROMPTS.word },
  deck: { id: 'deck', mention: 'deck-agent', name: 'Presentation Specialist', short: 'DeckCraft', app: 'deckcraft', accent: '#F97316', icon: 'layers', scope: 'Presentations: slide layout, visual storytelling, charts, .pptx generation.', apps: ['deckcraft'], appId: 'deckcraft', prompt: BUILTIN_PROMPTS.deck },
  pdf: { id: 'pdf', mention: 'pdf-agent', name: 'PDF & Compliance Specialist', short: 'PdfCraft', app: 'pdfcraft', accent: '#14B8A6', icon: 'shield', scope: 'PDF: extraction, verification, redaction review and signing.', apps: ['pdfcraft'], appId: 'pdfcraft', prompt: BUILTIN_PROMPTS.pdf },
  dev: { id: 'dev', mention: 'dev-agent', name: 'Code & System Specialist', short: 'Dev', app: 'code', accent: '#335CFF', icon: 'terminal', scope: 'Code editing, terminal commands and every MCP server that is not one of the Craft apps.', apps: ['code', 'terminal', 'project'], prompt: BUILTIN_PROMPTS.dev },
};

// One specialist for every other app of the catalog (src/chat/app-roles.ts): @photocraft-agent, @oxybrush-agent, ...
for (const r of APP_ROLES) {
  ROLE_DEFS[r.id] = { id: r.id, mention: r.mention, name: r.name, short: r.short, app: 'catalog', accent: r.accent, icon: 'spark', scope: r.scope, apps: [], prompt: r.prompt, appId: r.appId, ...(r.cli ? {} : { webOnly: true }) };
}

/** Role ids of the specialists that belong to an app of the catalog (the five historic ones with an app, and the generated ones). */
export const APP_ROLE_IDS: string[] = Object.values(ROLE_DEFS).filter((d) => d.appId).map((d) => d.id);

/** Read-only project tools every specialist may use to find files, read skills and see the apps. */
export const SHARED_TOOLS = ['list-files', 'search-files', 'search-project', 'panel-status', 'list-skills', 'read-skill', 'list-craft-apps', 'recent-files'];
/** What a specialist of a web-only app needs because the app has no tools: open it, read and write its files in the project. */
const WEB_APP_TOOLS = ['open-in-app', 'read-file', 'write-file', 'file-history'];

/** Does a tool name match one pattern? `*`, a prefix with `*`, `app:<id>` for a tool group, or exact. */
export function toolPatternMatches(pattern: string, tool: { name: string; app: string }): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('app:')) return tool.app === pattern.slice(4);
  if (pattern.endsWith('*')) return tool.name.startsWith(pattern.slice(0, -1));
  if (pattern.startsWith('*')) return tool.name.endsWith(pattern.slice(1));
  return tool.name === pattern;
}

/** May this role call the tool? Specialists get their app's tools plus the shared read tools. */
export function toolAllowed(role: TeamRoleId, tool: { name: string; app: string; source?: string }): boolean {
  if (role === 'leader') return false;
  if (SHARED_TOOLS.includes(tool.name)) return true;
  const def = ROLE_DEFS[role];
  // An agent you created: its own tool patterns (skills are always readable)
  if (def?.custom) return tool.name === 'read-skill' || tool.name === 'list-skills' || (def.tools || []).some((p) => toolPatternMatches(p, tool));
  if (!def) return false;
  // The MCP server of a Craft app belongs to the specialist of that app; every other external server to the Code & System Specialist
  if (tool.source === 'external') {
    const group = externalGroup(tool.name);
    const owner = group ? appOfGroup(group) : undefined;
    if (owner) return def.appId === owner.id;
    return role === 'dev';
  }
  // A web-only app has no tools of its own: its specialist opens the app and exchanges files through the project
  if (def.webOnly && WEB_APP_TOOLS.includes(tool.name)) return true;
  return def.apps.includes(tool.app);
}

/** Does this role's app have tools in a connected MCP server? (false: the specialist works through project files.) */
export const roleHasAppTools = (role: TeamRoleId): boolean => !!ROLE_DEFS[role]?.appId && !ROLE_DEFS[role]?.webOnly;

/** Role from what a model or a user wrote: "grid-agent", "@grid-agent", "GridCraft", "Data & Sheet Specialist", "grid". */
export function roleFromName(name: unknown): TeamRoleId | null {
  if (typeof name !== 'string') return null;
  const s = name.trim().replace(/^@/, '').toLowerCase();
  if (!s) return null;
  for (const r of Object.keys(ROLE_DEFS)) {
    const d = ROLE_DEFS[r]!;
    if (s === r || s === d.mention || s === d.short.toLowerCase() || s === d.name.toLowerCase() || s === d.app) return r;
  }
  // The agent of a catalog app by its id, its name or `<app>-agent`: "photocraft", "PhotoCraft", "@oxybrush-agent", "paint.rs"
  const app = APPS.find((a) => s === a.id || s === a.name.toLowerCase() || s === `${a.id}-agent` || s.replace(/[^a-z0-9]/g, '') === a.id.replace(/[^a-z0-9]/g, ''));
  if (app && ROLE_DEFS[roleIdOfApp(app.id)]) return roleIdOfApp(app.id);
  if (/sheet|grid|data|excel|xlsx|csv/.test(s)) return 'grid';
  if (/word|doc|copy|report|writer/.test(s)) return 'word';
  if (/deck|slide|present|pptx/.test(s)) return 'deck';
  if (/pdf|complian|sign|redact/.test(s)) return 'pdf';
  if (/dev|code|terminal|system|shell/.test(s)) return 'dev';
  if (/lead|orchestr/.test(s)) return 'leader';
  return null;
}

// ---------------------------------------------------------------- Configuration

export const EFFORT_CHOICES = ['auto', 'off', 'low', 'medium', 'high', 'max'] as const;
export type TeamEffort = (typeof EFFORT_CHOICES)[number];

/** An agent you create: name, role line for the leader, system prompt, model, tools, color and icon. */
export const AgentProfileSchema = z.object({
  id: z.string().regex(/^a-[a-z0-9-]{1,38}$/),
  name: z.string().min(1).max(60),
  /** One line the leader sees when it assigns work */
  role: z.string().max(240).default(''),
  /** System prompt of this agent */
  prompt: z.string().max(8000).default(''),
  /** Provider id; empty: the chat's provider */
  provider: z.string().max(80).default(''),
  model: z.string().max(120).default(''),
  effort: z.enum(['auto', 'off', 'low', 'medium', 'high', 'max']).default('auto'),
  /** Tool name patterns: `*`, `read-*`, `ext-photocraft-*`, `app:gridcraft` */
  tools: z.array(z.string().max(80)).max(40).default(['app:project']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6B7280'),
  icon: z.string().max(30).default('spark'),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const AGENT_ICONS = ['spark', 'bolt', 'user', 'code', 'book', 'pen', 'search', 'shield', 'database', 'cpu', 'terminal', 'globe', 'palette', 'trend', 'bug', 'layers', 'grid', 'file', 'image', 'headset'];
export const AGENT_COLORS = ['#6366F1', '#EC4899', '#F59E0B', '#22C55E', '#06B6D4', '#EF4444', '#8B5CF6', '#14B8A6', '#84CC16', '#F97316', '#0EA5E9', '#A855F7'];

/** `@mention` of a custom agent: a lowercase slug of its name. */
export const agentMention = (a: Pick<AgentProfile, 'id' | 'name'>) => a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || a.id.slice(2);

/** Registers the agents the user created, so roles, mentions, cards and tool scopes find them like the built-in ones. Replaces earlier ones. */
export function registerAgents(agents: readonly AgentProfile[] | undefined): void {
  for (const id of Object.keys(ROLE_DEFS)) if (ROLE_DEFS[id]!.custom) delete ROLE_DEFS[id];
  for (const a of agents || []) {
    const mention = agentMention(a);
    ROLE_DEFS[a.id] = { id: a.id, mention, name: a.name, short: a.name.slice(0, 14), app: 'custom', accent: a.color, icon: a.icon, scope: a.role || `${a.name}, an agent of your team.`, apps: [], custom: true, prompt: a.prompt, tools: a.tools };
  }
}

/** Team member of an agent profile (its model settings travel with the team). */
export const memberFromAgent = (a: AgentProfile): TeamMember => ({ role: a.id, enabled: true, provider: a.provider, model: a.model, effort: a.effort });

/** How the agents work together. */
export const PATTERNS = ['supervisor', 'sequential', 'parallel', 'human'] as const;
export type TeamPattern = (typeof PATTERNS)[number];
export const PATTERN_INFO: Record<TeamPattern, { name: string; text: string }> = {
  supervisor: { name: 'Supervisor and workers', text: 'The leader plans a task graph, the agents work on it (in parallel where tasks are independent) and the leader reviews every result.' },
  sequential: { name: 'Sequential', text: 'The agents work one after another in the order of the plan; each one receives the results before it.' },
  parallel: { name: 'Parallel', text: 'The agents work at the same time on independent tasks; the leader merges the results.' },
  human: { name: 'Human in the loop', text: 'Like supervisor and workers, but you approve the plan before any agent starts.' },
};

export const TeamMemberSchema = z.object({
  role: z.string().regex(/^[\w-]{1,40}$/),
  enabled: z.boolean().default(true),
  /** Provider id; empty: the chat's provider */
  provider: z.string().max(80).default(''),
  /** Model override; empty: the provider's model */
  model: z.string().max(120).default(''),
  effort: z.enum(EFFORT_CHOICES).default('auto'),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const TeamConfigSchema = z.object({
  id: z.string().regex(/^[\w-]{1,40}$/).default('custom'),
  name: z.string().min(1).max(60).default('Custom team'),
  leader: TeamMemberSchema,
  // 5 historic specialists + 40 app specialists + the agents you create (an ecosystem team has up to 9 apps)
  workers: z.array(TeamMemberSchema).max(64),
  /** Collaboration pattern (see PATTERNS) */
  pattern: z.enum(PATTERNS).default('supervisor'),
  /** Shared memory: what finished agents report is visible to every agent that starts later */
  sharedMemory: z.boolean().default(true),
  /** Sub-agents running at the same time */
  concurrency: z.number().int().min(1).max(6).default(3),
  /** leader: the leader model reviews every result; smart: only results the automatic checks doubt (saves one model call per task); checks: only the automatic checks */
  review: z.enum(['leader', 'smart', 'checks']).default('smart'),
  /** A request that is clearly about one specialist's app goes straight to that specialist: no planning, no review, no summary (saves three or more model calls) */
  autoRoute: z.boolean().default(true),
  /** Retries the leader may order per task */
  maxRetries: z.number().int().min(0).max(3).default(1),
});
export type TeamConfig = z.infer<typeof TeamConfigSchema>;

export const TeamSettingsSchema = z.object({
  active: TeamConfigSchema.optional(),
  /** Team configurations the user saved */
  saved: z.array(TeamConfigSchema).max(20).default([]),
  /** The agents the user created (roles, prompts, models, tools); teams use them by id */
  agents: z.array(AgentProfileSchema).max(40).default([]),
});
export type TeamSettings = z.infer<typeof TeamSettingsSchema>;

const member = (role: TeamRoleId, enabled = true, extra: Partial<TeamMember> = {}): TeamMember => ({ role, enabled, provider: '', model: '', effort: 'auto', ...extra });
const workers = (on: WorkerRoleId[], extra: Partial<TeamMember> = {}) => WORKER_ROLES.map((r) => member(r, on.includes(r), extra));

export interface TeamPreset extends TeamConfig {
  description: string;
}

export const TEAM_PRESETS: TeamPreset[] = [
  { id: 'studio', name: 'Full Studio Team', description: 'Every specialist; the leader reviews the results the automatic checks doubt.', leader: member('leader', true, { effort: 'high' }), workers: workers(['grid', 'word', 'deck', 'pdf', 'dev']), concurrency: 3, review: 'smart', maxRetries: 1, pattern: 'supervisor', sharedMemory: true, autoRoute: true },
  { id: 'executive-launch', name: 'Executive Launch Team', description: 'Figures from GridCraft, a report in WordCraft and slides in DeckCraft.', leader: member('leader', true, { effort: 'high' }), workers: workers(['grid', 'word', 'deck']), concurrency: 3, review: 'smart', maxRetries: 1, pattern: 'supervisor', sharedMemory: true, autoRoute: true },
  { id: 'financial-audit', name: 'Financial Audit Team', description: 'Sheets, PDF verification and a written audit note.', leader: member('leader', true, { effort: 'max' }), workers: workers(['grid', 'pdf', 'word']), concurrency: 3, review: 'leader', maxRetries: 2, pattern: 'supervisor', sharedMemory: true, autoRoute: true },
  { id: 'fullstack-dev', name: 'Fullstack Dev Team', description: 'Code and terminal with documentation in WordCraft.', leader: member('leader', true, { effort: 'high' }), workers: workers(['dev', 'word']), concurrency: 2, review: 'smart', maxRetries: 1, pattern: 'supervisor', sharedMemory: true, autoRoute: true },
  { id: 'hybrid-local', name: 'Fast Local/Hybrid Team', description: 'Cloud leader, fast local sub-agents on Ollama, automatic checks only.', leader: member('leader', true, { effort: 'medium' }), workers: workers(['grid', 'word', 'deck', 'pdf', 'dev'], { provider: 'ollama', effort: 'off' }), concurrency: 4, review: 'checks', maxRetries: 1, pattern: 'supervisor', sharedMemory: true, autoRoute: true },
];

TEAM_PRESETS.push(
  { id: 'pipeline', name: 'Document Pipeline', description: 'Sequential: figures in GridCraft, then the report in WordCraft, then the slides in DeckCraft, each one using the result before it.', leader: member('leader', true, { effort: 'high' }), workers: workers(['grid', 'word', 'deck']), concurrency: 1, review: 'smart', maxRetries: 1, pattern: 'sequential', sharedMemory: true, autoRoute: true },
  { id: 'checked-launch', name: 'Approved Launch Team', description: 'Human in the loop: you approve the plan before the agents start.', leader: member('leader', true, { effort: 'high' }), workers: workers(['grid', 'word', 'deck', 'pdf']), concurrency: 3, review: 'smart', maxRetries: 1, pattern: 'human', sharedMemory: true, autoRoute: true }
);

/**
 * The team of one workspace (ecosystem): the leader and one specialist for every app of it. The office apps use their
 * historic specialists (grid, word, deck, pdf), every other app its generated one (src/chat/app-roles.ts). Also used for
 * a workspace you made yourself (Create your own), so every set of apps has a ready-made team.
 */
export function ecosystemTeam(eco: Pick<Ecosystem, 'id' | 'name' | 'apps'>, id = `eco-${eco.id}`): TeamPreset {
  const roles = [...new Set(eco.apps.map((a) => roleIdOfApp(a)))].filter((r) => ROLE_DEFS[r]);
  const apps = roles.map((r) => ROLE_DEFS[r]!.short);
  const extra = roles.filter((r) => !WORKER_ROLES.includes(r));
  return {
    id,
    name: `${eco.name} Team`,
    description: `One specialist per app (${apps.join(', ')}). The leader gives each task to the specialist of the app it belongs to and passes files between them; a request about one app goes straight to its specialist.`,
    leader: member('leader', true, { effort: 'high' }),
    workers: [...WORKER_ROLES.map((r) => member(r, roles.includes(r))), ...extra.map((r) => member(r, true))],
    concurrency: Math.min(4, Math.max(2, roles.length)),
    review: 'smart',
    maxRetries: 1,
    pattern: 'supervisor',
    sharedMemory: true,
    autoRoute: true,
  };
}

// A ready-made team for each built-in workspace
TEAM_PRESETS.push(...ECOSYSTEMS.map((e) => ecosystemTeam(e)));

export const DEFAULT_TEAM: TeamConfig = structuredCloneSafe(TEAM_PRESETS[0]!);

function structuredCloneSafe<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** A complete configuration: every worker role exactly once, in the fixed order. */
export function normalizeTeam(input: unknown): TeamConfig {
  const parsed = TeamConfigSchema.safeParse(input);
  const base = parsed.success ? parsed.data : DEFAULT_TEAM;
  const byRole = new Map(base.workers.map((w) => [w.role, w]));
  // The five historic specialists keep their fixed order; app specialists and agents the user created follow, if they still exist
  const custom = base.workers.filter((w) => !WORKER_ROLES.includes(w.role) && ROLE_DEFS[w.role]);
  const cleaned: TeamConfig = {
    ...base,
    leader: { ...base.leader, role: 'leader', enabled: true },
    workers: [...WORKER_ROLES.map((r) => ({ ...(byRole.get(r) || member(r, false)), role: r })), ...custom],
  };
  // Without a single specialist the team cannot work: the defaults come back
  if (!cleaned.workers.some((w) => w.enabled)) cleaned.workers = structuredCloneSafe(DEFAULT_TEAM.workers);
  return cleaned;
}

export function presetById(id: string): TeamPreset | undefined {
  return TEAM_PRESETS.find((p) => p.id === id);
}

export const enabledWorkers = (cfg: TeamConfig, only?: WorkerRoleId[]): WorkerRoleId[] => cfg.workers.filter((w) => w.enabled && (!only || only.includes(w.role as WorkerRoleId))).map((w) => w.role as WorkerRoleId);

export const memberOf = (cfg: TeamConfig, role: TeamRoleId): TeamMember => (role === 'leader' ? cfg.leader : cfg.workers.find((w) => w.role === role) || member(role, false));

// ---------------------------------------------------------------- Task graph

export interface TaskNode {
  id: string;
  title: string;
  assignedAgent: WorkerRoleId;
  /** Task ids that must finish first */
  dependencies: string[];
  targetFiles: string[];
  instructions: string;
}

export interface TaskGraph {
  goal: string;
  tasks: TaskNode[];
}

export const MAX_TASKS = 10;

const RawTask = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  title: z.string().optional(),
  assignedAgent: z.unknown().optional(),
  agent: z.unknown().optional(),
  dependencies: z.array(z.union([z.string(), z.number()])).optional(),
  dependsOn: z.array(z.union([z.string(), z.number()])).optional(),
  targetFiles: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  instructions: z.string().optional(),
  description: z.string().optional(),
});

export interface ParsedGraph {
  graph: TaskGraph;
  /** Problems the model has to fix (unknown agents, cycles, missing tasks) */
  issues: string[];
  /** Notes on what the parser changed on its own (repaired JSON, dropped dependencies) */
  notes: string[];
  ok: boolean;
}

const normPath = (p: string) => '/' + p.trim().replace(/\\/g, '/').replace(/^@/, '').replace(/^\/+/, '');

/**
 * Reads the leader's plan. Accepts JSON in fences or with prose around it, {tasks: [...]} or a bare
 * array, and common key variants. Unknown or disabled agents and cycles are issues (the leader gets one
 * correction turn); with fallback: true they are repaired instead, so the run can always go on.
 */
export function parseTaskGraph(text: string, opt: { enabled: WorkerRoleId[]; fallback?: boolean }): ParsedGraph {
  const issues: string[] = [];
  const notes: string[] = [];
  const rep = repairJson(text);
  if (rep?.repaired) notes.push(...rep.notes);
  const v = rep?.value as { goal?: unknown; tasks?: unknown } | unknown[] | null | undefined;
  const list: unknown[] = Array.isArray(v) ? v : Array.isArray((v as { tasks?: unknown })?.tasks) ? ((v as { tasks: unknown[] }).tasks as unknown[]) : [];
  const goal = !Array.isArray(v) && typeof (v as { goal?: unknown })?.goal === 'string' ? String((v as { goal: string }).goal) : '';
  if (!rep) issues.push('The plan is not valid JSON. Answer with one JSON object {"goal": "...", "tasks": [...]}.');
  else if (!list.length) issues.push('The plan has no tasks. Give at least one task in "tasks".');
  if (list.length > MAX_TASKS) notes.push(`kept the first ${MAX_TASKS} of ${list.length} tasks`);

  const tasks: TaskNode[] = [];
  const seen = new Set<string>();
  list.slice(0, MAX_TASKS).forEach((raw, i) => {
    const r = RawTask.safeParse(raw);
    if (!r.success) return void issues.push(`Task ${i + 1} is not an object with id, title, assignedAgent, dependencies and targetFiles.`);
    const t = r.data;
    let id = String(t.id ?? `t${i + 1}`).trim().replace(/[^\w.-]/g, '-') || `t${i + 1}`;
    if (seen.has(id)) {
      notes.push(`renamed the duplicate task id ${id}`);
      id = `${id}-${i + 1}`;
    }
    seen.add(id);
    const rawAgent = t.assignedAgent ?? t.agent;
    let role = roleFromName(rawAgent);
    if (!role || role === 'leader') {
      issues.push(`Task ${id}: unknown agent ${JSON.stringify(rawAgent ?? null)}. Use one of: ${opt.enabled.map((x) => ROLE_DEFS[x].mention).join(', ')}.`);
      role = null;
    } else if (!opt.enabled.includes(role)) {
      issues.push(`Task ${id}: ${ROLE_DEFS[role].mention} is not on the team. Use one of: ${opt.enabled.map((x) => ROLE_DEFS[x].mention).join(', ')}.`);
    }
    const files = [...new Set([...(t.targetFiles || []), ...(t.files || [])].filter((f) => typeof f === 'string' && f.trim()).map(normPath))].slice(0, 12);
    tasks.push({
      id,
      title: (t.title || t.instructions || t.description || `Task ${i + 1}`).trim().slice(0, 160),
      assignedAgent: role || opt.enabled[0] || 'dev',
      dependencies: [...(t.dependencies || []), ...(t.dependsOn || [])].map((d) => String(d).trim()),
      targetFiles: files,
      instructions: (t.instructions || t.description || t.title || '').trim().slice(0, 6000),
    });
  });

  // Dependencies: known ids only, no self loops
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const deps: string[] = [];
    for (const d of t.dependencies) {
      if (d === t.id) notes.push(`removed the self dependency of ${t.id}`);
      else if (!ids.has(d)) issues.push(`Task ${t.id} depends on ${d}, which is not in the plan.`);
      else if (!deps.includes(d)) deps.push(d);
    }
    t.dependencies = deps;
  }
  const cycle = findCycle(tasks);
  if (cycle) issues.push(`The dependencies form a cycle: ${cycle.join(' -> ')}. Dependencies must point to earlier work only.`);

  if (opt.fallback && issues.length) {
    // Repair instead of failing: disabled agents go to the first specialist on the team, dependencies
    // only point to earlier tasks (always acyclic), unknown dependencies were dropped above
    for (const t of tasks) if (!opt.enabled.includes(t.assignedAgent)) t.assignedAgent = opt.enabled[0] || t.assignedAgent;
    if (cycle) {
      const order = new Map(tasks.map((t, i) => [t.id, i]));
      for (const t of tasks) t.dependencies = t.dependencies.filter((d) => order.get(d)! < order.get(t.id)!);
    }
    notes.push(...issues.map((x) => `repaired: ${x}`));
    return { graph: { goal, tasks }, issues: [], notes, ok: tasks.length > 0 };
  }
  return { graph: { goal, tasks }, issues, notes, ok: !issues.length && tasks.length > 0 };
}

/** One cycle as a list of ids, or null. */
export function findCycle(tasks: Pick<TaskNode, 'id' | 'dependencies'>[]): string[] | null {
  const deps = new Map(tasks.map((t) => [t.id, t.dependencies]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) || []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const t of tasks) {
    const c = visit(t.id);
    if (c) return c;
  }
  return null;
}

/** Topological levels: level 0 has no dependencies, level n depends on levels below n. */
export function levels(tasks: Pick<TaskNode, 'id' | 'dependencies'>[]): string[][] {
  const level = new Map<string, number>();
  const deps = new Map(tasks.map((t) => [t.id, t.dependencies]));
  const of = (id: string, guard = 0): number => {
    if (level.has(id)) return level.get(id)!;
    if (guard > tasks.length) return 0;
    const l = Math.max(-1, ...(deps.get(id) || []).map((d) => of(d, guard + 1))) + 1;
    level.set(id, l);
    return l;
  };
  const out: string[][] = [];
  for (const t of tasks) (out[of(t.id)] ||= []).push(t.id);
  return out.filter(Boolean);
}

// ---------------------------------------------------------------- Prompts (model-facing, English)

const LANG_RULE = (de: boolean) => (de ? 'Write in German.' : 'Write in the language of the user (English by default).');

export function rosterLines(enabled: WorkerRoleId[]): string {
  return enabled
    .map((r) => {
      const d = ROLE_DEFS[r]!;
      const app = d.appId ? APPS.find((a) => a.id === d.appId) : undefined;
      // The leader plans better when it knows which files an app takes and where new ones go
      const files = app ? ` Takes ${app.opens.slice(0, 6).map((e) => '.' + e).join(' ') || 'its own files'}; new files go to ${app.folder}.${d.webOnly ? ' No tools of its own: it prepares files and opens the app for you.' : ''}` : '';
      return `- ${d.mention}: ${d.name}. ${d.scope}${files}`;
    })
    .join('\n');
}

const PATTERN_RULE: Record<TeamPattern, string> = {
  supervisor: '',
  sequential: 'Pattern: sequential. The tasks run one after another in the order you list them, so list them in the order of the work. Each agent receives the results before it.',
  parallel: 'Pattern: parallel. All tasks run at the same time, so give every task what it needs in its own instructions and use no dependencies.',
  human: '',
};

export function planSystem(enabled: WorkerRoleId[], extra = '', pattern: TeamPattern = 'supervisor'): string {
  return [
    'You are the Team Leader of a WorkCraft AI team. WorkCraft is a local workspace with WordCraft (documents), GridCraft (spreadsheets), DeckCraft (presentations), PdfCraft (PDF), a code editor and a terminal, and it can connect the other Craft apps (photos, vector art, video, audio, CAD and more). Each app has its own specialist.',
    PATTERN_RULE[pattern],
    'You do not call tools yourself. You break the request into tasks for your specialist sub-agents.',
    'Answer with ONLY one JSON object, no prose, no Markdown:',
    '{"goal": "one sentence", "tasks": [{"id": "t1", "title": "short title", "assignedAgent": "grid-agent", "dependencies": [], "targetFiles": ["/sheets/budget.xlsx"], "instructions": "precise instructions"}]}',
    'Your specialists:',
    rosterLines(enabled),
    'Rules:',
    '1. assignedAgent is one of the mentions above. Give each task to the specialist whose tools fit.',
    '2. dependencies lists the ids of tasks that must finish first; their results are passed on. Tasks without open dependencies run at the same time, so only add a dependency when the task needs the other result.',
    '3. Two tasks that write the same file must depend on each other.',
    '4. targetFiles are project paths starting with / (read or written by the task). New files go to the folder named with the specialist (/documents, /sheets, /presentations, /pdf and the folders of the other apps).',
    '4b. One app, one result per task. When a file made in one app is the input of another app, give the second task a dependency on the first and name the file in targetFiles.',
    `5. At most ${MAX_TASKS} tasks, usually two to five. Instructions say exactly what to read, what to write and which figures to use.`,
    extra,
  ]
    .filter(Boolean)
    .join('\n');
}

export function reviewSystem(): string {
  return [
    'You are the Team Leader of a WorkCraft AI team reviewing the work of one specialist sub-agent.',
    'Check the result against the task goal. Failed tool calls, missing files and incomplete figures are reasons to reject.',
    'Answer with ONLY one JSON object: {"accept": true} or {"accept": false, "instruction": "targeted instruction for the retry: what is missing and how to fix it", "note": "one short sentence"}.',
  ].join('\n');
}

export function reviewInput(task: TaskNode, out: WorkerOutput, findings: string[]): string {
  const calls = out.toolCalls.map((c) => `- ${c.name}${c.path ? ` ${c.path}` : ''}: ${c.ok ? 'ok' : `failed: ${(c.text || '').slice(0, 300)}`}`).join('\n');
  return [
    `Task ${task.id} (${ROLE_DEFS[task.assignedAgent].mention}): ${task.title}`,
    `Instructions: ${task.instructions}`,
    task.targetFiles.length ? `Target files: ${task.targetFiles.join(', ')}` : '',
    `Tool calls:\n${calls || '- none'}`,
    out.changed.length ? `Files changed: ${out.changed.join(', ')}` : 'Files changed: none',
    findings.length ? `Automatic checks found:\n${findings.map((f) => `- ${f}`).join('\n')}` : 'Automatic checks: passed',
    `Report of the sub-agent:\n${out.text.slice(0, 6000) || '(empty)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function synthesisSystem(de: boolean): string {
  return [
    'You are the Team Leader of a WorkCraft AI team. Your specialists finished their tasks.',
    `Write the final answer to the user: what the team did, the key figures, and every file created or changed with its path. Mention tasks that failed. Short and to the point, two to eight lines. ${LANG_RULE(de)}`,
    'Do not invent results that are not in the reports.',
  ].join('\n');
}

export function synthesisInput(prompt: string, tasks: TaskState[]): string {
  return [
    `Request of the user:\n${prompt}`,
    ...tasks.map((t) => `Task ${t.id} (${ROLE_DEFS[t.assignedAgent].name}, ${t.status}${t.attempts > 1 ? `, ${t.attempts} attempts` : ''}): ${t.title}\nFiles: ${t.changed.join(', ') || 'none'}\nReport: ${(t.output || t.error || '').slice(0, 3000)}`),
  ].join('\n\n');
}

export function workerSystem(role: WorkerRoleId, de: boolean, personal = ''): string {
  const d = ROLE_DEFS[role];
  return [
    `You are the ${d.name} (${d.mention}) of a WorkCraft AI team. The Team Leader gave you one task. Other specialists work on other tasks at the same time.`,
    `Your scope: ${d.scope}`,
    d.prompt ? `Your instructions:\n${d.prompt}` : '',
    'Skills explain how to drive the apps (commands, file formats, pitfalls): read one with read-skill before you use an app you are not sure about.',
    'You work on the project files directly through MCP tools; the open apps show changes right away.',
    'Rules:',
    '1. Use tools instead of making up file contents. Read data before you evaluate it.',
    '2. Results of the tasks you depend on are in the <dependencies> block. Use their figures exactly.',
    '3. Write only your target files unless the task says otherwise. Paths start with /.',
    '4. If a tool reports an error, fix the arguments. Do not repeat the same failing call.',
    `5. End with a short report: what you did, the key figures and the files you changed. ${LANG_RULE(de)}`,
    personal,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Shared memory of a team run: one line per finished task, visible to every agent that starts later. */
export interface MemoryNote {
  task: string;
  agent: WorkerRoleId;
  text: string;
  files: string[];
}

export function memoryBlock(notes: MemoryNote[], exclude: string[] = []): string {
  const rows = notes.filter((n) => !exclude.includes(n.task));
  if (!rows.length) return '';
  return `<team-memory>\nWhat the other agents have done so far (shared with the whole team):\n${rows.map((n) => `- ${n.task} (${ROLE_DEFS[n.agent]?.mention || n.agent}): ${n.text}${n.files.length ? ` [files: ${n.files.join(', ')}]` : ''}`).join('\n')}\n</team-memory>`;
}

export function workerInput(task: TaskNode, deps: DependencyResult[], feedback?: string, context = '', memory = ''): string {
  return [
    `Task ${task.id}: ${task.title}`,
    task.instructions,
    task.targetFiles.length ? `Target files: ${task.targetFiles.join(', ')}` : '',
    memory,
    deps.length ? `<dependencies>\n${deps.map((d) => `<result task="${d.id}" agent="${ROLE_DEFS[d.agent].mention}" title="${d.title.replace(/"/g, "'")}">\nFiles: ${d.changed.join(', ') || 'none'}\n${d.output.slice(0, 4000)}\n</result>`).join('\n')}\n</dependencies>` : '',
    feedback ? `<leader-feedback>\nThe Team Leader rejected your last attempt. Fix exactly this:\n${feedback}\n</leader-feedback>` : '',
    context,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------- Run state

export type TeamPhase = 'planning' | 'delegating' | 'reviewing' | 'completed' | 'stopped' | 'failed';
export type TaskStatus = 'pending' | 'running' | 'review' | 'retry' | 'done' | 'failed' | 'cancelled' | 'skipped';

export interface ToolCallSummary {
  name: string;
  ok: boolean;
  text?: string;
  path?: string;
}

export interface WorkerOutput {
  text: string;
  changed: string[];
  toolCalls: ToolCallSummary[];
  error?: string;
}

export interface ReviewVerdict {
  accept: boolean;
  instruction?: string;
  note?: string;
}

export interface DependencyResult {
  id: string;
  title: string;
  agent: WorkerRoleId;
  output: string;
  changed: string[];
}

export interface TaskState extends TaskNode {
  status: TaskStatus;
  attempts: number;
  started?: number;
  ended?: number;
  /** Final report of the sub-agent */
  output?: string;
  error?: string;
  changed: string[];
  toolCalls: ToolCallSummary[];
  /** Retry instructions of the leader, oldest first */
  feedback: string[];
  /** Last review note of the leader */
  verdict?: string;
  /** Live status line (thinking, tool call, waiting for a lock) */
  activity?: string;
  /** MCP tool running right now */
  tool?: string;
  /** Inline approval the user has to answer */
  approval?: { tool: string; title: string; args: Record<string, unknown> };
}

export interface TeamState {
  id: string;
  prompt: string;
  phase: TeamPhase;
  started: number;
  ended?: number;
  /** Direct @agent addressing: no planning, no leader review */
  direct?: boolean;
  goal?: string;
  tasks: TaskState[];
  /** Parser notes and problems of the plan */
  notes: string[];
  /** Raw plan of the leader (export) */
  plan?: string;
  leader: { activity?: string; reviews: { task: string; attempt: number; accept: boolean; note?: string; instruction?: string }[] };
  /** Tokens, latency and cost per role */
  usage: Record<string, RoleUsage>;
  summary?: string;
  error?: string;
  /** Snapshot of the configuration the run used */
  roster: { role: TeamRoleId; provider: string; model: string; effort: string }[];
  concurrency: number;
  /** Collaboration pattern of the run */
  pattern: TeamPattern;
  /** Shared memory: one note per finished task */
  memory: MemoryNote[];
  /** The request went straight to one specialist (autoRoute): no planning, no review, no summary */
  routed?: boolean;
  /** Human in the loop: the plan waits for the user's approval */
  awaitingApproval?: boolean;
}

/** Calls into the models. The interface talks to the backend, the tests use scripted drivers. */
export interface TeamDriver {
  plan(prompt: string, correction: string | null, signal: AbortSignal): Promise<string>;
  /** Human in the loop: show the plan and answer whether the agents may start */
  approvePlan?(graph: TaskGraph, signal: AbortSignal): Promise<boolean>;
  work(task: TaskState, input: { deps: DependencyResult[]; feedback?: string; attempt: number; memory: string }, signal: AbortSignal): Promise<WorkerOutput>;
  review?(task: TaskState, out: WorkerOutput, findings: string[], signal: AbortSignal): Promise<ReviewVerdict>;
  synthesize(prompt: string, tasks: TaskState[], signal: AbortSignal): Promise<string>;
}

export interface TeamRunOptions {
  config: TeamConfig;
  driver: TeamDriver;
  /** Skip planning: run this graph (direct @agent addressing) */
  graph?: TaskGraph;
  /** Only these specialists (several @agent mentions) */
  only?: WorkerRoleId[];
  onUpdate?: (state: TeamState) => void;
  id?: string;
  now?: () => number;
}

const ABORT = 'Stopped by the user.';

/** Automatic checks of a worker result: errors, failed tool calls that were never fixed, empty output. */
export function checkOutput(task: TaskNode, out: WorkerOutput): string[] {
  const findings: string[] = [];
  if (out.error) findings.push(`The sub-agent stopped with an error: ${out.error}`);
  const okNames = new Set(out.toolCalls.filter((c) => c.ok).map((c) => `${c.name}|${c.path || ''}`));
  for (const c of out.toolCalls) if (!c.ok && !okNames.has(`${c.name}|${c.path || ''}`)) findings.push(`${c.name}${c.path ? ` on ${c.path}` : ''} failed: ${(c.text || 'no message').slice(0, 200)}`);
  if (!out.text.trim() && !out.changed.length && !out.toolCalls.length) findings.push('The sub-agent returned nothing.');
  void task;
  return [...new Set(findings)];
}

/**
 * Does the leader model look at this result? leader: always. checks: never (the automatic checks decide). smart: when the
 * checks found a problem, or the agent neither called a tool nor changed a file (it may have answered from memory), which
 * are the cases a model call can help with; a clean run with tool calls is accepted without paying for a review.
 */
export function needsLeaderReview(mode: TeamConfig['review'], findings: string[], out: WorkerOutput): boolean {
  if (mode === 'leader') return true;
  if (mode === 'checks') return false;
  return findings.length > 0 || (!out.toolCalls.length && !out.changed.length);
}

const SHEET_EXT = ['xlsx', 'xls', 'ods', 'csv', 'tsv'];
const DOC_EXT = ['docx', 'doc', 'odt', 'md', 'txt', 'rtf'];
const DECK_EXT = ['pptx', 'ppt', 'odp'];
const CODE_EXT = ['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'cs', 'php', 'rb', 'json', 'yml', 'yaml', 'html', 'css', 'sh', 'ps1'];
/** Words that make a request more than one job. */
const MULTI_STEP = /\b(and then|then|after that|afterwards|also|as well|compare|combine|merge|based on|turn (?:it|them|this) into|plus|both|each of|all of|everything)\b|[;]/i;

/** Which specialists a request is about, from the files it names and the words it uses. */
export function rolesOfRequest(prompt: string, paths: string[], enabled: WorkerRoleId[]): WorkerRoleId[] {
  const roles = new Set<WorkerRoleId>();
  for (const p of paths) {
    const ext = (p.split('.').pop() || '').toLowerCase();
    if (SHEET_EXT.includes(ext)) roles.add('grid');
    else if (DOC_EXT.includes(ext)) roles.add('word');
    else if (DECK_EXT.includes(ext)) roles.add('deck');
    else if (ext === 'pdf') roles.add('pdf');
    else if (CODE_EXT.includes(ext)) roles.add('dev');
    else for (const a of nativeAppsOf(ext)) roles.add(roleIdOfApp(a.id));
  }
  const t = prompt.toLowerCase();
  // Any other app by its name or id ("in PhotoCraft", "with oxybrush", "Paint.RS")
  for (const a of APPS) {
    if (a.id in OFFICE_ROLE) continue;
    const names = new Set([a.id, a.name.toLowerCase(), a.id.replace(/-/g, ' ')]);
    if ([...names].some((n) => new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(t))) roles.add(roleIdOfApp(a.id));
  }
  if (/\b(spreadsheet|sheet|csv|excel|formula|pivot|gridcraft)\b/.test(t)) roles.add('grid');
  if (/\b(document|report|letter|memo|essay|docx|wordcraft)\b/.test(t)) roles.add('word');
  if (/\b(slide|slides|presentation|deck|pptx|deckcraft)\b/.test(t)) roles.add('deck');
  if (/\b(pdf|redact|signature|pdfcraft)\b/.test(t)) roles.add('pdf');
  if (/\b(code|script|terminal|command|npm|git|function|bug)\b/.test(t)) roles.add('dev');
  return [...roles].filter((r) => enabled.includes(r));
}

/**
 * A request about exactly one specialist's app, short and in one step, goes straight to that specialist. The team
 * would plan, review and summarize a job one agent does alone, which is three or more model calls for nothing.
 * Naming a second app, several steps or a long text keeps the team. Returns null when the team should plan.
 */
export function autoRoute(prompt: string, paths: string[], enabled: WorkerRoleId[]): { role: WorkerRoleId } | null {
  const text = prompt.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 320 || MULTI_STEP.test(text)) return null;
  const roles = rolesOfRequest(text, paths, enabled);
  if (roles.length !== 1) return null;
  // Every file that is named has to belong to that one specialist, otherwise the job crosses apps
  const all = rolesOfRequest('', paths, [...new Set([...WORKER_ROLES, ...enabled])]);
  if (all.length > 1) return null;
  return { role: roles[0]! };
}

/** Retry instruction from the automatic checks when the leader does not review. */
export function instructionFrom(findings: string[]): string {
  return `Fix these problems and finish the task:\n${findings.map((f) => `- ${f}`).join('\n')}`;
}

/** Reads the leader's review answer; malformed answers accept when the checks passed. */
export function parseVerdict(text: string, findings: string[]): ReviewVerdict {
  const r = repairJson(text)?.value as { accept?: unknown; instruction?: unknown; note?: unknown } | undefined;
  if (r && typeof r === 'object' && typeof r.accept === 'boolean') {
    const v: ReviewVerdict = { accept: r.accept };
    if (typeof r.instruction === 'string' && r.instruction.trim()) v.instruction = r.instruction.trim().slice(0, 2000);
    if (typeof r.note === 'string' && r.note.trim()) v.note = r.note.trim().slice(0, 300);
    if (!v.accept && !v.instruction) v.instruction = findings.length ? instructionFrom(findings) : 'Complete the task as instructed and report the result.';
    return v;
  }
  return findings.length ? { accept: false, instruction: instructionFrom(findings), note: 'review answer unreadable, automatic checks failed' } : { accept: true, note: 'review answer unreadable, automatic checks passed' };
}

/**
 * One team answer: plan, parallel work with per-task review and retries, synthesis.
 * stop() ends everything (master AbortController), cancel(id) ends one sub-agent; the others go on.
 */
export class TeamRun {
  readonly state: TeamState;
  private master = new AbortController();
  private workers = new Map<string, AbortController>();
  private cancelled = new Set<string>();
  private now: () => number;

  constructor(private opt: TeamRunOptions) {
    this.now = opt.now || (() => Date.now());
    const cfg = opt.config;
    this.state = {
      id: opt.id || `team-${Math.random().toString(36).slice(2, 9)}`,
      prompt: '',
      phase: 'planning',
      started: this.now(),
      tasks: [],
      notes: [],
      leader: { reviews: [] },
      usage: {},
      roster: [cfg.leader, ...cfg.workers.filter((w) => w.enabled && (!opt.only || opt.only.includes(w.role as WorkerRoleId)))].map((m) => ({ role: m.role, provider: m.provider, model: m.model, effort: m.effort })),
      concurrency: cfg.concurrency,
      pattern: cfg.pattern,
      memory: [],
      ...(opt.graph ? { direct: true } : {}),
    };
  }

  get signal(): AbortSignal {
    return this.master.signal;
  }

  get running(): boolean {
    return !['completed', 'stopped', 'failed'].includes(this.state.phase);
  }

  /** Active sub-agents right now. */
  get active(): number {
    return this.state.tasks.filter((t) => t.status === 'running').length;
  }

  emit(): void {
    this.opt.onUpdate?.(this.state);
  }

  /** Token usage of one model request of a role (leader or a specialist). */
  addUsage(role: TeamRoleId, u: TokenUsage, toolCalls = 0): void {
    addRoleUsage(this.state.usage, role, u, toolCalls);
    this.emit();
  }

  addToolCall(role: TeamRoleId, ok: boolean, ms: number): void {
    const r = this.state.usage[role];
    if (r) {
      r.toolCalls = (r.toolCalls || 0) + 1;
      r.toolOk = (r.toolOk || 0) + (ok ? 1 : 0);
      r.toolMs = (r.toolMs || 0) + ms;
    }
  }

  stop(): void {
    if (!this.master.signal.aborted) this.master.abort();
  }

  /** Cancels one sub-agent. Tasks that depend on it are skipped, the rest of the team goes on. */
  cancel(taskId: string): void {
    const t = this.state.tasks.find((x) => x.id === taskId);
    if (!t) return;
    this.cancelled.add(taskId);
    if (t.status === 'pending') {
      t.status = 'cancelled';
      t.ended = this.now();
      this.emit();
    }
    this.workers.get(taskId)?.abort();
  }

  async run(prompt: string): Promise<TeamState> {
    const s = this.state;
    s.prompt = prompt;
    const enabled = enabledWorkers(this.opt.config, this.opt.only);
    try {
      // Stage 1: plan
      let graph = this.opt.graph;
      if (!graph) {
        s.phase = 'planning';
        s.leader.activity = 'Breaking the request into tasks';
        this.emit();
        let text = await this.opt.driver.plan(prompt, null, this.signal);
        s.plan = text;
        let parsed = parseTaskGraph(text, { enabled });
        if (!parsed.ok && !this.signal.aborted) {
          // One correction turn for the leader, then the parser repairs what is left
          s.notes.push(...parsed.issues.map((x) => `plan corrected: ${x}`));
          s.leader.activity = 'Correcting the plan';
          this.emit();
          text = await this.opt.driver.plan(prompt, parsed.issues.join('\n'), this.signal);
          s.plan = text;
          parsed = parseTaskGraph(text, { enabled, fallback: true });
        }
        s.notes.push(...parsed.notes);
        if (!parsed.graph.tasks.length) throw new Error('The Team Leader returned no tasks.');
        graph = parsed.graph;
      }
      graph = applyPattern(graph, this.opt.config.pattern);
      // Human in the loop: nothing starts before the user approves the plan
      if (this.opt.config.pattern === 'human' && !s.direct && this.opt.driver.approvePlan) {
        s.goal = graph.goal;
        s.awaitingApproval = true;
        s.leader.activity = 'Waiting for your approval of the plan';
        s.tasks = graph.tasks.map((t) => ({ ...t, status: 'pending', attempts: 0, changed: [], toolCalls: [], feedback: [] }));
        this.emit();
        const ok = await this.opt.driver.approvePlan(graph, this.signal);
        s.awaitingApproval = false;
        if (!ok) {
          this.stop();
          throw abortError();
        }
      }
      s.goal = graph.goal;
      s.tasks = graph.tasks.map((t) => ({ ...t, status: 'pending', attempts: 0, changed: [], toolCalls: [], feedback: [] }));
      s.leader.activity = undefined;
      // Stage 2 and 3: work and review
      await this.schedule();
      if (this.signal.aborted) throw abortError();
      // Final synthesis
      s.phase = 'reviewing';
      s.leader.activity = s.direct ? undefined : 'Writing the summary';
      this.emit();
      const ok = s.tasks.filter((t) => t.status === 'done');
      if (s.direct && s.tasks.length === 1) s.summary = s.tasks[0]!.output || s.tasks[0]!.error || '';
      else s.summary = await this.opt.driver.synthesize(prompt, s.tasks, this.signal);
      s.phase = ok.length || !s.tasks.length ? 'completed' : 'failed';
      if (s.phase === 'failed') s.error ||= 'No task finished.';
    } catch (e) {
      const aborted = this.signal.aborted || (e as Error).name === 'AbortError';
      s.phase = aborted ? 'stopped' : 'failed';
      if (!aborted) s.error = (e as Error).message;
      for (const t of s.tasks) {
        if (t.status === 'pending' || t.status === 'running' || t.status === 'review' || t.status === 'retry') {
          t.status = aborted ? 'cancelled' : 'skipped';
          t.ended ||= this.now();
          t.approval = undefined;
        }
      }
      if (aborted) s.summary = partialSummary(s);
    } finally {
      s.leader.activity = undefined;
      s.ended = this.now();
      for (const t of s.tasks) (t.activity = undefined), (t.tool = undefined);
      this.emit();
    }
    return s;
  }

  /** Starts every ready task up to the concurrency limit; dependents start as soon as theirs are done. */
  private async schedule(): Promise<void> {
    const s = this.state;
    const running = new Map<string, Promise<void>>();
    const limit = Math.max(1, this.opt.config.concurrency);
    const byId = new Map(s.tasks.map((t) => [t.id, t]));
    for (;;) {
      if (this.signal.aborted) break;
      // A task whose dependency failed or was cancelled cannot run
      let changed = false;
      for (const t of s.tasks) {
        if (t.status !== 'pending') continue;
        const bad = t.dependencies.map((d) => byId.get(d)!).find((d) => d && ['failed', 'cancelled', 'skipped'].includes(d.status));
        if (bad) {
          t.status = 'skipped';
          t.error = `Skipped: ${bad.id} ${bad.status === 'cancelled' ? 'was cancelled' : 'did not finish'}.`;
          t.ended = this.now();
          changed = true;
        }
      }
      const ready = s.tasks.filter((t) => t.status === 'pending' && t.dependencies.every((d) => byId.get(d)?.status === 'done'));
      for (const t of ready) {
        if (running.size >= limit) break;
        const p = this.runTask(t).finally(() => running.delete(t.id));
        running.set(t.id, p);
        changed = true;
      }
      if (changed) {
        s.phase = 'delegating';
        this.emit();
      }
      if (!running.size) break;
      await Promise.race(running.values());
    }
    // Drain: every sub-agent ends (also after Stop All, their streams close through the signal)
    await Promise.allSettled(running.values());
  }

  private async runTask(t: TaskState): Promise<void> {
    const s = this.state;
    const byId = new Map(s.tasks.map((x) => [x.id, x]));
    const deps: DependencyResult[] = t.dependencies.map((d) => byId.get(d)!).map((d) => ({ id: d.id, title: d.title, agent: d.assignedAgent, output: d.output || '', changed: d.changed }));
    const max = 1 + Math.max(0, this.opt.config.maxRetries);
    for (let attempt = 1; attempt <= max; attempt++) {
      const ac = new AbortController();
      const onMaster = () => ac.abort();
      this.master.signal.addEventListener('abort', onMaster, { once: true });
      this.workers.set(t.id, ac);
      t.status = attempt > 1 ? 'retry' : 'running';
      t.attempts = attempt;
      t.started ??= this.now();
      t.activity = attempt > 1 ? 'Retrying with the leader feedback' : 'Starting';
      this.emit();
      t.status = 'running';
      let out: WorkerOutput;
      try {
        if (this.cancelled.has(t.id)) ac.abort();
        out = await this.opt.driver.work(t, { deps, feedback: t.feedback.at(-1), attempt, memory: this.opt.config.sharedMemory ? memoryBlock(s.memory, [t.id, ...t.dependencies]) : '' }, ac.signal);
      } catch (e) {
        out = { text: '', changed: [], toolCalls: [], error: (e as Error).message };
      } finally {
        this.master.signal.removeEventListener('abort', onMaster);
        this.workers.delete(t.id);
      }
      t.tool = undefined;
      t.approval = undefined;
      t.changed = [...new Set([...t.changed, ...out.changed])];
      t.toolCalls.push(...out.toolCalls);
      if (ac.signal.aborted) {
        t.status = 'cancelled';
        t.output = out.text || t.output;
        t.error = ABORT;
        t.ended = this.now();
        t.activity = undefined;
        this.emit();
        return;
      }
      t.output = out.text;
      t.error = out.error;
      // Stage 3: review
      const findings = checkOutput(t, out);
      let verdict: ReviewVerdict;
      if (needsLeaderReview(this.opt.config.review, findings, out) && this.opt.driver.review && !s.direct) {
        t.status = 'review';
        t.activity = 'The Team Leader reviews the result';
        s.phase = this.active ? 'delegating' : 'reviewing';
        s.leader.activity = `Reviewing ${t.id}`;
        this.emit();
        try {
          verdict = await this.opt.driver.review(t, out, findings, this.signal);
        } catch (e) {
          if (this.signal.aborted) throw e;
          verdict = findings.length ? { accept: false, instruction: instructionFrom(findings), note: `review failed: ${(e as Error).message}` } : { accept: true, note: 'review failed, automatic checks passed' };
        }
        if (s.leader.activity === `Reviewing ${t.id}`) s.leader.activity = undefined;
      } else verdict = findings.length ? { accept: false, instruction: instructionFrom(findings), note: findings[0] } : { accept: true };
      if (this.cancelled.has(t.id)) {
        t.status = 'cancelled';
        t.error = ABORT;
        t.ended = this.now();
        t.activity = undefined;
        this.emit();
        return;
      }
      s.leader.reviews.push({ task: t.id, attempt, accept: verdict.accept, ...(verdict.note ? { note: verdict.note } : {}), ...(verdict.instruction && !verdict.accept ? { instruction: verdict.instruction } : {}) });
      t.verdict = verdict.note;
      if (verdict.accept) {
        t.status = 'done';
        t.ended = this.now();
        t.activity = undefined;
        // Shared memory: the next agents see what this one did
        s.memory = [...s.memory.filter((n) => n.task !== t.id), { task: t.id, agent: t.assignedAgent, text: (t.output || t.title).replace(/\s+/g, ' ').trim().slice(0, 400), files: t.changed.slice(0, 8) }].slice(-20);
        this.emit();
        return;
      }
      if (attempt < max && !this.cancelled.has(t.id)) {
        t.feedback.push(verdict.instruction || instructionFrom(findings));
        t.status = 'retry';
        this.emit();
        continue;
      }
      t.status = 'failed';
      t.error ||= verdict.note || findings[0] || 'Rejected by the Team Leader.';
      t.ended = this.now();
      t.activity = undefined;
      this.emit();
      return;
    }
  }
}

/**
 * The collaboration pattern applied to a plan. Sequential chains the tasks in plan order (each one depends on the
 * one before); parallel drops every dependency; supervisor and human keep the leader's graph.
 */
export function applyPattern(graph: TaskGraph, pattern: TeamPattern): TaskGraph {
  if (pattern === 'sequential') return { ...graph, tasks: graph.tasks.map((t, i) => ({ ...t, dependencies: i ? [graph.tasks[i - 1]!.id] : [] })) };
  if (pattern === 'parallel') return { ...graph, tasks: graph.tasks.map((t) => ({ ...t, dependencies: [] })) };
  return graph;
}

function abortError(): Error {
  return Object.assign(new Error(ABORT), { name: 'AbortError' });
}

/** What a stopped run leaves behind. */
export function partialSummary(s: TeamState): string {
  const done = s.tasks.filter((t) => t.status === 'done');
  const files = [...new Set(done.flatMap((t) => t.changed))];
  return [`Team stopped. ${done.length} of ${s.tasks.length} tasks finished.`, files.length ? `Files written: ${files.join(', ')}` : ''].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Export

export function teamToMarkdown(s: TeamState, threadMd?: (taskId: string) => string): string {
  const out: string[] = [];
  out.push(`#### Team Mission Control: ${s.phase}${s.ended ? `, ${((s.ended - s.started) / 1000).toFixed(1)} s` : ''}`);
  if (s.goal) out.push(`Goal: ${s.goal}`);
  out.push(`Roster: ${s.roster.map((r) => `${ROLE_DEFS[r.role].name} (${r.provider || 'default'}${r.model ? ` · ${r.model}` : ''}${r.effort !== 'auto' ? ` · ${r.effort}` : ''})`).join('; ')}`);
  if (s.tasks.length) {
    out.push(['| Task | Agent | Depends on | Target files | Status | Attempts |', '|---|---|---|---|---|---|', ...s.tasks.map((t) => `| ${t.id} ${t.title.replace(/\|/g, '/')} | ${ROLE_DEFS[t.assignedAgent].mention} | ${t.dependencies.join(', ') || '–'} | ${t.targetFiles.join(', ') || '–'} | ${t.status} | ${t.attempts} |`)].join('\n'));
  }
  const roles = Object.values(s.usage);
  if (roles.length) out.push(['| Role | Model | Input | Output | Cached | Requests | Latency |', '|---|---|---|---|---|---|---|', ...roles.map((r) => `| ${ROLE_DEFS[r.role as TeamRoleId]?.name || r.role} | ${r.model} | ${r.input} | ${r.output} | ${r.cached} | ${r.requests} | ${r.totalMs} ms |`)].join('\n'));
  for (const rv of s.leader.reviews) out.push(`Review ${rv.task} attempt ${rv.attempt}: ${rv.accept ? 'accepted' : 'retry'}${rv.note ? `, ${rv.note}` : ''}${rv.instruction ? `\n> ${rv.instruction.replace(/\n/g, '\n> ')}` : ''}`);
  for (const t of s.tasks) {
    out.push(`##### Sub-agent ${ROLE_DEFS[t.assignedAgent].name}: ${t.id} ${t.title}`);
    if (t.feedback.length) out.push(t.feedback.map((f, i) => `Leader feedback ${i + 1}: ${f}`).join('\n'));
    const thread = threadMd?.(t.id);
    if (thread) out.push(thread);
    else if (t.output) out.push(t.output);
  }
  if (s.notes.length) out.push(`Plan notes: ${s.notes.join('; ')}`);
  return out.join('\n\n');
}
