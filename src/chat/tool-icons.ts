// The icon of a tool call in the chat. Tools of the four apps show the app's logo and tools of a connected
// Craft app show its icon (see craft-icons.ts); every other tool gets a glyph from the icon set that says what it
// does, so a card reads at a glance: folder for listing files, magnifier for search, terminal for commands.

const RULES: [RegExp, string][] = [
  [/^cloud-export/, 'upload'],
  [/^cloud-import/, 'download'],
  [/^cloud-/, 'archive'],
  [/^file-history/, 'clock'],
  [/^images-to-pdf/, 'image'],
  [/^list-files/, 'folderOpen'],
  [/^(list|read)-skills?/, 'book'],
  [/^(open-panel|panel-status)/, 'layoutSingle'],
  [/^list-craft-apps/, 'grid'],
  [/^open-in-app/, 'popout'],
  [/^recent-files/, 'clock'],
  [/^remember/, 'pin'],
  [/^run-command/, 'terminal'],
  [/^(search-|find-)/, 'search'],
  [/^sign-pdf/, 'pen'],
  [/^(write|create)-/, 'filePlus'],
  [/^read-/, 'file'],
  [/^ext-/, 'plug'],
];

/**
 * One readable line for the arguments of a tool call, for the header of its card: the file first, then a few values
 * ("/sheets/finances.xlsx · range: A1:D5 · 3 rows"). Long text and nested data are summed up, never printed whole.
 */
export function summarizeArgs(args: Record<string, unknown>, pathArg?: string, max = 90): string {
  const entries = Object.entries(args || {});
  const pathKey = pathArg && typeof args?.[pathArg] === 'string' ? pathArg : entries.find(([, v]) => typeof v === 'string' && /^\/[^\s]*$/.test(v))?.[0];
  const parts: string[] = [];
  if (pathKey) parts.push(String(args[pathKey]));
  for (const [k, v] of entries) {
    if (k === pathKey || v === undefined || v === null || v === '') continue;
    if (typeof v === 'string') parts.push(`${k}: ${v.replace(/\s+/g, ' ').length > 28 ? v.replace(/\s+/g, ' ').slice(0, 27) + '…' : v.replace(/\s+/g, ' ')}`);
    else if (typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}: ${v}`);
    else if (Array.isArray(v)) parts.push(`${k}: ${v.length} item${v.length === 1 ? '' : 's'}`);
    else parts.push(`${k}: {…}`);
  }
  const text = parts.join(' · ');
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/** Icon name (src/app/icons.js) for a tool; `bolt` when nothing fits. */
export function toolGlyph(name: string): string {
  for (const [re, ic] of RULES) if (re.test(name)) return ic;
  return 'bolt';
}
