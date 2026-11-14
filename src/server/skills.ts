// Skills in the agentskills.io format (a folder with SKILL.md: YAML front matter with `name` and
// `description`, then Markdown, plus optional references/). The 13 artcraft-skills use exactly this.
// Ported from workcraft-ai (crates/agents/src/skills.rs).
//
// Skills are not pasted into the prompt. The prompt carries a one-line index (name: description) and the
// model reads a skill with the read-skill tool when it needs it. Folders are scanned in this order, the
// first name wins: ~/workcraft/skills (yours), ~/.agents/skills and ~/.claude/skills (installed for other
// agents, shared), and the skills that ship with WorkCraft (skills/ in the application folder).

import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME } from './paths.js';

const MAX_SKILL_BYTES = 48 * 1024;
const here = dirname(fileURLToPath(import.meta.url));

export interface Skill {
  name: string;
  description: string;
  dir: string;
  /** Where it was found: yours, shared with other agents, or shipped with WorkCraft */
  origin: 'user' | 'shared' | 'bundled';
}

/** Parses the front matter of a SKILL.md: name, description (also folded `>` and literal `|` values) and the body. */
export function parseFrontMatter(text: string): { name?: string; description?: string; body: string } {
  // One kind of line ending: a checkout on Windows turns LF into CRLF, and a CR left at the end of the last front matter line (before "\n---")
  // made `description: ...` fail to match, so such a skill loaded without a description
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!src.startsWith('---')) return { body: src };
  const rest = src.slice(3).replace(/^[\r\n]+/, '');
  const end = rest.indexOf('\n---');
  if (end < 0) return { body: src };
  const fm = rest.slice(0, end).split(/\r?\n/);
  const body = rest.slice(end + 4).replace(/^[\r\n]+/, '');
  const out: { name?: string; description?: string; body: string } = { body };
  for (let i = 0; i < fm.length; ) {
    const line = fm[i++]!;
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (!m || /^\s/.test(line)) continue;
    const key = m[1]!;
    let value = m[2]!.trim();
    if (/^[>|][-+]?$/.test(value)) {
      const parts: string[] = [];
      while (i < fm.length && (/^\s/.test(fm[i]!) || !fm[i]!.trim())) parts.push(fm[i++]!.trim());
      value = parts.filter(Boolean).join(' ');
    } else value = value.replace(/^["']|["']$/g, '');
    if (key === 'name') out.name = value;
    else if (key === 'description') out.description = value;
  }
  return out;
}

/** The folders to scan, in order. */
export function skillRoots(): { dir: string; origin: Skill['origin'] }[] {
  const bundled = [resolve(here, '..', '..', 'skills'), resolve(here, '..', 'skills')].find((d) => existsSync(d)) || resolve(here, '..', '..', 'skills');
  return [
    { dir: join(HOME, 'skills'), origin: 'user' },
    { dir: join(homedir(), '.agents', 'skills'), origin: 'shared' },
    { dir: join(homedir(), '.claude', 'skills'), origin: 'shared' },
    { dir: bundled, origin: 'bundled' },
  ];
}

export function scanSkills(roots = skillRoots()): Skill[] {
  const skills: Skill[] = [];
  for (const { dir, origin } of roots) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const e of entries) {
      const folder = join(dir, e);
      const file = join(folder, 'SKILL.md');
      try {
        if (!statSync(folder).isDirectory() || !existsSync(file)) continue;
        const fm = parseFrontMatter(readFileSync(file, 'utf8'));
        const name = fm.name || e;
        if (skills.some((s) => s.name === name)) continue;
        skills.push({ name, description: fm.description || '', dir: folder, origin });
      } catch {
        /* an unreadable folder is skipped */
      }
    }
  }
  return skills;
}

/** The index for the system prompt: one line per skill. */
export function skillIndex(skills: Skill[], only: string[] = []): string {
  return skills
    .filter((s) => !only.length || only.includes(s.name))
    .map((s) => `- ${s.name}: ${s.description.slice(0, 160)}`)
    .join('\n');
}

/** Joins a relative path under `base` without letting it climb out. */
function safeJoin(base: string, rel: string): string {
  const p = normalize(rel);
  if (isAbsolute(rel) || p === '..' || p.startsWith('..' + sep) || /^[A-Za-z]:/.test(rel)) throw new Error(`'${rel}' is outside the skill folder`);
  return join(base, p);
}

const clip = (s: string) => (Buffer.byteLength(s) > MAX_SKILL_BYTES ? Buffer.from(s).subarray(0, MAX_SKILL_BYTES).toString('utf8') + '\n[shortened]' : s);

/** Body of SKILL.md, or of a file under the skill folder (references/commands.md). Names match without case. */
export function readSkill(skills: Skill[], name: string, file?: string): string {
  const want = name.trim().toLowerCase();
  const s = skills.find((k) => k.name.toLowerCase() === want || k.name.toLowerCase() === want.replace(/\s+/g, ''));
  if (!s) throw new Error(skills.length ? `Unknown skill '${name}'. Available: ${skills.map((k) => k.name).join(', ')}` : `Unknown skill '${name}': no skills are installed.`);
  if (file) return clip(readFileSync(safeJoin(s.dir, file), 'utf8'));
  let out = clip(parseFrontMatter(readFileSync(join(s.dir, 'SKILL.md'), 'utf8')).body);
  try {
    const refs = readdirSync(join(s.dir, 'references')).sort().map((f) => `references/${f}`);
    if (refs.length) out += `\n\n[More files, read with read-skill file=...: ${refs.join(', ')}]`;
  } catch {
    /* no references folder */
  }
  return out;
}

/**
 * Copies the skills that ship with WorkCraft into a folder other agents read (~/.agents/skills by default:
 * Codex, ZCode, Antigravity and others; ~/.claude/skills for Claude Code). A skill folder that exists is left
 * alone, so edits survive. Returns the names that were installed.
 */
export function installBundledSkills(target = join(homedir(), '.agents', 'skills')): string[] {
  const bundled = skillRoots().find((r) => r.origin === 'bundled')!.dir;
  const done: string[] = [];
  for (const s of scanSkills([{ dir: bundled, origin: 'bundled' }])) {
    const dest = join(target, s.dir.split(/[\\/]/).pop()!);
    if (existsSync(dest)) continue;
    cpSync(s.dir, dest, { recursive: true });
    done.push(s.name);
  }
  cache = null;
  return done;
}

let cache: { at: number; skills: Skill[] } | null = null;
/** Scan result, kept for 10 seconds so a chat start does not walk the disk several times. */
export function skills(fresh = false): Skill[] {
  if (!fresh && cache && Date.now() - cache.at < 10_000) return cache.skills;
  cache = { at: Date.now(), skills: scanSkills() };
  return cache.skills;
}
