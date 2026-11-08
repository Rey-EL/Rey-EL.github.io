/**
 * checks.js — the verdict logic of Checks 1 to 4, as pure functions (WP5–WP8).
 *
 * Every check returns { status, reason?, items[] } where status is one of the plan's
 * three canonical states [BUILD-PLAN §5]:
 *   CONFIRMED  — "Confirmed"
 *   FLAGGED    — "Stop and verify" (the stop-script component appears on the check, Gate V-02)
 *   INCOMPLETE — "Could not be completed" (the missing item is always named)
 * `items` are machine codes the UI maps to plain-language strings, so the exact differing
 * item, flag, or missing determination is always named [Gates C1-02…C1-08, C2-*, C3-*].
 *
 * Pure functions: same inputs, same output, every time. The UI recomputes all checks
 * from the stored answers on every change (CHECK4-RULE C4-P14), so going back and
 * changing an answer can never leave a stale state behind.
 */
import { assetSupport, ASSET_TO_NETWORK } from './networks.js';

export const S = Object.freeze({ CONFIRMED: 'CONFIRMED', FLAGGED: 'FLAGGED', INCOMPLETE: 'INCOMPLETE' });

// ------------------------------------------------------------------- Check 1 (WP5)
export const RED_FLAGS = Object.freeze(['impersonation', 'urgency', 'secrecy', 'guaranteed_returns']);

/**
 * Check 1 — Confirm the source [Plan WP5].
 * a.normalChannel: 'yes' | 'no' | 'unsure' | null  — did it arrive through the usual channel?
 * a.contactMatch:  'yes' | 'no' | 'unsure' | null  — does the contact match your own record?
 * a.flags: array of RED_FLAGS; a.noFlags: true when the user ticked "none of these".
 * FLAGGED wins over INCOMPLETE: any named risk means stop, even if something is unknown.
 */
export function evaluateCheck1(a = {}) {
  const flagged = [];
  if (a.normalChannel === 'no') flagged.push('CHANNEL_DIFFERS');
  if (a.contactMatch === 'no') flagged.push('CONTACT_DIFFERS');
  for (const f of RED_FLAGS) if ((a.flags || []).includes(f)) flagged.push(`FLAG_${f.toUpperCase()}`);
  if (flagged.length) return { status: S.FLAGGED, items: flagged };

  const missing = [];
  if (a.normalChannel !== 'yes') missing.push('NORMAL_CHANNEL_UNKNOWN');
  if (a.contactMatch !== 'yes') missing.push('CONTACT_NOT_COMPARED');
  if (!a.noFlags) missing.push('RED_FLAGS_UNANSWERED');
  if (missing.length) return { status: S.INCOMPLETE, items: missing };
  return { status: S.CONFIRMED, items: [] };
}

// ------------------------------------------------------------------- Check 2 (WP6)
/**
 * Check 2 — Confirm the destination [Plan WP6] [SUPPORTED-NETWORKS §4.2].
 * input: { asset, classification (from classifyAddress), value, comparison, readFailed, qrKind }
 *   comparison: 'match' | 'different' | 'declined' | null — the user's block-by-block result
 *   readFailed: camera or photo reading could not produce a reliable value
 *   qrKind: 'ETHEREUM_EXTRA' | 'NOT_ADDRESS' when the scanned code was not a plain value
 * Output adds `classification` for Check 3 [Gate C2-04: "Check 3 receives the classification"].
 */
export function evaluateCheck2(input = {}) {
  const { asset, classification: c, value, comparison, readFailed, qrKind } = input;
  const support = assetSupport(asset);
  const out = (status, items, extra = {}) => ({ status, items, classification: c || null, ...extra });

  // Unsupported asset or unknown asset: INCOMPLETE with the limitation named (SN-P15 row 4).
  if (!support.supported) return out(S.INCOMPLETE, [support.reason]);

  if (qrKind === 'ETHEREUM_EXTRA') return out(S.INCOMPLETE, ['QR_EXTRA_INSTRUCTIONS']); // SN-P11
  if (qrKind === 'NOT_ADDRESS') return out(S.INCOMPLETE, ['QR_NOT_ADDRESS']);
  if (readFailed) return out(S.INCOMPLETE, ['READ_UNRELIABLE']); // Gate C2-06: never guess
  if (!value || !c || c.problem === 'EMPTY') return out(S.INCOMPLETE, ['DESTINATION_MISSING']);

  // Invalid or unrecognized format: FLAGGED, problem named in plain words [Gate C2-03].
  if (!c.valid) return out(S.FLAGGED, [c.problem]);

  // Valid, but a recognized form of the OTHER supported network [Gate C2-04].
  const intendedFamily = support.network === 'bitcoin-mainnet' ? 'bitcoin' : 'ethereum';
  if (c.family !== intendedFamily) return out(S.FLAGGED, ['FAMILY_MISMATCH']);

  // The user must compare the grouped blocks with the source [Gates C2-01, C2-02, C2-09].
  if (comparison === 'match') return out(S.CONFIRMED, []);
  if (comparison === 'different') return out(S.FLAGGED, ['CHARACTER_DIFFERENCE']);
  return out(S.INCOMPLETE, ['COMPARISON_MISSING']);
}

// ------------------------------------------------------------------- Check 3 (WP7)
/**
 * Check 3 — Confirm the network [Plan WP7] [SUPPORTED-NETWORKS §2.3, §3.3, §4.2].
 * input: { asset, check2 (result), networkAnswer: 'match' | 'different' | 'unknown' | null }
 * The network question is asked only for network-ambiguous formats (0x…, 1…, 3…).
 * Wrong-network warning text: "A correct address on the wrong network loses the funds."
 */
