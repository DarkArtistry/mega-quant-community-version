/**
 * Encryption Service for Backend
 *
 * Handles decryption of sensitive data (API keys, RPC URLs) using user's password
 */

import { getDatabase } from '../db/index.js'
import { deriveKey, decrypt } from '../utils/crypto.js'

/**
 * Load and decrypt Alchemy API key using password
 */
export function decryptAlchemyApiKey(password: string): string | null {
  try {
    const db = getDatabase()

    // Get encryption salt from app_security table
    const saltRow = db.prepare(`
      SELECT key_salt FROM app_security WHERE id = 1
    `).get() as { key_salt: string } | undefined

    if (!saltRow?.key_salt) {
      console.error('[EncryptionService] No encryption salt found')
      return null
    }

    // Derive encryption key using the same function as config-encrypted routes
    const encryptionKey = deriveKey(password, saltRow.key_salt)

    // Get encrypted Alchemy API key
    const apiConfigRow = db.prepare(`
      SELECT alchemy_api_key_encrypted, alchemy_api_key_iv, alchemy_api_key_tag
      FROM api_configs
      WHERE id = 1
    `).get() as {
      alchemy_api_key_encrypted: string | null
      alchemy_api_key_iv: string | null
      alchemy_api_key_tag: string | null
    } | undefined

    if (!apiConfigRow?.alchemy_api_key_encrypted) {
      console.warn('[EncryptionService] No Alchemy API key configured')
      return null
    }

    // Decrypt using the same function as config-encrypted routes
    const decryptedKey = decrypt(
      apiConfigRow.alchemy_api_key_encrypted,
      encryptionKey,
      apiConfigRow.alchemy_api_key_iv!,
      apiConfigRow.alchemy_api_key_tag!
    )

    console.log('[EncryptionService] Alchemy API key decrypted successfully')
    return decryptedKey

  } catch (error: any) {
    console.error('[EncryptionService] Failed to decrypt Alchemy API key:', error.message)
    return null
  }
}

/**
 * Load and decrypt custom RPC URL for a network
 */
export function decryptCustomRpcUrl(password: string, networkId: number): string | null {
  try {
    const db = getDatabase()

    // Get encryption salt from app_security table
    const saltRow = db.prepare(`
      SELECT key_salt FROM app_security WHERE id = 1
    `).get() as { key_salt: string } | undefined

    if (!saltRow?.key_salt) {
      return null
    }

    // Derive encryption key using the same function as config-encrypted routes
    const encryptionKey = deriveKey(password, saltRow.key_salt)

    // Get encrypted custom RPC URL
    const rpcConfigRow = db.prepare(`
      SELECT custom_rpc_url_encrypted, custom_rpc_url_iv, custom_rpc_url_tag
      FROM network_rpc_configs
      WHERE network_id = ?
    `).get(networkId) as {
      custom_rpc_url_encrypted: string | null
      custom_rpc_url_iv: string | null
      custom_rpc_url_tag: string | null
    } | undefined

    if (!rpcConfigRow?.custom_rpc_url_encrypted) {
      return null
    }

    // Decrypt using the same function as config-encrypted routes
    const decryptedUrl = decrypt(
      rpcConfigRow.custom_rpc_url_encrypted,
      encryptionKey,
      rpcConfigRow.custom_rpc_url_iv!,
      rpcConfigRow.custom_rpc_url_tag!
    )

    // Trim whitespace from decrypted URL
    return decryptedUrl.trim()

  } catch (error: any) {
    console.error(`[EncryptionService] Failed to decrypt custom RPC URL for network ${networkId}:`, error.message)
    return null
  }
}

/**
 * Load and decrypt CoinMarketCap API key using password
 */
export function decryptCoinMarketCapApiKey(password: string): string | null {
  try {
    const db = getDatabase()

    // Get encryption salt from app_security table
    const saltRow = db.prepare(`
      SELECT key_salt FROM app_security WHERE id = 1
    `).get() as { key_salt: string } | undefined

    if (!saltRow?.key_salt) {
      console.error('[EncryptionService] No encryption salt found')
      return null
    }

    // Derive encryption key
    const encryptionKey = deriveKey(password, saltRow.key_salt)

    // Get encrypted CoinMarketCap API key
    const apiConfigRow = db.prepare(`
      SELECT coinmarketcap_api_key_encrypted, coinmarketcap_api_key_iv, coinmarketcap_api_key_tag
      FROM api_configs
      WHERE id = 1
    `).get() as {
      coinmarketcap_api_key_encrypted: string | null
      coinmarketcap_api_key_iv: string | null
      coinmarketcap_api_key_tag: string | null
    } | undefined

    if (!apiConfigRow?.coinmarketcap_api_key_encrypted) {
      console.warn('[EncryptionService] No CoinMarketCap API key configured')
      return null
    }

    // Decrypt
    const decryptedKey = decrypt(
      apiConfigRow.coinmarketcap_api_key_encrypted,
      encryptionKey,
      apiConfigRow.coinmarketcap_api_key_iv!,
      apiConfigRow.coinmarketcap_api_key_tag!
    )

    console.log('[EncryptionService] CoinMarketCap API key decrypted successfully')
    return decryptedKey

  } catch (error: any) {
    console.error('[EncryptionService] Failed to decrypt CoinMarketCap API key:', error.message)
    return null
  }
}

/**
 * Load and decrypt 1inch API key using password
 */
