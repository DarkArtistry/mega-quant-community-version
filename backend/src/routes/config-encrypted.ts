import express from 'express'
import { getDatabase } from '../db/index.js'
import { encrypt, decrypt, deriveKey } from '../utils/crypto.js'

const router = express.Router()

/**
 * Middleware to derive encryption key from password
 * Client sends password and keySalt, backend derives the key
 */
function deriveEncryptionKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const { password } = req.body

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required for encryption'
      })
    }

    // Get key salt from database
    const db = getDatabase()
    const security = db.prepare(`
      SELECT key_salt
      FROM app_security
      WHERE id = 1
    `).get() as { key_salt: string } | undefined

    if (!security) {
      return res.status(400).json({
        success: false,
        error: 'App security not initialized'
      })
    }

    // Derive encryption key
    const key = deriveKey(password, security.key_salt)

    // Attach key to request object for use in route handlers
    ;(req as any).encryptionKey = key

    next()
  } catch (error: any) {
    console.error('Error deriving encryption key:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to derive encryption key'
    })
  }
}

// ============================================================================
// API Configs Routes
// ============================================================================

// Get API configuration (encrypted)
router.post('/api-config/get', deriveEncryptionKey, (req, res) => {
  try {
    const db = getDatabase()
    const encryptionKey = (req as any).encryptionKey as Buffer

    const config = db.prepare(`
      SELECT
        alchemy_app_id_encrypted, alchemy_app_id_iv, alchemy_app_id_tag,
        alchemy_api_key_encrypted, alchemy_api_key_iv, alchemy_api_key_tag,
        etherscan_api_key_encrypted, etherscan_api_key_iv, etherscan_api_key_tag,
        coinmarketcap_api_key_encrypted, coinmarketcap_api_key_iv, coinmarketcap_api_key_tag,
        oneinch_api_key_encrypted, oneinch_api_key_iv, oneinch_api_key_tag,
        binance_api_key_encrypted, binance_api_key_iv, binance_api_key_tag,
        binance_api_secret_encrypted, binance_api_secret_iv, binance_api_secret_tag,
        binance_testnet
      FROM api_configs
      WHERE id = 1
    `).get() as any

    const decryptedConfig: any = {
      alchemy_app_id: '',
      alchemy_api_key: '',
      etherscan_api_key: '',
      coinmarketcap_api_key: '',
      oneinch_api_key: '',
      binance_api_key: '',
      binance_api_secret: '',
      binance_testnet: config?.binance_testnet ? true : false,
    }

    // Decrypt each field if it exists
    if (config?.alchemy_app_id_encrypted) {
      try {
        decryptedConfig.alchemy_app_id = decrypt(
          config.alchemy_app_id_encrypted,
          encryptionKey,
          config.alchemy_app_id_iv,
          config.alchemy_app_id_tag
        )
      } catch (e) {
        console.warn('Failed to decrypt alchemy_app_id')
      }
    }

    if (config?.alchemy_api_key_encrypted) {
      try {
        decryptedConfig.alchemy_api_key = decrypt(
          config.alchemy_api_key_encrypted,
          encryptionKey,
          config.alchemy_api_key_iv,
          config.alchemy_api_key_tag
        )
      } catch (e) {
        console.warn('Failed to decrypt alchemy_api_key')
      }
    }

    if (config?.etherscan_api_key_encrypted) {
      try {
        decryptedConfig.etherscan_api_key = decrypt(
          config.etherscan_api_key_encrypted,
          encryptionKey,
          config.etherscan_api_key_iv,
          config.etherscan_api_key_tag
        )
      } catch (e) {
        console.warn('Failed to decrypt etherscan_api_key')
      }
    }

    if (config?.coinmarketcap_api_key_encrypted) {
      try {
        decryptedConfig.coinmarketcap_api_key = decrypt(
          config.coinmarketcap_api_key_encrypted,
          encryptionKey,
          config.coinmarketcap_api_key_iv,
          config.coinmarketcap_api_key_tag
        )
      } catch (e) {
        console.warn('Failed to decrypt coinmarketcap_api_key')
      }
    }

    if (config?.oneinch_api_key_encrypted) {
      try {
        decryptedConfig.oneinch_api_key = decrypt(
          config.oneinch_api_key_encrypted,
          encryptionKey,
          config.oneinch_api_key_iv,
          config.oneinch_api_key_tag
        )
      } catch (e) {
        console.warn('Failed to decrypt oneinch_api_key')
      }
    }

    if (config?.binance_api_key_encrypted) {
      try {
        decryptedConfig.binance_api_key = decrypt(
          config.binance_api_key_encrypted,
          encryptionKey,
          config.binance_api_key_iv,
          config.binance_api_key_tag
        )
      } catch (e) {
        console.warn('Failed to decrypt binance_api_key')
      }
    }

    if (config?.binance_api_secret_encrypted) {
      try {
        decryptedConfig.binance_api_secret = decrypt(
          config.binance_api_secret_encrypted,
          encryptionKey,
          config.binance_api_secret_iv,
          config.binance_api_secret_tag
        )
      } catch (e) {
        console.warn('Failed to decrypt binance_api_secret')
      }
    }

    res.json({
      success: true,
      config: decryptedConfig
    })
  } catch (error: any) {
    console.error('Error fetching API config:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch API configuration'
    })
  }
})

