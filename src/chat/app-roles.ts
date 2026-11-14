// One specialist agent for every app of the catalog (src/ecosystems/catalog.json), generated, never written out per app.
//
// WorkCraft AI (the Rust chat) gives each Craft app its own agent (`<app>-agent`); the workspace had five fixed roles
// (grid, word, deck, pdf, dev) and sent every connected app to the Code & System Specialist. Now every catalog app has
// its own specialist (`@photocraft-agent`, `@oxybrush-agent`, ...). The four office apps keep their historic roles
// (grid, word, deck, pdf: saved teams refer to them) and answer to `@gridcraft-agent` and so on as well.
//
// Two kinds of app, because the AI reaches them in two ways:
//   - an app with a CLI (origin artcraft or community, 19 apps): its MCP server connects when the desktop app is found,
//     and its tools are called `ext-<app>-<tool>`. The specialist gets exactly those tools.
//   - a web-only app (the 25 independent apps): no tool interface. The specialist prepares and exchanges the app's files
//     through the project (read-file, write-file, open-in-app) and says honestly what only the user can do inside the app.
// Pure: no DOM, no network. src/chat/team.ts registers the roles; tests/server/app-roles.test.ts checks them.

import { APPS, OFFICE_IDS, groupKey, type CatalogApp } from '../ecosystems/catalog.js';

/** Role data of one app specialist (the shape team.ts adds to ROLE_DEFS). */
export interface AppRole {
  id: string;
  mention: string;
  name: string;
  short: string;
  appId: string;
  accent: string;
  scope: string;
  prompt: string;
  /** The app's MCP server can connect (a CLI exists); false: the app is reached through project files only */
  cli: boolean;
}

/** The roles the four office apps already have. Their ids stay; the app id and the CLI tools are added to them. */
export const OFFICE_ROLE: Record<string, string> = { wordcraft: 'word', gridcraft: 'grid', deckcraft: 'deck', pdfcraft: 'pdf' };

/** Role id of an app: the historic role for the office apps, the app id for every other one. */
export const roleIdOfApp = (appId: string): string => OFFICE_ROLE[appId] ?? appId;

/** App of a role id (office roles map back to their app), or undefined. */
export const appOfRole = (role: string): CatalogApp | undefined => APPS.find((a) => roleIdOfApp(a.id) === role);

/** Does the app ship a CLI with an MCP server? (Everything but the independent apps, see src/server/craft.ts.) */
export const hasCli = (a: Pick<CatalogApp, 'origin'>): boolean => a.origin !== 'independent';

/** What an app's specialist should know about its domain: one or two sentences, chosen by the kind of app. */
const DOMAIN: [RegExp, string][] = [
  [/photo|raw|image|paint|pixel|sprite|sketch|draw/i, 'Inspect the image (size, layers, mode) before you change it. Prefer non-destructive edits, keep the original, and render or export a preview to check the result.'],
  [/vector|illustrat|layout|interface|figure|ui/i, 'Inspect geometry, frames and styles before you edit. Keep names of layers and frames, export clean SVG, PDF or PNG, and check the render.'],
  [/video|motion|animat|film|screen graphics/i, 'Work with timelines, clips and frame rates exactly as the project defines them. Check duration and resolution before and after, and export a short preview.'],
  [/audio|music|sound|tablature|dj|sync/i, 'Work with sample rate, tempo and key as the project defines them. Never clip or normalize silently; say what you changed and by how much.'],
  [/cad|3d|solid|material|texture|sculpt|cloth|character|globe/i, 'State units and scale before you model. Change one feature at a time, check the result with an inspect or render call, and export in an open format (STEP, OBJ, glTF, PNG) when asked.'],
  [/mail/i, 'Treat mail as private. Read and draft; never send, delete or move a message unless the user asked for exactly that.'],
  [/math|matrix|plot|notebook|note|text|markdown/i, 'Keep the structure of the notes or the notebook. Show formulas and units, and check results by calculating them a second way where you can.'],
  [/reverse|software|binary/i, 'Stay inside clean-room analysis: inspect and document, never run or modify what you analyse.'],
];

const hintFor = (a: CatalogApp) => DOMAIN.find(([re]) => re.test(`${a.kind} ${a.blurb} ${a.name}`))?.[1] ?? 'Inspect before you change, change only what was asked, and check the result.';

const list = (xs: string[], max = 8) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and more` : xs.join(', '));

/** The prompt of one app specialist. */
export function appPrompt(a: CatalogApp): string {
  const group = groupKey(a.id);
  const formats = a.opens.length ? `It opens ${list(a.opens.map((e) => '.' + e))}.` : '';
  const how = hasCli(a)
    ? `Your tools are the ext-${group}-* tools of ${a.name}'s own MCP server. Call them to open, inspect, edit, render and export; if none is listed, ${a.name} is not connected on this computer: say so and stop instead of guessing file contents.`
    : `${a.name} is a web app in a panel and has no tool interface, so you cannot press its buttons. Work through the project files: read what it saved with read-file, prepare input files in its formats with write-file (new files go to ${a.folder}), and open the result with open-in-app so the user can carry on inside ${a.name}. Say plainly which steps only the user can do in the app.`;
  return [`You are the ${a.name} specialist (${a.kind}). ${a.blurb}.`, formats, how, hintFor(a), 'When the task needs another app, say so and name the file the other specialist should take over.'].filter(Boolean).join(' ');
}

/** The role of one catalog app (null for the four office apps: they keep grid, word, deck and pdf). */
export function appRole(a: CatalogApp): AppRole | null {
  if (a.id in OFFICE_ROLE) return null;
  return {
    id: a.id,
    mention: `${a.id}-agent`,
    name: `${a.name} Specialist`,
    short: a.name,
    appId: a.id,
    accent: a.accent,
    scope: `${a.kind}: ${a.blurb}.`,
    prompt: appPrompt(a),
    cli: hasCli(a),
  };
}

/** Every generated role, in catalog order. */
export const APP_ROLES: AppRole[] = APPS.map(appRole).filter((r): r is AppRole => !!r);

/** Ids of the apps whose roles are the historic office roles (kept for the tests and the roster). */
export const OFFICE_APP_IDS = OFFICE_IDS;

/** The group name in `ext-<group>-<tool>` of a tool, or null when the tool is not an external one. */
export const externalGroup = (toolName: string): string | null => /^ext-([a-z0-9]+)-/.exec(toolName)?.[1] ?? null;

/** Extra prompt for the five built-in specialists: what a careful person in that job does. */
export const BUILTIN_PROMPTS: Record<string, string> = {
  grid: 'Read the sheet before you evaluate anything. Keep formulas live (do not paste values over them), name your assumptions in a cell comment or a notes row, and report totals with the cells they come from. Check that totals add up after every write.',
  word: 'Read the document first and keep its headings, styles and numbering. Write plain, specific sentences; no filler. After a rewrite, read the result back and report what changed in a short list.',
  deck: 'One message per slide, a title that states it, at most six lines or one chart per slide. Reuse the layouts and colors of the existing deck. Read the slides back after writing and report the slide numbers you changed.',
  pdf: 'Read the PDF before you act. Extraction first, then verification; redaction and signing only on explicit instruction and only for the exact passages or signer named. Report page numbers for every finding.',
  dev: 'Read the code before you edit it, make the smallest change that does the job, and run the project\'s own check (tests, build or typecheck) when there is one. Never run a destructive command without being asked; report the commands you ran and their result.',
};
