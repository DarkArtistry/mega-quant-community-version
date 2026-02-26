/**
 * DefiLlama Price Service
 * Fetches token prices from the free DefiLlama API.
 * No API key required. Uses coingecko: prefix for token identification.
 */

import axios from 'axios'

interface CachedPrice {
  price: number
  timestamp: number
}

const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  'ETH': 'ethereum',
  'WETH': 'ethereum',
  'BTC': 'bitcoin',
  'WBTC': 'bitcoin',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'DAI': 'dai',
  'LINK': 'chainlink',
  'UNI': 'uniswap',
  'AAVE': 'aave',
  'MATIC': 'matic-network',
  'SOL': 'solana',
  'ARB': 'arbitrum',
  'OP': 'optimism',
}

class DefiLlamaService {
  private cache: Map<string, CachedPrice> = new Map()
  private CACHE_TTL = 60 * 1000 // 1 minute

  /**
   * Get the USD price for a single token symbol.
   */
  async getPrice(symbol: string): Promise<number> {
    const upper = symbol.toUpperCase()
    const cached = this.cache.get(upper)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price
    }

    const geckoId = SYMBOL_TO_COINGECKO_ID[upper]
    if (!geckoId) return 0

    try {
      const coin = `coingecko:${geckoId}`
      const response = await axios.get(
        `https://coins.llama.fi/prices/current/${coin}`,
        { timeout: 5000 }
      )

      const price = response.data?.coins?.[coin]?.price ?? 0

      if (price > 0) {
        this.cache.set(upper, { price, timestamp: Date.now() })
      }

      return price
    } catch (error: any) {
      console.warn(`[DefiLlama] Failed to fetch price for ${symbol}:`, error.message)
      return cached?.price ?? 0
    }
  }

  /**
   * Get USD prices for multiple token symbols in a single batch request.
   */
  async getBatchPrices(symbols: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {}
    const uncachedCoins: string[] = []
    const uncachedSymbols: string[] = []

    for (const symbol of symbols) {
      const upper = symbol.toUpperCase()
      const cached = this.cache.get(upper)
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        result[upper] = cached.price
      } else {
        const geckoId = SYMBOL_TO_COINGECKO_ID[upper]
        if (geckoId) {
          uncachedCoins.push(`coingecko:${geckoId}`)
          uncachedSymbols.push(upper)
        }
      }
    }

    if (uncachedCoins.length === 0) return result

    try {
      const response = await axios.get(
        `https://coins.llama.fi/prices/current/${uncachedCoins.join(',')}`,
        { timeout: 5000 }
      )

      for (const sym of uncachedSymbols) {
        const geckoId = SYMBOL_TO_COINGECKO_ID[sym]!
        const coin = `coingecko:${geckoId}`
        const price = response.data?.coins?.[coin]?.price ?? 0
        result[sym] = price
        if (price > 0) {
          this.cache.set(sym, { price, timestamp: Date.now() })
        }
      }
    } catch (error: any) {
      console.warn('[DefiLlama] Batch price fetch failed:', error.message)
    }

    return result
  }
}

export const defiLlamaService = new DefiLlamaService()
