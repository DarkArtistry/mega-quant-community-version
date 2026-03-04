/**
 * Binance Proxy
 * Spot trading proxy for Binance REST API (api.binance.com).
 * Uses HMAC-SHA256 signature for authenticated endpoints.
 * Auto-records trades via PnlEngine and OrderManager.
 */

import axios, { AxiosInstance } from 'axios'
import crypto from 'crypto'
import { apiKeyStore } from '../../../services/api-key-store.js'
import { pnlEngine } from '../pnl/PnlEngine.js'
import { orderManager } from '../orders/OrderManager.js'

// --- Type Definitions ---

export interface OrderBook {
  lastUpdateId: number
  bids: [string, string][] // [price, quantity][]
  asks: [string, string][] // [price, quantity][]
}

export interface BinanceOrderResult {
  symbol: string
  orderId: number
  orderListId: number
  clientOrderId: string
  transactTime: number
  price: string
  origQty: string
  executedQty: string
  cummulativeQuoteQty: string
  status: string
  timeInForce: string
  type: string
  side: string
  fills: Array<{
    price: string
    qty: string
    commission: string
    commissionAsset: string
    tradeId: number
  }>
}

export interface BinanceOrderParams {
  symbol: string
  type: 'LIMIT' | 'MARKET'
  price?: number
  quantity: number
}

// --- Binance Proxy Class ---

export interface BinanceProxyOptions {
  testnet?: boolean
  apiKey?: string
  apiSecret?: string
}

export class BinanceProxy {
  private readonly baseUrl: string
  private client: AxiosInstance
  private strategyId: string
  private injectedApiKey?: string
  private injectedApiSecret?: string
  private accountId?: string

  constructor(strategyId: string = 'binance-spot', options?: BinanceProxyOptions, accountId?: string) {
    this.strategyId = strategyId
    this.accountId = accountId
    this.baseUrl = options?.testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com'
    this.injectedApiKey = options?.apiKey
    this.injectedApiSecret = options?.apiSecret
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
  }

  // --- Public API (No Auth Required) ---

  /**
   * Get the current price for a symbol.
   * GET /api/v3/ticker/price
   */
  async getPrice(symbol: string): Promise<number> {
    const response = await this.client.get('/api/v3/ticker/price', {
      params: { symbol: symbol.toUpperCase() }
    })
    return parseFloat(response.data.price)
  }

  /**
   * Get the order book for a symbol.
   * GET /api/v3/depth
   */
  async getOrderBook(symbol: string, limit: number = 20): Promise<OrderBook> {
    const response = await this.client.get('/api/v3/depth', {
      params: {
        symbol: symbol.toUpperCase(),
        limit
      }
    })
    return response.data as OrderBook
  }

  // --- Authenticated Endpoints ---

  /**
   * Place a buy order.
   */
  async buy(params: BinanceOrderParams): Promise<BinanceOrderResult> {
    return this.placeOrder('BUY', params)
  }

  /**
   * Place a sell order.
   */
  async sell(params: BinanceOrderParams): Promise<BinanceOrderResult> {
    return this.placeOrder('SELL', params)
  }

  /**
   * Cancel an open order.
   * DELETE /api/v3/order
   */
  async cancelOrder(symbol: string, orderId: number): Promise<any> {
    const { apiKey, apiSecret } = this.getCredentials()

    const queryParams: Record<string, string> = {
      symbol: symbol.toUpperCase(),
      orderId: orderId.toString(),
      timestamp: Date.now().toString()
    }

    const signature = this.sign(queryParams, apiSecret)
    queryParams.signature = signature

    const response = await this.client.delete('/api/v3/order', {
      params: queryParams,
      headers: {
        'X-MBX-APIKEY': apiKey
      }
    })

    // Update order status in local tracking
    try {
      orderManager.updateOrderStatus(orderId.toString(), 'cancelled')
    } catch (err) {
      // Order might not be tracked locally
    }

    return response.data
  }

  /**
   * Get all open orders, optionally filtered by symbol.
   * GET /api/v3/openOrders
   */
  async getOpenOrders(symbol?: string): Promise<any[]> {
    const { apiKey, apiSecret } = this.getCredentials()

    const queryParams: Record<string, string> = {
      timestamp: Date.now().toString()
    }

    if (symbol) {
      queryParams.symbol = symbol.toUpperCase()
    }

    const signature = this.sign(queryParams, apiSecret)
    queryParams.signature = signature

    const response = await this.client.get('/api/v3/openOrders', {
      params: queryParams,
      headers: {
        'X-MBX-APIKEY': apiKey
      }
    })

    return response.data
  }

  // --- Private Helpers ---

