// ChatGPT (OpenAI Responses API, /v1/responses) with its native features:
// - reasoning models: reasoning.effort and summary "auto"; reasoning summaries stream as reasoning events
// - stateless tool chains (store: false): reasoning items come back with their id and encrypted_content
//   (include: reasoning.encrypted_content) and go back verbatim, in order, before the function calls
// - strict function tools (additionalProperties false, optional fields nullable), parallel_tool_calls
// - automatic prefix caching: stable instructions and sorted tools, prompt_cache_key = the chat id
// - native PDF (input_file) and image (input_image) parts
// Own OpenAI-compatible endpoints keep Chat Completions (src/chat/providers.ts); so does this adapter
// when the endpoint has no /responses (404).

import { AiError } from '../types.js';
import type { ChatRequest, ChatTurn, Effort, ProviderConfig, ReplayState, ToolCall } from '../types.js';
import { openaiModel } from '../models.js';
import { compileTools, nativeDocs, networkError, parseArgs, post, sse, systemText, textWithoutNative, type ProviderEvent } from '../http.js';

type Item = Record<string, unknown> & { type?: string };

interface OpenAIOptions {
  strict: boolean;
  reasoningItems: boolean;
  cacheKey: boolean;
}

const noStrict = new Set<string>();

/** reasoning field for a model and effort (undefined for models without reasoning). */
export function openaiReasoning(model: string, effort: Effort | undefined): Record<string, unknown> | undefined {
  const m = openaiModel(model);
  if (!m.reasoning) return undefined;
  const wire = effort === 'off' ? (m.minimal ? 'minimal' : 'low') : effort === 'max' ? 'high' : effort;
  return { ...(wire ? { effort: wire } : {}), summary: 'auto' };
}

function inputItems(turns: ChatTurn[], o: OpenAIOptions): Item[] {
  const out: Item[] = [];
  for (const t of turns) {
    if (t.role === 'user') {
      const docs = nativeDocs(t);
      out.push({
        role: 'user',
        content: [
          ...docs.map((d) => (d.mime === 'application/pdf' ? { type: 'input_file', filename: d.path.split('/').pop() || 'document.pdf', file_data: `data:application/pdf;base64,${d.data}` } : { type: 'input_image', image_url: `data:${d.mime};base64,${d.data}` })),
          ...(t.images || []).map((im) => ({ type: 'input_image', image_url: `data:${im.mime};base64,${im.data}` })),
          { type: 'input_text', text: docs.length ? textWithoutNative(t, docs) : t.content },
        ],
      });
    } else if (t.role === 'assistant') {
      if (t.replay?.provider === 'openai' && t.replay.items.length) {
        for (const it of t.replay.items as Item[]) {
          if (it.type === 'reasoning') {
            if (o.reasoningItems) out.push({ type: 'reasoning', id: it.id, summary: it.summary || [], ...(it.encrypted_content ? { encrypted_content: it.encrypted_content } : {}) });
          } else if (it.type === 'message') {
            const text = ((it.content as { type: string; text?: string }[]) || []).map((c) => c.text || '').join('');
            if (text) out.push({ role: 'assistant', content: text });
          } else if (it.type === 'function_call') out.push({ type: 'function_call', call_id: it.call_id, name: it.name, arguments: it.arguments });
        }
        continue;
      }
      if (t.text) out.push({ role: 'assistant', content: t.text });
      for (const c of t.toolCalls) out.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.args) });
    } else for (const r of t.results) out.push({ type: 'function_call_output', call_id: r.id, output: r.content });
  }
  return out;
}

export function openaiRequest(cfg: ProviderConfig, req: ChatRequest, o: OpenAIOptions): Record<string, unknown> {
  const p = req.params || {};
  const reasoning = openaiReasoning(cfg.model, p.effort);
  const { list } = compileTools(req.tools, 'openai-strict', o.strict && p.strictTools !== false && !noStrict.has(cfg.id));
  const body: Record<string, unknown> = { model: cfg.model, instructions: systemText(req), input: inputItems(req.turns, o), stream: true, store: false };
  if (reasoning) {
    body.reasoning = reasoning;
    body.include = ['reasoning.encrypted_content'];
  }
  if (p.maxTokens) body.max_output_tokens = p.maxTokens;
  if (o.cacheKey && p.cacheKey) body.prompt_cache_key = p.cacheKey;
  if (list.length) {
    body.tools = list.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: t.strict }));
    const choice = req.toolChoice;
    body.tool_choice = choice === 'none' ? 'none' : typeof choice === 'object' ? { type: 'function', name: choice.name } : 'auto';
    body.parallel_tool_calls = true;
  }
  return body;
}

