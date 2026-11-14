/**
 * One way to ask for a context menu: a right click, the Apple Pencil's barrel button (src/workspace/pencil.ts sends a
 * contextmenu event for it) or a long press with a finger. Safari on the iPad sends no contextmenu event for a long
 * press on anything but a link or an image, so the finger case is timed here.
 *
 * `onContextAction(el, handler)`: handler(x, y, target) runs once per request; the native menu is suppressed.
 * The tap that ends a long press does not click what is under the finger.
 */

export const LONG_PRESS_MS = 520;
/** A finger that moves farther than this (CSS px) is scrolling or dragging, not pressing */
export const LONG_PRESS_SLOP = 10;

/** Pure: has the finger left the press point? */
export function movedTooFar(x0: number, y0: number, x: number, y: number, slop = LONG_PRESS_SLOP): boolean {
  return Math.hypot(x - x0, y - y0) > slop;
}

export function onContextAction(el: HTMLElement, handler: (x: number, y: number, target: Element) => void, opt: { /** Which targets count (default: all) */ accept?: (target: Element) => boolean } = {}): () => void {
  const accepts = (t: EventTarget | null): t is Element => t instanceof Element && (opt.accept ? opt.accept(t) : true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number; id: number } | null = null;
  /** When a long press last opened the menu: only that one is followed by a duplicate contextmenu event (Android) */
  let lastLongPress = 0;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    start = null;
  };

  const onContextMenu = (e: MouseEvent) => {
    if (!accepts(e.target)) return;
    e.preventDefault();
    if (Date.now() - lastLongPress < 900) return;
    handler(e.clientX, e.clientY, e.target);
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !e.isPrimary || !accepts(e.target)) return;
    cancel();
    const target = e.target;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    timer = setTimeout(() => {
      const s = start;
      cancel();
      if (!s) return;
      lastLongPress = Date.now();
      handler(s.x, s.y, target);
      // the finger comes up on the element: that must not count as a tap
      const swallow = (ev: Event) => {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        done();
      };
      const done = () => {
        removeEventListener('click', swallow, true);
        clearTimeout(t2);
      };
      addEventListener('click', swallow, true);
      const t2 = setTimeout(done, 700);
    }, LONG_PRESS_MS);
  };
  const onMove = (e: PointerEvent) => {
    if (start && e.pointerId === start.id && movedTooFar(start.x, start.y, e.clientX, e.clientY)) cancel();
  };

  el.addEventListener('contextmenu', onContextMenu);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  // iOS would show its own callout (and select text) at the same moment
  el.style.setProperty('-webkit-touch-callout', 'none');
  return () => {
    cancel();
    el.removeEventListener('contextmenu', onContextMenu);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', cancel);
    el.removeEventListener('pointercancel', cancel);
  };
}
