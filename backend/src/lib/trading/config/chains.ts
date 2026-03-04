// Chain configuration for multi-chain support
// Ported from reference with enhancements for the new system

import { apiKeyStore } from '../../../services/api-key-store.js'

// Network name to chain ID mapping
const NETWORK_TO_CHAIN_ID: Record<string, number> = {
  'ethereum': 1,
  'base': 8453,
  'unichain': 130,
  'sepolia': 11155111,
  'base-sepolia': 84532,
  'unichain-sepolia': 1301
}

// Alchemy network slugs for building RPC URLs
const ALCHEMY_NETWORK_SLUGS: Record<string, string> = {
  'ethereum': 'eth-mainnet',
  'base': 'base-mainnet',
  'sepolia': 'eth-sepolia',
  'base-sepolia': 'base-sepolia'
}

/**
 * Get RPC URL with proper priority:
 * 1. Custom RPC (highest priority)
 * 2. Alchemy RPC with decrypted API key from api-key-store
 * 3. Environment variable (e.g., ETHEREUM_RPC_URL)
 * 4. Public RPC fallback
 */
function getRpcUrl(network: string, templateUrl: string): string {
  // PRIORITY 1: Check for custom RPC override via environment
  const customEnvKey = `${network.toUpperCase().replace('-', '_')}_CUSTOM_RPC_URL`
  const customUrl = process.env[customEnvKey]
  if (customUrl) {
    console.log(`[ChainConfig] Using custom RPC for ${network} (from env: ${customEnvKey})`)
    return customUrl
  }

  // PRIORITY 2: Try to get Alchemy API key from in-memory store
  try {
    const alchemyApiKey = apiKeyStore.getAlchemyApiKey()

    if (alchemyApiKey && alchemyApiKey !== 'YOUR_KEY' && alchemyApiKey !== '') {
      const slug = ALCHEMY_NETWORK_SLUGS[network]
      if (slug) {
        const alchemyUrl = `https://${slug}.g.alchemy.com/v2/${alchemyApiKey}`
        console.log(`[ChainConfig] Using Alchemy RPC for ${network}`)
        return alchemyUrl
      }
    }
  } catch (error) {
    console.warn(`[ChainConfig] Could not get Alchemy API key for ${network}:`, error)
  }

  // PRIORITY 3: Use environment variable
  const envKey = `${network.toUpperCase().replace('-', '_')}_RPC_URL`
  const envUrl = process.env[envKey]
  if (envUrl) {
    console.log(`[ChainConfig] Using env RPC for ${network}`)
    return envUrl
  }

  // PRIORITY 4: Fall back to public RPC
  const PUBLIC_FALLBACKS: Record<string, string> = {
    'ethereum': 'https://ethereum-rpc.publicnode.com',
    'base': 'https://base-rpc.publicnode.com',
    'unichain': 'https://mainnet.unichain.org',
    'sepolia': 'https://ethereum-sepolia-rpc.publicnode.com',
    'base-sepolia': 'https://base-sepolia-rpc.publicnode.com',
    'unichain-sepolia': 'https://sepolia.unichain.org'
  }

  const publicUrl = PUBLIC_FALLBACKS[network] || templateUrl
  console.log(`[ChainConfig] Using public RPC for ${network}`)
  return publicUrl
}

export interface ChainConfig {
  chainId: number
  name: string
  rpcUrl: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  blockExplorer: string
  uniswapV3?: {
    router: string
    routerVersion?: 1 | 2 // Default is 1 (V1 has deadline, V2 does not)
    quoter: string
    quoterVersion?: 1 | 2 // Default is 1
    factory: string
    nftPositionManager: string
  }
  uniswapV4?: {
    poolManager: string
    positionManager: string
    universalRouter: string
    quoter: string // V4Quoter for getting swap quotes
    stateView: string
    swapRouter?: string // Optional: Custom SwapRouter contract
  }
  oneInchSupported: boolean
  aaveV3?: {
    pool: string
    dataProvider: string
  }
}

/**
 * Get chain configuration with live RPC URLs (uses decrypted API keys from memory)
 */
export function getChainConfig(chainName: string): ChainConfig {
  const config = CHAIN_CONFIGS_TEMPLATE[chainName]
  if (!config) {
    throw new Error(`Chain ${chainName} not found. Available: ${Object.keys(CHAIN_CONFIGS_TEMPLATE).join(', ')}`)
  }

  // Return config with dynamically generated RPC URL
  return {
    ...config,
    rpcUrl: getRpcUrl(chainName, config.rpcUrl)
  }
}

/**
 * Template configs with placeholder URLs
 * Use getChainConfig() to get configs with real API keys
 */
