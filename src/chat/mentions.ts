// @ and / suggestions in the chat input.
//
// @ suggests files, folders, projects and app panels (@finances.xlsx, @sheets/, @wordcraft,
// @terminal). On send the content is attached: file content (sheets as Markdown),
// folder content, panel state or the last terminal output.
// / lists MCP tools and system commands and forces the chosen tool call.
// Keys: arrows, Tab or Enter accepts, Escape closes.

import { h, basename, esc } from '../app/util.js';
import { icon } from '../app/icons.js';
import { bus } from '../app/bus.js';
import { fs } from '../project/fs.js';
import { projects, type ProjectMeta } from '../project/manager.js';
import { TOOLS, toolForPath, toolMark, APP_IDS, type ToolId } from '../workspace/registry.js';
import { workspace } from '../workspace/layout.js';
import { orchestrator, type ToolMeta } from '../mcp/orchestrator.js';
import { APP_ACCENT } from '../mcp/schemas.js';
import { t as tr } from '../app/i18n.js';
import { craftMarkForTool } from './craft-icons.js';
import { ROLE_DEFS, type TeamRoleId, type WorkerRoleId } from './team.js';
import { roleIcon } from './role-icons.js';

export interface Suggestion {
  kind: 'file' | 'dir' | 'project' | 'panel' | 'tool' | 'command' | 'agent';
  /** inserted text without the prefix */
  insert: string;
  label: string;
  detail: string;
  html: string;
  accent?: string;
  score: number;
}

export interface SystemCommand {
  name: string;
  title: string;
  description: string;
}

export const SYSTEM_COMMANDS: SystemCommand[] = [
  { name: 'clear', title: tr('Clear chat'), description: tr('Removes all messages of this chat') },
  { name: 'new', title: tr('New chat'), description: tr('Starts a new chat, the old one stays in the history') },
  { name: 'export-chat', title: tr('Export chat'), description: tr('Saves the chat as .md or .json (with tool parameters)') },
  { name: 'history', title: tr('History'), description: tr('Open earlier chats of this project') },
  { name: 'search', title: tr('Search in the chat'), description: tr('Searches all messages of this chat') },
  { name: 'model', title: tr('Switch model'), description: tr('Pick provider and model for this chat') },
  { name: 'persona', title: tr('Switch persona'), description: tr('Picks a role such as Financial analyst or Strict reviewer: /persona reviewer') },
  { name: 'context', title: tr('Switch context'), description: tr('Picks a set of facts about you or a project: /context client, or /context off') },
  { name: 'remember', title: tr('Remember'), description: tr('Keeps a note or decision in the project memory: /remember Prices are net') },
  { name: 'memory', title: tr('Project memory'), description: tr('Shows the notes the chat keeps for this project') },
  { name: 'undo', title: tr('Undo the last AI changes'), description: tr('Restores every file the last answer changed, across all apps') },
  { name: 'snapshot', title: tr('Project snapshot'), description: tr('Saves the whole project and the chats: /snapshot before the big rewrite') },
  { name: 'find', title: tr('Search the project'), description: tr('Full-text and semantic search in all files and chats: /find revenue forecast') },
  { name: 'team', title: tr('Team Mode for this prompt'), description: tr('The Team Leader plans, specialists work in parallel: /team write the Q3 report and slides') },
  { name: 'roster', title: tr('Team configuration'), description: tr('Team Leader, specialists, models and presets') },
  { name: 'help', title: tr('Help'), description: tr('Shows how @ and / work') },
];

// ---------------------------------------------------------------- Team Mode mentions

/** @team runs the whole team, @leader too; @grid-agent and the others address one specialist. */
/** Computed on use: agents the user creates register after the module loads. */
export const agentMentionMap = (): Record<string, TeamRoleId | 'team'> => ({ team: 'team', ...Object.fromEntries(Object.keys(ROLE_DEFS).map((r) => [ROLE_DEFS[r]!.mention, r])) });

