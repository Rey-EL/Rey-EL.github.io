/**
 * proxy-client.js — the ONE place the client sends an address-bearing or hash-bearing
 * value off the device (WP9, WP10).
 *
 * Data story [Plan §4.2]: "The only network transmission of an address or hash is the
 * transient public-record lookup through the stateless proxy." This function sends only
 * { network, hash } — never an address, an amount, an answer, or an image.
 *
 * Choices and their reasons:
 *  - POST with a small JSON body to the same origin (api/v1/record, relative to the
 *    document base, so it follows the directory the app is served from), not a GET with a
 *    query string: hosting platforms commonly log request paths and query strings; a POST
 *    body is not part of those logs [Plan §3.2 operational-log rule].
 *  - cache: 'no-store' and credentials: 'omit': no browser HTTP cache of the response, no
 *    cookies. The service worker does not intercept api/ at all (sw.js).
 *  - No automatic retry and no background queue: a failed lookup waits for the user to
 *    press "Try again" [Gate O-06: no silent transmission of queued personal data].
 *  - The client never receives or holds an explorer key [Gate P-01].
 */
import { validateHash } from './txhash.js';
import { NETWORKS } from './networks.js';

export const PROXY_PATH = 'api/v1/record';
const TIMEOUT_MS = 15000;

/** Returns a lookup outcome: { kind: RECORD|NOT_FOUND|UNAVAILABLE|UNSUPPORTED_NETWORK|INVALID_HASH, ... } */
export async function lookupRecord(networkId, hash, fetchImpl = globalThis.fetch) {
  if (!NETWORKS[networkId]) return { kind: 'UNSUPPORTED_NETWORK' }; // no request is made [Gate R-03]
  const v = validateHash(networkId, hash);
  if (!v.ok) return { kind: 'INVALID_HASH', problem: v.problem };   // no request is made [Gate C5-07]
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'UNAVAILABLE', cause: 'OFFLINE' };

  let res;
  try {
    res = await fetchImpl(PROXY_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ network: networkId, hash }),
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { kind: 'UNAVAILABLE', cause: e && e.name === 'TimeoutError' ? 'TIMEOUT' : 'OFFLINE' }; // Gates C5-09, O-04
  }
  let body = null;
  try { body = await res.json(); } catch { return { kind: 'UNAVAILABLE', cause: 'PROXY_ERROR' }; }
  if (!body || typeof body.kind !== 'string') return { kind: 'UNAVAILABLE', cause: 'PROXY_ERROR' };
  if (body.kind === 'RECORD' && body.record && body.record.network === networkId) return { kind: 'RECORD', record: body.record, mode: body.mode };
  if (body.kind === 'NOT_FOUND') return { kind: 'NOT_FOUND', mode: body.mode };
  if (body.kind === 'UNAVAILABLE') return { kind: 'UNAVAILABLE', cause: String(body.cause || 'UPSTREAM') };
  if (body.kind === 'UNSUPPORTED_NETWORK') return { kind: 'UNSUPPORTED_NETWORK' };
  return { kind: 'UNAVAILABLE', cause: 'PROXY_ERROR' };
}
