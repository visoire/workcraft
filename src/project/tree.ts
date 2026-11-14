// Project tree (left side bar): shared file access for all panels and the AI chat.
// Import with the file picker, a folder or drag and drop. ZIP archives can be unpacked.

import { h, basename, dirname, extname, normPath, formatBytes, downloadBlob } from '../app/util.js';
import { icon } from '../app/icons.js';
import { bus } from '../app/bus.js';
import { dialog, promptText, confirmDanger, menu, type MenuItem } from '../app/ui.js';
import { toast, notifyError, notify } from '../app/notifications.js';
import { backend } from '../app/backend.js';
import { fs, type Entry } from './fs.js';
import { projects } from './manager.js';
import { TOOLS, toolForPath, toolMark, type PanelContext, type PanelInstance } from '../workspace/registry.js';
import { appsFor } from '../ecosystems/catalog.js';
import { activeApps } from '../ecosystems/ecosystems.js';
import { workspace } from '../workspace/layout.js';
import { allowScribble } from '../workspace/pencil.js';
import { t as tr } from '../app/i18n.js';
import { blankFor } from '../core/blank.js';
import { canLocate, copyFullPath, copyProjectPath, revealInFileManager } from './locate.js';
import { desktopApps, desktopAppCached, openInDesktop } from './desktop.js';

const LS_OPEN = 'workcraft.tree.open';

