/**
 * Options Expiry Checker Service
 *
 * Periodically checks for expired options positions and settles them.
 * ITM options are exercised (settlement value), OTM options expire worthless.
 * Runs hourly.
 */

import { optionsPnlEngine } from '../pnl/OptionsPnlEngine.js'
import { priceService } from '../services/PriceService.js'

export class OptionsExpiryChecker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private intervalMs: number
  private running = false

  constructor(intervalMs: number = 60 * 60 * 1000) { // Default 1 hour
    this.intervalMs = intervalMs
  }

  start(): void {
    if (this.intervalHandle) return
    console.log(`[OptionsExpiryChecker] Starting with interval: ${this.intervalMs / 1000}s`)

    this.check()
    this.intervalHandle = setInterval(() => this.check(), this.intervalMs)
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    console.log('[OptionsExpiryChecker] Stopped')
  }

  private async check(): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      const expiredPositions = optionsPnlEngine.getExpiredOpenPositions()

      if (expiredPositions.length === 0) {
        return
      }

      console.log(`[OptionsExpiryChecker] Found ${expiredPositions.length} expired option(s) to settle`)

      // Get underlying spot prices for all expired positions
      const underlyings = [...new Set(expiredPositions.map(p => p.underlyingSymbol))]
      let spotPrices: Record<string, number> = {}

      try {
        spotPrices = await priceService.getMultiplePricesUSD(underlyings)
      } catch (err: any) {
        console.warn('[OptionsExpiryChecker] Could not fetch spot prices:', err.message)
        return
      }

      for (const position of expiredPositions) {
        const spotPrice = spotPrices[position.underlyingSymbol]
        if (spotPrice === undefined) {
          console.warn(`[OptionsExpiryChecker] No spot price for ${position.underlyingSymbol}, skipping`)
          continue
        }

        try {
          const result = optionsPnlEngine.processOption({
            strategyId: position.strategyId || '',
            accountId: position.accountId || undefined,
            protocol: position.protocol,
            underlyingSymbol: position.underlyingSymbol,
            optionType: position.optionType,
            side: position.side,
            strikePrice: position.strikePrice,
            expiry: position.expiry,
            action: 'expire',
            premium: '0',
            contracts: position.contracts,
            spotPrice: spotPrice.toString(),
            positionId: position.id
          })

          console.log(`[OptionsExpiryChecker] Settled ${position.optionType} ${position.underlyingSymbol} strike=${position.strikePrice}: ${result.action}, PnL=$${result.realizedPnl.toFixed(2)}`)
        } catch (err: any) {
          console.error(`[OptionsExpiryChecker] Error settling position ${position.id}:`, err.message)
        }
      }
    } catch (err: any) {
      console.error('[OptionsExpiryChecker] Check error:', err.message)
    } finally {
      this.running = false
    }
  }

  isRunning(): boolean {
    return this.intervalHandle !== null
  }
}

export const optionsExpiryChecker = new OptionsExpiryChecker()
