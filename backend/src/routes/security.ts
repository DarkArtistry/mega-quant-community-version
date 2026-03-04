import express from 'express'
import { getDatabase } from '../db/index.js'
import {
  hashPassword,
  verifyPassword,
  generateSalt,
  validatePasswordStrength
} from '../utils/crypto.js'

const router = express.Router()

/**
 * Check if initial setup is complete
 */
router.get('/setup-status', (req, res) => {
  try {
    const db = getDatabase()
    const security = db.prepare(`
      SELECT is_setup_complete
      FROM app_security
      WHERE id = 1
    `).get() as { is_setup_complete: number } | undefined

    res.json({
      success: true,
      isSetupComplete: security ? security.is_setup_complete === 1 : false
    })
  } catch (error: any) {
    console.error('Error checking setup status:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check setup status'
    })
  }
})

/**
 * Setup initial password (first time only)
 */
router.post('/setup', (req, res) => {
  try {
    const { password } = req.body

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required'
      })
    }

    // Validate password strength
    const validation = validatePasswordStrength(password)
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Password does not meet requirements',
        errors: validation.errors
      })
    }

    const db = getDatabase()

    // Check if setup already complete
    const existing = db.prepare(`
      SELECT is_setup_complete
      FROM app_security
      WHERE id = 1
    `).get() as { is_setup_complete: number } | undefined

    if (existing && existing.is_setup_complete === 1) {
      return res.status(400).json({
        success: false,
        error: 'Setup is already complete'
      })
    }

    // Hash password
    const passwordSalt = generateSalt()
    const { hash: passwordHash } = hashPassword(password, passwordSalt)

    // Generate separate salt for key derivation
    const keySalt = generateSalt()

    // Store security data
    if (existing) {
      // Update existing row
      db.prepare(`
        UPDATE app_security
        SET
          password_hash = ?,
          password_salt = ?,
          key_salt = ?,
          is_setup_complete = 1,
          setup_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).run(passwordHash, passwordSalt, keySalt)
    } else {
      // Insert new row
      db.prepare(`
        INSERT INTO app_security (
          id, password_hash, password_salt, key_salt, is_setup_complete, setup_at
        ) VALUES (1, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `).run(passwordHash, passwordSalt, keySalt)
    }

    res.json({
      success: true,
      message: 'Password setup completed successfully'
    })
  } catch (error: any) {
    console.error('Error during setup:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to setup password'
    })
  }
})

/**
 * Verify password (unlock app)
 */
router.post('/unlock', async (req, res) => {
  try {
    const { password } = req.body

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required'
      })
    }

    const db = getDatabase()

    // Get stored security data
    const security = db.prepare(`
      SELECT password_hash, password_salt, key_salt, is_setup_complete
      FROM app_security
      WHERE id = 1
    `).get() as {
      password_hash: string
      password_salt: string
      key_salt: string
      is_setup_complete: number
    } | undefined

    if (!security || security.is_setup_complete !== 1) {
      return res.status(400).json({
        success: false,
        error: 'App setup is not complete'
      })
    }

    // Verify password
    const isValid = verifyPassword(password, security.password_hash, security.password_salt)

    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid password'
      })
    }

    // Load all accounts into memory
    try {
      const { loadAllAccounts } = await import('../services/load-all-accounts.js')
      const { accountKeyStore } = await import('../services/account-key-store.js')

      const accounts = loadAllAccounts(password)
      accountKeyStore.loadAccounts(accounts)

      console.log(`[Security] Loaded ${accounts.length} accounts into memory`)
    } catch (error: any) {
      console.error('[Security] Failed to load accounts:', error.message)
      return res.status(500).json({
        success: false,
        error: 'Failed to load accounts: ' + error.message
      })
    }

    // Load all API keys into memory
    try {
      const { decryptAlchemyApiKey, decryptCoinMarketCapApiKey, decryptOneInchApiKey, decryptBinanceApiKey, decryptBinanceApiSecret } = await import('../services/encryption-service.js')
      const { apiKeyStore } = await import('../services/api-key-store.js')

      const alchemyApiKey = decryptAlchemyApiKey(password)
      const coinMarketCapApiKey = decryptCoinMarketCapApiKey(password)
      const oneInchApiKey = decryptOneInchApiKey(password)
      const binanceApiKey = decryptBinanceApiKey(password)
      const binanceApiSecret = decryptBinanceApiSecret(password)

      // Read binance_testnet flag from DB (not encrypted)
      const { getDatabase: getDb } = await import('../db/index.js')
      const apiConfigRow = getDb().prepare('SELECT binance_testnet FROM api_configs WHERE id = 1').get() as any

      apiKeyStore.loadKeys({
        alchemyApiKey: alchemyApiKey || undefined,
        coinMarketCapApiKey: coinMarketCapApiKey || undefined,
        oneInchApiKey: oneInchApiKey || undefined,
        binanceApiKey: binanceApiKey || undefined,
        binanceApiSecret: binanceApiSecret || undefined,
        binanceTestnet: !!apiConfigRow?.binance_testnet,
      })

      console.log(`[Security] API keys loaded into memory`)
    } catch (error: any) {
      console.warn('[Security] Warning: Failed to load API keys:', error.message)
      // Don't fail unlock if API keys can't be loaded - user can still use app
    }

    // Update last unlocked time
    db.prepare(`
      UPDATE app_security
      SET last_unlocked_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run()

    // Return key salt for client-side key derivation
    res.json({
      success: true,
      message: 'Password verified successfully',
      keySalt: security.key_salt
    })
  } catch (error: any) {
    console.error('Error during unlock:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to verify password'
    })
  }
})

