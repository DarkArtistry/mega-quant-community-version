/**
 * Binance Options Proxy
 *
 * European-style options trading proxy for Binance Options (eapi.binance.com).
 * Uses HMAC-SHA256 signature for authenticated endpoints.
 * Auto-records trades via OptionsPnlEngine and OrderManager.
 *
 * Single-sided orders: one order per action.
 */

import axios, { AxiosInstance } from 'axios'
import crypto from 'crypto'
import { apiKeyStore } from '../../../services/api-key-store.js'
import { optionsPnlEngine } from '../pnl/OptionsPnlEngine.js'
import { orderManager } from '../orders/OrderManager.js'

export interface OptionsOrderResult {
  orderId: number
  symbol: string
  price: string
  quantity: string
  executedQty: string
  avgPrice: string
  status: string
  side: string
  type: string
  updateTime: number
}

export interface OptionsOrderParams {
  underlying: string
  strikePrice: number
  expiry: string       // e.g., '2026-03-28' or '260328'
  optionType: 'CALL' | 'PUT'
  contracts: number
  price?: number       // For limit orders
  type?: 'LIMIT' | 'MARKET'
}

export interface OptionMarkPrice {
  symbol: string
  markPrice: string
  bidIV: string
  askIV: string
  markIV: string
  delta: string
  gamma: string
  theta: string
  vega: string
  underlyingPrice: string
}

export class BinanceOptionsProxy {
  private readonly baseUrl: string
  private client: AxiosInstance
  private strategyId: string
  private injectedApiKey?: string
  private injectedApiSecret?: string
  private accountId?: string

