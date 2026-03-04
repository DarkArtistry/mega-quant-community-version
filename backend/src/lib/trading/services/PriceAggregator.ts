/**
 * Price Aggregator
 * Aggregates prices from multiple sources: Binance, Chainlink, CoinMarketCap (PriceService), DEX quotes.
 * Returns median price, individual source prices, and spread.
 * Handles missing sources gracefully (if a source is not configured, it is skipped).
 */

import { priceService } from './PriceService.js'
import { coinGeckoService } from './CoinGeckoService.js'
import { defiLlamaService } from './DefiLlamaService.js'
import { uniswapPriceService } from './UniswapPriceService.js'
import { BinanceProxy } from '../cex/BinanceProxy.js'
import { ChainlinkOracle } from '../oracles/ChainlinkOracle.js'
import { apiKeyStore } from '../../../services/api-key-store.js'
import { JsonRpcProvider } from 'ethers'

// --- Interfaces ---

export interface PriceSource {
  source: string
  price: number
  timestamp: number
  quoteCurrency: string  // 'USD' | 'USDT' | 'USDC'
  network?: string       // 'Ethereum' | 'Base' — for on-chain sources
  chainId?: number       // 1 | 8453
  feeTier?: number       // 3000 = 0.3% — for DEX sources
  gasEstimateGwei?: number
  gasPriceGwei?: number  // Current network gas price in gwei
  path?: string[]        // e.g. ['LINK', 'WETH', 'USDC'] for multi-hop DEX routes
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

const BINANCE_USDT_PAIR_MAP: Record<string, string> = {
  'ETH': 'ETHUSDT',
  'BTC': 'BTCUSDT',
  'WETH': 'ETHUSDT',
  'WBTC': 'WBTCUSDT',
  'LINK': 'LINKUSDT',
  'UNI': 'UNIUSDT',
  'AAVE': 'AAVEUSDT',
  'SOL': 'SOLUSDT',
  'ARB': 'ARBUSDT',
  'OP': 'OPUSDT',
  'MATIC': 'MATICUSDT',
  'USDC': 'USDCUSDT',
  'SHIB': 'SHIBUSDT',
  'DOT': 'DOTUSDT',
  'WLD': 'WLDUSDT',
}

const BINANCE_USDC_PAIR_MAP: Record<string, string> = {
  'ETH': 'ETHUSDC',
  'BTC': 'BTCUSDC',
  'WETH': 'ETHUSDC',
  'LINK': 'LINKUSDC',
  'UNI': 'UNIUSDC',
  'AAVE': 'AAVEUSDC',
  'SOL': 'SOLUSDC',
  'ARB': 'ARBUSDC',
  'OP': 'OPUSDC',
  'SHIB': 'SHIBUSDC',
  'DOT': 'DOTUSDC',
  'WLD': 'WLDUSDC',
  'WBTC': 'WBTCUSDC',
}

// --- Chainlink pair mapping ---

const CHAINLINK_PAIR_MAP: Record<string, string> = {
  'ETH': 'ETH/USD',
  'WETH': 'ETH/USD',
  'BTC': 'BTC/USD',
  // Note: WBTC is NOT mapped to BTC/USD — they are distinct assets.
  // Chainlink doesn't have a WBTC/USD feed on Ethereum mainnet.
  'USDC': 'USDC/USD',
  'USDT': 'USDT/USD',
  'DAI': 'DAI/USD',
  'LINK': 'LINK/USD',
  'STETH': 'STETH/USD',
  'AAVE': 'AAVE/USD',
  'UNI': 'UNI/USD',
}

// --- Available pairs per base symbol ---

const AVAILABLE_QUOTES: Record<string, string[]> = {
  'BTC':  ['USD', 'USDT', 'USDC'],
  'WBTC': ['USD', 'USDT', 'USDC'],
  'ETH':  ['USD', 'USDT', 'USDC'],
  'WETH': ['USD', 'USDT', 'USDC'],
  'SOL':  ['USD', 'USDT', 'USDC'],
  'LINK': ['USD', 'USDT', 'USDC'],
  'AAVE': ['USD', 'USDT', 'USDC'],
  'UNI':  ['USD', 'USDT', 'USDC'],
  'OP':   ['USD', 'USDT', 'USDC'],
  'ARB':  ['USD', 'USDT', 'USDC'],
  'MATIC':['USD', 'USDT'],
  'USDC': ['USD', 'USDT'],
  'USDT': ['USD'],
  'DAI':  ['USD'],
  'MON':  ['USD'],
  'SHIB': ['USD', 'USDT', 'USDC'],
  'MNT':  ['USD', 'USDT', 'USDC'],
  'DOT':  ['USD', 'USDT', 'USDC'],
  'WLD':  ['USD', 'USDT', 'USDC'],
  'STETH': ['USD', 'USDT', 'USDC'],
}

// --- PriceAggregator Class ---

export class PriceAggregator {
  private binanceProxy: BinanceProxy | null = null
  private chainlinkOracle: ChainlinkOracle | null = null

