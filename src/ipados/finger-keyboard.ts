// A finger tap must not open the on-screen keyboard while the Apple Pencil is the writing tool.
//
// The pencil writes with Scribble (handwriting becomes text) or draws; the finger pans, zooms and taps
// controls, like in GoodNotes. When a finger taps a text field the field still gets the focus (caret, hardware
// keyboard and Scribble keep working), but the field is switched to inputmode="none" for that focus, so
// Safari does not raise the keyboard. The attribute is put back when the field loses the focus. The
// keyboard button of the chat composer calls openKeyboard() to bring the keyboard up on purpose.
//
// The decision (when to block) is injected with setKeyboardPolicy(), the module itself only knows how.

let policy: () => boolean = () => false;
/** Returns true while a finger tap must not raise the keyboard. */
export function setKeyboardPolicy(fn: () => boolean): void {
  policy = fn;
}
export const keyboardBlocked = (): boolean => policy();

const saved = new WeakMap<Element, string | null>();

const TEXT_TYPES = new Set(['', 'text', 'search', 'url', 'email', 'tel', 'password', 'number']);

/** A field that takes typed text (and so raises the keyboard). */
export function isTextEntry(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') {
    const t = el as HTMLTextAreaElement;
    return !t.readOnly && !t.disabled;
  }
  if (tag === 'INPUT') {
    const i = el as HTMLInputElement;
    return !i.readOnly && !i.disabled && TEXT_TYPES.has((i.getAttribute('type') || '').toLowerCase());
  }
  return (el as HTMLElement).isContentEditable === true;
}

function entryOf(target: EventTarget | null): HTMLElement | null {
  const el = target as Element | null;
  if (!el || !el.closest) return null;
  const direct = el.closest('input,textarea,[contenteditable]') as Element | null;
  if (direct && isTextEntry(direct)) return direct as HTMLElement;
  const label = el.closest('label') as HTMLLabelElement | null;
  const ctl = label?.control || null;
  return ctl && isTextEntry(ctl) ? ctl : null;
}

function suppress(el: HTMLElement): void {
  if (!saved.has(el)) saved.set(el, el.getAttribute('inputmode'));
  el.setAttribute('inputmode', 'none');
}
function restore(el: Element): void {
  if (!saved.has(el)) return;
  const v = saved.get(el);
  saved.delete(el);
  if (v === null || v === undefined) el.removeAttribute('inputmode');
  else el.setAttribute('inputmode', v);
}

/** Brings the on-screen keyboard up for a field on purpose (the keyboard button). */
export function openKeyboard(el: HTMLElement): void {
  restore(el);
  const active = el.ownerDocument.activeElement === el;
  if (active) el.blur();
  el.focus({ preventScroll: true });
}

/** Installs the guard on a document (the workspace, or the document of an app frame). Returns the remover. */
export function installFingerKeyboardGuard(doc: Document): () => void {
  let lastKind: string = '';
  let lastAt = 0;
  const down = (e: Event) => {
    const pe = e as PointerEvent;
    lastKind = pe.pointerType;
    lastAt = Date.now();
    const field = entryOf(pe.target);
    if (!field) return;
    // Before the focus happens: the first moment the attribute still counts
    // Anything else (pencil, mouse, a finger when the rule is off) leaves the field as the page made it
    if (pe.pointerType === 'touch' && policy()) suppress(field);
    else restore(field);
  };
  const focusIn = (e: Event) => {
    const field = entryOf(e.target);
    if (!field || !policy()) return;
    const tap = Number(doc.documentElement.dataset.ocFingerTap || 0);
    const now = Date.now();
    const finger = (lastKind === 'touch' && now - lastAt < 2500) || (now - tap < 1500 && lastKind !== 'pen');
    if (finger) suppress(field);
  };
  const focusOut = (e: Event) => {
    const field = entryOf(e.target);
    if (field) restore(field);
  };
  doc.addEventListener('pointerdown', down, { capture: true, passive: true });
  doc.addEventListener('focusin', focusIn, true);
  doc.addEventListener('focusout', focusOut, true);
  return () => {
    doc.removeEventListener('pointerdown', down, true);
    doc.removeEventListener('focusin', focusIn, true);
    doc.removeEventListener('focusout', focusOut, true);
  };
}
