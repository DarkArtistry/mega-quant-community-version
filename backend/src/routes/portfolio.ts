import express from 'express'
import { getDatabase } from '../db/index.js'
import { pnlAggregator } from '../lib/trading/pnl/PnlAggregator.js'

const router = express.Router()

// GET /api/portfolio/aggregated-pnl - Combined PnL across all instrument types
router.get('/aggregated-pnl', (req, res) => {
  try {
    const { strategy_id } = req.query
    const pnl = pnlAggregator.getTotalPnl(strategy_id as string | undefined)
    res.json({ success: true, pnl })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/portfolio/overview - Get portfolio overview metrics
router.get('/overview', async (req, res) => {
  try {
    const { strategy_id } = req.query
    const db = getDatabase()

    // Get total balance across all chains
    const balanceRow = db.prepare(
      'SELECT COALESCE(SUM(balance_usd), 0) as total_balance FROM token_balances'
    ).get() as { total_balance: number }

    // Build where clause for executions
    let whereClause = "WHERE status = 'closed'"
    const params: any[] = []

    if (strategy_id) {
      whereClause += ' AND strategy_id = ?'
      params.push(strategy_id)
    }

    // Win rate calculation
    const winRateRow = db.prepare(`
      SELECT
        COUNT(*) as total_executions,
        COUNT(CASE WHEN realized_pnl_usd > 0 THEN 1 END) as winning_executions
      FROM strategy_executions
      ${whereClause}
    `).get(...params) as { total_executions: number; winning_executions: number }

    const winRate = winRateRow.total_executions > 0
      ? (winRateRow.winning_executions / winRateRow.total_executions) * 100
      : 0

    // P&L metrics
    const pnlRow = db.prepare(`
      SELECT
        COALESCE(SUM(realized_pnl_usd), 0) as total_pnl,
        COALESCE(MAX(realized_pnl_usd), 0) as max_profit,
        COALESCE(MIN(realized_pnl_usd), 0) as max_loss,
        COALESCE(AVG(realized_pnl_usd), 0) as avg_pnl
      FROM strategy_executions
      ${whereClause}
    `).get(...params) as { total_pnl: number; max_profit: number; max_loss: number; avg_pnl: number }

    // Gas cost from trades
    let gasWhereClause = 'WHERE 1=1'
    const gasParams: any[] = []
    if (strategy_id) {
      gasWhereClause += ' AND strategy_id = ?'
      gasParams.push(strategy_id)
    }

    const gasRow = db.prepare(`
      SELECT COALESCE(SUM(gas_cost_usd), 0) as total_gas_cost
      FROM trades
      ${gasWhereClause}
    `).get(...gasParams) as { total_gas_cost: number }

    res.json({
      success: true,
      overview: {
        totalBalanceUsd: balanceRow.total_balance,
        winRate,
        maxDrawdown: Math.abs(pnlRow.max_loss),
        sharpeRatio: 0, // Placeholder - requires proper time series
        totalExecutions: winRateRow.total_executions,
        winningExecutions: winRateRow.winning_executions,
        totalPnl: pnlRow.total_pnl,
        maxProfit: pnlRow.max_profit,
        maxLoss: pnlRow.max_loss,
        avgPnl: pnlRow.avg_pnl,
        totalGasCost: gasRow.total_gas_cost
      }
    })
  } catch (error: any) {
    console.error('Error fetching portfolio overview:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/portfolio/assets - Get token balances across all chains
router.get('/assets', async (req, res) => {
  try {
    const { chain_id, wallet_address } = req.query
    const db = getDatabase()

    let sql = `
      SELECT
        tb.*,
        a.name as token_name,
        a.is_native
      FROM token_balances tb
      LEFT JOIN assets a ON tb.chain_id = a.chain_id AND tb.asset_id = a.id
      WHERE 1=1
    `
    const params: any[] = []

    if (chain_id) {
      sql += ' AND tb.chain_id = ?'
      params.push(chain_id)
    }
    if (wallet_address) {
      sql += ' AND tb.wallet_address = ?'
      params.push(wallet_address)
    }

    sql += ' ORDER BY tb.balance_usd DESC, tb.balance DESC'

    const assets = db.prepare(sql).all(...params)
    res.json({ success: true, assets })
  } catch (error: any) {
    console.error('Error fetching assets:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/portfolio/gas-reserves - Get gas reserves for all chains
router.get('/gas-reserves', async (req, res) => {
  try {
    const { wallet_address } = req.query
    const db = getDatabase()

    let sql = 'SELECT * FROM gas_reserves WHERE 1=1'
    const params: any[] = []

    if (wallet_address) {
      sql += ' AND wallet_address = ?'
      params.push(wallet_address)
    }

    sql += ' ORDER BY chain_id'

    const reserves = db.prepare(sql).all(...params)

    res.json({ success: true, gasReserves: reserves })
  } catch (error: any) {
    console.error('Error fetching gas reserves:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/portfolio/recent-trades - Get recent trades
router.get('/recent-trades', async (req, res) => {
  try {
    const { limit = '50', strategy_id } = req.query
    const db = getDatabase()

    let sql = `
      SELECT
        t.*,
        s.name as strategy_name
      FROM trades t
      LEFT JOIN strategies s ON t.strategy_id = s.id
      WHERE 1=1
    `
    const params: any[] = []

    if (strategy_id) {
      sql += ' AND t.strategy_id = ?'
      params.push(strategy_id)
    }

    sql += ' ORDER BY t.timestamp DESC LIMIT ?'
    params.push(limit)

    const trades = db.prepare(sql).all(...params)
    res.json({ success: true, trades })
  } catch (error: any) {
    console.error('Error fetching recent trades:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// POST /api/portfolio/snapshot - Create portfolio snapshot
router.post('/snapshot', async (req, res) => {
  try {
    const { strategy_id, total_value_usd, breakdown } = req.body
    const db = getDatabase()

    if (total_value_usd === undefined || !breakdown) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: total_value_usd, breakdown'
      })
    }

    const result = db.prepare(`
      INSERT INTO portfolio_snapshots (strategy_id, total_value_usd)
      VALUES (?, ?)
    `).run(strategy_id || null, total_value_usd)

    const snapshot = db.prepare(
      'SELECT * FROM portfolio_snapshots WHERE id = ?'
    ).get(result.lastInsertRowid)

    res.status(201).json({ success: true, snapshot })
  } catch (error: any) {
    console.error('Error creating portfolio snapshot:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/portfolio/snapshots - Get historical portfolio snapshots
router.get('/snapshots', async (req, res) => {
  try {
    const { strategy_id, time_range = '30d' } = req.query
    const db = getDatabase()

    const ranges: Record<string, string> = {
      '24h': '-1 day',
      '7d': '-7 days',
      '30d': '-30 days',
      '90d': '-90 days',
      '1y': '-365 days'
    }

    const rangeModifier = ranges[time_range as string] || '-30 days'

    let sql = `
      SELECT * FROM portfolio_snapshots
      WHERE timestamp >= datetime('now', ?)
    `
    const params: any[] = [rangeModifier]

    if (strategy_id) {
      sql += ' AND strategy_id = ?'
      params.push(strategy_id)
    }

    sql += ' ORDER BY timestamp DESC'

    const snapshots = db.prepare(sql).all(...params)
    res.json({ success: true, snapshots })
  } catch (error: any) {
    console.error('Error fetching portfolio snapshots:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
