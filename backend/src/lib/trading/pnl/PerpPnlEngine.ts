/**
 * Perp PnL Engine
 *
 * Manages perpetual futures positions and calculates PnL.
 * PnL = (exit_price - entry_price) x size x direction + funding - fees
 *
 * Single-sided orders: one order per action (not linked pairs like spot swaps).
 */

import { getDatabase } from '../../../db/index.js'
import { v4 as uuidv4 } from 'uuid'

export interface PerpTradeInput {
  strategyId: string
  accountId?: string
  protocol: string
  chainId?: number
  marketSymbol: string
  action: 'open' | 'close' | 'increase' | 'decrease'
  side: 'long' | 'short'
  price: string
  size: string
  leverage?: number
  marginType?: 'CROSS' | 'ISOLATED'
  collateralAmount?: string
  collateralAsset?: string
  liquidationPrice?: string
  fees?: string
  positionId?: string // For close/decrease, target a specific position
}

export interface PerpPosition {
  id: string
  strategyId: string | null
  accountId: string | null
  protocol: string
  chainId: number | null
  marketSymbol: string
  side: 'long' | 'short'
  positionSize: string
  avgEntryPrice: string
  currentPrice: string | null
  leverage: number
  marginType: string
  collateralAmount: string | null
  collateralAsset: string | null
  liquidationPrice: string | null
  realizedPnl: string
  unrealizedPnl: string
  totalFees: string
  totalFunding: string
  status: 'open' | 'closed' | 'liquidated'
  openedAt: string
  closedAt: string | null
}

export interface PerpPnlSummary {
  totalRealizedPnl: number
  totalUnrealizedPnl: number
  totalFunding: number
  totalPnl: number
  openPositionsCount: number
  closedPositionsCount: number
}

export class PerpPnlEngine {
  /**
   * Process a perpetual futures trade.
   * Returns the updated position and realized PnL (if closing).
   */
  processPerp(trade: PerpTradeInput): { position: PerpPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const size = parseFloat(trade.size)
    const price = parseFloat(trade.price)
    const fees = parseFloat(trade.fees || '0')
    const accountId = trade.accountId || null

    if (trade.action === 'open') {
      return this.openPosition(trade, size, price, fees)
    }

    // For close/decrease/increase, find the existing position
    let existingPosition: any

    if (trade.positionId) {
      existingPosition = db.prepare('SELECT * FROM perp_positions WHERE id = ? AND status = \'open\'').get(trade.positionId)
    } else {
      let sql = `
        SELECT * FROM perp_positions
        WHERE market_symbol = ? AND side = ? AND status = 'open'
      `
      const params: any[] = [trade.marketSymbol, trade.side]

      if (trade.strategyId) {
        sql += ' AND strategy_id = ?'
        params.push(trade.strategyId)
      }
      if (accountId) {
        sql += ' AND account_id = ?'
        params.push(accountId)
      }
      sql += ' LIMIT 1'
      existingPosition = db.prepare(sql).get(...params)
    }

    if (!existingPosition && trade.action !== 'increase') {
      throw new Error(`No open ${trade.side} position found for ${trade.marketSymbol}`)
    }

    if (trade.action === 'increase' && !existingPosition) {
      return this.openPosition(trade, size, price, fees)
    }

    if (trade.action === 'increase') {
      return this.increasePosition(existingPosition, trade, size, price, fees)
    }

    if (trade.action === 'decrease') {
      return this.decreasePosition(existingPosition, trade, size, price, fees)
    }

    // Close
    return this.closePosition(existingPosition, trade, price, fees)
  }

  private openPosition(trade: PerpTradeInput, size: number, price: number, fees: number): { position: PerpPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const id = uuidv4()

    db.prepare(`
      INSERT INTO perp_positions (
        id, strategy_id, account_id, protocol, chain_id,
        market_symbol, side, position_size, avg_entry_price,
        leverage, margin_type, collateral_amount, collateral_asset,
        liquidation_price, total_fees, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `).run(
      id,
      trade.strategyId,
      trade.accountId || null,
      trade.protocol,
      trade.chainId || null,
      trade.marketSymbol,
      trade.side,
      trade.size,
      trade.price,
      trade.leverage || 1,
      trade.marginType || 'CROSS',
      trade.collateralAmount || null,
      trade.collateralAsset || null,
      trade.liquidationPrice || null,
      fees.toString()
    )

    const position = this.getPositionById(id)!
    console.log(`[PerpPnlEngine] Opened ${trade.side} ${trade.size} ${trade.marketSymbol} @ ${trade.price} (${trade.leverage}x)`)
    return { position, realizedPnl: 0, action: 'open' }
  }

