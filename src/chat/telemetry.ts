// API usage in the interface: client for /api/usage and the breakdown table (Settings, Usage and
// telemetry, and the usage card in the chat header).

import { api } from '../app/backend.js';
import { h } from '../app/util.js';
import { byProvider, cacheHitRatio, cacheSavings, compactTokens, missOf, money, percent, rowCost, tokensPerSecond, toolSuccess, usageTotals, type Rate, type UsageStore } from './usage.js';
import { t as tr, locale } from '../app/i18n.js';

export const telemetry = {
  get: () => api.get<UsageStore>('/api/usage'),
  reset: () => api.send<UsageStore>('DELETE', '/api/usage'),
  setRates: (rates: Record<string, Rate>) => api.send<UsageStore>('PUT', '/api/usage/rates', rates),
};

const num = (n: number) => Math.round(n).toLocaleString(locale());

/**
 * The providers side by side (DeepSeek, Claude, Gemini, ChatGPT, local): input, output, thinking, cache
 * hits and misses, hit ratio, money saved by the cache, time to the first token, speed and the share
 * of successful MCP tool calls.
 */
export function providerTable(store: UsageStore, opt: { compact?: boolean } = {}): HTMLElement {
  const rows = byProvider(store);
  if (!rows.length) return h('p.muted.usage-empty', tr('No requests yet. Usage appears here after the first answer.'));
  // Savings per provider: the sum over its models (each model has its own rates)
  const saved = new Map<string, number>();
  for (const r of Object.values(store.rows)) saved.set(r.providerId, (saved.get(r.providerId) || 0) + cacheSavings(r, store.rates));
  const ttft = (r: (typeof rows)[number]) => (r.requests ? `${Math.round(r.firstMs / r.requests)} ms` : '–');
  const tps = (r: (typeof rows)[number]) => (tokensPerSecond(r) ? tokensPerSecond(r).toFixed(1) : '–');
  const mcp = (r: (typeof rows)[number]) => {
    const s = toolSuccess(r);
    return s === null ? '–' : `${percent(s)} · ${r.toolOk || 0}/${r.toolCalls}`;
  };
  const head = opt.compact ? [tr('Provider'), tr('In'), tr('Out'), tr('Thinking'), tr('Cache hit'), tr('Savings'), 'TTFT', 'MCP'] : [tr('Provider'), tr('Requests'), tr('Input'), tr('Output'), tr('Thinking'), tr('Cache hits'), tr('Cache misses'), tr('Cache hit'), tr('Savings'), 'TTFT', tr('Tokens/s'), tr('MCP tools')];
  const cells = (r: (typeof rows)[number]) => {
    const hit = r.cached ? percent(cacheHitRatio(r)) : '–';
    const sv = r.local ? '$0.00' : money(saved.get(r.providerId) || 0);
    if (opt.compact) return [h('td', h('span.usage-model', r.provider), r.local ? h('span.usage-local', ' · ' + tr('local')) : null), h('td.num', compactTokens(r.input)), h('td.num', compactTokens(r.output)), h('td.num', r.reasoning ? compactTokens(r.reasoning) : '–'), h('td.num', hit), h('td.num', sv), h('td.num', ttft(r)), h('td.num', mcp(r))];
    return [
      h('td', h('span.usage-model', r.provider), r.local ? h('span.usage-local', ' · ' + tr('local')) : null),
      h('td.num', num(r.requests)),
      h('td.num', num(r.input)),
      h('td.num', num(r.output)),
      h('td.num', r.reasoning ? num(r.reasoning) : '–'),
      h('td.num', num(r.cached)),
      h('td.num', num(missOf(r))),
      h('td.num', hit),
      h('td.num', sv),
      h('td.num', ttft(r)),
      h('td.num', tps(r)),
      h('td.num', mcp(r)),
    ];
  };
  return h('div.usage-table.usage-compare.mono', h('table', h('thead', h('tr', head.map((x) => h('th', x)))), h('tbody', rows.map((r) => h('tr', { 'data-provider': r.providerId }, cells(r))))));
}

/** Table per provider and model: requests, input and output tokens, cost, speed. */
export function usageTable(store: UsageStore, opt: { compact?: boolean; limit?: number } = {}): HTMLElement {
  const rows = Object.values(store.rows).sort((a, b) => b.input + b.output - (a.input + a.output));
  const shown = opt.limit ? rows.slice(0, opt.limit) : rows;
  const tot = usageTotals(store);
  if (!rows.length) return h('p.muted.usage-empty', tr('No requests yet. Usage appears here after the first answer.'));
  const head = opt.compact ? [tr('Model'), tr('Req.'), tr('In'), tr('Cache'), tr('Out'), tr('Cost')] : [tr('Provider'), tr('Model'), tr('Requests'), tr('Input'), tr('Cache hit'), tr('Cache miss'), tr('Output'), tr('Thinking'), tr('Cost'), tr('Savings'), tr('Tokens/s'), tr('First token')];
  const hit = (r: { input: number; cached: number }) => (r.cached ? percent(cacheHitRatio(r)) : '–');
  const cells = (r: (typeof rows)[number]) => {
    const cost = money(rowCost(r, store.rates));
    const est = r.estimated ? h('span.usage-est', { title: tr('{n} of {m} requests without usage from the provider: counted from the characters', { n: r.estimated, m: r.requests }) }, '≈') : null;
    if (opt.compact) return [h('td', h('span.usage-model', r.model), est), h('td.num', num(r.requests)), h('td.num', compactTokens(r.input)), h('td.num', { title: tr('{n} cached tokens', { n: r.cached }) }, hit(r)), h('td.num', compactTokens(r.output)), h('td.num', r.local ? '$0.00' : cost)];
    return [
      h('td', r.provider, r.local ? h('span.usage-local', ' · ' + tr('local')) : null),
      h('td', h('span.usage-model', r.model), est),
      h('td.num', num(r.requests)),
      h('td.num', num(r.input)),
      h('td.num', { title: tr('{n} cached tokens', { n: r.cached }) }, hit(r)),
      h('td.num', r.cacheMiss !== undefined ? num(r.cacheMiss) : '–'),
      h('td.num', num(r.output)),
      h('td.num', r.reasoning ? num(r.reasoning) : '–'),
      h('td.num', r.local ? '$0.00' : cost),
      h('td.num', r.local ? '$0.00' : money(cacheSavings(r, store.rates))),
      h('td.num', tokensPerSecond(r) ? tokensPerSecond(r).toFixed(1) : '–'),
      h('td.num', r.requests ? `${Math.round(r.firstMs / r.requests)} ms` : '–'),
    ];
  };
  const foot = opt.compact
    ? [h('td', tr('Total')), h('td.num', num(tot.requests)), h('td.num', compactTokens(tot.input)), h('td.num', hit(tot)), h('td.num', compactTokens(tot.output)), h('td.num', money(tot.cost))]
    : [h('td', tr('Total')), h('td'), h('td.num', num(tot.requests)), h('td.num', num(tot.input)), h('td.num', hit(tot)), h('td.num', num(tot.cacheMiss)), h('td.num', num(tot.output)), h('td.num', num(tot.reasoning)), h('td.num', money(tot.cost)), h('td.num', money(tot.savings)), h('td'), h('td')];
  return h(
    'div.usage-table.mono',
    h('table', h('thead', h('tr', head.map((x) => h('th', x)))), h('tbody', shown.map((r) => h('tr', { 'data-key': r.key }, cells(r)))), h('tfoot', h('tr', foot)))
  );
}
