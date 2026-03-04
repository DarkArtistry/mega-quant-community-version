/**
 * Options PnL Engine
 *
 * Manages option positions and calculates PnL.
 * PnL = premium delta (close - open) or settlement value at expiry.
 *
 * Single-sided orders: one order per action (buy/sell/exercise/expire).
 */

import { getDatabase } from '../../../db/index.js'
import { v4 as uuidv4 } from 'uuid'

export interface OptionTradeInput {
  strategyId: string
  accountId?: string
  protocol: string
  chainId?: number
  underlyingSymbol: string
  optionType: 'call' | 'put'
  side: 'long' | 'short'
  strikePrice: string
  expiry: string
  action: 'open' | 'close' | 'expire' | 'exercise'
  premium: string        // Entry premium for open, exit premium for close
  contracts: string
  fees?: string
  spotPrice?: string     // Underlying spot price at settlement
  positionId?: string    // For close/expire, target a specific position
  // Greeks (optional, stored for reference)
  delta?: string
  gamma?: string
  theta?: string
  vega?: string
  impliedVolatility?: string
}

export interface OptionPosition {
  id: string
  strategyId: string | null
  accountId: string | null
  protocol: string
  chainId: number | null
  underlyingSymbol: string
  optionType: 'call' | 'put'
  side: 'long' | 'short'
  strikePrice: string
  expiry: string
  contracts: string
  entryPremium: string
  currentPremium: string | null
  realizedPnl: string
  unrealizedPnl: string
  totalFees: string
  delta: string | null
  gamma: string | null
  theta: string | null
  vega: string | null
  impliedVolatility: string | null
  status: 'open' | 'closed' | 'expired' | 'exercised'
  openedAt: string
  closedAt: string | null
}

export interface OptionsPnlSummary {
  totalRealizedPnl: number
  totalUnrealizedPnl: number
  totalPnl: number
  openPositionsCount: number
  closedPositionsCount: number
}

export class OptionsPnlEngine {
  /**
   * Process an options trade.
   */
  processOption(trade: OptionTradeInput): { position: OptionPosition; realizedPnl: number; action: string } {
    if (trade.action === 'open') {
      return this.openPosition(trade)
    }

    // Find existing position
    const existing = this.findPosition(trade)
    if (!existing) {
      throw new Error(`No open option position found for ${trade.underlyingSymbol} ${trade.optionType} ${trade.strikePrice}`)
    }

    if (trade.action === 'close') {
      return this.closePosition(existing, trade)
    }

    if (trade.action === 'expire') {
      return this.expirePosition(existing, trade)
    }

    if (trade.action === 'exercise') {
      return this.exercisePosition(existing, trade)
    }

    throw new Error(`Unknown option action: ${trade.action}`)
  }

