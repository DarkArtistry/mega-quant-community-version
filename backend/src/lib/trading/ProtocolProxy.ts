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

  constructor(
    chainName: string,
    chainId: number,
    wallet: Wallet,
    protocol: string,
    executionId: string,
    strategyId: string
  ) {
    this.chainName = chainName
    this.chainId = chainId
    this.wallet = wallet
    this.protocol = protocol
    this.executionId = executionId
    this.strategyId = strategyId
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001'
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

      // --- Step 2: Feed PnL Engine ---
      try {
        const { pnlEngine } = await import('./pnl/PnlEngine.js')

        // Determine trade side: if tokenOut is a stablecoin, it's a sell; otherwise it's a buy
        const stablecoins = ['USDC', 'USDT', 'DAI']
        const isSell = stablecoins.includes(tradeData.token_out_symbol.toUpperCase())
        const side: 'buy' | 'sell' = isSell ? 'sell' : 'buy'

        // For a sell, the asset is tokenIn (we're selling tokenIn for stablecoin)
        // For a buy, the asset is tokenOut (we're buying tokenOut with stablecoin)
        const assetSymbol = isSell ? tradeData.token_in_symbol : tradeData.token_out_symbol
        const assetAddress = isSell ? tradeData.token_in_address : tradeData.token_out_address
        const quantity = isSell ? tradeData.token_in_amount : tradeData.token_out_amount

        // Price in USD: for a sell, price = stablecoin_amount / asset_amount
        // For a buy, price = stablecoin_amount / asset_amount
        const stablecoinAmount = isSell
          ? parseFloat(tradeData.token_out_amount)
          : parseFloat(tradeData.token_in_amount)
        const assetAmount = parseFloat(quantity)
        const price = assetAmount > 0 ? (stablecoinAmount / assetAmount).toString() : '0'

        const gasFees = tradeData.gas_cost_usd?.toString() || '0'

        const pnlResult = pnlEngine.processTrade({
          tradeId: response.data?.trade_id || tradeData.tx_hash,
          strategyId: this.strategyId,
          side,
          assetSymbol,
          assetAddress,
          chainId: this.chainId,
          quantity,
          price,
          fees: gasFees
        })

        console.log(`[ProtocolProxy] PnL processed: action=${pnlResult.action}, realizedPnl=$${pnlResult.realizedPnl.toFixed(4)}`)
      } catch (error: any) {
        console.warn(`[ProtocolProxy] PnL engine processing failed:`, error.message)
      }

      // --- Step 3: Record in Order Manager ---
      try {
        const { orderManager } = await import('./orders/OrderManager.js')

        // Determine side (same logic as PnL)
        const stablecoins = ['USDC', 'USDT', 'DAI']
        const isSell = stablecoins.includes(tradeData.token_out_symbol.toUpperCase())
        const side: 'buy' | 'sell' = isSell ? 'sell' : 'buy'
        const assetSymbol = isSell ? tradeData.token_in_symbol : tradeData.token_out_symbol
        const assetAddress = isSell ? tradeData.token_in_address : tradeData.token_out_address
        const quantity = isSell ? tradeData.token_in_amount : tradeData.token_out_amount

        const stablecoinAmount = isSell
          ? parseFloat(tradeData.token_out_amount)
          : parseFloat(tradeData.token_in_amount)
        const assetAmount = parseFloat(quantity)
        const price = assetAmount > 0 ? (stablecoinAmount / assetAmount).toString() : undefined

        const order = orderManager.recordOrder({
          strategyId: this.strategyId,
          orderType: 'market',
          side,
          assetSymbol,
          assetAddress,
          chainId: this.chainId,
          protocol: this.protocol,
          quantity,
          price
        })

        // Immediately fill the market order
        orderManager.updateOrderStatus(order.id, 'filled', {
          filledQuantity: quantity,
          filledPrice: price || '0',
          txHash: tradeData.tx_hash
        })

        console.log(`[ProtocolProxy] Order recorded and filled: ${order.id}`)
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
