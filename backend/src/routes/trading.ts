/**
 * Trading API Routes
 *
 * Manages trading execution lifecycle via TradingExecutionManager and DeltaTrade.
 * Provides endpoints for initializing executions, executing swaps, getting quotes,
 * closing executions, querying balances, and gas prices.
 */

import express from 'express'
import { tradingExecutionManager } from '../lib/trading/TradingExecutionManager.js'
import { formatUnits } from 'ethers'
import { liveDataService } from '../services/live-data.js'

const router = express.Router()

/**
 * GET /api/trading/status
 * Get trading service status
 */
router.get('/status', (req, res) => {
  const activeCount = tradingExecutionManager.getExecutionCount()
  const activeIds = tradingExecutionManager.getActiveExecutions()

  res.json({
    success: true,
    status: activeCount > 0 ? 'active' : 'idle',
    activeExecutions: activeCount,
    executionIds: activeIds,
    message: activeCount > 0
      ? `${activeCount} active trading execution(s)`
      : 'No active trading executions'
  })
})

/**
 * GET /api/trading/executions
 * Get all active executions with details
 */
router.get('/executions', (req, res) => {
  const executionIds = tradingExecutionManager.getActiveExecutions()

  const executions = executionIds.map(id => {
    const exec = tradingExecutionManager.getExecution(id)
    if (!exec) return null
    return {
      executionId: exec.executionId,
      strategyId: exec.strategyId,
      chains: exec.chainConfigs.map(c => c.chainName),
      createdAt: exec.createdAt,
      uptime: Date.now() - exec.createdAt
    }
  }).filter(Boolean)

  res.json({
    success: true,
    count: executions.length,
    executions
  })
})

/**
 * POST /api/trading/init
 * Initialize a new trading execution
 *
 * Body: {
 *   executionType: string,        // e.g., 'arbitrage', 'hedging', 'market-making'
 *   strategyId: string,           // Strategy ID from the strategies table
 *   chainConfigs: Array<{         // Per-chain account configuration
 *     chainName: string,
 *     accountId: string
 *   }>,
 *   masterPassword?: string       // Optional: for direct key decryption (legacy)
 * }
 */
router.post('/init', async (req, res) => {
  try {
    const { executionType, strategyId, chainConfigs, masterPassword } = req.body

    if (!executionType || !strategyId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: executionType, strategyId'
      })
    }

    let executionId: string

    if (masterPassword && chainConfigs && Array.isArray(chainConfigs) && chainConfigs.length > 0) {
      // Validate chain configs
      for (const config of chainConfigs) {
        if (!config.chainName || !config.accountId) {
          return res.status(400).json({
            success: false,
            error: 'Each chainConfig must have chainName and accountId'
          })
        }
      }

      // Legacy mode: decrypt keys directly with master password
      executionId = await tradingExecutionManager.initializeExecution(
        executionType,
        strategyId,
        chainConfigs,
        masterPassword
      )
    } else {
      // Preferred mode: use the account key store (app must be unlocked)
      executionId = await tradingExecutionManager.initializeExecutionFromStore(
        executionType,
        strategyId
      )
    }

    const execution = tradingExecutionManager.getExecution(executionId)

    res.json({
      success: true,
      executionId,
      strategyId,
      chains: execution?.deltaTrade.getConfiguredChains() || [],
      message: 'Trading execution initialized successfully'
    })
  } catch (error: any) {
    console.error('[Trading API] Init error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initialize trading execution'
    })
  }
})

/**
 * POST /api/trading/:executionId/swap
 * Execute a swap via DeltaTrade instance
 *
 * Body: {
 *   chain: string,             // Chain name (e.g., 'ethereum', 'base')
 *   tokenIn: string,           // Token symbol (e.g., 'WETH')
 *   tokenOut: string,          // Token symbol (e.g., 'USDC')
 *   amountIn: string,          // Amount in human-readable units (e.g., '1.5')
 *   slippage?: number,         // Slippage tolerance percentage (default 0.5)
 *   protocol?: string          // Protocol to use: 'uniswapV3', 'uniswapV4', 'oneInch'
 * }
 */
