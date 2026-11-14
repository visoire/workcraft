// Skills for the model (agentskills.io format, see src/server/skills.ts). The system prompt carries only a one-line
// index; the model reads a skill with the read-skill tool when it needs it. Loaded once from the backend and
// kept for the session, so the prompt stays the same between requests (prompt cache).

import { api, backend } from '../app/backend.js';

export interface SkillInfo {
  name: string;
  description: string;
  origin: 'user' | 'shared' | 'bundled';
}

let loaded: Promise<void> | null = null;
let list: SkillInfo[] = [];
let index = '';

export const skillsInfo = {
  get list() {
    return list;
  },
  /** One line per skill, or '' when none is installed or the backend is not running (browser mode). */
  get index() {
    return index;
  },
  /** Loads the index once. Never throws: an assistant without skills still works. */
  ensure(): Promise<void> {
    if (backend.browser) return Promise.resolve();
    return (loaded ||= api
      .get<{ skills: SkillInfo[]; index: string }>('/api/skills')
      .then((r) => {
        list = r.skills;
        index = r.index;
      })
      .catch(() => {
        loaded = null;
      }));
  },
};

/** The prompt rule and index for the skills; empty without skills. */
export function skillsPrompt(): string {
  if (!index) return '';
  return `Skills explain how to drive an app or a task (commands, file formats, pitfalls). Before you use an app you are not sure about, read its skill with read-skill. Other Craft apps that are installed appear as tools named ext-<app>-<tool>. Available skills:\n${index}`;
}
