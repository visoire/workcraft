/**
 * What the right-click menu of a panel offers (panel header, tab, the app's icon in the tool rail, a long press on
 * a touch screen). Pure: facts about the panel in, the ordered list of actions out. layout.ts turns the actions
 * into menu entries and runs them; tests/server/panel-menu.test.ts keeps the rules.
 *
 * The groups, in order: how the window sits (maximize, full screen, minimize, floating, separate window), where
 * the file is (desktop app, project tree, file manager, copy the path), the engine (reload, unload, info), and
 * last how it goes away (hide for the side panels, close for the others).
 */

export type PanelAction =
  | 'show'
  | 'maximize'
  | 'fullscreen'
  | 'minimize'
  | 'pip'
  | 'popout'
  | 'desktop'
  | 'tree'
  | 'reveal'
  | 'copy-path'
  | 'reload'
  | 'unload'
  | 'info'
  | 'hide'
  | 'close';

export interface PanelFacts {
  /** The panel is on the stage (or in its side zone) right now; a hidden or minimized one offers Show instead of window actions */
  shown: boolean;
  /** An app (WebAssembly engine in an iframe); the code editor, the terminal, the settings are not */
  app: boolean;
  /** The project tree and the chat: they live in the side zones and are hidden, not closed */
  side: boolean;
  /** idle, queued, loading, active, unloaded, error */
  status: string;
  /** The panel shows a project file */
  hasPath: boolean;
  /** The panel runs in a window of its own (the engine lives there) */
  popped: boolean;
  /** The window can be moved to a separate browser window (not in browser mode, not for side panels) */
  canPopOut: boolean;
  /** The window can be minimized to the dock */
  canMinimize: boolean;
  /** A desktop app of this tool is installed on this computer */
  hasDesktopApp: boolean;
  /** The full path and the file manager exist (this computer, not the home network, not browser mode) */
  canLocate: boolean;
}

/** The actions in order; '-' is a separator. Never starts or ends with one, never two in a row. */
export function panelActions(f: PanelFacts): (PanelAction | '-')[] {
  const groups: PanelAction[][] = [];

  // A hidden or minimized panel is first of all brought back; the window actions would act on something nobody sees
  const win: PanelAction[] = f.shown ? ['maximize', 'fullscreen'] : ['show'];
  if (f.shown && f.canMinimize) win.push('minimize');
  if (f.shown) win.push('pip');
  if (f.canPopOut) win.push('popout');
  groups.push(win);

  const file: PanelAction[] = [];
  if (f.hasPath && f.hasDesktopApp) file.push('desktop');
  if (f.hasPath) file.push('tree');
  if (f.hasPath && f.canLocate) file.push('reveal');
  if (f.hasPath) file.push('copy-path');
  groups.push(file);

  const engine: PanelAction[] = [];
  // A panel in a window of its own is reloaded and unloaded from that window
  if (f.app && !f.popped) {
    if (f.status === 'active' || f.status === 'error' || f.status === 'unloaded') engine.push('reload');
    if (f.status === 'active') engine.push('unload');
  }
  engine.push('info');
  groups.push(engine);

  // The X of the header only hides; Hide is here too, and Close (red) closes for good and frees the memory
  groups.push(f.side ? ['hide'] : f.shown ? ['hide', 'close'] : ['close']);

  const out: (PanelAction | '-')[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    if (out.length) out.push('-');
    out.push(...g);
  }
  return out;
}

/** A key and value for the info card, in the order they are shown. Empty values are left out. */
export function infoRows(i: { name: string; version?: string; status: string; mode: string; path: string | null; loadMs: number; paused: boolean; memory: { wasm: number; gpu: number; heap: number | null } | null; report: Record<string, unknown> | null; error?: string }, labels: Record<'app' | 'status' | 'window' | 'file' | 'start' | 'wasm' | 'gpu' | 'heap' | 'error', string>): [string, string][] {
  const mb = (n: number) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(2)} GB` : `${Math.round(n / 1024 / 1024)} MB`);
  const rows: [string, string][] = [
    [labels.app, i.version ? `${i.name} ${i.version}` : i.name],
    [labels.status, i.paused ? `${i.status} · paused` : i.status],
    [labels.window, i.mode],
  ];
  if (i.path) rows.push([labels.file, i.path]);
  if (i.loadMs) rows.push([labels.start, `${(i.loadMs / 1000).toFixed(1)} s`]);
  if (i.memory) {
    if (i.memory.wasm) rows.push([labels.wasm, mb(i.memory.wasm)]);
    if (i.memory.gpu) rows.push([labels.gpu, mb(i.memory.gpu)]);
    if (i.memory.heap) rows.push([labels.heap, mb(i.memory.heap)]);
  }
  // What the engine itself reports (renderer, version, canvas size ...): flat values only, never an object dump
  for (const [k, v] of Object.entries(i.report || {})) {
    if (v === null || v === undefined || v === '' || typeof v === 'object' || typeof v === 'function') continue;
    // already shown above
    if (['app', 'tool', 'version', 'path', 'file', 'name'].includes(k.toLowerCase())) continue;
    rows.push([k.replace(/_/g, ' '), String(v)]);
    if (rows.length >= 18) break;
  }
  if (i.error) rows.push([labels.error, i.error]);
  return rows;
}
