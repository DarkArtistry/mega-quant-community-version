/**
 * Lending Routes
 *
 * GET /api/lending/positions - Get lending positions
 * GET /api/lending/positions/:id - Get single lending position
 * GET /api/lending/pnl - Get lending PnL summary
 */

import express from 'express'
import { lendingPnlEngine } from '../lib/trading/pnl/LendingPnlEngine.js'

const router = express.Router()

router.get('/positions', (req, res) => {
  try {
    const { strategy_id, status = 'open' } = req.query
    const positions = lendingPnlEngine.getPositions(
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
    const position = lendingPnlEngine.getPositionById(req.params.id)
    if (!position) {
      return res.status(404).json({ success: false, error: 'Position not found' })
    }
    res.json({ success: true, position })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.get('/pnl', (req, res) => {
  try {
    const { strategy_id } = req.query
    const summary = lendingPnlEngine.getTotalPnl(strategy_id as string | undefined)
    res.json({ success: true, summary })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
