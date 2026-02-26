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

export class BinanceProxy {
  private readonly baseUrl = 'https://api.binance.com'
  private client: AxiosInstance
  private strategyId: string

  constructor(strategyId: string = 'binance-spot') {
    this.strategyId = strategyId
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
   */
  private recordTrade(result: BinanceOrderResult, side: 'BUY' | 'SELL'): void {
    try {
      // Extract base asset symbol from the trading pair (e.g., ETHUSDT -> ETH)
      const baseAsset = this.extractBaseAsset(result.symbol)

      // Calculate total fees
      const totalFees = result.fills.reduce((sum, fill) => {
        return sum + parseFloat(fill.commission)
      }, 0)

      // Calculate average fill price
      const totalQty = parseFloat(result.executedQty)
      const totalQuoteQty = parseFloat(result.cummulativeQuoteQty)
      const avgPrice = totalQty > 0 ? totalQuoteQty / totalQty : 0

      // Record in OrderManager
      const order = orderManager.recordOrder({
        strategyId: this.strategyId,
        orderType: result.type.toLowerCase() as 'market' | 'limit',
        side: side.toLowerCase() as 'buy' | 'sell',
        assetSymbol: baseAsset,
        protocol: 'binance',
        quantity: result.executedQty,
        price: avgPrice.toString()
      })

      // Update order to filled status
      orderManager.updateOrderStatus(order.id, 'filled', {
        filledQuantity: result.executedQty,
        filledPrice: avgPrice.toString(),
        txHash: result.orderId.toString()
      })

      // Process in PnlEngine
      if (totalQty > 0) {
        pnlEngine.processTrade({
          tradeId: result.orderId,
          strategyId: this.strategyId,
          side: side.toLowerCase() as 'buy' | 'sell',
          assetSymbol: baseAsset,
          quantity: result.executedQty,
          price: avgPrice.toString(),
          fees: totalFees.toString(),
          timestamp: new Date(result.transactTime).toISOString()
        })
      }

      console.log(
        `[BinanceProxy] Trade recorded: ${side} ${result.executedQty} ${baseAsset} @ ${avgPrice.toFixed(4)} (fees: ${totalFees.toFixed(6)})`
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
   * Get Binance API credentials from the api-key-store.
   */
  private getCredentials(): { apiKey: string; apiSecret: string } {
    const apiKey = apiKeyStore.getBinanceApiKey()
    const apiSecret = apiKeyStore.getBinanceApiSecret()

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
export function createBinanceProxy(strategyId?: string): BinanceProxy {
  return new BinanceProxy(strategyId)
}
