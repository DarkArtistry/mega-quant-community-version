/**
 * Binance Futures Proxy
 *
 * Perpetual futures trading proxy for Binance USDM Futures (fapi.binance.com).
 * Uses HMAC-SHA256 signature for authenticated endpoints.
 * Auto-records trades via PerpPnlEngine and OrderManager.
 *
 * Single-sided orders: one order per action (not linked pairs like spot).
 */

import axios, { AxiosInstance } from 'axios'
import crypto from 'crypto'
import { apiKeyStore } from '../../../services/api-key-store.js'
import { perpPnlEngine } from '../pnl/PerpPnlEngine.js'
import { orderManager } from '../orders/OrderManager.js'

export interface FuturesOrderResult {
  orderId: number
  symbol: string
  status: string
  clientOrderId: string
  price: string
  avgPrice: string
  origQty: string
  executedQty: string
  cumQuote: string
  timeInForce: string
  type: string
  reduceOnly: boolean
  side: string
  positionSide: string
  updateTime: number
}

export interface FuturesPosition {
  symbol: string
  positionAmt: string
  entryPrice: string
  markPrice: string
  unRealizedProfit: string
  liquidationPrice: string
  leverage: string
  marginType: string
  positionSide: string
  notional: string
  isolatedMargin: string
}

export interface FuturesOrderParams {
  symbol: string
  quantity: number
  leverage?: number
  marginType?: 'CROSS' | 'ISOLATED'
  price?: number
  type?: 'LIMIT' | 'MARKET'
  reduceOnly?: boolean
}

export class BinanceFuturesProxy {
  private readonly baseUrl: string
  private client: AxiosInstance
  private strategyId: string
  private injectedApiKey?: string
  private injectedApiSecret?: string
  private accountId?: string

  constructor(strategyId: string = 'binance-futures', options?: { apiKey?: string; apiSecret?: string; testnet?: boolean }, accountId?: string) {
    this.strategyId = strategyId
    this.accountId = accountId
    this.baseUrl = options?.testnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com'
    this.injectedApiKey = options?.apiKey
    this.injectedApiSecret = options?.apiSecret
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  // --- Public API ---

  async getMarkPrice(symbol: string): Promise<{ markPrice: number; indexPrice: number; fundingRate: number }> {
    const response = await this.client.get('/fapi/v1/premiumIndex', {
      params: { symbol: symbol.toUpperCase() }
    })
    return {
      markPrice: parseFloat(response.data.markPrice),
      indexPrice: parseFloat(response.data.indexPrice),
      fundingRate: parseFloat(response.data.lastFundingRate)
    }
  }

  async getFundingRate(symbol: string, limit: number = 10): Promise<Array<{ fundingRate: string; fundingTime: number }>> {
    const response = await this.client.get('/fapi/v1/fundingRate', {
      params: { symbol: symbol.toUpperCase(), limit }
    })
    return response.data
  }

  // --- Leverage & Margin ---

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const { apiKey, apiSecret } = this.getCredentials()
    const params: Record<string, string> = {
      symbol: symbol.toUpperCase(),
      leverage: leverage.toString(),
      timestamp: Date.now().toString()
    }
    params.signature = this.sign(params, apiSecret)

    await this.client.post('/fapi/v1/leverage', new URLSearchParams(params).toString(), {
      headers: { 'X-MBX-APIKEY': apiKey }
    })
    console.log(`[BinanceFutures] Set leverage for ${symbol} to ${leverage}x`)
  }

  async setMarginType(symbol: string, marginType: 'CROSS' | 'ISOLATED'): Promise<void> {
    const { apiKey, apiSecret } = this.getCredentials()
    const params: Record<string, string> = {
      symbol: symbol.toUpperCase(),
      marginType,
      timestamp: Date.now().toString()
    }
    params.signature = this.sign(params, apiSecret)

    try {
      await this.client.post('/fapi/v1/marginType', new URLSearchParams(params).toString(), {
        headers: { 'X-MBX-APIKEY': apiKey }
      })
      console.log(`[BinanceFutures] Set margin type for ${symbol} to ${marginType}`)
    } catch (err: any) {
      // -4046 = No need to change margin type (already set)
      if (err.response?.data?.code !== -4046) throw err
    }
  }

  // --- Trading ---

  async openLong(params: FuturesOrderParams): Promise<FuturesOrderResult> {
    if (params.leverage) await this.setLeverage(params.symbol, params.leverage)
    if (params.marginType) await this.setMarginType(params.symbol, params.marginType)
    return this.placeOrder('BUY', { ...params, reduceOnly: false })
  }

  async closeLong(params: FuturesOrderParams): Promise<FuturesOrderResult> {
    return this.placeOrder('SELL', { ...params, reduceOnly: true })
  }

  async openShort(params: FuturesOrderParams): Promise<FuturesOrderResult> {
    if (params.leverage) await this.setLeverage(params.symbol, params.leverage)
    if (params.marginType) await this.setMarginType(params.symbol, params.marginType)
    return this.placeOrder('SELL', { ...params, reduceOnly: false })
  }

  async closeShort(params: FuturesOrderParams): Promise<FuturesOrderResult> {
    return this.placeOrder('BUY', { ...params, reduceOnly: true })
  }

  // --- Position Info ---

