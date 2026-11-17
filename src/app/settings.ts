// Interface settings (per browser). AI keys do not live here but in the backend.
import './legacy.js';
import { bus } from './bus.js';
import { readTheme } from './theme-store.js';

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  renderer: 'auto' | 'webgl';
  appDownloads: 'project' | 'both';
  sounds: boolean;
  autoOpenPanels: boolean;
  /** Minutes after which hidden apps are unloaded. 0 = never (the state is kept). */
  autoUnloadMinutes: number;
  chatProvider: string;
  /** Status bar at the bottom. Off by default: the same details are on the Status page in the settings. */
  statusbar: boolean;
  /** Footer line under each panel (file status, renderer, start time). Off by default. */
  panelFooters: boolean;
  /** Focus mode: hides the top bar and the tool rail, only the panels stay. */
  focusMode: boolean;
  /** Side of the AI chat sidebar. The project tree takes the other side of the chat. */
  chatSide: 'right' | 'left';
  /** Thinking effort per provider id from the reasoning bar ('auto': the provider default or preset) */
  effort: Record<string, 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max'>;
  /** Exact counts from Claude and Gemini (count_tokens, countTokens) while typing: sends the draft */
  remoteCount: boolean;
  /** Chat mode: one agent, or Team Mode (a Team Leader with parallel specialist sub-agents) */
  chatMode: 'single' | 'team';
  /** Approvals of the chat: manual (the AI asks before commands and signing, a failed step waits for you) or auto (full access) */
  approvalMode: 'manual' | 'auto';
  /** Full access was explained and confirmed once, so switching it on again does not ask again */
  autoAck: boolean;
  /** Tool rounds before the agent stops to ask to continue. 0 = off / no limit. */
  agentRounds: number;
  /** Memory governor (src/ipados/memory.ts): frees hidden, saved apps when memory is high or the page is slow. 'auto' = on (on every device; it used to be iPads only). */
  memoryGovernor: 'auto' | 'on' | 'off';
  /** What the governor does when it must free something: auto = free hidden, saved apps by itself; ask = offer them in a notice; warn = notices only. */
  memoryAction: 'auto' | 'ask' | 'warn';
  /** Budget in MB for the memory governor. 0 = automatic. */
  memoryBudgetMb: number;
  /** Finger and keyboard: auto = a finger tap raises the on-screen keyboard until the Apple Pencil was used (then the pencil writes), never, always */
  fingerTyping: 'auto' | 'never' | 'always';
  /** The pencil's barrel button (Apple Pencil Pro squeeze, where the browser reports it): eraser while held, toggle pen and eraser, or off */
  penBarrel: 'eraser' | 'toggle' | 'off';
  /** A scribble over ink with the pencil deletes it (PdfCraft pencil view) */
  penScratch: boolean;
  /** Touch keys (src/ipados/touch-keys.ts): a bar of shortcut buttons in the apps that need a keyboard (FilmCraft, ProCraft). auto = on a touch screen until a hardware keyboard is used */
  touchKeys: 'auto' | 'on' | 'off';
  /** Hide the top bar (a small handle at the top brings it back). Independent of focus mode. */
  topbarHidden: boolean;
  /** Hide the tool rail on the left (the project tree and the apps stay reachable from the top bar and the keyboard) */
  railHidden: boolean;
  /** Buttons with an icon only (auto: on iPad and in narrow windows) */
  iconsOnly: 'auto' | 'on' | 'off';
  /** The little animated companion (Blip) next to the chat input */
  chatPet: boolean;
  /** Blip's color (the same eight as the pet of WorkCraft AI Chat) */
  chatPetTheme: 'blue' | 'indigo' | 'ice' | 'teal' | 'amber' | 'coral' | 'emerald' | 'mono';
  /** What Blip wears ('' = nothing) */
  chatPetAccessory: '' | 'glasses' | 'headset' | 'crown' | 'coffee' | 'hardhat';
  /** The accent of the chat (send button, active switch, links) follows Blip's color */
  chatPetAccent: boolean;
  /** Voice input (src/chat/voice.ts): auto = Handy (offline) when it is ready, otherwise the browser's recognizer */
  voiceEngine: 'auto' | 'handy' | 'browser';
  /** Language for the browser's recognizer, for example de-DE. Empty: the language of the browser. */
  voiceLang: string;
  /** The ecosystem (workspace) in use: a built-in id of src/ecosystems/catalog.json or a custom one (custom-...) */
  ecosystem: string;
  /** Ecosystems the user made (validated by sanitizeCustom on every read) */
  ecosystemsCustom: import('../ecosystems/catalog.js').Ecosystem[];
  /** The first-run choice was made (or skipped), so the picker does not open again by itself */
  ecosystemChosen: boolean;
  /** Order of the app icons in the tool rail per workspace (drag an icon; src/ecosystems/rail-order.ts) */
  railOrder: Record<string, string[]>;
}

const DEFAULTS: Prefs = { theme: 'system', renderer: 'auto', appDownloads: 'project', sounds: false, autoOpenPanels: true, autoUnloadMinutes: 0, chatProvider: '', statusbar: false, panelFooters: false, focusMode: false, chatSide: 'right', effort: {}, remoteCount: false, chatMode: 'single', approvalMode: 'manual', autoAck: false, agentRounds: 8, memoryGovernor: 'auto', memoryAction: 'auto', memoryBudgetMb: 0, fingerTyping: 'auto', penBarrel: 'eraser', penScratch: true, touchKeys: 'auto', topbarHidden: false, railHidden: false, iconsOnly: 'auto', chatPet: true, chatPetTheme: 'blue', chatPetAccessory: '', chatPetAccent: false, voiceEngine: 'auto', voiceLang: '', ecosystem: 'office', ecosystemsCustom: [], ecosystemChosen: false, railOrder: {} };
const KEY = 'workcraft.prefs';

function load(): Prefs {
  try {
    const p = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs>) };
    // The workspace's own choice (scope 'ide', newest of localStorage and cookie), separate from the website
    p.theme = readTheme('ide') as Prefs['theme'];
    return p;
  } catch {
    return { ...DEFAULTS };
  }
}

const state = load();

export const prefs = {
  get<K extends keyof Prefs>(k: K): Prefs[K] {
    return state[k];
  },
  set<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
    state[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage blocked */
    }
    bus.emit('settings:change', { key: k });
  },
};
