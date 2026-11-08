/**
 * state.js — device-local run state, saved cards, and preferences (WP3).
 *
 * Data story: BUILD-PLAN §4. Everything here lives in the browser's localStorage under
 * the app's own origin, and nowhere else. NO-STORAGE RULE (server side): nothing in this
 * module ever performs a network request; the only transmission of an address or hash
 * in the whole app is the transient proxy lookup in proxy-client.js [Plan §4.2].
 *
 * Keys (all app-controlled, all cleared by the matching control):
 *   vbys.run    the current run, saved on every change so the run can be resumed
 *               (entry path, intention, answers, captured values, lookup result)
 *   vbys.cards  explicitly saved record cards (user pressed "Save on this device")
 *   vbys.prefs  language and display preferences — survive "Clear this check" [Plan §4.3]
 *
 * "Clear this check" removes vbys.run; "Clear saved cards" removes vbys.cards. The
 * service worker never caches user data (sw.js), so nothing can be resurrected from a
 * cache after clearing [Gate V-06, P-06].
 *
 * The storage backend is injectable so tests can inspect exactly what was written.
 */
const KEYS = Object.freeze({ run: 'vbys.run', cards: 'vbys.cards', prefs: 'vbys.prefs' });
export const STORAGE_KEYS = KEYS;

let store = typeof localStorage !== 'undefined' ? localStorage : null;
export function setStorage(s) { store = s; }

// BigInt is not JSON; amounts are stored as strings with a marker.
const replacer = (k, v) => (typeof v === 'bigint' ? { $big: v.toString() } : v);
const reviver = (k, v) => (v && typeof v === 'object' && '$big' in v ? BigInt(v.$big) : v);

function read(key, fallback) {
  try {
    const s = store && store.getItem(key);
    return s ? JSON.parse(s, reviver) : fallback;
  } catch { return fallback; } // a corrupted entry is treated as absent, never fatal
}
function write(key, value) {
  try { store && store.setItem(key, JSON.stringify(value, replacer)); return true; }
  catch { return false; } // storage full or disabled: the run continues in memory
}

export function newRun(entryPath) {
  return {
    v: 1,
    startedAt: Date.now(),
    entryPath,                     // 1..4 [Plan WP4]
    alreadySent: entryPath === 4,  // already-sent path [Plan WP4]
    intent: { asset: null, amount: '' },
    c1: { normalChannel: null, contactMatch: null, flags: [], noFlags: false, who: '', channel: null },
    c2: { exact: '', value: '', method: null, comparison: null, readFailed: false, qrKind: null, qrExtra: '' },
    c3: { networkAnswer: null, otherWords: '' },
    c4: { history: null, answer: null, testHash: '', testAmount: '' },
    // No stored record subject: app.js recordSubject() derives it from c5.hash vs
    // c4.testHash on every render (C4-P11, Gate C5-03). A `subject` left in an older
    // saved run is ignored.
    c5: { network: null, hash: '', sendingAddress: '', lookup: null },
    screen: 'check1',
  };
}

export const loadRun = () => read(KEYS.run, null);
export const saveRun = (run) => write(KEYS.run, run);
export function clearRun() { try { store && store.removeItem(KEYS.run); } catch { /* ignore */ } }

export const loadCards = () => read(KEYS.cards, []);
export function saveCard(card) { const cards = loadCards(); cards.unshift(card); return write(KEYS.cards, cards.slice(0, 50)); }
export function clearCards() { try { store && store.removeItem(KEYS.cards); } catch { /* ignore */ } }

export const DEFAULT_PREFS = Object.freeze({ lang: 'en', textSize: 'normal' });
export const loadPrefs = () => ({ ...DEFAULT_PREFS, ...read(KEYS.prefs, {}) });
export const savePrefs = (p) => write(KEYS.prefs, { lang: p.lang, textSize: p.textSize });