  /**
   * Place an order (buy or sell) on Binance.
   * POST /api/v3/order
   */
  private async placeOrder(
    side: 'BUY' | 'SELL',
    params: BinanceOrderParams
  ): Promise<BinanceOrderResult> {
    const { apiKey, apiSecret } = this.getCredentials()

    const queryParams: Record<string, string> = {
      symbol: params.symbol.toUpperCase(),
      side,
      type: params.type,
      quantity: params.quantity.toString(),
      timestamp: Date.now().toString(),
      newOrderRespType: 'FULL'
    }

    if (params.type === 'LIMIT') {
      if (!params.price) {
        throw new Error('Price is required for LIMIT orders')
      }
      queryParams.price = params.price.toString()
      queryParams.timeInForce = 'GTC'
    }

    const signature = this.sign(queryParams, apiSecret)
    queryParams.signature = signature

    // Build query string for POST body
    const body = new URLSearchParams(queryParams).toString()

    const response = await this.client.post('/api/v3/order', body, {
      headers: {
        'X-MBX-APIKEY': apiKey
      }
    })

    const result = response.data as BinanceOrderResult

    // Auto-record the trade via PnlEngine and OrderManager
    this.recordTrade(result, side)

    return result
  }

  /**
   * Record a completed trade in the PnlEngine and OrderManager.
   * Records BOTH sides of the trade (sell token_in + buy token_out).
   */
  private recordTrade(result: BinanceOrderResult, side: 'BUY' | 'SELL'): void {
    try {
      const baseAsset = this.extractBaseAsset(result.symbol)
      const quoteAsset = this.extractQuoteAsset(result.symbol)

      // Calculate total fees
      const totalFees = result.fills.reduce((sum, fill) => {
        return sum + parseFloat(fill.commission)
      }, 0)

      // Calculate average fill price
      const totalQty = parseFloat(result.executedQty)
      const totalQuoteQty = parseFloat(result.cummulativeQuoteQty)
      const avgPrice = totalQty > 0 ? totalQuoteQty / totalQty : 0

      // Derive token in/out from side
      const tokenInSymbol = side === 'BUY' ? quoteAsset : baseAsset
      const tokenInAmount = side === 'BUY' ? result.cummulativeQuoteQty : result.executedQty
      const tokenOutSymbol = side === 'BUY' ? baseAsset : quoteAsset
      const tokenOutAmount = side === 'BUY' ? result.executedQty : result.cummulativeQuoteQty

      const txHash = result.orderId.toString()
      const orderType = result.type.toLowerCase() as 'market' | 'limit'

      // --- Record BOTH sides in OrderManager ---
      const inAmt = parseFloat(tokenInAmount)
      const outAmt = parseFloat(tokenOutAmount)
      const sellPrice = outAmt > 0 && inAmt > 0 ? (outAmt / inAmt).toString() : '0'
      const buyPrice = inAmt > 0 && outAmt > 0 ? (inAmt / outAmt).toString() : '0'

      // Order 1: SELL token_in (what we gave up) — fees attributed here
      const sellOrder = orderManager.recordOrder({
        strategyId: this.strategyId,
        orderType,
        side: 'sell',
        assetSymbol: tokenInSymbol,
        protocol: 'binance',
        quantity: tokenInAmount,
        price: sellPrice,
        commission: totalFees.toString(),
        commissionAsset: result.fills[0]?.commissionAsset || undefined,
        tokenInSymbol,
        tokenInAmount,
        tokenOutSymbol,
        tokenOutAmount,
        accountId: this.accountId
      })
      orderManager.updateOrderStatus(sellOrder.id, 'filled', {
        filledQuantity: tokenInAmount,
        filledPrice: sellPrice,
        txHash
      })

      // Order 2: BUY token_out (what we received) — no fees, linked to sell
      const buyOrder = orderManager.recordOrder({
        strategyId: this.strategyId,
        orderType,
        side: 'buy',
        assetSymbol: tokenOutSymbol,
        protocol: 'binance',
        quantity: tokenOutAmount,
        price: buyPrice,
        tokenInSymbol,
        tokenInAmount,
        tokenOutSymbol,
        tokenOutAmount,
        accountId: this.accountId,
        linkedOrderId: sellOrder.id
      })
      orderManager.updateOrderStatus(buyOrder.id, 'filled', {
        filledQuantity: tokenOutAmount,
        filledPrice: buyPrice,
        txHash
      })

      // Back-link sell → buy
      orderManager.setLinkedOrderId(sellOrder.id, buyOrder.id)

      console.log(
        `[BinanceProxy] Swap orders: SELL ${tokenInAmount} ${tokenInSymbol} (${sellOrder.id}) ↔ BUY ${tokenOutAmount} ${tokenOutSymbol} (${buyOrder.id})`
      )

      // --- Process BOTH sides in PnlEngine ---
      // DeFi model: track positions for both tokens, snapshotter values in USD
      const timestamp = new Date(result.transactTime).toISOString()
      const tradeIdBase = result.orderId.toString()

      const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD']
      const tokenInIsStable = stablecoins.includes(tokenInSymbol.toUpperCase())
      const tokenOutIsStable = stablecoins.includes(tokenOutSymbol.toUpperCase())

      // Compute USD prices
      const pnlInAmt = parseFloat(tokenInAmount)
      const pnlOutAmt = parseFloat(tokenOutAmount)
      const tokenInPriceUsd = tokenInIsStable ? '1' : (tokenOutIsStable && pnlInAmt > 0 ? (pnlOutAmt / pnlInAmt).toString() : avgPrice.toString())
      const tokenOutPriceUsd = tokenOutIsStable ? '1' : (tokenInIsStable && pnlOutAmt > 0 ? (pnlInAmt / pnlOutAmt).toString() : (1 / avgPrice).toString())

      // Side 1: SELL token_in — fees attributed here
      const sellPnl = pnlEngine.processTrade({
        tradeId: `${tradeIdBase}-sell`,
        strategyId: this.strategyId,
        side: 'sell',
        assetSymbol: tokenInSymbol,
        quantity: tokenInAmount,
        price: tokenInPriceUsd,
        fees: totalFees.toString(),
        timestamp,
        accountId: this.accountId,
        quoteAssetSymbol: tokenOutSymbol,
        protocol: 'binance'
      })

      // Side 2: BUY token_out — no fees
      const buyPnl = pnlEngine.processTrade({
        tradeId: `${tradeIdBase}-buy`,
        strategyId: this.strategyId,
        side: 'buy',
        assetSymbol: tokenOutSymbol,
        quantity: tokenOutAmount,
        price: tokenOutPriceUsd,
        fees: '0',
        timestamp,
        accountId: this.accountId,
        quoteAssetSymbol: tokenInSymbol,
        protocol: 'binance'
      })

      console.log(
        `[BinanceProxy] PnL: SELL ${tokenInAmount} ${tokenInSymbol} (${sellPnl.action}) + BUY ${tokenOutAmount} ${tokenOutSymbol} (${buyPnl.action})`
      )
    } catch (error: any) {
      console.error('[BinanceProxy] Failed to record trade:', error.message)
    }
  }

