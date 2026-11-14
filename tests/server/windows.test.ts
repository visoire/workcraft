// Windows rules of the backend, checked with path.win32 (runs on every operating system).
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';

process.env.WORKCRAFT_HOME = mkdtempSync(join(tmpdir(), 'workcraft-win-'));
const { resolveIn, toProjectPath, safeZipEntry, pathKey, windowsSegmentProblem } = await import('../../src/server/paths.ts');
const { shellCandidates, commandInvocation } = await import('../../src/server/terminal.ts');
const W = path.win32;
const ROOT = 'C:\\Users\\you\\WorkCraft\\projects\\sample-1a2b3c';

test('Windows: project paths with forward slashes and backslashes', () => {
  assert.equal(resolveIn(ROOT, '/sheets/finances.xlsx', W, true), `${ROOT}\\sheets\\finances.xlsx`);
  assert.equal(resolveIn(ROOT, '\\documents\\report.docx', W, true), `${ROOT}\\documents\\report.docx`);
  assert.equal(resolveIn(ROOT, '/', W, true), ROOT);
  // Letter case of the project folder does not matter
  assert.equal(resolveIn(ROOT.toUpperCase(), '/a.txt', W, true), `${ROOT.toUpperCase()}\\a.txt`);
  assert.equal(toProjectPath(ROOT, `${ROOT}\\sheets\\finances.xlsx`, W), '/sheets/finances.xlsx');
});

test('Windows: no access outside the project', () => {
  // Escapes with "..", drives, data streams and device names are rejected
  assert.throws(() => resolveIn(ROOT, '/../../Windows/win.ini', W, true), /outside/);
  assert.throws(() => resolveIn(ROOT, '..\\..\\..\\Windows', W, true), /outside/);
  for (const bad of ['C:\\Windows\\win.ini', '/C:/Windows/win.ini', '/file.txt:hidden', '/nul', '/folder/CON.txt', '/name.', '/a?b'])
    assert.throws(() => resolveIn(ROOT, bad, W, true), /not allowed/, bad);
  assert.equal(windowsSegmentProblem('finances.xlsx'), null);
  assert.equal(pathKey('/Sheets/A.xlsx', true), pathKey('/sheets/a.xlsx', true));
});

test('ZIP import: Zip Slip protection with Windows paths', () => {
  assert.equal(safeZipEntry('project\\sheets\\finances.xlsx'), 'project/sheets/finances.xlsx');
  assert.equal(safeZipEntry('./documents/a.md'), 'documents/a.md');
  for (const bad of ['..\\..\\evil.exe', '../evil', 'a/../../b', 'C:\\Windows\\evil.dll', 'c:/evil', '\\\\server\\share\\x', '//server/x', 'file.txt:stream'])
    assert.equal(safeZipEntry(bad), null, bad);
});

test('Terminal: PowerShell first, then cmd.exe as a fallback', () => {
  const env = { SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
  const all = shellCandidates('win32', env, () => true);
  assert.deepEqual(all.map((s) => s.kind), ['powershell', 'cmd']);
  assert.equal(all[0]!.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  // Without files found: names through PATH
  const none = shellCandidates('win32', {}, () => false);
  assert.deepEqual(none.map((s) => s.file), ['powershell.exe', 'cmd.exe']);
  // PowerShell command as UTF-16LE Base64 (no quoting problems), output in UTF-8
  const ps = commandInvocation(all[0]!, 'Write-Output "Size: 5 µm"');
  const i = ps.args.indexOf('-EncodedCommand');
  const decoded = Buffer.from(ps.args[i + 1]!, 'base64').toString('utf16le');
  assert.match(decoded, /OutputEncoding=\[System\.Text\.Encoding\]::UTF8/);
  assert.match(decoded, /Write-Output "Size: 5 µm"$/);
  const cmd = commandInvocation(all[1]!, 'dir');
  assert.deepEqual(cmd.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(cmd.args[3], '"chcp 65001>nul & dir"');
  assert.equal(cmd.options.windowsVerbatimArguments, true);
  // macOS and Linux
  assert.equal(shellCandidates('linux', { SHELL: '/bin/zsh' }, (p) => p === '/bin/zsh' || p === '/bin/sh')[0]!.file, '/bin/zsh');
});

test.after(() => rmSync(process.env.WORKCRAFT_HOME!, { recursive: true, force: true }));
