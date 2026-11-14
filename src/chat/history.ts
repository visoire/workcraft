// Chat history per project (stored in the backend under .workcraft/chats), search and export.

import { api } from '../app/backend.js';
import { debounce, downloadBlob } from '../app/util.js';
import type { ChatRecord, ChatMessage } from './agent.js';
import { t as tr, locale } from '../app/i18n.js';
import { teamToMarkdown } from './team.js';

export interface ChatSummary {
  id: string;
  title: string;
  updated: string;
  count: number;
  project?: string;
  projectName?: string;
}

export const history = {
  /** Chats of the active project, or of every project with scope 'all' */
  list: (scope: 'project' | 'all' = 'project') => api.get<ChatSummary[]>(scope === 'all' ? '/api/chats?scope=all' : '/api/chats'),
  /** Deletes every chat of the active project */
  clear: () => api.send<{ removed: number }>('DELETE', '/api/chats'),
  load: (id: string) => api.get<ChatRecord>(`/api/chats/${encodeURIComponent(id)}`),
  save: (chat: ChatRecord) => api.send('PUT', `/api/chats/${encodeURIComponent(chat.id)}`, chat),
  remove: (id: string) => api.send('DELETE', `/api/chats/${encodeURIComponent(id)}`),
};

/** Saves with a delay, so streaming does not write on every token. */
export function autosaver(get: () => ChatRecord | null) {
  return debounce(() => {
    const c = get();
    if (c && c.messages.length) void history.save(c).catch(() => {});
  }, 800);
}

/** Hits of the chat search: message and text snippets. */
export function searchMessages(chat: ChatRecord, q: string): { id: string; snippet: string }[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: { id: string; snippet: string }[] = [];
  for (const m of chat.messages) {
    const sub = Object.values(m.team?.threads || {}).flat();
    const hay = [m.text, ...[m, ...sub].flatMap((x) => (x.steps || []).map((s) => `${s.name} ${JSON.stringify(s.args)} ${s.result?.text || ''}`)), ...sub.map((x) => x.text), ...(m.team?.state.tasks || []).map((t) => `${t.title} ${t.instructions}`)].join('\n');
    const i = hay.toLowerCase().indexOf(needle);
    if (i >= 0) out.push({ id: m.id, snippet: hay.slice(Math.max(0, i - 40), i + needle.length + 60).replace(/\s+/g, ' ') });
  }
  return out;
}

function fence(s: string, lang = ''): string {
  const ticks = s.includes('```') ? '````' : '```';
  return `${ticks}${lang}\n${s}\n${ticks}`;
}

function messageMd(m: ChatMessage, level = 3): string {
  const who = m.role === 'user' ? tr('You') : `${m.team ? tr('AI team') : tr('AI')}${m.model ? ` (${m.provider} · ${m.model})` : ''}`;
  const parts = [`${'#'.repeat(level)} ${who}, ${new Date(m.created).toLocaleString(locale())}`];
  if (m.forcedTool) parts.push(`${tr('Command:')} \`/${m.forcedTool}\``);
  if (m.text) parts.push(m.text);
  if (m.attachments?.length) parts.push(tr('Attached:') + ' ' + m.attachments.map((a) => `\`${a.label}\` (${a.kind}, ${tr('{n} characters', { n: a.chars })})`).join(', '));
  for (const s of m.steps || []) {
    parts.push(`#### ${tr('Tool')} \`${s.name}\`: ${s.title}`);
    parts.push(`${tr('Status:')} ${s.status}${s.result ? `, ${s.result.ms} ms` : ''}${s.attempts > 1 ? `, ${tr('{n} attempts', { n: s.attempts })}` : ''}`);
    parts.push(tr('Parameters:') + '\n' + fence(JSON.stringify(s.args, null, 2), 'json'));
    if (s.progress.length) parts.push(tr('Progress:') + '\n' + s.progress.map((p) => `- ${p}`).join('\n'));
    if (s.result) parts.push(`${tr('Result')}${s.result.ok ? '' : ` (${tr('error')}, ${s.result.stage})`}:\n` + fence(s.result.text.slice(0, 8000)));
    if (s.result?.changed.length) parts.push(tr('Changed files:') + ' ' + s.result.changed.map((c) => `\`${c}\``).join(', '));
  }
  if (m.error) parts.push(`> ${tr('Error')} ${m.error.code}: ${m.error.message}`);
  // Team Mode: the task graph, the reviews, usage per role and every sub-agent transcript
  if (m.team) parts.push(teamToMarkdown(m.team.state, (id) => (m.team!.threads[id] || []).map((x) => messageMd(x, 6)).join('\n\n')));
  return parts.join('\n\n');
}

export function chatToMarkdown(chat: ChatRecord): string {
  return [`# ${chat.title}`, tr('Exported on {date} from WorkCraft. {n} messages.', { date: new Date().toLocaleString(locale()), n: chat.messages.length }), ...chat.messages.map(messageMd)].join('\n\n') + '\n';
}

export function chatToJson(chat: ChatRecord): string {
  return JSON.stringify({ format: 'workcraft-chat', version: 1, exported: new Date().toISOString(), ...chat }, null, 2);
}

export function exportChat(chat: ChatRecord, kind: 'md' | 'json'): void {
  const base = (chat.title || 'chat').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'chat';
  const body = kind === 'md' ? chatToMarkdown(chat) : chatToJson(chat);
  downloadBlob(new Blob([body], { type: kind === 'md' ? 'text/markdown;charset=utf-8' : 'application/json' }), `${base}.${kind}`);
}