/** Team Mode mentions in a message: the whole team, and the specialists addressed by name. */
export function agentMentions(text: string): { team: boolean; roles: WorkerRoleId[] } {
  const refs = findMentions(text).map((r) => r.toLowerCase());
  const map = agentMentionMap();
  const hits = refs.map((r) => map[r]).filter(Boolean);
  return { team: hits.includes('team') || hits.includes('leader'), roles: Object.keys(ROLE_DEFS).filter((r) => r !== 'leader' && hits.includes(r)) };
}

function agentSuggestions(q: string): Suggestion[] {
  const out: Suggestion[] = [];
  const team = Math.max(fuzzy(q, 'team'), fuzzy(q, 'Team Mode'));
  if (team >= 0) out.push({ kind: 'agent', insert: 'team', label: '@team', detail: tr('Team Mode · leader plans, specialists work in parallel'), html: roleIcon('leader', 16), accent: ROLE_DEFS.leader.accent, score: team + 12 });
  for (const r of Object.keys(ROLE_DEFS)) {
    const d = ROLE_DEFS[r]!;
    const sc = Math.max(fuzzy(q, d.mention), fuzzy(q, d.name) - 5, fuzzy(q, d.short) - 5);
    if (sc < 0) continue;
    const mark = roleIcon(r, 16);
    out.push({ kind: 'agent', insert: d.mention, label: '@' + d.mention, detail: `${tr(d.name)} · ${r === 'leader' ? tr('runs the whole team') : tr('works alone on this prompt')}`, html: mark, accent: d.accent, score: sc + 10 });
  }
  return out;
}

/** Panels that can be mentioned. */
const PANEL_IDS: ToolId[] = [...APP_IDS, 'code', 'terminal'];

// Buffer terminal output for @terminal (without control characters)
const termBuf = new Map<string, string>();
bus.on('term:data', ({ id, data }) => {
  const clean = data.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r/g, '');
  termBuf.set(id, ((termBuf.get(id) || '') + clean).slice(-8000));
});

function fuzzy(q: string, s: string): number {
  if (!q) return 1;
  const a = q.toLowerCase();
  const b = s.toLowerCase();
  const idx = b.indexOf(a);
  if (idx >= 0) return 100 - idx - (b.length - a.length) * 0.1 + (b.startsWith(a) ? 30 : 0);
  let i = 0;
  for (const ch of b) if (ch === a[i]) i++;
  return i === a.length ? 20 - b.length * 0.05 : -1;
}

let projectCache: ProjectMeta[] = [];
async function refreshProjects() {
  projectCache = (await projects.list().catch(() => ({ projects: [] as ProjectMeta[] }))).projects;
}

export function atSuggestions(q: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const id of PANEL_IDS) {
    const t = TOOLS[id];
    const s = Math.max(fuzzy(q, id), fuzzy(q, t.name));
    if (s >= 0) out.push({ kind: 'panel', insert: id, label: '@' + id, detail: `${t.name} · ${tr('panel state')}`, html: toolMark(id, 16), accent: t.accent, score: s + 15 });
  }
  for (const e of fs.list()) {
    const rel = e.path.slice(1);
    const s = Math.max(fuzzy(q, basename(e.path)) + 5, fuzzy(q, rel));
    if (s < 0) continue;
    if (e.kind === 'dir') out.push({ kind: 'dir', insert: rel + '/', label: rel + '/', detail: tr('Folder · {n} entries', { n: fs.children(e.path).length }), html: icon('folder', { size: 16 }), score: s });
    else {
      const tool = toolForPath(e.path);
      out.push({ kind: 'file', insert: rel, label: basename(e.path), detail: e.path, html: toolMark(tool, 16), accent: TOOLS[tool].accent, score: s + 2 });
    }
  }
  for (const p of projectCache) {
    const s = fuzzy(q, p.name);
    if (s >= 0) out.push({ kind: 'project', insert: `project:${p.name.replace(/\s+/g, '-')}`, label: p.name, detail: p.id === projects.current?.id ? tr('Project · active') : tr('Project'), html: icon('briefcase', { size: 16 }), score: s - 5 });
  }
  out.push(...agentSuggestions(q));
  return out.sort((a, b) => b.score - a.score).slice(0, 40);
}

