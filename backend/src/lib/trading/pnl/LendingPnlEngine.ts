/**
 * Lending PnL Engine
 *
 * Manages lending/borrowing positions (Aave V3, etc.) and calculates PnL.
 * PnL = interest earned (supply) or -interest paid (borrow).
 *
 * Uses Aave's liquidity index for precise interest accrual.
 * Single-sided orders: one order per action (supply/withdraw/borrow/repay).
 */

import { getDatabase } from '../../../db/index.js'
import { v4 as uuidv4 } from 'uuid'

export interface LendingTradeInput {
  strategyId: string
  accountId?: string
  protocol: string
  chainId?: number
  assetSymbol: string
  assetAddress?: string
  atokenAddress?: string
  action: 'supply' | 'withdraw' | 'borrow' | 'repay'
  positionType: 'supply' | 'borrow'
  amount: string
  interestRateMode?: string  // 'variable' | 'stable'
  liquidityIndex?: string    // Aave liquidity index at time of action
  currentApy?: string
  healthFactor?: string
  liquidationThreshold?: string
  fees?: string
  positionId?: string        // For withdraw/repay, target a specific position
}

export interface LendingPosition {
  id: string
  strategyId: string | null
  accountId: string | null
  protocol: string
  chainId: number | null
  assetSymbol: string
  assetAddress: string | null
  atokenAddress: string | null
  positionType: 'supply' | 'borrow'
  interestRateMode: string | null
  principalAmount: string
  currentAmount: string
  accruedInterest: string
  currentApy: string | null
  healthFactor: string | null
  liquidationThreshold: string | null
  initialLiquidityIndex: string | null
  currentLiquidityIndex: string | null
  realizedPnl: string
  totalFees: string
  status: 'open' | 'closed' | 'liquidated'
  openedAt: string
  closedAt: string | null
}

export interface LendingPnlSummary {
  totalRealizedPnl: number
  totalAccruedInterest: number
  totalPnl: number
  openPositionsCount: number
  closedPositionsCount: number
}

export class LendingPnlEngine {
  /**
   * Process a lending/borrowing action.
   */
  processLending(trade: LendingTradeInput): { position: LendingPosition; realizedPnl: number; action: string } {
    if (trade.action === 'supply' || trade.action === 'borrow') {
      return this.openOrIncreasePosition(trade)
    }

    if (trade.action === 'withdraw' || trade.action === 'repay') {
      return this.closeOrDecreasePosition(trade)
    }

    throw new Error(`Unknown lending action: ${trade.action}`)
  }

  private openOrIncreasePosition(trade: LendingTradeInput): { position: LendingPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const amount = parseFloat(trade.amount)
    const fees = parseFloat(trade.fees || '0')

    // Check for existing open position of same type
    const existing = this.findPosition(trade)

    if (existing) {
      // Increase existing position
      const existingPrincipal = parseFloat(existing.principal_amount)
      const existingCurrent = parseFloat(existing.current_amount)
      const existingFees = parseFloat(existing.total_fees)

      const newPrincipal = existingPrincipal + amount
      const newCurrent = existingCurrent + amount

      db.prepare(`
        UPDATE lending_positions
        SET principal_amount = ?, current_amount = ?, total_fees = ?,
            current_apy = COALESCE(?, current_apy),
            health_factor = COALESCE(?, health_factor),
            current_liquidity_index = COALESCE(?, current_liquidity_index)
        WHERE id = ?
      `).run(
        newPrincipal.toString(),
        newCurrent.toString(),
        (existingFees + fees).toString(),
        trade.currentApy || null,
        trade.healthFactor || null,
        trade.liquidityIndex || null,
        existing.id
      )

      const position = this.getPositionById(existing.id)!
      console.log(`[LendingPnlEngine] Increased ${trade.action} ${trade.assetSymbol}: +${amount} (total: ${newPrincipal})`)
      return { position, realizedPnl: 0, action: 'increase' }
    }

    // Open new position
    const id = uuidv4()

    db.prepare(`
      INSERT INTO lending_positions (
        id, strategy_id, account_id, protocol, chain_id,
        asset_symbol, asset_address, atoken_address,
        position_type, interest_rate_mode,
        principal_amount, current_amount,
        current_apy, health_factor, liquidation_threshold,
        initial_liquidity_index, current_liquidity_index,
        total_fees, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `).run(
      id,
      trade.strategyId,
      trade.accountId || null,
      trade.protocol,
      trade.chainId || null,
      trade.assetSymbol,
      trade.assetAddress || null,
      trade.atokenAddress || null,
      trade.positionType,
      trade.interestRateMode || null,
      trade.amount,
      trade.amount, // current_amount starts same as principal
      trade.currentApy || null,
      trade.healthFactor || null,
      trade.liquidationThreshold || null,
      trade.liquidityIndex || null,
      trade.liquidityIndex || null,
      fees.toString()
    )

    const position = this.getPositionById(id)!
    console.log(`[LendingPnlEngine] Opened ${trade.positionType} ${trade.amount} ${trade.assetSymbol} via ${trade.protocol}`)
    return { position, realizedPnl: 0, action: 'open' }
  }

