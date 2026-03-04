/**
 * Funding Tracker Service
 *
 * Polls Binance Futures for funding payments hourly and records them
 * to the funding_payments table + updates perp_positions.total_funding.
 */

import { getDatabase } from '../../../db/index.js'
import { perpPnlEngine } from '../pnl/PerpPnlEngine.js'
import { apiKeyStore } from '../../../services/api-key-store.js'
import axios from 'axios'
import crypto from 'crypto'

export class FundingTracker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private intervalMs: number
  private running = false

  constructor(intervalMs: number = 60 * 60 * 1000) { // Default 1 hour
    this.intervalMs = intervalMs
  }

  start(): void {
    if (this.intervalHandle) return
    console.log(`[FundingTracker] Starting with interval: ${this.intervalMs / 1000}s`)

    // Run immediately then on interval
    this.poll()
    this.intervalHandle = setInterval(() => this.poll(), this.intervalMs)
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    console.log('[FundingTracker] Stopped')
  }

  private async poll(): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      const db = getDatabase()

      // Get all open perp positions
      const openPositions = db.prepare(`
        SELECT * FROM perp_positions WHERE status = 'open' AND protocol = 'binance-futures'
      `).all() as any[]

      if (openPositions.length === 0) {
        return
      }

      const apiKey = apiKeyStore.getBinanceApiKey()
      const apiSecret = apiKeyStore.getBinanceApiSecret()
      if (!apiKey || !apiSecret) return

      const isTestnet = apiKeyStore.isBinanceTestnet?.() ?? false
      const baseUrl = isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com'

      // Get unique symbols
      const symbols = [...new Set(openPositions.map((p: any) => p.market_symbol))]

      for (const symbol of symbols) {
        try {
          const params: Record<string, string> = {
            symbol: symbol.toUpperCase(),
            incomeType: 'FUNDING_FEE',
            limit: '20',
            timestamp: Date.now().toString()
          }
          const queryString = new URLSearchParams(params).toString()
          const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex')
          params.signature = signature

          const response = await axios.get(`${baseUrl}/fapi/v1/income`, {
            params,
            headers: { 'X-MBX-APIKEY': apiKey },
            timeout: 10_000
          })

          const fundingPayments = response.data as Array<{ symbol: string; income: string; time: number; info: string }>

          for (const payment of fundingPayments) {
            // Check if we already recorded this payment (by timestamp + symbol)
            const existing = db.prepare(`
              SELECT id FROM funding_payments
              WHERE market_symbol = ? AND timestamp = ?
            `).get(symbol, new Date(payment.time).toISOString())

            if (existing) continue

            // Find matching open position
            const matchingPositions = openPositions.filter((p: any) => p.market_symbol === symbol)
            for (const pos of matchingPositions) {
              perpPnlEngine.recordFundingPayment(
                pos.id,
                payment.income,
                payment.info || '0',
                pos.position_size
              )
            }
          }
        } catch (err: any) {
          console.warn(`[FundingTracker] Error polling funding for ${symbol}:`, err.message)
        }
      }

      console.log(`[FundingTracker] Checked funding for ${symbols.length} symbol(s)`)
    } catch (err: any) {
      console.error('[FundingTracker] Poll error:', err.message)
    } finally {
      this.running = false
    }
  }

  isRunning(): boolean {
    return this.intervalHandle !== null
  }
}

export const fundingTracker = new FundingTracker()