  private findPosition(trade: OptionTradeInput): any | null {
    const db = getDatabase()

    if (trade.positionId) {
      return db.prepare('SELECT * FROM options_positions WHERE id = ? AND status = \'open\'').get(trade.positionId)
    }

    let sql = `
      SELECT * FROM options_positions
      WHERE underlying_symbol = ? AND option_type = ? AND strike_price = ? AND expiry = ? AND status = 'open'
    `
    const params: any[] = [trade.underlyingSymbol, trade.optionType, trade.strikePrice, trade.expiry]

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

  private openPosition(trade: OptionTradeInput): { position: OptionPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const id = uuidv4()
    const fees = parseFloat(trade.fees || '0')

    db.prepare(`
      INSERT INTO options_positions (
        id, strategy_id, account_id, protocol, chain_id,
        underlying_symbol, option_type, side, strike_price, expiry,
        contracts, entry_premium, total_fees,
        delta, gamma, theta, vega, implied_volatility,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `).run(
      id,
      trade.strategyId,
      trade.accountId || null,
      trade.protocol,
      trade.chainId || null,
      trade.underlyingSymbol,
      trade.optionType,
      trade.side,
      trade.strikePrice,
      trade.expiry,
      trade.contracts,
      trade.premium,
      fees.toString(),
      trade.delta || null,
      trade.gamma || null,
      trade.theta || null,
      trade.vega || null,
      trade.impliedVolatility || null
    )

    const position = this.getPositionById(id)!
    console.log(`[OptionsPnlEngine] Opened ${trade.side} ${trade.optionType} ${trade.underlyingSymbol} strike=${trade.strikePrice} exp=${trade.expiry} x${trade.contracts} @ ${trade.premium}`)
    return { position, realizedPnl: 0, action: 'open' }
  }

  private closePosition(existing: any, trade: OptionTradeInput): { position: OptionPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const entryPremium = parseFloat(existing.entry_premium)
    const exitPremium = parseFloat(trade.premium)
    const contracts = parseFloat(existing.contracts)
    const fees = parseFloat(trade.fees || '0')
    const existingFees = parseFloat(existing.total_fees)
    const existingRealizedPnl = parseFloat(existing.realized_pnl)

    // Long option: PnL = (exit - entry) x contracts
    // Short option: PnL = (entry - exit) x contracts
    const direction = existing.side === 'long' ? 1 : -1
    const realizedPnl = (exitPremium - entryPremium) * contracts * direction - fees

    db.prepare(`
      UPDATE options_positions
      SET current_premium = ?, realized_pnl = ?, total_fees = ?,
          status = 'closed', closed_at = datetime('now')
      WHERE id = ?
    `).run(
      trade.premium,
      (existingRealizedPnl + realizedPnl).toString(),
      (existingFees + fees).toString(),
      existing.id
    )

    const position = this.getPositionById(existing.id)!
    console.log(`[OptionsPnlEngine] Closed ${existing.side} ${existing.option_type} ${existing.underlying_symbol} @ ${trade.premium}, PnL: $${realizedPnl.toFixed(2)}`)
    return { position, realizedPnl, action: 'close' }
  }

  private expirePosition(existing: any, trade: OptionTradeInput): { position: OptionPosition; realizedPnl: number; action: string } {
    const db = getDatabase()
    const entryPremium = parseFloat(existing.entry_premium)
    const contracts = parseFloat(existing.contracts)
    const fees = parseFloat(trade.fees || '0')
    const existingFees = parseFloat(existing.total_fees)
    const existingRealizedPnl = parseFloat(existing.realized_pnl)
    const spotPrice = parseFloat(trade.spotPrice || '0')
    const strikePrice = parseFloat(existing.strike_price)

    let settlementValue = 0

    if (existing.option_type === 'call') {
      // Call ITM if spot > strike
      settlementValue = Math.max(spotPrice - strikePrice, 0) * contracts
    } else {
      // Put ITM if strike > spot
      settlementValue = Math.max(strikePrice - spotPrice, 0) * contracts
    }

    let realizedPnl: number
    if (existing.side === 'long') {
      // Long: paid premium, receive settlement
      realizedPnl = settlementValue - (entryPremium * contracts) - fees
    } else {
      // Short: received premium, pay settlement
      realizedPnl = (entryPremium * contracts) - settlementValue - fees
    }

    const finalStatus = settlementValue > 0 ? 'exercised' : 'expired'

    db.prepare(`
      UPDATE options_positions
      SET realized_pnl = ?, total_fees = ?, unrealized_pnl = '0',
          status = ?, closed_at = datetime('now')
      WHERE id = ?
    `).run(
      (existingRealizedPnl + realizedPnl).toString(),
      (existingFees + fees).toString(),
      finalStatus,
      existing.id
    )

    const position = this.getPositionById(existing.id)!
    console.log(`[OptionsPnlEngine] ${finalStatus}: ${existing.option_type} ${existing.underlying_symbol} strike=${existing.strike_price} spot=${spotPrice}, PnL: $${realizedPnl.toFixed(2)}`)
    return { position, realizedPnl, action: finalStatus }
  }

  private exercisePosition(existing: any, trade: OptionTradeInput): { position: OptionPosition; realizedPnl: number; action: string } {
    // Exercise is functionally same as expire with ITM settlement
    return this.expirePosition(existing, { ...trade, action: 'expire' })
  }

  /**
   * Update unrealized PnL for open options using current premium prices.
   */
  updateUnrealizedPnl(currentPremiums: Record<string, number>): void {
    const db = getDatabase()
    const openPositions = db.prepare('SELECT * FROM options_positions WHERE status = \'open\'').all() as any[]

    for (const pos of openPositions) {
      // Key format: "ETH-CALL-4000-2026-03-28" or similar
      const key = `${pos.underlying_symbol}-${pos.option_type.toUpperCase()}-${pos.strike_price}-${pos.expiry}`
      const currentPremium = currentPremiums[key] ?? currentPremiums[pos.underlying_symbol]
      if (currentPremium === undefined) continue

      const entryPremium = parseFloat(pos.entry_premium)
      const contracts = parseFloat(pos.contracts)
      const direction = pos.side === 'long' ? 1 : -1
      const unrealizedPnl = (currentPremium - entryPremium) * contracts * direction

      db.prepare('UPDATE options_positions SET current_premium = ?, unrealized_pnl = ? WHERE id = ?').run(
        currentPremium.toString(),
        unrealizedPnl.toString(),
        pos.id
      )
    }
  }

  /**
   * Update Greeks for an option position.
   */
  updateGreeks(positionId: string, greeks: { delta?: string; gamma?: string; theta?: string; vega?: string; impliedVolatility?: string }): void {
    const db = getDatabase()
    const updates: string[] = []
    const params: any[] = []

    if (greeks.delta !== undefined) { updates.push('delta = ?'); params.push(greeks.delta) }
    if (greeks.gamma !== undefined) { updates.push('gamma = ?'); params.push(greeks.gamma) }
    if (greeks.theta !== undefined) { updates.push('theta = ?'); params.push(greeks.theta) }
    if (greeks.vega !== undefined) { updates.push('vega = ?'); params.push(greeks.vega) }
    if (greeks.impliedVolatility !== undefined) { updates.push('implied_volatility = ?'); params.push(greeks.impliedVolatility) }

    if (updates.length === 0) return

    params.push(positionId)
    db.prepare(`UPDATE options_positions SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  }

  /**
   * Get all expired-but-open options (for the expiry checker service).
   */
  getExpiredOpenPositions(): OptionPosition[] {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT * FROM options_positions
      WHERE status = 'open' AND expiry <= datetime('now')
      ORDER BY expiry ASC
    `).all() as any[]
    return rows.map(row => this.mapRow(row))
  }

  /**
   * Get total PnL summary for option positions.
   */
  getTotalPnl(strategyId?: string): OptionsPnlSummary {
    const db = getDatabase()

    let sql = `
      SELECT
        COALESCE(SUM(CAST(realized_pnl AS REAL)), 0) as total_realized,
        COALESCE(SUM(CASE WHEN status = 'open' THEN CAST(COALESCE(unrealized_pnl, '0') AS REAL) ELSE 0 END), 0) as total_unrealized,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN status IN ('closed', 'expired', 'exercised') THEN 1 END) as closed_count
      FROM options_positions
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
   * Get option positions with optional filters.
   */
  getPositions(strategyId?: string, status: 'open' | 'closed' | 'all' = 'open'): OptionPosition[] {
    const db = getDatabase()

    let sql = 'SELECT * FROM options_positions WHERE 1=1'
    const params: any[] = []

    if (strategyId) {
      sql += ' AND strategy_id = ?'
      params.push(strategyId)
    }
    if (status === 'open') {
      sql += ' AND status = \'open\''
    } else if (status === 'closed') {
      sql += ' AND status IN (\'closed\', \'expired\', \'exercised\')'
    }
    sql += ' ORDER BY opened_at DESC'

    const rows = db.prepare(sql).all(...params) as any[]
    return rows.map(row => this.mapRow(row))
  }

  getPositionById(id: string): OptionPosition | null {
    const db = getDatabase()
    const row = db.prepare('SELECT * FROM options_positions WHERE id = ?').get(id) as any
    if (!row) return null
    return this.mapRow(row)
  }

  private mapRow(row: any): OptionPosition {
    return {
      id: row.id,
      strategyId: row.strategy_id,
      accountId: row.account_id,
      protocol: row.protocol,
      chainId: row.chain_id,
      underlyingSymbol: row.underlying_symbol,
      optionType: row.option_type,
      side: row.side,
      strikePrice: row.strike_price,
      expiry: row.expiry,
      contracts: row.contracts,
      entryPremium: row.entry_premium,
      currentPremium: row.current_premium,
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl || '0',
      totalFees: row.total_fees,
      delta: row.delta,
      gamma: row.gamma,
      theta: row.theta,
      vega: row.vega,
      impliedVolatility: row.implied_volatility,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at
    }
  }
}

export const optionsPnlEngine = new OptionsPnlEngine()
