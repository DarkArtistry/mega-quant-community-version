/**
 * Perps Routes
 *
 * GET /api/perps/positions - Get perp positions
 * GET /api/perps/positions/:id - Get single perp position
 * GET /api/perps/funding/:positionId - Get funding payments for a position
 * GET /api/perps/pnl - Get perp PnL summary
 */

import express from 'express'
import { perpPnlEngine } from '../lib/trading/pnl/PerpPnlEngine.js'

const router = express.Router()

router.get('/positions', (req, res) => {
  try {
    const { strategy_id, status = 'open' } = req.query
    const positions = perpPnlEngine.getPositions(
      strategy_id as string | undefined,
      status as 'open' | 'closed' | 'all'
    )
    res.json({ success: true, positions, count: positions.length })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.get('/positions/:id', (req, res) => {
  try {
    const position = perpPnlEngine.getPositionById(req.params.id)
    if (!position) {
      return res.status(404).json({ success: false, error: 'Position not found' })
    }
    res.json({ success: true, position })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.get('/funding/:positionId', (req, res) => {
  try {
    const payments = perpPnlEngine.getFundingPayments(req.params.positionId)
    res.json({ success: true, payments, count: payments.length })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.get('/pnl', (req, res) => {
  try {
    const { strategy_id } = req.query
    const summary = perpPnlEngine.getTotalPnl(strategy_id as string | undefined)
    res.json({ success: true, summary })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
