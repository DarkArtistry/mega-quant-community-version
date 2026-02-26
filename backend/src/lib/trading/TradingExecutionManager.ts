/**
 * Trading Execution Manager
 *
 * Manages in-memory DeltaTrade instances for fast trading execution.
 *
 * Architecture:
 * - When a strategy starts, private keys are decrypted ONCE and kept in memory
 * - DeltaTrade instances are stored in a Map for fast access
 * - All trades use the in-memory instance (no DB lookups during trading)
 * - When strategy stops, private keys are cleared from memory
 */

import { DeltaTrade, createDeltaTrade } from './DeltaTrade.js'
import { getDatabase } from '../../db/index.js'
import { deriveKey, decrypt } from '../../utils/crypto.js'

export interface ChainConfig {
  chainName: string
  accountId: string
}

export interface ExecutionInfo {
  executionId: string
  strategyId: string
  deltaTrade: DeltaTrade
  chainConfigs: ChainConfig[]
  createdAt: number
}

class TradingExecutionManager {
  private executions: Map<string, ExecutionInfo> = new Map()

  /**
   * Initialize a new trading execution with per-chain accounts.
   *
   * Decrypts private keys from the database using the master password,
   * creates a DeltaTrade instance, and stores it in memory for fast access.
   */
  async initializeExecution(
    executionType: string,
    strategyId: string,
    chainConfigs: ChainConfig[],
    masterPassword: string
  ): Promise<string> {
    console.log(`[TradingExecutionManager] Initializing execution for strategy: ${strategyId}`)
    console.log(`[TradingExecutionManager] Chains: ${chainConfigs.map(c => c.chainName).join(', ')}`)

    try {
      const db = getDatabase()

      // Get key salt for decryption
      const security = db.prepare('SELECT key_salt FROM app_security WHERE id = 1')
        .get() as { key_salt: string } | undefined

      if (!security) {
        throw new Error('App security not initialized')
      }

      const encryptionKey = deriveKey(masterPassword, security.key_salt)

      // Decrypt private keys for each chain
      const chainPrivateKeys: Record<string, string> = {}

      for (const config of chainConfigs) {
        console.log(`[TradingExecutionManager] Decrypting private key for ${config.chainName} (account: ${config.accountId})`)

        // Get account from database
        const account = db.prepare(`
          SELECT id, private_key_encrypted, private_key_iv, private_key_tag
          FROM accounts
          WHERE id = ?
        `).get(config.accountId) as any

        if (!account) {
          throw new Error(`Account not found: ${config.accountId}`)
        }

        // Decrypt private key (ethers v6 compatible - decrypt returns string)
        const privateKey = decrypt(
          account.private_key_encrypted,
          encryptionKey,
          account.private_key_iv,
          account.private_key_tag
        )

        chainPrivateKeys[config.chainName] = privateKey
      }

      // Create execution ID
      const executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
      const chains = chainConfigs.map(c => c.chainName)

      console.log(`[TradingExecutionManager] Creating DeltaTrade instance with ${chains.length} chains`)
      console.log(`[TradingExecutionManager] Private keys loaded in memory for fast signing`)

      // Create DeltaTrade with per-chain private keys
      const deltaTrade = new DeltaTrade(
        executionId,
        strategyId,
        executionType,
        chainPrivateKeys
      )

      // Initialize protocols (async imports)
      await deltaTrade.initProtocols()

      // Initialize (capture starting inventory)
      await deltaTrade.initialize()

      // Store execution info
      const executionInfo: ExecutionInfo = {
        executionId,
        strategyId,
        deltaTrade,
        chainConfigs,
        createdAt: Date.now()
      }

      this.executions.set(executionId, executionInfo)

      console.log(`[TradingExecutionManager] Execution initialized: ${executionId}`)
      console.log(`  Private keys for ${chains.length} chains loaded in memory`)

      return executionId
    } catch (error: any) {
      console.error('[TradingExecutionManager] Failed to initialize execution:', error)
      throw error
    }
  }

  /**
   * Initialize execution using the account key store (no password needed).
   * Requires app to be unlocked.
   */
  async initializeExecutionFromStore(
    executionType: string,
    strategyId: string
  ): Promise<string> {
    console.log(`[TradingExecutionManager] Initializing execution from key store for strategy: ${strategyId}`)

    try {
      const deltaTrade = await createDeltaTrade(executionType, strategyId)

      const executionInfo: ExecutionInfo = {
        executionId: deltaTrade.executionId,
        strategyId,
        deltaTrade,
        chainConfigs: deltaTrade.getConfiguredChains().map(c => ({ chainName: c, accountId: 'from-store' })),
        createdAt: Date.now()
      }

      this.executions.set(deltaTrade.executionId, executionInfo)

      console.log(`[TradingExecutionManager] Execution initialized: ${deltaTrade.executionId}`)
      return deltaTrade.executionId
    } catch (error: any) {
      console.error('[TradingExecutionManager] Failed to initialize execution from store:', error)
      throw error
    }
  }

  /**
   * Get an active execution by ID
   */
  getExecution(executionId: string): ExecutionInfo | undefined {
    return this.executions.get(executionId)
  }

  /**
   * Close an execution, calculate P&L, and clean up resources
   */
  async closeExecution(executionId: string): Promise<any> {
    console.log(`[TradingExecutionManager] Closing execution: ${executionId}`)

    const execution = this.executions.get(executionId)
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`)
    }

    try {
      // Close DeltaTrade and get P&L
      const result = await execution.deltaTrade.close()

      // Remove from memory
      this.executions.delete(executionId)

      console.log(`[TradingExecutionManager] Execution closed: ${executionId}`)
      console.log(`  Private keys removed from memory`)
      console.log(`  Net P&L: $${result.netPnl.toFixed(2)}`)

      return result
    } catch (error: any) {
      console.error('[TradingExecutionManager] Failed to close execution:', error)
      // Still remove from memory even if close failed
      this.executions.delete(executionId)
      throw error
    }
  }

  /**
   * Get all active execution IDs
   */
  getActiveExecutions(): string[] {
    return Array.from(this.executions.keys())
  }

  /**
   * Get active execution count
   */
  getExecutionCount(): number {
    return this.executions.size
  }

  /**
   * Check if an execution exists
   */
  hasExecution(executionId: string): boolean {
    return this.executions.has(executionId)
  }

  /**
   * Get execution by strategy ID (returns the first match)
   */
  getExecutionByStrategy(strategyId: string): ExecutionInfo | undefined {
    for (const execution of this.executions.values()) {
      if (execution.strategyId === strategyId) {
        return execution
      }
    }
    return undefined
  }

  /**
   * Clean up all executions (for server shutdown)
   */
  async cleanup(): Promise<void> {
    console.log(`[TradingExecutionManager] Cleaning up ${this.executions.size} active executions`)

    const promises = Array.from(this.executions.keys()).map(async (executionId) => {
      try {
        await this.closeExecution(executionId)
      } catch (error) {
        console.error(`Failed to close execution ${executionId}:`, error)
      }
    })

    await Promise.all(promises)
    console.log('[TradingExecutionManager] Cleanup complete')
  }
}

// Singleton instance
export const tradingExecutionManager = new TradingExecutionManager()
