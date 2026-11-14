// Gemini (generativelanguage v1beta, streamGenerateContent?alt=sse) with its native features:
// - thinkingConfig per model: thinkingLevel on Gemini 3 and newer, thinkingBudget on 2.5, includeThoughts
// - parts with thought: true stream as reasoning; the parts of a model turn go back verbatim in later
//   requests, so every thoughtSignature (required in function-calling loops) is preserved
// - function calls from other providers in the history get the documented placeholder signature
// - functionDeclarations with parameters in the OpenAPI subset Gemini accepts (src/mcp/schemas.ts);
//   when the endpoint still rejects a schema, the request is repeated once with parametersJsonSchema
// - implicit prefix caching: stable systemInstruction (core prompt, then project context) and sorted tools
// - native PDF and image parts (inlineData)

import { AiError } from '../types.js';
import type { ChatRequest, ChatTurn, ProviderConfig, ReplayState, ToolCall } from '../types.js';
import { geminiModel, geminiThinking } from '../models.js';
import { compileTools, nativeDocs, networkError, newId, post, sse, textWithoutNative, type ProviderEvent } from '../http.js';

export type GeminiPart = { inlineData?: { mimeType: string; data: string }; text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: Record<string, unknown> }; functionResponse?: unknown; thoughtSignature?: string };
type Content = { role: 'user' | 'model'; parts: GeminiPart[] };

/** Placeholder Google documents for function calls that a Gemini model did not produce itself. */
export const SKIP_SIGNATURE = 'skip_thought_signature_validator';

interface GeminiOptions {
  jsonSchema: boolean;
  placeholder: boolean;
}

function modelParts(t: Extract<ChatTurn, { role: 'assistant' }>, model: string, o: GeminiOptions): GeminiPart[] {
  if (t.replay?.provider === 'gemini' && t.replay.items.length) return t.replay.items as GeminiPart[];
  if (Array.isArray(t.raw) && t.raw.length) return t.raw as GeminiPart[];
  const sign = o.placeholder && geminiModel(model).levels;
  const parts: GeminiPart[] = [...(t.text ? [{ text: t.text }] : []), ...t.toolCalls.map((c, i) => ({ functionCall: { name: c.name, args: c.args }, ...(sign && i === 0 ? { thoughtSignature: SKIP_SIGNATURE } : {}) }))];
  return parts.length ? parts : [{ text: '…' }];
}

export function geminiContents(turns: ChatTurn[], model: string, o: GeminiOptions = { jsonSchema: false, placeholder: true }): Content[] {
  const out: Content[] = [];
  const push = (role: Content['role'], parts: GeminiPart[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  for (const t of turns) {
    if (t.role === 'user') {
      const docs = nativeDocs(t);
      push('user', [...docs.map((d) => ({ inlineData: { mimeType: d.mime, data: d.data! } })), ...(t.images || []).map((im) => ({ inlineData: { mimeType: im.mime, data: im.data } })), { text: docs.length ? textWithoutNative(t, docs) : t.content }]);
    } else if (t.role === 'assistant') push('model', modelParts(t, model, o));
    else push('user', t.results.map((r) => ({ functionResponse: { name: r.name, ...(r.id.startsWith('gem_') ? {} : { id: r.id }), response: r.isError ? { error: r.content } : { content: r.content } } })));
  }
  return out;
}

/** Streamed parts merged: consecutive text of the same kind becomes one part, signatures stay attached. */
function mergePart(parts: GeminiPart[], p: GeminiPart): void {
  const last = parts[parts.length - 1];
  const textOnly = (x: GeminiPart) => x.text !== undefined && !x.functionCall && !x.inlineData;
  if (last && textOnly(last) && textOnly(p) && !!last.thought === !!p.thought && !last.thoughtSignature) {
    last.text += p.text!;
    if (p.thoughtSignature) last.thoughtSignature = p.thoughtSignature;
    return;
  }
  parts.push({ ...p });
}

export function geminiRequest(cfg: ProviderConfig, req: ChatRequest, o: GeminiOptions): Record<string, unknown> {
  const p = req.params || {};
  const { list } = compileTools(req.tools, o.jsonSchema ? 'plain' : 'gemini');
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }, ...(req.context ? [{ text: req.context }] : [])] },
    contents: geminiContents(req.turns, cfg.model, o),
    generationConfig: { ...(p.maxTokens ? { maxOutputTokens: p.maxTokens } : {}), thinkingConfig: geminiThinking(cfg.model, p.effort) },
  };
  if (list.length) {
    body.tools = [{ functionDeclarations: list.map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? (o.jsonSchema ? { parametersJsonSchema: t.parameters } : { parameters: t.parameters }) : {}) })) }];
    const choice = req.toolChoice;
    body.toolConfig = { functionCallingConfig: choice === 'none' ? { mode: 'NONE' } : typeof choice === 'object' ? { mode: 'ANY', allowedFunctionNames: [choice.name] } : { mode: 'AUTO' } };
  }
  return body;
}

