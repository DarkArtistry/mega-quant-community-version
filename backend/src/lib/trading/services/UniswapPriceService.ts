/**
 * Uniswap On-Chain Price Service
 * Queries Uniswap V3 and V4 quoter contracts for real DEX spot prices.
 * Supports Ethereum and Base mainnets.
 */

import { Contract, JsonRpcProvider, parseUnits, formatUnits, AbiCoder, solidityPacked } from 'ethers'
import { UNISWAP_V3_QUOTER_ABI } from '../abis/uniswapV3Quoter.js'
import { UNISWAP_V3_QUOTER_V2_ABI } from '../abis/uniswapV3QuoterV2.js'
import { UNISWAP_V4_QUOTER_ABI } from '../abis/uniswapV4Quoter.js'
import { getChainConfig } from '../config/chains.js'
import { getTokenInfo } from '../config/tokens.js'

export interface DexPriceResult {
  source: string           // 'uniswap-v3' | 'uniswap-v4'
  price: number            // USD price derived from quote (post-fee)
  network: string          // 'Ethereum' | 'Base'
  chainId: number          // 1 | 8453
  feeTier: number          // 3000 = 0.3%
  gasEstimateGwei?: number // Gas units estimate for the swap
  gasPriceGwei?: number    // Current network gas price in gwei
  path?: string[]          // e.g. ['LINK', 'WETH', 'USDC'] for multi-hop
  timestamp: number
}

// Map display symbols to the ERC-20 token used on-chain for quoting
const SYMBOL_TO_QUOTE_TOKEN: Record<string, string> = {
  'ETH': 'WETH',
  'WETH': 'WETH',
  'WBTC': 'WBTC',
  'LINK': 'LINK',
  'UNI': 'UNI',
  'AAVE': 'AAVE',
  'SHIB': 'SHIB',
  'MNT': 'MNT',
  'WLD': 'WLD',
  'STETH': 'STETH',
  // Note: BTC is NOT mapped here — native BTC doesn't exist on Ethereum DEXes.
  // WBTC is its own distinct asset with its own ticker.
  // Note: DOT deliberately excluded — no DEX quoting (wrapped ERC-20 has no Uniswap liquidity).
}

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI'])

const MAINNET_CHAINS = ['ethereum', 'base', 'unichain'] as const

const NETWORK_DISPLAY_NAMES: Record<string, string> = {
  'ethereum': 'Ethereum',
  'base': 'Base',
  'unichain': 'Unichain',
}

const DEFAULT_FEE_TIER = 3000
const V4_TICK_SPACING = 60
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Fee tier for TOKEN→WETH leg in multi-hop. Override only where primary pool differs from 3000.
const TOKEN_WETH_FEE_TIER: Record<string, number> = {
  'WLD':   10000,  // WLD/WETH 1% pool ($7.7M TVL)
}

