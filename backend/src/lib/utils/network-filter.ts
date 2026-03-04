/**
 * Network filter utility for mainnet/testnet chain classification.
 *
 * Chain IDs:
 *   Mainnet: 1 (Ethereum), 8453 (Base), 130 (Unichain)
 *   Testnet: 11155111 (Sepolia), 84532 (Base Sepolia), 1301 (Unichain Sepolia)
 *   Binance: chain_id IS NULL — use global api_configs.binance_testnet flag
 */

const MAINNET_CHAIN_IDS = [1, 8453, 130]
const TESTNET_CHAIN_IDS = [11155111, 84532, 1301]

export type NetworkFilter = 'all' | 'mainnet' | 'testnet'

// Binance testnet is a global setting in the api_configs singleton table
const BINANCE_IS_TESTNET = `(SELECT binance_testnet FROM api_configs WHERE id = 1) = 1`
const BINANCE_IS_MAINNET = `(SELECT COALESCE(binance_testnet, 0) FROM api_configs WHERE id = 1) != 1`

/**
 * Build SQL WHERE conditions for network filtering on the orders table.
 */
export function buildOrdersNetworkFilter(
  network: NetworkFilter,
  tableAlias = 'o'
): { clause: string; params: any[] } {
  if (network === 'all') return { clause: '', params: [] }

  const t = tableAlias
  if (network === 'mainnet') {
    return {
      clause: ` AND (${t}.chain_id IN (${MAINNET_CHAIN_IDS.join(',')}) OR (${t}.chain_id IS NULL AND ${t}.protocol = 'binance' AND ${BINANCE_IS_MAINNET}))`,
      params: [],
    }
  }

  // testnet
  return {
    clause: ` AND (${t}.chain_id IN (${TESTNET_CHAIN_IDS.join(',')}) OR (${t}.chain_id IS NULL AND ${t}.protocol = 'binance' AND ${BINANCE_IS_TESTNET}))`,
    params: [],
  }
}

/**
 * Build SQL WHERE conditions for network filtering on the positions table.
 */
export function buildPositionsNetworkFilter(
  network: NetworkFilter,
  tableAlias = 'p'
): { clause: string; params: any[] } {
  if (network === 'all') return { clause: '', params: [] }

  const t = tableAlias
  if (network === 'mainnet') {
    return {
      clause: ` AND (${t}.chain_id IN (${MAINNET_CHAIN_IDS.join(',')}) OR (${t}.chain_id IS NULL AND ${t}.protocol = 'binance' AND ${BINANCE_IS_MAINNET}))`,
      params: [],
    }
  }

  return {
    clause: ` AND (${t}.chain_id IN (${TESTNET_CHAIN_IDS.join(',')}) OR (${t}.chain_id IS NULL AND ${t}.protocol = 'binance' AND ${BINANCE_IS_TESTNET}))`,
    params: [],
  }
}

/** Parse + validate the network query param */
export function parseNetworkParam(value: unknown): NetworkFilter {
  if (value === 'mainnet' || value === 'testnet') return value
  return 'all'
}
