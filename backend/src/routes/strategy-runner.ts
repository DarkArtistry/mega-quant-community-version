// Strategy Runner API Routes
// Provides HTTP endpoints for starting, stopping, pausing, and monitoring strategy executions.

import express from 'express'
import { strategyRunnerManager } from '../lib/strategy/StrategyRunner.js'
import { liveDataService } from '../services/live-data.js'
import { getDatabase } from '../db/index.js'

const router = express.Router()

// ============================================================
// GET /api/strategy-runner/active
// List all active runners
// NOTE: Must be registered BEFORE /:strategyId routes to avoid
// "active" being captured as a strategyId parameter.
// ============================================================
router.get('/active', (_req, res) => {
  try {
    const activeRunners = strategyRunnerManager.getActiveRunners()

    res.json({
      success: true,
      runners: activeRunners,
      count: activeRunners.length
    })
  } catch (error: any) {
    console.error('[strategy-runner] Error listing active runners:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================
// POST /api/strategy-runner/:strategyId/start
// Start running a strategy
// ============================================================
router.post('/:strategyId/start', async (req, res) => {
  try {
    const { strategyId } = req.params
    const { timeoutMs, maxLogEntries } = req.body || {}

    const runner = strategyRunnerManager.getOrCreateRunner(strategyId, {
      timeoutMs,
      maxLogEntries
    })

    const currentState = runner.getStatus().state
    if (currentState === 'running' || currentState === 'initializing') {
      return res.status(409).json({
        success: false,
        error: `Strategy ${strategyId} is already ${currentState}`
      })
    }

    await runner.start()

    liveDataService.broadcastStrategyUpdate({
      strategyId,
      status: 'running',
      message: 'Strategy started',
      timestamp: Date.now()
    })

    res.json({
      success: true,
      status: runner.getStatus()
    })
  } catch (error: any) {
    console.error(`[strategy-runner] Error starting strategy ${req.params.strategyId}:`, error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================
// POST /api/strategy-runner/:strategyId/stop
// Stop a running strategy
// ============================================================
router.post('/:strategyId/stop', async (req, res) => {
  try {
    const { strategyId } = req.params

    const runner = strategyRunnerManager.getRunner(strategyId)
    if (!runner) {
      // No runner means it was never started or already cleaned up — treat as success
      return res.json({ success: true, status: { state: 'stopped', strategyId } })
    }

    await runner.stop()

    liveDataService.broadcastStrategyUpdate({
      strategyId,
      status: 'stopped',
      message: 'Strategy stopped',
      timestamp: Date.now()
    })

    res.json({
      success: true,
      status: runner.getStatus()
    })
  } catch (error: any) {
    console.error(`[strategy-runner] Error stopping strategy ${req.params.strategyId}:`, error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================
// POST /api/strategy-runner/:strategyId/pause
// Pause a running strategy
// ============================================================
router.post('/:strategyId/pause', async (req, res) => {
  try {
    const { strategyId } = req.params

    const runner = strategyRunnerManager.getRunner(strategyId)
    if (!runner) {
      return res.status(404).json({
        success: false,
        error: `No runner found for strategy ${strategyId}`
      })
    }

    runner.pause()

    liveDataService.broadcastStrategyUpdate({
      strategyId,
      status: 'paused',
      message: 'Strategy paused',
      timestamp: Date.now()
    })

    res.json({
      success: true,
      status: runner.getStatus()
    })
  } catch (error: any) {
    console.error(`[strategy-runner] Error pausing strategy ${req.params.strategyId}:`, error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================
// POST /api/strategy-runner/:strategyId/resume
// Resume a paused strategy
// ============================================================
router.post('/:strategyId/resume', async (req, res) => {
  try {
    const { strategyId } = req.params

    const runner = strategyRunnerManager.getRunner(strategyId)
    if (!runner) {
      return res.status(404).json({
        success: false,
        error: `No runner found for strategy ${strategyId}`
      })
    }

    runner.resume()

    liveDataService.broadcastStrategyUpdate({
      strategyId,
      status: 'running',
      message: 'Strategy resumed',
      timestamp: Date.now()
    })

    res.json({
      success: true,
      status: runner.getStatus()
    })
  } catch (error: any) {
    console.error(`[strategy-runner] Error resuming strategy ${req.params.strategyId}:`, error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================
// GET /api/strategy-runner/:strategyId/status
// Get runner status and logs
// ============================================================
router.get('/:strategyId/status', (req, res) => {
  try {
    const { strategyId } = req.params
    const { since, limit } = req.query

    const runner = strategyRunnerManager.getRunner(strategyId)
    if (!runner) {
      return res.status(404).json({
        success: false,
        error: `No runner found for strategy ${strategyId}`
      })
    }

    const status = runner.getStatus()
    const logs = runner.getLogs(
      since as string | undefined,
      limit ? parseInt(limit as string, 10) : undefined
    )

    res.json({
      success: true,
      status,
      logs
    })
  } catch (error: any) {
    console.error(`[strategy-runner] Error getting status for ${req.params.strategyId}:`, error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// ============================================================
// GET /api/strategy-runner/:strategyId/logs
// Get paginated logs from persistent storage
// ============================================================
router.get('/:strategyId/logs', (req, res) => {
  try {
    const { strategyId } = req.params
    const limit = Math.min(parseInt(req.query.limit as string) || 1000, 5000)
    const before = req.query.before as string | undefined // log ID for pagination

    const db = getDatabase()

    let rows: any[]
    if (before) {
      rows = db.prepare(`
        SELECT id, level, message, timestamp, run_id
        FROM strategy_logs
        WHERE strategy_id = ? AND id < ?
        ORDER BY id DESC
        LIMIT ?
      `).all(strategyId, parseInt(before), limit)
    } else {
      rows = db.prepare(`
        SELECT id, level, message, timestamp, run_id
        FROM strategy_logs
        WHERE strategy_id = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(strategyId, limit)
    }

    // Reverse to chronological order
    rows.reverse()

    const hasMore = rows.length === limit

    res.json({
      success: true,
      logs: rows,
      hasMore,
      oldestId: rows.length > 0 ? rows[0].id : null,
    })
  } catch (error: any) {
    console.error(`[strategy-runner] Error getting logs for ${req.params.strategyId}:`, error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
