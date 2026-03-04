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
import { buildPositionsNetworkFilter, parseNetworkParam, type NetworkFilter } from '../lib/utils/network-filter.js'

const router = express.Router()

/**
 * GET /api/pnl/hourly
 * Hourly PnL snapshots, filterable by strategy_id and/or account_id
 */
router.get('/hourly', (req, res) => {
  try {
    const { strategy_id, account_id, hours = '24', network } = req.query
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

    // Filter by network column (defaults to 'all' for backwards compatibility)
    const net = parseNetworkParam(network)
    sql += ' AND network = ?'
    params.push(net)

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
    const { strategy_id, account_id, network } = req.query
    const db = getDatabase()
    const netFilter = buildPositionsNetworkFilter(parseNetworkParam(network))

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
        COALESCE(SUM(CAST(p.realized_pnl AS REAL)), 0) as total_realized_pnl,
        COALESCE(SUM(CAST(p.unrealized_pnl AS REAL)), 0) as total_unrealized_pnl,
        COALESCE(SUM(CAST(p.total_fees AS REAL)), 0) as total_fees,
        COUNT(CASE WHEN p.status = 'open' THEN 1 END) as open_positions,
        COUNT(CASE WHEN p.status = 'closed' THEN 1 END) as closed_positions
      FROM positions p
      WHERE ${whereClause.replace(/strategy_id/g, 'p.strategy_id').replace(/account_id/g, 'p.account_id')}${netFilter.clause}
    `).get(...positionParams, ...netFilter.params) as any

    // Trade-based metrics
    const tradeSummary = db.prepare(`
      SELECT
        COUNT(*) as total_trades,
        COALESCE(SUM(value_in_usd), 0) as total_volume_in,
        COALESCE(SUM(value_out_usd), 0) as total_volume_out,
        COALESCE(SUM(profit_loss_usd), 0) as trade_pnl,
        COALESCE(SUM(gas_cost_usd), 0) as total_gas_cost
      FROM trades
      WHERE ${whereClause}
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
    const { network } = req.query
    const net = parseNetworkParam(network)
    const db = getDatabase()

    if (net === 'all') {
      // Use PnlEngine for unfiltered breakdown (original behavior)
      const global = pnlEngine.getTotalPnl()

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

      return res.json({
        success: true,
        global,
        byStrategy,
        byAccount,
        timestamp: new Date().toISOString()
      })
    }

    // Filtered breakdown — query positions table directly with network filter
    const netFilter = buildPositionsNetworkFilter(net)

    const globalRow = db.prepare(`
      SELECT
        COALESCE(SUM(CAST(p.realized_pnl AS REAL)), 0) as total_realized,
        COALESCE(SUM(CASE WHEN p.status = 'open' THEN CAST(COALESCE(p.unrealized_pnl, '0') AS REAL) ELSE 0 END), 0) as total_unrealized,
        COUNT(CASE WHEN p.status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN p.status = 'closed' THEN 1 END) as closed_count
      FROM positions p
      WHERE 1=1${netFilter.clause}
    `).get(...netFilter.params) as any

    const global = {
      totalRealizedPnl: globalRow.total_realized,
      totalUnrealizedPnl: globalRow.total_unrealized,
      totalPnl: globalRow.total_realized + globalRow.total_unrealized,
      openPositionsCount: globalRow.open_count,
      closedPositionsCount: globalRow.closed_count,
    }

    const strategyRows = db.prepare(`
      SELECT DISTINCT p.strategy_id FROM positions p WHERE p.strategy_id IS NOT NULL${netFilter.clause}
    `).all(...netFilter.params) as Array<{ strategy_id: string }>

    const byStrategy = strategyRows.map(({ strategy_id }) => {
      const row = db.prepare(`
        SELECT
          COALESCE(SUM(CAST(p.realized_pnl AS REAL)), 0) as total_realized,
          COALESCE(SUM(CASE WHEN p.status = 'open' THEN CAST(COALESCE(p.unrealized_pnl, '0') AS REAL) ELSE 0 END), 0) as total_unrealized,
          COUNT(CASE WHEN p.status = 'open' THEN 1 END) as open_count,
          COUNT(CASE WHEN p.status = 'closed' THEN 1 END) as closed_count
        FROM positions p
        WHERE p.strategy_id = ?${netFilter.clause}
      `).get(strategy_id, ...netFilter.params) as any
      const strategy = db.prepare('SELECT name FROM strategies WHERE id = ?').get(strategy_id) as any
      return {
        strategyId: strategy_id,
        strategyName: strategy?.name || strategy_id,
        totalRealizedPnl: row.total_realized,
        totalUnrealizedPnl: row.total_unrealized,
        totalPnl: row.total_realized + row.total_unrealized,
        openPositionsCount: row.open_count,
        closedPositionsCount: row.closed_count,
      }
    })

    const accountRows = db.prepare(`
      SELECT DISTINCT p.account_id FROM positions p WHERE p.account_id IS NOT NULL${netFilter.clause}
    `).all(...netFilter.params) as Array<{ account_id: string }>

    const byAccount = accountRows.map(({ account_id }) => {
      const row = db.prepare(`
        SELECT
          COALESCE(SUM(CAST(p.realized_pnl AS REAL)), 0) as total_realized,
          COALESCE(SUM(CASE WHEN p.status = 'open' THEN CAST(COALESCE(p.unrealized_pnl, '0') AS REAL) ELSE 0 END), 0) as total_unrealized,
          COUNT(CASE WHEN p.status = 'open' THEN 1 END) as open_count,
          COUNT(CASE WHEN p.status = 'closed' THEN 1 END) as closed_count
        FROM positions p
        WHERE p.account_id = ?${netFilter.clause}
      `).get(account_id, ...netFilter.params) as any
      const account = db.prepare('SELECT name, address FROM accounts WHERE id = ?').get(account_id) as any
      return {
        accountId: account_id,
        accountName: account?.name || account_id,
        address: account?.address || null,
        totalRealizedPnl: row.total_realized,
        totalUnrealizedPnl: row.total_unrealized,
        totalPnl: row.total_realized + row.total_unrealized,
        openPositionsCount: row.open_count,
        closedPositionsCount: row.closed_count,
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
    const { strategy_id, account_id, status = 'open', network } = req.query
    const db = getDatabase()
    const netFilter = buildPositionsNetworkFilter(parseNetworkParam(network))

    const conditions: string[] = ['1=1']
    const params: any[] = []

    if (strategy_id) {
      conditions.push('p.strategy_id = ?')
      params.push(strategy_id)
    }

    if (account_id) {
      conditions.push('p.account_id = ?')
      params.push(account_id)
    }

    if (status !== 'all') {
      conditions.push('p.status = ?')
      params.push(status)
    }

    const sql = `
      SELECT p.* FROM positions p
      WHERE ${conditions.join(' AND ')}${netFilter.clause}
      ORDER BY p.opened_at DESC
    `

    const positions = db.prepare(sql).all(...params, ...netFilter.params)

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