export function slashSuggestions(q: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const t of orchestrator.tools()) {
    const s = Math.max(fuzzy(q, t.name), fuzzy(q, t.title) - 5);
    if (s >= 0) out.push({ kind: 'tool', insert: t.name, label: '/' + t.name, detail: t.title + (t.approval ? ' · ' + tr('needs approval') : ''), html: craftMarkForTool(t.name) || (isAppTool(t) ? toolMark(t.app, 16) : icon(t.source === 'external' ? 'plug' : 'bolt', { size: 16 })), accent: APP_ACCENT[t.app], score: s + 10 });
  }
  for (const c of SYSTEM_COMMANDS) {
    const s = Math.max(fuzzy(q, c.name), fuzzy(q, c.title) - 5);
    if (s >= 0) out.push({ kind: 'command', insert: c.name, label: '/' + c.name, detail: c.title, html: icon('slash', { size: 16 }), score: s });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 40);
}

const isAppTool = (t: ToolMeta) => (APP_IDS as string[]).includes(t.app);

// ---------------------------------------------------------------- Popover

/** Connects a text field with the @ and / popover. Returns a cleanup function. */
export function attachMentions(ta: HTMLTextAreaElement, host: HTMLElement, onPick?: (s: Suggestion) => void): () => void {
  const pop = h('div.mention-pop.frame.sm', { role: 'listbox', hidden: true, id: 'mention-pop' });
  const well = h('div.well.flush');
  const head = h('div.mention-head.mono');
  pop.append(well);
  host.append(pop);
  ta.setAttribute('aria-controls', 'mention-pop');
  ta.setAttribute('aria-autocomplete', 'list');
  let items: Suggestion[] = [];
  let active = 0;
  let trigger: { char: '@' | '/'; start: number; query: string } | null = null;

  function detect() {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return null;
    const before = ta.value.slice(0, pos);
    const m = before.match(/(^|\s)([@/])([^\s@]*)$/);
    if (!m) return null;
    const char = m[2] as '@' | '/';
    // / only at the start of a line or after a space, not in the middle of a path
    if (char === '/' && m[3]!.includes('/')) return null;
    return { char, start: pos - m[3]!.length - 1, query: m[3]! };
  }

  function render() {
    if (!trigger || !items.length) return close();
    pop.hidden = false;
    ta.setAttribute('aria-expanded', 'true');
    head.textContent = trigger.char === '@' ? tr('@ files, folders, projects, panels, agents') : tr('/ tools and commands');
    well.replaceChildren(
      head,
      ...items.map((s, i) => {
        const b = h(
          'button.mention-item' + (i === active ? '.is-active' : ''),
          { type: 'button', role: 'option', id: `mention-${i}`, 'aria-selected': String(i === active), style: s.accent ? `--tool:${s.accent}` : '', tabindex: '-1' },
          h('span.mention-ic', { html: s.html }),
          h('span.mention-label', s.label),
          h('span.mention-detail.mono', s.detail),
          h('span.mention-kind.mono', { 'data-kind': s.kind }, KIND_LABEL[s.kind])
        );
        b.addEventListener('mousedown', (e) => e.preventDefault());
        // Finger and Apple Pencil: keep the focus in the input (otherwise the menu closes)
        b.addEventListener('pointerdown', (e) => {
          if (e.pointerType !== 'mouse') e.preventDefault();
        });
        b.addEventListener('click', () => pick(i));
        b.addEventListener('mousemove', () => {
          if (active !== i) {
            active = i;
            paintActive();
          }
        });
        return b;
      })
    );
    ta.setAttribute('aria-activedescendant', `mention-${active}`);
    paintActive();
  }
  function paintActive() {
    well.querySelectorAll('.mention-item').forEach((el, i) => {
      el.classList.toggle('is-active', i === active);
      el.setAttribute('aria-selected', String(i === active));
      // Scroll only the list: scrollIntoView would also move the side bar and the workspace
      if (i === active) {
        const item = el as HTMLElement;
        const top = item.offsetTop - well.offsetTop;
        const bottom = top + item.offsetHeight;
        if (top < well.scrollTop) well.scrollTop = top;
        else if (bottom > well.scrollTop + well.clientHeight) well.scrollTop = bottom - well.clientHeight;
      }
    });
    ta.setAttribute('aria-activedescendant', `mention-${active}`);
  }
  function close() {
    pop.hidden = true;
    trigger = null;
    items = [];
    ta.setAttribute('aria-expanded', 'false');
    ta.removeAttribute('aria-activedescendant');
  }
  function update() {
    trigger = detect();
    if (!trigger) return close();
    if (trigger.char === '@' && !projectCache.length) void refreshProjects().then(() => trigger && update());
    items = trigger.char === '@' ? atSuggestions(trigger.query) : slashSuggestions(trigger.query);
    active = Math.min(active, Math.max(0, items.length - 1));
    if (!trigger.query) active = 0;
    render();
  }
  function pick(i: number) {
    const s = items[i];
    if (!s || !trigger) return;
    const before = ta.value.slice(0, trigger.start);
    const after = ta.value.slice(ta.selectionStart);
    const text = trigger.char + s.insert + (s.insert.endsWith('/') && s.kind === 'dir' ? ' ' : ' ');
    ta.value = before + text + after.replace(/^\S*/, '');
    const caret = before.length + text.length;
    ta.setSelectionRange(caret, caret);
    close();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    onPick?.(s);
  }

  const onKey = (e: KeyboardEvent) => {
    if (pop.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paintActive();
    } else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  };
  const onInput = () => update();
  const onBlur = () => setTimeout(close, 120);
  const onClick = () => update();
  ta.addEventListener('keydown', onKey, true);
  ta.addEventListener('input', onInput);
  ta.addEventListener('click', onClick);
  ta.addEventListener('blur', onBlur);
  return () => {
    ta.removeEventListener('keydown', onKey, true);
    ta.removeEventListener('input', onInput);
    ta.removeEventListener('click', onClick);
    ta.removeEventListener('blur', onBlur);
    pop.remove();
  };
}

