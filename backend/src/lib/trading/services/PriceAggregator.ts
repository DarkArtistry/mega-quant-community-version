/**
 * Price Aggregator
 * Aggregates prices from multiple sources: Binance, Chainlink, CoinMarketCap (PriceService), DEX quotes.
 * Returns median price, individual source prices, and spread.
 * Handles missing sources gracefully (if a source is not configured, it is skipped).
 */

import { priceService } from './PriceService.js'
import { coinGeckoService } from './CoinGeckoService.js'
import { defiLlamaService } from './DefiLlamaService.js'
import { BinanceProxy } from '../cex/BinanceProxy.js'
import { ChainlinkOracle } from '../oracles/ChainlinkOracle.js'
import { apiKeyStore } from '../../../services/api-key-store.js'
import { JsonRpcProvider } from 'ethers'

// --- Interfaces ---

export interface PriceSource {
  source: string
  price: number
  timestamp: number
}

export interface AggregatedPrice {
  base: string
  quote: string
  prices: PriceSource[]
  median: number
  spread: number
  timestamp: number
}

// --- Symbol mapping for Binance pairs ---

const BINANCE_PAIR_MAP: Record<string, string> = {
  'ETH': 'ETHUSDT',
  'BTC': 'BTCUSDT',
  'WETH': 'ETHUSDT',
  'WBTC': 'BTCUSDT',
  'LINK': 'LINKUSDT',
  'UNI': 'UNIUSDT',
  'AAVE': 'AAVEUSDT',
  'SOL': 'SOLUSDT',
  'ARB': 'ARBUSDT',
  'OP': 'OPUSDT',
  'MATIC': 'MATICUSDT',
  'USDC': 'USDCUSDT'
}

// --- Chainlink pair mapping ---

const CHAINLINK_PAIR_MAP: Record<string, string> = {
  'ETH': 'ETH/USD',
  'WETH': 'ETH/USD',
  'BTC': 'BTC/USD',
  'WBTC': 'BTC/USD',
  'USDC': 'USDC/USD',
  'LINK': 'LINK/USD'
}

// --- PriceAggregator Class ---

export class PriceAggregator {
  private binanceProxy: BinanceProxy | null = null
  private chainlinkOracle: ChainlinkOracle | null = null

  constructor() {
    // Attempt to initialize Binance proxy
    try {
      if (apiKeyStore.getBinanceApiKey()) {
        this.binanceProxy = new BinanceProxy('price-aggregator')
      }
    } catch {
      // Binance not configured, skip
    }

    // Attempt to initialize Chainlink oracle
    try {
      const alchemyKey = apiKeyStore.getAlchemyApiKey()
      const rpcUrl = alchemyKey
        ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
        : 'https://eth.llamarpc.com'

      const provider = new JsonRpcProvider(rpcUrl)
      this.chainlinkOracle = new ChainlinkOracle(provider)
    } catch {
      // Chainlink not available, skip
    }
  }

  /**
   * Get an aggregated price from all available sources.
   *
   * @param base - Base asset symbol (e.g., 'ETH', 'BTC')
   * @param quote - Quote currency (e.g., 'USD'). Currently only USD is supported.
   * @returns Aggregated price with individual source prices, median, and spread
   */
  async getAggregatedPrice(base: string, quote: string = 'USD'): Promise<AggregatedPrice> {
    const upperBase = base.toUpperCase()
    const upperQuote = quote.toUpperCase()
    const prices: PriceSource[] = []

    // Fetch from all sources in parallel
    const fetchPromises: Promise<void>[] = []

    // 1. Binance
    fetchPromises.push(this.fetchBinancePrice(upperBase, prices))

    // 2. Chainlink
    fetchPromises.push(this.fetchChainlinkPrice(upperBase, prices))

    // 3. CoinMarketCap (PriceService)
    fetchPromises.push(this.fetchCoinMarketCapPrice(upperBase, prices))

    // 4. CoinGecko
    fetchPromises.push(this.fetchCoinGeckoPrice(upperBase, prices))

    // 5. DefiLlama
    fetchPromises.push(this.fetchDefiLlamaPrice(upperBase, prices))

    await Promise.allSettled(fetchPromises)

    // Calculate median
    const median = this.calculateMedian(prices.map(p => p.price))

    // Calculate spread (difference between max and min as percentage of median)
    const spread = this.calculateSpread(prices.map(p => p.price))

    return {
      base: upperBase,
      quote: upperQuote,
      prices,
      median,
      spread,
      timestamp: Date.now()
    }
  }

