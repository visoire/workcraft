// Team Mode in the browser: drives a TeamRun (src/chat/team.ts) with real models.
//
// - The Team Leader plans, reviews and summarizes through /api/ai/chat without tools (its own provider,
//   model and effort, usage counted as role "leader").
// - Every task runs in its own sub-thread: an Agent with the role prompt, only the tools of its role,
//   its own model, and the answer id of the team turn (Undo covers every file the team wrote).
// - Tool calls that need approval show an inline prompt in the sub-agent's card; the other sub-agents
//   keep working meanwhile. Errors of a sub-agent go back to its model (no pause): the leader decides
//   about retries in the review.

import { postSse } from '../app/backend.js';
import { uid } from '../app/util.js';
import { lang, t as tr } from '../app/i18n.js';
import { aiConfig } from './config.js';
import { personalPrompt } from '../core/defaults.js';
import { Agent, newChat, type ChatMessage, type ChatRecord } from './agent.js';
import { resolveMentions, contextBlock, type Attachment } from './mentions.js';
import type { ToolMeta } from '../mcp/orchestrator.js';
import { fs } from '../project/fs.js';
import { TOOL_BY_NAME } from '../mcp/schemas.js';
import type { Effort, StreamEvent, TokenUsage } from './types.js';
import { skillsPrompt } from './skills.js';
import {
  TeamRun,
  ROLE_DEFS,
  enabledWorkers,
  memberOf,
  parseVerdict,
  planSystem,
  reviewInput,
  reviewSystem,
  synthesisInput,
  synthesisSystem,
  toolAllowed,
  workerInput,
  workerSystem,
  type TaskGraph,
  type TaskState,
  type TeamConfig,
  type TeamMember,
  type TeamState,
  type ToolCallSummary,
  type WorkerOutput,
  type WorkerRoleId,
} from './team.js';

export interface TeamHooks {
  /** The team message changed: state (graph, statuses, usage), a sub-thread, or the final text */
  update(msg: ChatMessage, what: 'state' | 'thread' | 'text', taskId?: string): void;
}

export interface TeamSendOptions {
  /** Only these specialists (several @agent mentions) */
  only?: WorkerRoleId[];
  /** One specialist addressed directly (@word-agent): no planning, no leader review */
  direct?: WorkerRoleId;
  /** The request was sent to that specialist by the team's own routing (autoRoute), not by an @mention */
  routed?: boolean;
  images?: { mime: string; data: string }[];
  previews?: string[];
}

const FILE_LIMIT = 80;

export class TeamSession {
  run: TeamRun | null = null;
  /** Between Send and the start of the run (mentions resolve): already busy for the interface */
  private starting = false;
  private stopRequested = false;
  private approvals = new Map<string, (ok: boolean) => void>();
  /** Auto approval (full access): tools that need approval run without the inline prompt */
  autoApprove: () => boolean = () => false;
  /** Tools the user allowed for the rest of this run ("Allow for this run" on an approval card) */
  private allowedForRun = new Set<string>();

  constructor(
    public chat: ChatRecord,
    private hooks: TeamHooks,
    /** Provider and effort of the chat (members without their own provider use these) */
    private chatProvider: () => string | undefined,
    private chatEffort: () => Effort | undefined
  ) {}

  get running(): boolean {
    return this.starting || !!this.run?.running;
  }

  /** Stop All Agents: the master AbortController ends the leader and every sub-agent stream. */
  stop(): void {
    if (this.starting) this.stopRequested = true;
    this.run?.stop();
    for (const [, fn] of this.approvals) fn(false);
    this.approvals.clear();
  }

  /** Cancels one sub-agent; the others keep working. */
  cancel(taskId: string): void {
    this.approvals.get(taskId)?.(false);
    this.run?.cancel(taskId);
  }

  /**
   * Answer of the inline approval in a sub-agent's card. always: the same tool needs no question again for the rest of this
   * run (every agent that waits for it is let through at once).
   */
  answer(taskId: string, ok: boolean, always = false): void {
    if (ok && always) {
      const tool = this.run?.state.tasks.find((t) => t.id === taskId)?.approval?.tool;
      if (tool) {
        this.allowedForRun.add(tool);
        for (const t of this.run?.state.tasks || []) if (t.approval?.tool === tool) this.approvals.get(t.id)?.(true);
        return;
      }
    }
    this.approvals.get(taskId)?.(ok);
  }

  /** Human in the loop: Approve or Reject on the plan in the Mission Control card. */
  answerPlan(ok: boolean): void {
    this.planAnswer?.(ok);
  }

