// A dropdown that can still take free text: the Model and Base URL fields of Settings > AI models. A select with the suggestions (and,
// after "Test connection", the models the endpoint reports) and a last option, "Other ...", that shows a text field. `value` reads what
// is chosen or typed. See src/chat/model-choices.ts for what is offered.

import { h } from '../../app/util.js';
import { t } from '../../app/i18n.js';
import { OTHER, mergeChoices, type Choice } from '../../chat/model-choices.js';

export interface ChoiceField {
  el: HTMLElement;
  value: string;
  /** The names the endpoint reported: they join the options (the current choice stays). */
  setLive(list: string[]): void;
}

export function choiceField(opts: { value: string; choices: Choice[]; otherLabel: string; placeholder: string; label: string }): ChoiceField {
  let live: string[] = [];
  const select = h<'select'>('select.input.mono', { 'aria-label': opts.label });
  const text = h<'input'>('input.input.mono', { placeholder: opts.placeholder, autocomplete: 'off', spellcheck: 'false', 'aria-label': opts.label, hidden: true });
  const el = h('div.sp-choice', select, text);
  const current = () => (select.value === OTHER ? text.value.trim() : select.value);

  function fill(value: string): void {
    const list = mergeChoices(value, opts.choices, live);
    select.replaceChildren(...list.map((c) => h('option', { value: c.value }, c.label)), h('option', { value: OTHER }, opts.otherLabel));
    // nothing saved and nothing suggested: start with the text field
    select.value = value && list.some((c) => c.value === value) ? value : list[0]?.value ?? OTHER;
    if (select.value === OTHER) text.value = value;
    text.hidden = select.value !== OTHER;
  }
  select.onchange = () => {
    text.hidden = select.value !== OTHER;
    if (!text.hidden) text.focus();
  };
  fill(opts.value);

  return {
    el,
    get value() {
      return current();
    },
    set value(v: string) {
      fill(v);
    },
    setLive(list) {
      live = list;
      fill(current() || opts.value);
    },
  };
}

export const otherModel = () => t('Other model ...');
export const otherAddress = () => t('Other address ...');
