// Editor for the agents you create: name, the line the leader sees, system prompt, provider and model, tools,
// color and icon. Used by the roster editor in team-ui.ts (Settings, Team Mode and the chat popover).

import { h } from '../app/util.js';
import { icon } from '../app/icons.js';
import { t as tr } from '../app/i18n.js';
import { dialog } from '../app/ui.js';
import { AGENT_COLORS, AGENT_ICONS, EFFORT_CHOICES, ROLE_DEFS, agentMention, type AgentProfile } from './team.js';
import type { AiStatus } from './config.js';

/** Tool groups to tick, each one a set of patterns (see toolPatternMatches in team.ts). */
export const TOOL_GROUPS: { id: string; label: string; patterns: string[]; hint: string }[] = [
  { id: 'read', label: 'Read and search', patterns: ['read-*', 'search-*', 'list-*', 'file-history', 'panel-status'], hint: 'read-sheet, read-document, search-project ...' },
  { id: 'gridcraft', label: 'Spreadsheets', patterns: ['app:gridcraft'], hint: 'GridCraft tools' },
  { id: 'wordcraft', label: 'Documents', patterns: ['app:wordcraft'], hint: 'WordCraft tools' },
  { id: 'deckcraft', label: 'Presentations', patterns: ['app:deckcraft'], hint: 'DeckCraft tools' },
  { id: 'pdfcraft', label: 'PDF', patterns: ['app:pdfcraft'], hint: 'PdfCraft tools' },
  { id: 'code', label: 'Code and terminal', patterns: ['app:code', 'app:terminal'], hint: 'run-command needs your approval' },
  { id: 'project', label: 'Memory, cloud and skills', patterns: ['remember', 'cloud-*', 'app:project'], hint: 'remember, Google Drive, skills' },
  { id: 'craft', label: 'Craft apps', patterns: ['ext-*'], hint: 'every connected Craft app and MCP server' },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/** Opens the editor. Returns the agent to save, or null when cancelled. `taken` are ids that exist (a new id is made unique). */
export async function editAgent(o: { agent?: AgentProfile; providers: AiStatus['providers']; taken: string[] }): Promise<AgentProfile | null> {
  const a = o.agent;
  let color = a?.color || AGENT_COLORS[o.taken.length % AGENT_COLORS.length]!;
  let iconName = a?.icon || 'spark';
  const patterns = new Set(a?.tools || ['read-*', 'search-*', 'list-*', 'file-history', 'panel-status']);
  const extraPatterns = (a?.tools || []).filter((p) => !TOOL_GROUPS.some((g) => g.patterns.includes(p)));

  const swatches = h('div.agent-swatches', { role: 'radiogroup', 'aria-label': tr('Color') });
  const paintSwatches = () =>
    swatches.replaceChildren(
      ...AGENT_COLORS.map((c) => h('button.agent-swatch' + (c === color ? '.is-on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(c === color), 'aria-label': c, style: `--c:${c}`, onclick: () => ((color = c), paintSwatches(), paintIcons()) }))
    );
  const icons = h('div.agent-icons', { role: 'radiogroup', 'aria-label': tr('Icon') });
  const paintIcons = () =>
    icons.replaceChildren(
      ...AGENT_ICONS.map((n) => h('button.agent-icon' + (n === iconName ? '.is-on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(n === iconName), 'aria-label': n, style: `--c:${color}`, html: icon(n, { size: 16 }), onclick: () => ((iconName = n), paintIcons()) }))
    );
  paintSwatches();
  paintIcons();

  const tools = h(
    'div.agent-tools',
    ...TOOL_GROUPS.map((g) => {
      const input = h<'input'>('input', { type: 'checkbox', checked: g.patterns.every((p) => patterns.has(p)), 'data-tool-group': g.id });
      input.onchange = () => g.patterns.forEach((p) => (input.checked ? patterns.add(p) : patterns.delete(p)));
      return h('label.switch', input, h('span', tr(g.label), h('small.muted', ' ' + tr(g.hint))));
    })
  );

  const provider = h<'select'>('select.input', { 'data-agent-field': 'provider', 'aria-label': tr('Provider') });
  provider.append(h('option', { value: '' }, tr('Chat model')));
  for (const p of o.providers) provider.append(h('option', { value: p.id, selected: p.id === a?.provider }, `${p.name}${p.local ? ` (${tr('local')})` : ''}${!p.configured && !p.local ? ` (${tr('key missing')})` : ''}`));
  const effort = h<'select'>('select.input', { 'data-agent-field': 'effort', 'aria-label': tr('Reasoning effort') });
  for (const e of EFFORT_CHOICES) effort.append(h('option', { value: e, selected: e === (a?.effort || 'auto') }, e));
  const model = h<'input'>('input.input.mono', { placeholder: tr('provider default'), value: a?.model || '', spellcheck: 'false', autocomplete: 'off', 'data-agent-field': 'model', 'aria-label': tr('Model') });

  const body = h(
    'div.agent-editor',
    h('div.agent-row', h('span.mono.muted', tr('Color')), swatches),
    h('div.agent-row', h('span.mono.muted', tr('Icon')), icons),
    h('div.sp-grid', h('label.field', h('span', tr('Provider')), provider), h('label.field', h('span', tr('Model')), model), h('label.field', h('span', tr('Reasoning effort')), effort)),
    h('p.eyebrow', tr('Tools this agent may use')),
    tools
  );
  const r = await dialog({
    title: a ? tr('Edit agent') : tr('New agent'),
    tone: a ? a.name : '',
    wide: true,
    body,
    fields: [
      { name: 'name', label: tr('Name'), value: a?.name || '', placeholder: tr('Research Desk') },
      { name: 'role', label: tr('What it does (the leader reads this when it assigns work)'), value: a?.role || '', placeholder: tr('Finds sources and writes a short brief with references') },
      { name: 'prompt', label: tr('Instructions (system prompt)'), value: a?.prompt || '', textarea: true, placeholder: tr('You are careful and cite where every figure comes from.') },
    ],
    ok: tr('Save agent'),
    validate: (v) => {
      if (!v.name?.trim()) return tr('Give the agent a name.');
      const mention = agentMention({ id: a?.id || 'a-new', name: v.name });
      if (mention === 'team' || Object.values(ROLE_DEFS).some((d) => d.mention === mention && d.id !== a?.id)) return tr('Another agent already answers to @{name}. Choose a different name.', { name: mention });
      return !patterns.size && !extraPatterns.length ? tr('Pick at least one group of tools.') : null;
    },
  });
  if (!r) return null;
  const name = r.name!.trim().slice(0, 60);
  let id = a?.id || `a-${slug(name) || 'agent'}`;
  if (!a) for (let n = 2; o.taken.includes(id); n++) id = `a-${slug(name) || 'agent'}-${n}`.slice(0, 40);
  return { id, name, role: r.role!.trim().slice(0, 240), prompt: r.prompt!.trim().slice(0, 8000), provider: provider.value, model: model.value.trim(), effort: effort.value as AgentProfile['effort'], tools: [...patterns, ...extraPatterns], color, icon: iconName };
}

export { agentMention };
