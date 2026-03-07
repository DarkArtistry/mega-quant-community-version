// Strategy Addresses — network-aware address constants for strategy sandbox
// Builds from CHAIN_CONFIGS + TOKEN_ADDRESSES so strategies can use
// addresses.UNICHAIN_SEPOLIA_HOOK or addresses['unichain-sepolia'].tokens.WETH

import { CHAIN_CONFIGS } from '../trading/config/chains.js'
import { TOKEN_ADDRESSES } from '../trading/config/tokens.js'

/**
 * Build a frozen address constant object with two access patterns:
 *
 * Flat:       addresses.UNICHAIN_SEPOLIA_WETH → '0x4200...'
 * Structured: addresses['unichain-sepolia'].tokens.WETH → '0x4200...'
 */
export function buildStrategyAddresses(): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [chainName, config] of Object.entries(CHAIN_CONFIGS)) {
    // Convert chain name to flat prefix: 'unichain-sepolia' → 'UNICHAIN_SEPOLIA'
    const prefix = chainName.toUpperCase().replace(/-/g, '_')

    // --- Structured access ---
    const tokens: Record<string, string> = {}
    const chainTokens = TOKEN_ADDRESSES[chainName]
    if (chainTokens) {
      for (const [symbol, info] of Object.entries(chainTokens)) {
        tokens[symbol] = info.address
        // Flat token: addresses.UNICHAIN_SEPOLIA_WETH
        result[`${prefix}_${symbol}`] = info.address
      }
    }

    const structured: Record<string, any> = {
      chainId: config.chainId,
      name: config.name,
      blockExplorer: config.blockExplorer,
      tokens,
      uniswapV3: config.uniswapV3
        ? {
            router: config.uniswapV3.router,
            quoter: config.uniswapV3.quoter,
            factory: config.uniswapV3.factory,
            nftPositionManager: config.uniswapV3.nftPositionManager,
          }
        : null,
      uniswapV4: config.uniswapV4
        ? {
            poolManager: config.uniswapV4.poolManager,
            positionManager: config.uniswapV4.positionManager,
            universalRouter: config.uniswapV4.universalRouter,
            quoter: config.uniswapV4.quoter,
            stateView: config.uniswapV4.stateView,
            megaQuantHook: config.uniswapV4.megaQuantHook || null,
            megaQuantRouter: config.uniswapV4.megaQuantRouter || null,
            poolRegistry: config.uniswapV4.poolRegistry || null,
          }
        : null,
      aaveV3: config.aaveV3
        ? {
            pool: config.aaveV3.pool,
            dataProvider: config.aaveV3.dataProvider,
          }
        : null,
    }

    result[chainName] = Object.freeze(structured)

    // --- Flat protocol addresses ---
    if (config.uniswapV4?.poolManager) {
      result[`${prefix}_POOL_MANAGER`] = config.uniswapV4.poolManager
    }
    if (config.uniswapV4?.megaQuantHook) {
      result[`${prefix}_HOOK`] = config.uniswapV4.megaQuantHook
    }
    if (config.uniswapV4?.megaQuantRouter) {
      result[`${prefix}_ROUTER`] = config.uniswapV4.megaQuantRouter
    }
    if (config.uniswapV4?.poolRegistry) {
      result[`${prefix}_POOL_REGISTRY`] = config.uniswapV4.poolRegistry
    }
    if (config.uniswapV3?.router) {
      result[`${prefix}_V3_ROUTER`] = config.uniswapV3.router
    }
    if (config.aaveV3?.pool) {
      result[`${prefix}_AAVE_POOL`] = config.aaveV3.pool
    }
  }

  return Object.freeze(result)
}
