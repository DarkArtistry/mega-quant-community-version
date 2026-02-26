// DeltaTrade - Main trading orchestrator
// Ported from reference with PnL engine integration and enhanced inventory tracking

import { formatUnits } from 'ethers'
import { ChainProxy } from './ChainProxy.js'
import { TOKEN_ADDRESSES } from './config/tokens.js'
import { getChainConfig } from './config/chains.js'
import axios from 'axios'

export interface TokenBalance {
  chainId: number
  chainName: string
  tokenAddress: string
  tokenSymbol: string
  balance: string
  balanceUsd?: number
}

export interface ExecutionResult {
  executionId: string
  status: string
  startingInventory: TokenBalance[]
  endingInventory: TokenBalance[]
  totalPnl: number
  totalGasCost: number
  netPnl: number
}

export class DeltaTrade {
  public readonly executionId: string
  public readonly strategyId: string
  public readonly executionType: string
  private readonly chainPrivateKeys: Record<string, string> // Per-chain private keys

  private startingInventory: TokenBalance[] = []
  private endingInventory: TokenBalance[] = []
  private apiBaseUrl: string

  // Chain proxies (only Ethereum, Sepolia, Base, Base Sepolia)
  public readonly ethereum?: ChainProxy
  public readonly base?: ChainProxy
  public readonly sepolia?: ChainProxy
  public readonly 'base-sepolia'?: ChainProxy

  constructor(
    executionId: string,
    strategyId: string,
    executionType: string,
    chainPrivateKeys: Record<string, string> // chainName -> privateKey mapping
  ) {
    this.executionId = executionId
    this.strategyId = strategyId
    this.executionType = executionType
    this.chainPrivateKeys = chainPrivateKeys
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001'

    console.log(`[DeltaTrade] Created execution ${executionId} for strategy ${strategyId}`)
    console.log(`[DeltaTrade] Execution type: ${executionType}`)

    // Initialize chain proxies for configured chains
    const chains = Object.keys(chainPrivateKeys)
    console.log(`[DeltaTrade] Initializing ${chains.length} chains with per-chain accounts`)

    for (const chainName of chains) {
      try {
        const privateKey = chainPrivateKeys[chainName]
        const proxy = new ChainProxy(chainName, privateKey, this)
        ;(this as any)[chainName] = proxy
        console.log(`[DeltaTrade] Initialized ${chainName} proxy`)
      } catch (error: any) {
        console.warn(`[DeltaTrade] Could not initialize ${chainName}: ${error.message}`)
      }
    }
  }

  /**
   * Initialize protocols on all chain proxies.
   * Must be called after construction to allow async imports.
   */
  async initProtocols(): Promise<void> {
    const proxies = this.getAllChainProxies()
    for (const [chainName, proxy] of Object.entries(proxies)) {
      try {
        await proxy.initProtocols()
      } catch (error: any) {
        console.warn(`[DeltaTrade] Could not initialize protocols for ${chainName}: ${error.message}`)
      }
    }
  }

  /**
   * Capture starting inventory across all chains
   */
  async initialize(): Promise<void> {
    console.log('[DeltaTrade] Capturing starting inventory...')
    this.startingInventory = await this.captureInventory()
    console.log(`[DeltaTrade] Starting inventory captured: ${this.startingInventory.length} balances`)

    // Update execution in database
    try {
      await axios.patch(
        `${this.apiBaseUrl}/api/executions/${this.executionId}/inventory`,
        { starting_inventory: this.startingInventory },
        { timeout: 5000 }
      )
    } catch (error: any) {
      console.error('[DeltaTrade] Failed to update starting inventory:', error.message)
    }
  }