// Minimal ABI to convert stETH amount → wstETH amount on-chain
const WSTETH_ABI = [
  {
    inputs: [{ name: '_stETHAmount', type: 'uint256' }],
    name: 'getWstETHByStETH',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

// Fee tier for WETH→stablecoin leg. 500 (0.05%) WETH/USDC is deepest on Ethereum.
const WETH_STABLE_FEE_TIER = 500

// Tokens with no meaningful direct stablecoin liquidity — always route via WETH multi-hop.
// Direct pools exist but are tiny/illiquid and return garbage prices.
const WETH_ROUTE_TOKENS = new Set(['STETH', 'SHIB', 'MNT', 'WLD', 'AAVE', 'LINK', 'UNI'])

/**
 * Encode a V3 multi-hop swap path: TOKEN → fee → WETH → fee → STABLE
 */
function encodeV3Path(tokenAddr: string, tokenWethFee: number, wethAddr: string, wethStableFee: number, stableAddr: string): string {
  return solidityPacked(
    ['address', 'uint24', 'address', 'uint24', 'address'],
    [tokenAddr, tokenWethFee, wethAddr, wethStableFee, stableAddr]
  )
}

export class UniswapPriceService {
  private providerCache: Map<string, JsonRpcProvider> = new Map()

  /**
   * Get or create a cached JsonRpcProvider for a chain.
   * Uses staticNetwork to skip the network detection RPC call that causes retry spam.
   */
  private getProvider(chainName: string): JsonRpcProvider {
    const cached = this.providerCache.get(chainName)
    if (cached) return cached

    const chainConfig = getChainConfig(chainName)
    const provider = new JsonRpcProvider(chainConfig.rpcUrl, chainConfig.chainId, { staticNetwork: true })
    this.providerCache.set(chainName, provider)
    return provider
  }

  /**
   * Get V3 spot price by quoting 1 TOKEN → quoteAsset via the on-chain quoter.
   */
  async getV3Price(symbol: string, chainName: string, quoteAsset: string = 'USDC'): Promise<DexPriceResult | null> {
    const quoteToken = SYMBOL_TO_QUOTE_TOKEN[symbol]
    if (!quoteToken) return null

    try {
      const chainConfig = getChainConfig(chainName)
      if (!chainConfig.uniswapV3) return null

      const tokenInfo = getTokenInfo(chainName, quoteToken)
      const usdcInfo = getTokenInfo(chainName, quoteAsset)

      const provider = this.getProvider(chainName)
      const useV2 = chainConfig.uniswapV3.quoterVersion === 2
      const quoterContract = new Contract(
        chainConfig.uniswapV3.quoter,
        useV2 ? UNISWAP_V3_QUOTER_V2_ABI : UNISWAP_V3_QUOTER_ABI,
        provider
      )

      const amountIn = parseUnits('1', tokenInfo.decimals)

      let amountOut: bigint
      let gasEstimate: bigint | undefined

      if (useV2) {
        // QuoterV2 takes a struct param and returns (amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate)
        const result = await quoterContract.quoteExactInputSingle.staticCall({
          tokenIn: tokenInfo.address,
          tokenOut: usdcInfo.address,
          amountIn,
          fee: DEFAULT_FEE_TIER,
          sqrtPriceLimitX96: 0,
        })
        amountOut = result[0]
        gasEstimate = result[3] // 4th output is gasEstimate
      } else {
        // Original Quoter V1 — positional args, returns only amountOut
        amountOut = await quoterContract.quoteExactInputSingle.staticCall(
          tokenInfo.address,
          usdcInfo.address,
          DEFAULT_FEE_TIER,
          amountIn,
          0 // sqrtPriceLimitX96 = 0 means no limit
        )
      }

      const price = parseFloat(formatUnits(amountOut, usdcInfo.decimals))

      // Sanity: no single token unit is worth > $1T — reject garbage values
      if (price <= 0 || price > 1e12) return null

      return {
        source: 'uniswap-v3',
        price,
        network: NETWORK_DISPLAY_NAMES[chainName] || chainName,
        chainId: chainConfig.chainId,
        feeTier: DEFAULT_FEE_TIER,
        gasEstimateGwei: gasEstimate ? Number(gasEstimate) : undefined,
        timestamp: Date.now(),
      }
    } catch (error: any) {
      console.warn(`[UniswapPriceService] V3 quote failed for ${symbol} on ${chainName}:`, error.message)
      return null
    }
  }

  /**
   * Get V3 multi-hop price: TOKEN → WETH → quoteAsset.
   * Used as fallback when token has no direct stablecoin pool.
   */
  async getV3MultiHopPrice(symbol: string, chainName: string, quoteAsset: string = 'USDC'): Promise<DexPriceResult | null> {
    const quoteToken = SYMBOL_TO_QUOTE_TOKEN[symbol]
    if (!quoteToken) return null

    // Skip if token IS WETH — direct quote already works
    if (quoteToken === 'WETH') return null

    // Verify all three tokens (token, WETH, stablecoin) exist on this chain before making RPC calls
    let tokenInfo: ReturnType<typeof getTokenInfo>
    let wethInfo: ReturnType<typeof getTokenInfo>
    let stableInfo: ReturnType<typeof getTokenInfo>
    try {
      tokenInfo = getTokenInfo(chainName, quoteToken)
      wethInfo = getTokenInfo(chainName, 'WETH')
      stableInfo = getTokenInfo(chainName, quoteAsset)
    } catch {
      return null // Token, WETH, or stablecoin not available on this chain
    }

    try {
      const chainConfig = getChainConfig(chainName)
      if (!chainConfig.uniswapV3) return null

      // Multi-hop requires QuoterV2 (quoteExactInput)
      if (chainConfig.uniswapV3.quoterVersion !== 2) return null

      const provider = this.getProvider(chainName)
      const quoterContract = new Contract(
        chainConfig.uniswapV3.quoter,
        UNISWAP_V3_QUOTER_V2_ABI,
        provider
      )

      // STETH special-case: stETH is a rebasing token with no V3 pool.
      // Route via wstETH: convert 1 stETH → wstETH on-chain, then quote wstETH→WETH→USDC.
      if (symbol === 'STETH') {
        let wstethInfo: ReturnType<typeof getTokenInfo>
        try {
          wstethInfo = getTokenInfo(chainName, 'WSTETH')
        } catch {
          return null // wstETH not registered on this chain
        }

        const wstethContract = new Contract(wstethInfo.address, WSTETH_ABI, provider)
        const wstethAmount: bigint = await wstethContract.getWstETHByStETH(parseUnits('1', 18))

        const wstethWethFee = 500  // wstETH/WETH 0.05% pool (deepest liquidity)
        const path = encodeV3Path(wstethInfo.address, wstethWethFee, wethInfo.address, WETH_STABLE_FEE_TIER, stableInfo.address)

        const result = await quoterContract.quoteExactInput.staticCall(path, wstethAmount)
        const amountOut: bigint = result[0]
        const gasEstimate: bigint = result[3]

        const price = parseFloat(formatUnits(amountOut, stableInfo.decimals))
        if (price <= 0 || price > 1e12) return null

        return {
          source: 'uniswap-v3',
          price,
          network: NETWORK_DISPLAY_NAMES[chainName] || chainName,
          chainId: chainConfig.chainId,
          feeTier: wstethWethFee,
          gasEstimateGwei: gasEstimate ? Number(gasEstimate) : undefined,
          path: ['STETH', 'wstETH', 'WETH', quoteAsset],
          timestamp: Date.now(),
        }
      }

      const tokenWethFee = TOKEN_WETH_FEE_TIER[symbol] ?? DEFAULT_FEE_TIER
      const path = encodeV3Path(tokenInfo.address, tokenWethFee, wethInfo.address, WETH_STABLE_FEE_TIER, stableInfo.address)

      const amountIn = parseUnits('1', tokenInfo.decimals)
      const result = await quoterContract.quoteExactInput.staticCall(path, amountIn)
      const amountOut: bigint = result[0]
      const gasEstimate: bigint = result[3]

      const price = parseFloat(formatUnits(amountOut, stableInfo.decimals))

      // Sanity: no single token unit is worth > $1T — reject garbage values
      if (price <= 0 || price > 1e12) return null

      return {
        source: 'uniswap-v3',
        price,
        network: NETWORK_DISPLAY_NAMES[chainName] || chainName,
        chainId: chainConfig.chainId,
        feeTier: tokenWethFee,
        gasEstimateGwei: gasEstimate ? Number(gasEstimate) : undefined,
        path: [symbol, 'WETH', quoteAsset],
        timestamp: Date.now(),
      }
    } catch (error: any) {
      // Expected for tokens without WETH pairs on this chain — log at debug level
      console.debug(`[UniswapPriceService] V3 multi-hop quote failed for ${symbol} on ${chainName}:`, error.message)
      return null
    }
  }

  /**
   * Get V4 spot price via the on-chain quoter.
   * V4 quoter may intentionally revert with output data — we decode it.
   */
  async getV4Price(symbol: string, chainName: string, quoteAsset: string = 'USDC'): Promise<DexPriceResult | null> {
    const quoteToken = SYMBOL_TO_QUOTE_TOKEN[symbol]
    if (!quoteToken) return null

    try {
      const chainConfig = getChainConfig(chainName)
      if (!chainConfig.uniswapV4) return null

      const tokenInfo = getTokenInfo(chainName, quoteToken)
      const usdcInfo = getTokenInfo(chainName, quoteAsset)

      const provider = this.getProvider(chainName)
      const quoterContract = new Contract(
        chainConfig.uniswapV4.quoter,
        UNISWAP_V4_QUOTER_ABI,
        provider
      )

      // V4 pool keys require sorted addresses: currency0 < currency1
      const tokenAddr = tokenInfo.address
      const usdcAddr = usdcInfo.address
      const [currency0, currency1] = tokenAddr.toLowerCase() < usdcAddr.toLowerCase()
        ? [tokenAddr, usdcAddr]
        : [usdcAddr, tokenAddr]

      // zeroForOne: true if we're selling currency0 for currency1
      // We're selling the token (WETH) to get USDC
      const zeroForOne = tokenAddr.toLowerCase() === currency0.toLowerCase()

      const amountIn = parseUnits('1', tokenInfo.decimals)

      const params = {
        poolKey: {
          currency0,
          currency1,
          fee: DEFAULT_FEE_TIER,
          tickSpacing: V4_TICK_SPACING,
          hooks: ZERO_ADDRESS,
        },
        zeroForOne,
        exactAmount: amountIn,
        hookData: '0x',
      }

      let amountOut: bigint
      let gasEstimate: bigint | undefined

      try {
        // Try normal staticCall first
        const result = await quoterContract.quoteExactInputSingle.staticCall(params)
        amountOut = result[0]
        gasEstimate = result[1]
      } catch (revertError: any) {
        // V4 quoter intentionally reverts with encoded output data.
        // Valid quote result is exactly 64 bytes (two uint256) → hex string length 130 ('0x' + 128).
        // Shorter/longer data is a contract error (e.g. PoolNotInitialized), not a quote result.
        const revertData = revertError.data
        if (!revertData || revertData === '0x') throw revertError
        if (typeof revertData === 'string' && revertData.length !== 130) throw revertError

        const abiCoder = AbiCoder.defaultAbiCoder()
        const decoded = abiCoder.decode(['uint256', 'uint256'], revertData)
        amountOut = decoded[0]
        gasEstimate = decoded[1]
      }

      const price = parseFloat(formatUnits(amountOut, usdcInfo.decimals))

      // Sanity: no single token unit is worth > $1T — reject garbage values
      if (price <= 0 || price > 1e12) return null

      return {
        source: 'uniswap-v4',
        price,
        network: NETWORK_DISPLAY_NAMES[chainName] || chainName,
        chainId: chainConfig.chainId,
        feeTier: DEFAULT_FEE_TIER,
        gasEstimateGwei: gasEstimate ? Number(gasEstimate) : undefined,
        timestamp: Date.now(),
      }
    } catch (error: any) {
      console.warn(`[UniswapPriceService] V4 quote failed for ${symbol} on ${chainName}:`, error.message)
      return null
    }
  }

  /**
   * Get all available DEX prices for a symbol across V3/V4 and all mainnet chains.
   */
  async getAllPrices(symbol: string, quoteAsset: string = 'USDC'): Promise<DexPriceResult[]> {
    const upperSymbol = symbol.toUpperCase()

    // Skip stablecoins — no meaningful DEX self-quote
    if (STABLECOINS.has(upperSymbol)) return []

    // Skip if no on-chain token mapping
    if (!SYMBOL_TO_QUOTE_TOKEN[upperSymbol]) return []

    const quoteToken = SYMBOL_TO_QUOTE_TOKEN[upperSymbol]
    const promises: Promise<DexPriceResult | null>[] = []
    // Fetch gas prices per chain in parallel with quotes
    const gasPricePromises: Map<string, Promise<number | undefined>> = new Map()

    for (const chain of MAINNET_CHAINS) {
      // Verify the token and quote asset exist on this chain before querying
      try {
        getTokenInfo(chain, quoteToken)
        getTokenInfo(chain, quoteAsset)
      } catch {
        continue // Token or quote asset not available on this chain
      }

      // V3: tokens with no direct stablecoin liquidity go straight to multi-hop;
      // others try direct first, then fall back to multi-hop via WETH.
      if (WETH_ROUTE_TOKENS.has(upperSymbol)) {
        promises.push(this.getV3MultiHopPrice(upperSymbol, chain, quoteAsset))
      } else {
        promises.push(
          this.getV3Price(upperSymbol, chain, quoteAsset).then(result =>
            result ?? this.getV3MultiHopPrice(upperSymbol, chain, quoteAsset)
          )
        )
      }
      promises.push(this.getV4Price(upperSymbol, chain, quoteAsset))

      // Fetch gas price for this chain (once per chain)
      if (!gasPricePromises.has(chain)) {
        gasPricePromises.set(chain, this.getGasPriceGwei(chain))
      }
    }

    const [settled, ...gasPriceResults] = await Promise.all([
      Promise.allSettled(promises),
      ...Array.from(gasPricePromises.entries()).map(async ([chain, p]) => ({ chain, gwei: await p })),
    ])

    // Build chain → gasPrice map
    const gasPriceMap = new Map<string, number>()
    for (const gp of gasPriceResults) {
      if (gp.gwei != null) gasPriceMap.set(gp.chain, gp.gwei)
    }

    const results: DexPriceResult[] = []

    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value) {
        const r = result.value
        // Attach gas price from the network
        const networkKey = Object.entries(NETWORK_DISPLAY_NAMES).find(([, v]) => v === r.network)?.[0]
        if (networkKey && gasPriceMap.has(networkKey)) {
          r.gasPriceGwei = gasPriceMap.get(networkKey)
        }
        results.push(r)
      }
    }

    return results
  }

  /**
   * Fetch current gas price in gwei for a chain.
   */
  private async getGasPriceGwei(chainName: string): Promise<number | undefined> {
    try {
      const provider = this.getProvider(chainName)
      const feeData = await provider.getFeeData()
      if (feeData.gasPrice) {
        // Convert from wei to gwei
        return Number(feeData.gasPrice) / 1e9
      }
    } catch (error: any) {
      console.warn(`[UniswapPriceService] Failed to fetch gas price for ${chainName}:`, error.message)
    }
    return undefined
  }
}

export const uniswapPriceService = new UniswapPriceService()
