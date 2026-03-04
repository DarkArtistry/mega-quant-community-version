/**
 * PnL Snapshotter
 *
 * Takes periodic (hourly) snapshots of PnL and position state.
 * Stores snapshots in the pnl_snapshots table for historical tracking.
 */

import { getDatabase } from '../../../db/index.js'
import { v4 as uuidv4 } from 'uuid'
import { pnlEngine } from './PnlEngine.js'
import { priceService } from '../services/PriceService.js'

export class PnlSnapshotter {
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private intervalMs: number

  /**
   * @param intervalMs - Snapshot interval in milliseconds (default: 1 hour)
   */
  constructor(intervalMs: number = 60 * 60 * 1000) {
    this.intervalMs = intervalMs
  }

  /**
   * Start the periodic snapshot timer.
   */
  start(): void {
    if (this.intervalHandle) {
      console.warn('[PnlSnapshotter] Already running')
      return
    }

    console.log(`[PnlSnapshotter] Starting with interval: ${this.intervalMs / 1000}s`)

    // Take an initial full snapshot immediately
    this.takeAllSnapshots()

    // Then take snapshots at the configured interval
    this.intervalHandle = setInterval(() => {
      this.takeAllSnapshots()
    }, this.intervalMs)
  }

  /**
   * Stop the periodic snapshot timer.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
      console.log('[PnlSnapshotter] Stopped')
    }
  }

  /**
   * Take snapshots at all levels: global, per-strategy, per-account.
   * Refreshes unrealized PnL from current market prices before snapshotting.
   */
  async takeAllSnapshots(): Promise<void> {
    // 0. Refresh unrealized PnL with current prices
    try {
      const openPositions = pnlEngine.getPositions(undefined, 'open')
      const symbols = [...new Set(openPositions.map(p => p.assetSymbol))]

      if (symbols.length > 0) {
        const priceMap = await priceService.getMultiplePricesUSD(symbols)
        pnlEngine.updateUnrealizedPnl(priceMap)
        console.log(`[PnlSnapshotter] Refreshed unrealized PnL for ${symbols.length} assets`)
      }
    } catch (error: any) {
      console.warn('[PnlSnapshotter] Failed to refresh unrealized PnL:', error.message)
    }

    // 1. Global snapshot (all accounts, all strategies)
    this.takeSnapshot()

    // 2. Per-strategy snapshots
    try {
      const db = getDatabase()
      const strategies = db.prepare(`
        SELECT DISTINCT strategy_id FROM positions WHERE strategy_id IS NOT NULL
      `).all() as Array<{ strategy_id: string }>

      for (const { strategy_id } of strategies) {
        this.takeSnapshot(strategy_id)
      }
    } catch (error: any) {
      console.error('[PnlSnapshotter] Error taking per-strategy snapshots:', error.message)
    }
  }

