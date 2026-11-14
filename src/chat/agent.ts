// AI agent: loop of model answer (token streaming over SSE) and MCP tool calls.
//
// - Multi-step chains across several apps (for example read GridCraft, write WordCraft,
//   create DeckCraft slides) with up to MAX_STEPS model rounds.
// - Prompt prefix in a fixed order for provider prefix caching (DeepSeek context caching):
//   core system prompt, sorted tool schemas, project context frozen per chat, then the conversation.
//   Everything that changes per question (open panels, project memory, new files) goes into the
//   user turn and stays in the history, so the history only grows at the end.
// - Thinking models: reasoning_content streams into a "Thought process" card per round and goes back
//   to DeepSeek with every later request of a tool chain (the API answers 400 without it).
// - Every tool call is checked with Zod first. Malformed JSON is repaired in the router; arguments
//   that stay invalid go back to the model once as a structured error (self-correction, nothing runs).
//   When that fails too, the agent stops and offers retry, edit, report the error to the AI or cancel.
// - / commands force the tool. When all arguments are known, the call runs directly
//   without a language model.

import { postSse, api } from '../app/backend.js';
import { aiConfig } from './config.js';
import { skillsInfo, skillsPrompt } from './skills.js';
import { personalPrompt } from '../core/defaults.js';
import { uid } from '../app/util.js';
import type { BudgetReport, ChatRequest, ChatTurn, Effort, ReplayState, StreamEvent, ToolCall, ToolChoice, ToolResultItem, AiErrorInfo, TokenUsage, TurnDoc, TurnImage } from './types.js';
import { closeOpenFences } from '../core/json-repair.js';
import { estimateTokens } from './usage.js';
import { FailureGuard, MAX_SAME_FAILURES } from './loop-guard.js';
import { bus } from '../app/bus.js';
import { showModelNotice } from './model-notice.js';
import { orchestrator, type CallOutcome, type ToolMeta } from '../mcp/orchestrator.js';
import { resolveMentions, contextBlock, findMentions, type Attachment } from './mentions.js';
import { fs } from '../project/fs.js';
import { projects } from '../project/manager.js';
import { workspace } from '../workspace/layout.js';
import { t as tr, lang } from '../app/i18n.js';
import type { TeamState } from './team.js';
import { prefs } from '../app/settings.js';
import { FIND_TOOLS, compactSpec, compactTurns, findTools, findToolsSpec, foundText, routeTools, tokensOf, type RouteTool } from './economy.js';

export const MAX_STEPS = 8;

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'waiting';

export interface AgentStep {
  id: string;
  name: string;
  title: string;
  app: string;
  args: Record<string, unknown>;
  argsError?: string;
  status: StepStatus;
  progress: string[];
  result?: { ok: boolean; text: string; stage?: string; issues?: string[]; ms: number; changed: string[] };
  attempts: number;
  started?: number;
  ended?: number;
  /** Model round of the answer the call belongs to (orders thought cards and steps) */
  round?: number;
  /** The validation error went back to the model for a self-correction */
  corrected?: boolean;
  /** What the repair pass fixed in malformed arguments */
  repaired?: string[];
  /** Ran at the same time as this many other independent reads */
  parallel?: number;
}

/** Chain of thought of one model round (DeepSeek reasoning_content). */
export interface Thought {
  round: number;
  text: string;
  /** Thinking time in milliseconds (live while thinking) */
  ms: number;
  tokens: number;
  /** tokens counted exactly (tokenizer or provider usage) */
  exact: boolean;
  /** The answer or a tool call started: the card collapses */
  done: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  created: string;
  attachments?: { kind: string; label: string; path?: string; chars: number }[];
  steps?: AgentStep[];
  provider?: string;
  model?: string;
  error?: AiErrorInfo;
  forcedTool?: string;
  direct?: boolean;
  done?: boolean;
  /** Small previews (data URLs) of images sent with the message */
  images?: string[];
  /** Tokens of all model rounds of this answer */
  usage?: MessageUsage;
  /** Files the tools of this answer changed (undo across all tools) */
  changed?: string[];
  /** The changes of this answer were undone */
  undone?: boolean;
  /** Persona that answered */
  persona?: string;
  /** Provider id and thinking effort of the answer (telemetry, reasoning bar) */
  providerId?: string;
  effort?: Effort;
  /** Project memory was used (notes, passages) */
  memory?: { notes: number; passages: { source: string; loc: string }[] };
  /** Thought process per model round */
  thoughts?: Thought[];
  /** Pre-flight check of the last request (context fitting) */
  budget?: BudgetReport;
  /** Tokens this answer did not send (estimated): tool definitions held back, old results and attachments shrunk */
  economy?: { tools: number; history: number };
  /** Team Mode answer: task graph, sub-agent states, per-role usage and the sub-thread transcripts */
  team?: { state: TeamState; threads: Record<string, ChatMessage[]> };
}

export interface MessageUsage {
  input: number;
  output: number;
  cached: number;
  cacheMiss?: number;
  cacheWrite?: number;
  reasoning?: number;
  rounds: number;
  estimated: boolean;
  firstMs: number;
  totalMs: number;
  /** Prompt size of the last round: how full the context window is */
  context: number;
}

