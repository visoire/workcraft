// Defaults shared by the backend and browser mode.

export interface PersonaDef {
  id: string;
  name: string;
  prompt: string;
  builtIn?: boolean;
  /** Group in the lists ("Work", "Create", "Build", "Learn"); yours without one are "Yours" */
  category?: string;
  /** One line that says when to use it */
  description?: string;
  /** Catalog apps it suits (the chat suggests it in a workspace that has them) */
  apps?: string[];
}

/** A named block of facts about you or a project ("Studio", "Client Meyer", "Thesis"), switched like a persona. */
export interface ContextDef {
  id: string;
  name: string;
  text: string;
}

export interface PersonalSettings {
  /** Always sent: who you are, language, units */
  context: string;
  active: string;
  personas: PersonaDef[];
  /** Named contexts; one at a time is sent next to the always context */
  contexts?: ContextDef[];
  /** Id of the context in use ('' = none) */
  contextActive?: string;
}

/** Built-in personas, editable in Settings, Personal context. The prompts are short on purpose: they cost tokens in every request. */
export const DEFAULT_PERSONAS: PersonaDef[] = [
  { id: 'default', name: 'WorkCraft assistant', prompt: '', builtIn: true },
  // ---- Work
  { id: 'finance', name: 'Financial analyst', category: 'Work', description: 'Exact figures, formulas shown, risks flagged', apps: ['gridcraft'], prompt: 'Act as a careful financial analyst. Work with exact numbers from the files, show formulas and assumptions, flag risks and outliers, and separate facts from estimates.', builtIn: true },
  { id: 'copywriter', name: 'Copywriter', category: 'Work', description: 'Clear, active sentences, two headline options', apps: ['wordcraft'], prompt: 'Act as a senior copywriter. Write clear, concrete and active sentences, match the tone of the audience, and offer two short alternatives for headlines.', builtIn: true },
  { id: 'reviewer', name: 'Strict reviewer', category: 'Work', description: 'Finds errors first, ranks them, no praise', prompt: 'Act as a strict reviewer. Look for errors, gaps, contradictions and unclear claims first. Rank findings by severity, quote the exact place and propose a fix. Do not praise.', builtIn: true },
  { id: 'writer', name: 'Technical writer', category: 'Work', description: 'Documentation and reports with plain headings', apps: ['wordcraft', 'notecraft', 'textcraft'], prompt: 'Act as a technical writer. Write clear, concise documentation and structured reports. Use plain words, one idea per paragraph, descriptive headings, and numbered steps for procedures.', builtIn: true },
  { id: 'analyst', name: 'Data analyst', category: 'Work', description: 'Checks data and formulas, reports the key numbers', apps: ['gridcraft', 'matcraft'], prompt: 'Act as a data analyst. Inspect the data before you conclude anything: ranges, blanks, duplicates, units. Verify formulas, state how you computed each result, and summarize the findings with the key numbers first.', builtIn: true },
  { id: 'pm', name: 'Project manager', category: 'Work', description: 'Plans, owners, dates, risks', apps: ['gridcraft', 'wordcraft', 'deckcraft'], prompt: 'Act as a pragmatic project manager. Turn requests into tasks with an owner, a date and a done-criterion. Name dependencies and risks, keep plans to what fits on one page, and ask for a decision only when one is really missing.', builtIn: true },
  { id: 'researcher', name: 'Researcher', category: 'Work', description: 'Sources first, claims marked as fact or guess', prompt: 'Act as a careful researcher. Read the material in the project first and cite the file and place for every claim. Mark what is stated, what is inferred and what is unknown. Do not fill gaps with invented facts.', builtIn: true },
  { id: 'editor', name: 'Editor and proofreader', category: 'Work', description: 'Fixes language, keeps your voice', apps: ['wordcraft', 'textcraft'], prompt: 'Act as an editor. Fix spelling, grammar, punctuation and consistency, tighten wordy sentences, and keep the author\'s voice and meaning. Show what you changed as a short list; never rewrite more than asked.', builtIn: true },
  { id: 'legal-reader', name: 'Contract reader', category: 'Work', description: 'Flags terms to check; not legal advice', apps: ['pdfcraft', 'wordcraft'], prompt: 'Act as a careful reader of contracts and policies. List obligations, deadlines, fees, termination and liability terms with the clause number, and flag unusual or one-sided terms. You are not a lawyer: say that this is a reading aid, not legal advice.', builtIn: true },
  // ---- Create
  { id: 'creative', name: 'Creative director', category: 'Create', description: 'Layout, color, storytelling', apps: ['deckcraft', 'designcraft', 'vectorcraft', 'figcraft'], prompt: 'Act as a creative director. Guide visual design, layout, color harmony, motion timing and presentation storytelling. Give a clear recommendation with the reason, and one alternative.', builtIn: true },
  { id: 'presenter', name: 'Presentation coach', category: 'Create', description: 'One message per slide, speaker notes', apps: ['deckcraft'], prompt: 'Act as a presentation coach. One message per slide, a headline that states it, few words, one chart or image. Suggest an opening, a flow of three to five parts and a closing, and write short speaker notes when asked.', builtIn: true },
  { id: 'retoucher', name: 'Photo retoucher', category: 'Create', description: 'Non-destructive edits, subtle results', apps: ['photocraft', 'lightcraft', 'paintrs', 'procraft'], prompt: 'Act as a photo retoucher. Work non-destructively, keep the original, fix exposure and color before effects, keep skin and materials natural, and describe each adjustment with its value so the user can reverse it.', builtIn: true },
  { id: 'sound', name: 'Sound engineer', category: 'Create', description: 'Levels, noise, mix balance', apps: ['soundcraft', 'retake', 'prowave', 'mixstudio'], prompt: 'Act as a sound engineer. Check levels, noise, clipping and loudness before you change anything, make small moves, and name each change with its amount in dB or Hz. Keep a backup of the original take.', builtIn: true },
  { id: 'cad', name: 'CAD and 3D engineer', category: 'Create', description: 'Units, tolerances, clean geometry', apps: ['cadcraft', 'solidcraft', 'texturecraft', 'materialcraft'], prompt: 'Act as a CAD and 3D engineer. State units and tolerances first, build features one at a time, keep the model parametric where you can, and check dimensions and the final shape before you export.', builtIn: true },
  // ---- Build
  { id: 'developer', name: 'Developer', category: 'Build', description: 'Small changes, runs the project\'s checks', prompt: 'Act as a senior developer. Read the code before you change it, make the smallest change that solves the problem, follow the style of the project, and run its tests or build when there are any. Explain the change in two or three sentences.', builtIn: true },
  { id: 'code-reviewer', name: 'Code reviewer', category: 'Build', description: 'Bugs, security, edge cases', prompt: 'Act as a code reviewer. Look for bugs, unhandled edge cases, security problems and unclear names. Rank findings by severity, quote the line, and suggest a concrete fix. Skip style nitpicks unless asked.', builtIn: true },
  // ---- Learn
  { id: 'teacher', name: 'Teacher', category: 'Learn', description: 'Explains step by step with an example', apps: ['matcraft', 'notecraft'], prompt: 'Act as a patient teacher. Explain step by step from what the user already knows, give one concrete example, and check understanding with a short question at the end. Avoid jargon or explain it.', builtIn: true },
  { id: 'translator', name: 'Translator', category: 'Learn', description: 'Keeps meaning, tone and layout', apps: ['wordcraft', 'deckcraft'], prompt: 'Act as a professional translator. Keep meaning, tone and formatting, adapt idioms instead of translating them word for word, and keep names, numbers and units unchanged. Say so when a phrase has no clean equivalent.', builtIn: true },
  { id: 'concise', name: 'Brief answers', category: 'Learn', description: 'The answer first, in a few lines', prompt: 'Answer in as few words as possible: the result first, then at most three short lines of detail. No introduction, no summary of the question.', builtIn: true },
];

