// Base class for all protocol implementations
// Ported from reference with enhanced slippage tracking, PnL engine integration, and order manager integration

import { Wallet } from 'ethers'
import axios from 'axios'

export interface SwapParams {
  tokenIn: string      // Token symbol (e.g., 'WETH') or address
  tokenOut: string     // Token symbol (e.g., 'USDC') or address
  amountIn: string     // Amount in token units (e.g., '1.5')
  slippage?: number    // Percentage, default 0.5%
  deadline?: number    // Seconds from now, default 300 (5 min)
}

export interface SwapResult {
  success: boolean
  transactionHash: string
  blockNumber: number
  amountIn: string
  amountOut: string
  gasUsed: number
  gasCostUsd: number
  timestamp: number
  explorerUrl: string

  // Slippage tracking fields (optional - populated when quote data is available)
  expectedOutput?: string       // Quote-time expected output
  actualOutput?: string         // Actual on-chain output
  slippageAmount?: string       // Difference between expected and actual
  slippagePercentage?: number   // Slippage as percentage
  executionPrice?: number       // Actual execution price (tokenOut/tokenIn)
  quotePrice?: number           // Quoted price before execution
}

export interface QuoteParams {
  tokenIn: string    // Token symbol (e.g., 'WETH')
  tokenOut: string   // Token symbol (e.g., 'USDC')
  amountIn: string   // Amount in token units (e.g., '1.5')
}

export interface QuoteResult {
  amountOut: string            // Expected output amount
  amountOutMin: string         // Min output with default slippage
  priceImpact: number          // Price impact percentage
  exchangeRate: number         // TokenOut per TokenIn
  gasCostUsd?: number          // Estimated gas cost in USD
}

export abstract class ProtocolProxy {
  protected chainName: string
  protected chainId: number
  protected wallet: Wallet
  protected protocol: string
  protected executionId: string
  protected strategyId: string
  protected apiBaseUrl: string
  protected accountId?: string

  constructor(
    chainName: string,
    chainId: number,
    wallet: Wallet,
    protocol: string,
    executionId: string,
    strategyId: string,
    accountId?: string
  ) {
    this.chainName = chainName
    this.chainId = chainId
    this.wallet = wallet
    this.protocol = protocol
    this.executionId = executionId
    this.strategyId = strategyId
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001'
    this.accountId = accountId
  }

  // Abstract methods that must be implemented by protocol-specific classes
  abstract swap(params: SwapParams): Promise<SwapResult>
  abstract getQuote(params: QuoteParams): Promise<QuoteResult>