/**
 * Lock app (clear sensitive data from memory)
 */
router.post('/lock', async (req, res) => {
  try {
    // Clear accounts from memory
    try {
      const { accountKeyStore } = await import('../services/account-key-store.js')
      accountKeyStore.clear()
    } catch (error: any) {
      console.error('[Security] Failed to clear accounts:', error.message)
    }

    // Clear API keys from memory
    try {
      const { apiKeyStore } = await import('../services/api-key-store.js')
      apiKeyStore.clear()
    } catch (error: any) {
      console.error('[Security] Failed to clear API keys:', error.message)
    }

    console.log('[Security] App locked - all sensitive data cleared from memory')

    res.json({
      success: true,
      message: 'App locked successfully'
    })
  } catch (error: any) {
    console.error('Error during lock:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to lock app'
    })
  }
})

/**
 * Reset app (delete all data and start fresh)
 * WARNING: This will delete ALL data including strategies, trades, etc.
 */
router.post('/reset', (req, res) => {
  try {
    const { confirmReset } = req.body

    if (confirmReset !== 'DELETE_ALL_DATA') {
      return res.status(400).json({
        success: false,
        error: 'Reset confirmation is required'
      })
    }

    const db = getDatabase()

    // Delete all data from all tables
    db.exec(`
      DELETE FROM app_security;
      DELETE FROM api_configs;
      DELETE FROM accounts;
      DELETE FROM network_rpc_configs;
      DELETE FROM strategies;
      DELETE FROM strategy_executions;
      DELETE FROM trades;
      DELETE FROM wallet_config;
      DELETE FROM assets;
      DELETE FROM token_balances;
      DELETE FROM gas_reserves;
      DELETE FROM perp_positions;
      DELETE FROM options_positions;
      DELETE FROM lp_positions;
      DELETE FROM funding_payments;
      DELETE FROM portfolio_snapshots;
      DELETE FROM price_history;
      DELETE FROM orders;
      DELETE FROM positions;
      DELETE FROM pnl_snapshots;
      DELETE FROM trade_fills;

      -- Re-insert default api_configs row
      INSERT INTO api_configs (id) VALUES (1);
    `)

    res.json({
      success: true,
      message: 'App reset successfully. All data has been deleted.'
    })
  } catch (error: any) {
    console.error('Error during reset:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to reset app'
    })
  }
})

/**
 * Validate password strength without saving
 */
router.post('/validate-password', (req, res) => {
  try {
    const { password } = req.body

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required'
      })
    }

    const validation = validatePasswordStrength(password)

    res.json({
      success: true,
      valid: validation.valid,
      errors: validation.errors
    })
  } catch (error: any) {
    console.error('Error validating password:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to validate password'
    })
  }
})

/**
 * Change password (requires current password verification)
 * IMPORTANT: This re-encrypts all sensitive data with the new password
 */
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Both current and new passwords are required'
      })
    }

    // Validate new password strength
    const validation = validatePasswordStrength(newPassword)
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'New password does not meet requirements',
        errors: validation.errors
      })
    }

    // Check if passwords are the same
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        error: 'New password must be different from current password'
      })
    }

    const db = getDatabase()

    // Get stored security data
    const security = db.prepare(`
      SELECT password_hash, password_salt, key_salt, is_setup_complete
      FROM app_security
      WHERE id = 1
    `).get() as {
      password_hash: string
      password_salt: string
      key_salt: string
      is_setup_complete: number
    } | undefined

    if (!security || security.is_setup_complete !== 1) {
      return res.status(400).json({
        success: false,
        error: 'App setup is not complete'
      })
    }

    // Verify current password
    const isValid = verifyPassword(currentPassword, security.password_hash, security.password_salt)
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      })
    }

    // Generate new password hash and salts
    const newPasswordSalt = generateSalt()
    const { hash: newPasswordHash } = hashPassword(newPassword, newPasswordSalt)
    const newKeySalt = generateSalt()

    // Update password in database
    db.prepare(`
      UPDATE app_security
      SET
        password_hash = ?,
        password_salt = ?,
        key_salt = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(newPasswordHash, newPasswordSalt, newKeySalt)

    res.json({
      success: true,
      message: 'Password changed successfully',
      warning: 'Please re-add your accounts with the new password for full security'
    })
  } catch (error: any) {
    console.error('Error changing password:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to change password'
    })
  }
})

export default router
