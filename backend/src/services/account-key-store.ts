/**
 * In-Memory Account Key Store
 *
 * Stores decrypted private keys in memory after unlock.
 * Keys are cleared when app locks for security.
 *
 * This allows strategies to run without requiring password in code.
 */

interface AccountKey {
  accountId: string
  accountName: string
  address: string
  privateKey: string
}

class AccountKeyStore {
  private keys: Map<string, AccountKey> = new Map()  // accountId -> AccountKey
  private isUnlocked: boolean = false

  /**
   * Load all accounts into memory (called on unlock)
   */
  loadAccounts(accounts: AccountKey[]): void {
    this.clear()  // Clear any existing keys

    for (const account of accounts) {
      this.keys.set(account.accountId, account)
    }

    this.isUnlocked = true
    console.log(`[AccountKeyStore] Loaded ${accounts.length} accounts into memory`)
  }

  /**
   * Get account by ID
   */
  getAccount(accountId: string): AccountKey | undefined {
    if (!this.isUnlocked) {
      throw new Error('App is locked. Please unlock to access accounts.')
    }

    return this.keys.get(accountId)
  }

  /**
   * Get all accounts
   */
  getAllAccounts(): AccountKey[] {
    if (!this.isUnlocked) {
      throw new Error('App is locked. Please unlock to access accounts.')
    }

    return Array.from(this.keys.values())
  }

  /**
   * Check if app is unlocked
   */
  isAppUnlocked(): boolean {
    return this.isUnlocked
  }

  /**
   * Get account count
   */
  getAccountCount(): number {
    return this.keys.size
  }

  /**
   * Clear all keys from memory (called on lock)
   */
  clear(): void {
    // Overwrite keys with zeros before clearing (security best practice)
    for (const account of this.keys.values()) {
      account.privateKey = '0'.repeat(64)
    }

    this.keys.clear()
    this.isUnlocked = false
    console.log('[AccountKeyStore] Cleared all keys from memory')
  }
}

// Singleton instance
export const accountKeyStore = new AccountKeyStore()