router.post('/:executionId/swap', async (req, res) => {
  try {
    const { executionId } = req.params
    const { chain, tokenIn, tokenOut, amountIn, slippage, protocol } = req.body

    const execution = tradingExecutionManager.getExecution(executionId)
    if (!execution) {
      return res.status(404).json({
        success: false,
        error: `Execution not found: ${executionId}`
      })
    }

    if (!chain || !tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: chain, tokenIn, tokenOut, amountIn'
      })
    }

    // Get the chain proxy from the DeltaTrade instance
    const chainProxy = execution.deltaTrade.getChainProxy(chain)
    if (!chainProxy) {
      return res.status(400).json({
        success: false,
        error: `Chain ${chain} not configured for this execution. Available: ${execution.deltaTrade.getConfiguredChains().join(', ')}`
      })
    }

    // Execute swap using the appropriate protocol
    let result
    if (protocol === 'uniswapV4') {
      result = await chainProxy.swapV4(tokenIn, tokenOut, amountIn, slippage)
    } else {
      // Default to Uniswap V3
      result = await chainProxy.swap(tokenIn, tokenOut, amountIn, slippage)
    }

    // Broadcast trade execution via WebSocket
    liveDataService.broadcastTradeExecution({
      executionId,
      strategyId: execution.strategyId,
      side: 'swap',
      symbol: `${tokenIn}/${tokenOut}`,
      quantity: result.amountIn || amountIn,
      price: result.amountOut || '0',
      timestamp: new Date().toISOString(),
      chain,
      transactionHash: result.transactionHash
    })

    res.json({
      success: true,
      executionId,
      swap: {
        chain,
        tokenIn,
        tokenOut,
        amountIn: result.amountIn,
        amountOut: result.amountOut,
        transactionHash: result.transactionHash,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed,
        gasCostUsd: result.gasCostUsd,
        slippagePercentage: result.slippagePercentage,
        explorerUrl: result.explorerUrl
      }
    })
  } catch (error: any) {
    console.error('[Trading API] Swap error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute swap'
    })
  }
})

/**
 * POST /api/trading/:executionId/quote
 * Get a swap quote without executing
 *
 * Body: {
 *   chain: string,
 *   tokenIn: string,
 *   tokenOut: string,
 *   amountIn: string,
 *   protocol?: string
 * }
 */
router.post('/:executionId/quote', async (req, res) => {
  try {
    const { executionId } = req.params
    const { chain, tokenIn, tokenOut, amountIn, protocol } = req.body

    const execution = tradingExecutionManager.getExecution(executionId)
    if (!execution) {
      return res.status(404).json({
        success: false,
        error: `Execution not found: ${executionId}`
      })
    }

    if (!chain || !tokenIn || !tokenOut || !amountIn) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: chain, tokenIn, tokenOut, amountIn'
      })
    }

    const chainProxy = execution.deltaTrade.getChainProxy(chain)
    if (!chainProxy) {
      return res.status(400).json({
        success: false,
        error: `Chain ${chain} not configured for this execution`
      })
    }

    let quote
    if (protocol === 'uniswapV4') {
      quote = await chainProxy.getSwapQuoteV4(tokenIn, tokenOut, amountIn)
    } else {
      quote = await chainProxy.getSwapQuote(tokenIn, tokenOut, amountIn)
    }

    res.json({
      success: true,
      executionId,
      quote: {
        chain,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: quote.amountOut,
        amountOutMin: quote.amountOutMin,
        priceImpact: quote.priceImpact,
        exchangeRate: quote.exchangeRate,
        gasCostUsd: quote.gasCostUsd
      }
    })
  } catch (error: any) {
    console.error('[Trading API] Quote error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get quote'
    })
  }
})