  constructor(strategyId: string = 'binance-options', options?: { apiKey?: string; apiSecret?: string; testnet?: boolean }, accountId?: string) {
    this.strategyId = strategyId
    this.accountId = accountId
    this.baseUrl = options?.testnet ? 'https://testnet.binanceops.com' : 'https://eapi.binance.com'
    this.injectedApiKey = options?.apiKey
    this.injectedApiSecret = options?.apiSecret
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  // --- Public API ---

  async getMarkPrice(symbol: string): Promise<OptionMarkPrice> {
    const response = await this.client.get('/eapi/v1/mark', {
      params: { symbol: symbol.toUpperCase() }
    })
    return Array.isArray(response.data) ? response.data[0] : response.data
  }

  async getUnderlyingPrice(underlying: string): Promise<number> {
    const response = await this.client.get('/eapi/v1/index', {
      params: { underlying: underlying.toUpperCase() }
    })
    return parseFloat(response.data.indexPrice)
  }

  async getExpirations(underlying: string): Promise<string[]> {
    const response = await this.client.get('/eapi/v1/exchangeInfo')
    const symbols = response.data.optionSymbols || []
    const expirations = new Set<string>()
    for (const s of symbols) {
      if (s.underlying === underlying.toUpperCase()) {
        expirations.add(s.expiryDate?.toString() || '')
      }
    }
    return [...expirations].filter(Boolean).sort()
  }

  // --- Trading ---

  async buyCall(params: OptionsOrderParams): Promise<OptionsOrderResult> {
    return this.placeOrder('BUY', { ...params, optionType: 'CALL' })
  }

  async sellCall(params: OptionsOrderParams): Promise<OptionsOrderResult> {
    return this.placeOrder('SELL', { ...params, optionType: 'CALL' })
  }

  async buyPut(params: OptionsOrderParams): Promise<OptionsOrderResult> {
    return this.placeOrder('BUY', { ...params, optionType: 'PUT' })
  }

  async sellPut(params: OptionsOrderParams): Promise<OptionsOrderResult> {
    return this.placeOrder('SELL', { ...params, optionType: 'PUT' })
  }

  // --- Position Info ---

  async getPositions(underlying?: string): Promise<any[]> {
    const { apiKey, apiSecret } = this.getCredentials()
    const params: Record<string, string> = { timestamp: Date.now().toString() }
    if (underlying) params.underlying = underlying.toUpperCase()
    params.signature = this.sign(params, apiSecret)

    const response = await this.client.get('/eapi/v1/position', {
      params,
      headers: { 'X-MBX-APIKEY': apiKey }
    })
    return response.data
  }

  async getAccountBalance(): Promise<any> {
    const { apiKey, apiSecret } = this.getCredentials()
    const params: Record<string, string> = { timestamp: Date.now().toString() }
    params.signature = this.sign(params, apiSecret)

    const response = await this.client.get('/eapi/v1/account', {
      params,
      headers: { 'X-MBX-APIKEY': apiKey }
    })
    return response.data
  }

  // --- Private Helpers ---

  private buildOptionSymbol(params: OptionsOrderParams): string {
    // Binance option symbol format: ETH-260328-4000-C
    const underlying = params.underlying.toUpperCase()
    const expiry = params.expiry.replace(/-/g, '').slice(2) // '2026-03-28' -> '260328'
    const strike = params.strikePrice.toString()
    const type = params.optionType === 'CALL' ? 'C' : 'P'
    return `${underlying}-${expiry}-${strike}-${type}`
  }

  private async placeOrder(side: 'BUY' | 'SELL', params: OptionsOrderParams): Promise<OptionsOrderResult> {
    const { apiKey, apiSecret } = this.getCredentials()
    const symbol = this.buildOptionSymbol(params)

    const queryParams: Record<string, string> = {
      symbol,
      side,
      type: params.type || 'MARKET',
      quantity: params.contracts.toString(),
      timestamp: Date.now().toString(),
      newOrderRespType: 'RESULT'
    }

    if (params.type === 'LIMIT' && params.price) {
      queryParams.price = params.price.toString()
      queryParams.timeInForce = 'GTC'
    }

    queryParams.signature = this.sign(queryParams, apiSecret)
    const body = new URLSearchParams(queryParams).toString()

    const response = await this.client.post('/eapi/v1/order', body, {
      headers: { 'X-MBX-APIKEY': apiKey }
    })

    const result = response.data as OptionsOrderResult
    this.recordTrade(result, side, params, symbol)
    return result
  }

  private recordTrade(result: OptionsOrderResult, side: 'BUY' | 'SELL', params: OptionsOrderParams, symbol: string): void {
    try {
      const avgPrice = result.avgPrice && result.avgPrice !== '0' ? result.avgPrice : result.price
      const executedQty = result.executedQty || params.contracts.toString()
      const optionSide: 'long' | 'short' = side === 'BUY' ? 'long' : 'short'

      // Record in OrderManager
      const order = orderManager.recordOrder({
        strategyId: this.strategyId,
        orderType: (params.type || 'market').toLowerCase() as any,
        side: side.toLowerCase() as 'buy' | 'sell',
        assetSymbol: symbol,
        protocol: 'binance-options',
        quantity: executedQty,
        price: avgPrice,
        accountId: this.accountId,
        instrumentType: 'option',
        optionType: params.optionType,
        strikePrice: params.strikePrice.toString(),
        expiry: params.expiry,
        underlyingSymbol: params.underlying
      })
      orderManager.updateOrderStatus(order.id, 'filled', {
        filledQuantity: executedQty,
        filledPrice: avgPrice,
        txHash: result.orderId.toString()
      })

      // Record in OptionsPnlEngine
      optionsPnlEngine.processOption({
        strategyId: this.strategyId,
        accountId: this.accountId,
        protocol: 'binance-options',
        underlyingSymbol: params.underlying,
        optionType: params.optionType.toLowerCase() as 'call' | 'put',
        side: optionSide,
        strikePrice: params.strikePrice.toString(),
        expiry: params.expiry,
        action: 'open',
        premium: avgPrice,
        contracts: executedQty
      })

      console.log(`[BinanceOptions] ${side} ${params.optionType} ${params.underlying} strike=${params.strikePrice} exp=${params.expiry} x${executedQty} @ ${avgPrice}`)
    } catch (error: any) {
      console.error('[BinanceOptions] Failed to record trade:', error.message)
    }
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