/** Extra content of a user message: images for the model and their previews. */
export interface SendExtras {
  images?: TurnImage[];
  previews?: string[];
}

export interface ChatRecord {
  id: string;
  title: string;
  created: string;
  updated: string;
  provider?: string;
  messages: ChatMessage[];
  /** History in the format of the AI router (including tool calls and results) */
  turns: ChatTurn[];
  /** Tokens of the whole chat */
  usage?: { input: number; output: number; cached: number; cacheMiss?: number; reasoning?: number; requests: number; context: number; model?: string };
  /**
   * Project context frozen when the chat starts, so every request of the chat begins with the same
   * prefix. known: paths the model was told about (start list plus announced changes).
   */
  /** context: project context frozen at the first message; known: files the model heard of; sent: tools sent so far (only grows, keeps the prompt prefix stable) */
  prefix?: { context: string; known: string[]; sent?: string[] };
  /** Difference between the provider's prompt_tokens and the pre-flight count (tool schema rendering) */
  calib?: { model: string; offset: number };
}

export type FailureChoice = { action: 'retry' } | { action: 'edit'; args: Record<string, unknown> } | { action: 'report' } | { action: 'abort' };

/**
 * Options of a Team Mode sub-agent: its own role prompt, a tool scope, its own model, no @ resolution
 * or project memory lookup (the leader passes the context in the task), and the answer id of the team
 * turn so Undo covers every file the whole team wrote.
 */
export interface AgentOptions {
  system?: () => string;
  tools?: (t: ToolMeta) => boolean;
  model?: () => string | undefined;
  /** Team role for usage per role (sent to the backend) */
  role?: string;
  /** Resolve @ mentions and look up the project memory (default true) */
  context?: boolean;
  chain?: string;
  /** Accent and label that flash on panels of files this agent writes */
  badge?: { role: string; label: string; accent: string };
  maxSteps?: number;
  onUsage?: (u: TokenUsage) => void;
}

export interface AgentHooks {
  /** New or changed message (streaming, status cards, thought process) */
  update(msg: ChatMessage, what: 'text' | 'step' | 'meta' | 'thought'): void;
  /** A step failed: the user decides how to go on */
  failure(step: AgentStep, msg: ChatMessage): Promise<FailureChoice>;
  approve(tool: ToolMeta, args: Record<string, unknown>): Promise<boolean>;
}

export function newChat(): ChatRecord {
  const now = new Date().toISOString();
  return { id: uid('chat').replace(/[^\w-]/g, ''), title: tr('New chat'), created: now, updated: now, messages: [], turns: [] };
}

/** (1) Core system prompt: the same for every request of every chat until settings change. */
function coreSystem(): string {
  return [
    'You are the AI assistant of WorkCraft, a local workspace with four apps: WordCraft (documents, .docx/.md), GridCraft (spreadsheets, .xlsx/.csv), DeckCraft (presentations, .pptx) and PdfCraft (PDF).',
    `You work on the project files directly through MCP tools. The apps show changes right away. ${lang === 'de' ? 'Answer in German' : 'Answer in the language of the user (English by default)'}, short and to the point.`,
    'Rules:',
    '1. Use tools instead of making up file contents. Read data before you evaluate it.',
    '2. For multi-step tasks, run the steps one after another and use the results of earlier steps as arguments.',
    '3. Mentions like @file.xlsx or @gridcraft in the user text are resolved in the <context> block. Mentioned apps decide which tools you use.',
    '4. Paths start with / and live in the project. Create new files in the matching folder: /documents, /sheets, /presentations, /pdf.',
    '5. If a tool reports an error, correct the arguments or explain the problem. Do not repeat the same failing call.',
    '6. At the end, sum up in one to three sentences what you created or changed, with file paths.',
    '7. Use search-project to find content by meaning across all files and chats. Use remember to keep decisions the user wants kept.',
    '8. The <session> block of a user message has the open panels, project changes and project memory at that moment.',
    skillsPrompt(),
    personalPrompt(aiConfig.config?.personal),
  ]
    .filter(Boolean)
    .join('\n');
}

const FILE_LIMIT = 80;

/** (3) Persistent project context: frozen at the start of a chat (see ChatRecord.prefix). */
function projectContext(paths: string[]): string {
  const p = projects.current;
  return [`Active project: ${p?.name || 'unknown'} with ${paths.length} files.`, `Files: ${paths.slice(0, FILE_LIMIT).join(', ')}${paths.length > FILE_LIMIT ? ' …' : ''}`].join('\n');
}

