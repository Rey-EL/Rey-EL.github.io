/**
 * networks.js — THE FROZEN SUPPORTED-NETWORK TABLE.
 *
 * Source: governing/SUPPORTED-NETWORKS.md §1 (frozen by the review approval of the
 * WP0 packet, 2026-11-05, decisions 1–18 as drafted).
 *
 * GATE / INVARIANT (frozen-table check): exactly two entries, `bitcoin-mainnet` (BTC)
 * and `ethereum-mainnet` (ETH). Nothing may be added, aliased, or inferred here. The
 * module asserts the size at load, the proxy (proxy/allowlist.mjs) re-declares the same
 * two identifiers independently, and test/validation.test.mjs ("frozen table: exactly two
 * networks ...") fails if either declaration drifts.
 *
 *  - SN-P1  two entries only, each network's own coin only.
 *  - SN-P2  Blockchain.com Explorer: reference link only, never a read source, and only
 *           where WP9 confirms coverage. WP9 could not confirm coverage in this sandbox
 *           (no live network access), so it is NOT offered (recorded as a known limitation).
 *  - SN-P3  Bitcoin reads: Blockstream/Esplora only; Mempool.space is a user-opened link;
 *           no automatic fallback.
 *  - SN-P4  Ethereum reads and canonical link: Etherscan only.
 *  - SN-P5  identifiers `bitcoin-mainnet`, `ethereum-mainnet`; asset codes BTC, ETH.
 *  - SN-P16 main networks only.
 *
 * Direct explorer links (content map, OPEN-QUESTIONS item 4, explorer part): the link is
 * built ONLY from this table's fixed https origin plus the validated hash, never from a
 * user-supplied URL [Gate C5-10]. The URL patterns are the explorers' public transaction
 * pages; they could not be re-confirmed against the live services in this sandbox (no
 * network), which is listed as a known limitation in the WP14 handoff.
 */

export const NETWORKS = Object.freeze({
  'bitcoin-mainnet': Object.freeze({
    id: 'bitcoin-mainnet',
    asset: 'BTC',
    decimals: 8, // 1 BTC = 100,000,000 satoshi
    nameKey: 'network.bitcoin',
    assetKey: 'asset.btc',
    readSource: 'blockstream-esplora',
    links: Object.freeze([
      Object.freeze({ id: 'blockstream', labelKey: 'explorer.blockstream', canonical: true, base: 'https://blockstream.info/tx/' }),
      Object.freeze({ id: 'mempool', labelKey: 'explorer.mempool', canonical: false, base: 'https://mempool.space/tx/' }),
    ]),
  }),
  'ethereum-mainnet': Object.freeze({
    id: 'ethereum-mainnet',
    asset: 'ETH',
    decimals: 18, // 1 ETH = 10^18 wei
    nameKey: 'network.ethereum',
    assetKey: 'asset.eth',
    readSource: 'etherscan',
    links: Object.freeze([
      Object.freeze({ id: 'etherscan', labelKey: 'explorer.etherscan', canonical: true, base: 'https://etherscan.io/tx/' }),
    ]),
  }),
});

export const NETWORK_IDS = Object.freeze(Object.keys(NETWORKS));
if (NETWORK_IDS.length !== 2) throw new Error('Frozen supported-network table must have exactly two entries');

/** Asset choices offered in the entry flow, mapped to the network the asset implies. */
export const ASSET_TO_NETWORK = Object.freeze({ BTC: 'bitcoin-mainnet', ETH: 'ethereum-mainnet' });

/**
 * Intended-asset answers outside the table [SUPPORTED-NETWORKS §4, SN-P14, SN-P15].
 *  TOKEN_ETH   a token (incl. stablecoins) on Ethereum  -> UNSUPPORTED_ASSET, network ethereum
 *  OTHER_BTC   another asset or payment type on Bitcoin  -> UNSUPPORTED_ASSET, network bitcoin
 *  OTHER_COIN  another coin or network                   -> UNSUPPORTED_NETWORK, no link
 *  UNKNOWN     the user does not know                    -> intended asset named as missing
 */
export const ASSET_CHOICES = Object.freeze(['BTC', 'ETH', 'TOKEN_ETH', 'OTHER_BTC', 'OTHER_COIN', 'UNKNOWN']);

export function assetSupport(asset) {
  if (asset === 'BTC' || asset === 'ETH') return { supported: true, network: ASSET_TO_NETWORK[asset] };
  if (asset === 'TOKEN_ETH') return { supported: false, reason: 'UNSUPPORTED_ASSET', network: 'ethereum-mainnet' };
  if (asset === 'OTHER_BTC') return { supported: false, reason: 'UNSUPPORTED_ASSET', network: 'bitcoin-mainnet' };
  if (asset === 'OTHER_COIN') return { supported: false, reason: 'UNSUPPORTED_NETWORK', network: null };
  return { supported: false, reason: 'ASSET_MISSING', network: null };
}

/**
 * Build a direct explorer link from the frozen table. Returns null for anything outside
 * the table (UNSUPPORTED_NETWORK gets no link, SUPPORTED-NETWORKS §4.3). The hash is
 * passed through encodeURIComponent although it has already been validated as hex.
 */
export function explorerLinks(networkId, hash) {
  const n = NETWORKS[networkId];
  if (!n || !hash) return [];
  return n.links.map((l) => ({ id: l.id, labelKey: l.labelKey, canonical: l.canonical, url: l.base + encodeURIComponent(hash) }));
}

/** Network home page links for UNSUPPORTED_ASSET (no hash available). */
export const EXPLORER_HOME = Object.freeze({
  'bitcoin-mainnet': Object.freeze({ labelKey: 'explorer.blockstream', url: 'https://blockstream.info/' }),
  'ethereum-mainnet': Object.freeze({ labelKey: 'explorer.etherscan', url: 'https://etherscan.io/' }),
});
