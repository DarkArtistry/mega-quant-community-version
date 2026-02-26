/**
 * Prices API Routes
 *
 * Provides token price data from multiple sources:
 * - CoinMarketCap via PriceService (single and batch)
 * - Aggregated prices from Binance, Chainlink, and CoinMarketCap
 * - On-chain Chainlink oracle prices
 */

import express from 'express'
import { priceService } from '../lib/trading/services/PriceService.js'
import { PriceAggregator } from '../lib/trading/services/PriceAggregator.js'
import { ChainlinkOracle } from '../lib/trading/oracles/ChainlinkOracle.js'
import { apiKeyStore } from '../services/api-key-store.js'
import { JsonRpcProvider } from 'ethers'

const router = express.Router()

// Known stablecoin symbols (always price at $1.00)
const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FRAX'])

// Lazy-initialized singletons
let priceAggregator: PriceAggregator | null = null
let chainlinkOracle: ChainlinkOracle | null = null

function getPriceAggregator(): PriceAggregator {
  if (!priceAggregator) {
    priceAggregator = new PriceAggregator()
  }
  return priceAggregator
}

function getChainlinkOracle(): ChainlinkOracle {
  if (!chainlinkOracle) {
    const alchemyKey = apiKeyStore.getAlchemyApiKey()
    const rpcUrl = alchemyKey
      ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : 'https://eth.llamarpc.com'

    const provider = new JsonRpcProvider(rpcUrl)
    chainlinkOracle = new ChainlinkOracle(provider)
  }
  return chainlinkOracle
}

/**
 * GET /api/prices/aggregated/:base/:quote
 * Get aggregated price from multiple sources (Binance, Chainlink, CoinMarketCap)
 */
router.get('/aggregated/:base/:quote', async (req, res) => {
  try {
    const { base, quote } = req.params

    if (!base) {
      return res.status(400).json({
        success: false,
        error: 'Base symbol is required'
      })
    }

    const aggregator = getPriceAggregator()
    const result = await aggregator.getAggregatedPrice(base, quote || 'USD')

    res.json({
      success: true,
      base: result.base,
      quote: result.quote,
      median: result.median,
      spread: result.spread,
      sources: result.prices,
      timestamp: result.timestamp
    })
  } catch (error: any) {
    console.error('[Prices] Aggregated price error:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/prices/aggregated/batch
 * Get aggregated prices from multiple sources for multiple symbols.
 * Body: { symbols: ['ETH', 'BTC', 'USDC'] }
 */
router.post('/aggregated/batch', async (req, res) => {
  try {
    const { symbols } = req.body

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Symbols array is required'
      })
    }

    const aggregator = getPriceAggregator()

    const results = await Promise.allSettled(
      symbols.map((sym: string) => aggregator.getAggregatedPrice(sym, 'USD'))
    )

    const prices: Record<string, { median: number; spread: number; sourceCount: number }> = {}

    symbols.forEach((sym: string, idx: number) => {
      const result = results[idx]
      if (result.status === 'fulfilled') {
        prices[sym.toUpperCase()] = {
          median: result.value.median,
          spread: result.value.spread,
          sourceCount: result.value.prices.length
        }
      } else {
        prices[sym.toUpperCase()] = { median: 0, spread: 0, sourceCount: 0 }
      }
    })

    res.json({
      success: true,
      prices,
      timestamp: Date.now()
    })
  } catch (error: any) {
    console.error('[Prices] Batch aggregated price error:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/prices/oracle/:pair
 * Get on-chain Chainlink oracle price
 * Pair format: ETH-USD, BTC-USD, USDC-USD, LINK-USD
 */
router.get('/oracle/:pair', async (req, res) => {
  try {
    const { pair } = req.params

    if (!pair) {
      return res.status(400).json({
        success: false,
        error: 'Pair is required (e.g., ETH-USD)'
      })
    }

    // Normalize pair format: ETH-USD -> ETH/USD
    const normalizedPair = pair.replace('-', '/').toUpperCase()

    const oracle = getChainlinkOracle()

    if (!oracle.isPairSupported(normalizedPair)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported pair: ${pair}. Supported: ${oracle.getSupportedPairs().join(', ')}`
      })
    }

    const priceData = await oracle.getPriceData(normalizedPair)

    res.json({
      success: true,
      pair: priceData.pair,
      price: priceData.price,
      roundId: priceData.roundId,
      updatedAt: priceData.updatedAt,
      answeredInRound: priceData.answeredInRound,
      source: 'chainlink',
      feedAddress: oracle.getFeedAddress(normalizedPair)
    })
  } catch (error: any) {
    console.error('[Prices] Oracle price error:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * GET /api/prices/:symbol
 * Get USD price for a token symbol (e.g., ETH, USDC, BTC)
 * Uses PriceService (CoinMarketCap) with caching and fallbacks.
 */
router.get('/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params

    if (!symbol) {
      return res.status(400).json({
        success: false,
        error: 'Symbol is required'
      })
    }

    const upperSymbol = symbol.toUpperCase()

    // Return 1.0 for stablecoins
    if (STABLECOINS.has(upperSymbol)) {
      return res.json({
        success: true,
        symbol: upperSymbol,
        price: 1.0,
        timestamp: Date.now(),
        source: 'stablecoin'
      })
    }

    // Ensure CoinMarketCap API key is configured if available
    const cmcKey = apiKeyStore.getCoinMarketCapApiKey()
    if (cmcKey && !priceService.getCoinMarketCapApiKey()) {
      priceService.setCoinMarketCapApiKey(cmcKey)
    }

    const price = await priceService.getTokenPriceUSD(upperSymbol)

    res.json({
      success: true,
      symbol: upperSymbol,
      price,
      timestamp: Date.now(),
      source: cmcKey ? 'coinmarketcap' : 'fallback'
    })
  } catch (error: any) {
    console.error('[Prices] Error fetching price:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/**
 * POST /api/prices/batch
 * Get USD prices for multiple token symbols
 *
 * Body: {
 *   symbols: ['ETH', 'USDC', 'BTC']
 * }
 */
router.post('/batch', async (req, res) => {
  try {
    const { symbols } = req.body

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Symbols array is required'
      })
    }

    // Ensure CoinMarketCap API key is configured if available
    const cmcKey = apiKeyStore.getCoinMarketCapApiKey()
    if (cmcKey && !priceService.getCoinMarketCapApiKey()) {
      priceService.setCoinMarketCapApiKey(cmcKey)
    }

    // Separate stablecoins from tokens that need lookup
    const stablecoins: string[] = []
    const lookupSymbols: string[] = []

    for (const symbol of symbols) {
      const upper = symbol.toUpperCase()
      if (STABLECOINS.has(upper)) {
        stablecoins.push(upper)
      } else {
        lookupSymbols.push(upper)
      }
    }

    // Fetch prices for non-stablecoin tokens
    const fetchedPrices = lookupSymbols.length > 0
      ? await priceService.getMultiplePricesUSD(lookupSymbols)
      : {}

    // Combine results
    const prices: Record<string, number> = {}

    for (const s of stablecoins) {
      prices[s] = 1.0
    }

    for (const [symbol, price] of Object.entries(fetchedPrices)) {
      prices[symbol] = price
    }

    res.json({
      success: true,
      prices,
      timestamp: Date.now(),
      source: cmcKey ? 'coinmarketcap' : 'fallback'
    })
  } catch (error: any) {
    console.error('[Prices] Error fetching prices:', error)
    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

export default router
