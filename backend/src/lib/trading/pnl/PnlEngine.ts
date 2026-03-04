/**
 * PnL Engine - FIFO Cost Basis Calculator
 *
 * Tracks positions and calculates realized/unrealized PnL using FIFO methodology.
 * Each trade is processed to update position cost basis and compute PnL.
 */

import { getDatabase } from '../../../db/index.js'
import { v4 as uuidv4 } from 'uuid'

export interface TradeInput {
  tradeId: string | number
  strategyId: string
  side: 'buy' | 'sell'
  assetSymbol: string
  assetAddress?: string
  chainId?: number
  quantity: string
  price: string
  fees?: string
  timestamp?: string
  accountId?: string
  quoteAssetSymbol?: string
  protocol?: string
}

export interface Position {
  id: string
  strategyId: string
  assetSymbol: string
  assetAddress?: string | null
  chainId?: number | null
  side: 'long' | 'short'
  quantity: string
  avgEntryPrice: string
  currentPrice?: string | null
  realizedPnl: string
  unrealizedPnl?: string | null
  totalFees: string
  status: 'open' | 'closed'
  openedAt: string
  closedAt?: string | null
  quoteAssetSymbol?: string | null
  protocol?: string | null
}

export interface PnlSummary {
  totalRealizedPnl: number
  totalUnrealizedPnl: number
  totalPnl: number
  openPositionsCount: number
  closedPositionsCount: number
}

