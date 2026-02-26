import express from 'express'
import { query, getDatabase } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'

const router = express.Router()

// GET /api/executions - List all executions (optionally filter by strategy)
router.get('/', async (req, res) => {
  try {
    const { strategy_id } = req.query

    let sql = `
      SELECT e.*, s.name as strategy_name
      FROM strategy_executions e
      LEFT JOIN strategies s ON e.strategy_id = s.id
    `
    const params: any[] = []

    if (strategy_id) {
      sql += ' WHERE e.strategy_id = ?'
      params.push(strategy_id)
    }

    sql += ' ORDER BY e.opened_at DESC'

    const result = await query(sql, params)
    res.json({ success: true, executions: result.rows })
  } catch (error: any) {
    console.error('Error fetching executions:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/executions/:id - Get single execution with details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params

    const result = await query(`
      SELECT e.*, s.name as strategy_name
      FROM strategy_executions e
      LEFT JOIN strategies s ON e.strategy_id = s.id
      WHERE e.id = ?
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Execution not found' })
    }

    res.json({ success: true, execution: result.rows[0] })
  } catch (error: any) {
    console.error('Error fetching execution:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// POST /api/executions - Create new execution
router.post('/', async (req, res) => {
  try {
    const { strategy_id, execution_type, starting_inventory } = req.body

    if (!strategy_id || !execution_type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: strategy_id, execution_type'
      })
    }

    const id = uuidv4()
    const db = getDatabase()

    db.prepare(`
      INSERT INTO strategy_executions (
        id, strategy_id, execution_type, status, starting_inventory
      )
      VALUES (?, ?, ?, 'opened', ?)
    `).run(id, strategy_id, execution_type, JSON.stringify(starting_inventory || {}))

    const execution = db.prepare(`SELECT * FROM strategy_executions WHERE id = ?`).get(id)

    res.status(201).json({ success: true, execution })
  } catch (error: any) {
    console.error('Error creating execution:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// POST /api/executions/:id/close - Close execution and calculate P&L
router.post('/:id/close', async (req, res) => {
  try {
    const { id } = req.params
    const { ending_inventory, pnl_components } = req.body

    const db = getDatabase()

    const updates: string[] = [
      'status = ?',
      'closed_at = CURRENT_TIMESTAMP',
      'ending_inventory = ?'
    ]
    const values: any[] = ['closed', JSON.stringify(ending_inventory || {})]

    // Add P&L components if provided
    if (pnl_components) {
      if (pnl_components.realized_pnl_usd !== undefined) {
        updates.push('realized_pnl_usd = ?')
        values.push(pnl_components.realized_pnl_usd)
      }
    }

    values.push(id)
    db.prepare(`
      UPDATE strategy_executions
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values)

    const execution = db.prepare(`SELECT * FROM strategy_executions WHERE id = ?`).get(id)

    if (!execution) {
      return res.status(404).json({ success: false, error: 'Execution not found' })
    }

    res.json({ success: true, execution })
  } catch (error: any) {
    console.error('Error closing execution:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/executions/:id/trades - Get trades for an execution
router.get('/:id/trades', async (req, res) => {
  try {
    const { id } = req.params

    const result = await query(`
      SELECT * FROM trades
      WHERE execution_id = ?
      ORDER BY timestamp DESC
    `, [id])

    res.json({ success: true, trades: result.rows })
  } catch (error: any) {
    console.error('Error fetching execution trades:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// PATCH /api/executions/:id/inventory - Update starting or ending inventory
router.patch('/:id/inventory', async (req, res) => {
  try {
    const { id } = req.params
    const { starting_inventory, ending_inventory } = req.body

    const db = getDatabase()

    const updates: string[] = []
    const values: any[] = []

    if (starting_inventory !== undefined) {
      updates.push('starting_inventory = ?')
      values.push(JSON.stringify(starting_inventory))
    }
    if (ending_inventory !== undefined) {
      updates.push('ending_inventory = ?')
      values.push(JSON.stringify(ending_inventory))
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No inventory to update' })
    }

    values.push(id)
    db.prepare(`
      UPDATE strategy_executions
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values)

    const execution = db.prepare(`SELECT * FROM strategy_executions WHERE id = ?`).get(id)

    if (!execution) {
      return res.status(404).json({ success: false, error: 'Execution not found' })
    }

    res.json({ success: true, execution })
  } catch (error: any) {
    console.error('Error updating execution inventory:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