const CHAIN_CONFIGS_TEMPLATE: Record<string, ChainConfig> = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorer: 'https://etherscan.io',
    uniswapV3: {
      router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', // QuoterV2 — returns gas estimates
      quoterVersion: 2,
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      nftPositionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
    },
    uniswapV4: {
      poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
      positionManager: '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e',
      universalRouter: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
      quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
      stateView: '0x7ffe42c4a5deea5b0fec41c94c136cf115597227'
    },
    oneInchSupported: true,
    aaveV3: {
      pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      dataProvider: '0x7B4EB56E7CD4b454BA8ff71E4518426c9EB28E3d'
    }
  },

  base: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://base-mainnet.g.alchemy.com/v2/YOUR_KEY',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorer: 'https://basescan.org',
    uniswapV3: {
      router: '0x2626664c2603336E57B271c5C0b26F421741e481',
      quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', // QuoterV2 on Base
      quoterVersion: 2,
      factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
      nftPositionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1'
    },
    uniswapV4: {
      poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
      positionManager: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
      universalRouter: '0x6ff5693b99212da76ad316178a184ab56d299b43',
      quoter: '0x0d5e0f971ed27fbff6c2837bf31316121532048d',
      stateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71'
    },
    oneInchSupported: true,
    aaveV3: {
      pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
      dataProvider: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac'
    }
  },

  unichain: {
    chainId: 130,
    name: 'Unichain',
    rpcUrl: 'https://mainnet.unichain.org',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorer: 'https://uniscan.xyz',
    uniswapV3: {
      router: '0x73855d06de49d0fe4a9c42636ba96c62da12ff9c',
      routerVersion: 2,
      quoter: '0x385a5cf5f83e99f7bb2852b6a19c3538b9fa7658',
      quoterVersion: 2,
      factory: '0x1f98400000000000000000000000000000000003',
      nftPositionManager: '0x943e6e07a7e880e09e0b8b40ef1e7d8e97e09bfa',
    },
    uniswapV4: {
      poolManager: '0x1f98400000000000000000000000000000000004',
      positionManager: '0x4529a01c7a0410167c5740c487a8de60232617bf',
      universalRouter: '0xef740bf23acae26f6492b10de645d6b98dc8eaf3',
      quoter: '0x333e3c607b141b18ff6de9f258db6e77fe7491e0',
      stateView: '0x0000000000000000000000000000000000000000',
    },
    oneInchSupported: false,
  },

  // Testnets
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia Testnet',
    rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorer: 'https://sepolia.etherscan.io',
    uniswapV3: {
      router: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E', // SwapRouter02 on Sepolia
      routerVersion: 2,
      quoter: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3', // QuoterV2
      quoterVersion: 2,
      factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
      nftPositionManager: '0x1238536071E1c677A632429e3655c799b22cDA52'
    },
    uniswapV4: {
      poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
      positionManager: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4',
      universalRouter: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
      quoter: '0x61b3f2011a92d183c7dbadbda940a7555ccf9227',
      stateView: '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c'
    },
    oneInchSupported: false
  },

  'base-sepolia': {
    chainId: 84532,
    name: 'Base Sepolia Testnet',
    rpcUrl: 'https://base-sepolia.g.alchemy.com/v2/YOUR_KEY',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorer: 'https://sepolia.basescan.org',
    uniswapV3: {
      router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
      routerVersion: 2, // Base Sepolia uses SwapRouter02 (no deadline)
      quoter: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
      quoterVersion: 2, // Base Sepolia uses QuoterV2
      factory: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
      nftPositionManager: '0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2'
    },
    uniswapV4: {
      poolManager: '0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408',
      positionManager: '0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80',
      universalRouter: '0x492e6456d9528771018deb9e87ef7750ef184104',
      quoter: '0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba',
      stateView: '0x571291b572ed32ce6751a2cb2486ebee8defb9b4'
    },
    oneInchSupported: false
  },

  'unichain-sepolia': {
    chainId: 1301,
    name: 'Unichain Sepolia Testnet',
    rpcUrl: 'https://sepolia.unichain.org',
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'ETH',
      decimals: 18
    },
    blockExplorer: 'https://sepolia.uniscan.xyz',
    uniswapV3: {
      router: '0x73855d06de49d0fe4a9c42636ba96c62da12ff9c',
      routerVersion: 2,
      quoter: '0x385a5cf5f83e99f7bb2852b6a19c3538b9fa7658',
      quoterVersion: 2,
      factory: '0x1f98400000000000000000000000000000000003',
      nftPositionManager: '0x943e6e07a7e880e09e0b8b40ef1e7d8e97e09bfa',
    },
    uniswapV4: {
      poolManager: '0xC81462Fec8B23319F288047f8A03A57682a35C1A',
      positionManager: '0xB433cB9BcEF07d25E33A42C793C746C8f10EC103',
      universalRouter: '0xf70536B3bcC1bD1a972dc186A2cf84cC6da6Be5D',
      quoter: '0xf3a39C86DfEd7B1A740f9D3fb4046B8dD8d3267C',
      stateView: '0x0000000000000000000000000000000000000000',
    },
    oneInchSupported: false,
  }
}

// Backward compatibility: Export template configs
export const CHAIN_CONFIGS = CHAIN_CONFIGS_TEMPLATE

// Helper to get chain by ID
export function getChainById(chainId: number): ChainConfig | undefined {
  return Object.values(CHAIN_CONFIGS).find(c => c.chainId === chainId)
}

// Helper to get chain name by ID
export function getChainNameById(chainId: number): string | undefined {
  const entry = Object.entries(CHAIN_CONFIGS).find(([_, c]) => c.chainId === chainId)
  return entry ? entry[0] : undefined
}

// Get all supported chain names
export function getSupportedChains(): string[] {
  return Object.keys(CHAIN_CONFIGS)
}
