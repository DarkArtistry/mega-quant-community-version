import { apiClient } from './client'

export interface PriceSource {
  source: string
  price: number
  timestamp: number
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

export interface BatchAggregatedResponse {
  success: boolean
  prices: Record<string, { median: number; spread: number; sourceCount: number }>
  timestamp: number
}

export const pricesApi = {
  /** Get aggregated price from all sources for a single token */
  aggregated: (base: string, quote: string = 'USD') =>
    apiClient.get<AggregatedPriceResponse>(`/api/prices/aggregated/${base}/${quote}`),

  /** Get aggregated prices for multiple tokens */
  aggregatedBatch: (symbols: string[]) =>
    apiClient.post<BatchAggregatedResponse>('/api/prices/aggregated/batch', { symbols }),

  /** Get basic batch prices (CoinMarketCap/fallback) */
  batch: (symbols: string[]) =>
    apiClient.post<{ success: boolean; prices: Record<string, number>; source: string }>(
      '/api/prices/batch',
      { symbols }
    ),
}
