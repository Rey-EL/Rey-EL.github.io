/**
 * encodings.js — Base58Check and bech32/bech32m decoders (and encoders, used only to
 * build synthetic test fixtures).
 *
 * Standards [SUPPORTED-NETWORKS §2.2, SN-P6]:
 *  - Base58Check: Bitcoin alphabet; payload = version || hash160; checksum = first 4
 *    bytes of SHA-256(SHA-256(version || hash160)).
 *  - Bech32 (BIP-173) checksum constant 1; Bech32m (BIP-350) constant 0x2bc830a3.
 *    Witness version 0 must use bech32; versions 1–16 must use bech32m (BIP-350).
 *    Mixed case is invalid; all-upper is valid (BIP-173). Max length 90.
 *
 * Invariant SN-P18: these functions never modify the input string. They decode a copy
 * for checking only; the value shown and compared is the value captured.
 */
import { sha256 } from './hashes.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(s) {
  if (!s.length) return null;
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch === '1') bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}

/** Returns { ok, version, reason } — reason in 'chars' | 'length' | 'checksum'. */
export function base58CheckDecode(s) {
  const raw = base58Decode(s);
  if (!raw) return { ok: false, reason: 'chars' };
  if (raw.length !== 25) return { ok: false, reason: 'length' };
  const body = raw.slice(0, 21);
  const check = sha256(sha256(body)).slice(0, 4);
  for (let i = 0; i < 4; i++) if (check[i] !== raw[21 + i]) return { ok: false, reason: 'checksum' };
  return { ok: true, version: raw[0] };
}

export function base58CheckEncode(version, payload20) {
  const body = Uint8Array.from([version, ...payload20]);
  const check = sha256(sha256(body)).slice(0, 4);
  return base58Encode(Uint8Array.from([...body, ...check]));
}

// ------------------------------------------------------------------- bech32 / bech32m
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
export const BECH32 = 1;
export const BECH32M = 0x2bc830a3;

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}
const hrpExpand = (hrp) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

/** Generic bech32 string decode. Returns { ok, hrp, data, spec, reason }. */
export function bech32Decode(str) {
  if (str.length > 90) return { ok: false, reason: 'length' };
  const lower = str.toLowerCase();
  const upper = str.toUpperCase();
  if (str !== lower && str !== upper) return { ok: false, reason: 'mixed_case' };
  for (const ch of str) { const c = ch.charCodeAt(0); if (c < 33 || c > 126) return { ok: false, reason: 'chars' }; }
  const s = lower;
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) return { ok: false, reason: 'separator' };
  const hrp = s.slice(0, pos);
  const data = [];
  for (const ch of s.slice(pos + 1)) {
    const v = CHARSET.indexOf(ch);
    if (v < 0) return { ok: false, reason: 'chars' };
    data.push(v);
  }
  const pm = polymod([...hrpExpand(hrp), ...data]);
  const spec = pm === BECH32 ? BECH32 : pm === BECH32M ? BECH32M : null;
  if (!spec) return { ok: false, reason: 'checksum' };
  return { ok: true, hrp, data: data.slice(0, -6), spec };
}

export function bech32Encode(hrp, data, spec) {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ spec;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...checksum].map((d) => CHARSET[d]).join('');
}

export function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    if (v < 0 || v >> from) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}

/** Segwit address decode for one expected hrp (BIP-173 + BIP-350 rules). */
export function segwitDecode(hrp, addr) {
  const d = bech32Decode(addr);
  if (!d.ok) return d;
  if (d.hrp !== hrp) return { ok: false, reason: 'hrp' };
  if (d.data.length < 1) return { ok: false, reason: 'length' };
  const version = d.data[0];
  if (version > 16) return { ok: false, reason: 'version' };
  const program = convertBits(d.data.slice(1), 5, 8, false);
  if (!program || program.length < 2 || program.length > 40) return { ok: false, reason: 'length' };
  if (version === 0 && program.length !== 20 && program.length !== 32) return { ok: false, reason: 'length' };
  if ((version === 0 && d.spec !== BECH32) || (version !== 0 && d.spec !== BECH32M)) return { ok: false, reason: 'checksum' };
  return { ok: true, version, program };
}

export function segwitEncode(hrp, version, program) {
  return bech32Encode(hrp, [version, ...convertBits(program, 8, 5, true)], version === 0 ? BECH32 : BECH32M);
}
