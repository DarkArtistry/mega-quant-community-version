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
  quote_asset_symbol?: string
  protocol?: string
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
  // Multi-instrument fields
  instrument_type?: InstrumentType
  position_side?: string
  leverage?: number
  reduce_only?: boolean
  margin_type?: string
  option_type?: string
  strike_price?: string
  expiry?: string
  underlying_symbol?: string
  lending_action?: string
  interest_rate_mode?: string
  // Enriched detail fields
  gas_cost_usd?: number
  gas_used?: number
  commission?: string
  commission_asset?: string
  token_in_symbol?: string
  token_in_amount?: string
  token_out_symbol?: string
  token_out_amount?: string
  slippage_percentage?: number
  filled_at?: string
  block_number?: number
  tx_hash?: string
  account_id?: string
  strategy_name?: string
  linked_order_id?: string
  hook_order_id?: string
}

export interface Account {
  id: string
  name: string
  address: string
  accountType: 'imported' | 'hd'
  privateKey?: string
  hdWalletId?: string
  derivationIndex?: number
  derivationPath?: string
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
  binance_testnet: boolean
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

// ============================================================================
// Multi-Instrument Types
// ============================================================================

export type InstrumentType = 'spot' | 'perp' | 'option' | 'lending'

export interface PerpPosition {
  id: string
  strategy_id: string | null
  account_id: string | null
  protocol: string
  chain_id: number | null
  market_symbol: string
  side: 'long' | 'short'
  position_size: string
  avg_entry_price: string
  current_price: string | null
  leverage: number
  margin_type: string
  collateral_amount: string | null
  collateral_asset: string | null
  liquidation_price: string | null
  realized_pnl: string
  unrealized_pnl: string
  total_fees: string
  total_funding: string
  status: 'open' | 'closed' | 'liquidated'
  opened_at: string
  closed_at: string | null
}

export interface OptionPosition {
  id: string
  strategy_id: string | null
  account_id: string | null
  protocol: string
  chain_id: number | null
  underlying_symbol: string
  option_type: 'call' | 'put'
  side: 'long' | 'short'
  strike_price: string
  expiry: string
  contracts: string
  entry_premium: string
  current_premium: string | null
  realized_pnl: string
  unrealized_pnl: string
  total_fees: string
  delta: string | null
  gamma: string | null
  theta: string | null
  vega: string | null
  implied_volatility: string | null
  status: 'open' | 'closed' | 'expired' | 'exercised'
  opened_at: string
  closed_at: string | null
}

export interface LendingPosition {
  id: string
  strategy_id: string | null
  account_id: string | null
  protocol: string
  chain_id: number | null
  asset_symbol: string
  asset_address: string | null
  atoken_address: string | null
  position_type: 'supply' | 'borrow'
  interest_rate_mode: string | null
  principal_amount: string
  current_amount: string
  accrued_interest: string
  current_apy: string | null
  health_factor: string | null
  liquidation_threshold: string | null
  realized_pnl: string
  total_fees: string
  status: 'open' | 'closed' | 'liquidated'
  opened_at: string
  closed_at: string | null
}

export interface FundingPayment {
  id: string
  perp_position_id: string
  strategy_id: string | null
  account_id: string | null
  market_symbol: string
  payment_amount: string
  funding_rate: string
  position_size: string | null
  timestamp: string
}

export interface AggregatedPnl {
  totalRealizedPnl: number
  totalUnrealizedPnl: number
  totalPnl: number
  totalOpenPositions: number
  spot: {
    totalRealizedPnl: number
    totalUnrealizedPnl: number
    totalPnl: number
    openPositionsCount: number
    closedPositionsCount: number
  }
  perps: {
    totalRealizedPnl: number
    totalUnrealizedPnl: number
    totalFunding: number
    totalPnl: number
    openPositionsCount: number
    closedPositionsCount: number
  }
  options: {
    totalRealizedPnl: number
    totalUnrealizedPnl: number
    totalPnl: number
    openPositionsCount: number
    closedPositionsCount: number
  }
  lending: {
    totalRealizedPnl: number
    totalAccruedInterest: number
    totalPnl: number
    openPositionsCount: number
    closedPositionsCount: number
  }
}
