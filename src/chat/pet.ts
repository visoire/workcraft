// Blip in the chat: a small companion in the header of the chat and a larger one on the welcome screen.
// It follows what the AI does (thinking, reading, writing, done, error, asleep) and never gets in the way:
// it sits in its own spot, takes no space from the messages, honours "reduce motion" and can be switched off
// in Settings (Chat companion).

import { createBlip, type BlipAccessory, type BlipInstance, type BlipState, type BlipTheme } from './blip.js';
import { petStateFor, type PetSnapshot } from './pet-state.js';

export interface ChatPet {
  el: HTMLElement;
  /** Move to the pose that fits the snapshot (does nothing while a reaction plays) */
  update(s: PetSnapshot): void;
  /** A short thing to say in a speech bubble */
  say(text: string, ms?: number): void;
  /** A one-off reaction (wave, happy), then back to the current pose */
  react(state: BlipState, ms?: number): void;
  /** Dark or light surface (the kit draws a lighter outline on dark) */
  surface(dark: boolean): void;
  /** Color and accessory (Settings, Chat companion) */
  look(theme: BlipTheme, accessory: BlipAccessory): void;
}

export function createPet(opt: { size: number; interactive?: boolean; label: string; state?: BlipState; theme?: BlipTheme; accessory?: BlipAccessory }): ChatPet {
  const blip: BlipInstance = createBlip({ size: opt.size, theme: opt.theme || 'blue', accessory: opt.accessory || '', state: opt.state || 'idle', interactive: opt.interactive ?? true, label: opt.label });
  const el = document.createElement('div');
  el.className = 'chat-pet';
  el.append(blip.el);
  let last: BlipState = blip.getState();
  return {
    el,
    update(s) {
      const next = petStateFor(s);
      if (next === last) return;
      last = next;
      blip.setState(next);
    },
    say: (text, ms = 2600) => void blip.say(text, ms),
    react: (state, ms = 2400) => void blip.trigger(state, ms),
    surface(dark) {
      blip.el.dataset.surface = dark ? 'dark' : 'light';
    },
    look(theme, accessory) {
      blip.setTheme(theme);
      blip.setAccessory(accessory);
    },
  };
}
