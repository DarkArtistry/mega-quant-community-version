import express from 'express'
import { getDatabase } from '../db/index.js'

const router = express.Router()

// GET /api/trades - List trades (with filters)
router.get('/', async (req, res) => {
  try {
    const { strategy_id, execution_id, wallet_address, chain_id, limit = '100', offset = '0' } = req.query

    let sql = `
      SELECT t.*, s.name as strategy_name
      FROM trades t
      LEFT JOIN strategies s ON t.strategy_id = s.id
      WHERE 1=1
    `
    const params: any[] = []

    if (strategy_id) {
      sql += ` AND t.strategy_id = ?`
      params.push(strategy_id)
    }
    if (execution_id) {
      sql += ` AND t.execution_id = ?`
      params.push(execution_id)
    }
    if (wallet_address) {
      sql += ` AND t.wallet_address = ?`
      params.push(wallet_address)
    }
    if (chain_id) {
      sql += ` AND t.chain_id = ?`
      params.push(chain_id)
    }

    sql += ` ORDER BY t.timestamp DESC LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const db = getDatabase()
    const trades = db.prepare(sql).all(...params)

    res.json({ success: true, trades, count: trades.length })
  } catch (error: any) {
    console.error('Error fetching trades:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// POST /api/trades - Record new trade
router.post('/', async (req, res) => {
  try {
    const {
      execution_id,
      strategy_id,
      wallet_address,
      chain_id,
      protocol,
      tx_hash,
      block_number,
      token_in_address,
      token_in_symbol,
      token_in_amount,
      token_out_address,
      token_out_symbol,
      token_out_amount,
      token_in_price_usd,
      token_out_price_usd,
      gas_used,
      gas_price_gwei,
      gas_cost_usd,
      status = 'completed',
      expected_output,
      actual_output,
      slippage_amount,
      slippage_percentage,
      execution_price,
      quote_price,
      order_id
    } = req.body

    // Validate required fields
    if (!strategy_id || !wallet_address || !chain_id || !tx_hash ||
        !token_in_address || !token_in_symbol || !token_in_amount ||
        !token_out_address || !token_out_symbol || !token_out_amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      })
    }

    // Calculate USD values if prices provided
    let value_in_usd = null
    let value_out_usd = null
    let profit_loss_usd = null

    if (token_in_price_usd) {
      value_in_usd = parseFloat(token_in_amount) * token_in_price_usd
    }
    if (token_out_price_usd) {
      value_out_usd = parseFloat(token_out_amount) * token_out_price_usd
    }
    if (value_in_usd && value_out_usd) {
      profit_loss_usd = value_out_usd - value_in_usd
    }

    const db = getDatabase()

    // Insert trade with slippage columns
    const insertResult = db.prepare(`
      INSERT INTO trades (
        execution_id, strategy_id, wallet_address, chain_id, protocol,
        tx_hash, block_number,
        token_in_address, token_in_symbol, token_in_amount,
        token_out_address, token_out_symbol, token_out_amount,
        token_in_price_usd, token_out_price_usd,
        value_in_usd, value_out_usd, profit_loss_usd,
        gas_used, gas_price_gwei, gas_cost_usd, status,
        expected_output, actual_output, slippage_amount, slippage_percentage,
        execution_price, quote_price, order_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      execution_id, strategy_id, wallet_address, chain_id, protocol,
      tx_hash, block_number,
      token_in_address, token_in_symbol, token_in_amount,
      token_out_address, token_out_symbol, token_out_amount,
      token_in_price_usd, token_out_price_usd,
      value_in_usd, value_out_usd, profit_loss_usd,
      gas_used, gas_price_gwei, gas_cost_usd, status,
      expected_output || null, actual_output || null,
      slippage_amount || null, slippage_percentage || null,
      execution_price || null, quote_price || null, order_id || null
    )

    // Get the inserted trade
    const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(insertResult.lastInsertRowid)

    console.log(`[Trades] Trade recorded: ${tx_hash} (ID: ${insertResult.lastInsertRowid})`)

    res.status(201).json({ success: true, trade, trade_id: insertResult.lastInsertRowid })
  } catch (error: any) {
    console.error('Error recording trade:', error)

    // Handle unique constraint violation (duplicate tx_hash)
    if (error.message && error.message.includes('UNIQUE constraint')) {
      return res.status(409).json({
        success: false,
        error: 'Trade already recorded for this transaction'
      })
    }

    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/trades/stats - Get trading statistics
router.get('/stats', async (req, res) => {
  try {
    const { strategy_id, time_range } = req.query

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (strategy_id) {
      whereClause += ` AND strategy_id = ?`
      params.push(strategy_id)
    }

    if (time_range) {
      // SQLite time range calculations
      const ranges: Record<string, string> = {
        '24h': "datetime('now', '-1 day')",
        '7d': "datetime('now', '-7 days')",
        '30d': "datetime('now', '-30 days')",
        '90d': "datetime('now', '-90 days')"
      }

      if (ranges[time_range as string]) {
        whereClause += ` AND timestamp >= ${ranges[time_range as string]}`
      }
    }

    const db = getDatabase()
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_trades,
        COUNT(DISTINCT chain_id) as chains_used,
        COALESCE(SUM(value_in_usd), 0) as total_volume_usd,
        COALESCE(SUM(profit_loss_usd), 0) as total_pnl_usd,
        COALESCE(AVG(profit_loss_usd), 0) as avg_pnl_per_trade,
        COALESCE(SUM(gas_cost_usd), 0) as total_gas_cost_usd
      FROM trades
      ${whereClause}
    `).get(...params)

    res.json({ success: true, stats })
  } catch (error: any) {
    console.error('Error fetching trade stats:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/trades/pnl/:strategyId - Get PNL for a strategy
router.get('/pnl/:strategyId', async (req, res) => {
  try {
    const { strategyId } = req.params
    const { executionId } = req.query

    const db = getDatabase()
    let whereClause = 'WHERE strategy_id = ?'
    const params: any[] = [strategyId]

    if (executionId) {
      whereClause += ' AND execution_id = ?'
      params.push(executionId)
    }

    // Calculate total PNL
    const pnl = db.prepare(`
      SELECT
        strategy_id,
        COUNT(*) as total_trades,
        COALESCE(SUM(value_in_usd), 0) as total_value_in,
        COALESCE(SUM(value_out_usd), 0) as total_value_out,
        COALESCE(SUM(profit_loss_usd), 0) as gross_pnl,
        COALESCE(SUM(gas_cost_usd), 0) as total_gas_cost,
        COALESCE(SUM(profit_loss_usd) - SUM(gas_cost_usd), 0) as net_pnl
      FROM trades
      ${whereClause}
      GROUP BY strategy_id
    `).get(...params)

    if (!pnl) {
      return res.json({
        success: true,
        pnl: {
          strategy_id: strategyId,
          total_trades: 0,
          total_value_in: 0,
          total_value_out: 0,
          gross_pnl: 0,
          total_gas_cost: 0,
          net_pnl: 0
        }
      })
    }

    res.json({ success: true, pnl })
  } catch (error: any) {
    console.error('Error fetching PNL:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
