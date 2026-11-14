// One-time move of browser storage written under the former product name to the WorkCraft keys.
// Imported first by main.ts and settings.ts so it runs before anything reads a preference.
// A WorkCraft key is never overwritten; the old keys stay in place, which keeps a rollback possible.
const FORMER = /^opencraft([.-])/;

try {
  const moves: [string, string][] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    // 'opencraft-lang' is read by i18n.ts itself
    if (k && k !== 'opencraft-lang' && FORMER.test(k)) moves.push([k, k.replace(FORMER, 'workcraft$1')]);
  }
  for (const [from, to] of moves) {
    const v = localStorage.getItem(from);
    if (v !== null && localStorage.getItem(to) === null) localStorage.setItem(to, v);
  }
} catch {
  /* storage blocked or unavailable */
}

export {};
