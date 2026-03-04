/**
 * Orders Routes
 *
 * Provides endpoints for order management:
 * - List orders with filters
 * - Order history with pagination
 * - Cancel orders
 */

import express from 'express'
import { getDatabase } from '../db/index.js'
import { buildOrdersNetworkFilter, parseNetworkParam } from '../lib/utils/network-filter.js'

const router = express.Router()

/**
 * GET /api/orders
 * List orders with filters
 *
 * Query params:
 *   - strategy_id (optional): filter by strategy
 *   - status (optional): filter by status (pending, partial, filled, cancelled, expired)
 *   - limit (optional, default: 100)
 *   - offset (optional, default: 0)
 */
router.get('/', (req, res) => {
  try {
    const { strategy_id, status, limit = '100', offset = '0', network } = req.query
    const db = getDatabase()
    const netFilter = buildOrdersNetworkFilter(parseNetworkParam(network))

    let sql = `
      SELECT o.*, s.name as strategy_name
      FROM orders o
      LEFT JOIN strategies s ON o.strategy_id = s.id
      WHERE 1=1
    `
    const params: any[] = []

    if (strategy_id) {
      sql += ' AND o.strategy_id = ?'
      params.push(strategy_id)
    }

    if (status) {
      sql += ' AND o.status = ?'
      params.push(status)
    }

    sql += netFilter.clause
    params.push(...netFilter.params)

    sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit as string, 10) || 100)
    params.push(parseInt(offset as string, 10) || 0)

    const orders = db.prepare(sql).all(...params)

    // Get total count for pagination
    let countSql = 'SELECT COUNT(*) as total FROM orders o WHERE 1=1'
    const countParams: any[] = []

    if (strategy_id) {
      countSql += ' AND o.strategy_id = ?'
      countParams.push(strategy_id)
    }
    if (status) {
      countSql += ' AND o.status = ?'
      countParams.push(status)
    }
    countSql += netFilter.clause
    countParams.push(...netFilter.params)

    const countRow = db.prepare(countSql).get(...countParams) as { total: number }

    res.json({
      success: true,
      orders,
      count: orders.length,
      total: countRow.total
    })
  } catch (error: any) {
    console.error('[Orders] Error fetching orders:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch orders'
    })
  }
})

/**
 * GET /api/orders/history
 * Order history with pagination
 *
 * Query params:
 *   - limit (optional, default: 50)
 *   - offset (optional, default: 0)
 *   - strategy_id (optional)
 */
router.get('/history', (req, res) => {
  try {
    const { limit = '50', offset = '0', strategy_id, network } = req.query
    const db = getDatabase()
    const netFilter = buildOrdersNetworkFilter(parseNetworkParam(network))

    let sql = `
      SELECT o.*, s.name as strategy_name
      FROM orders o
      LEFT JOIN strategies s ON o.strategy_id = s.id
      WHERE o.status IN ('filled', 'cancelled', 'expired')
    `
    const params: any[] = []

    if (strategy_id) {
      sql += ' AND o.strategy_id = ?'
      params.push(strategy_id)
    }

    sql += netFilter.clause
    params.push(...netFilter.params)

    sql += ' ORDER BY o.updated_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit as string, 10) || 50)
    params.push(parseInt(offset as string, 10) || 0)

    const orders = db.prepare(sql).all(...params)

    // Get total count for pagination
    let countSql = "SELECT COUNT(*) as total FROM orders o WHERE o.status IN ('filled', 'cancelled', 'expired')"
    const countParams: any[] = []

    if (strategy_id) {
      countSql += ' AND o.strategy_id = ?'
      countParams.push(strategy_id)
    }
    countSql += netFilter.clause
    countParams.push(...netFilter.params)

    const countRow = db.prepare(countSql).get(...countParams) as { total: number }

    res.json({
      success: true,
      orders,
      count: orders.length,
      total: countRow.total,
      limit: parseInt(limit as string, 10) || 50,
      offset: parseInt(offset as string, 10) || 0
    })
  } catch (error: any) {
    console.error('[Orders] Error fetching order history:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch order history'
    })
  }
})

/**
 * DELETE /api/orders/:id
 * Cancel an order
 */
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params
    const db = getDatabase()

    // Check if order exists and is cancellable
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      })
    }

    if (order.status !== 'pending' && order.status !== 'partial') {
      return res.status(400).json({
        success: false,
        error: `Cannot cancel order with status: ${order.status}`
      })
    }

    // Update order status to cancelled
    db.prepare(`
      UPDATE orders
      SET status = 'cancelled', updated_at = datetime('now')
      WHERE id = ?
    `).run(id)

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(id)

    console.log(`[Orders] Cancelled order: ${id}`)

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      order: updatedOrder
    })
  } catch (error: any) {
    console.error('[Orders] Error cancelling order:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to cancel order'
    })
  }
})

export default router
