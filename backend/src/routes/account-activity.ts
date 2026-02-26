/**
 * Account Activity Routes
 *
 * Provides per-account activity logs (trades, orders) and per-account PnL.
 * Activity logs are built by querying trades + orders tables filtered by account_id,
 * merged and sorted by timestamp.
 */

import express from 'express'
import { getDatabase } from '../db/index.js'
import { pnlEngine } from '../lib/trading/pnl/PnlEngine.js'

const router = express.Router()

/**
 * GET /api/account-activity/:accountId
 * Get activity log for an account (trades, orders, activity log entries)
 * Merges trades + orders filtered by account_id, sorted by timestamp descending.
 *
 * Query params:
 *   limit - max results (default 50)
 *   offset - pagination offset (default 0)
 */
router.get('/:accountId', (req, res) => {
  try {
    const { accountId } = req.params
    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0

    const db = getDatabase()

    // Get trades for this account
    const trades = db.prepare(`
      SELECT
        'trade' as activity_type,
        id,
        timestamp,
        token_in_symbol || ' -> ' || token_out_symbol as description,
        tx_hash,
        chain_id,
        value_in_usd as amount,
        strategy_id
      FROM trades
      WHERE account_id = ?
      ORDER BY timestamp DESC
    `).all(accountId) as any[]

    // Get orders for this account
    const orders = db.prepare(`
      SELECT
        'order' as activity_type,
        id,
        created_at as timestamp,
        side || ' ' || quantity || ' ' || asset_symbol || ' via ' || protocol as description,
        tx_hash,
        chain_id,
        CAST(quantity AS REAL) * CAST(COALESCE(filled_price, price, '0') AS REAL) as amount,
        strategy_id
      FROM orders
      WHERE account_id = ?
      ORDER BY created_at DESC
    `).all(accountId) as any[]

    // Get activity log entries for this account
    const activityLogs = db.prepare(`
      SELECT
        activity_type,
        id,
        timestamp,
        description,
        tx_hash,
        chain_id,
        CAST(amount AS REAL) as amount,
        metadata
      FROM account_activity_log
      WHERE account_id = ?
      ORDER BY timestamp DESC
    `).all(accountId) as any[]

    // Merge all activities and sort by timestamp descending
    const allActivities = [...trades, ...orders, ...activityLogs]
      .sort((a, b) => {
        const timeA = new Date(a.timestamp || 0).getTime()
        const timeB = new Date(b.timestamp || 0).getTime()
        return timeB - timeA
      })

    // Apply pagination
    const paginatedActivities = allActivities.slice(offset, offset + limit)

    res.json({
      success: true,
      accountId,
      activities: paginatedActivities,
      total: allActivities.length,
      limit,
      offset
    })
  } catch (error: any) {
    console.error('Error fetching account activity:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/account-activity/:accountId/pnl
 * Get per-account PnL summary and positions
 *
 * Query params:
 *   status - position status filter: 'open' | 'closed' | 'all' (default 'open')
 */
router.get('/:accountId/pnl', (req, res) => {
  try {
    const { accountId } = req.params
    const status = (req.query.status as 'open' | 'closed' | 'all') || 'open'

    const summary = pnlEngine.getAccountPnl(accountId)
    const positions = pnlEngine.getAccountPositions(accountId, status)

    res.json({
      success: true,
      accountId,
      summary,
      positions
    })
  } catch (error: any) {
    console.error('Error fetching account PnL:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

export default router