  private planAnswer: ((ok: boolean) => void) | null = null;

  /** Waits for the user's decision on the plan; Stop All Agents and Auto approval settle it too. */
  private waitForPlan(run: TeamRun, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        this.planAnswer = null;
        signal.removeEventListener('abort', onAbort);
        resolve(ok);
      };
      const onAbort = () => done(false);
      signal.addEventListener('abort', onAbort, { once: true });
      this.planAnswer = done;
      run.emit();
    });
  }

  private providerOf(m: TeamMember): string | undefined {
    return m.provider || this.chatProvider();
  }

  private effortOf(m: TeamMember): Effort | undefined {
    if (m.effort !== 'auto') return m.effort;
    return m.provider ? undefined : this.chatEffort();
  }

  async send(input: string, config: TeamConfig, opt: TeamSendOptions = {}): Promise<void> {
    if (this.running) return;
    this.starting = true;
    this.stopRequested = false;
    this.allowedForRun.clear();
    const chat = this.chat;
    let atts: Attachment[] = [];
    try {
      atts = await resolveMentions(input).catch(() => []);
    } finally {
      this.starting = false;
    }
    if (this.stopRequested) return;
    const user: ChatMessage = { id: uid('m'), role: 'user', text: input, created: new Date().toISOString(), attachments: atts.map((a) => ({ kind: a.kind, label: a.label, path: a.path, chars: a.chars })), ...(opt.previews?.length ? { images: opt.previews } : {}) };
    chat.messages.push(user);
    if (chat.title === tr('New chat') || chat.title === 'Neuer Chat') chat.title = input.replace(/\s+/g, ' ').slice(0, 60) || 'Team';
    this.hooks.update(user, 'state');

    const leader = config.leader;
    const msg: ChatMessage = { id: uid('m'), role: 'assistant', text: '', created: new Date().toISOString(), steps: [] };
    const threads: Record<string, ChatMessage[]> = {};
    const subChats = new Map<string, ChatRecord>();
    const de = lang === 'de';
    const ctx = contextBlock(atts);
    const files = fs.files().map((f) => f.path);
    const project = `Project files: ${files.slice(0, FILE_LIMIT).join(', ')}${files.length > FILE_LIMIT ? ' …' : ''}`;
    const leaderPrompt = `${input}${ctx}\n\n${project}`;

    let graph: TaskGraph | undefined;
    if (opt.direct) {
      const targets = atts.filter((a) => a.kind === 'file' && a.path).map((a) => a.path!);
      graph = { goal: '', tasks: [{ id: 't1', title: input.replace(/\s+/g, ' ').slice(0, 80), assignedAgent: opt.direct, dependencies: [], targetFiles: targets, instructions: input + ctx }] };
    }

    const run = new TeamRun({
      config,
      ...(graph ? { graph } : {}),
      ...(opt.only?.length ? { only: opt.only } : {}),
      id: msg.id,
      onUpdate: (state) => {
        msg.changed = [...new Set(state.tasks.flatMap((t) => t.changed))];
        this.hooks.update(msg, 'state');
      },
      driver: {
        plan: async (prompt, correction, signal) => {
          const text = correction ? `${prompt}\n\nYour last plan had these problems. Answer again with the corrected JSON plan:\n${correction}` : prompt;
          return this.leaderCall(run, leader, planSystem(enabledWorkers(config, opt.only), '', config.pattern), text, signal);
        },
        approvePlan: (_graph, signal) => this.waitForPlan(run, signal),
        work: (task, input2, signal) => this.work(run, config, task, input2, signal, msg, threads, subChats, input, de),
        review: async (task, out, findings, signal) => parseVerdict(await this.leaderCall(run, leader, reviewSystem(), reviewInput(task, out, findings), signal), findings),
        synthesize: (prompt, tasks, signal) =>
          this.leaderCall(run, leader, synthesisSystem(de), synthesisInput(prompt, tasks), signal, (text) => {
            msg.text = text;
            this.hooks.update(msg, 'text');
          }),
      },
    });
    if (opt.routed) run.state.routed = true;
    msg.team = { state: run.state, threads };
    chat.messages.push(msg);
    this.run = run;
    this.hooks.update(msg, 'state');
    try {
      await run.run(opt.direct ? input : leaderPrompt);
    } finally {
      for (const [, fn] of this.approvals) fn(false);
      this.approvals.clear();
      const s = run.state;
      msg.text = s.summary || msg.text || '';
      if (s.phase === 'failed') msg.error = { code: 'PROVIDER', message: s.error || tr('The team could not finish the task.') };
      msg.usage = sumUsage(s);
      if (msg.usage) addChatUsage(chat, msg.usage);
      const lead = s.usage.leader;
      if (lead) (msg.provider = lead.provider), (msg.model = lead.model), (msg.providerId = lead.providerId);
      msg.done = true;
      // History of the main chat: the request and the leader's answer (single-agent turns go on from here)
      chat.turns.push({ role: 'user', content: input + ctx, ...(opt.images?.length ? { images: opt.images } : {}) });
      chat.turns.push({ role: 'assistant', text: msg.text || tr('Team stopped.'), toolCalls: [] });
      chat.updated = new Date().toISOString();
      this.hooks.update(msg, 'state');
    }
  }

  /** One leader request without tools; streams text and thinking, counts usage as role leader. */
  private async leaderCall(run: TeamRun, leader: TeamMember, system: string, user: string, signal: AbortSignal, onText?: (text: string) => void): Promise<string> {
    const effort = this.effortOf(leader);
    const model = leader.model || undefined;
    const body = { system, turns: [{ role: 'user', content: user }], tools: [], toolChoice: 'none', provider: this.providerOf(leader), ...(model ? { model } : {}), ...(effort ? { effort } : {}), meta: { files: [], chat: this.chat.id, role: 'leader' } };
    let text = '';
    let thinking = '';
    for await (const ev of postSse<StreamEvent>('/api/ai/chat', body, signal)) {
      if (ev.type === 'text') {
        text += ev.delta;
        onText?.(text);
      } else if (ev.type === 'reasoning') {
        thinking += ev.delta;
        run.state.leader.activity = thinking.replace(/\s+/g, ' ').slice(-160);
        run.emit();
      } else if (ev.type === 'usage') run.addUsage('leader', ev.usage);
      else if (ev.type === 'error') throw Object.assign(new Error(ev.error.message), { code: ev.error.code });
    }
    if (signal.aborted) throw Object.assign(new Error('Stopped by the user.'), { name: 'AbortError' });
    return text;
  }

  /** One attempt of one task in its sub-thread. */
  private async work(run: TeamRun, config: TeamConfig, task: TaskState, input: { deps: Parameters<typeof workerInput>[1]; feedback?: string; attempt: number; memory: string }, signal: AbortSignal, msg: ChatMessage, threads: Record<string, ChatMessage[]>, subChats: Map<string, ChatRecord>, request: string, de: boolean): Promise<WorkerOutput> {
    const role = task.assignedAgent;
    const def = ROLE_DEFS[role];
    const m = memberOf(config, role);
    let sub = subChats.get(task.id);
    if (!sub) {
      sub = { ...newChat(), id: `${this.chat.id}-${task.id}`.replace(/[^\w-]/g, '').slice(0, 80), title: `${def.name}: ${task.title}` };
      subChats.set(task.id, sub);
    }
    threads[task.id] = sub.messages;
    const before = sub.messages.length;
    const agent = new Agent(
      sub,
      {
        update: (_m, what) => {
          this.activity(run, task, sub!, what);
          this.hooks.update(msg, 'thread', task.id);
        },
        // A failed call goes back to the sub-agent's model; the leader reviews the outcome
        failure: async () => ({ action: 'report' }),
        approve: (tool, args) => this.approve(run, task, tool, args, signal),
      },
      () => this.providerOf(m),
      () => this.effortOf(m),
      {
        system: () => [workerSystem(role, de, personalPrompt(aiConfig.config?.personal)), skillsPrompt()].filter(Boolean).join('\n'),
        tools: (t: ToolMeta) => toolAllowed(role, t),
        model: () => m.model || undefined,
        role,
        context: false,
        chain: msg.id,
        badge: { role, label: def.short, accent: def.accent },
        onUsage: (u: TokenUsage) => run.addUsage(role, u),
      }
    );
    const onAbort = () => agent.stop();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (signal.aborted) return { text: '', changed: [], toolCalls: [] };
      await agent.send(workerInput(task, input.deps, input.feedback, `Request of the user: ${request.slice(0, 2000)}`, input.memory));
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    const answers = sub.messages.slice(before).filter((x) => x.role === 'assistant');
    const last = answers.at(-1);
    const toolCalls: ToolCallSummary[] = answers.flatMap((a) =>
      (a.steps || [])
        .filter((s) => s.status === 'done' || s.status === 'error')
        .map((s) => {
          const def2 = TOOL_BY_NAME.get(s.name);
          const p = def2?.pathArg ? s.args[def2.pathArg] : undefined;
          run.addToolCall(role, s.status === 'done', s.result?.ms || 0);
          return { name: s.name, ok: s.status === 'done', ...(s.result?.text ? { text: s.result.text.slice(0, 400) } : {}), ...(typeof p === 'string' ? { path: p } : {}) };
        })
    );
    return { text: (last?.text || '').trim(), changed: [...new Set(answers.flatMap((a) => a.changed || []))], toolCalls, ...(last?.error ? { error: last.error.message } : {}) };
  }

  /** Live status line of a sub-agent: thinking, the running tool, or the last line it wrote. */
  private activity(run: TeamRun, task: TaskState, sub: ChatRecord, what: string) {
    const m = [...sub.messages].reverse().find((x) => x.role === 'assistant');
    if (!m) return;
    const running = (m.steps || []).find((s) => s.status === 'running' || s.status === 'pending');
    const thought = m.thoughts?.at(-1);
    if (running) {
      task.tool = running.name;
      const def = TOOL_BY_NAME.get(running.name);
      const p = def?.pathArg ? running.args[def.pathArg] : undefined;
      task.activity = running.progress.at(-1) || `${running.name}${typeof p === 'string' ? ` ${p}` : ''}`;
    } else if (thought && !thought.done) {
      task.tool = undefined;
      task.activity = `${tr('Thinking')}: ${thought.text.replace(/\s+/g, ' ').slice(-140)}`;
    } else if (m.text) {
      task.tool = undefined;
      task.activity = m.text.replace(/\s+/g, ' ').trim().slice(-140);
    }
    void what;
    void run;
  }

  /** Inline approval in the card of the sub-agent; the rest of the team does not wait. */
  private approve(run: TeamRun, task: TaskState, tool: ToolMeta, args: Record<string, unknown>, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    if (this.autoApprove() || this.allowedForRun.has(tool.name)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        this.approvals.delete(task.id);
        signal.removeEventListener('abort', onAbort);
        task.approval = undefined;
        task.activity = ok ? tr('Approved: {title}', { title: tool.title }) : tr('Not approved: {title}', { title: tool.title });
        run.emit();
        resolve(ok);
      };
      const onAbort = () => done(false);
      signal.addEventListener('abort', onAbort, { once: true });
      this.approvals.set(task.id, done);
      task.approval = { tool: tool.name, title: tool.title, args };
      task.activity = tr('Waiting for your approval: {title}', { title: tool.title });
      run.emit();
    });
  }
}

