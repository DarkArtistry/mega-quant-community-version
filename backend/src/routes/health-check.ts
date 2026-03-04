/**
 * Health Check Route
 * Tests connectivity to all external services (price APIs, RPCs, oracles).
 * GET /test-services — no auth needed, uses in-memory keys, returns no secrets.
 */

import express from 'express'
import axios from 'axios'
import { JsonRpcProvider, Contract } from 'ethers'
import { apiKeyStore } from '../services/api-key-store.js'
import { getChainConfig } from '../lib/trading/config/chains.js'

const router = express.Router()

const TIMEOUT = 5000

interface ServiceTestResult {
  service: string
  status: 'ok' | 'error' | 'not_configured'
  latencyMs: number
  message: string
  provider?: string
  blockNumber?: number
  price?: number
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ])
}

/** Determine which RPC provider is active for a network (mirrors chains.ts priority) */
function detectRpcProvider(network: string): 'custom' | 'alchemy' | 'env' | 'public' {
  const customEnvKey = `${network.toUpperCase().replace('-', '_')}_CUSTOM_RPC_URL`
  if (process.env[customEnvKey]) return 'custom'

  try {
    const alchemyKey = apiKeyStore.getAlchemyApiKey()
    if (alchemyKey && alchemyKey !== 'YOUR_KEY' && alchemyKey !== '') return 'alchemy'
  } catch { /* not configured */ }

  const envKey = `${network.toUpperCase().replace('-', '_')}_RPC_URL`
  if (process.env[envKey]) return 'env'

  return 'public'
}

router.get('/test-services', async (_req, res) => {
  const results: ServiceTestResult[] = []
  const tests: Promise<void>[] = []

  // 1. CoinGecko
  tests.push((async () => {
    const start = Date.now()
    try {
      const resp = await withTimeout(
        axios.get('https://api.coingecko.com/api/v3/simple/price', {
          params: { ids: 'ethereum', vs_currencies: 'usd' },
          timeout: TIMEOUT,
        }),
        TIMEOUT
      )
      const price = resp.data?.ethereum?.usd
      results.push({
        service: 'coingecko',
        status: 'ok',
        latencyMs: Date.now() - start,
        message: `ETH: $${price}`,
        price,
      })
    } catch (err: any) {
      results.push({
        service: 'coingecko',
        status: 'error',
        latencyMs: Date.now() - start,
        message: err.message,
      })
    }
  })())

  // 2. DefiLlama
  tests.push((async () => {
    const start = Date.now()
    try {
      const resp = await withTimeout(
        axios.get('https://coins.llama.fi/prices/current/coingecko:ethereum', {
          timeout: TIMEOUT,
        }),
        TIMEOUT
      )
      const price = resp.data?.coins?.['coingecko:ethereum']?.price
      results.push({
        service: 'defillama',
        status: 'ok',
        latencyMs: Date.now() - start,
        message: `ETH: $${price}`,
        price,
      })
    } catch (err: any) {
      results.push({
        service: 'defillama',
        status: 'error',
        latencyMs: Date.now() - start,
        message: err.message,
      })
    }
  })())

  // 3. CoinMarketCap
  tests.push((async () => {
    const start = Date.now()
    let cmcKey: string | undefined
    try {
      cmcKey = apiKeyStore.getCoinMarketCapApiKey()
    } catch { /* not loaded */ }

    if (!cmcKey) {
      results.push({
        service: 'coinmarketcap',
        status: 'not_configured',
        latencyMs: 0,
        message: 'API key not configured',
      })
      return
    }
    try {
      const resp = await withTimeout(
        axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest', {
          headers: { 'X-CMC_PRO_API_KEY': cmcKey, Accept: 'application/json' },
          params: { symbol: 'ETH', convert: 'USD' },
          timeout: TIMEOUT,
        }),
        TIMEOUT
      )
      const price = resp.data?.data?.ETH?.quote?.USD?.price
      results.push({
        service: 'coinmarketcap',
        status: 'ok',
        latencyMs: Date.now() - start,
        message: `ETH: $${price?.toFixed(2)}`,
        price,
      })
    } catch (err: any) {
      results.push({
        service: 'coinmarketcap',
        status: 'error',
        latencyMs: Date.now() - start,
        message: err.response?.data?.status?.error_message || err.message,
      })
    }
  })())

  // 4. Binance (public endpoint, no auth)
  tests.push((async () => {
    const start = Date.now()
    try {
      const resp = await withTimeout(
        axios.get('https://api.binance.com/api/v3/ticker/price', {
          params: { symbol: 'ETHUSDT' },
          timeout: TIMEOUT,
        }),
        TIMEOUT
      )
      const price = parseFloat(resp.data?.price)
      results.push({
        service: 'binance',
        status: 'ok',
        latencyMs: Date.now() - start,
        message: `ETH: $${price}`,
        price,
      })
    } catch (err: any) {
      results.push({
        service: 'binance',
        status: 'error',
        latencyMs: Date.now() - start,
        message: err.message,
      })
    }
  })())

  // 5. RPC per chain (mainnets + testnets)
  for (const network of ['ethereum', 'base', 'unichain', 'sepolia', 'base-sepolia', 'unichain-sepolia'] as const) {
    tests.push((async () => {
      const start = Date.now()
      const providerType = detectRpcProvider(network)
      try {
        const chainConfig = getChainConfig(network)
        const provider = new JsonRpcProvider(chainConfig.rpcUrl)
        const blockNumber = await withTimeout(provider.getBlockNumber(), TIMEOUT)
        results.push({
          service: `rpc-${network}`,
          status: 'ok',
          latencyMs: Date.now() - start,
          message: `Block #${blockNumber.toLocaleString()}`,
          provider: providerType,
          blockNumber,
        })
      } catch (err: any) {
        results.push({
          service: `rpc-${network}`,
          status: 'error',
          latencyMs: Date.now() - start,
          message: err.message?.slice(0, 120) || 'RPC connection failed',
          provider: providerType,
        })
      }
    })())
  }

  // 6. Chainlink (on-chain via Ethereum RPC)
  tests.push((async () => {
    const start = Date.now()
    try {
      const chainConfig = getChainConfig('ethereum')
      const provider = new JsonRpcProvider(chainConfig.rpcUrl)
      const AGGREGATOR_ABI = [
        'function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)',
      ]
      const ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
      const contract = new Contract(ETH_USD_FEED, AGGREGATOR_ABI, provider)
      const [, answer] = await withTimeout(contract.latestRoundData(), TIMEOUT)
      const price = Number(answer) / 1e8
      results.push({
        service: 'chainlink',
        status: 'ok',
        latencyMs: Date.now() - start,
        message: `ETH/USD: $${price.toFixed(2)}`,
        price,
      })
    } catch (err: any) {
      results.push({
        service: 'chainlink',
        status: 'error',
        latencyMs: Date.now() - start,
        message: err.message?.slice(0, 120) || 'Oracle call failed',
      })
    }
  })())

  await Promise.allSettled(tests)

  res.json({
    success: true,
    results,
    timestamp: Date.now(),
  })
})

export default router