// Update API configuration (encrypted)
router.post('/api-config/update', deriveEncryptionKey, async (req, res) => {
  try {
    const body = req.body
    const db = getDatabase()
    const encryptionKey = (req as any).encryptionKey as Buffer

    // Accept both camelCase and snake_case field names
    const fields: { column: string; value: string | undefined }[] = [
      { column: 'alchemy_app_id', value: body.alchemyAppId ?? body.alchemy_app_id },
      { column: 'alchemy_api_key', value: body.alchemyApiKey ?? body.alchemy_api_key },
      { column: 'etherscan_api_key', value: body.etherscanApiKey ?? body.etherscan_api_key },
      { column: 'coinmarketcap_api_key', value: body.coinMarketCapApiKey ?? body.coinmarketcap_api_key },
      { column: 'oneinch_api_key', value: body.oneInchApiKey ?? body.oneinch_api_key },
      { column: 'binance_api_key', value: body.binanceApiKey ?? body.binance_api_key },
      { column: 'binance_api_secret', value: body.binanceApiSecret ?? body.binance_api_secret },
    ]

    // Only update fields that were actually provided (partial update)
    const setClauses: string[] = []
    const params: (string | null)[] = []

    for (const { column, value } of fields) {
      if (value !== undefined && typeof value === 'string' && value.trim()) {
        const encrypted = encrypt(value.trim(), encryptionKey)
        setClauses.push(
          `${column}_encrypted = ?, ${column}_iv = ?, ${column}_tag = ?`
        )
        params.push(encrypted.encrypted, encrypted.iv, encrypted.authTag)
      }
    }

    // Handle binance_testnet flag (plain boolean, not encrypted)
    const binanceTestnet = body.binanceTestnet ?? body.binance_testnet
    if (binanceTestnet !== undefined) {
      setClauses.push('binance_testnet = ?')
      params.push(binanceTestnet ? '1' : '0')
    }

    if (setClauses.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No API keys provided to update'
      })
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP')

    db.prepare(`
      UPDATE api_configs
      SET ${setClauses.join(', ')}
      WHERE id = 1
    `).run(...params)

    // Reload API keys into memory so changes take effect immediately
    try {
      const { decryptAlchemyApiKey, decryptCoinMarketCapApiKey, decryptOneInchApiKey, decryptBinanceApiKey, decryptBinanceApiSecret } = await import('../services/encryption-service.js')
      const { apiKeyStore } = await import('../services/api-key-store.js')
      const password = body.password

      if (password) {
        // Read binance_testnet from DB
        const apiConfigRow = db.prepare('SELECT binance_testnet FROM api_configs WHERE id = 1').get() as any
        apiKeyStore.loadKeys({
          alchemyApiKey: decryptAlchemyApiKey(password) || undefined,
          coinMarketCapApiKey: decryptCoinMarketCapApiKey(password) || undefined,
          oneInchApiKey: decryptOneInchApiKey(password) || undefined,
          binanceApiKey: decryptBinanceApiKey(password) || undefined,
          binanceApiSecret: decryptBinanceApiSecret(password) || undefined,
          binanceTestnet: !!apiConfigRow?.binance_testnet,
        })
        console.log('[api-config] Reloaded API keys into memory after update')
      }
    } catch (reloadErr: any) {
      console.warn('[api-config] Warning: Failed to reload API keys:', reloadErr.message)
    }

    res.json({
      success: true,
      message: 'API configuration updated successfully'
    })
  } catch (error: any) {
    console.error('Error updating API config:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update API configuration'
    })
  }
})