const base = (cfg: ProviderConfig) => cfg.baseUrl.replace(/\/+$/, '');

export async function* streamGemini(cfg: ProviderConfig, req: ChatRequest, signal?: AbortSignal): AsyncGenerator<ProviderEvent> {
  const o: GeminiOptions = { jsonSchema: false, placeholder: true };
  const url = `${base(cfg)}/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;
  let res: Response | null = null;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await post(cfg, url, { 'x-goog-api-key': cfg.apiKey || '' }, geminiRequest(cfg, req, o), signal);
    } catch (e) {
      const err = networkError(e, cfg);
      if (err.info.code !== 'BAD_REQUEST' || attempt >= 2) throw err;
      if (o.placeholder && /thought_?signature/i.test(err.info.message)) o.placeholder = false;
      else if (!o.jsonSchema && /schema|parameters|function_?declarations|properties/i.test(err.info.message)) o.jsonSchema = true;
      else throw err;
    }
  }
  const { normalize } = compileTools(req.tools, o.jsonSchema ? 'plain' : 'gemini');
  const parts: GeminiPart[] = [];
  const calls: ToolCall[] = [];
  let stop = 'STOP';
  let reasoning = '';
  for await (const data of sse(res, signal)) {
    const ev = JSON.parse(data) as { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]; error?: { message?: string; status?: string }; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number } };
    if (ev.error) throw new AiError({ code: ev.error.status === 'RESOURCE_EXHAUSTED' ? 'RATE_LIMIT' : 'PROVIDER', provider: cfg.name, message: ev.error.message || 'Error in the stream' });
    if (ev.usageMetadata) {
      const u = ev.usageMetadata;
      const cached = u.cachedContentTokenCount || 0;
      yield { type: 'raw_usage', input: u.promptTokenCount, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), cached, ...(u.promptTokenCount !== undefined ? { cacheMiss: Math.max(0, u.promptTokenCount - cached) } : {}), ...(u.thoughtsTokenCount !== undefined ? { reasoning: u.thoughtsTokenCount } : {}) };
    }
    const cand = ev.candidates?.[0];
    for (const p of cand?.content?.parts || []) {
      mergePart(parts, p);
      if (p.text && p.thought) {
        reasoning += p.text;
        yield { type: 'reasoning', delta: p.text };
      } else if (p.text) yield { type: 'text', delta: p.text };
      if (p.functionCall) {
        const call: ToolCall = { id: p.functionCall.id || newId('gem'), name: p.functionCall.name, args: normalize(p.functionCall.name, p.functionCall.args || {}) };
        yield { type: 'tool_start', id: call.id, name: call.name };
        calls.push(call);
      }
    }
    if (cand?.finishReason) stop = cand.finishReason;
  }
  for (const c of calls) yield { type: 'tool_call', call: c };
  const replay: ReplayState = { provider: 'gemini', model: cfg.model, items: parts };
  yield { type: 'done', stop: stop === 'MAX_TOKENS' ? 'length' : stop === 'STOP' ? (calls.length ? 'tool_calls' : 'stop') : stop.toLowerCase(), raw: parts, replay, ...(reasoning ? { reasoning } : {}) };
}

/** Exact prompt tokens from models.countTokens (with system instruction and tools). */
export async function countGemini(cfg: ProviderConfig, req: ChatRequest, signal?: AbortSignal): Promise<number> {
  const r = geminiRequest(cfg, req, { jsonSchema: false, placeholder: true });
  const res = await post(cfg, `${base(cfg)}/v1beta/models/${encodeURIComponent(cfg.model)}:countTokens`, { 'x-goog-api-key': cfg.apiKey || '' }, { generateContentRequest: { model: `models/${cfg.model}`, contents: r.contents, systemInstruction: r.systemInstruction, ...(r.tools ? { tools: r.tools } : {}) } }, signal, 0);
  const j = (await res.json()) as { totalTokens?: number };
  return j.totalTokens || 0;
}
