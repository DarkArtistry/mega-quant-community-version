/**
 * PnL Aggregator
 *
 * Combines PnL from all 4 engines (Spot, Perps, Options, Lending) into a unified view.
 * Provides getTotalPnl() that returns a breakdown by instrument type.
 */

import { pnlEngine, type PnlSummary } from './PnlEngine.js'
import { perpPnlEngine, type PerpPnlSummary } from './PerpPnlEngine.js'
import { optionsPnlEngine, type OptionsPnlSummary } from './OptionsPnlEngine.js'
import { lendingPnlEngine, type LendingPnlSummary } from './LendingPnlEngine.js'

export interface AggregatedPnl {
  // Totals across all instruments
  totalRealizedPnl: number
  totalUnrealizedPnl: number
  totalPnl: number
  totalOpenPositions: number

  // Per-instrument breakdown
  spot: PnlSummary
  perps: PerpPnlSummary
  options: OptionsPnlSummary
  lending: LendingPnlSummary
}

export class PnlAggregator {
  /**
   * Get combined PnL across all instrument types.
   * Optionally filtered by strategy.
   */
  getTotalPnl(strategyId?: string): AggregatedPnl {
    const spot = pnlEngine.getTotalPnl(strategyId)
    const perps = perpPnlEngine.getTotalPnl(strategyId)
    const options = optionsPnlEngine.getTotalPnl(strategyId)
    const lending = lendingPnlEngine.getTotalPnl(strategyId)

    const totalRealizedPnl =
      spot.totalRealizedPnl +
      perps.totalRealizedPnl +
      options.totalRealizedPnl +
      lending.totalRealizedPnl

    const totalUnrealizedPnl =
      spot.totalUnrealizedPnl +
      perps.totalUnrealizedPnl +
      options.totalUnrealizedPnl +
      lending.totalAccruedInterest

    const totalOpenPositions =
      spot.openPositionsCount +
      perps.openPositionsCount +
      options.openPositionsCount +
      lending.openPositionsCount

    return {
      totalRealizedPnl,
      totalUnrealizedPnl,
      totalPnl: totalRealizedPnl + totalUnrealizedPnl,
      totalOpenPositions,
      spot,
      perps,
      options,
      lending
    }
  }

  /**
   * Update unrealized PnL across all engines with current market prices.
   */
  updateAllUnrealizedPnl(
    spotPrices: Record<string, number>,
    perpPrices: Record<string, number>,
    optionPremiums: Record<string, number>
  ): void {
    pnlEngine.updateUnrealizedPnl(spotPrices)
    perpPnlEngine.updateUnrealizedPnl(perpPrices)
    optionsPnlEngine.updateUnrealizedPnl(optionPremiums)
    // Lending interest accrual is handled by AaveInterestTracker via liquidity index
  }
}

export const pnlAggregator = new PnlAggregator()
