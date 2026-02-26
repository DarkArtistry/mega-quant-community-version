import { apiClient } from './client'
import type { Order } from '@/types'

export const ordersApi = {
  getAll: (params?: { strategy_id?: string }) =>
    apiClient.get<{ success: boolean; orders: Order[] }>('/api/orders', { params }),

  getPending: () =>
    apiClient.get<{ success: boolean; orders: Order[] }>('/api/orders', {
      params: { status: 'pending' },
    }),

  getHistory: (params?: { limit?: number; offset?: number }) =>
    apiClient.get<{ success: boolean; orders: Order[] }>('/api/orders/history', { params }),

  cancel: (orderId: string) =>
    apiClient.delete<{ success: boolean }>(`/api/orders/${orderId}`),
}