const KIND_LABEL: Record<Suggestion['kind'], string> = { file: tr('File'), dir: tr('Folder'), project: tr('Project'), panel: tr('Panel'), tool: 'MCP', command: tr('Command'), agent: tr('Agent') };

// ---------------------------------------------------------------- Resolve on send

export interface Attachment {
  kind: 'file' | 'dir' | 'project' | 'panel' | 'missing';
  ref: string;
  label: string;
  path?: string;
  app?: ToolId;
  text: string;
  chars: number;
}

/** Finds all @ mentions in the text. */
export function findMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|\s)@([^\s@,;:!?()]+)/g)) out.add(m[2]!.replace(/[.]+$/, ''));
  return [...out];
}

/** Resolves mentions and fetches the content (file, folder, panel state, terminal). */
export async function resolveMentions(text: string): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const ref of findMentions(text)) {
    const low = ref.toLowerCase();
    // @team and @grid-agent address the team, they attach no content
    if (agentMentionMap()[low]) continue;
    if ((PANEL_IDS as string[]).includes(low)) {
      out.push(await panelAttachment(low as ToolId));
      continue;
    }
    if (low.startsWith('projekt:') || low.startsWith('project:')) {
      const name = ref.slice(8).replace(/-/g, ' ');
      const p = projectCache.find((x) => x.name.toLowerCase() === name.toLowerCase());
      const isCurrent = p && p.id === projects.current?.id;
      const listing = isCurrent ? fs.files().map((f) => f.path).join('\n') : '';
      const t = p ? `Project "${p.name}" (${isCurrent ? 'active' : 'not active, tools work in the active project'}).${listing ? `\nFiles:\n${listing}` : ''}` : `Project ${name} not found.`;
      out.push({ kind: 'project', ref, label: p?.name || name, text: t, chars: t.length });
      continue;
    }
    const entry = fs.resolve(ref.replace(/\/$/, ''));
    if (!entry) {
      out.push({ kind: 'missing', ref, label: ref, text: `@${ref} was not found in the project.`, chars: 0 });
      continue;
    }
    if (entry.kind === 'dir') {
      const files = fs.files().filter((f) => f.path.startsWith(entry.path + '/'));
      const t = `Folder ${entry.path} with ${files.length} files:\n${files.map((f) => `${f.path} (${f.size} bytes)`).join('\n')}`;
      out.push({ kind: 'dir', ref, label: entry.path + '/', path: entry.path, text: t, chars: t.length });
      continue;
    }
    try {
      const ctx = await fs.context(entry.path);
      out.push({ kind: 'file', ref, label: basename(entry.path), path: entry.path, app: toolForPath(entry.path), text: ctx.text, chars: ctx.text.length });
    } catch (e) {
      out.push({ kind: 'file', ref, label: basename(entry.path), path: entry.path, text: `Content not readable: ${(e as Error).message}`, chars: 0 });
    }
  }
  return out;
}

