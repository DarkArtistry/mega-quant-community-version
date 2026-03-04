import { apiClient } from './client'
import type { OptionPosition } from '../types'

export const optionsApi = {
  async getPositions(strategyId?: string, status: string = 'open') {
    const params: Record<string, string> = { status }
    if (strategyId) params.strategy_id = strategyId
    const { data } = await apiClient.get('/api/options/positions', { params })
    return data as { success: boolean; positions: OptionPosition[]; count: number }
  },

  async getPosition(id: string) {
    const { data } = await apiClient.get(`/api/options/positions/${id}`)
    return data as { success: boolean; position: OptionPosition }
  },

  async getPnl(strategyId?: string) {
    const params: Record<string, string> = {}
    if (strategyId) params.strategy_id = strategyId
    const { data } = await apiClient.get('/api/options/pnl', { params })
    return data as { success: boolean; summary: any }
  }
}
