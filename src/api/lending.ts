import { apiClient } from './client'
import type { LendingPosition } from '../types'

export const lendingApi = {
  async getPositions(strategyId?: string, status: string = 'open') {
    const params: Record<string, string> = { status }
    if (strategyId) params.strategy_id = strategyId
    const { data } = await apiClient.get('/api/lending/positions', { params })
    return data as { success: boolean; positions: LendingPosition[]; count: number }
  },

  async getPosition(id: string) {
    const { data } = await apiClient.get(`/api/lending/positions/${id}`)
    return data as { success: boolean; position: LendingPosition }
  },

  async getPnl(strategyId?: string) {
    const params: Record<string, string> = {}
    if (strategyId) params.strategy_id = strategyId
    const { data } = await apiClient.get('/api/lending/pnl', { params })
    return data as { success: boolean; summary: any }
  }
}