type Usage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };

/** Streams one Responses API request; null when the endpoint has no Responses API (fall back). */
export async function* streamOpenAIResponses(cfg: ProviderConfig, req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ProviderEvent, boolean> {
  const o: OpenAIOptions = { strict: true, reasoningItems: true, cacheKey: true };
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/responses`;
  const headers: Record<string, string> = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};
  let res: Response | null = null;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await post(cfg, url, headers, openaiRequest(cfg, req, o), signal);
    } catch (e) {
      const err = networkError(e, cfg);
      if (err.info.code === 'NOT_FOUND' && attempt === 0 && !/model/i.test(err.info.message)) return false;
      if (err.info.code !== 'BAD_REQUEST' || attempt >= 3) throw err;
      const msg = err.info.message;
      if (o.cacheKey && /prompt_cache_key/i.test(msg)) o.cacheKey = false;
      else if (o.reasoningItems && /encrypted_content|reasoning item|rs_/i.test(msg)) o.reasoningItems = false;
      else if (o.strict && /strict|schema|additionalProperties|required/i.test(msg)) {
        o.strict = false;
        noStrict.add(cfg.id);
      } else throw err;
    }
  }
  const { normalize } = compileTools(req.tools, o.strict && !noStrict.has(cfg.id) ? 'openai-strict' : 'plain');
  const items: Item[] = [];
  const calls: ToolCall[] = [];
  let stop = 'stop';
  let reasoning = '';
  let summaryKey = '';
  for await (const data of sse(res, signal)) {
    if (data === '[DONE]') break;
    const ev = JSON.parse(data) as { type: string; delta?: string; item?: Item; item_id?: string; summary_index?: number; response?: { usage?: Usage; status?: string; error?: { message?: string }; incomplete_details?: { reason?: string } }; message?: string };
    if (ev.type === 'response.output_text.delta' && ev.delta) yield { type: 'text', delta: ev.delta };
    else if ((ev.type === 'response.reasoning_summary_text.delta' || ev.type === 'response.reasoning_text.delta') && ev.delta) {
      const key = `${ev.item_id}:${ev.summary_index ?? 0}`;
      const delta = summaryKey && key !== summaryKey ? `\n\n${ev.delta}` : ev.delta;
      summaryKey = key;
      reasoning += delta;
      yield { type: 'reasoning', delta };
    } else if (ev.type === 'response.output_item.added' && ev.item?.type === 'function_call') yield { type: 'tool_start', id: String(ev.item.call_id), name: String(ev.item.name) };
    else if (ev.type === 'response.output_item.done' && ev.item) {
      const { status: _status, ...item } = ev.item;
      items.push(item);
      if (item.type === 'function_call') {
        const parsed = parseArgs(String(item.arguments || ''));
        calls.push({ id: String(item.call_id), name: String(item.name), ...parsed, args: normalize(String(item.name), parsed.args) });
      }
    } else if (ev.type === 'response.completed' || ev.type === 'response.incomplete') {
      const u = ev.response?.usage;
      if (u) {
        const cached = u.input_tokens_details?.cached_tokens || 0;
        yield { type: 'raw_usage', input: u.input_tokens, output: u.output_tokens, cached, ...(u.input_tokens !== undefined ? { cacheMiss: Math.max(0, u.input_tokens - cached) } : {}), ...(u.output_tokens_details?.reasoning_tokens !== undefined ? { reasoning: u.output_tokens_details.reasoning_tokens } : {}) };
      }
      if (ev.type === 'response.incomplete') stop = ev.response?.incomplete_details?.reason === 'content_filter' ? 'content_filter' : 'length';
    } else if (ev.type === 'response.failed' || ev.type === 'error') {
      throw new AiError({ code: 'PROVIDER', provider: cfg.name, message: ev.response?.error?.message || ev.message || 'Error in the stream' });
    }
  }
  const truncated = stop === 'length';
  if (!truncated) for (const c of calls) yield { type: 'tool_call', call: c };
  const replay: ReplayState = { provider: 'openai', model: cfg.model, items: truncated ? items.filter((i) => i.type !== 'function_call') : items };
  yield { type: 'done', stop: truncated ? 'length' : calls.length ? 'tool_calls' : stop, replay, ...(reasoning ? { reasoning } : {}) };
  return true;
}