/** Per question: open panels, files added or removed since the model last heard, project memory. */
function sessionBlock(chat: ChatRecord, memoryBlock: string, commit: boolean): string {
  const open = workspace
    .panels()
    .filter((x) => x.tool !== 'tree' && x.tool !== 'chat')
    .map((x) => `${x.tool}${x.path ? ` (${x.path})` : ''}${x.mode !== 'normal' ? ` [${x.mode}]` : ''}`)
    .join(', ');
  const now = fs.files().map((f) => f.path);
  const known = new Set(chat.prefix?.known || now);
  const added = now.filter((x) => !known.has(x));
  const current = new Set(now);
  const removed = [...known].filter((x) => !current.has(x));
  if (commit && chat.prefix) chat.prefix.known = now.slice(0, 2000);
  const lines = [`Open panels: ${open || 'none'}.`];
  if (added.length) lines.push(`New files since earlier in this chat: ${added.slice(0, 40).join(', ')}${added.length > 40 ? ' …' : ''}`);
  if (removed.length) lines.push(`Removed files: ${removed.slice(0, 40).join(', ')}${removed.length > 40 ? ' …' : ''}`);
  if (memoryBlock) lines.push(memoryBlock);
  return `\n\n<session>\n${lines.join('\n')}\n</session>`;
}

const NATIVE_MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/**
 * PDFs and images among the @-mentioned files: references the backend turns into native document
 * blocks for Claude, Gemini and ChatGPT (their extracted text stays in the <context> block for the rest).
 */
function nativeDocRefs(atts: Attachment[]): TurnDoc[] {
  const sizes = new Map(fs.files().map((f) => [f.path, f.size]));
  return atts
    .filter((a) => a.kind === 'file' && a.path && NATIVE_MIME[(a.path.split('.').pop() || '').toLowerCase()])
    .slice(0, 8)
    .map((a) => ({ path: a.path!, mime: NATIVE_MIME[(a.path!.split('.').pop() || '').toLowerCase()]!, size: sizes.get(a.path!) || 0 }));
}

/** Freezes the project context of a chat on its first message (older chats get it on the next one). */
function ensurePrefix(chat: ChatRecord): NonNullable<ChatRecord['prefix']> {
  if (!chat.prefix) {
    const paths = fs.files().map((f) => f.path);
    chat.prefix = { context: projectContext(paths), known: paths.slice(0, 2000) };
  }
  return chat.prefix;
}

/** Project memory for a question (notes, recent AI steps, relevant passages). */
async function projectMemory(query: string, exclude: string[]): Promise<{ block: string; notes: number; passages: { source: string; loc: string }[] }> {
  if (aiConfig.config && !aiConfig.config.search?.memory) return { block: '', notes: 0, passages: [] };
  try {
    const r = await api.send<{ block: string; notes: unknown[]; passages: { source: string; loc: string }[] }>('POST', '/api/memory/context', { query: query.slice(0, 4000), exclude });
    return { block: r.block || '', notes: r.notes?.length || 0, passages: (r.passages || []).map((x) => ({ source: x.source, loc: x.loc })) };
  } catch {
    return { block: '', notes: 0, passages: [] };
  }
}

/** Parses arguments of a / command: key=value, key="value with spaces", key=[1,2] or {"json": true}. */
export function parseSlashArgs(rest: string, tool: ToolMeta | null): { args: Record<string, unknown>; freeText: string } {
  const args: Record<string, unknown> = {};
  let free = rest.trim();
  const json = free.match(/^\{[\s\S]*\}$/);
  if (json) {
    try {
      return { args: JSON.parse(free) as Record<string, unknown>, freeText: '' };
    } catch {
      /* go on as text */
    }
  }
  free = free.replace(/(^|\s)([a-zA-Z_][\w-]*)=("(?:[^"\\]|\\.)*"|\[[^\]]*\]|\{[^}]*\}|\S+)/g, (_m, _s: string, k: string, v: string) => {
    let val: unknown = v;
    if (v.startsWith('"')) val = JSON.parse(v);
    else if (/^[[{]/.test(v) || /^(true|false|null|-?\d+(\.\d+)?)$/.test(v)) {
      try {
        val = JSON.parse(v);
      } catch {
        val = v;
      }
    }
    args[k] = val;
    return ' ';
  });
  // Use the first @ file as the path argument
  const pathArg = tool?.pathArg;
  if (pathArg && args[pathArg] === undefined) {
    const ref = findMentions(free).find((r) => fs.resolve(r)?.kind === 'file');
    const e = ref ? fs.resolve(ref) : null;
    if (e) {
      args[pathArg] = e.path;
      free = free.replace('@' + ref, ' ');
    }
  }
  return { args, freeText: free.replace(/\s+/g, ' ').trim() };
}

export class Agent {
  private abort: AbortController | null = null;
  private pendingMemory: ChatMessage['memory'];
  private auditFiles: { name: string; kind: string; size: number }[] = [];
  /** Self-corrections used per tool in the current answer (one each, then the user decides) */
  private corrections = new Map<string, number>();
  /** The same call failing three times in this answer ends it (see loop-guard.ts) */
  private guard = new FailureGuard();
  running = false;
  constructor(
    public chat: ChatRecord,
    private hooks: AgentHooks,
    private provider: () => string | undefined,
    private effort: () => Effort | undefined = () => undefined,
    private opts: AgentOptions = {}
  ) {}

  /** System prompt of this agent: the core prompt, or the role prompt of a team sub-agent. */
  private system(): string {
    return this.opts.system?.() ?? coreSystem();
  }