// ============================================================================
// Accounts Routes
// ============================================================================

// Get all accounts (encrypted)
router.post('/accounts/get', deriveEncryptionKey, (req, res) => {
  try {
    const db = getDatabase()
    const encryptionKey = (req as any).encryptionKey as Buffer

    const accounts = db.prepare(`
      SELECT id, name, address, account_type, hd_wallet_id, derivation_index, derivation_path,
             private_key_encrypted, private_key_iv, private_key_tag, created_at, updated_at
      FROM accounts
      ORDER BY created_at DESC
    `).all() as any[]

    // Decrypt private keys
    const decryptedAccounts = accounts.map(account => {
      try {
        const privateKey = decrypt(
          account.private_key_encrypted,
          encryptionKey,
          account.private_key_iv,
          account.private_key_tag
        )

        return {
          id: account.id,
          name: account.name,
          address: account.address,
          accountType: account.account_type,
          hdWalletId: account.hd_wallet_id,
          derivationIndex: account.derivation_index,
          derivationPath: account.derivation_path,
          privateKey: privateKey,
          created_at: account.created_at,
          updated_at: account.updated_at
        }
      } catch (e) {
        console.warn(`Failed to decrypt account ${account.id}`)
        return null
      }
    }).filter(acc => acc !== null)

    res.json({
      success: true,
      accounts: decryptedAccounts
    })
  } catch (error: any) {
    console.error('Error fetching accounts:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch accounts'
    })
  }
})

// Add new account (encrypted) - supports imported accounts only
// For HD accounts, use /api/hd-wallets/derive-account
router.post('/accounts/add', deriveEncryptionKey, async (req, res) => {
  try {
    const { id, name, address, privateKey, password } = req.body
    const db = getDatabase()
    const encryptionKey = (req as any).encryptionKey as Buffer

    if (!id || !name || !address || !privateKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id, name, address, privateKey'
      })
    }

    // Check if account with same name already exists
    const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(name)
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'An account with this name already exists'
      })
    }

    // Encrypt private key
    const privateKeyEnc = encrypt(privateKey, encryptionKey)

    // Insert as imported account (account_type = 'imported')
    db.prepare(`
      INSERT INTO accounts (
        id, name, address, account_type,
        private_key_encrypted, private_key_iv, private_key_tag
      ) VALUES (?, ?, ?, 'imported', ?, ?, ?)
    `).run(
      id,
      name,
      address,
      privateKeyEnc.encrypted,
      privateKeyEnc.iv,
      privateKeyEnc.authTag
    )

    console.log(`Added imported account: ${name} (${address})`)

    // Reload all accounts into memory so the new account is immediately available
    if (password) {
      try {
        const { loadAllAccounts } = await import('../services/load-all-accounts.js')
        const { accountKeyStore } = await import('../services/account-key-store.js')

        const accounts = loadAllAccounts(password)
        accountKeyStore.loadAccounts(accounts)

        console.log(`Reloaded ${accounts.length} accounts into memory (including new account)`)
      } catch (loadError: any) {
        console.warn(`Failed to reload accounts into memory: ${loadError.message}`)
        console.warn(`Account saved to database but will be loaded on next app unlock`)
      }
    }

    res.json({
      success: true,
      message: 'Account added successfully',
      account: { id, name, address, accountType: 'imported' }
    })
  } catch (error: any) {
    console.error('Error adding account:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to add account'
    })
  }
})

// Delete account
router.post('/accounts/delete', deriveEncryptionKey, async (req, res) => {
  try {
    const { accountId, password } = req.body
    const db = getDatabase()

    const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId)

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'Account not found'
      })
    }

    // Reload all accounts into memory to remove the deleted account
    if (password) {
      try {
        const { loadAllAccounts } = await import('../services/load-all-accounts.js')
        const { accountKeyStore } = await import('../services/account-key-store.js')

        const accounts = loadAllAccounts(password)
        accountKeyStore.loadAccounts(accounts)

        console.log(`Reloaded ${accounts.length} accounts into memory (removed deleted account)`)
      } catch (loadError: any) {
        console.warn(`Failed to reload accounts into memory: ${loadError.message}`)
        console.warn(`Account deleted from database but memory will be updated on next app unlock`)
      }
    }

    res.json({
      success: true,
      message: 'Account deleted successfully'
    })
  } catch (error: any) {
    console.error('Error deleting account:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete account'
    })
  }
})

