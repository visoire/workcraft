// What every agent of a team is doing, in one word, and how far the run is. Pure (no DOM), shared by Mission Control and
// the tests. The words go through t() so the interface language applies.

import { t as tr } from '../app/i18n.js';
import type { TaskState, TeamRoleId, TeamState } from './team.js';

export type AgentStatusId = 'idle' | 'thinking' | 'tool' | 'waiting' | 'finished' | 'failed';

const TASK_LABEL: Record<TaskState['status'], string> = { pending: tr('queued'), running: tr('working'), review: tr('in review'), retry: tr('retrying'), done: tr('done'), failed: tr('failed'), cancelled: tr('cancelled'), skipped: tr('skipped') };

/** What the agent of one task is doing right now, in one word (thinking, using a tool, waiting for you, finished ...). */
export function agentStatus(t: TaskState): { id: AgentStatusId; label: string } {
  if (t.status === 'done') return { id: 'finished', label: tr('finished') };
  if (t.status === 'failed' || t.status === 'cancelled' || t.status === 'skipped') return { id: 'failed', label: TASK_LABEL[t.status] };
  if (t.approval) return { id: 'waiting', label: tr('waiting for you') };
  if (t.status === 'running' || t.status === 'retry') return t.tool ? { id: 'tool', label: `${tr('using')} ${t.tool}` } : { id: 'thinking', label: tr('thinking') };
  if (t.status === 'review') return { id: 'waiting', label: tr('in review') };
  return { id: 'idle', label: tr('queued') };
}

/** Status of one agent of the team: the leader from the phase of the run, a specialist from its tasks. */
export function rosterStatus(s: TeamState, role: TeamRoleId): { id: AgentStatusId | 'unused'; label: string } {
  if (role === 'leader') {
    if (s.awaitingApproval) return { id: 'waiting', label: tr('waiting for you') };
    switch (s.phase) {
      case 'planning':
        return { id: 'thinking', label: tr('planning') };
      case 'delegating':
        return { id: 'idle', label: tr('coordinating') };
      case 'reviewing':
        return { id: 'thinking', label: s.tasks.some((t) => t.status === 'review') ? tr('reviewing') : tr('writing the summary') };
      case 'completed':
        return { id: 'finished', label: tr('finished') };
      case 'stopped':
        return { id: 'failed', label: tr('stopped') };
      default:
        return { id: 'failed', label: tr('failed') };
    }
  }
  const tasks = s.tasks.filter((t) => t.assignedAgent === role);
  if (!tasks.length) return { id: 'unused', label: s.phase === 'planning' ? tr('standing by') : tr('not needed') };
  const states = tasks.map(agentStatus);
  // The most urgent state wins: waiting for you, then working, then queued, then the outcome
  for (const id of ['waiting', 'tool', 'thinking', 'idle'] as const) {
    const hit = states.find((x) => x.id === id);
    if (hit) return hit;
  }
  return states.find((x) => x.id === 'failed') || states[0]!;
}

/** The one-line count of a run: "3 of 5 tasks done · 1 working · 1 waiting for you". */
export function progressSummary(s: TeamState): { done: number; total: number; text: string } {
  const total = s.tasks.length;
  const n = (f: (t: TaskState) => boolean) => s.tasks.filter(f).length;
  const done = n((t) => t.status === 'done');
  const parts = [tr('{done} of {total} tasks done', { done, total })];
  const working = n((t) => (t.status === 'running' || t.status === 'retry' || t.status === 'review') && !t.approval);
  const waiting = n((t) => !!t.approval);
  const failed = n((t) => t.status === 'failed' || t.status === 'skipped');
  if (working) parts.push(tr('{n} working', { n: working }));
  if (waiting) parts.push(tr('{n} waiting for you', { n: waiting }));
  if (failed) parts.push(tr('{n} failed', { n: failed }));
  return { done, total, text: parts.join(' · ') };
}