export function evaluateCheck3(input = {}) {
  const { asset, check2, networkAnswer } = input;
  const support = assetSupport(asset);
  if (!support.supported) return { status: S.INCOMPLETE, items: [support.reason], askNetwork: false };

  const c = check2 && check2.classification;
  // Gate C3-05: Check 2 could not classify the destination -> never CONFIRMED; route back.
  if (!c || !c.valid) return { status: S.INCOMPLETE, items: ['ADDRESS_UNIDENTIFIED'], askNetwork: false, routeBack: true };

  const intendedFamily = support.network === 'bitcoin-mainnet' ? 'bitcoin' : 'ethereum';
  // Gate C3-02: valid address on the other supported network; both networks named.
  if (c.family !== intendedFamily) return { status: S.FLAGGED, items: ['WRONG_NETWORK_FAMILY'], askNetwork: false, warning: true };

  if (!c.ambiguous) return { status: S.CONFIRMED, items: [], askNetwork: false }; // bc1… (SN-P7)

  // Ambiguous format: the user's answer decides [Gates C3-03, C3-04].
  if (networkAnswer === 'match') return { status: S.CONFIRMED, items: [], askNetwork: true };
  if (networkAnswer === 'different') return { status: S.FLAGGED, items: ['TOLD_DIFFERENT_NETWORK'], askNetwork: true, warning: true };
  return { status: S.INCOMPLETE, items: ['REQUESTED_NETWORK_MISSING'], askNetwork: true };
}

// ------------------------------------------------------------------- Check 4 (WP8)
/**
 * CHECK 4 STATE MACHINE — governing/CHECK4-RULE.md §4 (frozen 2026-11-05).
 * Implemented row for row; the first matching row wins. Reason names are C4-P12.
 *
 *  Row 1  already_sent                         -> CONFIRMED  · NOT_APPLICABLE  (heading "Does not apply", C4-P9)
 *  Row 2  any of c1, c2, c3 FLAGGED            -> FLAGGED    · UPSTREAM_FLAGGED (C4-P5)
 *  Row 3  fit = NOT_NEEDED                     -> CONFIRMED  · TEST_NOT_NEEDED
 *  Row 4  fit = RECOMMENDED, answer TEST_SENT  -> CONFIRMED  · TEST_SENT
 *  Row 5  fit = RECOMMENDED, answer TEST_NOT_SENT -> FLAGGED · DECLINED_TEST (C4-P7, frozen)
 *  Row 6  fit = RECOMMENDED, no answer         -> INCOMPLETE · DECISION_MISSING
 *
 * fit (C4-P2, C4-P3, C4-P4): NOT_NEEDED only when entry path 1 AND c1, c2, c3 all
 * CONFIRMED AND history === 'yes'. "not sure", "no", or unanswered count as No at every
 * moment, so fit always has a value. Amount is NOT an input (C4-P1: no threshold).
 *
 * input: { entryPath: 1|2|3|4, alreadySent, c1, c2, c3 (status strings), history, answer }
 *   answer: 'TEST_SENT' | 'TEST_NOT_SENT' | 'ALREADY_SENT_FULL' | null
 * `ALREADY_SENT_FULL` sets already_sent for the run (C4-P6), so it matches row 1.
 */
export function check4Fit({ entryPath, c1, c2, c3, history }) {
  const allConfirmed = c1 === S.CONFIRMED && c2 === S.CONFIRMED && c3 === S.CONFIRMED;
  return entryPath === 1 && allConfirmed && history === 'yes' ? 'NOT_NEEDED' : 'RECOMMENDED';
}

/** C4-P3: the history question is asked only when conditions 1–4 of C4-P2 hold. */
export function check4AsksHistory({ entryPath, alreadySent, c1, c2, c3, answer }) {
  if (alreadySent || entryPath === 4 || answer === 'ALREADY_SENT_FULL') return false;
  return entryPath === 1 && c1 === S.CONFIRMED && c2 === S.CONFIRMED && c3 === S.CONFIRMED;
}

export function evaluateCheck4(input = {}) {
  const { entryPath, c1, c2, c3, history, answer } = input;
  const alreadySent = Boolean(input.alreadySent) || entryPath === 4 || answer === 'ALREADY_SENT_FULL';
  if (alreadySent) return { status: S.CONFIRMED, reason: 'NOT_APPLICABLE', row: 1, items: [] };

  const upstream = [['CHECK_1', c1], ['CHECK_2', c2], ['CHECK_3', c3]].filter(([, s]) => s === S.FLAGGED).map(([n]) => n);
  if (upstream.length) return { status: S.FLAGGED, reason: 'UPSTREAM_FLAGGED', row: 2, items: upstream };

  const fit = check4Fit({ entryPath, c1, c2, c3, history });
  if (fit === 'NOT_NEEDED') return { status: S.CONFIRMED, reason: 'TEST_NOT_NEEDED', row: 3, items: [], fit };
  if (answer === 'TEST_SENT') return { status: S.CONFIRMED, reason: 'TEST_SENT', row: 4, items: [], fit };
  if (answer === 'TEST_NOT_SENT') return { status: S.FLAGGED, reason: 'DECLINED_TEST', row: 5, items: ['DECLINED_TEST'], fit };
  return { status: S.INCOMPLETE, reason: 'DECISION_MISSING', row: 6, items: ['DECISION_MISSING'], fit };
}

/** Network the run intends, from the entry flow asset. Null when outside the table. */
export const intendedNetwork = (asset) => ASSET_TO_NETWORK[asset] || null;