// Clear all accounts
router.post('/accounts/clear', deriveEncryptionKey, (req, res) => {
  try {
    const db = getDatabase()
    db.prepare('DELETE FROM accounts').run()

    res.json({
      success: true,
      message: 'All accounts cleared successfully'
    })
  } catch (error: any) {
    console.error('Error clearing accounts:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to clear accounts'
    })
  }
})

// ============================================================================
// Network RPC Configs Routes
// ============================================================================

// Get all network RPC configurations (encrypted custom URLs)
router.post('/network-configs/get', deriveEncryptionKey, (req, res) => {
  try {
    const db = getDatabase()
    const encryptionKey = (req as any).encryptionKey as Buffer

    const configs = db.prepare(`
      SELECT network_id, rpc_provider,
             custom_rpc_url_encrypted, custom_rpc_url_iv, custom_rpc_url_tag,
             updated_at
      FROM network_rpc_configs
      ORDER BY network_id
    `).all() as any[]

    // Decrypt custom RPC URLs
    const decryptedConfigs = configs.map(config => {
      let customRpcUrl = null

      if (config.custom_rpc_url_encrypted) {
        try {
          customRpcUrl = decrypt(
            config.custom_rpc_url_encrypted,
            encryptionKey,
            config.custom_rpc_url_iv,
            config.custom_rpc_url_tag
          )
        } catch (e) {
          console.warn(`Failed to decrypt custom RPC URL for network ${config.network_id}`)
        }
      }

      return {
        network_id: config.network_id,
        rpc_provider: config.rpc_provider,
        custom_rpc_url: customRpcUrl,
        updated_at: config.updated_at
      }
    })

    res.json({
      success: true,
      configs: decryptedConfigs
    })
  } catch (error: any) {
    console.error('Error fetching network configs:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch network configurations'
    })
  }
})

// Save network RPC configurations (upserts per network)
router.post('/network-configs/save', deriveEncryptionKey, (req, res) => {
  try {
    const { configs } = req.body
    const db = getDatabase()
    const encryptionKey = (req as any).encryptionKey as Buffer

    if (!Array.isArray(configs)) {
      return res.status(400).json({
        success: false,
        error: 'configs must be an array'
      })
    }

    // Upsert each config individually (don't delete other networks)
    const upsertStmt = db.prepare(`
      INSERT INTO network_rpc_configs (
        network_id, rpc_provider,
        custom_rpc_url_encrypted, custom_rpc_url_iv, custom_rpc_url_tag
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(network_id) DO UPDATE SET
        rpc_provider = excluded.rpc_provider,
        custom_rpc_url_encrypted = excluded.custom_rpc_url_encrypted,
        custom_rpc_url_iv = excluded.custom_rpc_url_iv,
        custom_rpc_url_tag = excluded.custom_rpc_url_tag,
        updated_at = CURRENT_TIMESTAMP
    `)

    db.transaction(() => {
      for (const config of configs) {
        // Accept both camelCase and snake_case field names
        const networkId = config.networkId ?? config.network_id ?? config.chain_id
        const customRpcUrl = config.customRpcUrl ?? config.custom_rpc_url
        const rpcProvider = config.rpcProvider ?? config.rpc_provider ?? 'default'

        if (!networkId) continue

        let customRpcUrlEnc = null
        if (customRpcUrl) {
          customRpcUrlEnc = encrypt(customRpcUrl, encryptionKey)
        }

        upsertStmt.run(
          networkId,
          rpcProvider,
          customRpcUrlEnc?.encrypted || null,
          customRpcUrlEnc?.iv || null,
          customRpcUrlEnc?.authTag || null
        )
      }
    })()

    res.json({
      success: true,
      message: 'Network configurations saved successfully'
    })
  } catch (error: any) {
    console.error('Error saving network configs:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to save network configurations'
    })
  }
})

export default router
