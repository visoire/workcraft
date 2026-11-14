// Team Mode: smart review, straight-to-one-specialist routing, agent status and progress for Mission Control,
// readable tool arguments. Pure logic, no browser needed.
//   npx tsx --test tests/server/team-ux.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRoute, needsLeaderReview, rolesOfRequest, TeamRun, normalizeTeam, DEFAULT_TEAM, TEAM_PRESETS, TeamConfigSchema, type TeamDriver, type TeamState, type TaskState, type WorkerOutput } from '../../src/chat/team.js';
import { agentStatus, rosterStatus, progressSummary } from '../../src/chat/team-status.js';
import { summarizeArgs } from '../../src/chat/tool-icons.js';

const ALL = ['grid', 'word', 'deck', 'pdf', 'dev'];
const ok = (over: Partial<WorkerOutput> = {}): WorkerOutput => ({ text: 'done', changed: ['/sheets/a.xlsx'], toolCalls: [{ name: 'write-sheet', ok: true, path: '/sheets/a.xlsx' }], ...over });

// ---------------------------------------------------------------- smart review

test('Smart review: a clean run with tool calls needs no leader call, doubt does', () => {
  assert.equal(needsLeaderReview('smart', [], ok()), false);
  assert.equal(needsLeaderReview('smart', ['write-sheet failed'], ok()), true);
  assert.equal(needsLeaderReview('smart', [], ok({ changed: [], toolCalls: [] })), true, 'no tool and no file: it may have answered from memory');
  assert.equal(needsLeaderReview('smart', [], ok({ changed: [], toolCalls: [{ name: 'read-sheet', ok: true }] })), false, 'a read-only task is fine');
  assert.equal(needsLeaderReview('leader', [], ok()), true);
  assert.equal(needsLeaderReview('checks', ['x'], ok()), false);
});

test('Smart is the default, old saved teams keep their choice, presets are valid', () => {
  assert.equal(DEFAULT_TEAM.review, 'smart');
  assert.equal(TeamConfigSchema.parse({ leader: { role: 'leader' }, workers: [] }).review, 'smart');
  assert.equal(TeamConfigSchema.parse({ leader: { role: 'leader' }, workers: [], review: 'leader' }).review, 'leader');
  assert.equal(normalizeTeam({ ...DEFAULT_TEAM, review: 'leader' }).review, 'leader');
  assert.equal(TeamConfigSchema.parse({ leader: { role: 'leader' }, workers: [] }).autoRoute, true);
  for (const p of TEAM_PRESETS) assert.ok(TeamConfigSchema.safeParse(p).success, p.id);
});

/** A scripted driver that counts the model calls of a run. */
function driver(calls: Record<string, number>): TeamDriver {
  const count = (k: string) => (calls[k] = (calls[k] || 0) + 1);
  return {
    plan: async () => (count('plan'), JSON.stringify({ goal: 'g', tasks: [{ id: 't1', title: 'one', assignedAgent: 'grid-agent', dependencies: [], targetFiles: [], instructions: 'i' }, { id: 't2', title: 'two', assignedAgent: 'word-agent', dependencies: ['t1'], targetFiles: [], instructions: 'i' }] })),
    work: async () => (count('work'), ok()),
    review: async () => (count('review'), { accept: true }),
    synthesize: async () => (count('summary'), 'all done'),
  };
}

test('A team run with smart review makes no review calls when the checks pass; leader review makes one per task', async () => {
  const smart: Record<string, number> = {};
  const a = await new TeamRun({ config: { ...DEFAULT_TEAM, review: 'smart' }, driver: driver(smart) }).run('do both');
  assert.equal(a.phase, 'completed');
  assert.deepEqual(smart, { plan: 1, work: 2, summary: 1 });
  const lead: Record<string, number> = {};
  await new TeamRun({ config: { ...DEFAULT_TEAM, review: 'leader' }, driver: driver(lead) }).run('do both');
  assert.deepEqual(lead, { plan: 1, work: 2, review: 2, summary: 1 });
});

// ---------------------------------------------------------------- straight to one specialist

test('Which specialists a request is about', () => {
  assert.deepEqual(rolesOfRequest('Sum the revenue', ['/sheets/finances.xlsx'], ALL), ['grid']);
  assert.deepEqual(rolesOfRequest('Sum the revenue in the spreadsheet', [], ALL), ['grid']);
  assert.deepEqual(rolesOfRequest('Write a report from the sheet', [], ALL).sort(), ['grid', 'word']);
  assert.deepEqual(rolesOfRequest('Redact @contract.pdf', ['/pdf/contract.pdf'], ALL), ['pdf']);
  assert.deepEqual(rolesOfRequest('fix the bug in main.js', ['/code/main.js'], ALL), ['dev']);
  assert.deepEqual(rolesOfRequest('Sum the revenue', ['/sheets/finances.xlsx'], ['word', 'deck']), [], 'a specialist that is off is not chosen');
});

test('A short request about one app goes straight to its specialist', () => {
  assert.deepEqual(autoRoute('Sum the revenue per quarter in @finances.xlsx', ['/sheets/finances.xlsx'], ALL), { role: 'grid' });
  assert.deepEqual(autoRoute('Add a signature line to the PDF', [], ALL), { role: 'pdf' });
});