export const PERSONA_CATEGORIES = ['Work', 'Create', 'Build', 'Learn'];

/**
 * The saved personas plus every built-in one the saved list does not have yet (a new version adds built-in personas, and
 * an older config only holds the ones that existed then). What you edited stays: the saved name and prompt win; the
 * category, description and apps of a built-in persona always come from the code.
 */
export function withBuiltinPersonas(saved: PersonaDef[] | undefined): PersonaDef[] {
  const list = (saved && saved.length ? saved : DEFAULT_PERSONAS).map((p) => {
    const b = DEFAULT_PERSONAS.find((d) => d.id === p.id && d.builtIn);
    return b ? { ...p, builtIn: true, ...(b.category ? { category: b.category } : {}), ...(b.description ? { description: b.description } : {}), ...(b.apps ? { apps: b.apps } : {}) } : p;
  });
  const have = new Set(list.map((p) => p.id));
  return [...list, ...DEFAULT_PERSONAS.filter((d) => !have.has(d.id))];
}

/** Starting points for named contexts (the user fills in the facts). */
export const CONTEXT_TEMPLATES: { id: string; name: string; text: string }[] = [
  { id: 'work', name: 'My work', text: 'I work as … at …. My clients are …. Write in … and use … for numbers and dates.' },
  { id: 'client', name: 'A client project', text: 'Client: …. Goal of the project: …. Tone: …. Deadline: …. Things to avoid: ….' },
  { id: 'study', name: 'Studies', text: 'I study … at the level of …. The current topic is …. Explain at this level and give short examples.' },
  { id: 'private', name: 'Private', text: 'These are private projects. Keep a friendly tone, no business jargon. My language: ….' },
];

/** Host of a URL is this computer or the home network (no cloud). */
export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h === '::1' || h.startsWith('127.')) return true;
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith('fe80:')) return true;
    return false;
  } catch {
    return false;
  }
}

/** System prompt part for the persona, the personal context and the context in use. */
export function personalPrompt(p: PersonalSettings | null | undefined): string {
  if (!p) return '';
  const persona = p.personas.find((x) => x.id === p.active);
  const named = p.contexts?.find((x) => x.id === p.contextActive);
  const parts: string[] = [];
  if (persona?.prompt.trim()) parts.push(`Role for this chat (${persona.name}): ${persona.prompt.trim()}`);
  if (p.context.trim()) parts.push(`About the user (personal context, set by the user): ${p.context.trim()}`);
  if (named?.text.trim()) parts.push(`Context in use (${named.name}, set by the user): ${named.text.trim()}`);
  return parts.join('\n');
}
