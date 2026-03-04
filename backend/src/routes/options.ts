/**
 * Options Routes
 *
 * GET /api/options/positions - Get option positions
 * GET /api/options/positions/:id - Get single option position
 * GET /api/options/pnl - Get options PnL summary
 */

import express from 'express'
import { optionsPnlEngine } from '../lib/trading/pnl/OptionsPnlEngine.js'

const router = express.Router()

router.get('/positions', (req, res) => {
  try {
    const { strategy_id, status = 'open' } = req.query
    const positions = optionsPnlEngine.getPositions(
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
    const position = optionsPnlEngine.getPositionById(req.params.id)
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
    const summary = optionsPnlEngine.getTotalPnl(strategy_id as string | undefined)
    res.json({ success: true, summary })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