  async getPositions(symbol?: string): Promise<FuturesPosition[]> {
    const { apiKey, apiSecret } = this.getCredentials()
    const params: Record<string, string> = { timestamp: Date.now().toString() }
    if (symbol) params.symbol = symbol.toUpperCase()
    params.signature = this.sign(params, apiSecret)

    const response = await this.client.get('/fapi/v2/positionRisk', {
      params,
      headers: { 'X-MBX-APIKEY': apiKey }
    })
    return response.data.filter((p: any) => parseFloat(p.positionAmt) !== 0)
  }

  async getAccountBalance(): Promise<Array<{ asset: string; balance: string; availableBalance: string }>> {
    const { apiKey, apiSecret } = this.getCredentials()
    const params: Record<string, string> = { timestamp: Date.now().toString() }
    params.signature = this.sign(params, apiSecret)

    const response = await this.client.get('/fapi/v2/balance', {
      params,
      headers: { 'X-MBX-APIKEY': apiKey }
    })
    return response.data
  }

  async getFundingPayments(symbol?: string, limit: number = 100): Promise<Array<{ symbol: string; incomeType: string; income: string; time: number }>> {
    const { apiKey, apiSecret } = this.getCredentials()
    const params: Record<string, string> = {
      incomeType: 'FUNDING_FEE',
      limit: limit.toString(),
      timestamp: Date.now().toString()
    }
    if (symbol) params.symbol = symbol.toUpperCase()
    params.signature = this.sign(params, apiSecret)

    const response = await this.client.get('/fapi/v1/income', {
      params,
      headers: { 'X-MBX-APIKEY': apiKey }
    })
    return response.data
  }

  // --- Private Helpers ---

  private async placeOrder(side: 'BUY' | 'SELL', params: FuturesOrderParams): Promise<FuturesOrderResult> {
    const { apiKey, apiSecret } = this.getCredentials()

    const queryParams: Record<string, string> = {
      symbol: params.symbol.toUpperCase(),
      side,
      type: params.type || 'MARKET',
      quantity: params.quantity.toString(),
      timestamp: Date.now().toString(),
      newOrderRespType: 'RESULT'
    }

    if (params.reduceOnly) queryParams.reduceOnly = 'true'

    if (params.type === 'LIMIT' && params.price) {
      queryParams.price = params.price.toString()
      queryParams.timeInForce = 'GTC'
    }

    queryParams.signature = this.sign(queryParams, apiSecret)
    const body = new URLSearchParams(queryParams).toString()

    const response = await this.client.post('/fapi/v1/order', body, {
      headers: { 'X-MBX-APIKEY': apiKey }
    })

    const result = response.data as FuturesOrderResult
    this.recordTrade(result, side, params)
    return result
  }

  private recordTrade(result: FuturesOrderResult, side: 'BUY' | 'SELL', params: FuturesOrderParams): void {
    try {
      const isReduceOnly = params.reduceOnly ?? false
      const positionSide = this.derivePositionSide(side, isReduceOnly)
      const action = isReduceOnly ? 'close' : 'open'
      const perpSide: 'long' | 'short' = positionSide === 'LONG' ? 'long' : 'short'

      const avgPrice = result.avgPrice && result.avgPrice !== '0' ? result.avgPrice : result.price
      const executedQty = result.executedQty

      // Record in OrderManager (single order, not linked pair)
      const order = orderManager.recordOrder({
        strategyId: this.strategyId,
        orderType: (params.type || 'market').toLowerCase() as any,
        side: side.toLowerCase() as 'buy' | 'sell',
        assetSymbol: result.symbol,
        protocol: 'binance-futures',
        quantity: executedQty,
        price: avgPrice,
        accountId: this.accountId,
        instrumentType: 'perp',
        positionSide,
        leverage: params.leverage,
        reduceOnly: isReduceOnly,
        marginType: params.marginType
      })
      orderManager.updateOrderStatus(order.id, 'filled', {
        filledQuantity: executedQty,
        filledPrice: avgPrice,
        txHash: result.orderId.toString()
      })

      // Record in PerpPnlEngine
      perpPnlEngine.processPerp({
        strategyId: this.strategyId,
        accountId: this.accountId,
        protocol: 'binance-futures',
        marketSymbol: result.symbol,
        action,
        side: perpSide,
        price: avgPrice,
        size: executedQty,
        leverage: params.leverage,
        marginType: params.marginType
      })

      console.log(`[BinanceFutures] ${action} ${perpSide} ${executedQty} ${result.symbol} @ ${avgPrice}`)
    } catch (error: any) {
      console.error('[BinanceFutures] Failed to record trade:', error.message)
    }
  }

  private derivePositionSide(side: 'BUY' | 'SELL', reduceOnly: boolean): string {
    if (side === 'BUY' && !reduceOnly) return 'LONG'
    if (side === 'SELL' && reduceOnly) return 'LONG'
    if (side === 'SELL' && !reduceOnly) return 'SHORT'
    return 'SHORT' // BUY + reduceOnly = closing short
  }

  private getCredentials(): { apiKey: string; apiSecret: string } {
    const apiKey = this.injectedApiKey || apiKeyStore.getBinanceApiKey()
    const apiSecret = this.injectedApiSecret || apiKeyStore.getBinanceApiSecret()
    if (!apiKey || !apiSecret) {
      throw new Error('Binance API credentials not configured.')
    }
    return { apiKey, apiSecret }
  }

  private sign(params: Record<string, string>, secret: string): string {
    const queryString = new URLSearchParams(params).toString()
    return crypto.createHmac('sha256', secret).update(queryString).digest('hex')
  }
}