export class PnlEngine {
  /**
   * Process a new trade and update positions accordingly.
   *
   * FIFO logic:
   * - Buy: If no existing position or long position exists, add to position (average up)
   * - Sell: If long position exists, reduce position and realize PnL
   * - Sell without position: Open short (or treat as new short)
   */
  processTrade(trade: TradeInput): { position: Position; realizedPnl: number; action: string } {
    const db = getDatabase()
    const quantity = parseFloat(trade.quantity)
    const price = parseFloat(trade.price)
    const fees = parseFloat(trade.fees || '0')
    const accountId = trade.accountId || null
    const quoteAssetSymbol = trade.quoteAssetSymbol || null
    const protocol = trade.protocol || null

    // Find existing open position for this asset + strategy (+ account if provided)
    let positionLookupSql = `
      SELECT * FROM positions
      WHERE strategy_id = ? AND asset_symbol = ? AND status = 'open'
    `
    const positionLookupParams: any[] = [trade.strategyId, trade.assetSymbol]

    if (accountId) {
      positionLookupSql += ' AND account_id = ?'
      positionLookupParams.push(accountId)
    } else {
      positionLookupSql += ' AND account_id IS NULL'
    }

    positionLookupSql += ' LIMIT 1'

    const existingPosition = db.prepare(positionLookupSql).get(...positionLookupParams) as any | undefined

    let positionId: string
    let action: string
    let realizedPnl = 0

    if (trade.side === 'buy') {
      if (!existingPosition) {
        // Open new long position
        positionId = uuidv4()
        action = 'open'

        db.prepare(`
          INSERT INTO positions (id, strategy_id, asset_symbol, asset_address, chain_id, side, quantity, avg_entry_price, realized_pnl, total_fees, status, account_id, quote_asset_symbol, protocol)
          VALUES (?, ?, ?, ?, ?, 'long', ?, ?, '0', ?, 'open', ?, ?, ?)
        `).run(
          positionId,
          trade.strategyId,
          trade.assetSymbol,
          trade.assetAddress || null,
          trade.chainId || null,
          trade.quantity,
          trade.price,
          fees.toString(),
          accountId,
          quoteAssetSymbol,
          protocol
        )
      } else if (existingPosition.side === 'long') {
        // Add to existing long position (average up)
        positionId = existingPosition.id
        action = 'add'

        const existingQty = parseFloat(existingPosition.quantity)
        const existingAvg = parseFloat(existingPosition.avg_entry_price)
        const existingFees = parseFloat(existingPosition.total_fees)

        const newTotalQty = existingQty + quantity
        const newAvgPrice = ((existingAvg * existingQty) + (price * quantity)) / newTotalQty

        db.prepare(`
          UPDATE positions
          SET quantity = ?, avg_entry_price = ?, total_fees = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(
          newTotalQty.toString(),
          newAvgPrice.toString(),
          (existingFees + fees).toString(),
          positionId
        )
      } else {
        // Buying against a short position - reduce short
        positionId = existingPosition.id
        const existingQty = parseFloat(existingPosition.quantity)
        const existingAvg = parseFloat(existingPosition.avg_entry_price)
        const existingFees = parseFloat(existingPosition.total_fees)
        const existingRealizedPnl = parseFloat(existingPosition.realized_pnl)

        if (quantity >= existingQty) {
          // Close short position
          action = 'close'
          realizedPnl = (existingAvg - price) * existingQty - fees

          db.prepare(`
            UPDATE positions
            SET quantity = '0', realized_pnl = ?, total_fees = ?, status = 'closed', closed_at = datetime('now')
            WHERE id = ?
          `).run(
            (existingRealizedPnl + realizedPnl).toString(),
            (existingFees + fees).toString(),
            positionId
          )
        } else {
          // Partial close of short
          action = 'reduce'
          realizedPnl = (existingAvg - price) * quantity - fees
          const remainingQty = existingQty - quantity

          db.prepare(`
            UPDATE positions
            SET quantity = ?, realized_pnl = ?, total_fees = ?
            WHERE id = ?
          `).run(
            remainingQty.toString(),
            (existingRealizedPnl + realizedPnl).toString(),
            (existingFees + fees).toString(),
            positionId
          )
        }
      }
    } else {
      // Sell
      if (!existingPosition) {
        // Open new short position
        positionId = uuidv4()
        action = 'open'

        db.prepare(`
          INSERT INTO positions (id, strategy_id, asset_symbol, asset_address, chain_id, side, quantity, avg_entry_price, realized_pnl, total_fees, status, account_id, quote_asset_symbol, protocol)
          VALUES (?, ?, ?, ?, ?, 'short', ?, ?, '0', ?, 'open', ?, ?, ?)
        `).run(
          positionId,
          trade.strategyId,
          trade.assetSymbol,
          trade.assetAddress || null,
          trade.chainId || null,
          trade.quantity,
          trade.price,
          fees.toString(),
          accountId,
          quoteAssetSymbol,
          protocol
        )
      } else if (existingPosition.side === 'long') {
        // Selling against a long position - reduce long (realize PnL)
        positionId = existingPosition.id
        const existingQty = parseFloat(existingPosition.quantity)
        const existingAvg = parseFloat(existingPosition.avg_entry_price)
        const existingFees = parseFloat(existingPosition.total_fees)
        const existingRealizedPnl = parseFloat(existingPosition.realized_pnl)

        if (quantity >= existingQty) {
          // Close long position
          action = 'close'
          realizedPnl = (price - existingAvg) * existingQty - fees

          db.prepare(`
            UPDATE positions
            SET quantity = '0', realized_pnl = ?, total_fees = ?, status = 'closed', closed_at = datetime('now')
            WHERE id = ?
          `).run(
            (existingRealizedPnl + realizedPnl).toString(),
            (existingFees + fees).toString(),
            positionId
          )
        } else {
          // Partial close of long
          action = 'reduce'
          realizedPnl = (price - existingAvg) * quantity - fees
          const remainingQty = existingQty - quantity

          db.prepare(`
            UPDATE positions
            SET quantity = ?, realized_pnl = ?, total_fees = ?
            WHERE id = ?
          `).run(
            remainingQty.toString(),
            (existingRealizedPnl + realizedPnl).toString(),
            (existingFees + fees).toString(),
            positionId
          )
        }
      } else {
        // Add to existing short position
        positionId = existingPosition.id
        action = 'add'

        const existingQty = parseFloat(existingPosition.quantity)
        const existingAvg = parseFloat(existingPosition.avg_entry_price)
        const existingFees = parseFloat(existingPosition.total_fees)

        const newTotalQty = existingQty + quantity
        const newAvgPrice = ((existingAvg * existingQty) + (price * quantity)) / newTotalQty

        db.prepare(`
          UPDATE positions
          SET quantity = ?, avg_entry_price = ?, total_fees = ?
          WHERE id = ?
        `).run(
          newTotalQty.toString(),
          newAvgPrice.toString(),
          (existingFees + fees).toString(),
          positionId
        )
      }
    }

    // Record trade fill
    const fillId = uuidv4()
    db.prepare(`
      INSERT INTO trade_fills (id, trade_id, position_id, action, quantity, price, realized_pnl)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      fillId,
      trade.tradeId.toString(),
      positionId,
      action,
      trade.quantity,
      trade.price,
      realizedPnl.toString()
    )

    // Get updated position
    const updatedPosition = db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId) as any

    const position: Position = {
      id: updatedPosition.id,
      strategyId: updatedPosition.strategy_id,
      assetSymbol: updatedPosition.asset_symbol,
      assetAddress: updatedPosition.asset_address,
      chainId: updatedPosition.chain_id,
      side: updatedPosition.side,
      quantity: updatedPosition.quantity,
      avgEntryPrice: updatedPosition.avg_entry_price,
      currentPrice: updatedPosition.current_price,
      realizedPnl: updatedPosition.realized_pnl,
      unrealizedPnl: updatedPosition.unrealized_pnl,
      totalFees: updatedPosition.total_fees,
      status: updatedPosition.status,
      openedAt: updatedPosition.opened_at,
      closedAt: updatedPosition.closed_at,
      quoteAssetSymbol: updatedPosition.quote_asset_symbol,
      protocol: updatedPosition.protocol
    }

    return { position, realizedPnl, action }
  }

  /**
   * Update unrealized PnL for all open positions using current market prices.
   */
  updateUnrealizedPnl(currentPrices: Record<string, number>): void {
    const db = getDatabase()
    const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD']

    const openPositions = db.prepare(`
      SELECT * FROM positions WHERE status = 'open'
    `).all() as any[]

    for (const pos of openPositions) {
      // Stablecoins always worth $1
      let currentPrice = currentPrices[pos.asset_symbol]
      if (currentPrice === undefined && stablecoins.includes(pos.asset_symbol.toUpperCase())) {
        currentPrice = 1
      }
      if (currentPrice === undefined) {
        // Zero out unrealized PnL when no market price available (e.g. testnet tokens)
        db.prepare('UPDATE positions SET unrealized_pnl = ? WHERE id = ?').run('0', pos.id)
        continue
      }

      const quantity = parseFloat(pos.quantity)
      const avgEntry = parseFloat(pos.avg_entry_price)

      let unrealizedPnl: number
      if (pos.side === 'long') {
        unrealizedPnl = (currentPrice - avgEntry) * quantity
      } else {
        unrealizedPnl = (avgEntry - currentPrice) * quantity
      }

      db.prepare(`
        UPDATE positions
        SET current_price = ?, unrealized_pnl = ?
        WHERE id = ?
      `).run(
        currentPrice.toString(),
        unrealizedPnl.toString(),
        pos.id
      )
    }
  }

  /**
   * Get total PnL summary across all positions.
   */
  getTotalPnl(strategyId?: string): PnlSummary {
    const db = getDatabase()

    let sql = `
      SELECT
        COALESCE(SUM(CAST(realized_pnl AS REAL)), 0) as total_realized,
        COALESCE(SUM(CASE WHEN status = 'open' THEN CAST(COALESCE(unrealized_pnl, '0') AS REAL) ELSE 0 END), 0) as total_unrealized,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count
      FROM positions
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
      totalPnl: row.total_realized + row.total_unrealized,
      openPositionsCount: row.open_count,
      closedPositionsCount: row.closed_count
    }
  }

  /**
   * Get hourly PnL snapshots for the last N hours.
   */
  getHourlyPnl(hours: number = 24, strategyId?: string): any[] {
    const db = getDatabase()

    let sql = `
      SELECT * FROM pnl_snapshots
      WHERE timestamp >= datetime('now', ?)
    `
    const params: any[] = [`-${hours} hours`]

    if (strategyId) {
      sql += ' AND strategy_id = ?'
      params.push(strategyId)
    }

    sql += ' ORDER BY timestamp ASC'

    return db.prepare(sql).all(...params)
  }

  /**
   * Get all open positions.
   */
  getPositions(strategyId?: string, status: 'open' | 'closed' | 'all' = 'open'): Position[] {
    const db = getDatabase()

    let sql = 'SELECT * FROM positions WHERE 1=1'
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

    return rows.map(row => ({
      id: row.id,
      strategyId: row.strategy_id,
      assetSymbol: row.asset_symbol,
      assetAddress: row.asset_address,
      chainId: row.chain_id,
      side: row.side,
      quantity: row.quantity,
      avgEntryPrice: row.avg_entry_price,
      currentPrice: row.current_price,
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl,
      totalFees: row.total_fees,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      quoteAssetSymbol: row.quote_asset_symbol,
      protocol: row.protocol
    }))
  }

  /**
   * Get PnL summary for a specific account.
   */
  getAccountPnl(accountId: string): PnlSummary {
    const db = getDatabase()

    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CAST(realized_pnl AS REAL)), 0) as total_realized,
        COALESCE(SUM(CASE WHEN status = 'open' THEN CAST(COALESCE(unrealized_pnl, '0') AS REAL) ELSE 0 END), 0) as total_unrealized,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count
      FROM positions
      WHERE account_id = ?
    `).get(accountId) as any

    return {
      totalRealizedPnl: row.total_realized,
      totalUnrealizedPnl: row.total_unrealized,
      totalPnl: row.total_realized + row.total_unrealized,
      openPositionsCount: row.open_count,
      closedPositionsCount: row.closed_count
    }
  }

  /**
   * Get positions for a specific account.
   */
  getAccountPositions(accountId: string, status: 'open' | 'closed' | 'all' = 'open'): Position[] {
    const db = getDatabase()

    let sql = 'SELECT * FROM positions WHERE account_id = ?'
    const params: any[] = [accountId]

    if (status !== 'all') {
      sql += ' AND status = ?'
      params.push(status)
    }

    sql += ' ORDER BY opened_at DESC'

    const rows = db.prepare(sql).all(...params) as any[]

    return rows.map(row => ({
      id: row.id,
      strategyId: row.strategy_id,
      assetSymbol: row.asset_symbol,
      assetAddress: row.asset_address,
      chainId: row.chain_id,
      side: row.side,
      quantity: row.quantity,
      avgEntryPrice: row.avg_entry_price,
      currentPrice: row.current_price,
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl,
      totalFees: row.total_fees,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at
    }))
  }
}

// Singleton instance
export const pnlEngine = new PnlEngine()