  private closeOrDecreasePosition(trade: LendingTradeInput): { position: LendingPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const amount = parseFloat(trade.amount)
    const fees = parseFloat(trade.fees || '0')

    const existing = this.findPosition(trade)
    if (!existing) {
      throw new Error(`No open ${trade.positionType} position found for ${trade.assetSymbol}`)
    }

    const existingPrincipal = parseFloat(existing.principal_amount)
    const existingCurrent = parseFloat(existing.current_amount)
    const existingFees = parseFloat(existing.total_fees)
    const existingRealizedPnl = parseFloat(existing.realized_pnl)

    // Calculate realized PnL
    let realizedPnl: number
    if (trade.positionType === 'supply' || existing.position_type === 'supply') {
      // Supply: PnL = withdrawn amount - proportional principal
      const proportion = Math.min(amount / existingCurrent, 1)
      const principalPortion = existingPrincipal * proportion
      realizedPnl = amount - principalPortion - fees
    } else {
      // Borrow: PnL = -(repaid amount - proportional principal) — interest costs
      const proportion = Math.min(amount / existingCurrent, 1)
      const principalPortion = existingPrincipal * proportion
      realizedPnl = principalPortion - amount - fees // negative = interest cost
    }

    const remainingPrincipal = existingPrincipal - (existingPrincipal * Math.min(amount / existingCurrent, 1))
    const remainingCurrent = existingCurrent - amount

    if (remainingCurrent <= 0.01) {
      // Close position
      db.prepare(`
        UPDATE lending_positions
        SET principal_amount = '0', current_amount = '0', accrued_interest = '0',
            realized_pnl = ?, total_fees = ?,
            current_liquidity_index = COALESCE(?, current_liquidity_index),
            health_factor = COALESCE(?, health_factor),
            status = 'closed', closed_at = datetime('now')
        WHERE id = ?
      `).run(
        (existingRealizedPnl + realizedPnl).toString(),
        (existingFees + fees).toString(),
        trade.liquidityIndex || null,
        trade.healthFactor || null,
        existing.id
      )

      const position = this.getPositionById(existing.id)!
      console.log(`[LendingPnlEngine] Closed ${existing.position_type} ${trade.assetSymbol}, PnL: $${realizedPnl.toFixed(2)}`)
      return { position, realizedPnl, action: 'close' }
    }

    // Partial withdrawal/repayment
    db.prepare(`
      UPDATE lending_positions
      SET principal_amount = ?, current_amount = ?,
          realized_pnl = ?, total_fees = ?,
          current_liquidity_index = COALESCE(?, current_liquidity_index),
          health_factor = COALESCE(?, health_factor),
          current_apy = COALESCE(?, current_apy)
      WHERE id = ?
    `).run(
      remainingPrincipal.toString(),
      remainingCurrent.toString(),
      (existingRealizedPnl + realizedPnl).toString(),
      (existingFees + fees).toString(),
      trade.liquidityIndex || null,
      trade.healthFactor || null,
      trade.currentApy || null,
      existing.id
    )

    const position = this.getPositionById(existing.id)!
    console.log(`[LendingPnlEngine] Decreased ${existing.position_type} ${trade.assetSymbol}: -${amount} (remaining: ${remainingCurrent.toFixed(2)}), PnL: $${realizedPnl.toFixed(2)}`)
    return { position, realizedPnl, action: 'decrease' }
  }