  /** The question the tool router looks at: the user's words, what is attached, a / command (set in send, the draft in preview) */
  private route = { text: '', paths: [] as string[], forced: undefined as string | undefined };
  /** Tools withheld in the last request (find-tools can load them), and what holding them back saved */
  private hidden: RouteTool[] = [];
  private hiddenTokens = 0;
  /** What shrinking the history of earlier questions saved (tokens, per request) */
  private historySaved = 0;

  /** Tools the model called earlier in this chat. */
  private usedTools(): string[] {
    const out = new Set<string>();
    for (const t of this.chat.turns) if (t.role === 'assistant') for (const c of t.toolCalls) if (c.name !== FIND_TOOLS) out.add(c.name);
    return [...out];
  }

  /**
   * Tool schemas this agent sends. A team sub-agent sees the tools of its role. The single agent gets the workspace tools
   * and the tools of the apps the question is about; the rest stay one find-tools call away (src/chat/economy.ts).
   * With commit the chosen tools are remembered for this chat, so the set only grows and the prompt prefix stays cacheable.
   */
  private toolSpecs(commit = false, text = this.route.text, paths = this.route.paths) {
    const all = orchestrator.tools();
    const foreign = (s: ReturnType<typeof orchestrator.specs>[number]) => (orchestrator.tool(s.name)?.source === 'external' ? compactSpec(s) : s);
    const scope = this.opts.tools;
    if (scope) {
      this.hidden = [];
      this.hiddenTokens = 0;
      return orchestrator.specs(all.filter(scope).map((t) => t.name)).map(foreign);
    }
    const r = routeTools({ tools: all.map((t) => ({ name: t.name, source: t.source, description: t.description, title: t.title })), text, paths, used: this.usedTools(), sent: this.chat.prefix?.sent || [], forced: this.route.forced });
    if (commit) {
      const prefix = ensurePrefix(this.chat);
      prefix.sent = [...new Set([...(prefix.sent || []), ...r.send])].sort();
    }
    this.hidden = r.hidden;
    this.hiddenTokens = r.hidden.length ? tokensOf(JSON.stringify(orchestrator.specs(r.hidden.map((t) => t.name)).map(foreign)).length) : 0;
    const specs = orchestrator.specs(r.send).map(foreign);
    if (r.hidden.length) specs.push(findToolsSpec(r.hidden));
    return specs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  stop(): void {
    this.abort?.abort();
  }

  /**
   * The request the next send would make with this draft (system prompt, tool schemas, project
   * context, history, the draft with its attachments), for the live count in the chat footer.
   * The project memory is looked up on send and is not part of the preview.
   */
  preview(draft: string, atts: Attachment[], images = 0): Pick<ChatRequest, 'system' | 'context' | 'turns' | 'tools'> {
    const context = this.chat.prefix?.context ?? projectContext(fs.files().map((f) => f.path));
    const docs = nativeDocRefs(atts);
    const pending: ChatTurn[] = draft.trim() || atts.length || images ? [{ role: 'user', content: draft + contextBlock(atts) + sessionBlock(this.chat, '', false), ...(images ? { images: Array.from({ length: images }, () => ({ mime: 'image/png', data: '' })) } : {}), ...(docs.length ? { docs } : {}) }] : [];
    return { system: this.system(), context, turns: [...this.chat.turns, ...pending], tools: this.toolSpecs(false, `${draft} ${atts.map((a) => a.label).join(' ')}`, atts.map((a) => a.path || '').filter(Boolean)) };
  }

  /** Sends a user message. forcedTool comes from a / command. */
  async send(input: string, forcedTool?: string, extras: SendExtras = {}): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    try {
      if (!orchestrator.ready) await orchestrator.connect().catch(() => {});
      if (!aiConfig.config) await aiConfig.get().catch(() => null);
      await skillsInfo.ensure();
      const atts = this.opts.context === false ? [] : await resolveMentions(input);
      // Metadata of the attached files for the audit log (names, kinds, sizes, never content)
      this.auditFiles = [...atts.filter((a) => a.kind !== 'missing').map((a) => ({ name: a.path || a.label, kind: a.kind, size: a.chars })), ...(extras.images || []).map((im, i) => ({ name: `image ${i + 1}`, kind: im.mime, size: Math.round((im.data.length * 3) / 4) }))];
      const user: ChatMessage = { id: uid('m'), role: 'user', text: input, created: new Date().toISOString(), attachments: atts.map((a) => ({ kind: a.kind, label: a.label, path: a.path, chars: a.chars })), forcedTool, ...(extras.previews?.length ? { images: extras.previews } : {}) };
      this.chat.messages.push(user);
      if (this.chat.title === tr('New chat') || this.chat.title === 'Neuer Chat') this.chat.title = input.replace(/\s+/g, ' ').slice(0, 60) || 'Chat';
      this.hooks.update(user, 'meta');

      const tool = forcedTool ? orchestrator.tool(forcedTool) : null;
      if (forcedTool && tool && !extras.images?.length) {
        const { args, freeText } = parseSlashArgs(input.replace(new RegExp(`^/${forcedTool}\\b`), ''), tool);
        // Run directly when no free text is left and the arguments are valid
        if (!freeText.replace(/@\S+/g, '').trim() && orchestrator.validate(forcedTool, args).ok) {
          await this.direct(tool, args, user, signal);
          return;
        }
      }
      const mem = this.opts.context === false ? { block: '', notes: 0, passages: [] } : await projectMemory(input, atts.map((a) => a.path || '').filter(Boolean));
      for (const ps of mem.passages) this.auditFiles.push({ name: ps.source, kind: 'memory passage', size: 0 });
      ensurePrefix(this.chat);
      // Token economy: what earlier questions left in the history shrinks, the tool router sees this question
      const shrunk = compactTurns(this.chat.turns);
      this.historySaved = tokensOf(shrunk.chars) + shrunk.media * 800;
      this.route = { text: `${input} ${atts.map((a) => a.label).join(' ')}`, paths: atts.map((a) => a.path || '').filter(Boolean), forced: forcedTool };
      this.corrections.clear();
      this.guard.reset();
      const content = input + contextBlock(atts) + sessionBlock(this.chat, mem.block, true) + (forcedTool ? `\n\n(The user picked the tool ${forcedTool}. Call it.)` : '');
      this.pendingMemory = mem.notes || mem.passages.length ? { notes: mem.notes, passages: mem.passages } : undefined;
      const docs = nativeDocRefs(atts);
      this.chat.turns.push({ role: 'user', content, ...(extras.images?.length ? { images: extras.images } : {}), ...(docs.length ? { docs } : {}) });
      await this.loop(forcedTool ? { name: forcedTool } : 'auto', signal);
    } finally {
      this.running = false;
      this.abort = null;
      this.chat.updated = new Date().toISOString();
    }
  }