  private increasePosition(existing: any, trade: PerpTradeInput, size: number, price: number, fees: number): { position: PerpPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const existingSize = parseFloat(existing.position_size)
    const existingAvg = parseFloat(existing.avg_entry_price)
    const existingFees = parseFloat(existing.total_fees)

    const newSize = existingSize + size
    const newAvg = ((existingAvg * existingSize) + (price * size)) / newSize

    db.prepare(`
      UPDATE perp_positions
      SET position_size = ?, avg_entry_price = ?, total_fees = ?,
          leverage = COALESCE(?, leverage),
          liquidation_price = COALESCE(?, liquidation_price)
      WHERE id = ?
    `).run(
      newSize.toString(),
      newAvg.toString(),
      (existingFees + fees).toString(),
      trade.leverage || null,
      trade.liquidationPrice || null,
      existing.id
    )

    const position = this.getPositionById(existing.id)!
    console.log(`[PerpPnlEngine] Increased ${trade.side} ${trade.marketSymbol}: +${size} (total: ${newSize})`)
    return { position, realizedPnl: 0, action: 'increase' }
  }

  private decreasePosition(existing: any, trade: PerpTradeInput, size: number, price: number, fees: number): { position: PerpPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const existingSize = parseFloat(existing.position_size)
    const existingAvg = parseFloat(existing.avg_entry_price)
    const existingFees = parseFloat(existing.total_fees)
    const existingRealizedPnl = parseFloat(existing.realized_pnl)

    const closeSize = Math.min(size, existingSize)
    const direction = existing.side === 'long' ? 1 : -1
    const realizedPnl = (price - existingAvg) * closeSize * direction - fees

    const remainingSize = existingSize - closeSize

    if (remainingSize <= 0) {
      return this.closePosition(existing, trade, price, fees)
    }

    db.prepare(`
      UPDATE perp_positions
      SET position_size = ?, realized_pnl = ?, total_fees = ?
      WHERE id = ?
    `).run(
      remainingSize.toString(),
      (existingRealizedPnl + realizedPnl).toString(),
      (existingFees + fees).toString(),
      existing.id
    )

    const position = this.getPositionById(existing.id)!
    console.log(`[PerpPnlEngine] Decreased ${existing.side} ${existing.market_symbol}: -${closeSize} (remaining: ${remainingSize}), PnL: $${realizedPnl.toFixed(2)}`)
    return { position, realizedPnl, action: 'decrease' }
  }

  private closePosition(existing: any, trade: PerpTradeInput, price: number, fees: number): { position: PerpPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const existingSize = parseFloat(existing.position_size)
    const existingAvg = parseFloat(existing.avg_entry_price)
    const existingFees = parseFloat(existing.total_fees)
    const existingRealizedPnl = parseFloat(existing.realized_pnl)

    const direction = existing.side === 'long' ? 1 : -1
    const realizedPnl = (price - existingAvg) * existingSize * direction - fees

    db.prepare(`
      UPDATE perp_positions
      SET position_size = '0', current_price = ?, realized_pnl = ?, total_fees = ?,
          status = 'closed', closed_at = datetime('now')
      WHERE id = ?
    `).run(
      price.toString(),
      (existingRealizedPnl + realizedPnl).toString(),
      (existingFees + fees).toString(),
      existing.id
    )

    const position = this.getPositionById(existing.id)!
    console.log(`[PerpPnlEngine] Closed ${existing.side} ${existing.market_symbol} @ ${price}, PnL: $${realizedPnl.toFixed(2)}`)
    return { position, realizedPnl, action: 'close' }
  }

