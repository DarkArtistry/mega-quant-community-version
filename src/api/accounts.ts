import { apiClient } from './client'
import type { StrategyAccountMapping, AccountActivity } from '@/types'

export const accountsApi = {
  getAccounts: () =>
    apiClient.get<{ success: boolean; accounts: import('@/types').Account[] }>(
      '/api/config-encrypted/accounts'
    ),

  getStrategyMappings: (strategyId: string) =>
    apiClient.get<{ success: boolean; mappings: StrategyAccountMapping[] }>(
      `/api/strategy-accounts/${strategyId}`
    ),

  setStrategyNetworkAccount: (strategyId: string, networkId: number, accountId: string) =>
    apiClient.post<{ success: boolean }>(
      `/api/strategy-accounts/${strategyId}/networks/${networkId}`,
      { accountId }
    ),

  removeStrategyNetworkAccount: (strategyId: string, networkId: number) =>
    apiClient.delete<{ success: boolean }>(
      `/api/strategy-accounts/${strategyId}/networks/${networkId}`
    ),

  setStrategyCexAccount: (strategyId: string, exchangeName: string) =>
    apiClient.post<{ success: boolean }>(
      `/api/strategy-accounts/${strategyId}/cex/${exchangeName}`,
      {}
    ),

  removeStrategyCexAccount: (strategyId: string, exchangeName: string) =>
    apiClient.delete<{ success: boolean }>(
      `/api/strategy-accounts/${strategyId}/cex/${exchangeName}`
    ),

  getAccountActivity: (accountId: string) =>
    apiClient.get<{ success: boolean; activities: AccountActivity[] }>(
      `/api/account-activity/${accountId}`
    ),

  getAccountPnl: (accountId: string) =>
    apiClient.get<{ success: boolean; pnl: { totalPnl: number; realizedPnl: number; unrealizedPnl: number } }>(
      `/api/account-activity/${accountId}/pnl`
    ),
}
