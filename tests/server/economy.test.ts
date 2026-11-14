// Token economy (src/chat/economy.ts): which tools a question needs, find-tools, shorter schemas of foreign tools,
// and shrinking what earlier questions left in the history. Pure logic, no browser needed.
//   npx tsx --test tests/server/economy.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeTools, findTools, findToolsSpec, foundText, compactSchema, compactSpec, compactTurns, groupOf, tokensOf, FIND_TOOLS, MAX_TOOLS, type RouteTool } from '../../src/chat/economy.js';
import { TOOL_DEFS } from '../../src/mcp/schemas.js';
import type { ChatTurn } from '../../src/chat/types.js';

const builtin: RouteTool[] = TOOL_DEFS.map((d) => ({ name: d.name, source: d.side === 'client' ? 'client' : 'server', description: d.description, title: d.title }));
const ext = (app: string, names: string[]): RouteTool[] => names.map((n) => ({ name: `ext-${app}-${n}`, source: 'external', title: n, description: `${n.replace(/-/g, ' ')} in ${app}. This tool takes the image or file path and the options of the operation and returns the result. Long text so that it costs tokens like a real tool description does.` }));
const photo = ext('photocraft', ['open-image', 'crop-image', 'resize-image', 'rotate', 'histogram', 'export-image', 'adjust-curves', 'blur', 'sharpen', 'layers-list']);
const cad = ext('cadcraft', ['open-model', 'extrude', 'section-view', 'export-stl', 'measure']);
const all = [...builtin, ...photo, ...cad];
const base = { tools: all, text: '', paths: [] as string[], used: [] as string[], sent: [] as string[] };

test('A question about spreadsheets sends the workspace tools and holds the Craft app tools back', () => {
  const r = routeTools({ ...base, text: 'Sum the revenue per quarter in @finances.xlsx', paths: ['/sheets/finances.xlsx'] });
  for (const d of builtin) if (!d.name.startsWith('cloud-')) assert.ok(r.send.includes(d.name), d.name);
  assert.ok(!r.send.some((n) => n.startsWith('ext-')));
  assert.ok(!r.send.some((n) => n.startsWith('cloud-')));
  assert.equal(r.hidden.length, photo.length + cad.length + builtin.filter((b) => b.name.startsWith('cloud-')).length);
});

test('Naming an app brings all of its tools, a file type does the same', () => {
  const byName = routeTools({ ...base, text: 'Open the picture in PhotoCraft please' });
  assert.equal(byName.send.filter((n) => n.startsWith('ext-photocraft-')).length, photo.length);
  assert.ok(!byName.send.some((n) => n.startsWith('ext-cadcraft-')));
  // the file types come from the catalog (CADCraft opens .dxf and .dwg, SolidCraft opens .stl)
  const byFile = routeTools({ ...base, text: 'measure it', paths: ['/drawings/bracket.dxf'] });
  assert.equal(byFile.send.filter((n) => n.startsWith('ext-cadcraft-')).length, cad.length);
});

test('Apps with a hyphen in the id are found by their tool-name form, by words and by file type', () => {
  const anything = ext('craftanything', ['study-target', 'web-site-open', 'rebuild-run']);
  const mail = ext('mailcraft', ['list-messages', 'send-message']);
  const tools = [...builtin, ...photo, ...anything, ...mail];
  const run = (text: string, paths: string[] = []) => routeTools({ ...base, tools, text, paths }).send.filter((n) => n.startsWith('ext-'));
  assert.equal(run('Use Craft Anything to study this site').filter((n) => n.startsWith('ext-craftanything-')).length, anything.length);
  assert.equal(run('ask craft-anything about it').filter((n) => n.startsWith('ext-craftanything-')).length, anything.length);
  assert.deepEqual(run('what is in it', ['/mail/inbox.eml']).sort(), mail.map((t) => t.name).sort(), 'an .eml names MailCraft');
  assert.deepEqual(run('what is in it', ['/studies/site.cany']).sort(), anything.map((t) => t.name).sort());
});

