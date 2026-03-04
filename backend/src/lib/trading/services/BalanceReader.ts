/**
 * Read-only balance reader for on-chain wallets and CEX accounts.
 * On-chain: Uses public RPC providers — no private keys needed.
 * CEX: Uses Binance REST API with API key from api-key-store.
 */

import { JsonRpcProvider, Contract, formatUnits, FetchRequest, Network } from 'ethers'
import axios from 'axios'
import crypto from 'crypto'
import { getChainConfig } from '../config/chains.js'
import { TOKEN_ADDRESSES, type TokenInfo } from '../config/tokens.js'
import { apiKeyStore } from '../../../services/api-key-store.js'

const ERC20_BALANCE_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
]

/** Per-chain timeout in ms — fail fast instead of retrying forever */
const CHAIN_TIMEOUT_MS = 8000

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

// Cache providers per chain to avoid re-creating them
const providerCache = new Map<string, JsonRpcProvider>()

function getProvider(chainName: string): JsonRpcProvider {
  let provider = providerCache.get(chainName)
  if (!provider) {
    const config = getChainConfig(chainName)

    // Skip obviously bad URLs (placeholder keys)
    if (config.rpcUrl.includes('YOUR_KEY')) {
      throw new Error(`RPC URL for ${chainName} contains placeholder API key — skipping`)
    }

    // Create FetchRequest with timeout, and pass explicit network to avoid eth_chainId call
    const fetchReq = new FetchRequest(config.rpcUrl)
    fetchReq.timeout = CHAIN_TIMEOUT_MS
    const network = Network.from(config.chainId)
    provider = new JsonRpcProvider(fetchReq, network, {
      staticNetwork: network,  // skip eth_chainId — prevents infinite retry on bad RPCs
    })
    providerCache.set(chainName, provider)
  }
  return provider
}

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/**
 * Read all token balances for an address on a single chain.
 * Wrapped in a timeout so bad RPCs fail fast.
 */
export async function readAllBalances(address: string, chainName: string): Promise<ChainBalances> {
  const config = getChainConfig(chainName)
  const provider = getProvider(chainName) // may throw for placeholder URLs
  const chainTokens = TOKEN_ADDRESSES[chainName] || {}

  // Read native ETH balance (with timeout)
  const ethBalance = await withTimeout(
    provider.getBalance(address),
    CHAIN_TIMEOUT_MS,
    `${chainName} getBalance`,
  )
  const nativeCurrency = config.nativeCurrency

  const nativeBalance: TokenBalance = {
    symbol: nativeCurrency.symbol,
    name: nativeCurrency.name,
    address: '0x0000000000000000000000000000000000000000',
    decimals: nativeCurrency.decimals,
    rawBalance: ethBalance.toString(),
    formattedBalance: formatUnits(ethBalance, nativeCurrency.decimals),
  }

  // Read ERC20 balances in parallel — skip native ETH entry
  const erc20Entries = Object.values(chainTokens).filter(
    (t) => t.address !== '0x0000000000000000000000000000000000000000'
  )

  const tokenResults = await Promise.allSettled(
    erc20Entries.map(async (token: TokenInfo): Promise<TokenBalance> => {
      const contract = new Contract(token.address, ERC20_BALANCE_ABI, provider)
      const balance = await withTimeout(
        contract.balanceOf(address),
        CHAIN_TIMEOUT_MS,
        `${chainName}/${token.symbol} balanceOf`,
      )
      return {
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        decimals: token.decimals,
        rawBalance: balance.toString(),
        formattedBalance: formatUnits(balance, token.decimals),
        coingeckoId: token.coingeckoId,
      }
    })
  )

  const tokens: TokenBalance[] = tokenResults
    .filter((r): r is PromiseFulfilledResult<TokenBalance> => r.status === 'fulfilled')
    .map((r) => r.value)

  return {
    chain: chainName,
    chainId: config.chainId,
    address,
    nativeBalance,
    tokens,
    timestamp: Date.now(),
  }
}

/**
 * Get all chain names that have token configurations.
 */
export function getSupportedChainNames(): string[] {
  return Object.keys(TOKEN_ADDRESSES)
}

// --- CEX (Binance) Balance Reader ---

export interface CexBalance {
  asset: string
  free: string
  locked: string
  total: string
}

export interface CexBalancesResult {
  exchange: string
  balances: CexBalance[]
  timestamp: number
}

/**
 * Read Binance spot account balances using decrypted API keys from apiKeyStore.
 * Returns only non-zero balances.
 * Uses the same signing approach as BinanceProxy (URLSearchParams for consistent ordering).
 */
export async function readBinanceBalances(): Promise<CexBalancesResult> {
  const apiKey = apiKeyStore.getBinanceApiKey()
  const apiSecret = apiKeyStore.getBinanceApiSecret()

  if (!apiKey || !apiSecret) {
    throw new Error('Binance API credentials not configured')
  }

  // Build params the same way BinanceProxy does
  const params: Record<string, string> = {
    timestamp: Date.now().toString(),
    recvWindow: '10000',
  }

  // Sign using URLSearchParams (consistent key ordering)
  const queryString = new URLSearchParams(params).toString()
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex')
  params.signature = signature

  const isTestnet = apiKeyStore.isBinanceTestnet()
  const baseUrl = isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com'

  let response: any
  try {
    response = await axios.get(`${baseUrl}/api/v3/account`, {
      params,
      headers: { 'X-MBX-APIKEY': apiKey },
      timeout: 10000,
    })
  } catch (err: any) {
    // Log Binance's error response for debugging
    const binanceMsg = err.response?.data?.msg || err.response?.data?.message || err.message
    const binanceCode = err.response?.data?.code
    console.error(`[BalanceReader] Binance API error: code=${binanceCode}, msg=${binanceMsg}`)
    throw new Error(`Binance API: ${binanceMsg} (code: ${binanceCode})`)
  }

  const allBalances: CexBalance[] = (response.data.balances || [])
    .map((b: { asset: string; free: string; locked: string }) => {
      const free = parseFloat(b.free)
      const locked = parseFloat(b.locked)
      return {
        asset: b.asset,
        free: b.free,
        locked: b.locked,
        total: (free + locked).toString(),
      }
    })
    .filter((b: CexBalance) => parseFloat(b.total) > 0)

  return {
    exchange: 'binance',
    balances: allBalances,
    timestamp: Date.now(),
  }
}

/**
 * Check if Binance API credentials are configured.
 */
export function hasBinanceCredentials(): boolean {
  try {
    const apiKey = apiKeyStore.getBinanceApiKey()
    const apiSecret = apiKeyStore.getBinanceApiSecret()
    return !!(apiKey && apiSecret)
  } catch {
    return false
  }
}