  /**
   * Record a completed trade in the database, PnL engine, and order manager.
   *
   * This is the central integration point that:
   * 1. Posts trade data to /api/trades
   * 2. Feeds the PnL engine (FIFO cost basis)
   * 3. Records/updates orders in the order manager
   * 4. Broadcasts trade execution via WebSocket
   */
  protected async recordTrade(tradeData: {
    tx_hash: string
    block_number: number
    token_in_address: string
    token_in_symbol: string
    token_in_amount: string
    token_out_address: string
    token_out_symbol: string
    token_out_amount: string
    gas_used: number
    gas_price_gwei: string
    gas_cost_usd?: number
    // Slippage tracking
    expected_output?: string
    actual_output?: string
    slippage_amount?: string
    slippage_percentage?: number
    execution_price?: number
    quote_price?: number
    // Block timestamp for accurate PnL time-series
    block_timestamp?: string
    // Write-ahead intent order ID to clean up after successful recording
    intentOrderId?: string | null
  }): Promise<void> {
    try {
      // --- Step 1: Post trade to API ---
      const payload = {
        execution_id: this.executionId,
        strategy_id: this.strategyId,
        wallet_address: this.wallet.address,
        chain_id: this.chainId,
        protocol: this.protocol,
        ...tradeData
      }

      console.log(`[ProtocolProxy] Recording trade: ${tradeData.tx_hash}`)

      const response = await axios.post(
        `${this.apiBaseUrl}/api/trades`,
        payload,
        { timeout: 5000 }
      )

      if (response.data.success) {
        console.log(`[ProtocolProxy] Trade recorded: ID ${response.data.trade_id || 'unknown'}`)
      } else {
        console.error(`[ProtocolProxy] Failed to record trade:`, response.data.error)
      }

      // --- Step 2: Feed PnL Engine (BOTH sides) ---
      // In DeFi, both sides of a swap are different tokens.
      // We track positions for both tokens; the PnlSnapshotter values everything in USD.
      try {
        const { pnlEngine } = await import('./pnl/PnlEngine.js')

        const stablecoins = ['USDC', 'USDT', 'DAI']
        const tokenInAmt = parseFloat(tradeData.token_in_amount)
        const tokenOutAmt = parseFloat(tradeData.token_out_amount)
        const gasFees = tradeData.gas_cost_usd?.toString() || '0'
        const timestamp = tradeData.block_timestamp || new Date().toISOString()
        const tradeId = response.data?.trade_id || tradeData.tx_hash

        // Compute USD prices where possible
        const tokenInIsStable = stablecoins.includes(tradeData.token_in_symbol.toUpperCase())
        const tokenOutIsStable = stablecoins.includes(tradeData.token_out_symbol.toUpperCase())

        // Price of token_in in USD
        let tokenInPriceUsd: string
        if (tokenInIsStable) {
          tokenInPriceUsd = '1'
        } else if (tokenOutIsStable && tokenInAmt > 0) {
          tokenInPriceUsd = (tokenOutAmt / tokenInAmt).toString()
        } else {
          tokenInPriceUsd = '0' // Snapshotter will update with real market price
        }

        // Price of token_out in USD
        let tokenOutPriceUsd: string
        if (tokenOutIsStable) {
          tokenOutPriceUsd = '1'
        } else if (tokenInIsStable && tokenOutAmt > 0) {
          tokenOutPriceUsd = (tokenInAmt / tokenOutAmt).toString()
        } else {
          tokenOutPriceUsd = '0' // Snapshotter will update with real market price
        }

        // Side 1: SELL token_in (position decreases) — gas fees attributed here
        const sellResult = pnlEngine.processTrade({
          tradeId: `${tradeId}-sell`,
          strategyId: this.strategyId,
          side: 'sell',
          assetSymbol: tradeData.token_in_symbol,
          assetAddress: tradeData.token_in_address,
          chainId: this.chainId,
          quantity: tradeData.token_in_amount,
          price: tokenInPriceUsd,
          fees: gasFees,
          timestamp,
          accountId: this.accountId,
          quoteAssetSymbol: tradeData.token_out_symbol,
          protocol: this.protocol
        })

        // Side 2: BUY token_out (position increases) — no fees
        const buyResult = pnlEngine.processTrade({
          tradeId: `${tradeId}-buy`,
          strategyId: this.strategyId,
          side: 'buy',
          assetSymbol: tradeData.token_out_symbol,
          assetAddress: tradeData.token_out_address,
          chainId: this.chainId,
          quantity: tradeData.token_out_amount,
          price: tokenOutPriceUsd,
          fees: '0',
          timestamp,
          accountId: this.accountId,
          quoteAssetSymbol: tradeData.token_in_symbol,
          protocol: this.protocol
        })

        console.log(`[ProtocolProxy] PnL: SELL ${tradeData.token_in_symbol} (${sellResult.action}, PnL=$${sellResult.realizedPnl.toFixed(4)}) + BUY ${tradeData.token_out_symbol} (${buyResult.action})`)
      } catch (error: any) {
        console.warn(`[ProtocolProxy] PnL engine processing failed:`, error.message)
      }

      // --- Step 3: Record BOTH sides in Order Manager ---
      // A swap is two-sided: SELL token_in and BUY token_out
      try {
        const { orderManager } = await import('./orders/OrderManager.js')

        // Calculate prices: use the exchange rate between the two tokens
        const tokenInAmt = parseFloat(tradeData.token_in_amount)
        const tokenOutAmt = parseFloat(tradeData.token_out_amount)
        const sellPrice = tokenOutAmt > 0 && tokenInAmt > 0 ? (tokenOutAmt / tokenInAmt).toString() : undefined
        const buyPrice = tokenInAmt > 0 && tokenOutAmt > 0 ? (tokenInAmt / tokenOutAmt).toString() : undefined

        // Order 1: SELL token_in (what we gave up) — full gas fees here
        const sellOrder = orderManager.recordOrder({
          strategyId: this.strategyId,
          orderType: 'market',
          side: 'sell',
          assetSymbol: tradeData.token_in_symbol,
          assetAddress: tradeData.token_in_address,
          chainId: this.chainId,
          protocol: this.protocol,
          quantity: tradeData.token_in_amount,
          price: sellPrice,
          gasCostUsd: tradeData.gas_cost_usd,
          gasUsed: tradeData.gas_used,
          tokenInSymbol: tradeData.token_in_symbol,
          tokenInAmount: tradeData.token_in_amount,
          tokenOutSymbol: tradeData.token_out_symbol,
          tokenOutAmount: tradeData.token_out_amount,
          slippagePercentage: tradeData.slippage_percentage,
          blockNumber: tradeData.block_number,
          accountId: this.accountId
        })
        orderManager.updateOrderStatus(sellOrder.id, 'filled', {
          filledQuantity: tradeData.token_in_amount,
          filledPrice: sellPrice || '0',
          txHash: tradeData.tx_hash
        })

        // Order 2: BUY token_out (what we received) — no fees (linked to sell order)
        const buyOrder = orderManager.recordOrder({
          strategyId: this.strategyId,
          orderType: 'market',
          side: 'buy',
          assetSymbol: tradeData.token_out_symbol,
          assetAddress: tradeData.token_out_address,
          chainId: this.chainId,
          protocol: this.protocol,
          quantity: tradeData.token_out_amount,
          price: buyPrice,
          tokenInSymbol: tradeData.token_in_symbol,
          tokenInAmount: tradeData.token_in_amount,
          tokenOutSymbol: tradeData.token_out_symbol,
          tokenOutAmount: tradeData.token_out_amount,
          slippagePercentage: tradeData.slippage_percentage,
          blockNumber: tradeData.block_number,
          accountId: this.accountId,
          linkedOrderId: sellOrder.id
        })
        orderManager.updateOrderStatus(buyOrder.id, 'filled', {
          filledQuantity: tradeData.token_out_amount,
          filledPrice: buyPrice || '0',
          txHash: tradeData.tx_hash
        })

        // Back-link the sell order to the buy order
        orderManager.setLinkedOrderId(sellOrder.id, buyOrder.id)

        console.log(`[ProtocolProxy] Swap orders recorded: SELL ${tradeData.token_in_symbol} (${sellOrder.id}) ↔ BUY ${tradeData.token_out_symbol} (${buyOrder.id})`)

        // Clean up write-ahead intent order now that proper orders are recorded
        if (tradeData.intentOrderId) {
          try {
            const db = (await import('../../db/index.js')).getDatabase()
            db.prepare('DELETE FROM orders WHERE id = ? AND status IN (?, ?)').run(tradeData.intentOrderId, 'submitted', 'pending')
          } catch {}
        }
      } catch (error: any) {
        console.warn(`[ProtocolProxy] Order manager recording failed:`, error.message)
      }

      // --- Step 4: Broadcast via WebSocket ---
      try {
        // Dynamic import to avoid circular dependency - broadcast is optional
        const wsModule = await import('../../services/live-data.js').catch(() => null)
        if (wsModule?.liveDataService) {
          // Determine side for broadcast (buy tokenOut = buy)
          const stables = ['USDC', 'USDT', 'DAI']
          const broadcastSide = stables.includes(tradeData.token_out_symbol.toUpperCase()) ? 'sell' : 'buy'
          const broadcastSymbol = broadcastSide === 'sell' ? tradeData.token_in_symbol : tradeData.token_out_symbol
          const broadcastQty = broadcastSide === 'sell' ? tradeData.token_in_amount : tradeData.token_out_amount
          const broadcastStableAmt = broadcastSide === 'sell'
            ? parseFloat(tradeData.token_out_amount)
            : parseFloat(tradeData.token_in_amount)
          const broadcastAssetAmt = parseFloat(broadcastQty)
          const broadcastPrice = broadcastAssetAmt > 0 ? (broadcastStableAmt / broadcastAssetAmt).toString() : '0'

          wsModule.liveDataService.broadcastTradeExecution({
            executionId: this.executionId,
            strategyId: this.strategyId,
            side: broadcastSide,
            symbol: broadcastSymbol,
            quantity: broadcastQty,
            price: broadcastPrice,
            chainId: this.chainId,
            protocol: this.protocol,
            txHash: tradeData.tx_hash,
            tokenIn: tradeData.token_in_symbol,
            tokenInAmount: tradeData.token_in_amount,
            tokenOut: tradeData.token_out_symbol,
            tokenOutAmount: tradeData.token_out_amount,
            slippagePercentage: tradeData.slippage_percentage,
            timestamp: new Date().toISOString()
          })
        }
      } catch (error: any) {
        console.warn(`[ProtocolProxy] Failed to broadcast trade execution:`, error.message)
      }
    } catch (error: any) {
      // Don't fail the swap if recording fails
      console.error(`[ProtocolProxy] Error recording trade:`, error.message)
    }
  }

  /**
   * Calculate slippage between expected and actual output.
   * Also computes quotePrice and executionPrice when amountIn is provided.
   */
  protected calculateSlippage(
    expectedOutput: string,
    actualOutput: string,
    amountIn?: string
  ): {
    slippageAmount: string
    slippagePercentage: number
    quotePrice: number
    executionPrice: number
  } {
    const expected = parseFloat(expectedOutput)
    const actual = parseFloat(actualOutput)
    const inputAmount = amountIn ? parseFloat(amountIn) : 0

    if (expected === 0) {
      return { slippageAmount: '0', slippagePercentage: 0, quotePrice: 0, executionPrice: 0 }
    }

    const slippageAmount = (expected - actual).toFixed(8)
    const slippagePercentage = ((expected - actual) / expected) * 100

    // Price = amountOut / amountIn (how many output tokens per input token)
    const quotePrice = inputAmount > 0 ? expected / inputAmount : 0
    const executionPrice = inputAmount > 0 ? actual / inputAmount : 0

    return { slippageAmount, slippagePercentage, quotePrice, executionPrice }
  }
}
