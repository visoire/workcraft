// Shared types for chat, AI router and MCP. Used by frontend and backend.

export type AppId = 'wordcraft' | 'gridcraft' | 'deckcraft' | 'pdfcraft';
export type ToolApp = AppId | 'code' | 'terminal' | 'project' | 'workspace';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Raw text of the arguments when the model did not deliver valid JSON */
  argsError?: string;
  /** The arguments were malformed and the repair pass fixed them (what it changed) */
  repaired?: string[];
}

export interface ToolResultItem {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

/** Image sent with a user message (base64 without the data: prefix). */
export interface TurnImage {
  mime: string;
  data: string;
}

/**
 * Project file attached natively (PDF or image) for providers that read documents themselves
 * (Claude, Gemini, ChatGPT). Only the reference is stored in the chat; the backend loads the bytes for
 * each request. Providers without native documents use the extracted text in the <context> block.
 */
export interface TurnDoc {
  path: string;
  mime: string;
  size: number;
  /** base64, filled in by the backend right before the request, never stored */
  data?: string;
}

/**
 * Provider state of an assistant turn that has to go back verbatim in later requests of a tool chain:
 *   anthropic  content blocks (thinking with signature, redacted_thinking, text, tool_use)
 *   gemini     parts (thought parts, functionCall parts with thoughtSignature)
 *   openai     Responses API output items (reasoning items with id and encrypted_content, messages, calls)
 * Replayed only to the provider (and for Claude the model) that produced it.
 */
export interface ReplayState {
  provider: 'anthropic' | 'gemini' | 'openai';
  model: string;
  items: unknown[];
}

export type ChatTurn =
  | { role: 'user'; content: string; images?: TurnImage[]; docs?: TurnDoc[] }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: unknown; reasoning?: string; replay?: ReplayState }
  | { role: 'tool'; results: ToolResultItem[] };

/** Thinking effort across providers. off: as little thinking as the model allows. */
export type Effort = 'off' | 'low' | 'medium' | 'high' | 'max';
export const EFFORTS: Effort[] = ['off', 'low', 'medium', 'high', 'max'];

/** Sampling and thinking parameters of one request (resolved per provider in the backend). */
export interface ModelParams {
  /** Thinking mode on or off. undefined: provider default */
  thinking?: boolean;
  effort?: Effort;
  maxTokens?: number;
  /** Only without thinking; reasoning models ignore or reject it */
  temperature?: number;
  /** Strict tool schemas (OpenAI, Claude). false after the provider rejected a strict schema */
  strictTools?: boolean;
  /** Stable key for provider-side prompt caching (OpenAI prompt_cache_key): the chat id */
  cacheKey?: string;
}

/** What the pre-flight check did to make a request fit into the context window. */
export interface BudgetReport {
  /** Context window of the model and the tokens kept free for the answer */
  window: number;
  reserve: number;
  /** Prompt tokens before and after fitting */
  before: number;
  after: number;
  /** true: counted with the model's own tokenizer (DeepSeek V4, OpenAI o200k/cl100k), false: estimated */
  exact: boolean;
  /** Steps taken, oldest first (empty when the request fit) */
  actions: string[];
  /** max_tokens lowered so input and answer fit together */
  maxTokens?: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ToolChoice = 'auto' | 'none' | { name: string };

export type AiErrorCode =
  | 'AUTH'
  | 'NOT_FOUND'
  | 'RATE_LIMIT'
  | 'UNREACHABLE'
  | 'BAD_REQUEST'
  | 'PROVIDER'
  | 'ABORTED'
  | 'NO_PROVIDER'
  | 'LOCAL_ONLY'
  | 'TIMEOUT';

export interface AiErrorInfo {
  code: AiErrorCode;
  message: string;
  provider?: string;
  status?: number;
}

export type StreamEvent =
  | { type: 'start'; provider: string; model: string; providerId?: string; effort?: Effort }
  | { type: 'text'; delta: string }
  /**
   * Chain of thought or its summary, the same event for every provider (DeepSeek reasoning_content,
   * Claude thinking_delta, Gemini thought parts, OpenAI reasoning summaries).
   * tokens: exact running count when the backend can count.
   */
  | { type: 'reasoning'; delta: string; tokens?: number }
  | { type: 'tool_start'; id: string; name: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'budget'; budget: BudgetReport }
  /**
   * Something the router did on its own that the user should know: the model name did not exist at the provider and the
   * request ran with `to` instead (see src/chat/model-recovery.ts). fix: make that choice permanent.
   */
  | { type: 'notice'; level: 'info' | 'warning'; code: 'MODEL_SUBSTITUTED'; message: string; fix?: { providerId: string; from: string; to: string } }
  | { type: 'done'; stop: string; raw?: unknown; reasoning?: string; replay?: ReplayState }
  | { type: 'error'; error: AiErrorInfo };

/** Token usage of one model request. estimated: the provider sent no usage, counted from characters. */
export interface TokenUsage {
  /** All prompt tokens, cached or not */
  input: number;
  output: number;
  /**
   * Prompt tokens served from the provider cache: DeepSeek prompt_cache_hit_tokens, OpenAI cached_tokens,
   * Claude cache_read_input_tokens, Gemini cachedContentTokenCount
   */
  cached: number;
  /** Prompt tokens billed at the full rate (DeepSeek prompt_cache_miss_tokens, otherwise input - cached) */
  cacheMiss?: number;
  /** Prompt tokens written to the cache (Claude cache_creation_input_tokens) */
  cacheWrite?: number;
  /** Output tokens spent on thinking (reasoning_tokens, thoughtsTokenCount) */
  reasoning?: number;
  /** Prompt tokens the pre-flight check counted for this request (calibration against input) */
  predicted?: number;
  estimated: boolean;
  /** Time to the first token and total time in milliseconds */
  firstMs: number;
  totalMs: number;
  provider: string;
  providerId: string;
  model: string;
  local: boolean;
}

export type ProviderKind = 'anthropic' | 'openai' | 'gemini';

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** local model (Ollama): runs without internet */
  local?: boolean;
  /**
   * Ollama only, filled by the backend before a request: the context the request runs with and what the model
   * can do (from /api/show). Missing in browser mode, where Ollama's own defaults apply.
   */
  ollama?: { numCtx?: number; thinking?: boolean; tools?: boolean; vision?: boolean; keepAlive?: string };
}

export interface ChatRequest {
  /** Core system prompt: static, first in every request (prefix cache) */
  system: string;
  /** Persistent project context, right after the system prompt and the tool schemas */
  context?: string;
  turns: ChatTurn[];
  tools: ToolSpec[];
  toolChoice: ToolChoice;
  params?: ModelParams;
}

export class AiError extends Error {
  readonly info: AiErrorInfo;
  constructor(info: AiErrorInfo) {
    super(info.message);
    this.name = 'AiError';
    this.info = info;
  }
}
