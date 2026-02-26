import express from 'express'
import {
  getStrategyAccountMappings,
  setStrategyAccountMapping,
  removeStrategyAccountMapping,
  setCexAccountMapping,
  removeCexAccountMapping
} from '../services/strategy-accounts.js'

const router = express.Router()

/**
 * GET /api/strategy-accounts/:strategyId
 * Get all account mappings for a strategy
 */
router.get('/:strategyId', (req, res) => {
  try {
    const { strategyId } = req.params
    const mappings = getStrategyAccountMappings(strategyId)

    res.json({
      success: true,
      mappings
    })
  } catch (error: any) {
    console.error('Error fetching strategy account mappings:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/strategy-accounts/:strategyId/networks/:networkId
 * Set account mapping for a strategy network
 *
 * Body: { accountId: string }
 */
router.post('/:strategyId/networks/:networkId', (req, res) => {
  try {
    const { strategyId, networkId } = req.params
    const { accountId } = req.body

    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'accountId is required'
      })
    }

    const networkIdNum = parseInt(networkId, 10)
    if (isNaN(networkIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'networkId must be a number'
      })
    }

    setStrategyAccountMapping(strategyId, networkIdNum, accountId)

    res.json({
      success: true,
      message: 'Account mapping set successfully'
    })
  } catch (error: any) {
    console.error('Error setting strategy account mapping:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * DELETE /api/strategy-accounts/:strategyId/networks/:networkId
 * Remove account mapping for a strategy network
 */
router.delete('/:strategyId/networks/:networkId', (req, res) => {
  try {
    const { strategyId, networkId } = req.params

    const networkIdNum = parseInt(networkId, 10)
    if (isNaN(networkIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'networkId must be a number'
      })
    }

    removeStrategyAccountMapping(strategyId, networkIdNum)

    res.json({
      success: true,
      message: 'Account mapping removed successfully'
    })
  } catch (error: any) {
    console.error('Error removing strategy account mapping:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/strategy-accounts/:strategyId/cex/:exchangeName
 * Set CEX account mapping for a strategy
 */
router.post('/:strategyId/cex/:exchangeName', (req, res) => {
  try {
    const { strategyId, exchangeName } = req.params

    if (!exchangeName) {
      return res.status(400).json({
        success: false,
        error: 'exchangeName is required'
      })
    }

    setCexAccountMapping(strategyId, exchangeName)

    res.json({
      success: true,
      message: `CEX account mapping set for ${exchangeName}`
    })
  } catch (error: any) {
    console.error('Error setting CEX account mapping:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * DELETE /api/strategy-accounts/:strategyId/cex/:exchangeName
 * Remove CEX account mapping for a strategy
 */
router.delete('/:strategyId/cex/:exchangeName', (req, res) => {
  try {
    const { strategyId, exchangeName } = req.params

    if (!exchangeName) {
      return res.status(400).json({
        success: false,
        error: 'exchangeName is required'
      })
    }

    removeCexAccountMapping(strategyId, exchangeName)

    res.json({
      success: true,
      message: `CEX account mapping removed for ${exchangeName}`
    })
  } catch (error: any) {
    console.error('Error removing CEX account mapping:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

export default router