  // Batch result cache: key = sorted pair-list hash, value = { result, timestamp }
  private batchCache: Map<string, { result: Record<string, AggregatedPrice>; timestamp: number }> = new Map()
  private BATCH_CACHE_TTL = 30 * 1000 // 30 seconds

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
        : 'https://ethereum-rpc.publicnode.com'

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

    // Fetch all available sources for the requested quote currency.
    // USD-denominated APIs (CoinGecko, DefiLlama, etc.) are ≈1:1 with USDT/USDC
    // so they serve as valid cross-references for stablecoin pairs too.
    const fetchPromises: Promise<void>[] = []

    if (upperQuote === 'USD') {
      fetchPromises.push(this.fetchChainlinkPrice(upperBase, prices))
      fetchPromises.push(this.fetchCoinMarketCapPrice(upperBase, prices))
      fetchPromises.push(this.fetchCoinGeckoPrice(upperBase, prices))
      fetchPromises.push(this.fetchDefiLlamaPrice(upperBase, prices))
    } else if (upperQuote === 'USDT') {
      fetchPromises.push(this.fetchBinancePrice(upperBase, prices, BINANCE_USDT_PAIR_MAP, 'USDT'))
      fetchPromises.push(this.fetchDexPrices(upperBase, prices, 'USDT'))
      fetchPromises.push(this.fetchCoinGeckoPrice(upperBase, prices))
      fetchPromises.push(this.fetchDefiLlamaPrice(upperBase, prices))
    } else if (upperQuote === 'USDC') {
      fetchPromises.push(this.fetchBinancePrice(upperBase, prices, BINANCE_USDC_PAIR_MAP, 'USDC'))
      fetchPromises.push(this.fetchDexPrices(upperBase, prices, 'USDC'))
      fetchPromises.push(this.fetchCoinGeckoPrice(upperBase, prices))
      fetchPromises.push(this.fetchDefiLlamaPrice(upperBase, prices))
    }

    await Promise.allSettled(fetchPromises)

    // Filter out outlier prices (e.g. broken V4 quoter returning $3 or $4e70 for ETH)
    const filtered = this.filterOutliers(prices)

    // Calculate median
    const median = this.calculateMedian(filtered.map(p => p.price))

    // Calculate spread (difference between max and min as percentage of median)
    const spread = this.calculateSpread(filtered.map(p => p.price))

    return {
      base: upperBase,
      quote: upperQuote,
      prices: filtered,
      median,
      spread,
      timestamp: Date.now()
    }
  }

  /**
   * Get all available trading pairs.
   */
  getAvailablePairs(): Array<{ base: string; quote: string }> {
    const pairs: Array<{ base: string; quote: string }> = []
    for (const [base, quotes] of Object.entries(AVAILABLE_QUOTES)) {
      for (const quote of quotes) {
        pairs.push({ base, quote })
      }
    }
    return pairs
  }

