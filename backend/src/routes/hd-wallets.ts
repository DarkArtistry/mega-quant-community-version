import express from 'express'
import { getDatabase } from '../db/index.js'
import { deriveKey, encrypt, decrypt } from '../utils/crypto.js'
import { Wallet, HDNodeWallet } from 'ethers'

const router = express.Router()

// BIP44 path for Ethereum: m/44'/60'/0'/0/{index}
const ETHEREUM_PATH_PREFIX = "m/44'/60'/0'/0"

/**
 * Generate a new HD wallet with mnemonic
 * Creates a 12-word BIP39 mnemonic and stores it encrypted
 */
router.post('/create', async (req, res) => {
  try {
    const { password, walletName } = req.body

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required'
      })
    }

    if (!walletName || walletName.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Wallet name is required (minimum 3 characters)'
      })
    }

    const db = getDatabase()

    // Check if wallet name already exists
    const existing = db.prepare('SELECT id FROM hd_wallets WHERE name = ?').get(walletName)
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'Wallet name already exists'
      })
    }

    // Get key salt for encryption
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

    // Generate a new random wallet with 12-word mnemonic
    const wallet = Wallet.createRandom()
    const mnemonic = wallet.mnemonic?.phrase

    if (!mnemonic) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate mnemonic'
      })
    }

    // Derive encryption key from password
    const encryptionKey = deriveKey(password, security.key_salt)

    // Encrypt mnemonic
    const { encrypted: mnemonicEncrypted, iv: mnemonicIv, authTag: mnemonicTag } = encrypt(
      mnemonic,
      encryptionKey
    )

    // Generate unique ID for HD wallet
    const walletId = `hd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Store HD wallet
    db.prepare(`
      INSERT INTO hd_wallets (id, name, mnemonic_encrypted, mnemonic_iv, mnemonic_tag)
      VALUES (?, ?, ?, ?, ?)
    `).run(walletId, walletName, mnemonicEncrypted, mnemonicIv, mnemonicTag)

    console.log(`Created HD wallet: ${walletName} (${walletId})`)

    res.json({
      success: true,
      message: 'HD wallet created successfully',
      walletId,
      walletName,
      mnemonic // Return mnemonic ONCE for user to back up
    })
  } catch (error: any) {
    console.error('Error creating HD wallet:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create HD wallet'
    })
  }
})

/**
 * Derive an account from HD wallet at specific index
 * Uses BIP44 path: m/44'/60'/0'/0/{index}
 */
router.post('/derive-account', async (req, res) => {
  try {
    const { password, walletId, accountName, derivationIndex } = req.body

    if (!password || !walletId || !accountName) {
      return res.status(400).json({
        success: false,
        error: 'Password, walletId, and accountName are required'
      })
    }

    if (typeof derivationIndex !== 'number' || derivationIndex < 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid derivation index is required (0 or greater)'
      })
    }

    const db = getDatabase()

    // Get HD wallet
    const hdWallet = db.prepare(`
      SELECT id, name, mnemonic_encrypted, mnemonic_iv, mnemonic_tag
      FROM hd_wallets
      WHERE id = ?
    `).get(walletId) as {
      id: string
      name: string
      mnemonic_encrypted: string
      mnemonic_iv: string
      mnemonic_tag: string
    } | undefined

    if (!hdWallet) {
      return res.status(404).json({
        success: false,
        error: 'HD wallet not found'
      })
    }

    // Check if account name already exists
    const existingAccount = db.prepare('SELECT id FROM accounts WHERE name = ?').get(accountName)
    if (existingAccount) {
      return res.status(400).json({
        success: false,
        error: 'Account name already exists'
      })
    }

    // Get key salt for decryption/encryption
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

    // Derive encryption key from password
    const encryptionKey = deriveKey(password, security.key_salt)

    // Decrypt mnemonic
    let mnemonic: string
    try {
      mnemonic = decrypt(
        hdWallet.mnemonic_encrypted,
        encryptionKey,
        hdWallet.mnemonic_iv,
        hdWallet.mnemonic_tag
      )
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: 'Invalid password or corrupted wallet data'
      })
    }

    // Derive account from mnemonic at specified index
    const derivationPath = `${ETHEREUM_PATH_PREFIX}/${derivationIndex}`
    const hdNode = HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath)
    const address = hdNode.address
    const privateKey = hdNode.privateKey

    // Encrypt private key
    const {
      encrypted: privateKeyEncrypted,
      iv: privateKeyIv,
      authTag: privateKeyTag
    } = encrypt(privateKey, encryptionKey)

    // Generate unique ID for account
    const accountId = `account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Store account
    db.prepare(`
      INSERT INTO accounts (
        id, name, address, account_type, hd_wallet_id, derivation_index, derivation_path,
        private_key_encrypted, private_key_iv, private_key_tag
      ) VALUES (?, ?, ?, 'hd', ?, ?, ?, ?, ?, ?)
    `).run(
      accountId,
      accountName,
      address,
      walletId,
      derivationIndex,
      derivationPath,
      privateKeyEncrypted,
      privateKeyIv,
      privateKeyTag
    )

    console.log(
      `Derived account from HD wallet "${hdWallet.name}": ${accountName} at index ${derivationIndex}`
    )

    // Reload all accounts into memory so the new account is immediately available
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

    res.json({
      success: true,
      message: 'Account derived successfully',
      account: {
        id: accountId,
        name: accountName,
        address,
        accountType: 'hd',
        hdWalletId: walletId,
        hdWalletName: hdWallet.name,
        derivationIndex,
        derivationPath
      }
    })
  } catch (error: any) {
    console.error('Error deriving account:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to derive account'
    })
  }
})

