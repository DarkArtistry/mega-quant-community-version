/**
 * In-Memory API Key Store
 *
 * Stores decrypted API keys in memory after app unlock.
 * Keys are cleared when app is locked for security.
 */

export interface ApiKeys {
  alchemyApiKey?: string
  alchemyAppId?: string
  etherscanApiKey?: string
  coinMarketCapApiKey?: string
  oneInchApiKey?: string
  binanceApiKey?: string
  binanceApiSecret?: string
  binanceTestnet?: boolean
}

class ApiKeyStore {
  private keys: ApiKeys = {}
  private isUnlocked: boolean = false

  /**
   * Load API keys into memory (called on unlock)
   */
  loadKeys(keys: ApiKeys): void {
    this.keys = { ...keys }
    this.isUnlocked = true
    console.log('[ApiKeyStore] API keys loaded into memory')
  }

  /**
   * Get Alchemy API key
   */
  getAlchemyApiKey(): string | undefined {
    return this.keys.alchemyApiKey
  }

  /**
   * Get Alchemy App ID
   */
  getAlchemyAppId(): string | undefined {
    return this.keys.alchemyAppId
  }

  /**
   * Get Etherscan API key
   */
  getEtherscanApiKey(): string | undefined {
    return this.keys.etherscanApiKey
  }

  /**
   * Get CoinMarketCap API key
   */
  getCoinMarketCapApiKey(): string | undefined {
    return this.keys.coinMarketCapApiKey
  }

  /**
   * Get 1inch API key
   */
  getOneInchApiKey(): string | undefined {
    return this.keys.oneInchApiKey
  }

  /**
   * Get Binance API key
   */
  getBinanceApiKey(): string | undefined {
    return this.keys.binanceApiKey
  }

  /**
   * Get Binance API secret
   */
  getBinanceApiSecret(): string | undefined {
    return this.keys.binanceApiSecret
  }

  /**
   * Check if Binance is configured for testnet
   */
  isBinanceTestnet(): boolean {
    return this.keys.binanceTestnet ?? false
  }

  /**
   * Get all keys
   */
  getAllKeys(): ApiKeys {
    return { ...this.keys }
  }

  /**
   * Check if app is unlocked
   */
  isAppUnlocked(): boolean {
    return this.isUnlocked
  }

  /**
   * Clear all keys from memory (called on lock)
   */
  clear(): void {
    this.keys = {}
    this.isUnlocked = false
    console.log('[ApiKeyStore] API keys cleared from memory')
  }
}

// Singleton instance
export const apiKeyStore = new ApiKeyStore()
