import { apiClient } from './client'

export interface HdWallet {
  id: string
  name: string
  accountCount: number
  created_at: string
  updated_at: string
}

export interface HdWalletAccount {
  id: string
  name: string
  address: string
  derivationIndex: number
  derivation_path: string
  created_at: string
}

export const hdWalletsApi = {
  list: () =>
    apiClient.get<{ success: boolean; wallets: HdWallet[] }>('/api/hd-wallets/list'),

  create: (password: string, walletName: string) =>
    apiClient.post<{
      success: boolean
      walletId: string
      walletName: string
      mnemonic: string
    }>('/api/hd-wallets/create', { password, walletName }),

  deriveAccount: (password: string, walletId: string, accountName: string, derivationIndex: number) =>
    apiClient.post<{
      success: boolean
      account: {
        id: string
        name: string
        address: string
        derivationIndex: number
        derivationPath: string
      }
    }>('/api/hd-wallets/derive-account', { password, walletId, accountName, derivationIndex }),

  getAccounts: (walletId: string) =>
    apiClient.get<{ success: boolean; accounts: HdWalletAccount[] }>(
      `/api/hd-wallets/${walletId}/accounts`
    ),

  getNextIndex: (walletId: string) =>
    apiClient.get<{ success: boolean; nextIndex: number }>(
      `/api/hd-wallets/${walletId}/next-index`
    ),

  delete: (walletId: string, confirmDelete: string) =>
    apiClient.delete<{ success: boolean; deletedAccounts: number }>(
      `/api/hd-wallets/${walletId}`,
      { data: { confirmDelete } }
    ),

  exportPrivateKey: (password: string, accountId: string) =>
    apiClient.post<{ success: boolean; privateKey: string }>(
      '/api/hd-wallets/export-private-key',
      { password, accountId }
    ),
}
