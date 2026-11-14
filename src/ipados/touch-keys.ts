// Touch keys: a small bar of shortcut buttons for an app that is worked with the keyboard, on a screen that has none. Pure: the key
// tables, the key events they make and the rule for when the bar shows, tested without a browser (tests/server/touch-keys.test.ts).
//
// Why: a video editor (split, ripple delete, in and out marks) and a painter (brush, eraser, eyedropper, brush size) are driven by
// shortcuts, and an iPad without a Magic Keyboard has none. The apps read keyboard events, so each button sends the same key press
// a hardware keyboard would. The idea and the FilmCraft key table come from the community build "FilmCraft for iPad (unofficial)",
// see SOURCES.md; the ProCraft table is read from ProCraft's own shortcut map (crates/core/src/keys.rs).

export type KeyMod = 'cmd' | 'shift' | 'alt';
/** The key table an app uses: the catalog names it in `traits.keys`. */
export type KeyProfile = 'video' | 'paint';

export interface TouchKey {
  label: string;
  /** a second, quieter word under the label */
  hint?: string;
  /** KeyboardEvent.key */
  key: string;
  /** KeyboardEvent.code */
  code: string;
  mods?: KeyMod[];
  /** hot: a key that removes something (Delete) is drawn warmer */
  kind?: 'hot';
}
export type KeyItem = TouchKey | 'sep';

const cmd: KeyMod[] = ['cmd'];
const cmdShift: KeyMod[] = ['cmd', 'shift'];

/** FilmCraft (video): play, frame steps, split, delete, undo, tools, copy and paste, in and out, timeline zoom. */
const VIDEO: KeyItem[] = [
  { label: 'Play', hint: 'pause', key: ' ', code: 'Space' },
  { label: '◀', hint: 'frame', key: 'ArrowLeft', code: 'ArrowLeft' },
  { label: '▶', hint: 'frame', key: 'ArrowRight', code: 'ArrowRight' },
  'sep',
  { label: 'Split', hint: 'at playhead', key: 'k', code: 'KeyK', mods: cmd },
  { label: 'Delete', hint: 'clip', key: 'Delete', code: 'Delete', kind: 'hot' },
  { label: 'Ripple', hint: 'delete', key: 'Delete', code: 'Delete', mods: ['shift'], kind: 'hot' },
  'sep',
  { label: 'Undo', key: 'z', code: 'KeyZ', mods: cmd },
  { label: 'Redo', key: 'z', code: 'KeyZ', mods: cmdShift },
  'sep',
  { label: 'Select', hint: 'tool', key: 'v', code: 'KeyV' },
  { label: 'Razor', hint: 'tool', key: 'c', code: 'KeyC' },
  { label: 'Copy', key: 'c', code: 'KeyC', mods: cmd },
  { label: 'Paste', key: 'v', code: 'KeyV', mods: cmd },
  'sep',
  { label: 'In', hint: 'mark', key: 'i', code: 'KeyI' },
  { label: 'Out', hint: 'mark', key: 'o', code: 'KeyO' },
  { label: 'Zoom +', hint: 'timeline', key: '=', code: 'Equal' },
  { label: 'Zoom −', hint: 'timeline', key: '-', code: 'Minus' },
];

/** ProCraft (paint): undo and redo, the brush and the eraser, the eyedropper, selection and transform, the panels, brush size. */
const PAINT: KeyItem[] = [
  { label: 'Undo', key: 'z', code: 'KeyZ', mods: cmd },
  { label: 'Redo', key: 'z', code: 'KeyZ', mods: cmdShift },
  'sep',
  { label: 'Brush', key: 'b', code: 'KeyB' },
  { label: 'Eraser', key: 'e', code: 'KeyE' },
  { label: 'Pick', hint: 'color', key: 'm', code: 'KeyM' },
  { label: 'Select', key: 's', code: 'KeyS' },
  { label: 'Transform', key: 'v', code: 'KeyV' },
  'sep',
  { label: 'Size −', hint: 'brush', key: '[', code: 'BracketLeft' },
  { label: 'Size +', hint: 'brush', key: ']', code: 'BracketRight' },
  { label: 'Swap', hint: 'colors', key: 'x', code: 'KeyX' },
  'sep',
  { label: 'Layers', key: 'l', code: 'KeyL' },
  { label: 'Colors', key: 'c', code: 'KeyC' },
  { label: 'Menu', hint: 'quick', key: ' ', code: 'Space' },
  { label: 'Deselect', key: 'd', code: 'KeyD' },
  { label: 'Hide UI', key: '0', code: 'Digit0' },
];

export const PROFILES: Record<KeyProfile, KeyItem[]> = { video: VIDEO, paint: PAINT };

/** The profile of an app (its catalog `traits.keys`), or null: most apps need no bar. */
export function profileOf(keys: string | undefined): KeyItem[] | null {
  return keys && keys in PROFILES ? PROFILES[keys as KeyProfile] : null;
}

/** Apple platforms read the command key as Meta, others as Ctrl. An iPad reports itself as a Mac, so the user agent counts too. */
export const isApple = (platform = '', userAgent = ''): boolean => /Mac|iPhone|iPad|iPod/.test(`${platform} ${userAgent}`);

/** The legacy `keyCode` of a `code`: some engines still read it. Zero for a key without a classic number. */
export function keyCodeOf(code: string): number {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.charCodeAt(0);
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return 48 + Number(digit[1]);
  const fixed: Record<string, number> = { Space: 32, Delete: 46, Backspace: 8, Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Equal: 187, Minus: 189, BracketLeft: 219, BracketRight: 221, Semicolon: 186 };
  return fixed[code] ?? 0;
}

export interface KeyEventInit {
  key: string;
  code: string;
  keyCode: number;
  which: number;
  bubbles: true;
  cancelable: true;
  composed: true;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** The init of the KeyboardEvent a button sends. `shiftHeld` is the Shift latch of the bar: it adds Shift once. */
export function keyInit(k: TouchKey, o: { apple: boolean; shiftHeld?: boolean }): KeyEventInit {
  const mods = new Set(k.mods ?? []);
  if (o.shiftHeld) mods.add('shift');
  const code = keyCodeOf(k.code);
  return {
    key: k.key,
    code: k.code,
    keyCode: code,
    which: code,
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey: mods.has('shift'),
    metaKey: mods.has('cmd') && o.apple,
    ctrlKey: mods.has('cmd') && !o.apple,
    altKey: mods.has('alt'),
  };
}

export type TouchKeysPref = 'auto' | 'on' | 'off';

/**
 * Does the bar show? Never for an app without a key table or when the setting is off. On: always. Auto: on a touch screen, until a
 * hardware keyboard is used (a real key press from the keyboard arrives as a trusted keydown; the bar steps aside and returns after a
 * reload of the page).
 */
export function barShows(o: { pref: TouchKeysPref; hasProfile: boolean; touchUi: boolean; hardwareKeyboard: boolean }): boolean {
  if (!o.hasProfile || o.pref === 'off') return false;
  if (o.pref === 'on') return true;
  return o.touchUi && !o.hardwareKeyboard;
}