  // --- Private Fetch Methods ---

  private async fetchBinancePrice(symbol: string, prices: PriceSource[]): Promise<void> {
    try {
      // Binance public API does not require auth for price checks
      const binance = this.binanceProxy || new BinanceProxy('price-aggregator')
      const binancePair = BINANCE_PAIR_MAP[symbol]

      if (!binancePair) return

      const price = await binance.getPrice(binancePair)

      if (price > 0) {
        prices.push({
          source: 'binance',
          price,
          timestamp: Date.now()
        })
      }
    } catch (error: any) {
      console.warn(`[PriceAggregator] Binance price fetch failed for ${symbol}:`, error.message)
    }
  }

  private async fetchChainlinkPrice(symbol: string, prices: PriceSource[]): Promise<void> {
    try {
      if (!this.chainlinkOracle) return

      const chainlinkPair = CHAINLINK_PAIR_MAP[symbol]
      if (!chainlinkPair) return

      const price = await this.chainlinkOracle.getPrice(chainlinkPair)

      if (price > 0) {
        prices.push({
          source: 'chainlink',
          price,
          timestamp: Date.now()
        })
      }
    } catch (error: any) {
      console.warn(`[PriceAggregator] Chainlink price fetch failed for ${symbol}:`, error.message)
    }
  }

  private async fetchCoinMarketCapPrice(symbol: string, prices: PriceSource[]): Promise<void> {
    try {
      const price = await priceService.getTokenPriceUSD(symbol)

      if (price > 0) {
        prices.push({
          source: 'coinmarketcap',
          price,
          timestamp: Date.now()
        })
      }
    } catch (error: any) {
      console.warn(`[PriceAggregator] CoinMarketCap price fetch failed for ${symbol}:`, error.message)
    }
  }

  private async fetchCoinGeckoPrice(symbol: string, prices: PriceSource[]): Promise<void> {
    try {
      const price = await coinGeckoService.getPrice(symbol)

      if (price > 0) {
        prices.push({
          source: 'coingecko',
          price,
          timestamp: Date.now()
        })
      }
    } catch (error: any) {
      console.warn(`[PriceAggregator] CoinGecko price fetch failed for ${symbol}:`, error.message)
    }
  }

  private async fetchDefiLlamaPrice(symbol: string, prices: PriceSource[]): Promise<void> {
    try {
      const price = await defiLlamaService.getPrice(symbol)

      if (price > 0) {
        prices.push({
          source: 'defillama',
          price,
          timestamp: Date.now()
        })
      }
    } catch (error: any) {
      console.warn(`[PriceAggregator] DefiLlama price fetch failed for ${symbol}:`, error.message)
    }
  }

  // --- Math Helpers ---

  /**
   * Calculate the median of an array of numbers.
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0

    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2
    }

    return sorted[mid]
  }

  /**
   * Calculate the spread as a percentage.
   * Spread = (max - min) / median * 100
   */
  private calculateSpread(values: number[]): number {
    if (values.length < 2) return 0

    const min = Math.min(...values)
    const max = Math.max(...values)
    const median = this.calculateMedian(values)

    if (median === 0) return 0

    return ((max - min) / median) * 100
  }
}

// Singleton instance
export const priceAggregator = new PriceAggregator()
