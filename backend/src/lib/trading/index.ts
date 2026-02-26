// Trading SDK - Core exports
// Re-exports all trading modules for convenient access

// Chain and token configuration
export { getChainConfig, getChainById, getChainNameById, getSupportedChains, CHAIN_CONFIGS } from './config/chains.js'
export type { ChainConfig } from './config/chains.js'

export { TOKEN_ADDRESSES, getTokenInfo, getTokenByAddress, getChainTokens } from './config/tokens.js'
export type { TokenInfo } from './config/tokens.js'

// Protocol base class and interfaces
export { ProtocolProxy } from './ProtocolProxy.js'
export type { SwapParams, SwapResult, QuoteParams, QuoteResult } from './ProtocolProxy.js'

// Chain proxy (per-chain protocol access)
export { ChainProxy } from './ChainProxy.js'

// Main trading orchestrator
export { DeltaTrade, createDeltaTrade } from './DeltaTrade.js'
export type { TokenBalance, ExecutionResult } from './DeltaTrade.js'

// Execution manager (singleton)
export { tradingExecutionManager } from './TradingExecutionManager.js'
export type { ExecutionInfo } from './TradingExecutionManager.js'