export function decryptOneInchApiKey(password: string): string | null {
  try {
    const db = getDatabase()

    // Get encryption salt from app_security table
    const saltRow = db.prepare(`
      SELECT key_salt FROM app_security WHERE id = 1
    `).get() as { key_salt: string } | undefined

    if (!saltRow?.key_salt) {
      console.error('[EncryptionService] No encryption salt found')
      return null
    }

    // Derive encryption key
    const encryptionKey = deriveKey(password, saltRow.key_salt)

    // Get encrypted 1inch API key
    const apiConfigRow = db.prepare(`
      SELECT oneinch_api_key_encrypted, oneinch_api_key_iv, oneinch_api_key_tag
      FROM api_configs
      WHERE id = 1
    `).get() as {
      oneinch_api_key_encrypted: string | null
      oneinch_api_key_iv: string | null
      oneinch_api_key_tag: string | null
    } | undefined

    if (!apiConfigRow?.oneinch_api_key_encrypted) {
      console.warn('[EncryptionService] No 1inch API key configured')
      return null
    }

    // Decrypt
    const decryptedKey = decrypt(
      apiConfigRow.oneinch_api_key_encrypted,
      encryptionKey,
      apiConfigRow.oneinch_api_key_iv!,
      apiConfigRow.oneinch_api_key_tag!
    )

    console.log('[EncryptionService] 1inch API key decrypted successfully')
    return decryptedKey

  } catch (error: any) {
    console.error('[EncryptionService] Failed to decrypt 1inch API key:', error.message)
    return null
  }
}

/**
 * Load and decrypt Binance API key using password
 */
export function decryptBinanceApiKey(password: string): string | null {
  try {
    const db = getDatabase()

    const saltRow = db.prepare(`
      SELECT key_salt FROM app_security WHERE id = 1
    `).get() as { key_salt: string } | undefined

    if (!saltRow?.key_salt) {
      console.error('[EncryptionService] No encryption salt found')
      return null
    }

    const encryptionKey = deriveKey(password, saltRow.key_salt)

    const apiConfigRow = db.prepare(`
      SELECT binance_api_key_encrypted, binance_api_key_iv, binance_api_key_tag
      FROM api_configs
      WHERE id = 1
    `).get() as {
      binance_api_key_encrypted: string | null
      binance_api_key_iv: string | null
      binance_api_key_tag: string | null
    } | undefined

    if (!apiConfigRow?.binance_api_key_encrypted) {
      console.warn('[EncryptionService] No Binance API key configured')
      return null
    }

    const decryptedKey = decrypt(
      apiConfigRow.binance_api_key_encrypted,
      encryptionKey,
      apiConfigRow.binance_api_key_iv!,
      apiConfigRow.binance_api_key_tag!
    )

    console.log('[EncryptionService] Binance API key decrypted successfully')
    return decryptedKey

  } catch (error: any) {
    console.error('[EncryptionService] Failed to decrypt Binance API key:', error.message)
    return null
  }
}

/**
 * Load and decrypt Binance API secret using password
 */
export function decryptBinanceApiSecret(password: string): string | null {
  try {
    const db = getDatabase()

    const saltRow = db.prepare(`
      SELECT key_salt FROM app_security WHERE id = 1
    `).get() as { key_salt: string } | undefined

    if (!saltRow?.key_salt) {
      console.error('[EncryptionService] No encryption salt found')
      return null
    }

    const encryptionKey = deriveKey(password, saltRow.key_salt)

    const apiConfigRow = db.prepare(`
      SELECT binance_api_secret_encrypted, binance_api_secret_iv, binance_api_secret_tag
      FROM api_configs
      WHERE id = 1
    `).get() as {
      binance_api_secret_encrypted: string | null
      binance_api_secret_iv: string | null
      binance_api_secret_tag: string | null
    } | undefined

    if (!apiConfigRow?.binance_api_secret_encrypted) {
      console.warn('[EncryptionService] No Binance API secret configured')
      return null
    }

    const decryptedKey = decrypt(
      apiConfigRow.binance_api_secret_encrypted,
      encryptionKey,
      apiConfigRow.binance_api_secret_iv!,
      apiConfigRow.binance_api_secret_tag!
    )

    console.log('[EncryptionService] Binance API secret decrypted successfully')
    return decryptedKey

  } catch (error: any) {
    console.error('[EncryptionService] Failed to decrypt Binance API secret:', error.message)
    return null
  }
}

/**
 * Load all decrypted RPC configurations
 */
export function loadDecryptedRpcConfigs(password: string): {
  alchemyApiKey: string | null
  coinMarketCapApiKey: string | null
  customRpcUrls: Record<number, string>
} {
  const alchemyApiKey = decryptAlchemyApiKey(password)
  const coinMarketCapApiKey = decryptCoinMarketCapApiKey(password)
  const customRpcUrls: Record<number, string> = {}

  try {
    const db = getDatabase()

    // Get all networks with custom RPCs
    const networks = db.prepare(`
      SELECT network_id
      FROM network_rpc_configs
      WHERE rpc_provider = 'custom' AND custom_rpc_url_encrypted IS NOT NULL
    `).all() as { network_id: number }[]

    for (const { network_id } of networks) {
      const customUrl = decryptCustomRpcUrl(password, network_id)
      if (customUrl) {
        customRpcUrls[network_id] = customUrl
      }
    }

  } catch (error: any) {
    console.error('[EncryptionService] Error loading custom RPC URLs:', error.message)
  }

  return { alchemyApiKey, coinMarketCapApiKey, customRpcUrls }
}