  /**
   * Close execution and calculate P&L from inventory deltas
   */
  async close(): Promise<ExecutionResult> {
    console.log('[DeltaTrade] Closing execution and calculating P&L...')

    // Capture ending inventory
    this.endingInventory = await this.captureInventory()
    console.log(`[DeltaTrade] Ending inventory captured: ${this.endingInventory.length} balances`)

    // Calculate P&L from inventory deltas
    const pnl = this.calculatePnLFromDeltas()

    console.log(`[DeltaTrade] Total P&L: $${pnl.totalPnl.toFixed(2)}`)
    console.log(`[DeltaTrade] Total Gas Cost: $${pnl.totalGasCost.toFixed(2)}`)
    console.log(`[DeltaTrade] Net P&L: $${pnl.netPnl.toFixed(2)}`)

    // Also get PnL from the engine for cross-reference
    try {
      const { pnlEngine } = await import('./pnl/PnlEngine.js')
      const enginePnl = pnlEngine.getTotalPnl(this.strategyId)
      console.log(`[DeltaTrade] PnL Engine - Realized: $${enginePnl.totalRealizedPnl.toFixed(2)}, Unrealized: $${enginePnl.totalUnrealizedPnl.toFixed(2)}`)
    } catch (error: any) {
      console.warn('[DeltaTrade] Could not get PnL engine data:', error.message)
    }

    // Update execution in database
    try {
      await axios.post(
        `${this.apiBaseUrl}/api/executions/${this.executionId}/close`,
        {
          ending_inventory: this.endingInventory,
          pnl_components: {
            total_pnl_usd: pnl.totalPnl,
            total_gas_cost_usd: pnl.totalGasCost
          }
        },
        { timeout: 5000 }
      )
    } catch (error: any) {
      console.warn('[DeltaTrade] Failed to update execution in database:', error.message)
    }

    return {
      executionId: this.executionId,
      status: 'closed',
      startingInventory: this.startingInventory,
      endingInventory: this.endingInventory,
      totalPnl: pnl.totalPnl,
      totalGasCost: pnl.totalGasCost,
      netPnl: pnl.netPnl
    }
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Capture current inventory across all chains.
   * Tracks native token and key ERC20 balances (WETH, USDC, USDT, DAI).
   */
  private async captureInventory(): Promise<TokenBalance[]> {
    const inventory: TokenBalance[] = []
    const chainProxies = this.getAllChainProxies()

    for (const [chainName, proxy] of Object.entries(chainProxies)) {
      try {
        // Get native token balance
        const nativeBalance = await proxy.getNativeBalance()
        if (nativeBalance > 0n) {
          const chainConfig = getChainConfig(chainName)
          inventory.push({
            chainId: proxy.chainId,
            chainName: proxy.chainName,
            tokenAddress: '0x0000000000000000000000000000000000000000',
            tokenSymbol: chainConfig.nativeCurrency.symbol,
            balance: nativeBalance.toString()
          })
        }

        // Get ERC20 token balances for key tokens
        const tokens = TOKEN_ADDRESSES[chainName.toLowerCase()]
        if (tokens) {
          const trackSymbols = ['WETH', 'USDC', 'USDT', 'DAI']
          for (const [symbol, tokenInfo] of Object.entries(tokens)) {
            if (trackSymbols.includes(symbol)) {
              try {
                const balance = await proxy.getTokenBalance(tokenInfo.address)
                if (balance > 0n) {
                  inventory.push({
                    chainId: proxy.chainId,
                    chainName: proxy.chainName,
                    tokenAddress: tokenInfo.address,
                    tokenSymbol: symbol,
                    balance: balance.toString()
                  })
                }
              } catch (error: any) {
                console.warn(`[DeltaTrade] Failed to get ${symbol} balance on ${chainName}:`, error.message)
              }
            }
          }
        }
      } catch (error: any) {
        console.warn(`[DeltaTrade] Failed to get inventory for ${chainName}:`, error.message)
      }
    }

    return inventory
  }

  /**
   * Calculate P&L from inventory deltas.
   * Compares starting and ending inventory values.
   */
  private calculatePnLFromDeltas(): { totalPnl: number; totalGasCost: number; netPnl: number } {
    // Calculate starting inventory value using simple token price mapping
    let startingValue = 0
    for (const balance of this.startingInventory) {
      const decimals = this.getTokenDecimals(balance.tokenSymbol)
      const amount = Number(formatUnits(balance.balance, decimals))
      const price = balance.balanceUsd ? balance.balanceUsd / amount : 0
      startingValue += amount * price
    }

    // Calculate ending inventory value
    let endingValue = 0
    for (const balance of this.endingInventory) {
      const decimals = this.getTokenDecimals(balance.tokenSymbol)
      const amount = Number(formatUnits(balance.balance, decimals))
      const price = balance.balanceUsd ? balance.balanceUsd / amount : 0
      endingValue += amount * price
    }

    // Estimate gas cost from trade records
    let totalGasCost = 0
    // Gas costs are tracked in the PnL engine and trade records

    const totalPnl = endingValue - startingValue

    console.log(`[DeltaTrade] P&L Calculation:`)
    console.log(`  Starting value: $${startingValue.toFixed(2)}`)
    console.log(`  Ending value: $${endingValue.toFixed(2)}`)
    console.log(`  Total P&L: $${totalPnl.toFixed(2)}`)
    console.log(`  Gas costs: $${totalGasCost.toFixed(2)}`)

    return {
      totalPnl,
      totalGasCost,
      netPnl: totalPnl - totalGasCost
    }
  }

  /**
   * Get token decimals from well-known list
   */
  private getTokenDecimals(symbol: string): number {
    const decimalsMap: Record<string, number> = {
      'ETH': 18,
      'WETH': 18,
      'USDC': 6,
      'USDT': 6,
      'DAI': 18,
      'WBTC': 8
    }
    return decimalsMap[symbol.toUpperCase()] || 18
  }

  /**
   * Get all initialized chain proxies
   */
  private getAllChainProxies(): Record<string, ChainProxy> {
    const proxies: Record<string, ChainProxy> = {}
    const chainNames = ['ethereum', 'base', 'sepolia', 'base-sepolia']

    for (const chainName of chainNames) {
      const proxy = (this as any)[chainName]
      if (proxy instanceof ChainProxy) {
        proxies[chainName] = proxy
      }
    }

    return proxies
  }

  /**
   * Get a specific chain proxy by name
   */
  getChainProxy(chainName: string): ChainProxy | undefined {
    return (this as any)[chainName] instanceof ChainProxy
      ? (this as any)[chainName]
      : undefined
  }

  /**
   * Get all configured chain names
   */
  getConfiguredChains(): string[] {
    return Object.keys(this.getAllChainProxies())
  }
}

/**
 * Factory function to create and initialize a DeltaTrade instance.
 *
 * Automatically loads the accounts configured for the strategy from memory.
 * No passwords or private keys needed in code!
 *
 * IMPORTANT: App must be unlocked before calling this function.
 *
 * @param executionType - Type of execution (e.g., 'arbitrage', 'hedging')
 * @param strategyId - ID of the strategy (must have accounts configured)
 * @returns Initialized DeltaTrade instance with protocols ready
 */
export async function createDeltaTrade(
  executionType: string,
  strategyId: string
): Promise<DeltaTrade> {
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001'

  // Load strategy accounts from memory (populated at unlock)
  const { loadStrategyAccounts } = await import('../../services/strategy-accounts.js')
  const chainPrivateKeys = loadStrategyAccounts(strategyId)

  if (Object.keys(chainPrivateKeys).length === 0) {
    throw new Error(
      `No accounts configured for strategy ${strategyId}. ` +
      'Please configure accounts in the Account Manager before running the strategy.'
    )
  }

  // Create execution in database
  let executionId: string
  try {
    const response = await axios.post(
      `${apiBaseUrl}/api/executions`,
      {
        strategy_id: strategyId,
        execution_type: executionType
      },
      { timeout: 5000 }
    )

    if (!response.data.success) {
      throw new Error('Failed to create execution')
    }

    executionId = response.data.execution.id
  } catch (error: any) {
    // Fallback: generate local execution ID if API is unavailable
    executionId = `exec-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
    console.warn(`[createDeltaTrade] API unavailable, using local execution ID: ${executionId}`)
  }

  console.log(`[createDeltaTrade] Created execution: ${executionId}`)
  console.log(`[createDeltaTrade] Loaded accounts for ${Object.keys(chainPrivateKeys).length} networks`)

  // Create DeltaTrade instance
  const dt = new DeltaTrade(executionId, strategyId, executionType, chainPrivateKeys)

  // Initialize protocols on all chains (async imports)
  await dt.initProtocols()

  // Initialize (capture starting inventory)
  await dt.initialize()

  return dt
}