test('A broad question never sends more tools than a provider accepts; the rest stays one find-tools call away', () => {
  const many = Array.from({ length: 12 }, (_, g) => ext(`app${g}craft`, Array.from({ length: 20 }, (_, i) => `operation-${i}`))).flat();
  const names = 'app0craft app1craft app2craft app3craft app4craft app5craft app6craft app7craft app8craft app9craft app10craft app11craft';
  const r = routeTools({ ...base, tools: [...builtin, ...many], text: names, used: ['ext-app11craft-operation-3'], forced: 'ext-app0craft-operation-1' });
  assert.ok(r.send.length <= MAX_TOOLS, `${r.send.length} tools sent`);
  assert.ok(r.send.includes('ext-app11craft-operation-3') && r.send.includes('ext-app0craft-operation-1'), 'tools used before and the forced tool stay');
  for (const d of builtin.filter((b) => !b.name.startsWith('cloud-'))) assert.ok(r.send.includes(d.name), `${d.name} stays`);
  assert.equal(r.send.length + r.hidden.length, builtin.length + many.length, 'nothing is lost: what is not sent is hidden');
  assert.ok(r.hidden.some((t) => t.source === 'external'), 'some Craft tools moved to the hidden list');
});

test('A keyword of one tool brings that tool only', () => {
  const r = routeTools({ ...base, text: 'show me the histogram of this' });
  assert.deepEqual(r.send.filter((n) => n.startsWith('ext-')), ['ext-photocraft-histogram']);
  const cropping = routeTools({ ...base, text: 'we are cropping the border' });
  assert.ok(cropping.send.includes('ext-photocraft-crop-image'), 'word forms count');
  assert.ok(!routeTools({ ...base, text: 'open the file and list all' }).send.some((n) => n.startsWith('ext-')), 'generic words do not');
});

test('Cloud tools come with cloud words, tools used or sent before stay, a / command tool is there', () => {
  assert.ok(routeTools({ ...base, text: 'copy this to my Google Drive' }).send.includes('cloud-export'));
  assert.ok(routeTools({ ...base, text: 'thanks', used: ['ext-cadcraft-extrude'] }).send.includes('ext-cadcraft-extrude'));
  assert.ok(routeTools({ ...base, text: 'thanks', sent: ['ext-photocraft-blur'] }).send.includes('ext-photocraft-blur'));
  assert.ok(routeTools({ ...base, text: 'x', forced: 'ext-photocraft-rotate' }).send.includes('ext-photocraft-rotate'));
});

test('The result is sorted and identical for the same input (a stable prompt prefix)', () => {
  const a = routeTools({ ...base, text: 'crop the image' });
  const b = routeTools({ ...base, text: 'crop the image' });
  assert.deepEqual(a.send, b.send);
  assert.deepEqual(a.send, [...a.send].sort());
});

test('Without connected apps nothing is held back except cloud, and the saving is real with many tools', () => {
  const plain = routeTools({ ...base, tools: builtin, text: 'hello' });
  assert.deepEqual(plain.hidden.map((h) => h.name).sort(), ['cloud-export', 'cloud-import', 'cloud-list']);
  const many = [...builtin, ...ext('photocraft', Array.from({ length: 40 }, (_, i) => `op-${i}`)), ...ext('filmcraft', Array.from({ length: 40 }, (_, i) => `clip-${i}`))];
  const r = routeTools({ ...base, tools: many, text: 'hello' });
  const hiddenTokens = tokensOf(JSON.stringify(r.hidden).length);
  assert.ok(hiddenTokens > 5000, `${hiddenTokens} tokens held back`);
});

test('find-tools: ranks by name and app, answers with the tools it loaded', () => {
  const hidden = routeTools({ ...base, text: 'hello' }).hidden;
  const crop = findTools('crop image', hidden);
  assert.equal(crop[0]!.name, 'ext-photocraft-crop-image');
  assert.ok(findTools('photocraft', hidden).length === photo.length);
  assert.equal(findTools('nothing like this xyz', hidden).length, 0);
  assert.equal(findTools('', hidden).length, 0);
  assert.ok(findTools('cad', hidden).every((t) => groupOf(t.name) === 'cadcraft' || /cad/.test(t.description.toLowerCase())));
  const txt = foundText('crop', crop.slice(0, 2));
  assert.match(txt, /Loaded 2 tool/);
  assert.match(foundText('zzz', []), /No tool matches/);
  const spec = findToolsSpec(hidden);
  assert.equal(spec.name, FIND_TOOLS);
  assert.match(spec.description, /photocraft/);
  assert.match(spec.description, /cloud/);
});

