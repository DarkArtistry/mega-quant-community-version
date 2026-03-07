import { apiClient } from './client'

export interface PoolInfo {
  poolId: string
  currentTick: number
  sqrtPriceX96: string
  liquidity: string
  fee: number
  feePercentage: string
}

export interface PoolWithInfo {
  poolId: string
  token0: string
  token1: string
  token0Symbol: string
  token1Symbol: string
  tickSpacing: number
  creator: string
  name: string
  active: boolean
  info: PoolInfo | null
}

export interface V4Chain {
  key: string
  name: string
  chainId: number
  hasHook: boolean
  hasRegistry: boolean
}

export interface WalletAccount {
  id: string
  name: string
  address: string
}

export interface TokenBalance {
  symbol: string
  balance: string
  decimals: number
}

export interface BalanceInfo {
  address: string
  accountName: string
  balance: string
  symbol: string
  sufficient: boolean
  tokenBalances: TokenBalance[]
}

export interface AddLiquidityRequest {
  chain: string
  tokenA: string
  tokenB: string
  amount0: string
  amount1: string
  tickLower?: number
  tickUpper?: number
  accountId?: string
}

export interface AddLiquidityResponse {
  success: boolean
  txHash: string
  tokenId?: string
  amount0: string
  amount1: string
  liquidity: string
  explorerUrl: string
  error?: string
}

export const liquidityApi = {
  getChains: () =>
    apiClient.get<{ success: boolean; chains: V4Chain[] }>('/api/liquidity/chains'),

  getAccounts: () =>
    apiClient.get<{ success: boolean; accounts: WalletAccount[] }>('/api/wallets/accounts'),

  getBalance: (chain: string, accountId?: string, tokenA?: string, tokenB?: string) =>
    apiClient.get<{ success: boolean } & BalanceInfo>('/api/liquidity/balance', {
      params: { chain, accountId, tokenA, tokenB },
    }),

  getPools: (chain: string, accountId?: string) =>
    apiClient.get<{ success: boolean; pools: PoolWithInfo[] }>('/api/liquidity/pools', {
      params: { chain, accountId },
    }),

  getPoolInfo: (chain: string, tokenA: string, tokenB: string) =>
    apiClient.get<{ success: boolean; info: PoolInfo }>('/api/liquidity/pool-info', {
      params: { chain, tokenA, tokenB },
    }),

  wrapEth: (chain: string, amount: string, accountId?: string) =>
    apiClient.post<{ success: boolean; txHash: string; amount: string; explorerUrl: string; error?: string }>(
      '/api/liquidity/wrap-eth',
      { chain, amount, accountId }
    ),

  addLiquidity: (params: AddLiquidityRequest) =>
    apiClient.post<AddLiquidityResponse>('/api/liquidity/add', params),
}
