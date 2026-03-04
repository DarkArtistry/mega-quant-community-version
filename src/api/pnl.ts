import { apiClient } from './client'
import type { PnlSnapshot, Position } from '@/types'

export interface AccountPnlSummary {
  account_id: string
  account_name: string
  address: string
  network: string
  chain_id: number
  realized_pnl: number
  unrealized_pnl: number
  total_pnl: number
  positions_count: number
}

export interface PnlBreakdown {
  global: {
    totalRealizedPnl: number
    totalUnrealizedPnl: number
    totalPnl: number
    openPositionsCount: number
    closedPositionsCount: number
  }
  byStrategy: Array<{
    strategyId: string
    strategyName: string
    totalRealizedPnl: number
    totalUnrealizedPnl: number
    totalPnl: number
    openPositionsCount: number
    closedPositionsCount: number
  }>
  byAccount: Array<{
    accountId: string
    accountName: string
    address: string | null
    totalRealizedPnl: number
    totalUnrealizedPnl: number
    totalPnl: number
    openPositionsCount: number
    closedPositionsCount: number
  }>
  timestamp: string
}

export const pnlApi = {
  /** Hourly snapshots, filterable by strategy and/or account */
  getHourly: (hours = 24, strategyId?: string, accountId?: string, network?: string) =>
    apiClient.get<{ success: boolean; snapshots: PnlSnapshot[] }>('/api/pnl/hourly', {
      params: { hours, strategy_id: strategyId, account_id: accountId, network },
    }),

  /**
   * Total PnL summary with flexible filtering:
   *   - No params: global (all accounts, all strategies)
   *   - strategyId: all accounts within that strategy
   *   - accountId: that account across all strategies
   *   - Both: specific intersection
   */
  getTotal: (strategyId?: string, accountId?: string, network?: string) =>
    apiClient.get<{ success: boolean; summary: any; filters: any }>('/api/pnl/total', {
      params: { strategy_id: strategyId, account_id: accountId, network },
    }),

  /** Full PnL breakdown: global + by-strategy + by-account */
  getBreakdown: (network?: string) =>
    apiClient.get<{ success: boolean } & PnlBreakdown>('/api/pnl/breakdown', {
      params: { network },
    }),

  /** Positions, filterable by strategy and/or account */
  getPositions: (strategyId?: string, accountId?: string, status = 'open', network?: string) =>
    apiClient.get<{ success: boolean; positions: Position[] }>('/api/pnl/positions', {
      params: { strategy_id: strategyId, account_id: accountId, status, network },
    }),

  /** Per-account PnL via account-activity route */
  getAccountPnl: (accountId: string) =>
    apiClient.get<{ success: boolean; pnl: any; positions: any[] }>(
      `/api/account-activity/${accountId}/pnl`
    ),
}