  /**
   * Take a snapshot of the current PnL and position state.
   * Captures total value, realized/unrealized PnL, and position count.
   *
   * Optionally scoped to a specific strategy.
   * Also creates per-account snapshots by grouping positions by account_id.
   */
  takeSnapshot(strategyId?: string): void {
    try {
      const db = getDatabase()

      const summary = pnlEngine.getTotalPnl(strategyId)

      // Calculate total value from positions
      let totalValueUsd = 0

      const openPositions = db.prepare(`
        SELECT quantity, current_price, avg_entry_price, side, account_id
        FROM positions
        WHERE status = 'open' ${strategyId ? 'AND strategy_id = ?' : ''}
      `).all(...(strategyId ? [strategyId] : [])) as any[]

      for (const pos of openPositions) {
        const qty = parseFloat(pos.quantity)
        const price = parseFloat(pos.current_price || pos.avg_entry_price || '0')
        totalValueUsd += qty * price
      }

      const snapshotId = uuidv4()
      const timestamp = new Date().toISOString()

      // Global (or strategy-level) snapshot
      db.prepare(`
        INSERT INTO pnl_snapshots (
          id, timestamp, strategy_id,
          total_value_usd, realized_pnl_usd, unrealized_pnl_usd,
          total_pnl_usd, positions_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshotId,
        timestamp,
        strategyId || null,
        totalValueUsd,
        summary.totalRealizedPnl,
        summary.totalUnrealizedPnl,
        summary.totalPnl,
        summary.openPositionsCount
      )

      console.log(
        `[PnlSnapshotter] Snapshot taken: ` +
        `value=$${totalValueUsd.toFixed(2)}, ` +
        `realized=$${summary.totalRealizedPnl.toFixed(2)}, ` +
        `unrealized=$${summary.totalUnrealizedPnl.toFixed(2)}, ` +
        `positions=${summary.openPositionsCount}`
      )

      // Per-account snapshots: group positions by account_id
      this.takeAccountSnapshots(strategyId, timestamp)

    } catch (error: any) {
      console.error('[PnlSnapshotter] Error taking snapshot:', error.message)
    }
  }

  /**
   * Take per-account snapshots by grouping positions by account_id.
   * Each unique account_id gets its own snapshot row.
   */
  private takeAccountSnapshots(strategyId?: string, timestamp?: string): void {
    try {
      const db = getDatabase()
      const ts = timestamp || new Date().toISOString()

      // Get distinct account_ids with open positions
      let accountSql = `
        SELECT DISTINCT account_id
        FROM positions
        WHERE status = 'open' AND account_id IS NOT NULL
      `
      const accountParams: any[] = []

      if (strategyId) {
        accountSql += ' AND strategy_id = ?'
        accountParams.push(strategyId)
      }

      const accounts = db.prepare(accountSql).all(...accountParams) as Array<{ account_id: string }>

      for (const { account_id: accountId } of accounts) {
        const accountPnl = pnlEngine.getAccountPnl(accountId)

        // Calculate total value for this account
        let accountValueUsd = 0

        let posSql = `
          SELECT quantity, current_price, avg_entry_price, side
          FROM positions
          WHERE status = 'open' AND account_id = ?
        `
        const posParams: any[] = [accountId]

        if (strategyId) {
          posSql += ' AND strategy_id = ?'
          posParams.push(strategyId)
        }

        const accountPositions = db.prepare(posSql).all(...posParams) as any[]

        for (const pos of accountPositions) {
          const qty = parseFloat(pos.quantity)
          const price = parseFloat(pos.current_price || pos.avg_entry_price || '0')
          accountValueUsd += qty * price
        }

        // Look up account name if possible
        let accountName: string | null = null
        try {
          const accountRow = db.prepare('SELECT name FROM accounts WHERE id = ?').get(accountId) as any
          if (accountRow) {
            accountName = accountRow.name
          }
        } catch {
          // CEX accounts (cex-binance etc.) won't be in the accounts table
          accountName = accountId
        }

        const accountSnapshotId = uuidv4()

        db.prepare(`
          INSERT INTO pnl_snapshots (
            id, timestamp, strategy_id,
            total_value_usd, realized_pnl_usd, unrealized_pnl_usd,
            total_pnl_usd, positions_count,
            account_id, account_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          accountSnapshotId,
          ts,
          strategyId || null,
          accountValueUsd,
          accountPnl.totalRealizedPnl,
          accountPnl.totalUnrealizedPnl,
          accountPnl.totalPnl,
          accountPnl.openPositionsCount,
          accountId,
          accountName
        )

        console.log(
          `[PnlSnapshotter] Account snapshot: ${accountId} ` +
          `value=$${accountValueUsd.toFixed(2)}, ` +
          `realized=$${accountPnl.totalRealizedPnl.toFixed(2)}, ` +
          `positions=${accountPnl.openPositionsCount}`
        )
      }
    } catch (error: any) {
      console.error('[PnlSnapshotter] Error taking account snapshots:', error.message)
    }
  }

  /**
   * Check if the snapshotter is running.
   */
  isRunning(): boolean {
    return this.intervalHandle !== null
  }
}

// Singleton instance with 1-hour default interval
export const pnlSnapshotter = new PnlSnapshotter()
