// Token address registry for all supported chains
// Ported from reference, focused on ethereum, base, sepolia, base-sepolia

export interface TokenInfo {
  address: string
  symbol: string
  name: string
  decimals: number
  coingeckoId?: string
}

export const TOKEN_ADDRESSES: Record<string, Record<string, TokenInfo>> = {
  ethereum: {
    ETH: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      coingeckoId: 'ethereum'
    },
    WETH: {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      coingeckoId: 'weth'
    },
    USDC: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      coingeckoId: 'usd-coin'
    },
    USDT: {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      coingeckoId: 'tether'
    },
    WBTC: {
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      decimals: 8,
      coingeckoId: 'wrapped-bitcoin'
    },
    DAI: {
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      coingeckoId: 'dai'
    }
  },

  base: {
    ETH: {
      address: '0x0000000000000000000000000000000000000000',
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      coingeckoId: 'ethereum'
    },
    WETH: {
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      coingeckoId: 'weth'
    },
    USDC: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      coingeckoId: 'usd-coin'
    },
    USDT: {
      address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      coingeckoId: 'tether'
    },
    DAI: {
      address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      coingeckoId: 'dai'
    }
  },

  // Sepolia testnet tokens
  sepolia: {
    WETH: {
      address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18
    },
    USDC: {
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Circle's official USDC
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6
    },
    USDT: {
      address: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6
    },
    DAI: {
      address: '0x68194a729C2450ad26072b3D33ADaCbcef39D574',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18
    }
  },

  'base-sepolia': {
    WETH: {
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18
    },
    USDC: {
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6
    },
    USDT: {
      address: '0x637B07e1a2D4E84d9aA9fB87bA3acf9D4DA55619',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6
    },
    DAI: {
      address: '0xB8e007e0FD81b28087f29fE4e9C5E14B0B830183',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18
    }
  }
}

/**
 * Get token info by chain name and token symbol
 * @throws Error if chain or token not found
 */
export function getTokenInfo(chainName: string, tokenSymbol: string): TokenInfo {
  const chain = TOKEN_ADDRESSES[chainName.toLowerCase()]
  if (!chain) {
    throw new Error(`Chain ${chainName} not found in token registry. Available: ${Object.keys(TOKEN_ADDRESSES).join(', ')}`)
  }

  const token = chain[tokenSymbol.toUpperCase()]
  if (!token) {
    throw new Error(`Token ${tokenSymbol} not found on chain ${chainName}. Available: ${Object.keys(chain).join(', ')}`)
  }

  return token
}

/**
 * Get token by address on a given chain (case-insensitive address match)
 */
export function getTokenByAddress(chainName: string, address: string): TokenInfo | undefined {
  const chain = TOKEN_ADDRESSES[chainName.toLowerCase()]
  if (!chain) return undefined

  return Object.values(chain).find(
    t => t.address.toLowerCase() === address.toLowerCase()
  )
}

/**
 * Get all tokens registered for a chain
 * @throws Error if chain not found
 */
export function getChainTokens(chainName: string): Record<string, TokenInfo> {
  const chain = TOKEN_ADDRESSES[chainName.toLowerCase()]
  if (!chain) {
    throw new Error(`Chain ${chainName} not found in token registry. Available: ${Object.keys(TOKEN_ADDRESSES).join(', ')}`)
  }
  return chain
}
