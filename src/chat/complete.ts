// Inline completions for the code editor and document drafts: DeepSeek FIM and prefix completion
// (beta endpoints) through the local backend, or a short chat request for other providers.
//
//   fim({ prompt: before, suffix: after })                        -> text for the gap
//   prefix({ prompt: '{"title":', instruction: '…', json: true })  -> continuation, JSON repaired

import { api } from '../app/backend.js';
import { prefs } from '../app/settings.js';
import type { TokenUsage } from './types.js';

export interface CompletionAnswer {
  text: string;
  via: 'deepseek-fim' | 'deepseek-prefix' | 'chat';
  usage: TokenUsage;
  /** Prefix mode with json: the parsed (and if needed repaired) value */
  json?: unknown;
  repaired?: boolean;
}

interface Body {
  prompt: string;
  suffix?: string;
  instruction?: string;
  maxTokens?: number;
  json?: boolean;
  stop?: string[];
}

const send = (mode: 'fim' | 'prefix', b: Body) => api.send<CompletionAnswer>('POST', '/api/ai/complete', { mode, ...b, provider: prefs.get('chatProvider') || undefined });

export const fim = (b: Omit<Body, 'instruction' | 'json'>) => send('fim', b);
export const prefix = (b: Body) => send('prefix', b);
