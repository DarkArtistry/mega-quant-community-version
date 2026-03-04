/**
 * Price Service
 * Fetches token prices in USD for P&L calculations using CoinMarketCap API.
 * Includes caching, fallback prices, and symbol mapping (WETH->ETH, WBTC->BTC).
 */

import axios from 'axios'

interface TokenPrice {
  symbol: string
  priceUsd: number
  timestamp: number
}

class PriceService {
  private cache: Map<string, TokenPrice> = new Map()
  private CACHE_TTL = 60 * 1000 // 1 minute
  private cmcApiKey: string | null = null

  /**
   * Set CoinMarketCap API key
   */
  setCoinMarketCapApiKey(apiKey: string | null): void {
    this.cmcApiKey = apiKey
    console.log(`[PriceService] CoinMarketCap API key ${apiKey ? 'configured' : 'cleared'}`)
  }

  /**
   * Get the currently configured CoinMarketCap API key
   */
  getCoinMarketCapApiKey(): string | null {
    return this.cmcApiKey
  }

  /**
   * Get USD price for a token using CoinMarketCap API
   */
  async getTokenPriceUSD(symbol: string): Promise<number> {
    const cacheKey = symbol.toUpperCase()

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.priceUsd
    }

    try {
      // Get CoinMarketCap symbol for the token
      const cmcSymbol = this.getCoinMarketCapSymbol(symbol)

      // Use CoinMarketCap API if key is available
      if (this.cmcApiKey) {
        const response = await axios.get(
          'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
          {
            headers: {
              'X-CMC_PRO_API_KEY': this.cmcApiKey,
              'Accept': 'application/json'
            },
            params: {
              symbol: cmcSymbol,
              convert: 'USD'
            },
            timeout: 5000
          }
        )

        const data = response.data?.data?.[cmcSymbol]
        const priceUsd = data?.quote?.USD?.price || 0

        // Update cache
        this.cache.set(cacheKey, {
          symbol,
          priceUsd,
          timestamp: Date.now()
        })

        return priceUsd
      } else {
        console.warn(`[PriceService] No CoinMarketCap API key configured, using fallback price for ${symbol}`)
        return this.getFallbackPrice(symbol)
      }
    } catch (error: any) {
      console.warn(`[PriceService] Failed to fetch price for ${symbol}:`, error.message)

      // Fallback to cached price if available (even if expired)
      if (cached) {
        console.warn(`[PriceService] Using stale cache for ${symbol}`)
        return cached.priceUsd
      }

      // Fallback prices for common tokens
      return this.getFallbackPrice(symbol)
    }
  }

  /**
   * Get multiple token prices in parallel
   */
  async getMultiplePricesUSD(symbols: string[]): Promise<Record<string, number>> {
    const prices: Record<string, number> = {}

    const results = await Promise.allSettled(
      symbols.map(symbol => this.getTokenPriceUSD(symbol))
    )

    symbols.forEach((symbol, index) => {
      const result = results[index]
      prices[symbol] = result.status === 'fulfilled' ? result.value : 0
    })

    return prices
  }

  /**
   * Get USD prices for multiple symbols in a single CoinMarketCap API request.
   * CMC supports ?symbol=BTC,ETH,LINK,... in one call.
   */
  async getBatchPricesUSD(symbols: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {}
    if (!this.cmcApiKey || symbols.length === 0) return result

    // Dedup and map to CMC symbols, check cache first
    const uncachedCmcSymbols: string[] = []
    const cmcToOriginal: Map<string, string[]> = new Map()

    for (const symbol of symbols) {
      const upper = symbol.toUpperCase()
      const cached = this.cache.get(upper)
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        result[upper] = cached.priceUsd
        continue
      }

      const cmcSymbol = this.getCoinMarketCapSymbol(upper)
      if (!cmcToOriginal.has(cmcSymbol)) {
        cmcToOriginal.set(cmcSymbol, [])
        uncachedCmcSymbols.push(cmcSymbol)
      }
      cmcToOriginal.get(cmcSymbol)!.push(upper)
    }

    if (uncachedCmcSymbols.length === 0) return result

    try {
      const response = await axios.get(
        'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
        {
          headers: {
            'X-CMC_PRO_API_KEY': this.cmcApiKey,
            'Accept': 'application/json'
          },
          params: {
            symbol: uncachedCmcSymbols.join(','),
            convert: 'USD'
          },
          timeout: 10000
        }
      )

      const data = response.data?.data
      if (data) {
        for (const cmcSymbol of uncachedCmcSymbols) {
          // CMC may return an array when there are multiple tokens with the same symbol
          const entry = data[cmcSymbol]
          const priceUsd = Array.isArray(entry)
            ? entry[0]?.quote?.USD?.price ?? 0
            : entry?.quote?.USD?.price ?? 0

          const originals = cmcToOriginal.get(cmcSymbol) || []
          for (const orig of originals) {
            result[orig] = priceUsd
            if (priceUsd > 0) {
              this.cache.set(orig, { symbol: orig, priceUsd, timestamp: Date.now() })
            }
          }
        }
      }
    } catch (error: any) {
      console.warn(`[PriceService] Batch CMC fetch failed:`, error.message)
      // Fall back to cached/fallback for uncached symbols
      for (const cmcSymbol of uncachedCmcSymbols) {
        const originals = cmcToOriginal.get(cmcSymbol) || []
        for (const orig of originals) {
          if (!(orig in result)) {
            const stale = this.cache.get(orig)
            result[orig] = stale?.priceUsd ?? this.getFallbackPrice(orig)
          }
        }
      }
    }

    return result
  }

  /**
   * Map token symbols to CoinMarketCap symbols.
   * Wrapped tokens trade at the same price as their underlying asset.
   */
  private getCoinMarketCapSymbol(symbol: string): string {
    const mapping: Record<string, string> = {
      'WETH': 'ETH',
      'ETH': 'ETH',
      'USDC': 'USDC',
      'USDT': 'USDT',
      'DAI': 'DAI',
      'WBTC': 'BTC',
      'BTC': 'BTC',
      'LINK': 'LINK',
      'UNI': 'UNI',
      'AAVE': 'AAVE',
      'MATIC': 'MATIC',
      'SOL': 'SOL',
      'ARB': 'ARB',
      'OP': 'OP'
    }

    return mapping[symbol.toUpperCase()] || symbol.toUpperCase()
  }

  /**
   * Fallback prices for common tokens (approximate values).
   * Used when CoinMarketCap API is unavailable or unconfigured.
   */
  private getFallbackPrice(symbol: string): number {
    const fallbacks: Record<string, number> = {
      'WETH': 3200,
      'ETH': 3200,
      'USDC': 1,
      'USDT': 1,
      'DAI': 1,
      'WBTC': 95000,
      'BTC': 95000,
      'LINK': 15,
      'UNI': 7,
      'AAVE': 200,
      'MATIC': 0.5,
      'SOL': 150,
      'ARB': 1.2,
      'OP': 2.5
    }

    return fallbacks[symbol.toUpperCase()] || 0
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get the cache size
   */
  getCacheSize(): number {
    return this.cache.size
  }
}

// Singleton instance
export const priceService = new PriceService()
