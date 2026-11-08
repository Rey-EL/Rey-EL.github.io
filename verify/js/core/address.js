/**
 * address.js — destination address validation and classification, on the device (WP6).
 *
 * Frozen rules: SUPPORTED-NETWORKS.md §2.2, §2.3, §3.2, §3.3, §5 (SN-P6 to SN-P11, SN-P16,
 * SN-P18). Every outcome returns a `problem` code that the UI maps to a plain-language
 * string; this module never produces user text itself.
 *
 * INVARIANT SN-P18 — the compared value is never altered. The only change made to a
 * captured value is removing surrounding whitespace, and the UI shows the exact value
 * first [Gate C2-07]. No case change, no prefix added or removed, no character repaired.
 *
 * Classification (`kind`):
 *   BITCOIN_MAINNET        valid bc1q / bc1p — identifies Bitcoin directly (SN-P7)
 *   BITCOIN_FORMAT_SHARED  valid 1… / 3… Base58Check — network-ambiguous (SN-P7)
 *   ETHEREUM_FORMAT_SHARED valid 0x + 40 hex — never proves Ethereum (SN-P9)
 */
import { base58CheckDecode, segwitDecode } from './encodings.js';
import { keccak256, toHex, utf8 } from './hashes.js';

/** Removes surrounding whitespace only. Returns both values so the UI can disclose. */
export function trimDisclosed(captured) {
  const exact = String(captured ?? '');
  const trimmed = exact.replace(/^\s+|\s+$/g, '');
  return { exact, trimmed, changed: exact !== trimmed };
}

/** EIP-55: letter i is upper case exactly when nibble i of keccak(lowercase hex) >= 8. */
export function eip55Valid(hex40) {
  const lower = hex40.toLowerCase();
  const hash = toHex(keccak256(utf8(lower)));
  for (let i = 0; i < 40; i++) {
    const c = hex40[i];
    if (/[a-f]/.test(c) && parseInt(hash[i], 16) >= 8) return false;
    if (/[A-F]/.test(c) && parseInt(hash[i], 16) < 8) return false;
  }
  return true;
}

/** Builds the EIP-55 checksummed form; used only to create synthetic test fixtures. */
export function eip55Encode(hex40) {
  const lower = hex40.toLowerCase();
  const hash = toHex(keccak256(utf8(lower)));
  return '0x' + [...lower].map((c, i) => (/[a-f]/.test(c) && parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}

/**
 * classifyAddress(value) — value must already be trimmed (trimDisclosed).
 * Returns { valid, kind, family, ambiguous, noChecksum, problem }.
 * family: 'bitcoin' | 'ethereum' | null — the format family the value claims.
 */
export function classifyAddress(value) {
  const v = String(value ?? '');
  const res = (o) => ({ valid: false, kind: null, family: null, ambiguous: false, noChecksum: false, problem: null, ...o });

  if (v.length === 0) return res({ problem: 'EMPTY' });
  // Look-alike characters: anything outside printable ASCII cannot be part of a
  // supported address. Catches letters from other alphabets that look like Latin ones.
  if (/[^\x21-\x7e]/.test(v)) return res({ problem: 'LOOKALIKE_CHARS' });

  // Ethereum family -------------------------------------------------------------------
  if (v.startsWith('0X')) return res({ family: 'ethereum', problem: 'ETH_UPPER_PREFIX' }); // SN-P8
  if (v.startsWith('0x')) {
    const body = v.slice(2);
    if (!/^[0-9a-fA-F]*$/.test(body)) return res({ family: 'ethereum', problem: 'ETH_BAD_CHARS' });
    if (body.length !== 40) return res({ family: 'ethereum', problem: 'ETH_BAD_LENGTH' });
    const mixed = /[a-f]/.test(body) && /[A-F]/.test(body);
    if (mixed && !eip55Valid(body)) return res({ family: 'ethereum', problem: 'ETH_CHECKSUM_FAILED' }); // Gate C2-03
    return res({ valid: true, kind: 'ETHEREUM_FORMAT_SHARED', family: 'ethereum', ambiguous: true, noChecksum: !mixed });
  }
  if (/^[0-9a-fA-F]{40}$/.test(v)) return res({ family: 'ethereum', problem: 'ETH_MISSING_PREFIX' }); // never add 0x

  // Names are not addresses (SN-P10).
  if (/\.[a-zA-Z]{2,}$/.test(v) && !/^(bc1|BC1)/.test(v)) return res({ problem: 'NAME_NOT_ADDRESS' });

  // Bitcoin bech32 / bech32m ------------------------------------------------------------
  const lower = v.toLowerCase();
  if (lower.startsWith('tb1') || lower.startsWith('bcrt1')) return res({ problem: 'TEST_NETWORK' }); // SN-P16
  if (lower.startsWith('bc1')) {
    const d = segwitDecode('bc', v);
    if (!d.ok) {
      if (d.reason === 'mixed_case') return res({ family: 'bitcoin', problem: 'BTC_MIXED_CASE' });
      return res({ family: 'bitcoin', problem: 'BTC_CHECKSUM_FAILED' });
    }
    // SN-P6: only witness v0 (20 or 32 byte program) and v1 with a 32-byte program.
    if (d.version === 0) return res({ valid: true, kind: 'BITCOIN_MAINNET', family: 'bitcoin' });
    if (d.version === 1 && d.program.length === 32) return res({ valid: true, kind: 'BITCOIN_MAINNET', family: 'bitcoin' });
    return res({ family: 'bitcoin', problem: 'BTC_FORM_NOT_SUPPORTED' });
  }

  // Bitcoin Base58Check ---------------------------------------------------------------
  if (v[0] === '1' || v[0] === '3') {
    const d = base58CheckDecode(v);
    if (!d.ok) return res({ family: 'bitcoin', problem: 'BTC_CHECKSUM_FAILED' });
    const expected = v[0] === '1' ? 0x00 : 0x05;
    if (d.version !== expected) return res({ family: 'bitcoin', problem: 'BTC_CHECKSUM_FAILED' });
    return res({ valid: true, kind: 'BITCOIN_FORMAT_SHARED', family: 'bitcoin', ambiguous: true });
  }

  return res({ problem: 'NOT_RECOGNIZED' });
}

/**
 * Grouped display [Spec §4 Check 2] [Plan WP6]. Blocks of 4 characters; a leading `0x`
 * stays its own block so the user compares the 40 hex characters in 10 even blocks.
 * Display only: the value itself is unchanged.
 */
export const GROUP_SIZE = 4;
export function groupBlocks(value) {
  const v = String(value);
  const head = v.startsWith('0x') || v.startsWith('0X') ? [v.slice(0, 2)] : [];
  const rest = head.length ? v.slice(2) : v;
  const blocks = [];
  for (let i = 0; i < rest.length; i += GROUP_SIZE) blocks.push(rest.slice(i, i + GROUP_SIZE));
  return [...head, ...blocks];
}

/**
 * Address equality for the record comparison (Check 5). Bech32 and Ethereum hex carry
 * no meaning in letter case (BIP-173; EIP-55 case is only a checksum), so they compare
 * case-insensitively; Base58 is case-sensitive. This is a comparison rule, not an
 * alteration: displayed values stay exactly as captured (SN-P18).
 */
export function sameAddress(a, b) {
  if (!a || !b) return false;
  const caseFree = (x) => /^0x/i.test(x) || /^bc1/i.test(x);
  if (caseFree(a) && caseFree(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}
