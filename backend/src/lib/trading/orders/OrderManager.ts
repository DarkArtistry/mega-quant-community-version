/**
 * Order Manager
 *
 * Manages the lifecycle of orders across DEX, CEX, and hook-based systems.
 * Provides CRUD operations for the orders table.
 */

import { getDatabase } from '../../../db/index.js'
import { v4 as uuidv4 } from 'uuid'

export interface OrderData {
  strategyId: string
  orderType?: 'market' | 'limit' | 'stop'
  side: 'buy' | 'sell'
  assetSymbol: string
  assetAddress?: string
  chainId?: number
  protocol: string
  quantity: string
  price?: string
  tick?: number
  deadline?: string
  hookOrderId?: string
  accountId?: string
  linkedOrderId?: string  // Links the other side of a swap (sell ↔ buy)
  // Enriched detail fields
  gasCostUsd?: number
  gasUsed?: number
  commission?: string
  commissionAsset?: string
  tokenInSymbol?: string
  tokenInAmount?: string
  tokenOutSymbol?: string
  tokenOutAmount?: string
  slippagePercentage?: number
  blockNumber?: number
}

export interface OrderFillData {
  filledQuantity: string
  filledPrice: string
  txHash?: string
}

export interface Order {
  id: string
  strategyId: string
  orderType: string
  side: string
  assetSymbol: string
  assetAddress: string | null
  chainId: number | null
  protocol: string
  quantity: string
  price: string | null
  tick: number | null
  status: string
  filledQuantity: string | null
  filledPrice: string | null
  txHash: string | null
  hookOrderId: string | null
  deadline: string | null
  createdAt: string
  updatedAt: string
  accountId: string | null
  // Enriched detail fields
  gasCostUsd: number | null
  gasUsed: number | null
  commission: string | null
  commissionAsset: string | null
  tokenInSymbol: string | null
  tokenInAmount: string | null
  tokenOutSymbol: string | null
  tokenOutAmount: string | null
  slippagePercentage: number | null
  filledAt: string | null
  blockNumber: number | null
  linkedOrderId: string | null
}