/**
 * Get all HD wallets (without sensitive data)
 */
router.get('/list', (req, res) => {
  try {
    const db = getDatabase()

    const wallets = db.prepare(`
      SELECT
        id,
        name,
        created_at,
        updated_at
      FROM hd_wallets
      ORDER BY created_at DESC
    `).all()

    // Get account count for each wallet
    const walletsWithCounts = wallets.map((wallet: any) => {
      const accountCount = db.prepare(`
        SELECT COUNT(*) as count
        FROM accounts
        WHERE hd_wallet_id = ?
      `).get(wallet.id) as { count: number }

      return {
        ...wallet,
        accountCount: accountCount.count
      }
    })

    res.json({
      success: true,
      wallets: walletsWithCounts
    })
  } catch (error: any) {
    console.error('Error listing HD wallets:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list HD wallets'
    })
  }
})

/**
 * Get accounts for a specific HD wallet
 */
router.get('/:walletId/accounts', (req, res) => {
  try {
    const { walletId } = req.params
    const db = getDatabase()

    const accounts = db.prepare(`
      SELECT
        id,
        name,
        address,
        derivation_index,
        derivation_path,
        created_at
      FROM accounts
      WHERE hd_wallet_id = ?
      ORDER BY derivation_index ASC
    `).all(walletId)

    res.json({
      success: true,
      accounts
    })
  } catch (error: any) {
    console.error('Error getting HD wallet accounts:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get HD wallet accounts'
    })
  }
})

/**
 * Get next available derivation index for HD wallet
 */
router.get('/:walletId/next-index', (req, res) => {
  try {
    const { walletId } = req.params
    const db = getDatabase()

    const result = db.prepare(`
      SELECT MAX(derivation_index) as max_index
      FROM accounts
      WHERE hd_wallet_id = ?
    `).get(walletId) as { max_index: number | null }

    const nextIndex = result.max_index === null ? 0 : result.max_index + 1

    res.json({
      success: true,
      nextIndex
    })
  } catch (error: any) {
    console.error('Error getting next derivation index:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get next derivation index'
    })
  }
})

/**
 * Delete HD wallet (WARNING: deletes all derived accounts)
 */
router.delete('/:walletId', (req, res) => {
  try {
    const { walletId } = req.params
    const { confirmDelete } = req.body

    if (confirmDelete !== 'DELETE_WALLET_AND_ACCOUNTS') {
      return res.status(400).json({
        success: false,
        error: 'Delete confirmation required'
      })
    }

    const db = getDatabase()

    // Get account count first
    const accountCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM accounts
      WHERE hd_wallet_id = ?
    `).get(walletId) as { count: number }

    // Delete HD wallet (CASCADE will delete all accounts)
    const result = db.prepare('DELETE FROM hd_wallets WHERE id = ?').run(walletId)

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: 'HD wallet not found'
      })
    }

    console.log(`Deleted HD wallet ${walletId} and ${accountCount.count} derived accounts`)

    res.json({
      success: true,
      message: 'HD wallet and all derived accounts deleted successfully',
      deletedAccounts: accountCount.count
    })
  } catch (error: any) {
    console.error('Error deleting HD wallet:', error)
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete HD wallet'
    })
  }
})

export default router