  /**
   * Record a funding payment for a perp position.
   */
  recordFundingPayment(positionId: string, amount: string, fundingRate: string, positionSize?: string): void {
    const db = getDatabase()
    const position = db.prepare('SELECT * FROM perp_positions WHERE id = ?').get(positionId) as any
    if (!position) {
      console.warn(`[PerpPnlEngine] Position ${positionId} not found for funding payment`)
      return
    }

    const id = uuidv4()
    db.prepare(`
      INSERT INTO funding_payments (id, perp_position_id, strategy_id, account_id, market_symbol, payment_amount, funding_rate, position_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      positionId,
      position.strategy_id,
      position.account_id,
      position.market_symbol,
      amount,
      fundingRate,
      positionSize || position.position_size
    )

    // Update total funding on position
    const existingFunding = parseFloat(position.total_funding || '0')
    const paymentAmount = parseFloat(amount)
    db.prepare('UPDATE perp_positions SET total_funding = ? WHERE id = ?').run(
      (existingFunding + paymentAmount).toString(),
      positionId
    )

    console.log(`[PerpPnlEngine] Funding payment: ${amount} for position ${positionId} (rate: ${fundingRate})`)
  }

  /**
   * Update unrealized PnL for all open perp positions using current mark prices.
   */
  updateUnrealizedPnl(currentPrices: Record<string, number>): void {
    const db = getDatabase()
    const openPositions = db.prepare('SELECT * FROM perp_positions WHERE status = \'open\'').all() as any[]

    for (const pos of openPositions) {
      const currentPrice = currentPrices[pos.market_symbol]
      if (currentPrice === undefined) continue

      const size = parseFloat(pos.position_size)
      const avgEntry = parseFloat(pos.avg_entry_price)
      const direction = pos.side === 'long' ? 1 : -1
      const unrealizedPnl = (currentPrice - avgEntry) * size * direction

      db.prepare('UPDATE perp_positions SET current_price = ?, unrealized_pnl = ? WHERE id = ?').run(
        currentPrice.toString(),
        unrealizedPnl.toString(),
        pos.id
      )
    }
  }

  /**
   * Get total PnL summary for perp positions.
   */
  getTotalPnl(strategyId?: string): PerpPnlSummary {
    const db = getDatabase()

    let sql = `
      SELECT
        COALESCE(SUM(CAST(realized_pnl AS REAL)), 0) as total_realized,
        COALESCE(SUM(CASE WHEN status = 'open' THEN CAST(COALESCE(unrealized_pnl, '0') AS REAL) ELSE 0 END), 0) as total_unrealized,
        COALESCE(SUM(CAST(total_funding AS REAL)), 0) as total_funding,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count
      FROM perp_positions
      WHERE 1=1
    `
    const params: any[] = []

    if (strategyId) {
      sql += ' AND strategy_id = ?'
      params.push(strategyId)
    }

    const row = db.prepare(sql).get(...params) as any

    return {
      totalRealizedPnl: row.total_realized,
      totalUnrealizedPnl: row.total_unrealized,
      totalFunding: row.total_funding,
      totalPnl: row.total_realized + row.total_unrealized + row.total_funding,
      openPositionsCount: row.open_count,
      closedPositionsCount: row.closed_count
    }
  }

  /**
   * Get perp positions with optional filters.
   */
  getPositions(strategyId?: string, status: 'open' | 'closed' | 'all' = 'open'): PerpPosition[] {
    const db = getDatabase()

    let sql = 'SELECT * FROM perp_positions WHERE 1=1'
    const params: any[] = []

    if (strategyId) {
      sql += ' AND strategy_id = ?'
      params.push(strategyId)
    }
    if (status !== 'all') {
      sql += ' AND status = ?'
      params.push(status)
    }
    sql += ' ORDER BY opened_at DESC'

    const rows = db.prepare(sql).all(...params) as any[]
    return rows.map(row => this.mapRow(row))
  }

  /**
   * Get funding payment history for a position.
   */
  getFundingPayments(positionId: string): any[] {
    const db = getDatabase()
    return db.prepare('SELECT * FROM funding_payments WHERE perp_position_id = ? ORDER BY timestamp DESC').all(positionId) as any[]
  }

  /**
   * Get a single position by ID.
   */
  getPositionById(id: string): PerpPosition | null {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM perp_positions WHERE id = ?').get(id) as any
    if (!row) return null
    return this.mapRow(row)
  }

  private mapRow(row: any): PerpPosition {
    return {
      id: row.id,
      strategyId: row.strategy_id,
      accountId: row.account_id,
      protocol: row.protocol,
      chainId: row.chain_id,
      marketSymbol: row.market_symbol,
      side: row.side,
      positionSize: row.position_size,
      avgEntryPrice: row.avg_entry_price,
      currentPrice: row.current_price,
      leverage: row.leverage,
      marginType: row.margin_type,
      collateralAmount: row.collateral_amount,
      collateralAsset: row.collateral_asset,
      liquidationPrice: row.liquidation_price,
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl || '0',
      totalFees: row.total_fees,
      totalFunding: row.total_funding,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at
    }
  }
}

export const perpPnlEngine = new PerpPnlEngine()