export async function mount(el: HTMLElement, ctx: PanelContext): Promise<PanelInstance> {
  let open: Set<string>;
  try {
    open = new Set(JSON.parse(localStorage.getItem(LS_OPEN) || '["/documents","/sheets"]') as string[]);
  } catch {
    open = new Set(['/documents', '/sheets']);
  }
  let selected: string | null = null;
  let filter = '';
  const saveOpen = () => {
    try {
      localStorage.setItem(LS_OPEN, JSON.stringify([...open]));
    } catch {
      /* blocked */
    }
  };

  const fileInput = h<'input'>('input', { type: 'file', multiple: true, hidden: true });
  const dirInput = h<'input'>('input', { type: 'file', multiple: true, hidden: true });
  dirInput.setAttribute('webkitdirectory', '');
  fileInput.onchange = () => void importFiles([...(fileInput.files || [])], targetDir()).finally(() => (fileInput.value = ''));
  dirInput.onchange = () => void importFiles([...(dirInput.files || [])], targetDir(), true).finally(() => (dirInput.value = ''));

  const act = (ic: string, label: string, run: (e: MouseEvent) => void, action?: string) => h('button.icon-btn', { type: 'button', title: label, 'aria-label': label, html: icon(ic, { size: 16 }), onclick: run, 'data-action': action || null });
  const projectBtn = h<'button'>('button.tree-project', { type: 'button', title: tr('Switch, create or export a project') });
  const search = h<'input'>('input.input.tree-search', { type: 'search', placeholder: tr('Filter files'), 'aria-label': tr('Filter files'), spellcheck: 'false' });
  allowScribble(search);
  search.setAttribute('enterkeyhint', 'search');
  // The filter is a button; the field only appears while it is in use (and closes with Escape or the button)
  const filterBar = h('div.tree-filter', { hidden: true }, h('span.tree-filter-ic', { 'aria-hidden': 'true', html: icon('search', { size: 14 }) }), search);
  const filterBtn = act('search', tr('Filter files'), () => toggleFilter(), 'filter');
  filterBtn.setAttribute('aria-pressed', 'false');
  filterBtn.setAttribute('aria-expanded', 'false');
  function toggleFilter(force?: boolean) {
    const show = force ?? filterBar.hidden;
    filterBar.hidden = !show;
    filterBtn.setAttribute('aria-pressed', String(show));
    filterBtn.setAttribute('aria-expanded', String(show));
    if (show) search.focus();
    else if (search.value || filter) {
      search.value = '';
      filter = '';
      render();
    }
  }
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      toggleFilter(false);
      filterBtn.focus();
    }
  });
  const head = h(
    'div.tree-head',
    projectBtn,
    h(
      'div.tree-actions',
      filterBtn,
      act('filePlus', tr('New file'), (e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        newMenu(r.left, r.bottom + 4);
      }, 'new-file'),
      act('folderPlus', tr('New folder'), () => void newEntry('dir')),
      act('upload', tr('Import files'), () => fileInput.click(), 'import'),
      act('dots', tr('More actions'), (e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        menu(
          [
            { label: tr('Import folder'), icon: 'folderOpen', run: () => dirInput.click() },
            { label: tr('Export project as ZIP'), icon: 'archive', run: () => void projects.exportZip() },
            '-',
            { label: tr('Collapse all folders'), icon: 'chevron', run: () => (open.clear(), saveOpen(), render()) },
          ],
          r.left,
          r.bottom + 4
        );
      })
    ),
    filterBar
  );
  const listEl = h('div.tree-list', { role: 'tree', 'aria-label': tr('Project files'), tabindex: '0' });
  const footEl = h('div.tree-foot.mono');
  const drop = h('div.tree-drop', { 'aria-hidden': 'true' }, h('span', { html: icon('upload', { size: 22 }) }), tr('Drop files here'));
  const root = h('div.tree', head, listEl, footEl, drop, fileInput, dirInput);
  el.append(root);

  async function paintProject() {
    const p = projects.current || (await projects.list().catch(() => null))?.active;
    projectBtn.innerHTML = icon('briefcase', { size: 16 }) + `<span class="tree-project-name">${p ? p.name.replace(/[<>&]/g, '') : tr('Project')}</span>` + icon('chevronDown', { size: 14 });
    ctx.setStatus(p ? tr('Project {name}', { name: p.name }) : '');
  }
  projectBtn.onclick = () => void projects.openSwitcher(projectBtn);
  // Which Craft apps are installed on this computer (for Open in the desktop app)
  void desktopApps();
  // Right click on the project: rename, duplicate, export, show in the file manager, delete
  projectBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = projects.current;
    if (p) menu(projects.menuEntries(p), e.clientX, e.clientY);
  });

  function targetDir(): string {
    if (!selected) return '/';
    return fs.stat(selected)?.kind === 'dir' ? selected : dirname(selected);
  }

  interface Row extends Entry {
    depth: number;
  }
  function rows(): Row[] {
    const out: Row[] = [];
    if (filter) {
      const q = filter.toLowerCase();
      return fs
        .files()
        .filter((e) => e.path.toLowerCase().includes(q))
        .sort((a, b) => a.path.localeCompare(b.path, 'de'))
        .map((e) => ({ ...e, depth: 0 }));
    }
    const walk = (dir: string, depth: number) => {
      const kids = fs.children(dir).sort((a, b) => (a.kind === b.kind ? basename(a.path).localeCompare(basename(b.path), 'de') : a.kind === 'dir' ? -1 : 1));
      for (const k of kids) {
        out.push({ ...k, depth });
        if (k.kind === 'dir' && open.has(k.path)) walk(k.path, depth + 1);
      }
    };
    walk('/', 0);
    return out;
  }

  function render() {
    const list = rows();
    listEl.replaceChildren(
      ...list.map((e) => {
        const isDir = e.kind === 'dir';
        const tool = isDir ? null : TOOLS[toolForPath(e.path)];
        const row = h(
          'div.tree-row' + (selected === e.path ? '.is-selected' : ''),
          {
            role: 'treeitem',
            'aria-level': String(e.depth + 1),
            'aria-expanded': isDir ? String(open.has(e.path)) : null,
            'aria-selected': selected === e.path ? 'true' : 'false',
            'data-path': e.path,
            draggable: 'true',
            style: `--depth:${e.depth};${tool ? `--tool:${tool.accent}` : ''}`,
            title: e.path,
          },
          h('span.tree-chev', { html: isDir ? icon(open.has(e.path) ? 'chevronDown' : 'chevron', { size: 14 }) : '' }),
          h('span.tree-ic' + (tool?.kind === 'app' ? '.is-app' : ''), { html: isDir ? icon(open.has(e.path) ? 'folderOpen' : 'folder', { size: 16 }) : tool!.kind === 'app' ? toolMark(tool!.id, 16) : icon(tool!.icon, { size: 16 }) }),
          h('span.tree-name', filter ? e.path.slice(1) : basename(e.path)),
          h('span.tree-open-mark', { 'aria-hidden': 'true' }),
          isDir ? null : h('span.tree-size.mono', formatBytes(e.size))
        );
        row.addEventListener('click', () => {
          selected = e.path;
          if (isDir) toggle(e.path);
          else {
            paintSelection();
            void workspace.openFile(e.path);
          }
        });
        row.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          selected = e.path;
          paintSelection();
          contextMenu(e, ev.clientX, ev.clientY);
        });
        // Dragging into the chat creates an @ mention
        row.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData('text/x-workcraft-path', e.path);
          ev.dataTransfer?.setData('text/plain', '@' + e.path.slice(1));
        });
        return row;
      })
    );
    if (!list.length && filter) listEl.append(h('p.muted.tree-empty', tr('No matches.')));
    else if (!list.length) {
      // A new project of your own starts empty; the sample files are one click away as a project of their own
      const isSample = projects.current?.name === 'Sample project';
      listEl.append(
        h(
          'div.tree-empty',
          { 'data-tree-empty': '' },
          h('p.muted', tr('This project is empty. Import files, drop them here or create new ones.')),
          h(
            'div.tree-empty-actions',
            h('button.btn.sm', { type: 'button', onclick: () => fileInput.click(), html: icon('upload', { size: 14 }) + `<span>${tr('Import files')}</span>` }),
            isSample ? null : h('button.btn.sm.ghost', { type: 'button', 'data-load-sample': '', onclick: () => void projects.openSample(), html: icon('spark', { size: 14 }) + `<span>${tr('Load sample data')}</span>` })
          ),
          isSample ? null : h('p.muted.tree-empty-note', tr('Opens a separate sample project with a document, a spreadsheet, slides and a PDF. Your own project stays as it is.'))
        )
      );
    }
    const files = fs.files();
    footEl.textContent = `${files.length === 1 ? tr('1 file') : tr('{n} files', { n: files.length })} · ${formatBytes(files.reduce((s, f) => s + f.size, 0))} · ${tr('local')}`;
    paintOpenMarks();
  }

  function paintSelection() {
    listEl.querySelectorAll<HTMLElement>('.tree-row').forEach((r) => {
      const on = r.dataset.path === selected;
      r.classList.toggle('is-selected', on);
      r.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  function paintOpenMarks() {
    const openPaths = new Set(workspace.panels().filter((p) => p.path).map((p) => p.path));
    listEl.querySelectorAll<HTMLElement>('.tree-row').forEach((r) => r.classList.toggle('is-open', openPaths.has(r.dataset.path || '')));
  }
  function toggle(path: string) {
    if (open.has(path)) open.delete(path);
    else open.add(path);
    saveOpen();
    render();
  }

  listEl.addEventListener('keydown', (e) => {
    const list = rows();
    const i = list.findIndex((r) => r.path === selected);
    const cur = list[i];
    const go = (j: number) => {
      const r = list[Math.max(0, Math.min(list.length - 1, j))];
      if (!r) return;
      selected = r.path;
      paintSelection();
      listEl.querySelector(`[data-path="${CSS.escape(r.path)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'ArrowRight' && cur?.kind === 'dir' && !open.has(cur.path)) toggle(cur.path);
    else if (e.key === 'ArrowLeft' && cur?.kind === 'dir' && open.has(cur.path)) toggle(cur.path);
    else if (e.key === 'Enter' && cur) cur.kind === 'dir' ? toggle(cur.path) : void workspace.openFile(cur.path);
    else if (e.key === 'Delete' && cur) void removeEntry(cur.path);
    else return;
    e.preventDefault();
  });
  search.addEventListener('input', () => {
    filter = search.value.trim();
    render();
  });

  function contextMenu(e: Entry, x: number, y: number) {
    const items: (MenuItem | '-')[] = [];
    if (e.kind === 'file') {
      const main = toolForPath(e.path);
      items.push({ label: tr('Open in {name}', { name: TOOLS[main].name }), html: toolMark(main, 16), run: () => void workspace.openFile(e.path) });
      const ext = extname(e.path);
      // Every app that reads this type (the same .docx opens in WordCraft and PdfCraft's import, a .png in several
      // apps), best home first; apps without a web build here are left out. Then the code editor for text files.
      for (const a of appsFor(e.path, { prefer: activeApps(), available: (id) => !!TOOLS[id].available })) {
        if (a.id === main) continue;
        items.push({ label: tr('Open with {name}', { name: a.name }), html: toolMark(a.id, 16), run: () => void workspace.openFile(e.path, a.id) });
      }
      for (const t of Object.values(TOOLS)) {
        if (t.kind === 'side' || t.kind === 'app' || t.id === main) continue;
        if (t.exts.includes(ext) || (t.id === 'code' && (fs.stat(e.path)?.size || 0) < 2e6 && /^(md|txt|csv|tsv|html|svg|json|tex)$/.test(ext))) items.push({ label: tr('Open with {name}', { name: t.name }), html: toolMark(t.id, 16), run: () => void workspace.openFile(e.path, t.id) });
      }
      // The same app installed on this computer: open the file in its desktop window (the AI can drive it live)
      const desk = desktopAppCached(main);
      if (desk) items.push({ label: tr('Open in {name} for desktop', { name: desk.name }), icon: 'external', run: () => void openInDesktop(desk.id, e.path) });
      items.push('-', { label: tr('Mention in the chat'), icon: 'at', run: () => bus.emit('chat:insert', '@' + e.path.slice(1) + ' ') });
      items.push({ label: tr('Download'), icon: 'download', run: () => void exportFile(e.path) });
      items.push({ label: tr('Duplicate'), icon: 'copy', run: async () => void (await fs.write(fs.uniquePath(e.path), await fs.readBinary(e.path))) });
    } else {
      items.push({ label: tr('New file here'), icon: 'filePlus', run: () => newMenu(x, y, e.path) });
      items.push({ label: tr('New folder here'), icon: 'folderPlus', run: () => void newEntry('dir', e.path) });
      items.push({ label: tr('Import here'), icon: 'upload', run: () => ((selected = e.path), fileInput.click()) });
      items.push({ label: tr('Mention in the chat'), icon: 'at', run: () => bus.emit('chat:insert', '@' + e.path.slice(1) + '/ ') });
      items.push('-');
    }
    items.push({ label: tr('Copy path'), icon: 'copy', run: () => void copyProjectPath(e.path) });
    if (canLocate()) {
      items.push({ label: tr('Copy full path'), icon: 'copy', run: () => void copyFullPath(e.path) });
      items.push({ label: tr('Show in the file manager'), icon: 'folderOpen', run: () => void revealInFileManager(e.path) });
    }
    items.push('-', { label: tr('Rename'), icon: 'pen', run: () => void renameEntry(e.path) });
    items.push({ label: tr('Delete'), icon: 'trash', danger: true, run: () => void removeEntry(e.path) });
    menu(items, x, y);
  }

  /** The New menu: every app with its mark and extension, so a file starts in the right app. */
  function newMenu(x: number, y: number, dir?: string) {
    const kinds: { tool: 'wordcraft' | 'gridcraft' | 'deckcraft' | 'pdfcraft'; label: string; ext: string }[] = [
      { tool: 'wordcraft', label: tr('Document'), ext: 'docx' },
      { tool: 'gridcraft', label: tr('Spreadsheet'), ext: 'xlsx' },
      { tool: 'deckcraft', label: tr('Presentation'), ext: 'pptx' },
      { tool: 'pdfcraft', label: tr('PDF'), ext: 'pdf' },
    ];
    const items: (MenuItem | '-')[] = kinds.map((k) => ({ label: `${k.label}`, hint: `.${k.ext}`, html: toolMark(k.tool, 16), run: () => void newEntry('file', dir, { name: `${tr('Untitled')}.${k.ext}`, folder: TOOLS[k.tool].folder }) }));
    // Apps of the ecosystem in use besides the four: they start empty (their own editor), the file is created when
    // the app saves into the project
    const more = activeApps().filter((id) => !(kinds as { tool: string }[]).some((k) => k.tool === id) && TOOLS[id].available);
    if (more.length) items.push('-', ...more.map((id) => ({ label: tr('Start {name}', { name: TOOLS[id].name }), html: toolMark(id, 16), run: () => void workspace.openPanel(id) })));
    items.push('-', { label: tr('Markdown note'), icon: 'file', hint: '.md', run: () => void newEntry('file', dir, { name: 'note.md', folder: '/documents' }) });
    items.push({ label: tr('Code file'), icon: 'code', hint: '.js', run: () => void newEntry('file', dir, { name: 'script.js', folder: '/code' }) });
    items.push('-', { label: tr('Folder'), icon: 'folderPlus', run: () => void newEntry('dir', dir) });
    menu(items, x, y);
  }
  async function newEntry(kind: 'file' | 'dir', dirArg?: string, preset?: { name: string; folder?: string }) {
    // With a folder selected the file goes there, otherwise into the app's own folder (documents, sheets, ...)
    const dir = dirArg ?? (selected ? targetDir() : preset?.folder || '/');
    const name = await promptText(kind === 'dir' ? tr('New folder') : tr('New file'), tr('Name'), kind === 'dir' ? tr('folder') : preset?.name || tr('note.md'), tr('create'));
    if (!name) return;
    const p = fs.uniquePath(normPath(dir + '/' + name));
    if (kind === 'dir' && fs.exists(p)) return toast(tr('{name} already exists', { name }), 'error');
    try {
      if (kind === 'dir') {
        await fs.mkdir(p);
        open.add(p);
      } else {
        // Office files and PDFs start as valid, empty packages: a 0-byte .xlsx cannot be opened by anything
        await fs.write(p, blankFor(extname(p)));
        open.add(dir);
        void workspace.openFile(p);
      }
      saveOpen();
      selected = p;
      render();
    } catch (e) {
      notifyError(e);
    }
  }
  async function renameEntry(path: string) {
    const name = await promptText(tr('Rename'), tr('New name'), basename(path));
    if (!name || name === basename(path)) return;
    try {
      await fs.rename(path, normPath(dirname(path) + '/' + name));
    } catch (e) {
      notifyError(e);
    }
  }
  async function removeEntry(path: string) {
    const st = fs.stat(path);
    const where = backend.browser ? '' : ' ' + tr('It stays in the trash for 30 days.');
    if (!(await confirmDanger(tr('Delete'), (st?.kind === 'dir' ? tr('{name} and everything in it is deleted from the project.', { name: basename(path) }) : tr('{name} is deleted from the project.', { name: basename(path) })) + where))) return;
    for (const p of workspace.panels()) if (p.path && (p.path === path || p.path.startsWith(path + '/'))) await workspace.close(p.id);
    try {
      await fs.remove(path);
      if (!backend.browser) notify({ level: 'success', title: tr('{name} moved to the trash', { name: basename(path) }), actions: [{ label: tr('Open the trash'), run: () => bus.emit('open-settings', 'trash') }], timeout: 6000 });
    } catch (e) {
      notifyError(e);
    }
    if (selected === path) selected = null;
  }
  async function exportFile(path: string) {
    downloadBlob(new Blob([await fs.readBinary(path)]), basename(path));
  }

  async function importFiles(files: File[], dir = '/', keepPaths = false, rels?: string[]): Promise<number> {
    let n = 0;
    try {
      for (const [i, f] of files.entries()) {
        const rel = rels?.[i] ?? (keepPaths && f.webkitRelativePath ? f.webkitRelativePath : f.name);
        if (extname(f.name) === 'zip') {
          const choice = await dialog({ title: f.name, tone: tr('import'), body: tr('Unpack the archive into this folder or keep it as a ZIP file? To import it as its own project, use the project switcher or drop it on the workspace.'), ok: tr('Unpack'), cancel: tr('Keep as file') });
          if (choice) {
            const { unzipSync } = await import('fflate');
            const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
            const base = normPath(dir + '/' + f.name.replace(/\.zip$/i, ''));
            for (const [name, data] of Object.entries(entries)) {
              if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.endsWith('.DS_Store')) continue;
              await fs.write(normPath(base + '/' + name), data);
              n++;
            }
            continue;
          }
        }
        await fs.write(fs.uniquePath(normPath(dir + '/' + rel)), await f.arrayBuffer());
        n++;
      }
    } catch (e) {
      notifyError(e);
    }
    if (n) {
      open.add(dir);
      saveOpen();
      render();
      toast(n === 1 ? tr('{n} file imported', { n }) : tr('{n} files imported', { n }), 'success');
    }
    return n;
  }

  // Drag and drop: files and whole folders from the operating system, and moving files and folders inside the project
  const INTERNAL = 'text/x-workcraft-path';
  /** Every file below the dropped entries, with its path relative to the drop (folders keep their structure). */
  async function walkEntries(entries: FileSystemEntry[]): Promise<{ file: File; rel: string }[]> {
    const out: { file: File; rel: string }[] = [];
    const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
        out.push({ file, rel: prefix + entry.name });
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        let batch: FileSystemEntry[];
        do {
          batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
          for (const child of batch) await walk(child, prefix + entry.name + '/');
        } while (batch.length);
      }
    };
    for (const e of entries) await walk(e, '');
    return out;
  }
  async function moveInto(from: string, dir: string) {
    const to = normPath(dir + '/' + basename(from));
    if (to === from || dir === dirname(from)) return;
    if (dir === from || dir.startsWith(from + '/')) return toast(tr('A folder cannot be moved into itself'), 'error');
    if (fs.exists(to)) return toast(tr('{name} already exists', { name: basename(from) }), 'error');
    try {
      await fs.rename(from, to);
      open.add(dir);
      saveOpen();
      selected = to;
      render();
      toast(tr('{name} moved', { name: basename(from) }), 'success', dir === '/' ? tr('Project root') : dir);
    } catch (e) {
      notifyError(e);
    }
  }
  const dropDir = (e: DragEvent): string => {
    const p = (e.target as Element).closest<HTMLElement>('.tree-row')?.dataset.path;
    return p ? (fs.stat(p)?.kind === 'dir' ? p : dirname(p)) : '/';
  };
  const accepts = (e: DragEvent) => !!e.dataTransfer && (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(INTERNAL));
  const clearTarget = () => listEl.querySelectorAll('.is-drop-target').forEach((r) => r.classList.remove('is-drop-target'));
  let depth = 0;
  root.addEventListener('dragenter', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    depth++;
    root.classList.add('is-drop');
  });
  root.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = e.dataTransfer.types.includes(INTERNAL) ? 'move' : 'copy';
    clearTarget();
    const dir = dropDir(e);
    if (dir !== '/') listEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(dir)}"]`)?.classList.add('is-drop-target');
  });
  root.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      root.classList.remove('is-drop');
      clearTarget();
    }
  });
  root.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    const internal = dt.getData(INTERNAL);
    if (!internal && !dt.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    root.classList.remove('is-drop');
    clearTarget();
    const dir = dropDir(e);
    if (internal) return void moveInto(internal, dir);
    // The entries must be read now: the browser empties the drop data once this handler returns
    const entries = [...dt.items].map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null)).filter((x): x is FileSystemEntry => !!x);
    const plain = [...dt.files];
    void (entries.length ? walkEntries(entries) : Promise.resolve(plain.map((file) => ({ file, rel: file.name })))).then((list) => {
      if (!list.length) {
        toast(tr('Nothing to import: the folder is empty.'), 'warning');
        return 0;
      }
      return importFiles(list.map((x) => x.file), dir, false, list.map((x) => x.rel));
    });
  });

  /** Panel menu "Show in the project tree": opens the folders above the file, selects it and scrolls to it. */
  function reveal(path: string) {
    if (!fs.stat(path)) return;
    if (filter || !filterBar.hidden) toggleFilter(false);
    for (let dir = dirname(path); dir && dir !== '/' && dir !== '.'; dir = dirname(dir)) open.add(dir);
    saveOpen();
    selected = path;
    render();
    paintSelection();
    const row = listEl.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
    row?.scrollIntoView({ block: 'center' });
    row?.classList.remove('is-found');
    if (row) {
      void row.offsetWidth;
      row.classList.add('is-found');
    }
  }

  const offs = [bus.on('fs:change', render), bus.on('workspace:change', paintOpenMarks), bus.on('project:renamed', () => void paintProject()), bus.on('tree:reveal', ({ path }) => reveal(path))];
  void paintProject();
  render();
  if (ctx.restore?.scroll) listEl.scrollTop = ctx.restore.scroll.top;

  return {
    status: () => ({ project: projects.current?.name, files: fs.files().length }),
    getScroll: () => ({ top: listEl.scrollTop, left: 0 }),
    setScroll: (s) => void (listEl.scrollTop = s.top),
    unmount() {
      offs.forEach((f) => f());
      root.remove();
    },
  };
}
