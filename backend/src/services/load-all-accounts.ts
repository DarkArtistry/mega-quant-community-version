/**
 * Load All Accounts Service
 *
 * Loads and decrypts ALL accounts from database (called on unlock)
 */

import { getDatabase } from '../db/index.js'
import { deriveKey, decrypt } from '../utils/crypto.js'

interface AccountKey {
  accountId: string
  accountName: string
  address: string
  privateKey: string
}

/**
 * Load and decrypt all accounts from database
 * Called once when app unlocks
 */
export function loadAllAccounts(password: string): AccountKey[] {
  try {
    const db = getDatabase()

    // Get encryption salt
    const saltRow = db.prepare(`
      SELECT key_salt FROM app_security WHERE id = 1
    `).get() as { key_salt: string } | undefined

    if (!saltRow?.key_salt) {
      throw new Error('No encryption salt found - app not initialized')
    }

    // Derive encryption key
    const encryptionKey = deriveKey(password, saltRow.key_salt)

    // Get all accounts
    const accounts = db.prepare(`
      SELECT
        id,
        name,
        address,
        private_key_encrypted,
        private_key_iv,
        private_key_tag
      FROM accounts
    `).all() as Array<{
      id: string
      name: string
      address: string
      private_key_encrypted: string
      private_key_iv: string
      private_key_tag: string
    }>

    if (accounts.length === 0) {
      console.warn('[LoadAllAccounts] No accounts found in database')
      return []
    }

    // Decrypt all private keys
    const decryptedAccounts: AccountKey[] = []

    for (const account of accounts) {
      try {
        const privateKey = decrypt(
          account.private_key_encrypted,
          encryptionKey,
          account.private_key_iv,
          account.private_key_tag
        )

        decryptedAccounts.push({
          accountId: account.id,
          accountName: account.name,
          address: account.address,
          privateKey
        })

        console.log(`[LoadAllAccounts] Decrypted account "${account.name}" (${account.address})`)

      } catch (error: any) {
        console.error(`[LoadAllAccounts] Failed to decrypt account "${account.name}":`, error.message)
        // Continue with other accounts
      }
    }

    console.log(`[LoadAllAccounts] Successfully loaded ${decryptedAccounts.length}/${accounts.length} accounts`)

    return decryptedAccounts

  } catch (error: any) {
    console.error('[LoadAllAccounts] Error loading accounts:', error.message)
    throw new Error(`Failed to load accounts: ${error.message}`)
  }
}