/**
 * POST /api/trading/:executionId/close
 * Close an execution, calculate P&L, and clean up resources
 */
router.post('/:executionId/close', async (req, res) => {
  try {
    const { executionId } = req.params

    if (!tradingExecutionManager.getExecution(executionId)) {
      return res.status(404).json({
        success: false,
        error: `Execution not found: ${executionId}`
      })
    }

    const result = await tradingExecutionManager.closeExecution(executionId)

    res.json({
      success: true,
      executionId,
      result: {
        status: result.status,
        totalPnl: result.totalPnl,
        totalGasCost: result.totalGasCost,
        netPnl: result.netPnl,
        startingInventoryCount: result.startingInventory?.length || 0,
        endingInventoryCount: result.endingInventory?.length || 0
      }
    })
  } catch (error: any) {
    console.error('[Trading API] Close error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to close execution'
    })
  }
})

/**
 * GET /api/trading/:executionId/balance/:chain/:token
 * Get token balance for a specific chain and token
 */
router.get('/:executionId/balance/:chain/:token', async (req, res) => {
  try {
    const { executionId, chain, token } = req.params

    const execution = tradingExecutionManager.getExecution(executionId)
    if (!execution) {
      return res.status(404).json({
        success: false,
        error: `Execution not found: ${executionId}`
      })
    }

    const chainProxy = execution.deltaTrade.getChainProxy(chain)
    if (!chainProxy) {
      return res.status(400).json({
        success: false,
        error: `Chain ${chain} not configured for this execution`
      })
    }

    const upperToken = token.toUpperCase()

    if (upperToken === 'ETH' || upperToken === 'NATIVE') {
      // Get native balance
      const balance = await chainProxy.getNativeBalance()
      const formatted = formatUnits(balance, 18)

      return res.json({
        success: true,
        executionId,
        chain,
        token: 'ETH',
        balance: balance.toString(),
        formatted,
        decimals: 18
      })
    }

    // Get ERC20 token balance
    const tokenInfo = chainProxy.getTokenInfo(upperToken)
    if (!tokenInfo) {
      return res.status(400).json({
        success: false,
        error: `Token ${token} not found on chain ${chain}. Available: ${chainProxy.getAvailableTokens().join(', ')}`
      })
    }

    const balance = await chainProxy.getTokenBalance(tokenInfo.address)
    const formatted = formatUnits(balance, tokenInfo.decimals)

    res.json({
      success: true,
      executionId,
      chain,
      token: tokenInfo.symbol,
      tokenAddress: tokenInfo.address,
      balance: balance.toString(),
      formatted,
      decimals: tokenInfo.decimals
    })
  } catch (error: any) {
    console.error('[Trading API] Balance error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get balance'
    })
  }
})

/**
 * GET /api/trading/:executionId/gas-price/:chain
 * Get current gas price for a chain
 */
router.get('/:executionId/gas-price/:chain', async (req, res) => {
  try {
    const { executionId, chain } = req.params

    const execution = tradingExecutionManager.getExecution(executionId)
    if (!execution) {
      return res.status(404).json({
        success: false,
        error: `Execution not found: ${executionId}`
      })
    }

    const chainProxy = execution.deltaTrade.getChainProxy(chain)
    if (!chainProxy) {
      return res.status(400).json({
        success: false,
        error: `Chain ${chain} not configured for this execution`
      })
    }

    const gasPriceInfo = await chainProxy.getGasPriceInfo()

    res.json({
      success: true,
      executionId,
      chain,
      gasPrice: gasPriceInfo.gasPrice.toString(),
      gasPriceGwei: gasPriceInfo.gasPriceGwei,
      estimatedSwapGasCostUsd: gasPriceInfo.estimatedSwapGasCostUsd
    })
  } catch (error: any) {
    console.error('[Trading API] Gas price error:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get gas price'
    })
  }
})

export default router