test('Schemas of foreign tools lose titles, examples and long descriptions', () => {
  const schema = { $schema: 'x', title: 'T', type: 'object', properties: { path: { type: 'string', title: 'Path', description: 'x'.repeat(400), examples: ['a'] }, n: { type: 'number', description: 'short' } }, required: ['path'] };
  const out = compactSchema(schema, 100) as typeof schema;
  assert.ok(!('$schema' in out) && !('title' in out));
  assert.ok(out.properties.path.description.length <= 100);
  assert.ok(!('examples' in out.properties.path));
  assert.equal(out.properties.n.description, 'short');
  assert.deepEqual(out.required, ['path']);
  const spec = compactSpec({ name: 'a', description: 'd'.repeat(900), parameters: schema });
  assert.ok(spec.description.length <= 300);
  assert.ok(JSON.stringify(spec).length < JSON.stringify({ name: 'a', description: 'd'.repeat(900), parameters: schema }).length / 2);
});

// ---------------------------------------------------------------- history

const big = (n: number) => 'row;'.repeat(n);
function history(): ChatTurn[] {
  return [
    { role: 'user', content: 'Sum @a.xlsx\n\n<context>\n<entry type="file" ref="@a.xlsx" path="/a.xlsx">\n' + big(2000) + '\n</entry>\n</context>\n\n<session>\nOpen panels: wordcraft.\n</session>', images: [{ mime: 'image/png', data: 'AAAA' }] },
    { role: 'assistant', text: '', toolCalls: [{ id: '1', name: 'read-sheet', args: {} }] },
    { role: 'tool', results: [{ id: '1', name: 'read-sheet', content: big(5000), isError: false }] },
    { role: 'assistant', text: 'The total is 42.', toolCalls: [] },
    { role: 'user', content: 'And the second quarter?\n\n<session>\nOpen panels: gridcraft.\n</session>' },
    { role: 'assistant', text: '', toolCalls: [{ id: '2', name: 'read-sheet', args: {} }] },
    { role: 'tool', results: [{ id: '2', name: 'read-sheet', content: big(5000), isError: false }] },
  ];
}

test('Earlier results, attachments, session blocks and images shrink; the latest question stays whole', () => {
  const turns = history();
  const before = JSON.stringify(turns).length;
  const stats = compactTurns(turns);
  assert.ok(stats.chars > 15000);
  assert.equal(stats.media, 1);
  const first = turns[0] as Extract<ChatTurn, { role: 'user' }>;
  assert.ok(!first.content.includes('<session>'));
  assert.ok(first.content.includes('left out; mention the file again'));
  assert.ok(first.content.includes('Sum @a.xlsx'));
  assert.equal(first.images, undefined);
  assert.match(first.content, /image was attached/);
  const oldResult = (turns[2] as Extract<ChatTurn, { role: 'tool' }>).results[0]!.content;
  assert.ok(oldResult.length < 1700 && oldResult.includes('call read-sheet again'));
  const last = (turns[6] as Extract<ChatTurn, { role: 'tool' }>).results[0]!.content;
  assert.equal(last.length, big(5000).length, 'the latest exchange is untouched');
  assert.ok((turns[4] as Extract<ChatTurn, { role: 'user' }>).content.includes('<session>'));
  assert.ok(JSON.stringify(turns).length < before * 0.6);
});

test('Shrinking twice changes nothing more, and a short history is left alone', () => {
  const turns = history();
  compactTurns(turns);
  const once = JSON.stringify(turns);
  const again = compactTurns(turns);
  assert.equal(JSON.stringify(turns), once);
  assert.equal(again.chars, 0);
  const small: ChatTurn[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', text: 'hello', toolCalls: [] }];
  assert.equal(compactTurns(small).chars, 0);
});

test('The number of whole questions can be raised', () => {
  const turns = history();
  const stats = compactTurns(turns, { keepRecent: 2 });
  assert.equal(stats.chars, 0, 'both questions stay whole');
});
