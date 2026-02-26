/**
 * Strategy Account Loading Service
 *
 * Loads and decrypts the accounts configured for a strategy
 * This allows strategies to execute without exposing private keys in code
 */

import { getDatabase } from '../db/index.js'
import { deriveKey, decrypt } from '../utils/crypto.js'

// Map network IDs to chain names
// network_id=0 is reserved for CEX accounts (use exchange_name to distinguish)
const NETWORK_ID_TO_CHAIN_NAME: Record<number, string> = {
  0: 'cex',
  1: 'ethereum',
  8453: 'base',
  11155111: 'sepolia',
  84532: 'base-sepolia'
}

/**
 * Load private keys for all accounts configured for a strategy
 *
 * Loads from in-memory store (populated at unlock).
 * No password needed - app must be unlocked first.
 *
 * @param strategyId - The strategy ID
 * @returns Record mapping chain names to private keys (e.g., { 'ethereum': '0x...', 'base': '0x...' })
 */
import { accountKeyStore } from './account-key-store.js'
import { apiKeyStore } from './api-key-store.js'

export interface StrategyAccountsResult {
  chainPrivateKeys: Record<string, string>
  cexCredentials: Record<string, { apiKey: string; apiSecret: string }>
}

export function loadStrategyAccounts(strategyId: string): Record<string, string>
export function loadStrategyAccounts(strategyId: string, includeCex: true): StrategyAccountsResult
export function loadStrategyAccounts(strategyId: string, includeCex?: boolean): Record<string, string> | StrategyAccountsResult {
  try {
    const db = getDatabase()

    if (!accountKeyStore.isAppUnlocked()) {
      throw new Error('App is locked. Please unlock the app before running strategies.')
    }

    // Get strategy account mappings (just the mapping, not the keys)
    const mappings = db.prepare(`
      SELECT
        sam.network_id,
        sam.account_id,
        sam.exchange_name
      FROM strategy_account_mappings sam
      WHERE sam.strategy_id = ?
    `).all(strategyId) as Array<{
      network_id: number
      account_id: string
      exchange_name: string | null
    }>

    if (mappings.length === 0) {
      console.warn(`[StrategyAccounts] No accounts configured for strategy ${strategyId}`)
      if (includeCex) {
        return { chainPrivateKeys: {}, cexCredentials: {} }
      }
      return {}
    }

    // Load private keys from memory for each network
    const chainPrivateKeys: Record<string, string> = {}
    const cexCredentials: Record<string, { apiKey: string; apiSecret: string }> = {}

    for (const mapping of mappings) {
      // CEX account (network_id=0)
      if (mapping.network_id === 0 && mapping.exchange_name) {
        if (mapping.exchange_name === 'binance') {
          const apiKey = apiKeyStore.getBinanceApiKey()
          const apiSecret = apiKeyStore.getBinanceApiSecret()
          if (apiKey && apiSecret) {
            cexCredentials[mapping.exchange_name] = { apiKey, apiSecret }
            console.log(`[StrategyAccounts] Loaded CEX credentials for ${mapping.exchange_name}`)
          } else {
            console.warn(`[StrategyAccounts] CEX credentials not available for ${mapping.exchange_name}`)
          }
        }
        continue
      }

      const chainName = NETWORK_ID_TO_CHAIN_NAME[mapping.network_id]

      if (!chainName) {
        console.warn(`[StrategyAccounts] Unknown network ID: ${mapping.network_id}, skipping`)
        continue
      }

      // Get account from memory
      const account = accountKeyStore.getAccount(mapping.account_id)

      if (!account) {
        console.error(`[StrategyAccounts] Account ${mapping.account_id} not found in memory`)
        continue
      }

      chainPrivateKeys[chainName] = account.privateKey
      console.log(`[StrategyAccounts] Loaded account "${account.accountName}" (${account.address}) for ${chainName}`)
    }

    if (includeCex) {
      if (Object.keys(chainPrivateKeys).length === 0 && Object.keys(cexCredentials).length === 0) {
        throw new Error(`Failed to load any accounts for strategy ${strategyId}`)
      }
      return { chainPrivateKeys, cexCredentials }
    }

    if (Object.keys(chainPrivateKeys).length === 0) {
      throw new Error(`Failed to load any accounts for strategy ${strategyId}`)
    }

    return chainPrivateKeys

  } catch (error: any) {
    console.error('[StrategyAccounts] Error loading strategy accounts:', error.message)
    throw new Error(`Failed to load strategy accounts: ${error.message}`)
  }
}

/**
 * Get account mappings for a strategy (without private keys)
 * Useful for UI to display which accounts are configured.
 * Includes both on-chain and CEX account mappings.
 */
