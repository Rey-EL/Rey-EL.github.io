/**
 * record.js — Check 5 record comparison and the final verdict (WP9; shared by WP10).
 *
 * The final verdict is computed from the record comparison ALONE [Plan WP9] [C4-P10]:
 *   MATCH      "The record matches the intention"   — every supplied intention field agrees
 *   MISMATCH   "The record does not match"           — any compared field differs (each line named)
 *   INCOMPLETE "The check could not be completed"    — a required field, the record, or the
 *              connection is missing (each item named; never a blank result)
 * Flagged checks 1–4 do not change this computation; they are carried as visible caution
 * lines on the verdict screen and the record card (C4-P10), so a MATCH is never shown
 * without them.
 *
 * Read the Record (lite) calls exactly the same `compareRecord` with the same normalized
 * record, which is how Gate R-01 (same fixture, same result) is guaranteed by construction
 * and proven in test/checks.test.mjs ("R-01 same fixture through Check 5 and Read the
 * Record ...").
 *
 * Normalized record (produced by the proxy, proxy/normalize.mjs):
 *   { hash, network, asset, from: [addr], to: [{ address, units }], valueUnits (ETH only),
 *     settlement: 'SETTLED' | 'PENDING' | 'FAILED', timestamp (epoch s | null),
 *     contractCall (ETH only), explorerUrl }
 */
import { NETWORKS } from './networks.js';
import { sameAddress } from './address.js';

export const V = Object.freeze({ MATCH: 'MATCH', MISMATCH: 'MISMATCH', INCOMPLETE: 'INCOMPLETE' });

/**
 * OPEN-QUESTIONS item 3 — FROZEN IN WP9 (2026-11-05): the network-specific
 * "not public yet" / "not settled yet" wait and recheck rule.
 * Ground: the observable states of the selected read sources — Esplora returns
 * "not found" for an unknown transaction, and `status.confirmed: false` while it waits
 * for a block; Etherscan's eth_getTransactionByHash returns null for an unknown hash
 * and `blockNumber: null` while it waits — plus each network's published block rhythm
 * (Bitcoin targets one block about every 10 minutes; Ethereum produces a block slot
 * every 12 seconds). The first recheck is one block interval rounded up to a whole
 * minute; the escalation point (copy check, ask the sender through a trusted channel)
 * allows for fee-related delay. The UI strings live under check5.wait.* in en.js.
 */
export const WAIT_RULES = Object.freeze({
  'bitcoin-mainnet': Object.freeze({ recheckMinutes: 10, escalateMinutes: 60 }),
  'ethereum-mainnet': Object.freeze({ recheckMinutes: 1, escalateMinutes: 15 }),
});

/**
 * compareRecord(intent, record)
 * intent: { network, asset, receivingAddress, amountUnits (BigInt|null), sendingAddress,
 *           subject: 'full' | 'test' }
 * For subject 'test' (CHECK4-RULE C4-P11): the amount is compared only if the user entered
 * the test amount; it is never compared against the full intended amount, and the amount
 * is then not a required field.
 * Returns { verdict, lines: [{ field, result: 'match'|'mismatch'|'missing'|'pending', ... }],
 *           mismatched: [field], missing: [field] }
 */
export function compareRecord(intent, record) {
  const lines = [];
  const add = (field, result, extra = {}) => lines.push({ field, result, ...extra });
  const subject = intent.subject === 'test' ? 'test' : 'full';

  // Network and asset.
  if (!intent.network) add('network', 'missing');
  else add('network', intent.network === record.network ? 'match' : 'mismatch');
  if (!intent.asset) add('asset', 'missing');
  else add('asset', intent.asset === record.asset ? 'match' : 'mismatch');

  // Receiving address.
  let receivedUnits = null;
  if (!intent.receivingAddress) add('receivingAddress', 'missing');
  else if (record.network === 'bitcoin-mainnet') {
    const outs = record.to.filter((o) => sameAddress(o.address, intent.receivingAddress));
    if (outs.length) { add('receivingAddress', 'match'); receivedUnits = outs.reduce((s, o) => s + BigInt(o.units), 0n); }
    else add('receivingAddress', 'mismatch');
  } else {
    const ok = record.to.length === 1 && sameAddress(record.to[0].address, intent.receivingAddress);
    add('receivingAddress', ok ? 'match' : 'mismatch');
    receivedUnits = BigInt(record.valueUnits ?? 0);
  }

  // Amount. Bitcoin: the sum paid to the intended address; if that address is absent the
  // amount cannot be compared and is reported as such (the address line is the mismatch).
  const amountRequired = subject === 'full';
  if (intent.amountUnits === null || intent.amountUnits === undefined) {
    if (amountRequired) add('amount', 'missing');
  } else if (receivedUnits === null) {
    add('amount', 'not_comparable');
  } else {
    add('amount', BigInt(intent.amountUnits) === receivedUnits ? 'match' : 'mismatch', { recordUnits: receivedUnits.toString() });
  }

  // Sending address: optional; compared only when supplied.
  if (intent.sendingAddress) {
    const ok = record.from.some((a) => sameAddress(a, intent.sendingAddress));
    add('sendingAddress', ok ? 'match' : 'mismatch');
  }

  // Settlement: the intention is always "arrived and settled". A failed record is a
  // mismatch; a pending record is never called settled [Gate C5-05].
  if (record.settlement === 'SETTLED') add('settlement', 'match');
  else if (record.settlement === 'FAILED') add('settlement', 'mismatch');
  else add('settlement', 'pending');

  const mismatched = lines.filter((l) => l.result === 'mismatch').map((l) => l.field);
  const missing = lines.filter((l) => l.result === 'missing' || l.result === 'pending').map((l) => l.field);
  const verdict = mismatched.length ? V.MISMATCH : missing.length ? V.INCOMPLETE : V.MATCH;
  return { verdict, lines, mismatched, missing, subject };
}

/**
 * finalFromLookup(intent, lookup) — maps every proxy outcome to a final verdict.
 * lookup.kind: RECORD | NOT_FOUND | UNAVAILABLE | UNSUPPORTED_NETWORK | INVALID_HASH | NOT_RUN
 * Nothing but a RECORD can produce MATCH or MISMATCH: the app never guesses a record
 * [Spec §6 graceful failure] [Gates C5-06, C5-08, C5-09, O-04].
 */
export function finalFromLookup(intent, lookup) {
  if (!lookup || lookup.kind === 'NOT_RUN') return { verdict: V.INCOMPLETE, missing: ['record'], lines: [], mismatched: [], cause: 'NOT_RUN' };
  if (lookup.kind === 'RECORD') return { ...compareRecord(intent, lookup.record), record: lookup.record };
  const cause = lookup.kind === 'UNAVAILABLE' ? lookup.cause || 'UPSTREAM' : lookup.kind;
  return { verdict: V.INCOMPLETE, missing: ['record'], lines: [], mismatched: [], cause };
}

export const networkDecimals = (id) => (NETWORKS[id] ? NETWORKS[id].decimals : 0);
