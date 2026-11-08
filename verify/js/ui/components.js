/**
 * components.js — reusable UI pieces (WP1 screen pattern, WP11 stop scripts and verdict
 * presentation).
 *
 * WP1 screen pattern: every check screen is built from the four Desk sections in order —
 * the claim, the evidence, the record, the decision [Plan WP1] [Spec §4].
 *
 * Status is always conveyed by a text heading AND a symbol, never by color alone
 * [Plan WP1] [ACCEPTANCE-GATES §15]: ✓ Confirmed · ! Stop and verify · ? Could not be completed.
 *
 * Stop-script component (WP11): the three spec scripts verbatim, as one reusable,
 * localized component. It appears on every FLAGGED check and every MISMATCH verdict
 * [Gates V-01, V-02] — including a declined test (CHECK4-RULE C4-P8, frozen default:
 * all three scripts). Each script can be shown full screen to read aloud or show,
 * copied, or shared — only on the user's explicit tap. Nothing is ever sent
 * automatically.
 */
import { h, raw } from './dom.js';
import { t } from '../i18n/index.js';

/** The claim / evidence / record / decision pattern. Each argument is a list of nodes. */
export function deskScreen({ id, titleKey, stepKey, claim, evidence, record, decision }) {
  return h('section', { class: 'screen', 'data-screen': id, 'aria-labelledby': `${id}-title` },
    stepKey ? h('p', { class: 'step' }, t(stepKey)) : null,
    h('h1', { id: `${id}-title`, tabindex: '-1' }, t(titleKey)),
    part('claim', 'pattern.claim', claim),
    part('evidence', 'pattern.evidence', evidence),
    part('record', 'pattern.record', record),
    part('decision', 'pattern.decision', decision),
  );
}
function part(kind, labelKey, children) {
  return h('div', { class: `part part-${kind}` }, h('h2', { class: 'part-label' }, t(labelKey)), ...(children || []));
}

const STATUS_VIEW = {
  CONFIRMED: { symbol: '✓', key: 'status.confirmed', cls: 'ok' },
  FLAGGED: { symbol: '!', key: 'status.flagged', cls: 'stop' },
  INCOMPLETE: { symbol: '?', key: 'status.incomplete', cls: 'incomplete' },
};

/** Status block: symbol + heading text (+ optional override heading, e.g. "Does not apply"). */
export function statusBlock(status, { headingKey, items = [], itemPrefix } = {}) {
  const v = STATUS_VIEW[status];
  return h('div', { class: `status status-${v.cls}`, role: 'status', 'aria-live': 'polite', 'data-status': status },
    h('p', { class: 'status-heading' },
      h('span', { class: 'status-symbol', 'aria-hidden': 'true' }, raw(v.symbol)),
      t(headingKey || v.key)),
    items.length ? h('ul', { class: 'status-items' }, items.map((it) => h('li', {}, t(`${itemPrefix}.${it.code || it}`, it.params || {})))) : null,
  );
}

export const SCRIPT_IDS = Object.freeze(['pressure', 'teller', 'family']);

/** WP11 — the stop-script component. `ctx.showScript(id)` opens the full-screen view. */
export function stopScripts(ctx, { context = 'check' } = {}) {
  return h('aside', { class: 'stop-scripts', 'aria-labelledby': `stop-${context}-title`, 'data-key': 'stop-scripts' },
    h('h3', { id: `stop-${context}-title` }, t('stop.title')),
    h('p', {}, t('stop.intro')),
    ...SCRIPT_IDS.map((id) => h('div', { class: 'script' },
      h('p', { class: 'script-to' }, t(`stop.${id}.to`)),
      h('blockquote', { class: 'script-text' }, t(`stop.${id}.text`)),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => ctx.showScript(id) } }, t('stop.action.show')),
        h('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => ctx.copyText(t(`stop.${id}.text`).text) } }, t('stop.action.copy')),
        h('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => ctx.shareText(t(`stop.${id}.text`).text) } }, t('stop.action.share')),
      ))),
    h('p', { class: 'fineprint' }, t('stop.never_sent')),
  );
}

/** Educational / not-financial-advice frame [Spec §3 rule 2] [Plan §5] [Gate V-03]. */
export function standingFrame() {
  return h('p', { class: 'frame', role: 'note' }, t('frame.educational'));
}

/**
 * Verdict links [Gate V-03]. A link with no target from the content map is rendered as
 * a labelled line stating the target is not yet assigned — never as a guessed or
 * placeholder URL (OPEN-QUESTIONS item 4; content-map.js stop item).
 */
export function verdictLinkList(links) {
  return h('ul', { class: 'links', 'data-key': 'verdict-links' }, links.map((l) => h('li', {},
    l.url
      ? h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, t(l.labelKey))
      : h('span', { class: 'link-unassigned' }, t(l.labelKey), raw(' — '), t('links.unassigned')))));
}

/** A labelled value shown exactly as captured (addresses, hashes, user words). */
export function valueRow(labelKey, value, cls = 'mono') {
  return h('div', { class: 'value-row' }, h('span', { class: 'value-label' }, t(labelKey)), h('span', { class: `value ${cls}` }, raw(value)));
}

export function button(labelKey, onClick, { cls = 'btn-primary', params, disabled } = {}) {
  return h('button', { type: 'button', class: `btn ${cls}`, disabled: disabled || false, on: { click: onClick } }, t(labelKey, params));
}

/** Radio group with a visible legend; returns a fieldset. */
export function choiceGroup({ name, legendKey, options, value, onChange, legendParams }) {
  return h('fieldset', { class: 'choices' },
    h('legend', {}, t(legendKey, legendParams)),
    options.map((o) => {
      const id = `${name}-${o.value}`;
      return h('div', { class: 'choice' },
        h('input', { type: 'radio', id, name, value: o.value, checked: value === o.value, on: { change: () => onChange(o.value) } }),
        h('label', { for: id }, t(o.labelKey, o.params)));
    }));
}

export function checkboxGroup({ name, legendKey, options, values, onToggle }) {
  return h('fieldset', { class: 'choices' },
    h('legend', {}, t(legendKey)),
    options.map((o) => {
      const id = `${name}-${o.value}`;
      return h('div', { class: 'choice' },
        h('input', { type: 'checkbox', id, name, value: o.value, checked: values.includes(o.value), on: { change: (e) => onToggle(o.value, e.target.checked) } }),
        h('label', { for: id }, t(o.labelKey)));
    }));
}

export function textField({ id, labelKey, value, onInput, mono = false, helpKey, inputmode, maxlength = 200 }) {
  return h('div', { class: 'field' },
    h('label', { for: id }, t(labelKey)),
    helpKey ? h('p', { class: 'help', id: `${id}-help` }, t(helpKey)) : null,
    h('input', {
      id, type: 'text', class: mono ? 'mono' : '', value: raw(value || ''), autocomplete: 'off', autocapitalize: 'off',
      spellcheck: 'false', inputmode, maxlength, 'aria-describedby': helpKey ? `${id}-help` : undefined,
      on: { change: (e) => onInput(e.target.value) },
    }));
}
