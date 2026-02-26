import { apiClient } from './client'
import type { Trade } from '@/types'

export const tradesApi = {
  list: (params?: { strategy_id?: string; limit?: number; offset?: number }) =>
    apiClient.get<{ success: boolean; trades: Trade[] }>('/api/trades', { params }),

  getStats: () =>
    apiClient.get<{ success: boolean; stats: Record<string, unknown> }>('/api/trades/stats'),
}
