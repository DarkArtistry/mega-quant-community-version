/**
 * TWAP (Time-Weighted Average Price) Service
 *
 * Backend keeper that splits large swaps into smaller slices executed at regular intervals.
 * Each slice is a regular V4 swap. The service manages timers, tracks progress,
 * and records each slice as a separate trade.
 */

import { v4 as uuidv4 } from 'uuid'

export interface TwapConfig {
  strategyId: string
  chainName: string
  tokenIn: string
  tokenOut: string
  totalAmount: string
  numSlices: number
  intervalMs: number
  maxSlippage: number     // bps (50 = 0.5%)
  swapFn: (amountIn: string, slippage: number) => Promise<{ amountOut: string; transactionHash: string }>
}

export interface TwapState {
  id: string
  config: TwapConfig
  status: 'active' | 'completed' | 'cancelled' | 'failed'
  slicesTotal: number
  slicesExecuted: number
  slicesFailed: number
  totalAmountIn: string
  totalAmountOut: number
  startedAt: string
  estimatedEndAt: string
  lastSliceAt?: string
  timer?: ReturnType<typeof setInterval>
}

class TwapService {
  private executions = new Map<string, TwapState>()

  /**
   * Start a new TWAP execution.
   * Returns a twapId for tracking.
   */
  startTwap(config: TwapConfig): string {
    const id = uuidv4()
    const sliceAmount = (parseFloat(config.totalAmount) / config.numSlices).toString()
    const estimatedEndAt = new Date(Date.now() + config.intervalMs * config.numSlices).toISOString()

    const state: TwapState = {
      id,
      config,
      status: 'active',
      slicesTotal: config.numSlices,
      slicesExecuted: 0,
      slicesFailed: 0,
      totalAmountIn: config.totalAmount,
      totalAmountOut: 0,
      startedAt: new Date().toISOString(),
      estimatedEndAt,
    }

    this.executions.set(id, state)

    console.log(`[TwapService] Started TWAP ${id}: ${config.totalAmount} ${config.tokenIn} -> ${config.tokenOut} in ${config.numSlices} slices every ${config.intervalMs}ms`)

    // Execute first slice immediately
    this.executeSlice(id, sliceAmount)

    // Schedule remaining slices
    if (config.numSlices > 1) {
      const timer = setInterval(() => {
        const current = this.executions.get(id)
        if (!current || current.status !== 'active') {
          clearInterval(timer)
          return
        }

        if (current.slicesExecuted + current.slicesFailed >= current.slicesTotal) {
          // All slices done
          current.status = current.slicesFailed === current.slicesTotal ? 'failed' : 'completed'
          clearInterval(timer)
          console.log(`[TwapService] TWAP ${id} ${current.status}: ${current.slicesExecuted}/${current.slicesTotal} slices executed`)
          return
        }

        this.executeSlice(id, sliceAmount)
      }, config.intervalMs)

      state.timer = timer
    }

    return id
  }

  /**
   * Execute a single TWAP slice.
   */
  private async executeSlice(twapId: string, sliceAmount: string): Promise<void> {
    const state = this.executions.get(twapId)
    if (!state || state.status !== 'active') return

    const sliceIndex = state.slicesExecuted + state.slicesFailed + 1
    console.log(`[TwapService] Executing slice ${sliceIndex}/${state.slicesTotal} for TWAP ${twapId}: ${sliceAmount} ${state.config.tokenIn}`)

    try {
      const slippagePercent = state.config.maxSlippage / 100 // bps to %
      const result = await state.config.swapFn(sliceAmount, slippagePercent)

      state.slicesExecuted++
      state.totalAmountOut += parseFloat(result.amountOut)
      state.lastSliceAt = new Date().toISOString()

      console.log(`[TwapService] Slice ${sliceIndex} completed: ${result.amountOut} ${state.config.tokenOut} (tx: ${result.transactionHash})`)

      // Check if all slices are done
      if (state.slicesExecuted + state.slicesFailed >= state.slicesTotal) {
        state.status = 'completed'
        if (state.timer) clearInterval(state.timer)
        console.log(`[TwapService] TWAP ${twapId} completed: ${state.slicesExecuted}/${state.slicesTotal} slices, total out: ${state.totalAmountOut}`)
      }
    } catch (error: any) {
      state.slicesFailed++
      console.error(`[TwapService] Slice ${sliceIndex} failed for TWAP ${twapId}:`, error.message)

      // If all slices have been attempted (success + fail), mark as done
      if (state.slicesExecuted + state.slicesFailed >= state.slicesTotal) {
        state.status = state.slicesExecuted > 0 ? 'completed' : 'failed'
        if (state.timer) clearInterval(state.timer)
      }
    }
  }

  /**
   * Get the current status of a TWAP execution.
   */
  getStatus(twapId: string): {
    twapId: string
    status: 'active' | 'completed' | 'cancelled' | 'failed'
    slicesTotal: number
    slicesExecuted: number
    slicesFailed: number
    totalAmountIn: string
    totalAmountOut: string
    averagePrice: string
    startedAt: string
    estimatedEndAt: string
    lastSliceAt?: string
  } {
    const state = this.executions.get(twapId)
    if (!state) {
      throw new Error(`TWAP execution ${twapId} not found`)
    }

    const totalIn = parseFloat(state.totalAmountIn)
    const totalOut = state.totalAmountOut
    const averagePrice = state.slicesExecuted > 0 && totalIn > 0
      ? (totalOut / (totalIn * state.slicesExecuted / state.slicesTotal)).toString()
      : '0'

    return {
      twapId: state.id,
      status: state.status,
      slicesTotal: state.slicesTotal,
      slicesExecuted: state.slicesExecuted,
      slicesFailed: state.slicesFailed,
      totalAmountIn: state.totalAmountIn,
      totalAmountOut: totalOut.toString(),
      averagePrice,
      startedAt: state.startedAt,
      estimatedEndAt: state.estimatedEndAt,
      lastSliceAt: state.lastSliceAt,
    }
  }

  /**
   * Cancel a running TWAP execution.
   * Remaining slices will not execute. Already-executed slices are not reversed.
   */
  cancel(twapId: string): void {
    const state = this.executions.get(twapId)
    if (!state) {
      throw new Error(`TWAP execution ${twapId} not found`)
    }

    if (state.status !== 'active') {
      throw new Error(`TWAP ${twapId} is already ${state.status}`)
    }

    state.status = 'cancelled'
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = undefined
    }

    console.log(`[TwapService] TWAP ${twapId} cancelled after ${state.slicesExecuted}/${state.slicesTotal} slices`)
  }

  /**
   * Get all active TWAP executions.
   */
  getActive(): string[] {
    const active: string[] = []
    for (const [id, state] of this.executions) {
      if (state.status === 'active') active.push(id)
    }
    return active
  }

  /**
   * Shutdown — cancel all active executions.
   */
  shutdown(): void {
    for (const [id, state] of this.executions) {
      if (state.status === 'active') {
        state.status = 'cancelled'
        if (state.timer) clearInterval(state.timer)
      }
    }
    console.log('[TwapService] Shutdown — all active TWAPs cancelled')
  }
}

// Singleton
export const twapService = new TwapService()