  /**
   * Check if a specific trading pair is supported.
   */
  isPairSupported(base: string, quote: string): boolean {
    const quotes = AVAILABLE_QUOTES[base.toUpperCase()]
    return quotes ? quotes.includes(quote.toUpperCase()) : false
  }

  /**
   * Get aggregated prices for multiple pairs in a single batch.
   * Uses batch APIs for CoinGecko, DefiLlama, and CMC to minimize external requests.
   * Results are cached for 30s — subsequent calls with the same pair list return instantly.
   */
  async getBatchAggregatedPrices(pairs: Array<{ base: string; quote: string }>): Promise<Record<string, AggregatedPrice>> {
    // Build cache key from sorted pair list
    const normalizedPairs = pairs.map(p => `${p.base.toUpperCase()}/${p.quote.toUpperCase()}`)
    const cacheKey = [...normalizedPairs].sort().join(',')

    // Check batch cache
    const cached = this.batchCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.BATCH_CACHE_TTL) {
      console.log(`[PriceAggregator] Returning cached batch result (${normalizedPairs.length} pairs)`)
      return cached.result
    }

    console.log(`[PriceAggregator] Fetching batch prices for ${normalizedPairs.length} pairs`)

    // Extract unique base symbols
    const allBaseSymbols = [...new Set(pairs.map(p => p.base.toUpperCase()))]

    // --- Batch API calls (1 request each) ---
    const [geckoResult, llamaResult, cmcResult] = await Promise.allSettled([
      coinGeckoService.getBatchPrices(allBaseSymbols),
      defiLlamaService.getBatchPrices(allBaseSymbols),
      this.fetchBatchCMCPrices(allBaseSymbols),
    ])

    const geckoPrices = geckoResult.status === 'fulfilled' ? geckoResult.value : {}
    const llamaPrices = llamaResult.status === 'fulfilled' ? llamaResult.value : {}
    const cmcPrices = cmcResult.status === 'fulfilled' ? cmcResult.value : {}

    console.log(`[PriceAggregator] Batch sources: CoinGecko=${Object.keys(geckoPrices).length}, DefiLlama=${Object.keys(llamaPrices).length}, CMC=${Object.keys(cmcPrices).length}`)

    // --- Per-symbol calls (Chainlink, Binance, Uniswap) ---
    // These don't have batch APIs but are fast / generous with rate limits
    const chainlinkPromises: Map<string, Promise<{ price: number } | null>> = new Map()
    const binanceUSDTPromises: Map<string, Promise<number>> = new Map()
    const binanceUSDCPromises: Map<string, Promise<number>> = new Map()
    const dexPromises: Map<string, Promise<import('./UniswapPriceService.js').DexPriceResult[]>> = new Map()

    for (const symbol of allBaseSymbols) {
      // Chainlink
      if (this.chainlinkOracle && CHAINLINK_PAIR_MAP[symbol]) {
        chainlinkPromises.set(symbol, this.chainlinkOracle.getPrice(CHAINLINK_PAIR_MAP[symbol]).then(
          price => price > 0 ? { price } : null,
          () => null
        ))
      }

      // Binance USDT & USDC
      if (BINANCE_USDT_PAIR_MAP[symbol]) {
        const binance = this.binanceProxy || new BinanceProxy('price-aggregator')
        binanceUSDTPromises.set(symbol, binance.getPrice(BINANCE_USDT_PAIR_MAP[symbol]).catch(() => 0))
      }
      if (BINANCE_USDC_PAIR_MAP[symbol]) {
        const binance = this.binanceProxy || new BinanceProxy('price-aggregator')
        binanceUSDCPromises.set(symbol, binance.getPrice(BINANCE_USDC_PAIR_MAP[symbol]).catch(() => 0))
      }

      // Uniswap DEX quotes
      dexPromises.set(symbol, uniswapPriceService.getAllPrices(symbol, 'USDC').catch(() => []))
    }