  /** / command without a language model: one tool call, the result is the answer. */
  private async direct(tool: ToolMeta, args: Record<string, unknown>, user: ChatMessage, signal: AbortSignal) {
    const msg: ChatMessage = { id: uid('m'), role: 'assistant', text: '', created: new Date().toISOString(), steps: [], direct: true };
    this.chat.messages.push(msg);
    const call: ToolCall = { id: uid('call'), name: tool.name, args };
    const results = await this.runCalls([call], msg, signal);
    const r = results[0];
    msg.text = r ? (r.isError ? tr('{title} failed.', { title: tool.title }) : r.content.length > 6000 ? r.content.slice(0, 6000) + '\n…' : r.content) : '';
    if (r && !r.isError && /^\s*[[{]/.test(msg.text)) msg.text = '```json\n' + msg.text + '\n```';
    msg.done = true;
    // Keep the history consistent for later model rounds
    this.chat.turns.push({ role: 'user', content: user.text });
    this.chat.turns.push({ role: 'assistant', text: '', toolCalls: [call] });
    this.chat.turns.push({ role: 'tool', results });
    this.hooks.update(msg, 'text');
  }

  private async loop(firstChoice: ToolChoice, signal: AbortSignal) {
    let choice: ToolChoice = firstChoice;
    const persona = aiConfig.config?.personal?.personas.find((p) => p.id === aiConfig.config?.personal.active);
    const msg: ChatMessage = { id: uid('m'), role: 'assistant', text: '', created: new Date().toISOString(), steps: [], ...(persona && persona.id !== 'default' ? { persona: persona.name } : {}), ...(this.pendingMemory ? { memory: this.pendingMemory } : {}) };
    this.pendingMemory = undefined;
    this.chat.messages.push(msg);
    this.hooks.update(msg, 'meta');
    const prefRounds = prefs.get('agentRounds');
    const configured = this.opts.maxSteps !== undefined ? this.opts.maxSteps : (typeof prefRounds === 'number' ? prefRounds : MAX_STEPS);
    const unlimited = configured <= 0;
    const maxSteps = unlimited ? 200 : configured;
    for (let round = 0; round < maxSteps; round++) {
      const res = await this.stream(choice, msg, signal, round);
      if (!res) break;
      // History in the shape the provider expects: tool call ids with their outputs, and the chain
      // of thought of the round (DeepSeek needs it back in every later request with tools)
      this.chat.turns.push({ role: 'assistant', text: res.text, toolCalls: res.calls, ...(res.raw !== undefined && !res.replay ? { raw: res.raw } : {}), ...(res.reasoning ? { reasoning: res.reasoning } : {}), ...(res.replay ? { replay: res.replay } : {}) });
      if (res.stop === 'length') {
        msg.text += `\n\n_${tr('The answer reached the output limit (max_tokens). Tool calls that were cut off were not run. Write “continue” to go on.')}_`;
        this.hooks.update(msg, 'text');
      }
      if (!res.calls.length) break;
      const results = await this.runCalls(res.calls, msg, signal, round);
      this.chat.turns.push({ role: 'tool', results });
      if (signal.aborted || results.some((r) => r.content === ABORTED)) break;
      if (this.guard.stuck) {
        msg.text += `\n\n_${tr('Stopped: {tool} failed {n} times in a row with the same arguments. Fix the cause or change the request, then write “continue”.', { tool: this.guard.stuck, n: MAX_SAME_FAILURES })}_`;
        this.hooks.update(msg, 'text');
        break;
      }
      choice = 'auto';
      if (!unlimited && round === maxSteps - 1) {
        msg.text += `\n\n_${tr('Stopped after {n} rounds. Write “continue” to go on.', { n: maxSteps })}_`;
        this.hooks.update(msg, 'text');
      }
    }
    msg.done = true;
    this.hooks.update(msg, 'meta');
  }

  /**
   * One model round with token streaming. States: thinking (reasoning deltas fill the thought card) →
   * answering or calling tools (the card collapses) → done (usage, history).
   */
  private async stream(choice: ToolChoice, msg: ChatMessage, signal: AbortSignal, round = 0): Promise<{ text: string; calls: ToolCall[]; raw?: unknown; reasoning: string; stop: string; replay?: ReplayState } | null> {
    const calls: ToolCall[] = [];
    let replay: ReplayState | undefined;
    let text = '';
    let raw: unknown;
    let reasoning = '';
    let stop = 'stop';
    let thought: Thought | null = null;
    let thinkStart = 0;
    const prefix = msg.text ? msg.text + '\n\n' : '';
    const endThought = () => {
      if (!thought || thought.done) return;
      thought.done = true;
      thought.ms = Date.now() - thinkStart;
      this.hooks.update(msg, 'thought');
    };
    try {
      const effort = this.effort();
      const model = this.opts.model?.();
      const tools = this.toolSpecs(true);
      if (this.hiddenTokens || this.historySaved) {
        const e = (msg.economy ||= { tools: 0, history: 0 });
        e.tools += this.hiddenTokens;
        e.history += this.historySaved;
      }
      const body = { system: this.system(), context: ensurePrefix(this.chat).context, turns: this.chat.turns, tools, toolChoice: choice, provider: this.provider(), ...(model ? { model } : {}), ...(effort ? { effort } : {}), meta: { files: this.auditFiles.slice(0, 50), chat: this.chat.id, ...(this.opts.role ? { role: this.opts.role } : {}) } };
      for await (const ev of postSse<StreamEvent>('/api/ai/chat', body, signal)) {
        if (ev.type === 'start') {
          msg.provider = ev.provider;
          msg.model = ev.model;
          if (ev.providerId) msg.providerId = ev.providerId;
          if (ev.effort) msg.effort = ev.effort;
          this.chat.provider = ev.provider;
          this.hooks.update(msg, 'meta');
        } else if (ev.type === 'notice') {
          showModelNotice(ev);
        } else if (ev.type === 'budget') {
          msg.budget = ev.budget;
          this.hooks.update(msg, 'meta');
        } else if (ev.type === 'reasoning') {
          if (!thought) {
            thinkStart = Date.now();
            thought = { round, text: '', ms: 0, tokens: 0, exact: false, done: false };
            (msg.thoughts ||= []).push(thought);
          }
          reasoning += ev.delta;
          thought.text = reasoning;
          thought.ms = Date.now() - thinkStart;
          if (ev.tokens !== undefined) (thought.tokens = ev.tokens), (thought.exact = true);
          else if (!thought.exact) thought.tokens = estimateTokens(reasoning.length);
          this.hooks.update(msg, 'thought');
        } else if (ev.type === 'text') {
          endThought();
          text += ev.delta;
          msg.text = prefix + text;
          this.hooks.update(msg, 'text');
        } else if (ev.type === 'tool_start') {
          endThought();
          const t = orchestrator.tool(ev.name);
          msg.steps!.push({ id: ev.id, name: ev.name, title: t?.title || ev.name, app: t?.app || 'project', args: {}, status: 'pending', progress: [tr('Generating arguments')], attempts: 0, round });
          this.hooks.update(msg, 'step');
        } else if (ev.type === 'tool_call') {
          calls.push(ev.call);
        } else if (ev.type === 'usage') {
          if (thought && ev.usage.reasoning !== undefined) (thought.tokens = ev.usage.reasoning), (thought.exact = true);
          this.countUsage(msg, ev.usage);
          this.hooks.update(msg, 'meta');
        } else if (ev.type === 'done') {
          raw = ev.raw;
          stop = ev.stop;
          replay = ev.replay;
          endThought();
        } else if (ev.type === 'error') {
          endThought();
          msg.error = ev.error;
          this.hooks.update(msg, 'meta');
          return null;
        }
      }
    } catch (e) {
      endThought();
      const err = e as Error & { code?: string };
      if (signal.aborted) {
        msg.text = prefix + text + (text ? '\n\n' : '') + `_${tr('Stopped.')}_`;
        this.hooks.update(msg, 'text');
        if (text) this.chat.turns.push({ role: 'assistant', text, toolCalls: [] });
        return null;
      }
      msg.error = { code: (err.code as AiErrorInfo['code']) || 'UNREACHABLE', message: err.message };
      this.hooks.update(msg, 'meta');
      return null;
    }
    // Remove placeholder cards without a matching call (providers with different IDs)
    msg.steps = msg.steps!.filter((s) => s.status !== 'pending' || calls.some((c) => c.id === s.id));
    // A code block the model left open would swallow the rest of the chat: close it
    const fixed = closeOpenFences(text);
    if (fixed.closed) {
      text = fixed.text;
      msg.text = prefix + text;
      this.hooks.update(msg, 'text');
    }
    return { text, calls, raw, reasoning, stop, ...(replay ? { replay } : {}) };
  }

  private countUsage(msg: ChatMessage, u: TokenUsage) {
    const m = (msg.usage ||= { input: 0, output: 0, cached: 0, rounds: 0, estimated: false, firstMs: 0, totalMs: 0, context: 0 });
    m.input += u.input;
    m.output += u.output;
    m.cached += u.cached;
    if (u.cacheMiss !== undefined) m.cacheMiss = (m.cacheMiss || 0) + u.cacheMiss;
    if (u.reasoning !== undefined) m.reasoning = (m.reasoning || 0) + u.reasoning;
    if (u.cacheWrite) m.cacheWrite = (m.cacheWrite || 0) + u.cacheWrite;
    // The provider's prompt_tokens are the authority: keep the difference to the pre-flight count
    if (u.predicted !== undefined && !u.estimated) this.chat.calib = { model: u.model, offset: u.input - u.predicted };
    m.rounds++;
    m.estimated ||= u.estimated;
    if (m.rounds === 1) m.firstMs = u.firstMs;
    m.totalMs += u.totalMs;
    m.context = u.input;
    const c = (this.chat.usage ||= { input: 0, output: 0, cached: 0, requests: 0, context: 0 });
    c.input += u.input;
    c.output += u.output;
    c.cached += u.cached;
    if (u.cacheMiss !== undefined) c.cacheMiss = (c.cacheMiss || 0) + u.cacheMiss;
    if (u.reasoning !== undefined) c.reasoning = (c.reasoning || 0) + u.reasoning;
    c.requests++;
    c.context = u.input + u.output;
    c.model = u.model;
    this.opts.onUsage?.(u);
    bus.emit('ai:usage', u);
  }

  /** One self-correction per tool and answer: is it still free? Takes it when it is. */
  private takeCorrection(name: string): boolean {
    const used = this.corrections.get(name) || 0;
    if (used >= 1) return false;
    this.corrections.set(name, used + 1);
    return true;
  }

  /**
   * Runs the tool calls of one model round, with the scheduling pattern of DeepSeek Harness:
   * consecutive independent reads (no writes, no approval, no panel tools) run in parallel, for example
   * reading @budget.xlsx and @report.docx at once; a write, an approval or a panel tool is a barrier and
   * runs alone, so a chained call sees the result of the one before. Results stay in model order (every
   * provider gets all results of the round together, Claude and Gemini in one user turn).
   * Invalid arguments (JSON the repair pass could not fix, or a Zod violation) go back to the model once
   * as a structured error, without running anything; other errors pause for the user.
   */
  private async runCalls(calls: ToolCall[], msg: ChatMessage, signal: AbortSignal, round = 0): Promise<ToolResultItem[]> {
    const state = { aborted: false };
    const results: ToolResultItem[] = [];
    const parallel = (c: ToolCall) => {
      const t = orchestrator.tool(c.name);
      return !!t && !t.writes && !t.approval && t.source !== 'client' && !c.argsError;
    };
    for (let i = 0; i < calls.length; ) {
      let j = i + 1;
      if (parallel(calls[i]!)) while (j < calls.length && parallel(calls[j]!)) j++;
      const group = calls.slice(i, j);
      if (group.length > 1) for (const c of group) this.stepFor(c, msg, round).parallel = group.length - 1;
      results.push(...(await Promise.all(group.map((c) => this.runOne(c, msg, signal, round, state)))));
      i = j;
    }
    return results;
  }

  private stepFor(call: ToolCall, msg: ChatMessage, round: number): AgentStep {
    const t = orchestrator.tool(call.name);
    let step = msg.steps!.find((s) => s.id === call.id);
    if (!step) {
      step = { id: call.id, name: call.name, title: t?.title || call.name, app: t?.app || 'project', args: call.args, status: 'pending', progress: [], attempts: 0, round };
      msg.steps!.push(step);
    }
    return step;
  }

  /** Telemetry: one MCP tool call of this provider and model (success rate in Settings, Usage). */
  private toolStat(msg: ChatMessage, ok: boolean, ms: number) {
    if (!msg.providerId || !msg.model) return;
    void api.send('POST', '/api/usage/tool', { providerId: msg.providerId, provider: msg.provider || msg.providerId, model: msg.model, local: false, ok, ms }).catch(() => {});
  }

  /** find-tools: the model loads withheld tools by keyword. Nothing runs outside the chat; the tools appear in the next request. */
  private runFindTools(call: ToolCall, msg: ChatMessage, round: number): ToolResultItem {
    const step = this.stepFor(call, msg, round);
    step.title = tr('Find tools');
    step.args = call.args;
    step.started = Date.now();
    const query = String(call.args?.query ?? '');
    const found = findTools(query, this.hidden);
    const prefix = ensurePrefix(this.chat);
    prefix.sent = [...new Set([...(prefix.sent || []), ...found.map((f) => f.name)])].sort();
    const text = foundText(query, found);
    step.ended = Date.now();
    step.result = { ok: true, text, ms: step.ended - step.started, changed: [] };
    step.status = 'done';
    this.hooks.update(msg, 'step');
    return { id: call.id, name: call.name, content: text, isError: false };
  }

  private async runOne(call: ToolCall, msg: ChatMessage, signal: AbortSignal, round: number, state: { aborted: boolean }): Promise<ToolResultItem> {
    if (call.name === FIND_TOOLS) return this.runFindTools(call, msg, round);
    {
      const step = this.stepFor(call, msg, round);
      let aborted = state.aborted;
      step.round ??= round;
      step.args = call.args;
      step.argsError = call.argsError;
      if (call.repaired?.length) step.repaired = call.repaired;
      // A call that already failed MAX_SAME_FAILURES times with these arguments is not run again, and the user is not asked again
      if (this.guard.blocked(call.name, call.args)) {
        step.status = 'skipped';
        this.hooks.update(msg, 'step');
        return { id: call.id, name: call.name, content: `Not run: ${call.name} already failed ${MAX_SAME_FAILURES} times with the same arguments. Do not call it again; tell the user what went wrong.`, isError: true };
      }
      if (aborted || signal.aborted) {
        step.status = 'skipped';
        this.hooks.update(msg, 'step');
        return { id: call.id, name: call.name, content: ABORTED, isError: true };
      }
      // Self-correction for malformed JSON: nothing runs, the model gets the error back
      if (call.argsError && this.takeCorrection(call.name)) {
        step.status = 'error';
        step.corrected = true;
        step.attempts++;
        step.progress = [tr('Arguments were not valid JSON: {message}', { message: call.argsError.slice(0, 120) }), tr('Sent the error back to the model for one self-correction')];
        const text = orchestrator.correction(call.name, call.argsError, ['arguments: not valid JSON (check quotes, commas and brackets)']);
        step.result = { ok: false, text, stage: 'validation', issues: ['arguments: not valid JSON'], ms: 0, changed: [] };
        this.hooks.update(msg, 'step');
        this.toolStat(msg, false, 0);
        return { id: call.id, name: call.name, content: text, isError: true };
      }
      let args = call.args;
      let outcome: CallOutcome | null = null;
      let corrected = false;
      for (;;) {
        step.status = 'running';
        step.attempts++;
        step.started = Date.now();
        step.progress = call.argsError ? [tr('Arguments were not valid JSON: {message}', { message: call.argsError.slice(0, 120) })] : step.repaired?.length ? [tr('Arguments repaired: {list}', { list: step.repaired.join(', ') })] : step.parallel ? [tr('Running in parallel with {n} other reads', { n: step.parallel })] : [];
        step.result = undefined;
        this.hooks.update(msg, 'step');
        outcome = await orchestrator.call(call.name, args, {
          callId: call.id,
          chain: this.opts.chain || msg.id,
          signal,
          ...(this.opts.badge ? { agent: this.opts.badge } : {}),
          approve: (tool, a) => this.hooks.approve(tool, a),
          onProgress: (m) => {
            if (!m) return;
            step!.progress.push(m);
            this.hooks.update(msg, 'step');
          },
        });
        step.ended = Date.now();
        step.args = outcome.args;
        step.result = { ok: outcome.ok, text: outcome.text, stage: outcome.stage, issues: outcome.issues, ms: outcome.ms, changed: outcome.changed };
        step.status = outcome.ok ? 'done' : 'error';
        if (outcome.ok && outcome.changed.length) msg.changed = [...new Set([...(msg.changed || []), ...outcome.changed])];
        this.hooks.update(msg, 'step');
        if (!signal.aborted && outcome.stage !== 'approval') this.toolStat(msg, outcome.ok, outcome.ms);
        if (outcome.ok || signal.aborted) break;
        // Zod violation: one automatic self-correction turn before the user is asked
        if (outcome.stage === 'validation' && step.attempts === 1 && this.takeCorrection(call.name)) {
          corrected = true;
          step.corrected = true;
          step.progress.push(tr('Sent the error back to the model for one self-correction'));
          this.hooks.update(msg, 'step');
          break;
        }
        step.status = 'waiting';
        this.hooks.update(msg, 'step');
        const choice = await this.hooks.failure(step, msg);
        if (choice.action === 'retry') continue;
        if (choice.action === 'edit') {
          args = choice.args;
          continue;
        }
        step.status = 'error';
        if (choice.action === 'abort') {
          aborted = true;
          state.aborted = true;
          step.status = 'skipped';
        }
        this.hooks.update(msg, 'step');
        break;
      }
      const o = outcome!;
      if (!o.ok && !aborted && !signal.aborted) this.guard.failed(call.name, call.args);
      if (aborted) return { id: call.id, name: call.name, content: ABORTED, isError: true };
      if (corrected) return { id: call.id, name: call.name, content: orchestrator.correction(call.name, o.args, o.issues || [o.text]), isError: true };
      return { id: call.id, name: call.name, content: limit(o.ok ? o.text : `Error (${o.stage}): ${o.text}`), isError: !o.ok };
    }
  }
}

const ABORTED = 'Stopped by the user.';
const limit = (s: string) => (s.length > 24000 ? s.slice(0, 24000) + '\n… (shortened)' : s);

export type { Attachment };
