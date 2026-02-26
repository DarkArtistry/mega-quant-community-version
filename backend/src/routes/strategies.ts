import express from 'express'
import { query, execute, getDatabase } from '../db/index.js'
import { v4 as uuidv4 } from 'uuid'

const router = express.Router()

// GET /api/strategies - List all strategies
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM strategies
      ORDER BY created_at DESC
    `)
    res.json({ success: true, strategies: result.rows })
  } catch (error: any) {
    console.error('Error fetching strategies:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/strategies/:id - Get single strategy
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const result = await query(`
      SELECT * FROM strategies WHERE id = ?
    `, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Strategy not found' })
    }

    res.json({ success: true, strategy: result.rows[0] })
  } catch (error: any) {
    console.error('Error fetching strategy:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// POST /api/strategies - Create new strategy
router.post('/', async (req, res) => {
  try {
    const { name, description, code, execution_type } = req.body

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: name'
      })
    }

    const id = uuidv4()
    const result = await execute(`
      INSERT INTO strategies (id, name, description, code, execution_type, status)
      VALUES (?, ?, ?, ?, ?, 'stopped')
      RETURNING *
    `, [id, name, description || '', code || '', execution_type || 'script'])

    res.status(201).json({ success: true, strategy: result.rows[0] })
  } catch (error: any) {
    console.error('Error creating strategy:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// PATCH /api/strategies/:id - Update strategy
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, code, execution_type, status, trading_views } = req.body

    const updates: string[] = []
    const values: any[] = []

    if (name !== undefined) {
      updates.push(`name = ?`)
      values.push(name)
    }
    if (description !== undefined) {
      updates.push(`description = ?`)
      values.push(description)
    }
    if (code !== undefined) {
      updates.push(`code = ?`)
      values.push(code)
    }
    if (execution_type !== undefined) {
      updates.push(`execution_type = ?`)
      values.push(execution_type)
    }
    if (trading_views !== undefined) {
      updates.push(`trading_views = ?`)
      values.push(JSON.stringify(trading_views))
    }
    if (status !== undefined) {
      updates.push(`status = ?`)
      values.push(status)

      if (status === 'running') {
        updates.push(`started_at = datetime('now')`)
      } else if (status === 'stopped') {
        updates.push(`stopped_at = datetime('now')`)
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' })
    }

    values.push(id)
    await execute(`
      UPDATE strategies
      SET ${updates.join(', ')}, updated_at = datetime('now')
      WHERE id = ?
    `, values)

    // Fetch updated strategy
    const result = await query(`SELECT * FROM strategies WHERE id = ?`, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Strategy not found' })
    }

    res.json({ success: true, strategy: result.rows[0] })
  } catch (error: any) {
    console.error('Error updating strategy:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// DELETE /api/strategies/:id - Delete strategy
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    // Check if exists first
    const existing = db.prepare(`SELECT id FROM strategies WHERE id = ?`).get(id)
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Strategy not found' })
    }

    // Delete in a transaction to ensure all data is removed
    // SQLite will handle CASCADE deletes for wallet_config and strategy_account_mappings
    db.transaction(() => {
      try {
        // Delete all trades associated with this strategy (no FK, manual delete needed)
        const tradesResult = db.prepare(`DELETE FROM trades WHERE strategy_id = ?`).run(id)
        console.log(`[Strategies] Deleted ${tradesResult.changes} trades for strategy ${id}`)

        // Delete all executions associated with this strategy (CASCADE handles children)
        const executionsResult = db.prepare(`DELETE FROM strategy_executions WHERE strategy_id = ?`).run(id)
        console.log(`[Strategies] Deleted ${executionsResult.changes} executions for strategy ${id}`)

        // Delete strategy account mappings (has FK with CASCADE, but delete explicitly for logging)
        const mappingsResult = db.prepare(`DELETE FROM strategy_account_mappings WHERE strategy_id = ?`).run(id)
        console.log(`[Strategies] Deleted ${mappingsResult.changes} account mappings for strategy ${id}`)

        // Delete wallet configs (has FK with CASCADE, but delete explicitly for logging)
        const walletConfigResult = db.prepare(`DELETE FROM wallet_config WHERE strategy_id = ?`).run(id)
        console.log(`[Strategies] Deleted ${walletConfigResult.changes} wallet configs for strategy ${id}`)

        // Delete orders associated with this strategy
        const ordersResult = db.prepare(`DELETE FROM orders WHERE strategy_id = ?`).run(id)
        console.log(`[Strategies] Deleted ${ordersResult.changes} orders for strategy ${id}`)

        // Delete positions associated with this strategy
        const positionsResult = db.prepare(`DELETE FROM positions WHERE strategy_id = ?`).run(id)
        console.log(`[Strategies] Deleted ${positionsResult.changes} positions for strategy ${id}`)

        // Delete the strategy itself
        db.prepare(`DELETE FROM strategies WHERE id = ?`).run(id)
        console.log(`[Strategies] Deleted strategy ${id}`)
      } catch (err: any) {
        console.error(`[Strategies] Error in delete transaction:`, err)
        throw err  // Re-throw to trigger transaction rollback
      }
    })()

    res.json({
      success: true,
      message: 'Strategy and all associated data deleted successfully'
    })
  } catch (error: any) {
    console.error('Error deleting strategy:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// GET /api/strategies/:id/executions - Get executions for a strategy
router.get('/:id/executions', async (req, res) => {
  try {
    const { id } = req.params
    const result = await query(`
      SELECT * FROM strategy_executions
      WHERE strategy_id = ?
      ORDER BY opened_at DESC
    `, [id])

    res.json({ success: true, executions: result.rows })
  } catch (error: any) {
    console.error('Error fetching strategy executions:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
