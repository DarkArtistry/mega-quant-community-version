import { apiClient } from './client'
import type { PerpPosition } from '../types'

export const perpsApi = {
  async getPositions(strategyId?: string, status: string = 'open') {
    const params: Record<string, string> = { status }
    if (strategyId) params.strategy_id = strategyId
    const { data } = await apiClient.get('/api/perps/positions', { params })
    return data as { success: boolean; positions: PerpPosition[]; count: number }
  },

  async getPosition(id: string) {
    const { data } = await apiClient.get(`/api/perps/positions/${id}`)
    return data as { success: boolean; position: PerpPosition }
  },

  async getFundingPayments(positionId: string) {
    const { data } = await apiClient.get(`/api/perps/funding/${positionId}`)
    return data as { success: boolean; payments: any[]; count: number }
  },

  async getPnl(strategyId?: string) {
    const params: Record<string, string> = {}
    if (strategyId) params.strategy_id = strategyId
    const { data } = await apiClient.get('/api/perps/pnl', { params })
    return data as { success: boolean; summary: any }
  }
}
