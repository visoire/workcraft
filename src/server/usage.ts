// API usage store of the backend: ~/workcraft/usage.json (totals per provider and model, rate table).
// Holds no message content, only numbers.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from './paths.js';
import { addToolStat, addUsage, emptyUsage, validUsage, type Rate, type ToolStat, type UsageStore } from '../chat/usage.js';
import type { TokenUsage } from '../chat/types.js';

const FILE = join(HOME, 'usage.json');
let store: UsageStore | null = null;

function load(): UsageStore {
  if (store) return store;
  try {
    const j = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8').replace(/^﻿/, '')) as unknown) : null;
    store = validUsage(j) ? j : emptyUsage();
  } catch {
    store = emptyUsage();
  }
  return store;
}

let timer: ReturnType<typeof setTimeout> | undefined;
function save(now = false) {
  const write = () => {
    timer = undefined;
    try {
      writeFileSync(FILE + '.tmp', JSON.stringify(load(), null, 2));
      renameSync(FILE + '.tmp', FILE);
    } catch {
      try {
        // Windows: target briefly locked (virus scanner, editor). Write directly instead of renaming.
        writeFileSync(FILE, JSON.stringify(load(), null, 2));
      } catch (e) {
        console.warn('usage.json', (e as Error).message);
      }
    }
  };
  clearTimeout(timer);
  if (now) write();
  else timer = setTimeout(write, 500);
}

export const usage = {
  get: () => load(),
  record(u: TokenUsage, role?: string) {
    addUsage(load(), u, role);
    save();
  },
  recordTool(t: ToolStat) {
    addToolStat(load(), t);
    save();
  },
  reset() {
    const rates = load().rates;
    store = { ...emptyUsage(), rates };
    save(true);
    return store;
  },
  setRates(rates: Record<string, Rate>) {
    load().rates = rates;
    save(true);
    return load();
  },
  flush: () => timer && save(true),
};