  /**
   * Extract the base asset from a Binance trading pair symbol.
   * Examples: ETHUSDT -> ETH, BTCUSDC -> BTC, LINKETH -> LINK
   */
  private extractBaseAsset(symbol: string): string {
    const quoteAssets = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB', 'TUSD', 'FDUSD']
    for (const quote of quoteAssets) {
      if (symbol.endsWith(quote)) {
        return symbol.slice(0, -quote.length)
      }
    }
    return symbol
  }

  /**
   * Extract the quote asset from a Binance trading pair symbol.
   * Examples: ETHUSDT -> USDT, BTCUSDC -> USDC
   */
  private extractQuoteAsset(symbol: string): string {
    const quoteAssets = ['USDT', 'USDC', 'BUSD', 'TUSD', 'FDUSD', 'BTC', 'ETH', 'BNB']
    for (const quote of quoteAssets) {
      if (symbol.endsWith(quote)) {
        return quote
      }
    }
    return 'USDT'
  }

  /**
   * Get Binance API credentials from the api-key-store.
   */
  private getCredentials(): { apiKey: string; apiSecret: string } {
    // Use injected credentials first (from DeltaTrade), fall back to api-key-store
    const apiKey = this.injectedApiKey || apiKeyStore.getBinanceApiKey()
    const apiSecret = this.injectedApiSecret || apiKeyStore.getBinanceApiSecret()

    if (!apiKey || !apiSecret) {
      throw new Error(
        'Binance API credentials not configured. Please set binanceApiKey and binanceApiSecret in the API key store.'
      )
    }

    return { apiKey, apiSecret }
  }

  /**
   * Create an HMAC-SHA256 signature for Binance authenticated requests.
   */
  private sign(params: Record<string, string>, secret: string): string {
    const queryString = new URLSearchParams(params).toString()
    return crypto
      .createHmac('sha256', secret)
      .update(queryString)
      .digest('hex')
  }
}

// Factory function for convenience
export function createBinanceProxy(strategyId?: string, options?: BinanceProxyOptions): BinanceProxy {
  return new BinanceProxy(strategyId, options)
}
