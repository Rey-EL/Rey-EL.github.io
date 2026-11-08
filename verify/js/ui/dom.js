/**
 * dom.js — the only way the app builds DOM.
 *
 * Purpose: one small element factory that enforces two security and
 * internationalization invariants at the point of rendering:
 *
 *  1. Gate A03 (injection) / WP13 "no unescaped insertion": every piece of text goes into
 *     the page through `textContent` (a Text node). There is no innerHTML, no
 *     insertAdjacentHTML, and no inline event-handler attribute anywhere in the app.
 *     Addresses, hashes, explorer data and user words can therefore never become markup.
 *  2. WP12 "no user-facing string is hard-coded in a component": a text child must be
 *     either a translated string (a `Tr` from i18n `t()`) or a value explicitly wrapped
 *     with `raw()` (user-entered or record data such as an address, a hash, an amount).
 *     A plain JavaScript string passed as text throws. The key-coverage test renders
 *     every screen with this rule live, so a hard-coded string fails the test suite.
 *
 * Attributes: only a fixed allowlist may be set; `on*` names are refused (no inline
 * handlers); `href` accepts only https:// links built from the content map or the
 * explorer link builder, plus blob: for local downloads.
 */
import { Tr, isTr } from '../i18n/index.js';

/** Marks a value as data (not a UI string). Rendered as text, never as markup. */
export class Raw {
  constructor(value) { this.value = String(value); }
  toString() { return this.value; }
}
export const raw = (v) => new Raw(v);

const ALLOWED_ATTRS = new Set([
  'id', 'class', 'type', 'name', 'value', 'for', 'role', 'tabindex', 'href', 'target',
  'rel', 'download', 'disabled', 'checked', 'hidden', 'autocomplete', 'autocapitalize',
  'spellcheck', 'inputmode', 'lang', 'dir', 'src', 'alt', 'width', 'height', 'accept',
  'capture', 'playsinline', 'muted', 'autoplay', 'rows', 'maxlength', 'placeholder',
  'aria-label', 'aria-live', 'aria-describedby', 'aria-labelledby', 'aria-hidden',
  'aria-current', 'aria-pressed', 'aria-expanded', 'aria-invalid', 'aria-atomic',
  'data-status', 'data-key', 'data-screen', 'data-check',
]);

// Attributes whose values are human-readable and must therefore be translated strings.
const TEXT_ATTRS = new Set(['aria-label', 'placeholder', 'alt']);

/** Converts an allowed text value to a plain string, enforcing the Tr/Raw rule. */
function textOf(v, where) {
  if (isTr(v)) return v.text;
  if (v instanceof Raw) return v.value;
  if (typeof v === 'number') return String(v); // numbers carry no language
  throw new Error(`Untranslated text in ${where}: ${JSON.stringify(v)} (WP12: use t() or raw())`);
}

function safeHref(v) {
  // A URL is not language, so a plain string is accepted here; its scheme is still checked.
  const s = v instanceof Raw ? v.value : String(v);
  // Only https links (content map / explorer builder) and local blob: downloads.
  if (/^https:\/\/[^\s]+$/.test(s) || /^blob:/.test(s) || /^#[a-z0-9/-]*$/i.test(s)) return s;
  throw new Error(`Refused href: ${s}`);
}

/**
 * h(tag, attrs, ...children) — create an element.
 * attrs.on = { click: fn, ... } attaches listeners with addEventListener.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') {
      for (const [evt, fn] of Object.entries(v)) el.addEventListener(evt, fn);
      continue;
    }
    if (/^on/i.test(k)) throw new Error(`Inline handler attribute refused: ${k}`);
    if (!ALLOWED_ATTRS.has(k)) throw new Error(`Attribute not allowed: ${k}`);
    if (k === 'href') { el.setAttribute('href', safeHref(v)); continue; }
    if (TEXT_ATTRS.has(k)) { el.setAttribute(k, textOf(v, k)); continue; }
    if (k === 'value' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'OPTION') {
      el.setAttribute(k, String(v)); continue;
    }
    if (k === 'value') { el.value = String(v instanceof Raw ? v.value : v); continue; }
    if (v === true) { el.setAttribute(k, ''); if (k === 'checked') el.checked = true; continue; }
    el.setAttribute(k, String(v instanceof Raw ? v.value : v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    if (c && typeof c === 'object' && 'nodeType' in c) { el.appendChild(c); continue; }
    el.appendChild(document.createTextNode(textOf(c, `<${el.tagName.toLowerCase()}>`)));
  }
}

/** Replace all children of a node. */
export function mount(root, ...children) {
  while (root.firstChild) root.removeChild(root.firstChild);
  append(root, children);
}

export { Tr };