  private findPosition(trade: LendingTradeInput): any | null {
    const db = getDatabase()

    if (trade.positionId) {
      return db.prepare('SELECT * FROM lending_positions WHERE id = ? AND status = \'open\'').get(trade.positionId) || null
    }

    let sql = `
      SELECT * FROM lending_positions
      WHERE asset_symbol = ? AND position_type = ? AND status = 'open'
    `
    const params: any[] = [trade.assetSymbol, trade.positionType]

    if (trade.strategyId) {
      sql += ' AND strategy_id = ?'
      params.push(trade.strategyId)
    }
    if (trade.accountId) {
      sql += ' AND account_id = ?'
      params.push(trade.accountId)
    }
    sql += ' LIMIT 1'

    return db.prepare(sql).get(...params) || null
  }

  /**
   * Update interest accrual for all open lending positions using current liquidity index.
   * Called periodically by AaveInterestTracker.
   */
  updateInterestAccrual(assetSymbol: string, currentLiquidityIndex: string, currentApy?: string): void {
    const db = getDatabase()
    const currentIndex = parseFloat(currentLiquidityIndex)

    const positions = db.prepare(`
      SELECT * FROM lending_positions
      WHERE asset_symbol = ? AND status = 'open' AND initial_liquidity_index IS NOT NULL
    `).all(assetSymbol) as any[]

    for (const pos of positions) {
      const initialIndex = parseFloat(pos.initial_liquidity_index)
      if (initialIndex <= 0) continue

      const principal = parseFloat(pos.principal_amount)
      const indexRatio = currentIndex / initialIndex

      let currentAmount: number
      let accruedInterest: number

      if (pos.position_type === 'supply') {
        currentAmount = principal * indexRatio
        accruedInterest = currentAmount - principal
      } else {
        // For borrows, debt grows
        currentAmount = principal * indexRatio
        accruedInterest = -(currentAmount - principal) // negative = cost
      }

      db.prepare(`
        UPDATE lending_positions
        SET current_amount = ?, accrued_interest = ?,
            current_liquidity_index = ?,
            current_apy = COALESCE(?, current_apy)
        WHERE id = ?
      `).run(
        currentAmount.toString(),
        accruedInterest.toString(),
        currentLiquidityIndex,
        currentApy || null,
        pos.id
      )
    }
  }

  /**
   * Get total PnL summary for lending positions.
   */
  getTotalPnl(strategyId?: string): LendingPnlSummary {
    const db = getDatabase()

    let sql = `
      SELECT
        COALESCE(SUM(CAST(realized_pnl AS REAL)), 0) as total_realized,
        COALESCE(SUM(CASE WHEN status = 'open' THEN CAST(COALESCE(accrued_interest, '0') AS REAL) ELSE 0 END), 0) as total_accrued,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count
      FROM lending_positions
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
      totalAccruedInterest: row.total_accrued,
      totalPnl: row.total_realized + row.total_accrued,
      openPositionsCount: row.open_count,
      closedPositionsCount: row.closed_count
    }
  }

  /**
   * Get lending positions with optional filters.
   */
  getPositions(strategyId?: string, status: 'open' | 'closed' | 'all' = 'open'): LendingPosition[] {
    const db = getDatabase()

    let sql = 'SELECT * FROM lending_positions WHERE 1=1'
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

  getPositionById(id: string): LendingPosition | null {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM lending_positions WHERE id = ?').get(id) as any
    if (!row) return null
    return this.mapRow(row)
  }

  private mapRow(row: any): LendingPosition {
    return {
      id: row.id,
      strategyId: row.strategy_id,
      accountId: row.account_id,
      protocol: row.protocol,
      chainId: row.chain_id,
      assetSymbol: row.asset_symbol,
      assetAddress: row.asset_address,
      atokenAddress: row.atoken_address,
      positionType: row.position_type,
      interestRateMode: row.interest_rate_mode,
      principalAmount: row.principal_amount,
      currentAmount: row.current_amount,
      accruedInterest: row.accrued_interest,
      currentApy: row.current_apy,
      healthFactor: row.health_factor,
      liquidationThreshold: row.liquidation_threshold,
      initialLiquidityIndex: row.initial_liquidity_index,
      currentLiquidityIndex: row.current_liquidity_index,
      realizedPnl: row.realized_pnl,
      totalFees: row.total_fees,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at
    }
  }
}

export const lendingPnlEngine = new LendingPnlEngine()
