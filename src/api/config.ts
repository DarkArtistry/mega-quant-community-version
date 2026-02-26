import { apiClient } from './client'
import type { Account, ApiConfig, NetworkConfig } from '@/types'

export const configApi = {
  getApiConfig: (password: string) =>
    apiClient.post<{ success: boolean; config: Partial<ApiConfig> }>(
      '/api/config-encrypted/api-config/get',
      { password }
    ),

  updateApiConfig: (password: string, config: Partial<ApiConfig>) =>
    apiClient.post<{ success: boolean }>('/api/config-encrypted/api-config/update', {
      password,
      ...config,
    }),

  getAccounts: (password: string) =>
    apiClient.post<{ success: boolean; accounts: Account[] }>(
      '/api/config-encrypted/accounts/get',
      { password }
    ),

  addAccount: (password: string, data: { name: string; private_key: string }) =>
    apiClient.post<{ success: boolean }>('/api/config-encrypted/accounts/add', {
      password,
      ...data,
    }),

  deleteAccount: (password: string, accountId: string) =>
    apiClient.post<{ success: boolean }>('/api/config-encrypted/accounts/delete', {
      password,
      accountId,
    }),

  getNetworkConfigs: (password: string) =>
    apiClient.post<{ success: boolean; configs: NetworkConfig[] }>(
      '/api/config-encrypted/network-configs/get',
      { password }
    ),

  saveNetworkConfigs: (password: string, configs: Partial<NetworkConfig>[]) =>
    apiClient.post<{ success: boolean }>('/api/config-encrypted/network-configs/save', {
      password,
      configs,
    }),
}
