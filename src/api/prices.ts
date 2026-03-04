import { apiClient } from './client'

export interface PriceSource {
  source: string
  price: number
  timestamp: number
  quoteCurrency?: string // 'USD' | 'USDT' | 'USDC'
  network?: string       // 'Ethereum' | 'Base' — for on-chain DEX sources
  chainId?: number       // 1 | 8453
  feeTier?: number       // 3000 = 0.3% — for DEX sources
  gasEstimateGwei?: number
  gasPriceGwei?: number  // Current network gas price in gwei
  path?: string[]        // e.g. ['LINK', 'WETH', 'USDC'] for multi-hop DEX routes
}

export interface AggregatedPriceResponse {
  success: boolean
  base: string
  quote: string
  median: number
  spread: number
  sources: PriceSource[]
  timestamp: number
}

export interface TradingPair {
  base: string
  quote: string
}

export interface BatchPairEntry {
  base: string
  quote: string
  median: number
  spread: number
  sourceCount: number
}

export interface BatchPairResponse {
  success: boolean
  prices: Record<string, BatchPairEntry>
  timestamp: number
}

export interface BatchAggregatedResponse {
  success: boolean
  prices: Record<string, { median: number; spread: number; sourceCount: number }>
  timestamp: number
}

export const pricesApi = {
  /** Get aggregated price from all sources for a single pair */
  aggregated: (base: string, quote: string = 'USD') =>
    apiClient.get<AggregatedPriceResponse>(`/api/prices/aggregated/${base}/${quote}`),

  /** Get aggregated prices for multiple trading pairs */
  aggregatedBatchPairs: (pairs: TradingPair[]) =>
    apiClient.post<BatchPairResponse>('/api/prices/aggregated/batch', { pairs }),

  /** Get aggregated prices for multiple tokens (legacy — treats as USD pairs) */
  aggregatedBatch: (symbols: string[]) =>
    apiClient.post<BatchAggregatedResponse>('/api/prices/aggregated/batch', { symbols }),

  /** Get basic batch prices (CoinMarketCap/fallback) */
  batch: (symbols: string[]) =>
    apiClient.post<{ success: boolean; prices: Record<string, number>; source: string }>(
      '/api/prices/batch',
      { symbols }
    ),
}
