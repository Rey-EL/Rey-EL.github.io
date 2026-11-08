/**
 * i18n/index.js — string-table engine (WP12).
 *
 * Every user-facing string lives in a table (en.js is the Phase 1 source; es.js is the
 * Phase 2 Spanish inventory with the same keys). Each entry carries:
 *   text — the string, with {name} placeholders
 *   loc  — location identifier (where it renders)
 *   ctx  — context note for translators
 *
 * t(key, params) returns a `Tr` object, not a bare string. The DOM helper only accepts
 * Tr or raw() data for text, which is how "no hard-coded string" is enforced and tested.
 *
 * Placeholder values are inserted as plain text (the whole result is later set through
 * textContent), so user words inside a translated sentence can never become markup.
 *
 * Language selection is stored on the device only (localStorage 'vbys.prefs').
 * Phase 1 renders English only: Spanish values are empty in the inventory by design
 * (no fabricated or machine-filled translation, ACCEPTANCE-GATES §12), so the engine
 * refuses to switch to a language whose table is not complete.
 */
import { EN } from './en.js';
import { ES } from './es.js';

export const TABLES = { en: EN, es: ES };
let current = 'en';

/** Records every key rendered, for the automated key-coverage report. */
export const usage = new Set();

export class Tr {
  constructor(key, text) { this.key = key; this.text = text; }
  toString() { return this.text; }
}
export const isTr = (v) => v instanceof Tr;

/** True only when every key has a non-empty value in the given language. */
export function isComplete(lang) {
  const table = TABLES[lang];
  if (!table) return false;
  return Object.keys(EN).every((k) => table[k] && typeof table[k].text === 'string' && table[k].text.length > 0);
}

/** Phase 1: only complete tables may be selected. Spanish is not (Phase 2 scope). */
export function setLanguage(lang) {
  if (!isComplete(lang)) return false;
  current = lang;
  return true;
}
export const getLanguage = () => current;

export function t(key, params = {}) {
  const entry = TABLES[current][key];
  if (!entry) throw new Error(`Missing string key: ${key}`);
  usage.add(key);
  const text = entry.text.replace(/\{(\w+)\}/g, (m, name) => {
    if (!(name in params)) throw new Error(`Missing param {${name}} for ${key}`);
    const v = params[name];
    return isTr(v) ? v.text : String(v);
  });
  return new Tr(key, text);
}

/** Locale-aware date formatting; the compared value (a timestamp) is never changed. */
export function formatDate(epochSeconds) {
  const d = new Date(epochSeconds * 1000);
  return new Intl.DateTimeFormat(current === 'es' ? 'es' : 'en-US', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC',
  }).format(d) + ' UTC';
}
