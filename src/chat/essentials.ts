/**
 * What the chat offers, decided by the workspace in use. Pure (no DOM, no storage), so a test can keep the rules.
 *
 * The persona menu is a short list: Standard, the personas that suit the apps of the workspace, and the one in use. The rest is in Settings.
 */

export interface PersonaLike {
  id: string;
  apps?: readonly string[];
}

/** Standard first, then up to `max` personas that suit the apps of the workspace, then the one in use if it is not among them. */
export function suggestedPersonas<P extends PersonaLike>(personas: readonly P[], apps: readonly string[], activeId: string, max = 5): P[] {
  const mine = new Set(apps);
  const standard = personas.filter((p) => p.id === 'default');
  const fits = personas.filter((p) => p.id !== 'default' && p.apps?.some((a) => mine.has(a))).slice(0, max);
  const out = [...standard, ...fits];
  const active = personas.find((p) => p.id === activeId);
  if (active && !out.includes(active)) out.push(active);
  return out;
}