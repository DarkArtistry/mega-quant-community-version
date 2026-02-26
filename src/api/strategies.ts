import { apiClient } from './client'
import type { Strategy } from '@/types'

export const strategiesApi = {
  list: () =>
    apiClient.get<{ success: boolean; strategies: Strategy[] }>('/api/strategies'),

  get: (id: string) =>
    apiClient.get<{ success: boolean; strategy: Strategy }>(`/api/strategies/${id}`),

  create: (data: { name: string; description?: string; code: string; execution_type?: string }) =>
    apiClient.post<{ success: boolean; id: string }>('/api/strategies', data),

  update: (id: string, data: Partial<Strategy>) =>
    apiClient.patch<{ success: boolean }>(`/api/strategies/${id}`, data),

  delete: (id: string) =>
    apiClient.delete<{ success: boolean }>(`/api/strategies/${id}`),
}