async function panelAttachment(id: ToolId): Promise<Attachment> {
  const t = TOOLS[id];
  const list = workspace.panels().filter((p) => p.tool === id);
  let text: string;
  if (id === 'terminal') {
    const ids = list.map((p) => p.id);
    const output = ids.map((x) => termBuf.get(x) || '').join('\n').trim();
    text = list.length ? `Terminal output (last ${Math.min(output.length, 4000)} characters):\n${output.slice(-4000) || '(empty)'}` : 'No terminal open.';
  } else if (!list.length) text = `${t.name} is not open. Tools of this app: ${toolsOf(id).join(', ') || 'none'}.`;
  else {
    const states = list.map((p) => ({ panel: p.id, file: p.path, mode: p.mode, state: p.paused ? 'paused' : p.status, ...(workspace.instance(p.id)?.status?.() || {}) }));
    text = `${t.name} panel:\n${JSON.stringify(states, null, 2)}\nTools of this app: ${toolsOf(id).join(', ')}.`;
    const file = list.find((p) => p.path)?.path;
    if (file && (APP_IDS as string[]).includes(id)) {
      try {
        const ctx = await fs.context(file);
        text += `\nContent of ${file}:\n${ctx.text}`;
      } catch {
        /* content optional */
      }
    }
  }
  return { kind: 'panel', ref: id, label: '@' + id, app: id, text, chars: text.length };
}

export function toolsOf(app: string): string[] {
  return orchestrator
    .tools()
    .filter((t) => t.app === app)
    .map((t) => t.name);
}

/** Builds the context block that is appended to the user message. */
export function contextBlock(atts: Attachment[]): string {
  if (!atts.length) return '';
  const apps = atts.filter((a) => a.kind === 'panel' && a.app && (APP_IDS as string[]).includes(a.app));
  const hint = apps.length ? `\nAddressed apps: ${apps.map((a) => `${TOOLS[a.app!].name} (tools: ${toolsOf(a.app!).join(', ')})`).join('; ')}. Use exactly these tools for tasks in these apps.` : '';
  return (
    '\n\n<context>' +
    atts.map((a) => `\n<entry type="${a.kind}" ref="@${esc(a.ref)}"${a.path ? ` path="${esc(a.path)}"` : ''}>\n${a.text}\n</entry>`).join('') +
    hint +
    '\n</context>'
  );
}