export function getStrategyAccountMappings(strategyId: string): Array<{
  networkId: number
  networkName: string
  accountId: string
  accountName: string
  address: string
  exchangeName?: string
}> {
  const db = getDatabase()

  // On-chain account mappings (network_id != 0)
  const onChainMappings = db.prepare(`
    SELECT
      sam.network_id,
      sam.account_id,
      a.name as account_name,
      a.address
    FROM strategy_account_mappings sam
    INNER JOIN accounts a ON sam.account_id = a.id
    WHERE sam.strategy_id = ? AND sam.network_id != 0
  `).all(strategyId) as Array<{
    network_id: number
    account_id: string
    account_name: string
    address: string
  }>

  // CEX account mappings (network_id = 0)
  const cexMappings = db.prepare(`
    SELECT
      sam.network_id,
      sam.account_id,
      sam.exchange_name
    FROM strategy_account_mappings sam
    WHERE sam.strategy_id = ? AND sam.network_id = 0
  `).all(strategyId) as Array<{
    network_id: number
    account_id: string
    exchange_name: string | null
  }>

  const results: Array<{
    networkId: number
    networkName: string
    accountId: string
    accountName: string
    address: string
    exchangeName?: string
  }> = []

  // Map on-chain accounts
  for (const m of onChainMappings) {
    results.push({
      networkId: m.network_id,
      networkName: NETWORK_ID_TO_CHAIN_NAME[m.network_id] || `Network ${m.network_id}`,
      accountId: m.account_id,
      accountName: m.account_name,
      address: m.address
    })
  }

  // Map CEX accounts
  for (const m of cexMappings) {
    results.push({
      networkId: 0,
      networkName: m.exchange_name || 'cex',
      accountId: m.account_id,
      accountName: m.exchange_name || 'CEX Account',
      address: '',
      exchangeName: m.exchange_name || undefined
    })
  }

  return results
}

/**
 * Set account mapping for a strategy network
 */
export function setStrategyAccountMapping(
  strategyId: string,
  networkId: number,
  accountId: string
): void {
  const db = getDatabase()

  db.prepare(`
    INSERT INTO strategy_account_mappings (strategy_id, network_id, account_id)
    VALUES (?, ?, ?)
    ON CONFLICT(strategy_id, network_id)
    DO UPDATE SET account_id = excluded.account_id, updated_at = CURRENT_TIMESTAMP
  `).run(strategyId, networkId, accountId)

  console.log(`[StrategyAccounts] Set account ${accountId} for strategy ${strategyId} network ${networkId}`)
}

/**
 * Remove account mapping for a strategy network
 */
export function removeStrategyAccountMapping(strategyId: string, networkId: number): void {
  const db = getDatabase()

  db.prepare(`
    DELETE FROM strategy_account_mappings
    WHERE strategy_id = ? AND network_id = ?
  `).run(strategyId, networkId)

  console.log(`[StrategyAccounts] Removed account mapping for strategy ${strategyId} network ${networkId}`)
}

/**
 * Set CEX account mapping for a strategy.
 * Uses network_id=0 convention with exchange_name to distinguish CEX accounts.
 * account_id is set to 'cex-<exchangeName>' as a placeholder since CEX accounts
 * use API keys rather than wallet-based accounts.
 */
export function setCexAccountMapping(strategyId: string, exchangeName: string): void {
  const db = getDatabase()
  const accountId = `cex-${exchangeName}`

  // Use INSERT OR REPLACE since the UNIQUE constraint is on (strategy_id, network_id).
  // For CEX we key on exchange_name, so we first check if a mapping with this exchange already exists.
  const existing = db.prepare(`
    SELECT id FROM strategy_account_mappings
    WHERE strategy_id = ? AND network_id = 0 AND exchange_name = ?
  `).get(strategyId, exchangeName)

  if (existing) {
    db.prepare(`
      UPDATE strategy_account_mappings
      SET account_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE strategy_id = ? AND network_id = 0 AND exchange_name = ?
    `).run(accountId, strategyId, exchangeName)
  } else {
    db.prepare(`
      INSERT INTO strategy_account_mappings (strategy_id, network_id, account_id, exchange_name)
      VALUES (?, 0, ?, ?)
    `).run(strategyId, accountId, exchangeName)
  }

  console.log(`[StrategyAccounts] Set CEX account mapping for strategy ${strategyId} exchange ${exchangeName}`)
}

/**
 * Remove CEX account mapping for a strategy.
 */
export function removeCexAccountMapping(strategyId: string, exchangeName: string): void {
  const db = getDatabase()

  db.prepare(`
    DELETE FROM strategy_account_mappings
    WHERE strategy_id = ? AND network_id = 0 AND exchange_name = ?
  `).run(strategyId, exchangeName)

  console.log(`[StrategyAccounts] Removed CEX account mapping for strategy ${strategyId} exchange ${exchangeName}`)
}
