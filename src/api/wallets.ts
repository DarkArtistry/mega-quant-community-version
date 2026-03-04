import { apiClient } from './client'

export interface WalletAccount {
  id: string
  name: string
  address: string
}

export interface TokenBalance {
  symbol: string
  name: string
  address: string
  decimals: number
  rawBalance: string
  formattedBalance: string
  coingeckoId?: string
}

export interface ChainBalances {
  chain: string
  chainId: number
  address: string
  nativeBalance: TokenBalance
  tokens: TokenBalance[]
  timestamp: number
}

export interface MultiChainBalancesResponse {
  success: boolean
  balances: ChainBalances[]
  errors: Array<{ chain: string; error: string }>
}

export interface CexBalance {
  asset: string
  free: string
  locked: string
  total: string
}

export interface BinanceBalancesResponse {
  success: boolean
  exchange: string
  balances: CexBalance[]
  configured: boolean
  timestamp?: number
  error?: string
}

export const walletsApi = {
  getAccounts: () =>
    apiClient.get<{ success: boolean; accounts: WalletAccount[] }>('/api/wallets/accounts'),

  getBalances: (address: string, chain: string) =>
    apiClient.get<{ success: boolean; balances: ChainBalances }>(`/api/wallets/balances/${address}/${chain}`),

  getMultiChainBalances: (address: string, chains: string[]) =>
    apiClient.post<MultiChainBalancesResponse>('/api/wallets/balances/multi', { address, chains }),

  getSupportedChains: () =>
    apiClient.get<{ success: boolean; chains: string[] }>('/api/wallets/supported-chains'),

  getBinanceBalances: () =>
    apiClient.get<BinanceBalancesResponse>('/api/wallets/balances/binance'),
}
