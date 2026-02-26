/**
 * PnL Routes
 *
 * PnL hierarchy:
 *   /api/pnl/total                          → Global (all accounts, all strategies)
 *   /api/pnl/total?strategy_id=X            → Per-strategy (all accounts within strategy X)
 *   /api/pnl/total?account_id=X             → Per-account (across all strategies)
 *   /api/pnl/total?strategy_id=X&account_id=Y → Specific strategy + account
 *   /api/pnl/breakdown                       → Full breakdown by strategy AND by account
 *   /api/pnl/hourly                          → Hourly snapshots (filterable)
 *   /api/pnl/positions                       → Open positions (filterable)
 */

import express from 'express'
import { getDatabase } from '../db/index.js'
import { pnlEngine } from '../lib/trading/pnl/PnlEngine.js'

const router = express.Router()

/**
 * GET /api/pnl/hourly
 * Hourly PnL snapshots, filterable by strategy_id and/or account_id
 */
router.get('/hourly', (req, res) => {
  try {
    const { strategy_id, account_id, hours = '24' } = req.query
    const db = getDatabase()
    const hoursNum = parseInt(hours as string, 10) || 24

    let sql = `
      SELECT * FROM pnl_snapshots
      WHERE timestamp >= datetime('now', ?)
    `
    const params: any[] = [`-${hoursNum} hours`]

    if (strategy_id) {
      sql += ' AND strategy_id = ?'
      params.push(strategy_id)
    } else {
      // Global snapshots have NULL strategy_id and NULL account_id
      if (!account_id) {
        sql += ' AND strategy_id IS NULL AND account_id IS NULL'
      }
    }

    if (account_id) {
      sql += ' AND account_id = ?'
      params.push(account_id)
    }

    sql += ' ORDER BY timestamp ASC'

    const snapshots = db.prepare(sql).all(...params)

    res.json({
      success: true,
      snapshots,
      count: snapshots.length,
      hours: hoursNum
    })
  } catch (error: any) {
    console.error('[PnL] Error fetching hourly snapshots:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch hourly PnL snapshots'
    })
  }
})

/**
 * GET /api/pnl/total
 * Total PnL summary. Supports filtering:
 *   - No params: global PnL across ALL accounts and ALL strategies
 *   - strategy_id: PnL for one strategy across all its accounts
 *   - account_id: PnL for one account across all strategies
 *   - Both: PnL for a specific strategy + account combination
 */
router.get('/total', (req, res) => {
  try {
    const { strategy_id, account_id } = req.query
    const db = getDatabase()

    // Build dynamic WHERE clause
    const conditions: string[] = ['1=1']
    const positionParams: any[] = []
    const tradeParams: any[] = []

    if (strategy_id) {
      conditions.push('strategy_id = ?')
      positionParams.push(strategy_id)
      tradeParams.push(strategy_id)
    }
    if (account_id) {
      conditions.push('account_id = ?')
      positionParams.push(account_id)
      tradeParams.push(account_id)
    }

    const whereClause = conditions.join(' AND ')

    // Position-based PnL (FIFO)
    const positionSummary = db.prepare(`
      SELECT
        COALESCE(SUM(CAST(realized_pnl AS REAL)), 0) as total_realized_pnl,
        COALESCE(SUM(CAST(unrealized_pnl AS REAL)), 0) as total_unrealized_pnl,
        COALESCE(SUM(CAST(total_fees AS REAL)), 0) as total_fees,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_positions,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_positions
      FROM positions
      WHERE ${whereClause}
    `).get(...positionParams) as any

    // Trade-based metrics
    const tradeSummary = db.prepare(`
      SELECT
        COUNT(*) as total_trades,
        COALESCE(SUM(value_in_usd), 0) as total_volume_in,
        COALESCE(SUM(value_out_usd), 0) as total_volume_out,
        COALESCE(SUM(profit_loss_usd), 0) as trade_pnl,
        COALESCE(SUM(gas_cost_usd), 0) as total_gas_cost
      FROM trades
      WHERE ${whereClause.replace('account_id', 'account_id')}
    `).get(...tradeParams) as any

    const totalPnl = positionSummary.total_realized_pnl + positionSummary.total_unrealized_pnl

    res.json({
      success: true,
      summary: {
        totalPnl,
        realizedPnl: positionSummary.total_realized_pnl,
        unrealizedPnl: positionSummary.total_unrealized_pnl,
        totalFees: positionSummary.total_fees,
        openPositions: positionSummary.open_positions,
        closedPositions: positionSummary.closed_positions,
        totalTrades: tradeSummary.total_trades,
        totalVolumeIn: tradeSummary.total_volume_in,
        totalVolumeOut: tradeSummary.total_volume_out,
        tradePnl: tradeSummary.trade_pnl,
        totalGasCost: tradeSummary.total_gas_cost,
        netPnl: totalPnl - tradeSummary.total_gas_cost
      },
      filters: {
        strategyId: strategy_id || null,
        accountId: account_id || null,
        scope: !strategy_id && !account_id ? 'global' : strategy_id && account_id ? 'strategy+account' : strategy_id ? 'strategy' : 'account'
      }
    })
  } catch (error: any) {
    console.error('[PnL] Error fetching total PnL:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch total PnL summary'
    })
  }
})