    // Await all per-symbol calls
    const [chainlinkResults, binanceUSDTResults, binanceUSDCResults, dexResults] = await Promise.all([
      this.resolveMap(chainlinkPromises),
      this.resolveMap(binanceUSDTPromises),
      this.resolveMap(binanceUSDCPromises),
      this.resolveMap(dexPromises),
    ])

    // --- Assemble per-pair results ---
    const result: Record<string, AggregatedPrice> = {}

    for (const pair of pairs) {
      const upperBase = pair.base.toUpperCase()
      const upperQuote = pair.quote.toUpperCase()
      const key = `${upperBase}/${upperQuote}`
      const prices: PriceSource[] = []

      // Add CoinGecko price (USD-denominated, applies to all quote currencies)
      const geckoPrice = geckoPrices[upperBase]
      if (geckoPrice && geckoPrice > 0) {
        prices.push({ source: 'coingecko', price: geckoPrice, quoteCurrency: 'USD', timestamp: Date.now() })
      }

      // Add DefiLlama price
      const llamaPrice = llamaPrices[upperBase]
      if (llamaPrice && llamaPrice > 0) {
        prices.push({ source: 'defillama', price: llamaPrice, quoteCurrency: 'USD', timestamp: Date.now() })
      }

      // Add CMC price
      const cmcPrice = cmcPrices[upperBase]
      if (cmcPrice && cmcPrice > 0) {
        prices.push({ source: 'coinmarketcap', price: cmcPrice, quoteCurrency: 'USD', timestamp: Date.now() })
      }

      // Add Chainlink price (only for USD pairs)
      if (upperQuote === 'USD') {
        const cl = chainlinkResults.get(upperBase)
        if (cl && cl.price > 0) {
          prices.push({ source: 'chainlink', price: cl.price, quoteCurrency: 'USD', timestamp: Date.now() })
        }
      }

      // Add Binance prices based on quote currency
      if (upperQuote === 'USD' || upperQuote === 'USDT') {
        const binUSDT = binanceUSDTResults.get(upperBase)
        if (binUSDT && binUSDT > 0) {
          prices.push({ source: 'binance', price: binUSDT, quoteCurrency: 'USDT', timestamp: Date.now() })
        }
      }
      if (upperQuote === 'USD' || upperQuote === 'USDC') {
        const binUSDC = binanceUSDCResults.get(upperBase)
        if (binUSDC && binUSDC > 0) {
          prices.push({ source: 'binance', price: binUSDC, quoteCurrency: 'USDC', timestamp: Date.now() })
        }
      }

      // Add DEX prices
      if (upperQuote === 'USD' || upperQuote === 'USDT' || upperQuote === 'USDC') {
        const dex = dexResults.get(upperBase)
        if (dex) {
          for (const d of dex) {
            prices.push({
              source: d.source,
              price: d.price,
              quoteCurrency: 'USDC',
              timestamp: d.timestamp,
              network: d.network,
              chainId: d.chainId,
              feeTier: d.feeTier,
              gasEstimateGwei: d.gasEstimateGwei,
              gasPriceGwei: d.gasPriceGwei,
              path: d.path,
            })
          }
        }
      }

      const filtered = this.filterOutliers(prices)
      const median = this.calculateMedian(filtered.map(p => p.price))
      const spread = this.calculateSpread(filtered.map(p => p.price))

      result[key] = {
        base: upperBase,
        quote: upperQuote,
        prices: filtered,
        median,
        spread,
        timestamp: Date.now(),
      }
    }

    // Cache the batch result
    this.batchCache.set(cacheKey, { result, timestamp: Date.now() })

