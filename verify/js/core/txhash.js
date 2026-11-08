/**
 * txhash.js — transaction hash validation (WP9, WP10) and QR content rules (WP6).
 *
 * Hash shapes: SUPPORTED-NETWORKS.md §2.4 and §3.4 (SN-P12). The app refuses and
 * explains; it never repairs a prefix or changes case (SN-P18) [Gate C5-07].
 *   bitcoin-mainnet  exactly 64 hex characters, any case, no prefix
 *   ethereum-mainnet lower-case `0x` + 64 hex characters, any case
 *
 * QR content rules: SUPPORTED-NETWORKS.md §5 (SN-P11). QR content is data, never a
 * command or a link to open [Gate A04]. Only the scheme name is case-folded (RFC 3986
 * §3.1); the address part is returned exactly as captured.
 */

/**
 * sameHash(a, b) — do two captured hashes name the same transaction? Surrounding
 * whitespace is ignored and hex is compared case-insensitively. Used ONLY to decide the
 * Check 5 record subject (app.js recordSubject, C4-P11, Gate C5-03); it never changes a
 * stored value (SN-P18).
 */
export const sameHash = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * setRecordHash(target, captured) — the single writer of a record hash (Check 5 run
 * state, or the lite reader's state), used by typing, scan, paste, and the Check 4
 * test-hash hand-off. Keeps the exact captured value next to the value that will be
 * read, so the screen can disclose any trimmed whitespace (SN-P18, Gate C2-07), and
 * drops a lookup made for a previous hash (a record is only ever shown for its hash).
 */
export function setRecordHash(target, captured) {
  const exact = String(captured ?? '');
  target.hashExact = exact;
  target.hash = exact.replace(/^\s+|\s+$/g, '');
  target.lookup = null;
}

export function validateHash(networkId, value) {
  const v = String(value ?? '');
  if (!v.length) return { ok: false, problem: 'HASH_EMPTY' };
  if (networkId === 'bitcoin-mainnet') {
    if (/^0x/i.test(v)) return { ok: false, problem: 'BTC_HASH_HAS_0X' };
    if (/^[0-9a-fA-F]{64}$/.test(v)) return { ok: true };
    return { ok: false, problem: 'BTC_HASH_SHAPE' };
  }
  if (networkId === 'ethereum-mainnet') {
    if (v.startsWith('0X')) return { ok: false, problem: 'ETH_HASH_UPPER_PREFIX' };
    if (/^[0-9a-fA-F]{64}$/.test(v)) return { ok: false, problem: 'ETH_HASH_NO_0X' };
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) return { ok: true };
    return { ok: false, problem: 'ETH_HASH_SHAPE' };
  }
  return { ok: false, problem: 'UNSUPPORTED_NETWORK' };
}

/**
 * parseQr(text) — SN-P11 table.
 * Returns { kind, value?, extra?, rawText }
 *   VALUE        bare value (validated later by address/hash rules)
 *   BITCOIN_URI  address extracted; extra = parameter text shown as "the code also says"
 *   ETHEREUM_URI address extracted (nothing after it)
 *   ETHEREUM_EXTRA  extra payment instructions, not interpreted -> Check 2 INCOMPLETE
 *   NOT_ADDRESS  a link or other text: never opened, never followed
 */
export function parseQr(text) {
  const rawText = String(text ?? '');
  const t = rawText.replace(/^\s+|\s+$/g, '');
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s.exec(t);
  if (!m) {
    // No scheme: a bare value if it is a single token, otherwise not an address.
    if (/^[\x21-\x7e]+$/.test(t)) return { kind: 'VALUE', value: t, rawText };
    return { kind: 'NOT_ADDRESS', rawText };
  }
  const scheme = m[1].toLowerCase();
  const rest = m[2];
  if (scheme === 'bitcoin') {
    const q = rest.indexOf('?');
    const value = q >= 0 ? rest.slice(0, q) : rest;
    const extra = q >= 0 ? rest.slice(q + 1) : '';
    if (!value) return { kind: 'NOT_ADDRESS', rawText };
    return { kind: 'BITCOIN_URI', value, extra, rawText };
  }
  if (scheme === 'ethereum') {
    if (/^0x[0-9a-fA-F]{40}$/.test(rest)) return { kind: 'ETHEREUM_URI', value: rest, rawText };
    return { kind: 'ETHEREUM_EXTRA', rawText };
  }
  return { kind: 'NOT_ADDRESS', rawText };
}

/**
 * Amount parsing for intention fields: a plain decimal string -> integer base units
 * (BigInt), so comparison never uses floating point. Returns null if not a plain
 * non-negative decimal or if it has more decimals than the asset supports.
 */
export function parseAmount(str, decimals) {
  const s = String(str ?? '').replace(/^\s+|\s+$/g, '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] || '';
  if (frac.length > decimals) return null;
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/** Base units -> plain decimal string (no locale grouping; locale formatting is in the UI). */
export function formatUnits(units, decimals) {
  const n = BigInt(units);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  let frac = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}