/**
 * GET /api/pnl/breakdown
 * Full PnL breakdown by strategy AND by account.
 * Returns the complete hierarchy for dashboard/analytics.
 */
router.get('/breakdown', (req, res) => {
  try {
    const db = getDatabase()

    // Global totals
    const global = pnlEngine.getTotalPnl()

    // Per-strategy breakdown
    const strategies = db.prepare(`
      SELECT DISTINCT strategy_id FROM positions WHERE strategy_id IS NOT NULL
    `).all() as Array<{ strategy_id: string }>

    const byStrategy = strategies.map(({ strategy_id }) => {
      const pnl = pnlEngine.getTotalPnl(strategy_id)
      const strategy = db.prepare('SELECT name FROM strategies WHERE id = ?').get(strategy_id) as any
      return {
        strategyId: strategy_id,
        strategyName: strategy?.name || strategy_id,
        ...pnl
      }
    })

    // Per-account breakdown
    const accounts = db.prepare(`
      SELECT DISTINCT account_id FROM positions WHERE account_id IS NOT NULL
    `).all() as Array<{ account_id: string }>

    const byAccount = accounts.map(({ account_id }) => {
      const pnl = pnlEngine.getAccountPnl(account_id)
      const account = db.prepare('SELECT name, address FROM accounts WHERE id = ?').get(account_id) as any
      return {
        accountId: account_id,
        accountName: account?.name || account_id,
        address: account?.address || null,
        ...pnl
      }
    })

    res.json({
      success: true,
      global,
      byStrategy,
      byAccount,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('[PnL] Error fetching breakdown:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch PnL breakdown'
    })
  }
})

/**
 * GET /api/pnl/positions
 * Open positions, filterable by strategy_id and/or account_id
 */
router.get('/positions', (req, res) => {
  try {
    const { strategy_id, account_id, status = 'open' } = req.query
    const db = getDatabase()

    const conditions: string[] = ['1=1']
    const params: any[] = []

    if (strategy_id) {
      conditions.push('strategy_id = ?')
      params.push(strategy_id)
    }

    if (account_id) {
      conditions.push('account_id = ?')
      params.push(account_id)
    }

    if (status !== 'all') {
      conditions.push('status = ?')
      params.push(status)
    }

    const sql = `
      SELECT * FROM positions
      WHERE ${conditions.join(' AND ')}
      ORDER BY opened_at DESC
    `

    const positions = db.prepare(sql).all(...params)

    res.json({
      success: true,
      positions,
      count: positions.length
    })
  } catch (error: any) {
    console.error('[PnL] Error fetching positions:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch positions'
    })
  }
})

export default router
