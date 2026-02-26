// ============================================================================
// Core Types
// ============================================================================

export interface Strategy {
  id: string
  name: string
  description: string
  code: string
  execution_type: string
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'error'
  created_at: string
  updated_at: string
  started_at?: string
  stopped_at?: string
}

export interface Trade {
  id: string
  execution_id?: string
  strategy_id: string
  wallet_address: string
  timestamp: string
  chain_id: number
  protocol: string
  tx_hash: string
  block_number: number
  token_in_symbol: string
  token_in_address: string
  token_in_amount: string
  token_out_symbol: string
  token_out_address: string
  token_out_amount: string
  token_in_price_usd?: number
  token_out_price_usd?: number
  value_in_usd?: number
  value_out_usd?: number
  profit_loss_usd?: number
  gas_used?: number
  gas_price_gwei?: number
  gas_cost_usd?: number
  expected_output?: string
  actual_output?: string
  slippage_amount?: string
  slippage_percentage?: number
  execution_price?: string
  quote_price?: string
  order_id?: string
  status: 'pending' | 'confirmed' | 'failed'
}

export interface Position {
  id: string
  strategy_id: string
  asset_symbol: string
  asset_address: string
  chain_id: number
  side: 'long' | 'short'
  quantity: string
  avg_entry_price: string
  current_price?: string
  realized_pnl: string
  unrealized_pnl?: string
  total_fees: string
  status: 'open' | 'closed'
  opened_at: string
  closed_at?: string
}

export interface PnlSnapshot {
  id: string
  timestamp: string
  strategy_id?: string
  total_value_usd: number
  realized_pnl_usd: number
  unrealized_pnl_usd: number
  total_pnl_usd: number
  positions_count: number
}

export interface Order {
  id: string
  strategy_id: string
  order_type: 'market' | 'limit' | 'stop'
  side: 'buy' | 'sell'
  asset_symbol: string
  asset_address?: string
  chain_id?: number
  protocol: string
  quantity: string
  price?: string
  tick?: number
  status: 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired'
  filled_quantity?: string
  filled_price?: string
  deadline?: string
  created_at: string
  updated_at: string
}

export interface Account {
  id: string
  name: string
  address: string
  account_type: 'imported' | 'hd'
  private_key?: string
  hd_wallet_id?: string
  derivation_index?: number
  created_at: string
}

export interface ApiConfig {
  alchemy_app_id: string
  alchemy_api_key: string
  etherscan_api_key: string
  coinmarketcap_api_key: string
  oneinch_api_key: string
  binance_api_key: string
  binance_api_secret: string
}

export interface NetworkConfig {
  network_id: number
  network_name: string
  rpc_provider: string
  custom_rpc_url?: string
  chain_id: number
  native_token: string
  explorer_url: string
}

export interface StrategyAccountMapping {
  strategy_id: string
  networkId: number
  networkName: string
  accountId: string
  accountName: string
  address: string
  exchangeName?: string // for CEX mappings
}

export interface AccountActivity {
  id: string
  activityType: string
  description: string
  metadata?: string
  chainId?: number
  txHash?: string
  amount?: string
  timestamp: string
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  error?: string
  data?: T
}

// ============================================================================
// App State Types
// ============================================================================

export type Theme = 'dark' | 'light'

export type AppScreen =
  | 'dashboard'
  | 'strategies'
  | 'markets'
  | 'orders'
  | 'analytics'
  | 'hooks'
  | 'docs'
  | 'settings'

export interface WorkerState {
  strategyId: string
  status: 'init' | 'running' | 'paused' | 'stopped' | 'error'
  startedAt?: string
  executionCount: number
  errorCount: number
  lastHeartbeat?: string
}

export interface BackendStatus {
  connected: boolean
  wsConnected: boolean
  lastCheck: string
}