/** Tokens of every role of a run, in the shape of a message's usage. */
export function sumUsage(s: TeamState): ChatMessage['usage'] {
  const rows = Object.values(s.usage);
  if (!rows.length) return undefined;
  const lead = s.usage.leader;
  return {
    input: rows.reduce((a, r) => a + r.input, 0),
    output: rows.reduce((a, r) => a + r.output, 0),
    cached: rows.reduce((a, r) => a + r.cached, 0),
    reasoning: rows.reduce((a, r) => a + (r.reasoning || 0), 0) || undefined,
    rounds: rows.reduce((a, r) => a + r.requests, 0),
    estimated: rows.some((r) => r.estimated > 0),
    firstMs: lead && lead.requests ? Math.round(lead.firstMs / lead.requests) : 0,
    totalMs: (s.ended || Date.now()) - s.started,
    context: Math.max(0, ...rows.map((r) => (r.requests ? Math.round(r.input / r.requests) : 0))),
  };
}

function addChatUsage(chat: ChatRecord, u: NonNullable<ChatMessage['usage']>) {
  const c = (chat.usage ||= { input: 0, output: 0, cached: 0, requests: 0, context: 0 });
  c.input += u.input;
  c.output += u.output;
  c.cached += u.cached;
  if (u.reasoning) c.reasoning = (c.reasoning || 0) + u.reasoning;
  c.requests += u.rounds;
  c.context = Math.max(c.context, u.context);
}

/** Running team phases left in a saved chat (the page closed during a run) read as stopped. */
export function settleSaved(state: TeamState): void {
  if (['completed', 'stopped', 'failed'].includes(state.phase)) return;
  state.phase = 'stopped';
  state.ended ||= Date.now();
  for (const t of state.tasks) if (!['done', 'failed', 'cancelled', 'skipped'].includes(t.status)) (t.status = 'cancelled'), (t.approval = undefined), (t.activity = undefined);
}