    return result
  }

  /**
   * Fetch batch CMC prices, ensuring the API key is loaded.
   */
  private async fetchBatchCMCPrices(symbols: string[]): Promise<Record<string, number>> {
    const cmcKey = apiKeyStore.getCoinMarketCapApiKey()
    if (cmcKey && !priceService.getCoinMarketCapApiKey()) {
      priceService.setCoinMarketCapApiKey(cmcKey)
    }
    if (!priceService.getCoinMarketCapApiKey()) return {}
    return priceService.getBatchPricesUSD(symbols)
  }

  /**
   * Resolve a Map of promises into a Map of results.
   */
  private async resolveMap<K, V>(map: Map<K, Promise<V>>): Promise<Map<K, V>> {
    const keys = [...map.keys()]
    const values = await Promise.allSettled([...map.values()])
    const result = new Map<K, V>()
    keys.forEach((key, i) => {
      if (values[i].status === 'fulfilled') {
        result.set(key, values[i].value)
      }
    })
    return result
  }

  // --- Private Fetch Methods ---

  private async fetchBinancePrice(
    symbol: string,
    prices: PriceSource[],
    pairMap: Record<string, string> = BINANCE_USDT_PAIR_MAP,
    quoteCurrency: string = 'USDT'
  ): Promise<void> {
    try {
      // Binance public API does not require auth for price checks
      const binance = this.binanceProxy || new BinanceProxy('price-aggregator')
      const binancePair = pairMap[symbol]

      if (!binancePair) return

      const price = await binance.getPrice(binancePair)

      if (price > 0) {
        prices.push({
          source: 'binance',
          price,
          quoteCurrency,
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
          quoteCurrency: 'USD',
          timestamp: Date.now()
        })
      }
    } catch (error: any) {
      console.warn(`[PriceAggregator] Chainlink price fetch failed for ${symbol}:`, error.message)
    }
  }

  private async fetchCoinMarketCapPrice(symbol: string, prices: PriceSource[]): Promise<void> {
    try {
      // Ensure CMC API key is loaded from the key store
      const cmcKey = apiKeyStore.getCoinMarketCapApiKey()
      if (cmcKey && !priceService.getCoinMarketCapApiKey()) {
        priceService.setCoinMarketCapApiKey(cmcKey)
      }

      // Skip if no API key — don't return hardcoded fallback prices
      if (!priceService.getCoinMarketCapApiKey()) return

      const price = await priceService.getTokenPriceUSD(symbol)

      if (price > 0) {
        prices.push({
          source: 'coinmarketcap',
          price,
          quoteCurrency: 'USD',
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
          quoteCurrency: 'USD',
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
          quoteCurrency: 'USD',
          timestamp: Date.now()
        })
      }
    } catch (error: any) {
      console.warn(`[PriceAggregator] DefiLlama price fetch failed for ${symbol}:`, error.message)
    }
  }

  private async fetchDexPrices(symbol: string, prices: PriceSource[], quoteAsset: string = 'USDC'): Promise<void> {
    try {
      const dexResults = await uniswapPriceService.getAllPrices(symbol, quoteAsset)
      for (const result of dexResults) {
        prices.push({
          source: result.source,
          price: result.price,
          quoteCurrency: quoteAsset,
          timestamp: result.timestamp,
          network: result.network,
          chainId: result.chainId,
          feeTier: result.feeTier,
          gasEstimateGwei: result.gasEstimateGwei,
          gasPriceGwei: result.gasPriceGwei,
          path: result.path,
        })
      }
    } catch (error: any) {
      console.warn(`[PriceAggregator] DEX price fetch failed for ${symbol}:`, error.message)
    }
  }

  // --- Outlier Filtering ---

  /**
   * Remove prices that deviate wildly from the group.
   * Protects against broken quoters (e.g. V4 returning $3 for ETH).
   * Threshold: >50% deviation from the median of all prices.
   */
  private filterOutliers(prices: PriceSource[]): PriceSource[] {
    if (prices.length < 2) return prices

    const median = this.calculateMedian(prices.map(p => p.price))
    if (median <= 0) return prices

    const filtered = prices.filter(p => {
      const deviation = Math.abs(p.price - median) / median
      if (deviation > 0.5) {
        console.warn(`[PriceAggregator] Dropping outlier: ${p.source} reported $${p.price} (${(deviation * 100).toFixed(1)}% from median $${median})`)
        return false
      }
      return true
    })

    // If filtering removed everything, return original (don't lose all data)
    return filtered.length > 0 ? filtered : prices
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