export class OrderManager {
  /**
   * Record a new order in the database.
   */
  recordOrder(data: OrderData): Order {
    const db = getDatabase()
    const id = uuidv4()

    db.prepare(`
      INSERT INTO orders (
        id, strategy_id, order_type, side, asset_symbol, asset_address,
        chain_id, protocol, quantity, price, tick, status,
        hook_order_id, deadline, account_id, linked_order_id,
        gas_cost_usd, gas_used, commission, commission_asset,
        token_in_symbol, token_in_amount, token_out_symbol, token_out_amount,
        slippage_percentage, block_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.strategyId,
      data.orderType || 'market',
      data.side,
      data.assetSymbol,
      data.assetAddress || null,
      data.chainId || null,
      data.protocol,
      data.quantity,
      data.price || null,
      data.tick || null,
      data.hookOrderId || null,
      data.deadline || null,
      data.accountId || null,
      data.linkedOrderId || null,
      data.gasCostUsd ?? null,
      data.gasUsed ?? null,
      data.commission || null,
      data.commissionAsset || null,
      data.tokenInSymbol || null,
      data.tokenInAmount || null,
      data.tokenOutSymbol || null,
      data.tokenOutAmount || null,
      data.slippagePercentage ?? null,
      data.blockNumber ?? null
    )

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any

    console.log(`[OrderManager] Recorded order: ${id} (${data.side} ${data.quantity} ${data.assetSymbol} via ${data.protocol})`)

    return this.mapRow(order)
  }

  /**
   * Update the status of an order with optional fill data.
   */
  updateOrderStatus(
    orderId: string,
    status: 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired',
    fillData?: OrderFillData
  ): Order | null {
    const db = getDatabase()

    // Check order exists
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
    if (!existing) {
      console.error(`[OrderManager] Order not found: ${orderId}`)
      return null
    }

    if (fillData) {
      db.prepare(`
        UPDATE orders
        SET status = ?, filled_quantity = ?, filled_price = ?, tx_hash = ?,
            filled_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(
        status,
        fillData.filledQuantity,
        fillData.filledPrice,
        fillData.txHash || null,
        orderId
      )
    } else {
      db.prepare(`
        UPDATE orders
        SET status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(status, orderId)
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any
    console.log(`[OrderManager] Updated order ${orderId} -> ${status}`)

    return this.mapRow(updated)
  }

  /**
   * Get all orders, optionally filtered by strategy.
   */
  getAll(strategyId?: string): Order[] {
    const db = getDatabase()

    let sql = 'SELECT * FROM orders'
    const params: any[] = []

    if (strategyId) {
      sql += ' WHERE strategy_id = ?'
      params.push(strategyId)
    }

    sql += ' ORDER BY created_at DESC'

    const rows = db.prepare(sql).all(...params) as any[]
    return rows.map(row => this.mapRow(row))
  }

  /**
   * Get all pending orders.
   */
  getPending(): Order[] {
    const db = getDatabase()

    const rows = db.prepare(`
      SELECT * FROM orders
      WHERE status IN ('pending', 'partial')
      ORDER BY created_at ASC
    `).all() as any[]

    return rows.map(row => this.mapRow(row))
  }

  /**
   * Get order history with pagination.
   */
  getHistory(limit: number = 50, offset: number = 0): { orders: Order[]; total: number } {
    const db = getDatabase()

    const rows = db.prepare(`
      SELECT * FROM orders
      WHERE status IN ('filled', 'cancelled', 'expired')
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as any[]

    const countRow = db.prepare(`
      SELECT COUNT(*) as total FROM orders
      WHERE status IN ('filled', 'cancelled', 'expired')
    `).get() as { total: number }

    return {
      orders: rows.map(row => this.mapRow(row)),
      total: countRow.total
    }
  }

  /**
   * Get a single order by ID.
   */
  getById(orderId: string): Order | null {
    const db = getDatabase()

    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any
    if (!row) return null

    return this.mapRow(row)
  }

  /**
   * Link two orders together (sell ↔ buy sides of a swap).
   */
  setLinkedOrderId(orderId: string, linkedOrderId: string): void {
    const db = getDatabase()
    db.prepare('UPDATE orders SET linked_order_id = ? WHERE id = ?').run(linkedOrderId, orderId)
  }

  /**
   * Cancel a pending or partial order.
   */
  cancel(orderId: string): Order | null {
    return this.updateOrderStatus(orderId, 'cancelled')
  }

  /**
   * Get all orders for a specific account.
   */
  getByAccount(accountId: string): Order[] {
    const db = getDatabase()

    const rows = db.prepare(`
      SELECT * FROM orders
      WHERE account_id = ?
      ORDER BY created_at DESC
    `).all(accountId) as any[]

    return rows.map(row => this.mapRow(row))
  }

  private mapRow(row: any): Order {
    return {
      id: row.id,
      strategyId: row.strategy_id,
      orderType: row.order_type,
      side: row.side,
      assetSymbol: row.asset_symbol,
      assetAddress: row.asset_address,
      chainId: row.chain_id,
      protocol: row.protocol,
      quantity: row.quantity,
      price: row.price,
      tick: row.tick,
      status: row.status,
      filledQuantity: row.filled_quantity,
      filledPrice: row.filled_price,
      txHash: row.tx_hash,
      hookOrderId: row.hook_order_id,
      deadline: row.deadline,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accountId: row.account_id,
      gasCostUsd: row.gas_cost_usd,
      gasUsed: row.gas_used,
      commission: row.commission,
      commissionAsset: row.commission_asset,
      tokenInSymbol: row.token_in_symbol,
      tokenInAmount: row.token_in_amount,
      tokenOutSymbol: row.token_out_symbol,
      tokenOutAmount: row.token_out_amount,
      slippagePercentage: row.slippage_percentage,
      filledAt: row.filled_at,
      blockNumber: row.block_number,
      linkedOrderId: row.linked_order_id
    }
  }
}

// Singleton instance
export const orderManager = new OrderManager()
