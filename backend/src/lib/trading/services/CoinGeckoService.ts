/**
 * CoinGecko Price Service
 * Fetches token prices from the free CoinGecko API.
 * No API key required.
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

class CoinGeckoService {
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
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: {
            ids: geckoId,
            vs_currencies: 'usd',
          },
          timeout: 5000,
        }
      )

      const price = response.data?.[geckoId]?.usd ?? 0

      if (price > 0) {
        this.cache.set(upper, { price, timestamp: Date.now() })
      }

      return price
    } catch (error: any) {
      console.warn(`[CoinGecko] Failed to fetch price for ${symbol}:`, error.message)
      return cached?.price ?? 0
    }
  }

  /**
   * Get USD prices for multiple token symbols in a single batch request.
   */
  async getBatchPrices(symbols: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {}
    const uncachedIds: string[] = []
    const uncachedSymbols: string[] = []

    for (const symbol of symbols) {
      const upper = symbol.toUpperCase()
      const cached = this.cache.get(upper)
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        result[upper] = cached.price
      } else {
        const geckoId = SYMBOL_TO_COINGECKO_ID[upper]
        if (geckoId) {
          uncachedIds.push(geckoId)
          uncachedSymbols.push(upper)
        }
      }
    }

    if (uncachedIds.length === 0) return result

    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: {
            ids: uncachedIds.join(','),
            vs_currencies: 'usd',
          },
          timeout: 5000,
        }
      )

      for (const sym of uncachedSymbols) {
        const geckoId = SYMBOL_TO_COINGECKO_ID[sym]!
        const price = response.data?.[geckoId]?.usd ?? 0
        result[sym] = price
        if (price > 0) {
          this.cache.set(sym, { price, timestamp: Date.now() })
        }
      }
    } catch (error: any) {
      console.warn('[CoinGecko] Batch price fetch failed:', error.message)
    }

    return result
  }
}

export const coinGeckoService = new CoinGeckoService()