test('Several apps, several steps, a long text or nothing specific keep the team', () => {
  assert.equal(autoRoute('Analyze @finances.xlsx and write a report', ['/sheets/finances.xlsx'], ALL), null);
  assert.equal(autoRoute('Sum the revenue in @finances.xlsx, then write it into @report.docx', ['/sheets/finances.xlsx', '/documents/report.docx'], ALL), null);
  assert.equal(autoRoute('Sum the sheet and also check it', [], ALL), null, 'also: more than one job');
  assert.equal(autoRoute('Compare the two sheets', [], ALL), null);
  assert.equal(autoRoute('Make the project better', [], ALL), null, 'no app named: the leader decides');
  assert.equal(autoRoute('x '.repeat(200) + 'spreadsheet', [], ALL), null);
  assert.equal(autoRoute('Sum @a.xlsx using @b.docx', ['/sheets/a.xlsx', '/documents/b.docx'], ALL), null, 'files of two apps');
  assert.equal(autoRoute('', [], ALL), null);
});

// ---------------------------------------------------------------- Mission Control status

function task(over: Partial<TaskState>): TaskState {
  return { id: 't1', title: 't', assignedAgent: 'grid', dependencies: [], targetFiles: [], instructions: '', status: 'pending', attempts: 0, changed: [], toolCalls: [], feedback: [], ...over } as TaskState;
}
function state(tasks: TaskState[], over: Partial<TeamState> = {}): TeamState {
  return { id: 's', prompt: '', phase: 'delegating', started: 0, tasks, notes: [], leader: { reviews: [] }, usage: {}, roster: [], concurrency: 3, pattern: 'supervisor', memory: [], ...over } as TeamState;
}

test('One word per agent: queued, thinking, using a tool, waiting for you, finished, failed', () => {
  assert.equal(agentStatus(task({ status: 'pending' })).id, 'idle');
  assert.equal(agentStatus(task({ status: 'running' })).id, 'thinking');
  const tool = agentStatus(task({ status: 'running', tool: 'read-sheet' }));
  assert.equal(tool.id, 'tool');
  assert.match(tool.label, /read-sheet/);
  assert.equal(agentStatus(task({ status: 'running', approval: { tool: 'write-sheet', title: 'Write', args: {} } })).id, 'waiting');
  assert.equal(agentStatus(task({ status: 'done' })).id, 'finished');
  assert.equal(agentStatus(task({ status: 'failed' })).id, 'failed');
  assert.equal(agentStatus(task({ status: 'review' })).id, 'waiting');
});

test('The most urgent task decides the status of an agent, an unused agent says so', () => {
  const s = state([task({ id: 't1', status: 'done' }), task({ id: 't2', status: 'running', tool: 'read-sheet' }), task({ id: 't3', status: 'running', approval: { tool: 'x', title: 'x', args: {} } })]);
  assert.equal(rosterStatus(s, 'grid').id, 'waiting');
  assert.equal(rosterStatus(s, 'word').id, 'unused');
  assert.equal(rosterStatus(state([task({ status: 'done' })]), 'grid').id, 'finished');
  assert.equal(rosterStatus(state([task({ status: 'done' }), task({ id: 't2', status: 'failed' })]), 'grid').id, 'failed');
});

test('The leader follows the phase of the run', () => {
  assert.equal(rosterStatus(state([], { phase: 'planning' }), 'leader').id, 'thinking');
  assert.equal(rosterStatus(state([task({})], { phase: 'delegating' }), 'leader').id, 'idle');
  assert.equal(rosterStatus(state([task({ status: 'review' })], { phase: 'reviewing' }), 'leader').label, 'reviewing');
  assert.equal(rosterStatus(state([], { phase: 'completed' }), 'leader').id, 'finished');
  assert.equal(rosterStatus(state([], { phase: 'stopped' }), 'leader').id, 'failed');
  assert.equal(rosterStatus(state([], { phase: 'planning', awaitingApproval: true }), 'leader').id, 'waiting');
});

test('The progress line counts done, working, waiting and failed', () => {
  const s = state([task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'running' }), task({ id: 'c', status: 'running', approval: { tool: 'x', title: 'x', args: {} } }), task({ id: 'd', status: 'failed' }), task({ id: 'e', status: 'pending' })]);
  const p = progressSummary(s);
  assert.equal(p.done, 1);
  assert.equal(p.total, 5);
  assert.match(p.text, /1 of 5 tasks done/);
  assert.match(p.text, /1 working/);
  assert.match(p.text, /1 waiting for you/);
  assert.match(p.text, /1 failed/);
  assert.equal(progressSummary(state([])).total, 0);
});

// ---------------------------------------------------------------- tool arguments

test('Arguments read as one line: the file first, then a few values', () => {
  assert.equal(summarizeArgs({ path: '/sheets/finances.xlsx', range: 'A1:D5', rows: [1, 2, 3] }, 'path'), '/sheets/finances.xlsx · range: A1:D5 · rows: 3 items');
  assert.equal(summarizeArgs({ query: 'revenue' }), 'query: revenue');
  assert.equal(summarizeArgs({ file: '/a.docx', text: 'x'.repeat(200) }), '/a.docx · text: ' + 'x'.repeat(27) + '…');
  assert.equal(summarizeArgs({ data: { a: 1 }, flag: true, n: 2, none: null, empty: '' }), 'data: {…} · flag: true · n: 2');
  assert.equal(summarizeArgs({}), '');
  assert.ok(summarizeArgs({ a: 'x'.repeat(25), b: 'y'.repeat(25), c: 'z'.repeat(25), d: 'w'.repeat(25) }).length <= 90);
});
