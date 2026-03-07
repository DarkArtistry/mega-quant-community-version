// Uniswap V4 Protocol Implementation
// Ported from reference with slippage tracking, PnL integration,
// limit order support via MegaQuantRouter, and volatility fee reading

import { Contract, parseUnits, formatUnits, MaxUint256, AbiCoder, ZeroAddress, solidityPacked, keccak256 } from 'ethers'
import { ProtocolProxy, SwapParams, SwapResult, QuoteParams, QuoteResult } from '../ProtocolProxy.js'
import { UNISWAP_V4_POOL_MANAGER_ABI } from '../abis/uniswapV4PoolManager.js'
import { UNISWAP_V4_STATE_VIEW_ABI } from '../abis/uniswapV4StateView.js'
import { UNISWAP_V4_QUOTER_ABI } from '../abis/uniswapV4Quoter.js'
import { UNISWAP_V4_UNIVERSAL_ROUTER_ABI, UNIVERSAL_ROUTER_COMMANDS, V4_ACTIONS } from '../abis/uniswapV4UniversalRouter.js'
import { ERC20_ABI } from '../abis/erc20.js'
import { PERMIT2_ABI, PERMIT2_ADDRESS } from '../abis/permit2.js'
import { UNISWAP_V4_POSITION_MANAGER_ABI, POSITION_MANAGER_ACTIONS } from '../abis/uniswapV4PositionManager.js'
import { getTokenInfo } from '../config/tokens.js'
import { getChainConfig } from '../config/chains.js'
import type { Wallet } from 'ethers'

export interface PoolKey {
  currency0: string
  currency1: string
  fee: number
  tickSpacing: number
  hooks: string
}

export interface V4SwapParams extends SwapParams {
  poolKey?: PoolKey      // Optional: Override default pool key
  fee?: number           // Optional: Custom fee tier (e.g., 500, 3000, 10000)
  tickSpacing?: number   // Optional: Custom tick spacing (must match fee tier)
  hookData?: string      // Optional: Custom data to pass to hooks (hex string)
}

export interface LimitOrderParams {
  tokenIn: string
  tokenOut: string
  amountIn: string
  targetPrice: string    // Price at which order should fill
  tick: number           // Tick at which to place the limit order
  deadline?: number      // Seconds from now until order expires
  hookData?: string      // Optional hook data for MegaQuantRouter
}

export interface LimitOrderResult {
  success: boolean
  orderId: string
  txHash: string
  tick: number
  amountIn: string
  targetPrice: string
  deadline: number
}

export interface StopOrderParams {
  tokenIn: string
  tokenOut: string
  amountIn: string
  tick: number
  deadline?: number      // Seconds from now (0 = no expiry)
}

export interface StopOrderResult {
  success: boolean
  orderId: string
  txHash: string
  tick: number
  amountIn: string
  deadline: number
}

export interface BracketOrderParams {
  tokenIn: string
  tokenOut: string
  amountIn: string       // Amount per side
  limitTick: number      // Take-profit tick
  stopTick: number       // Stop-loss tick
  deadline?: number      // Seconds from now
}

export interface BracketOrderResult {
  success: boolean
  limitOrderId: string
  stopOrderId: string
  txHash: string
  limitTick: number
  stopTick: number
  amountIn: string
  deadline: number
}

export interface HookOrder {
  id: string
  orderType: 'limit' | 'stop'
  side: string
  tokenIn: string
  tokenOut: string
  amountIn: string
  tick: number
  status: 'pending' | 'filled' | 'cancelled' | 'expired'
  hookOrderId: string
  linkedOrderId?: string
  createdAt: string
}

export interface PoolInfo {
  poolId: string
  currentTick: number
  sqrtPriceX96: string
  liquidity: string
  fee: number
  feePercentage: string
}

export interface RegistryPool {
  poolId: string
  token0: string
  token1: string
  tickSpacing: number
  creator: string
  name: string
  active: boolean
}

export interface TwapParams {
  tokenIn: string
  tokenOut: string
  totalAmount: string
  durationMs: number
  numSlices: number
  maxSlippage?: number   // bps, default 50 = 0.5%
}

export interface TwapResult {
  twapId: string
  status: 'active'
  slicesTotal: number
  intervalMs: number
  estimatedEndAt: string
}

export interface TwapStatus {
  twapId: string
  status: 'active' | 'completed' | 'cancelled' | 'failed'
  slicesTotal: number
  slicesExecuted: number
  slicesFailed: number
  totalAmountIn: string
  totalAmountOut: string
  averagePrice: string
  startedAt: string
  estimatedEndAt: string
  lastSliceAt?: string
}

export interface BatchSwapLeg {
  tokenIn: string
  tokenOut: string
  amountIn: string
  fee?: number
  tickSpacing?: number
  hookAddress?: string
  hookData?: string
}

export interface BatchSwapResult {
  amountIn: string
  tokenIn: string
  tokenOut: string
  success: boolean
}

export interface AddLiquidityParams {
  tokenA: string       // Token symbol (e.g. 'USDC')
  tokenB: string       // Token symbol (e.g. 'WETH')
  amount0: string      // Amount of sorted currency0
  amount1: string      // Amount of sorted currency1
  tickLower?: number   // Lower tick (default: full range)
  tickUpper?: number   // Upper tick (default: full range)
  slippage?: number    // Slippage tolerance in bps (default: 500 = 5%)
}

export interface AddLiquidityResult {
  success: boolean
  txHash: string
  tokenId?: string
  amount0: string
  amount1: string
  liquidity: string
  explorerUrl: string
}

// Pool key tuple component used across ABIs
const POOL_KEY_COMPONENTS = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' }
] as const

const POOL_KEY_TUPLE = {
  components: POOL_KEY_COMPONENTS,
  name: 'key',
  type: 'tuple'
} as const

const SWAP_PARAMS_TUPLE = {
  components: [
    { name: 'zeroForOne', type: 'bool' },
    { name: 'amountSpecified', type: 'int256' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' }
  ],
  name: 'params',
  type: 'tuple'
} as const

// MegaQuantRouter ABI — matches MegaQuantRouter.sol
const MEGA_QUANT_ROUTER_ABI = [
  {
    inputs: [
      POOL_KEY_TUPLE,
      { name: 'tick', type: 'int24' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'deadline', type: 'uint64' },
      { name: 'hookData', type: 'bytes' }
    ],
    name: 'placeLimitOrder',
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      POOL_KEY_TUPLE,
      { name: 'tick', type: 'int24' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'deadline', type: 'uint64' },
      { name: 'hookData', type: 'bytes' }
    ],
    name: 'placeStopOrder',
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      POOL_KEY_TUPLE,
      { name: 'limitTick', type: 'int24' },
      { name: 'stopTick', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'deadline', type: 'uint64' }
    ],
    name: 'placeBracketOrder',
    outputs: [
      { name: 'actualLimitTick', type: 'int24' },
      { name: 'actualStopTick', type: 'int24' }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      POOL_KEY_TUPLE,
      SWAP_PARAMS_TUPLE,
      { name: 'hookData', type: 'bytes' }
    ],
    name: 'swap',
    outputs: [{ name: 'delta', type: 'int256' }],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      { components: POOL_KEY_COMPONENTS, name: 'keys', type: 'tuple[]' },
      { components: SWAP_PARAMS_TUPLE.components, name: 'paramsArray', type: 'tuple[]' },
      { name: 'hookDataArray', type: 'bytes[]' }
    ],
    name: 'batchSwap',
    outputs: [{ name: 'deltas', type: 'int256[]' }],
    stateMutability: 'payable',
    type: 'function'
  }
] as const

// MegaQuantHook ABI — matches MegaQuantHook.sol
const MEGA_QUANT_HOOK_ABI = [
  {
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    name: 'getPoolFee',
    outputs: [{ name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      POOL_KEY_TUPLE,
      { name: 'tickToSellAt', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' }
    ],
    name: 'cancelOrder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      POOL_KEY_TUPLE,
      { name: 'tickToSellAt', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' }
    ],
    name: 'cancelStopOrder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      POOL_KEY_TUPLE,
      { name: 'tickToSellAt', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'inputAmountToClaimFor', type: 'uint256' }
    ],
    name: 'redeem',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      POOL_KEY_TUPLE,
      { name: 'tick', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' }
    ],
    name: 'getOrderId',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'pure',
    type: 'function'
  },
  {
    inputs: [
      POOL_KEY_TUPLE,
      { name: 'tick', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' }
    ],
    name: 'getStopOrderId',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'pure',
    type: 'function'
  },
  {
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'tick', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' }
    ],
    name: 'pendingOrders',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'tick', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' }
    ],
    name: 'pendingStopOrders',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'orderId', type: 'uint256' }],
    name: 'bracketPartner',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' }
    ],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    name: 'getVolatilityState',
    outputs: [
      { name: 'lastTick', type: 'int24' },
      { name: 'lastTimestamp', type: 'uint256' },
      { name: 'ewmaVariance', type: 'uint256' },
      { name: 'observationCount', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const

// PoolRegistry ABI — matches PoolRegistry.sol
const POOL_REGISTRY_ABI = [
  {
    inputs: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'name', type: 'string' }
    ],
    name: 'createPool',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'poolCount',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'pools',
    outputs: [
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'creator', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'active', type: 'bool' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' }
    ],
    name: 'getPoolsForPair',
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' }
    ],
    name: 'getPoolIds',
    outputs: [{ name: '', type: 'bytes32[]' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

export class UniswapV4Protocol extends ProtocolProxy {
  // Standard fee tiers for V4 pools (hardcoded for easy access)
  public readonly FEE_TIERS = [
    { fee: 500, tickSpacing: 10, name: '0.05%' },
    { fee: 3000, tickSpacing: 60, name: '0.3%' },
    { fee: 10000, tickSpacing: 200, name: '1%' }
  ]

  private poolManagerContract: Contract
  private stateViewContract: Contract
  private quoterContract: Contract
  private universalRouterContract: Contract
  private permit2Contract: Contract
  private positionManagerContract: Contract
  private readonly DEFAULT_FEE = 3000 // 0.3% fee tier
  private readonly DEFAULT_TICK_SPACING = 10 // Realistic USDC/WETH pool tick spacing
  private readonly NO_HOOKS = ZeroAddress // No hooks by default
  private readonly DYNAMIC_FEE_FLAG = 0x800000 // Flag for dynamic fee pools

  // MegaQuant hook/router/registry (from chain config)
  private megaQuantHookAddress?: string
  private megaQuantRouterAddress?: string
  private poolRegistryAddress?: string
  private megaQuantHookContract?: Contract
  private megaQuantRouterContract?: Contract
  private poolRegistryContract?: Contract

  constructor(
    chainName: string,
    chainId: number,
    wallet: Wallet,
    executionId: string,
    strategyId: string,
    accountId?: string
  ) {
    super(chainName, chainId, wallet, 'uniswap-v4', executionId, strategyId, accountId)

    const chainConfig = getChainConfig(chainName)
    if (!chainConfig.uniswapV4) {
      throw new Error(`Uniswap V4 not supported on chain ${chainName}`)
    }

    this.poolManagerContract = new Contract(
      chainConfig.uniswapV4.poolManager,
      UNISWAP_V4_POOL_MANAGER_ABI,
      wallet
    )

    this.stateViewContract = new Contract(
      chainConfig.uniswapV4.stateView,
      UNISWAP_V4_STATE_VIEW_ABI,
      wallet.provider!
    )

    // Quoter for getting swap quotes
    this.quoterContract = new Contract(
      chainConfig.uniswapV4.quoter,
      UNISWAP_V4_QUOTER_ABI,
      wallet
    )

    // Universal Router (pre-deployed, no custom deployment needed!)
    this.universalRouterContract = new Contract(
      chainConfig.uniswapV4.universalRouter,
      UNISWAP_V4_UNIVERSAL_ROUTER_ABI,
      wallet
    )

    // Permit2 (same address on all chains)
    this.permit2Contract = new Contract(
      PERMIT2_ADDRESS,
      PERMIT2_ABI,
      wallet
    )

    // Position Manager for adding liquidity
    this.positionManagerContract = new Contract(
      chainConfig.uniswapV4.positionManager,
      UNISWAP_V4_POSITION_MANAGER_ABI,
      wallet
    )

    // MegaQuant hook infrastructure (optional — only on chains where deployed)
    const v4Config = chainConfig.uniswapV4
    if (v4Config.megaQuantHook && v4Config.megaQuantHook !== ZeroAddress) {
      this.megaQuantHookAddress = v4Config.megaQuantHook
      this.megaQuantHookContract = new Contract(v4Config.megaQuantHook, MEGA_QUANT_HOOK_ABI, wallet.provider!)
    }
    if (v4Config.megaQuantRouter && v4Config.megaQuantRouter !== ZeroAddress) {
      this.megaQuantRouterAddress = v4Config.megaQuantRouter
      this.megaQuantRouterContract = new Contract(v4Config.megaQuantRouter, MEGA_QUANT_ROUTER_ABI, wallet)
    }
    if (v4Config.poolRegistry && v4Config.poolRegistry !== ZeroAddress) {
      this.poolRegistryAddress = v4Config.poolRegistry
      this.poolRegistryContract = new Contract(v4Config.poolRegistry, POOL_REGISTRY_ABI, wallet.provider!)
    }

    console.log(`[UniswapV4] Initialized on ${chainName}`)
    console.log(`[UniswapV4] PoolManager: ${chainConfig.uniswapV4.poolManager}`)
    console.log(`[UniswapV4] Quoter: ${chainConfig.uniswapV4.quoter}`)
    console.log(`[UniswapV4] StateView: ${chainConfig.uniswapV4.stateView}`)
    console.log(`[UniswapV4] UniversalRouter: ${chainConfig.uniswapV4.universalRouter}`)
    console.log(`[UniswapV4] Permit2: ${PERMIT2_ADDRESS}`)
    if (this.megaQuantHookAddress) console.log(`[UniswapV4] MegaQuantHook: ${this.megaQuantHookAddress}`)
    if (this.megaQuantRouterAddress) console.log(`[UniswapV4] MegaQuantRouter: ${this.megaQuantRouterAddress}`)
    if (this.poolRegistryAddress) console.log(`[UniswapV4] PoolRegistry: ${this.poolRegistryAddress}`)
  }

  /**
   * Execute a swap on Uniswap V4
   * Enhanced with slippage tracking between quote and actual execution
   * @param params Swap parameters with optional hooks support
   * @returns Swap result with transaction details and slippage data
   */
  async swap(params: V4SwapParams): Promise<SwapResult> {
    console.log(`[UniswapV4] Swap on ${this.chainName}: ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut}`)
    console.log(`[UniswapV4] Initiating swap on ${this.chainName}:`, params)

    const startTime = Date.now()
    let txHash = ''
    let blockNumber = 0
    let gasUsedNum = 0
    let gasCostUsd = 0
    let gasPrice = 0n

    try {
      // 1. Get token information
      const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

      console.log(`[UniswapV4] Token In: ${tokenInInfo.symbol} (${tokenInInfo.address})`)
      console.log(`[UniswapV4] Token Out: ${tokenOutInfo.symbol} (${tokenOutInfo.address})`)

      // 2. Parse amount with correct decimals
      const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)
      console.log(`[UniswapV4] Amount In: ${amountIn.toString()} (${params.amountIn} ${tokenInInfo.symbol})`)

      // 3. Create PoolKey (currencies must be sorted)
      let poolKey: PoolKey
      if (params.poolKey) {
        poolKey = params.poolKey
      } else if (!params.fee && !params.tickSpacing && !params.hookData && this.megaQuantHookAddress) {
        poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)
      } else {
        poolKey = this.createCustomPoolKey(
          tokenInInfo.address,
          tokenOutInfo.address,
          params.fee || this.DEFAULT_FEE,
          params.tickSpacing || this.DEFAULT_TICK_SPACING,
          params.hookData ? params.hookData : this.NO_HOOKS
        )
      }

      console.log(`[UniswapV4] Pool Key:`, poolKey)

      // 4. Get quote for expected output (using same fee/tickSpacing)
      const quote = await this.getQuote({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        fee: params.fee,
        tickSpacing: params.tickSpacing
      })

      const amountOutQuote = parseUnits(quote.amountOut, tokenOutInfo.decimals)
      const expectedOutputFormatted = quote.amountOut
      console.log(`[UniswapV4] Expected output: ${expectedOutputFormatted} ${tokenOutInfo.symbol}`)

      // 5. Calculate minimum amount out with slippage
      const slippage = params.slippage || 0.5 // default 0.5%
      const slippageMultiplier = (100 - slippage) / 100
      const amountOutMinimum = (amountOutQuote * BigInt(Math.floor(slippageMultiplier * 10000))) / BigInt(10000)
      console.log(`[UniswapV4] Minimum output (${slippage}% slippage): ${formatUnits(amountOutMinimum, tokenOutInfo.decimals)} ${tokenOutInfo.symbol}`)

      // 6. Determine swap direction
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)
      const isNativeEth = tokenInInfo.address === '0x0000000000000000000000000000000000000000'

      // 6b. USE MegaQuantRouter for hook pools (it handles settlement correctly)
      if (this.megaQuantRouterContract && this.megaQuantHookAddress && poolKey.hooks !== this.NO_HOOKS) {
        console.log(`[UniswapV4] Using MegaQuantRouter for hook pool swap`)

        // Approve MegaQuantRouter directly (not via Permit2)
        if (!isNativeEth) {
          await this.approveTokenForAddress(tokenInInfo.address, amountIn, this.megaQuantRouterAddress!)
        }

        // SwapParams: { zeroForOne, amountSpecified (negative = exact input), sqrtPriceLimitX96 }
        const sqrtPriceLimitX96 = zeroForOne
          ? BigInt('4295128740')   // TickMath.MIN_SQRT_PRICE + 1
          : BigInt('1461446703485210103287273052203988822378723970341')  // TickMath.MAX_SQRT_PRICE - 1

        const swapParams = {
          zeroForOne,
          amountSpecified: -amountIn, // negative = exact input
          sqrtPriceLimitX96,
        }

        const hookData = params.hookData || '0x'
        const walletAddress = await this.wallet.getAddress()

        // Record balance before swap
        let balanceBefore = 0n
        if (tokenOutInfo.address !== '0x0000000000000000000000000000000000000000') {
          const tokenOutContract = new Contract(tokenOutInfo.address, ERC20_ABI, this.wallet.provider!)
          balanceBefore = await tokenOutContract.balanceOf(walletAddress)
        }

        const swapCallArgs = [
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
          [swapParams.zeroForOne, swapParams.amountSpecified, swapParams.sqrtPriceLimitX96],
          hookData,
        ] as const
        const txOverrides = { ...(isNativeEth ? { value: amountIn } : {}) }

        // Diagnose hook state before swap
        try {
          const hookContract = new Contract(poolKey.hooks, [
            'function lastTicks(bytes32) view returns (int24)',
            'function pendingOrders(bytes32, int24, bool) view returns (uint256)',
            'function pendingStopOrders(bytes32, int24, bool) view returns (uint256)',
          ], this.wallet.provider!)
          const poolId = this.computePoolId(poolKey)
          const lastTick = await hookContract.lastTicks(poolId)
          const slot0 = await this.stateViewContract.getSlot0(poolId)
          const currentTick = slot0[1]
          console.log(`[UniswapV4] Hook state: lastTick=${lastTick}, currentTick=${currentTick}, tickGap=${Math.abs(Number(currentTick) - Number(lastTick))}`)

          // Check a few ticks for pending orders
          for (const tick of [0, -60, 60, -120, 120]) {
            const limitTrue = await hookContract.pendingOrders(poolId, tick, true)
            const limitFalse = await hookContract.pendingOrders(poolId, tick, false)
            const stopTrue = await hookContract.pendingStopOrders(poolId, tick, true)
            const stopFalse = await hookContract.pendingStopOrders(poolId, tick, false)
            if (limitTrue > 0n || limitFalse > 0n || stopTrue > 0n || stopFalse > 0n) {
              console.log(`[UniswapV4] Pending orders at tick ${tick}: limit(z4o=true)=${limitTrue}, limit(z4o=false)=${limitFalse}, stop(z4o=true)=${stopTrue}, stop(z4o=false)=${stopFalse}`)
            }
          }
        } catch (e: any) {
          console.log(`[UniswapV4] Hook state check failed: ${e.message}`)
        }

        // Estimate gas (cap at reasonable limit to avoid exceeding block gas limit)
        let gasLimit = 3000000n  // Default 3M
        try {
          const gasEstimate = await this.megaQuantRouterContract!.swap.estimateGas(
            ...swapCallArgs,
            txOverrides
          )
          console.log(`[UniswapV4] Gas estimate: ${gasEstimate}`)
          // Cap at 10M to avoid exceeding block gas limit
          gasLimit = gasEstimate > 10000000n ? 10000000n : gasEstimate * 130n / 100n
        } catch (estError: any) {
          console.error(`[UniswapV4] Gas estimation failed:`, estError.shortMessage || estError.message)
        }

        console.log(`[UniswapV4] Executing swap via MegaQuantRouter (gasLimit=${gasLimit})...`)
        const tx = await this.megaQuantRouterContract!.swap(
          ...swapCallArgs,
          { ...txOverrides, gasLimit }
        )

        console.log(`[UniswapV4] Transaction submitted: ${tx.hash}`)
        txHash = tx.hash
        const receipt = await tx.wait()
        blockNumber = receipt.blockNumber
        console.log(`[UniswapV4] Transaction confirmed in block ${blockNumber}`)

        // Calculate gas cost
        const gasUsed = receipt.gasUsed
        gasUsedNum = Number(gasUsed)
        gasPrice = receipt.gasPrice || tx.gasPrice || 0n
        const gasCostWei = gasUsed * gasPrice
        const chainConfig = getChainConfig(this.chainName)
        const gasCostEth = Number(formatUnits(gasCostWei, 18))
        const { priceService } = await import('../services/PriceService.js')
        const nativeTokenPrice = await priceService.getTokenPriceUSD(chainConfig.nativeCurrency.symbol)
        gasCostUsd = gasCostEth * nativeTokenPrice

        // Get actual output from balance difference
        let actualOutputFormatted: string
        if (tokenOutInfo.address !== '0x0000000000000000000000000000000000000000') {
          const tokenOutContract = new Contract(tokenOutInfo.address, ERC20_ABI, this.wallet.provider!)
          const balanceAfter = await tokenOutContract.balanceOf(walletAddress)
          const actualDelta = balanceAfter - balanceBefore
          actualOutputFormatted = formatUnits(actualDelta > 0n ? actualDelta : amountOutQuote, tokenOutInfo.decimals)
        } else {
          actualOutputFormatted = expectedOutputFormatted
        }

        // Record trade
        const gasPriceGwei = formatUnits(gasPrice, 'gwei')
        await this.recordTrade({
          tx_hash: txHash,
          block_number: blockNumber,
          token_in_address: tokenInInfo.address,
          token_in_symbol: tokenInInfo.symbol,
          token_in_amount: params.amountIn,
          token_out_address: tokenOutInfo.address,
          token_out_symbol: tokenOutInfo.symbol,
          token_out_amount: actualOutputFormatted,
          gas_used: gasUsedNum,
          gas_price_gwei: gasPriceGwei,
          gas_cost_usd: gasCostUsd,
        })

        return {
          success: true,
          transactionHash: txHash,
          txHash,  // alias for strategy convenience
          blockNumber,
          amountIn: params.amountIn,
          amountOut: actualOutputFormatted,
          gasUsed: gasUsedNum,
          gasCostUsd,
          timestamp: Date.now(),
          explorerUrl: `${chainConfig.blockExplorer}/tx/${txHash}`,
        }
      }

      // 7. Fallback: Approve tokens via Permit2 for Universal Router
      if (!isNativeEth) {
        await this.approveTokenViaPermit2(tokenInInfo.address, amountIn)
      } else {
        console.log(`[UniswapV4] Skipping approval for native ETH`)
      }

      // 8. Prepare hook data (empty bytes if not provided)
      const hookData = params.hookData || '0x'

      // 9. Get wallet address
      const walletAddress = await this.wallet.getAddress()

      // 10. Record balance before swap for accurate slippage tracking
      let balanceBefore = 0n
      if (tokenOutInfo.address !== '0x0000000000000000000000000000000000000000') {
        const tokenOutContract = new Contract(tokenOutInfo.address, ERC20_ABI, this.wallet.provider!)
        balanceBefore = await tokenOutContract.balanceOf(walletAddress)
      }

      // 11. Encode Universal Router V4 swap command
      const abiCoder = AbiCoder.defaultAbiCoder()

      // Step 1: Encode the command (V4_SWAP = 0x10)
      const commands = solidityPacked(['uint8'], [UNIVERSAL_ROUTER_COMMANDS.V4_SWAP])

      // Step 2: Encode the actions (SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL)
      const actions = solidityPacked(
        ['uint8', 'uint8', 'uint8'],
        [V4_ACTIONS.SWAP_EXACT_IN_SINGLE, V4_ACTIONS.SETTLE_ALL, V4_ACTIONS.TAKE_ALL]
      )

      // Step 3: Encode the parameters for each action
      const actionParams = [
        // params[0]: ExactInputSingleParams
        abiCoder.encode(
          ['tuple(address,address,uint24,int24,address)', 'bool', 'uint128', 'uint128', 'bytes'],
          [
            [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
            zeroForOne,
            amountIn,
            amountOutMinimum,
            hookData
          ]
        ),
        // params[1]: SETTLE_ALL params (currency, amount)
        abiCoder.encode(
          ['address', 'uint256'],
          [tokenInInfo.address, amountIn]
        ),
        // params[2]: TAKE_ALL params (currency, minAmount)
        abiCoder.encode(
          ['address', 'uint256'],
          [tokenOutInfo.address, amountOutMinimum]
        )
      ]

      // Step 4: Encode inputs as [actions, params]
      const inputs = [abiCoder.encode(['bytes', 'bytes[]'], [actions, actionParams])]

      // Step 5: Set deadline (20 seconds from now)
      const latestBlock = await this.wallet.provider!.getBlock('latest')
      const deadline = BigInt(latestBlock!.timestamp) + BigInt(20)

      console.log(`[UniswapV4] Executing swap via Universal Router...`)
      console.log(`[UniswapV4] Commands: ${commands}`)
      console.log(`[UniswapV4] Deadline: ${deadline.toString()}`)
      console.log(`[UniswapV4] Universal Router: ${await this.universalRouterContract.getAddress()}`)
      console.log(`[UniswapV4] Pool Key: currency0=${poolKey.currency0}, currency1=${poolKey.currency1}, fee=${poolKey.fee}, tickSpacing=${poolKey.tickSpacing}, hooks=${poolKey.hooks}`)
      console.log(`[UniswapV4] zeroForOne=${zeroForOne}, amountIn=${amountIn}, amountOutMin=${amountOutMinimum}`)

      // Diagnostic: read PoolManager address from the Universal Router
      try {
        const routerAddr = await this.universalRouterContract.getAddress()
        const pmCheckContract = new Contract(routerAddr, [
          'function poolManager() view returns (address)'
        ], this.wallet.provider!)
        const routerPoolManager = await pmCheckContract.poolManager()
        const ourPoolManager = getChainConfig(this.chainName).uniswapV4!.poolManager
        console.log(`[UniswapV4] Router's PoolManager: ${routerPoolManager}`)
        console.log(`[UniswapV4] Our PoolManager:      ${ourPoolManager}`)
        if (routerPoolManager.toLowerCase() !== ourPoolManager.toLowerCase()) {
          console.error(`[UniswapV4] *** POOL MANAGER MISMATCH! ***`)
        }
      } catch (pmErr: any) {
        console.warn(`[UniswapV4] Could not read poolManager from router: ${pmErr.message}`)
      }

      // 12. Execute swap via Universal Router
      const txOptions: Record<string, unknown> = {
        gasLimit: 500000 // V4 swaps can use more gas
      }

      // If swapping native ETH, include value
      if (isNativeEth) {
        txOptions.value = amountIn
        console.log(`[UniswapV4] Sending ${formatUnits(amountIn, 18)} ETH with transaction`)
      }

      // Simulate first using raw provider.call() to get revert data
      try {
        const routerAddr = await this.universalRouterContract.getAddress()
        const walletAddr = await this.wallet.getAddress()
        const txData = this.universalRouterContract.interface.encodeFunctionData(
          'execute(bytes,bytes[],uint256)',
          [commands, inputs, deadline]
        )
        const callResult = await this.wallet.provider!.call({
          to: routerAddr,
          data: txData,
          from: walletAddr,
          ...(isNativeEth ? { value: amountIn } : {}),
        })
        console.log(`[UniswapV4] Simulation passed, result: ${callResult}`)
      } catch (simError: any) {
        console.error(`[UniswapV4] Simulation FAILED:`)
        console.error(`  reason: ${simError.reason}`)
        console.error(`  code: ${simError.code}`)
        // Try multiple paths to find revert data
        const revertData = simError.data
          || simError.info?.error?.data
          || simError.error?.data
          || simError.info?.error?.message
        console.error(`  revert data: ${revertData}`)
        console.error(`  full error keys: ${Object.keys(simError.info || {}).join(', ')}`)
        if (simError.info?.error) {
          console.error(`  info.error: ${JSON.stringify(simError.info.error).substring(0, 1000)}`)
        }
        if (revertData && typeof revertData === 'string' && revertData.startsWith('0x') && revertData.length > 2) {
          const selector = revertData.slice(0, 10)
          console.error(`  Error selector: ${selector}`)
          try {
            const abiCoder = AbiCoder.defaultAbiCoder()
            // ExecutionFailed(uint256 commandIndex, bytes message)
            if (selector === '0x2853d5b0') {
              const decoded = abiCoder.decode(['uint256', 'bytes'], '0x' + revertData.slice(10))
              console.error(`  ExecutionFailed at command ${decoded[0]}, inner revert: ${decoded[1]}`)
            }
            // InvalidEthSender()
            else if (selector === '0xbdeda170') {
              console.error(`  InvalidEthSender - inner call returned empty revert data`)
            }
            // TransactionDeadlinePassed()
            else if (selector === '0xcd21db4f') {
              console.error(`  TransactionDeadlinePassed - deadline was in the past`)
            }
          } catch {}
        }
        throw new Error(`Uniswap V4 swap simulation failed: ${simError.reason || revertData || simError.message}`)
      }

      const tx = await this.universalRouterContract['execute(bytes,bytes[],uint256)'](
        commands,
        inputs,
        deadline,
        txOptions
      )

      console.log(`[UniswapV4] Transaction submitted: ${tx.hash}`)
      txHash = tx.hash

      // Wait for transaction confirmation
      const receipt = await tx.wait()
      blockNumber = receipt.blockNumber

      console.log(`[UniswapV4] Transaction confirmed in block ${blockNumber}`)

      // 13. Fetch block timestamp for accurate PnL time-series
      let blockTimestamp: string | undefined
      try {
        const block = await this.wallet.provider!.getBlock(blockNumber)
        if (block) {
          blockTimestamp = new Date(block.timestamp * 1000).toISOString()
        }
      } catch (error: any) {
        console.warn('[UniswapV4] Could not fetch block timestamp:', error.message)
      }

      // 14. Calculate gas cost
      const gasUsed = receipt.gasUsed
      gasUsedNum = Number(gasUsed)
      gasPrice = receipt.gasPrice || tx.gasPrice || 0n
      const gasCostWei = gasUsed * gasPrice

      const chainConfig = getChainConfig(this.chainName)
      const nativeTokenSymbol = chainConfig.nativeCurrency.symbol
      const { priceService } = await import('../services/PriceService.js')
      const nativeTokenPrice = await priceService.getTokenPriceUSD(nativeTokenSymbol)

      const gasCostEth = Number(formatUnits(gasCostWei, 18))
      gasCostUsd = gasCostEth * nativeTokenPrice

      console.log(`[UniswapV4] Gas used: ${gasUsedNum.toLocaleString()}`)
      console.log(`[UniswapV4] Gas cost: ${gasCostEth.toFixed(6)} ${nativeTokenSymbol} ($${gasCostUsd.toFixed(4)})`)

      // 14. Get actual output amount from balance difference for accurate slippage
      let actualOutputFormatted: string
      if (tokenOutInfo.address !== '0x0000000000000000000000000000000000000000') {
        const tokenOutContract = new Contract(tokenOutInfo.address, ERC20_ABI, this.wallet.provider!)
        const balanceAfter = await tokenOutContract.balanceOf(walletAddress)
        const actualDelta = balanceAfter - balanceBefore
        actualOutputFormatted = formatUnits(actualDelta > 0n ? actualDelta : amountOutQuote, tokenOutInfo.decimals)
      } else {
        // For native ETH output, use quote as approximation
        actualOutputFormatted = expectedOutputFormatted
      }

      // 15. Calculate slippage tracking data
      const slippageData = this.calculateSlippage(
        expectedOutputFormatted,
        actualOutputFormatted,
        params.amountIn
      )

      console.log(`[UniswapV4] Slippage: ${slippageData.slippagePercentage.toFixed(4)}% (${slippageData.slippageAmount} ${tokenOutInfo.symbol})`)
      console.log(`[UniswapV4] Quote price: ${slippageData.quotePrice.toFixed(6)}, Execution price: ${slippageData.executionPrice.toFixed(6)}`)

      console.log(`[UniswapV4] Swap completed successfully!`)
      console.log(`[UniswapV4] Amount in: ${params.amountIn} ${params.tokenIn}`)
      console.log(`[UniswapV4] Amount out: ${actualOutputFormatted} ${params.tokenOut}`)

      // 16. Calculate gas price in Gwei
      const gasPriceGwei = formatUnits(gasPrice, 'gwei')

      // 18. Record trade with slippage data
      await this.recordTrade({
        tx_hash: txHash,
        block_number: blockNumber,
        token_in_address: tokenInInfo.address,
        token_in_symbol: tokenInInfo.symbol,
        token_in_amount: params.amountIn,
        token_out_address: tokenOutInfo.address,
        token_out_symbol: tokenOutInfo.symbol,
        token_out_amount: actualOutputFormatted,
        gas_used: gasUsedNum,
        gas_price_gwei: gasPriceGwei,
        gas_cost_usd: gasCostUsd,
        // Enhanced slippage tracking fields
        expected_output: expectedOutputFormatted,
        slippage_amount: slippageData.slippageAmount,
        slippage_percentage: slippageData.slippagePercentage,
        quote_price: slippageData.quotePrice,
        execution_price: slippageData.executionPrice,
        block_timestamp: blockTimestamp
      })

      // Build explorer URL
      const explorerUrl = `${chainConfig.blockExplorer}/tx/${txHash}`

      return {
        success: true,
        transactionHash: txHash,
        txHash,  // alias for strategy convenience
        blockNumber,
        amountIn: params.amountIn,
        amountOut: actualOutputFormatted,
        gasUsed: gasUsedNum,
        gasCostUsd,
        timestamp: Date.now(),
        explorerUrl,
        // Slippage tracking in result
        expectedOutput: expectedOutputFormatted,
        slippageAmount: slippageData.slippageAmount,
        slippagePercentage: slippageData.slippagePercentage,
        quotePrice: slippageData.quotePrice,
        executionPrice: slippageData.executionPrice
      }
    } catch (error: any) {
      console.error('[UniswapV4] Swap failed:', error)

      // Record failed trade if we have a tx hash
      if (txHash) {
        const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
        const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)
        const gasPriceGwei = gasPrice ? formatUnits(gasPrice, 'gwei') : '0'

        await this.recordTrade({
          tx_hash: txHash,
          block_number: blockNumber,
          token_in_address: tokenInInfo.address,
          token_in_symbol: tokenInInfo.symbol,
          token_in_amount: params.amountIn,
          token_out_address: tokenOutInfo.address,
          token_out_symbol: tokenOutInfo.symbol,
          token_out_amount: '0',
          gas_used: gasUsedNum,
          gas_price_gwei: gasPriceGwei,
          gas_cost_usd: gasCostUsd
        })
      }

      throw new Error(`Uniswap V4 swap failed: ${error.message}`)
    }
  }

  /**
   * Get swap quote without executing the trade
   * @param params Quote parameters
   * @returns Quote information including expected output, price impact, and exchange rate
   */
  async getQuote(params: QuoteParams & { fee?: number; tickSpacing?: number }): Promise<QuoteResult> {
    console.log(`[UniswapV4] Quote on ${this.chainName}: ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut}`)

    // 1. Get token information
    const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
    const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

    // 2. Parse amount with correct decimals
    const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)

    // 3. Create PoolKey with custom fee if provided
    const fee = params.fee || this.DEFAULT_FEE
    const tickSpacing = params.tickSpacing || this.DEFAULT_TICK_SPACING

    let poolKey: PoolKey
    if (!params.fee && !params.tickSpacing && this.megaQuantHookAddress) {
      poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)
    } else {
      poolKey = this.createCustomPoolKey(
        tokenInInfo.address,
        tokenOutInfo.address,
        fee,
        tickSpacing
      )
    }

    // 4. Determine swap direction
    const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

    // 5. Prepare params for Quoter.quoteExactInputSingle
    const quoterParams = {
      poolKey: {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks
      },
      zeroForOne,
      exactAmount: amountIn,
      hookData: '0x'
    }

    // 6. Call Quoter - it INTENTIONALLY REVERTS with the quote in the revert data!
    let amountOutRaw: bigint
    let gasEstimate: bigint

    try {
      // This will always revert - that's the design!
      const result = await this.quoterContract.quoteExactInputSingle.staticCall(quoterParams)
      // If we get here, something is unexpected (shouldn't happen)
      amountOutRaw = result[0]
      gasEstimate = result[1]
    } catch (error: any) {
      // The Quoter ALWAYS reverts - we need to decode the revert data
      if (!error.data) {
        console.error('[UniswapV4] Quote failed: No revert data')
        throw new Error(`Failed to get quote: ${error.message}`)
      }

      // Decode the revert data
      // The revert data is ABI-encoded as: selector(4 bytes) + params
      // For QuoteSwap error: QuoteSwap(uint256,uint256) = selector + amountOut + gasEstimate
      try {
        const abiCoder = AbiCoder.defaultAbiCoder()

        // Remove '0x' prefix and error selector (first 4 bytes = 8 hex chars)
        const dataWithoutSelector = '0x' + error.data.slice(10)

        // Decode as (uint256, uint256) - amountOut and gasEstimate
        const decoded = abiCoder.decode(['uint256', 'uint256'], dataWithoutSelector)
        amountOutRaw = decoded[0]
        gasEstimate = decoded[1]

        console.log(`   Decoded quote: ${amountOutRaw.toString()} (gas: ${gasEstimate.toString()})`)
      } catch (decodeError: any) {
        console.error('[UniswapV4] Failed to decode quote revert data:', decodeError.message)
        console.error('   Error data:', error.data)
        throw new Error(`Pool may not exist or have liquidity for this pair at fee tier ${fee / 10000}%`)
      }
    }

    const amountOut = formatUnits(amountOutRaw, tokenOutInfo.decimals)

    // 7. Calculate minimum output with 0.5% slippage
    const slippage = 0.5
    const slippageMultiplier = (100 - slippage) / 100
    const amountOutMinimum = (amountOutRaw * BigInt(Math.floor(slippageMultiplier * 10000))) / BigInt(10000)
    const amountOutMin = formatUnits(amountOutMinimum, tokenOutInfo.decimals)

    // 8. Calculate exchange rate (tokenOut per tokenIn)
    const exchangeRate = Number(amountOut) / Number(params.amountIn)

    // 9. Calculate price impact
    const { priceService } = await import('../services/PriceService.js')
    const [tokenInPriceUsd, tokenOutPriceUsd] = await Promise.all([
      priceService.getTokenPriceUSD(params.tokenIn),
      priceService.getTokenPriceUSD(params.tokenOut)
    ])

    // Market exchange rate (based on USD prices)
    const marketRate = tokenInPriceUsd / tokenOutPriceUsd

    // Price impact = difference between executed rate and market rate
    const priceImpact = ((marketRate - exchangeRate) / marketRate) * 100

    // 10. Estimate gas cost in USD using the gas estimate from quoter
    let gasCostUsd: number | undefined
    try {
      const feeData = await this.wallet.provider!.getFeeData()
      const currentGasPrice = feeData.gasPrice || 0n

      const gasCostWei = currentGasPrice * gasEstimate!
      const chainConfig = getChainConfig(this.chainName)
      const nativeTokenSymbol = chainConfig.nativeCurrency.symbol
      const nativeTokenPrice = await priceService.getTokenPriceUSD(nativeTokenSymbol)

      const gasCostEth = Number(formatUnits(gasCostWei, 18))
      gasCostUsd = gasCostEth * nativeTokenPrice
    } catch (error: any) {
      console.warn('[UniswapV4] Could not estimate gas cost:', error.message)
    }

    console.log(`[UniswapV4] Quote: ${amountOut} ${params.tokenOut} (rate: ${exchangeRate.toFixed(6)}, fee: ${fee / 10000}%)`)

    return {
      amountOut,
      amountOutMin,
      priceImpact,
      exchangeRate,
      gasCostUsd
    }
  }

  /**
   * Place a limit order via MegaQuantRouter contract.
   * The order will execute when the pool price reaches the specified tick.
   * Auto-resolves hook/router addresses from chain config.
   * Records order in OrderManager and broadcasts via WebSocket.
   * @param params Limit order parameters
   * @returns Limit order result with orderId and tx details
   */
  async limitOrder(params: LimitOrderParams): Promise<LimitOrderResult> {
    console.log(`[UniswapV4] Placing limit order: ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut} at tick ${params.tick}`)

    try {
      const megaQuantRouter = this.requireRouter()
      const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

      const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)

      // Create hook pool key (DYNAMIC_FEE_FLAG + hook address)
      const poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)

      // Determine swap direction
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

      // Approve token for MegaQuantRouter
      await this.approveTokenForAddress(tokenInInfo.address, amountIn, this.megaQuantRouterAddress!)

      // Place limit order — parameter order matches MegaQuantRouter.placeLimitOrder
      const deadlineSeconds = params.deadline || 86400 // Default 24 hours
      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadlineSeconds

      const tx = await megaQuantRouter.placeLimitOrder(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        params.tick,
        amountIn,
        zeroForOne,
        deadlineTimestamp,
        params.hookData || '0x'
      )

      console.log(`[UniswapV4] Limit order tx submitted: ${tx.hash}`)

      const receipt = await tx.wait()
      console.log(`[UniswapV4] Limit order confirmed in block ${receipt.blockNumber}`)

      // Compute orderId deterministically
      const poolId = this.computePoolId(poolKey)
      const abiCoder = AbiCoder.defaultAbiCoder()
      const orderId = keccak256(abiCoder.encode(
        ['bytes32', 'int24', 'bool'],
        [poolId, params.tick, zeroForOne]
      ))

      // Record in OrderManager
      try {
        const { orderManager } = await import('../orders/OrderManager.js')
        orderManager.recordOrder({
          strategyId: this.strategyId,
          orderType: 'limit',
          side: zeroForOne ? 'sell' : 'buy',
          assetSymbol: tokenInInfo.symbol,
          chainId: this.chainId,
          protocol: 'uniswap-v4-hook',
          quantity: params.amountIn,
          price: params.targetPrice,
          tick: params.tick,
          hookOrderId: orderId,
          accountId: this.accountId,
          deadline: new Date(deadlineTimestamp * 1000).toISOString(),
          tokenInSymbol: tokenInInfo.symbol,
          tokenInAmount: params.amountIn,
          tokenOutSymbol: tokenOutInfo.symbol,
          blockNumber: receipt.blockNumber,
        })
      } catch (error: any) {
        console.warn('[UniswapV4] Failed to record limit order in OrderManager:', error.message)
      }

      // Broadcast via WebSocket
      await this.broadcastHookOrder('hook_order_placed', {
        orderId,
        orderType: 'limit',
        side: zeroForOne ? 'sell' : 'buy',
        symbol: tokenInInfo.symbol,
        quantity: params.amountIn,
        price: params.targetPrice,
        tick: params.tick,
        txHash: tx.hash,
      })

      return {
        success: true,
        orderId,
        txHash: tx.hash,
        tick: params.tick,
        amountIn: params.amountIn,
        targetPrice: params.targetPrice,
        deadline: deadlineSeconds
      }
    } catch (error: any) {
      console.error('[UniswapV4] Limit order failed:', error)
      throw new Error(`Limit order failed: ${error.message}`)
    }
  }

  /**
   * Cancel a pending limit order via MegaQuantHook contract.
   * Auto-resolves hook address from chain config.
   * @param tokenIn Input token symbol
   * @param tokenOut Output token symbol
   * @param tick Tick of the limit order to cancel
   * @returns Transaction hash of the cancellation
   */
  async cancelLimitOrder(
    tokenIn: string,
    tokenOut: string,
    tick: number
  ): Promise<{ success: boolean; txHash: string }> {
    console.log(`[UniswapV4] Cancelling limit order at tick ${tick}`)

    try {
      const hookAddress = this.requireHook()
      const tokenInInfo = getTokenInfo(this.chainName, tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, tokenOut)

      const poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

      const hookContract = new Contract(hookAddress, MEGA_QUANT_HOOK_ABI, this.wallet)

      const tx = await hookContract.cancelOrder(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        tick,
        zeroForOne
      )

      console.log(`[UniswapV4] Cancel tx submitted: ${tx.hash}`)
      await tx.wait()
      console.log(`[UniswapV4] Limit order cancelled successfully`)

      // Update OrderManager — find order by hook_order_id
      try {
        const { orderManager } = await import('../orders/OrderManager.js')
        const poolId = this.computePoolId(poolKey)
        const abiCoder = AbiCoder.defaultAbiCoder()
        const orderId = keccak256(abiCoder.encode(
          ['bytes32', 'int24', 'bool'],
          [poolId, tick, zeroForOne]
        ))
        const allOrders = orderManager.getAll(this.strategyId)
        const matchingOrder = allOrders.find(o => o.hookOrderId === orderId && o.status === 'pending')
        if (matchingOrder) {
          orderManager.updateOrderStatus(matchingOrder.id, 'cancelled')
        }
      } catch (error: any) {
        console.warn('[UniswapV4] Failed to update cancelled order in OrderManager:', error.message)
      }

      // Broadcast cancellation
      await this.broadcastHookOrder('hook_order_cancelled', {
        orderType: 'limit',
        tick,
        txHash: tx.hash,
      })

      return { success: true, txHash: tx.hash }
    } catch (error: any) {
      console.error('[UniswapV4] Cancel limit order failed:', error)
      throw new Error(`Cancel limit order failed: ${error.message}`)
    }
  }

  /**
   * Read the current volatility-adjusted fee from MegaQuantHook.
   * Auto-resolves hook address from chain config.
   * @param tokenA First token symbol
   * @param tokenB Second token symbol
   * @returns Current dynamic fee in basis points (e.g., 3000 = 0.3%)
   */
  async getVolatilityFee(
    tokenA: string,
    tokenB: string
  ): Promise<{ fee: number; feePercentage: string }> {
    const hookAddress = this.requireHook()
    console.log(`[UniswapV4] Reading volatility fee from hook ${hookAddress}`)

    try {
      const tokenAInfo = getTokenInfo(this.chainName, tokenA)
      const tokenBInfo = getTokenInfo(this.chainName, tokenB)

      const poolKey = this.createHookPoolKey(tokenAInfo.address, tokenBInfo.address)
      const poolId = this.computePoolId(poolKey)

      const hookContract = new Contract(hookAddress, MEGA_QUANT_HOOK_ABI, this.wallet.provider!)
      const fee = await hookContract.getPoolFee(poolId)

      const feeNumber = Number(fee)
      const feePercentage = `${(feeNumber / 10000).toFixed(4)}%`

      console.log(`[UniswapV4] Volatility fee: ${feeNumber} (${feePercentage})`)

      return { fee: feeNumber, feePercentage }
    } catch (error: any) {
      console.error('[UniswapV4] Failed to read volatility fee:', error)
      throw new Error(`Failed to read volatility fee: ${error.message}`)
    }
  }

  /**
   * Execute multiple swaps in a single transaction via MegaQuantRouter.batchSwap().
   * All swaps share one unlock() call, saving gas through V4's flash accounting.
   * Auto-resolves router address from chain config.
   *
   * @param swaps Array of swap descriptors
   * @returns Array of per-swap results
   */
  async batchSwap(
    swaps: Array<{
      tokenIn: string
      tokenOut: string
      amountIn: string
      fee?: number
      tickSpacing?: number
      hookAddress?: string
      hookData?: string
    }>
  ): Promise<Array<{ amountIn: string; tokenIn: string; tokenOut: string; success: boolean }>> {
    console.log(`[UniswapV4] Batch swap: ${swaps.length} swaps via MegaQuantRouter`)

    if (swaps.length === 0) return []

    try {
      const megaQuantRouter = this.requireRouter()
      const abiCoder = AbiCoder.defaultAbiCoder()

      // Build parallel arrays for the contract call
      const keys: Array<[string, string, number, number, string]> = []
      const paramsArray: Array<[boolean, bigint, bigint]> = []
      const hookDataArray: string[] = []
      const tokenInfos: Array<{ tokenInInfo: any; tokenOutInfo: any; amountIn: bigint }> = []

      for (const s of swaps) {
        const tokenInInfo = getTokenInfo(this.chainName, s.tokenIn)
        const tokenOutInfo = getTokenInfo(this.chainName, s.tokenOut)
        const amountIn = parseUnits(s.amountIn, tokenInInfo.decimals)

        let poolKey: PoolKey
        if (!s.fee && !s.tickSpacing && !s.hookAddress && this.megaQuantHookAddress) {
          poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)
        } else {
          poolKey = this.createCustomPoolKey(
            tokenInInfo.address,
            tokenOutInfo.address,
            s.fee || this.DEFAULT_FEE,
            s.tickSpacing || this.DEFAULT_TICK_SPACING,
            s.hookAddress
          )
        }

        const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

        keys.push([poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks])
        paramsArray.push([
          zeroForOne,
          -amountIn,  // negative = exact input
          zeroForOne
            ? BigInt('4295128740')   // TickMath.MIN_SQRT_PRICE + 1
            : BigInt('1461446703485210103287273052203988822378723970341')  // TickMath.MAX_SQRT_PRICE - 1
        ])
        hookDataArray.push(s.hookData || '0x')
        tokenInfos.push({ tokenInInfo, tokenOutInfo, amountIn })

        // Approve each input token for the router
        const isNativeEth = tokenInInfo.address === '0x0000000000000000000000000000000000000000'
        if (!isNativeEth) {
          await this.approveTokenForAddress(tokenInInfo.address, amountIn, this.megaQuantRouterAddress!)
        }
      }

      console.log(`[UniswapV4] Executing batch swap with ${swaps.length} legs...`)

      const tx = await megaQuantRouter.batchSwap(keys, paramsArray, hookDataArray)

      console.log(`[UniswapV4] Batch swap tx submitted: ${tx.hash}`)
      const receipt = await tx.wait()
      console.log(`[UniswapV4] Batch swap confirmed in block ${receipt.blockNumber}`)

      // Build results
      const results = swaps.map((s, i) => ({
        amountIn: s.amountIn,
        tokenIn: s.tokenIn,
        tokenOut: s.tokenOut,
        success: true
      }))

      // Record each leg as a trade
      const gasPerLeg = Math.floor(Number(receipt.gasUsed) / swaps.length)
      const gasPrice = receipt.gasPrice || 0n
      const gasPriceGwei = formatUnits(gasPrice, 'gwei')

      let blockTimestamp: string | undefined
      try {
        const block = await this.wallet.provider!.getBlock(receipt.blockNumber)
        if (block) blockTimestamp = new Date(block.timestamp * 1000).toISOString()
      } catch { /* non-critical */ }

      for (let i = 0; i < swaps.length; i++) {
        const { tokenInInfo, tokenOutInfo, amountIn } = tokenInfos[i]
        try {
          await this.recordTrade({
            tx_hash: receipt.hash,
            block_number: receipt.blockNumber,
            token_in_address: tokenInInfo.address,
            token_in_symbol: tokenInInfo.symbol,
            token_in_amount: formatUnits(amountIn, tokenInInfo.decimals),
            token_out_address: tokenOutInfo.address,
            token_out_symbol: tokenOutInfo.symbol,
            token_out_amount: '0', // exact output unknown without decoding deltas
            gas_used: gasPerLeg,
            gas_price_gwei: gasPriceGwei,
            block_timestamp: blockTimestamp
          })
        } catch (error: any) {
          console.warn(`[UniswapV4] Failed to record batch swap leg ${i}:`, error.message)
        }
      }

      return results
    } catch (error: any) {
      console.error('[UniswapV4] Batch swap failed:', error)
      throw new Error(`Batch swap failed: ${error.message}`)
    }
  }

  /**
   * Redeem output tokens from a filled limit order.
   * Auto-resolves hook address from chain config.
   *
   * @param tokenIn Original input token symbol (used to reconstruct pool key)
   * @param tokenOut Original output token symbol
   * @param tick Tick where the limit order was placed
   * @param amount Amount of claim tokens to redeem (in input token units)
   * @returns Transaction hash and redeemed status
   */
  async redeemLimitOrder(
    tokenIn: string,
    tokenOut: string,
    tick: number,
    amount: string
  ): Promise<{ success: boolean; txHash: string }> {
    console.log(`[UniswapV4] Redeeming limit order: ${amount} claim tokens at tick ${tick}`)

    try {
      const hookAddress = this.requireHook()
      const tokenInInfo = getTokenInfo(this.chainName, tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, tokenOut)

      const poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)
      const inputAmountToClaimFor = parseUnits(amount, tokenInInfo.decimals)

      const hookContract = new Contract(hookAddress, MEGA_QUANT_HOOK_ABI, this.wallet)

      const tx = await hookContract.redeem(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        tick,
        zeroForOne,
        inputAmountToClaimFor
      )

      console.log(`[UniswapV4] Redeem tx submitted: ${tx.hash}`)
      const receipt = await tx.wait()
      console.log(`[UniswapV4] Limit order redeemed in block ${receipt.blockNumber}`)

      return { success: true, txHash: tx.hash }
    } catch (error: any) {
      console.error('[UniswapV4] Redeem limit order failed:', error)
      throw new Error(`Redeem limit order failed: ${error.message}`)
    }
  }

  /**
   * Ensure MegaQuantHook is configured on this chain.
   * Throws a clear error if not deployed.
   */
  private requireHook(): string {
    if (!this.megaQuantHookAddress) {
      throw new Error(`MegaQuantHook not deployed on ${this.chainName}. Configure megaQuantHook in chain config.`)
    }
    return this.megaQuantHookAddress
  }

  /**
   * Ensure MegaQuantRouter is configured on this chain.
   */
  private requireRouter(): Contract {
    if (!this.megaQuantRouterContract || !this.megaQuantRouterAddress) {
      throw new Error(`MegaQuantRouter not deployed on ${this.chainName}. Configure megaQuantRouter in chain config.`)
    }
    return this.megaQuantRouterContract
  }

  /**
   * Ensure PoolRegistry is configured on this chain.
   */
  private requireRegistry(): Contract {
    if (!this.poolRegistryContract || !this.poolRegistryAddress) {
      throw new Error(`PoolRegistry not deployed on ${this.chainName}. Configure poolRegistry in chain config.`)
    }
    return this.poolRegistryContract
  }

  /**
   * Create a pool key for hook pools (uses DYNAMIC_FEE_FLAG and hook address).
   */
  private createHookPoolKey(tokenAAddress: string, tokenBAddress: string): PoolKey {
    const hookAddress = this.requireHook()
    const [currency0, currency1] = tokenAAddress.toLowerCase() < tokenBAddress.toLowerCase()
      ? [tokenAAddress, tokenBAddress]
      : [tokenBAddress, tokenAAddress]

    return {
      currency0,
      currency1,
      fee: this.DYNAMIC_FEE_FLAG,
      tickSpacing: this.DEFAULT_TICK_SPACING,
      hooks: hookAddress
    }
  }

  /**
   * Compute a poolId from a pool key (keccak256 of abi-encoded key).
   */
  private computePoolId(poolKey: PoolKey): string {
    const abiCoder = AbiCoder.defaultAbiCoder()
    return keccak256(abiCoder.encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
    ))
  }

  /**
   * Broadcast a hook order event via WebSocket.
   */
  private async broadcastHookOrder(
    eventType: 'hook_order_placed' | 'hook_order_cancelled',
    data: Record<string, any>
  ): Promise<void> {
    try {
      const wsModule = await import('../../../services/live-data.js').catch(() => null)
      if (wsModule?.liveDataService) {
        wsModule.liveDataService.broadcastOrderUpdate({
          orderId: data.orderId || '',
          strategyId: this.strategyId,
          status: eventType === 'hook_order_placed' ? 'pending' : 'cancelled',
          side: data.side || '',
          symbol: data.symbol || '',
          quantity: data.quantity || '',
          price: data.price,
          timestamp: new Date().toISOString(),
          eventType,
          ...data
        })
      }
    } catch (error: any) {
      console.warn(`[UniswapV4] Failed to broadcast ${eventType}:`, error.message)
    }
  }

  /**
   * Create a PoolKey for the token pair
   * @param tokenA First token address
   * @param tokenB Second token address
   * @param hooksAddress Optional hooks contract address
   * @returns PoolKey struct
   */
  private createPoolKey(tokenA: string, tokenB: string, hooksAddress?: string): PoolKey {
    // Sort tokens (currency0 < currency1)
    const [currency0, currency1] = tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA]

    return {
      currency0,
      currency1,
      fee: this.DEFAULT_FEE,
      tickSpacing: this.DEFAULT_TICK_SPACING,
      hooks: hooksAddress || this.NO_HOOKS
    }
  }

  /**
   * Determine if swap is zeroForOne based on token addresses and pool key
   * @param tokenIn Input token address
   * @param tokenOut Output token address
   * @param poolKey Pool key with sorted currencies
   * @returns true if swapping currency0 for currency1
   */
  private isZeroForOne(tokenIn: string, _tokenOut: string, poolKey: PoolKey): boolean {
    // zeroForOne = true means swapping currency0 for currency1
    return tokenIn.toLowerCase() === poolKey.currency0.toLowerCase()
  }

  /**
   * Approve token for a specific address (PoolManager, SwapRouter, etc.)
   * @param tokenAddress Token to approve
   * @param amount Amount to approve
   * @param spenderAddress Address to approve spending for
   */
  private async approveTokenForAddress(tokenAddress: string, amount: bigint, spenderAddress: string): Promise<void> {
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.wallet)
    const walletAddress = await this.wallet.getAddress()

    // Check current allowance
    const currentAllowance = await tokenContract.allowance(walletAddress, spenderAddress)

    if (currentAllowance < amount) {
      console.log(`[UniswapV4] Approving ${tokenAddress} for ${spenderAddress}...`)
      const approveTx = await tokenContract.approve(spenderAddress, MaxUint256)
      await approveTx.wait()
      console.log('[UniswapV4] Token approved')
    } else {
      console.log('[UniswapV4] Token already approved')
    }
  }

  /**
   * Execute a swap with custom hooks
   * Convenience method for swapping with hooks support
   * @param params Swap parameters
   * @param hooksAddress Address of the hooks contract
   * @param hookData Custom data to pass to hooks (optional)
   * @returns Swap result
   */
  async swapWithHooks(
    params: SwapParams,
    hooksAddress: string,
    hookData?: string
  ): Promise<SwapResult> {
    const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
    const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

    // Create pool key with hooks
    const poolKey = this.createPoolKey(
      tokenInInfo.address,
      tokenOutInfo.address,
      hooksAddress
    )

    // Execute swap with pool key and hook data
    return this.swap({
      ...params,
      poolKey,
      hookData: hookData || '0x'
    } as V4SwapParams)
  }

  /**
   * Create a custom pool key with specific parameters
   * Useful for interacting with pools that have custom fee tiers or hooks
   * @param tokenA First token address
   * @param tokenB Second token address
   * @param fee Fee tier (e.g., 500 for 0.05%, 3000 for 0.3%, 10000 for 1%)
   * @param tickSpacing Tick spacing for the fee tier
   * @param hooksAddress Hooks contract address (optional, defaults to no hooks)
   * @returns PoolKey struct
   */
  createCustomPoolKey(
    tokenA: string,
    tokenB: string,
    fee: number,
    tickSpacing: number,
    hooksAddress?: string
  ): PoolKey {
    // Sort tokens (currency0 < currency1)
    const [currency0, currency1] = tokenA.toLowerCase() < tokenB.toLowerCase()
      ? [tokenA, tokenB]
      : [tokenB, tokenA]

    return {
      currency0,
      currency1,
      fee,
      tickSpacing,
      hooks: hooksAddress || this.NO_HOOKS
    }
  }

  /**
   * Get a quote for a swap with hooks
   * Note: The quote may differ from actual execution if hooks modify swap behavior
   * @param params Quote parameters
   * @param hooksAddress Hooks contract address (optional)
   * @returns Quote result
   */
  async getQuoteWithHooks(
    params: QuoteParams,
    hooksAddress?: string
  ): Promise<QuoteResult> {
    // Quotes don't currently support custom pool keys in the getQuote method
    // This is a placeholder for future enhancement
    console.log('[UniswapV4] Note: Quote does not account for hook modifications')
    if (hooksAddress) {
      console.log(`[UniswapV4] Hooks contract: ${hooksAddress}`)
    }
    return this.getQuote(params)
  }

  /**
   * Approve token via Permit2 for Universal Router
   * Two-step approval process:
   * 1. Approve Permit2 to spend tokens
   * 2. Approve Universal Router via Permit2
   * @param tokenAddress Token to approve
   * @param amount Amount to approve
   */
  private async approveTokenViaPermit2(tokenAddress: string, amount: bigint): Promise<void> {
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.wallet)
    const walletAddress = await this.wallet.getAddress()
    const universalRouterAddress = await this.universalRouterContract.getAddress()

    // Step 1: Approve Permit2 to spend tokens
    const permit2Allowance = await tokenContract.allowance(walletAddress, PERMIT2_ADDRESS)

    if (permit2Allowance < amount) {
      console.log(`[UniswapV4] Approving Permit2 to spend ${tokenAddress}...`)
      const approveTx = await tokenContract.approve(PERMIT2_ADDRESS, MaxUint256)
      await approveTx.wait()
      console.log('[UniswapV4] Permit2 approved')
    } else {
      console.log('[UniswapV4] Permit2 already approved')
    }

    // Step 2: Approve Universal Router via Permit2
    // Check current Permit2 allowance for Universal Router
    const permit2AllowanceData = await this.permit2Contract.allowance(
      walletAddress,
      tokenAddress,
      universalRouterAddress
    )

    const currentPermit2Allowance = permit2AllowanceData[0] // amount
    const expiration = permit2AllowanceData[1] // expiration timestamp

    // Check if we need to renew approval (either insufficient amount or expired)
    const now = Math.floor(Date.now() / 1000)
    const needsApproval = currentPermit2Allowance < amount || expiration < now

    if (needsApproval) {
      console.log(`[UniswapV4] Approving Universal Router via Permit2...`)

      // Set expiration to 30 days from now
      const newExpiration = now + (30 * 24 * 60 * 60)

      // Approve with maximum amount for convenience (type(uint160).max)
      const maxUint160 = (BigInt(1) << BigInt(160)) - BigInt(1)

      const permit2ApproveTx = await this.permit2Contract.approve(
        tokenAddress,
        universalRouterAddress,
        maxUint160,
        newExpiration
      )
      await permit2ApproveTx.wait()
      console.log('[UniswapV4] Universal Router approved via Permit2')
    } else {
      console.log('[UniswapV4] Universal Router already approved via Permit2')
    }
  }

  /**
   * Approve token via Permit2 for an arbitrary spender address.
   * Generalization of approveTokenViaPermit2() that takes a spender param.
   */
  private async approveTokenViaPermit2ForAddress(tokenAddress: string, amount: bigint, spenderAddress: string): Promise<void> {
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.wallet)
    const walletAddress = await this.wallet.getAddress()

    // Step 1: Approve Permit2 to spend tokens
    const permit2Allowance = await tokenContract.allowance(walletAddress, PERMIT2_ADDRESS)
    if (permit2Allowance < amount) {
      console.log(`[UniswapV4] Approving Permit2 to spend ${tokenAddress}...`)
      const approveTx = await tokenContract.approve(PERMIT2_ADDRESS, MaxUint256)
      await approveTx.wait()
      console.log('[UniswapV4] Permit2 approved')
    }

    // Step 2: Approve spender via Permit2
    const permit2AllowanceData = await this.permit2Contract.allowance(
      walletAddress,
      tokenAddress,
      spenderAddress
    )
    const currentPermit2Allowance = permit2AllowanceData[0]
    const expiration = permit2AllowanceData[1]
    const now = Math.floor(Date.now() / 1000)
    const needsApproval = currentPermit2Allowance < amount || expiration < now

    if (needsApproval) {
      console.log(`[UniswapV4] Approving ${spenderAddress} via Permit2...`)
      const newExpiration = now + (30 * 24 * 60 * 60)
      const maxUint160 = (BigInt(1) << BigInt(160)) - BigInt(1)
      const permit2ApproveTx = await this.permit2Contract.approve(
        tokenAddress,
        spenderAddress,
        maxUint160,
        newExpiration
      )
      await permit2ApproveTx.wait()
      console.log('[UniswapV4] Spender approved via Permit2')
    }
  }

  // =====================================================================
  // New Hook Order Methods
  // =====================================================================

  /**
   * Place a stop order via MegaQuantRouter.
   * The order triggers when the pool price crosses the specified tick.
   */
  async stopOrder(params: StopOrderParams): Promise<StopOrderResult> {
    console.log(`[UniswapV4] Placing stop order: ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut} at tick ${params.tick}`)

    try {
      const megaQuantRouter = this.requireRouter()
      const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

      const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)
      const poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

      // Approve token for MegaQuantRouter
      await this.approveTokenForAddress(tokenInInfo.address, amountIn, this.megaQuantRouterAddress!)

      const deadlineSeconds = params.deadline || 0 // 0 = no expiry
      const deadlineTimestamp = deadlineSeconds > 0
        ? Math.floor(Date.now() / 1000) + deadlineSeconds
        : 0

      const tx = await megaQuantRouter.placeStopOrder(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        params.tick,
        amountIn,
        zeroForOne,
        deadlineTimestamp,
        '0x'
      )

      console.log(`[UniswapV4] Stop order tx submitted: ${tx.hash}`)
      const receipt = await tx.wait()
      console.log(`[UniswapV4] Stop order confirmed in block ${receipt.blockNumber}`)

      // Compute stop orderId: keccak256(abi.encode("STOP", poolId, tick, zeroForOne))
      const poolId = this.computePoolId(poolKey)
      const abiCoder = AbiCoder.defaultAbiCoder()
      const orderId = keccak256(abiCoder.encode(
        ['string', 'bytes32', 'int24', 'bool'],
        ['STOP', poolId, params.tick, zeroForOne]
      ))

      // Record in OrderManager
      try {
        const { orderManager } = await import('../orders/OrderManager.js')
        orderManager.recordOrder({
          strategyId: this.strategyId,
          orderType: 'stop',
          side: zeroForOne ? 'sell' : 'buy',
          assetSymbol: tokenInInfo.symbol,
          chainId: this.chainId,
          protocol: 'uniswap-v4-hook',
          quantity: params.amountIn,
          tick: params.tick,
          hookOrderId: orderId,
          accountId: this.accountId,
          deadline: deadlineTimestamp > 0 ? new Date(deadlineTimestamp * 1000).toISOString() : undefined,
          tokenInSymbol: tokenInInfo.symbol,
          tokenInAmount: params.amountIn,
          tokenOutSymbol: tokenOutInfo.symbol,
          blockNumber: receipt.blockNumber,
        })
      } catch (error: any) {
        console.warn('[UniswapV4] Failed to record stop order in OrderManager:', error.message)
      }

      await this.broadcastHookOrder('hook_order_placed', {
        orderId,
        orderType: 'stop',
        side: zeroForOne ? 'sell' : 'buy',
        symbol: tokenInInfo.symbol,
        quantity: params.amountIn,
        tick: params.tick,
        txHash: tx.hash,
      })

      return {
        success: true,
        orderId,
        txHash: tx.hash,
        tick: params.tick,
        amountIn: params.amountIn,
        deadline: deadlineSeconds,
      }
    } catch (error: any) {
      console.error('[UniswapV4] Stop order failed:', error)
      throw new Error(`Stop order failed: ${error.message}`)
    }
  }

  /**
   * Cancel a pending stop order via MegaQuantHook.
   */
  async cancelStopOrder(
    tokenIn: string,
    tokenOut: string,
    tick: number
  ): Promise<{ success: boolean; txHash: string }> {
    console.log(`[UniswapV4] Cancelling stop order at tick ${tick}`)

    try {
      const hookAddress = this.requireHook()
      const tokenInInfo = getTokenInfo(this.chainName, tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, tokenOut)

      const poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

      const hookContract = new Contract(hookAddress, MEGA_QUANT_HOOK_ABI, this.wallet)

      const tx = await hookContract.cancelStopOrder(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        tick,
        zeroForOne
      )

      console.log(`[UniswapV4] Cancel stop tx submitted: ${tx.hash}`)
      await tx.wait()
      console.log(`[UniswapV4] Stop order cancelled successfully`)

      // Update OrderManager
      try {
        const { orderManager } = await import('../orders/OrderManager.js')
        const poolId = this.computePoolId(poolKey)
        const abiCoder = AbiCoder.defaultAbiCoder()
        const orderId = keccak256(abiCoder.encode(
          ['string', 'bytes32', 'int24', 'bool'],
          ['STOP', poolId, tick, zeroForOne]
        ))
        const allOrders = orderManager.getAll(this.strategyId)
        const matchingOrder = allOrders.find(o => o.hookOrderId === orderId && o.status === 'pending')
        if (matchingOrder) {
          orderManager.updateOrderStatus(matchingOrder.id, 'cancelled')
        }
      } catch (error: any) {
        console.warn('[UniswapV4] Failed to update cancelled stop order in OrderManager:', error.message)
      }

      await this.broadcastHookOrder('hook_order_cancelled', {
        orderType: 'stop',
        tick,
        txHash: tx.hash,
      })

      return { success: true, txHash: tx.hash }
    } catch (error: any) {
      console.error('[UniswapV4] Cancel stop order failed:', error)
      throw new Error(`Cancel stop order failed: ${error.message}`)
    }
  }

  /**
   * Place a bracket (OCO) order — simultaneous limit (take-profit) + stop (stop-loss).
   * Both sides are placed in a single transaction. If one fills, the hook cancels the other.
   */
  async bracketOrder(params: BracketOrderParams): Promise<BracketOrderResult> {
    console.log(`[UniswapV4] Placing bracket order: ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut} (TP tick ${params.limitTick}, SL tick ${params.stopTick})`)

    try {
      const megaQuantRouter = this.requireRouter()
      const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

      const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)
      const poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

      // Approve 2x amount (both sides)
      const totalAmount = amountIn * 2n
      await this.approveTokenForAddress(tokenInInfo.address, totalAmount, this.megaQuantRouterAddress!)

      const deadlineSeconds = params.deadline || 86400
      const deadlineTimestamp = Math.floor(Date.now() / 1000) + deadlineSeconds

      const tx = await megaQuantRouter.placeBracketOrder(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        params.limitTick,
        params.stopTick,
        zeroForOne,
        amountIn,
        deadlineTimestamp
      )

      console.log(`[UniswapV4] Bracket order tx submitted: ${tx.hash}`)
      const receipt = await tx.wait()
      console.log(`[UniswapV4] Bracket order confirmed in block ${receipt.blockNumber}`)

      // Compute both orderIds
      const poolId = this.computePoolId(poolKey)
      const abiCoder = AbiCoder.defaultAbiCoder()
      const limitOrderId = keccak256(abiCoder.encode(
        ['bytes32', 'int24', 'bool'],
        [poolId, params.limitTick, zeroForOne]
      ))
      const stopOrderId = keccak256(abiCoder.encode(
        ['string', 'bytes32', 'int24', 'bool'],
        ['STOP', poolId, params.stopTick, zeroForOne]
      ))

      // Record TWO linked orders in OrderManager
      try {
        const { orderManager } = await import('../orders/OrderManager.js')
        const side = zeroForOne ? 'sell' : 'buy'
        const deadlineStr = new Date(deadlineTimestamp * 1000).toISOString()

        const limitOrder = orderManager.recordOrder({
          strategyId: this.strategyId,
          orderType: 'limit',
          side,
          assetSymbol: tokenInInfo.symbol,
          chainId: this.chainId,
          protocol: 'uniswap-v4-hook',
          quantity: params.amountIn,
          tick: params.limitTick,
          hookOrderId: limitOrderId,
          accountId: this.accountId,
          deadline: deadlineStr,
          tokenInSymbol: tokenInInfo.symbol,
          tokenInAmount: params.amountIn,
          tokenOutSymbol: tokenOutInfo.symbol,
          blockNumber: receipt.blockNumber,
        })

        const stopOrder = orderManager.recordOrder({
          strategyId: this.strategyId,
          orderType: 'stop',
          side,
          assetSymbol: tokenInInfo.symbol,
          chainId: this.chainId,
          protocol: 'uniswap-v4-hook',
          quantity: params.amountIn,
          tick: params.stopTick,
          hookOrderId: stopOrderId,
          linkedOrderId: limitOrder.id,
          accountId: this.accountId,
          deadline: deadlineStr,
          tokenInSymbol: tokenInInfo.symbol,
          tokenInAmount: params.amountIn,
          tokenOutSymbol: tokenOutInfo.symbol,
          blockNumber: receipt.blockNumber,
        })

        // Back-link limit -> stop
        orderManager.setLinkedOrderId(limitOrder.id, stopOrder.id)
      } catch (error: any) {
        console.warn('[UniswapV4] Failed to record bracket orders in OrderManager:', error.message)
      }

      await this.broadcastHookOrder('hook_order_placed', {
        orderId: `${limitOrderId}+${stopOrderId}`,
        orderType: 'bracket',
        side: zeroForOne ? 'sell' : 'buy',
        symbol: tokenInInfo.symbol,
        quantity: params.amountIn,
        limitTick: params.limitTick,
        stopTick: params.stopTick,
        txHash: tx.hash,
      })

      return {
        success: true,
        limitOrderId,
        stopOrderId,
        txHash: tx.hash,
        limitTick: params.limitTick,
        stopTick: params.stopTick,
        amountIn: params.amountIn,
        deadline: deadlineSeconds,
      }
    } catch (error: any) {
      console.error('[UniswapV4] Bracket order failed:', error)
      throw new Error(`Bracket order failed: ${error.message}`)
    }
  }

  /**
   * Cancel a bracket (OCO) order — cancels both limit and stop sides.
   */
  async cancelBracketOrder(
    tokenIn: string,
    tokenOut: string,
    limitTick: number,
    stopTick: number
  ): Promise<{ success: boolean; txHash: string }> {
    console.log(`[UniswapV4] Cancelling bracket order (limit tick ${limitTick}, stop tick ${stopTick})`)

    try {
      const hookAddress = this.requireHook()
      const tokenInInfo = getTokenInfo(this.chainName, tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, tokenOut)

      const poolKey = this.createHookPoolKey(tokenInInfo.address, tokenOutInfo.address)
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

      const hookContract = new Contract(hookAddress, MEGA_QUANT_HOOK_ABI, this.wallet)

      // Cancel limit side
      const tx1 = await hookContract.cancelOrder(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        limitTick,
        zeroForOne
      )
      await tx1.wait()

      // Cancel stop side
      const tx2 = await hookContract.cancelStopOrder(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        stopTick,
        zeroForOne
      )
      await tx2.wait()

      console.log(`[UniswapV4] Bracket order cancelled successfully`)

      // Update both orders in OrderManager
      try {
        const { orderManager } = await import('../orders/OrderManager.js')
        const poolId = this.computePoolId(poolKey)
        const abiCoder = AbiCoder.defaultAbiCoder()
        const limitId = keccak256(abiCoder.encode(['bytes32', 'int24', 'bool'], [poolId, limitTick, zeroForOne]))
        const stopId = keccak256(abiCoder.encode(['string', 'bytes32', 'int24', 'bool'], ['STOP', poolId, stopTick, zeroForOne]))

        const allOrders = orderManager.getAll(this.strategyId)
        for (const o of allOrders) {
          if ((o.hookOrderId === limitId || o.hookOrderId === stopId) && o.status === 'pending') {
            orderManager.updateOrderStatus(o.id, 'cancelled')
          }
        }
      } catch (error: any) {
        console.warn('[UniswapV4] Failed to update cancelled bracket orders in OrderManager:', error.message)
      }

      await this.broadcastHookOrder('hook_order_cancelled', {
        orderType: 'bracket',
        limitTick,
        stopTick,
        txHash: tx2.hash,
      })

      return { success: true, txHash: tx2.hash }
    } catch (error: any) {
      console.error('[UniswapV4] Cancel bracket order failed:', error)
      throw new Error(`Cancel bracket order failed: ${error.message}`)
    }
  }

  /**
   * Get all pending hook orders for this strategy from the database.
   */
  async getMyHookOrders(): Promise<HookOrder[]> {
    try {
      const { orderManager } = await import('../orders/OrderManager.js')
      const allOrders = orderManager.getAll(this.strategyId)

      return allOrders
        .filter(o => o.protocol === 'uniswap-v4-hook' && o.hookOrderId)
        .map(o => ({
          id: o.id,
          orderType: (o.orderType as 'limit' | 'stop') || 'limit',
          side: o.side,
          tokenIn: o.tokenInSymbol || o.assetSymbol,
          tokenOut: o.tokenOutSymbol || '',
          amountIn: o.tokenInAmount || o.quantity,
          tick: o.tick || 0,
          status: o.status as 'pending' | 'filled' | 'cancelled' | 'expired',
          hookOrderId: o.hookOrderId!,
          linkedOrderId: o.linkedOrderId || undefined,
          createdAt: o.createdAt,
        }))
    } catch (error: any) {
      console.error('[UniswapV4] Failed to get hook orders:', error)
      throw new Error(`Failed to get hook orders: ${error.message}`)
    }
  }

  /**
   * Query on-chain pool state for a token pair via StateView.
   */
  async getPoolInfo(tokenA: string, tokenB: string): Promise<PoolInfo> {
    console.log(`[UniswapV4] Getting pool info for ${tokenA}/${tokenB}`)

    try {
      const hookAddress = this.requireHook()
      const tokenAInfo = getTokenInfo(this.chainName, tokenA)
      const tokenBInfo = getTokenInfo(this.chainName, tokenB)

      const poolKey = this.createHookPoolKey(tokenAInfo.address, tokenBInfo.address)
      const poolId = this.computePoolId(poolKey)

      // Query slot0 from StateView (takes PoolId = bytes32)
      const slot0 = await this.stateViewContract.getSlot0(poolId)
      const currentTick = Number(slot0[1])
      const sqrtPriceX96 = slot0[0].toString()

      // Query liquidity
      const liquidity = await this.stateViewContract.getLiquidity(poolId)

      // Query dynamic fee from hook
      let fee = 0
      let feePercentage = '0%'
      try {
        const hookContract = new Contract(hookAddress, MEGA_QUANT_HOOK_ABI, this.wallet.provider!)
        const feeResult = await hookContract.getPoolFee(poolId)
        fee = Number(feeResult)
        feePercentage = `${(fee / 10000).toFixed(4)}%`
      } catch {
        // Fee query may fail if hook doesn't support it
      }

      return {
        poolId,
        currentTick,
        sqrtPriceX96,
        liquidity: liquidity.toString(),
        fee,
        feePercentage,
      }
    } catch (error: any) {
      console.error('[UniswapV4] Failed to get pool info:', error)
      throw new Error(`Failed to get pool info: ${error.message}`)
    }
  }

  /**
   * Add liquidity to a V4 hook pool via PositionManager.
   * Mints a new position with the given tick range and amounts.
   */
  async addLiquidity(params: AddLiquidityParams): Promise<AddLiquidityResult> {
    console.log(`[UniswapV4] Adding liquidity: ${params.amount0} ${params.tokenA} + ${params.amount1} ${params.tokenB}`)

    try {
      // 1. Resolve + sort tokens
      const tokenAInfo = getTokenInfo(this.chainName, params.tokenA)
      const tokenBInfo = getTokenInfo(this.chainName, params.tokenB)

      const aIsCurrency0 = tokenAInfo.address.toLowerCase() < tokenBInfo.address.toLowerCase()
      const currency0Info = aIsCurrency0 ? tokenAInfo : tokenBInfo
      const currency1Info = aIsCurrency0 ? tokenBInfo : tokenAInfo
      const amount0Raw = aIsCurrency0 ? params.amount0 : params.amount1
      const amount1Raw = aIsCurrency0 ? params.amount1 : params.amount0

      const amount0 = parseUnits(amount0Raw, currency0Info.decimals)
      const amount1 = parseUnits(amount1Raw, currency1Info.decimals)

      // 1b. Validate token balances before proceeding
      const walletAddress = await this.wallet.getAddress()
      if (amount0 > 0n) {
        const token0Contract = new Contract(currency0Info.address, ERC20_ABI, this.wallet.provider!)
        const balance0 = await token0Contract.balanceOf(walletAddress)
        if (balance0 < amount0) {
          throw new Error(`Insufficient ${currency0Info.symbol} balance: have ${formatUnits(balance0, currency0Info.decimals)}, need ${amount0Raw}`)
        }
      }
      if (amount1 > 0n) {
        const token1Contract = new Contract(currency1Info.address, ERC20_ABI, this.wallet.provider!)
        const balance1 = await token1Contract.balanceOf(walletAddress)
        if (balance1 < amount1) {
          throw new Error(`Insufficient ${currency1Info.symbol} balance: have ${formatUnits(balance1, currency1Info.decimals)}, need ${amount1Raw}`)
        }
      }

      // 2. Create pool key
      const poolKey = this.createHookPoolKey(currency0Info.address, currency1Info.address)

      // 3. Tick range — defaults to full range for the pool's tickSpacing
      const tickSpacing = poolKey.tickSpacing
      const tickLower = params.tickLower ?? -(Math.floor(887272 / tickSpacing) * tickSpacing)
      const tickUpper = params.tickUpper ?? (Math.floor(887272 / tickSpacing) * tickSpacing)

      // 4. Compute liquidity from amounts + current sqrtPriceX96
      const poolId = this.computePoolId(poolKey)
      const slot0 = await this.stateViewContract.getSlot0(poolId)
      const sqrtPriceX96 = slot0[0]

      const liquidity = this.computeLiquidityFromAmounts(
        sqrtPriceX96,
        tickLower,
        tickUpper,
        amount0,
        amount1
      )

      if (liquidity <= 0n) {
        throw new Error('Computed liquidity is zero. Increase amounts or adjust tick range.')
      }

      // 5. Approve both tokens via Permit2 for PositionManager
      const positionManagerAddress = await this.positionManagerContract.getAddress()

      if (amount0 > 0n) {
        await this.approveTokenViaPermit2ForAddress(currency0Info.address, amount0, positionManagerAddress)
      }
      if (amount1 > 0n) {
        await this.approveTokenViaPermit2ForAddress(currency1Info.address, amount1, positionManagerAddress)
      }

      // 6. Encode actions for PositionManager
      const slippageBps = params.slippage ?? 500 // 5% default
      const amount0Max = amount0 + (amount0 * BigInt(slippageBps) / 10000n)
      const amount1Max = amount1 + (amount1 * BigInt(slippageBps) / 10000n)
      const recipient = await this.wallet.getAddress()
      const hookData = '0x'

      const abiCoder = AbiCoder.defaultAbiCoder()

      // Encode MINT_POSITION action params
      const mintParams = abiCoder.encode(
        [
          'tuple(address,address,uint24,int24,address)', // PoolKey
          'int24',     // tickLower
          'int24',     // tickUpper
          'uint256',   // liquidity
          'uint128',   // amount0Max
          'uint128',   // amount1Max
          'address',   // owner/recipient
          'bytes',     // hookData
        ],
        [
          [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
          tickLower,
          tickUpper,
          liquidity,
          amount0Max,
          amount1Max,
          recipient,
          hookData,
        ]
      )

      // Encode SETTLE_PAIR params (currency0, currency1)
      const settlePairParams = abiCoder.encode(
        ['address', 'address'],
        [poolKey.currency0, poolKey.currency1]
      )

      // Build actions: MINT_POSITION + SETTLE_PAIR (for ERC-20 pairs)
      // Uses abi.encodePacked(uint8, uint8) format
      const actions = new Uint8Array([
        POSITION_MANAGER_ACTIONS.MINT_POSITION,
        POSITION_MANAGER_ACTIONS.SETTLE_PAIR,
      ])

      // Encode the full unlockData: abi.encode(bytes, bytes[])
      const unlockData = abiCoder.encode(
        ['bytes', 'bytes[]'],
        [
          actions,
          [mintParams, settlePairParams],
        ]
      )

      // 7. Call modifyLiquidities
      const deadline = Math.floor(Date.now() / 1000) + 600 // 10 min deadline
      console.log(`[UniswapV4] Sending modifyLiquidities tx...`)

      const tx = await this.positionManagerContract.modifyLiquidities(unlockData, deadline)
      const receipt = await tx.wait()
      console.log(`[UniswapV4] Add liquidity tx: ${receipt.hash}`)

      const chainConfig = getChainConfig(this.chainName)
      const explorerUrl = `${chainConfig.blockExplorer}/tx/${receipt.hash}`

      return {
        success: true,
        txHash: receipt.hash,
        amount0: formatUnits(amount0, currency0Info.decimals),
        amount1: formatUnits(amount1, currency1Info.decimals),
        liquidity: liquidity.toString(),
        explorerUrl,
      }
    } catch (error: any) {
      console.error('[UniswapV4] Failed to add liquidity:', error)
      throw new Error(`Failed to add liquidity: ${error.message}`)
    }
  }

  /**
   * Compute liquidity amount from token amounts and price range.
   * Uses the standard Uniswap math for concentrated liquidity.
   */
  private computeLiquidityFromAmounts(
    sqrtPriceX96: bigint,
    tickLower: number,
    tickUpper: number,
    amount0: bigint,
    amount1: bigint
  ): bigint {
    const Q96 = 1n << 96n

    // Convert ticks to sqrtPrice
    const sqrtRatioA = this.tickToSqrtPriceX96(tickLower)
    const sqrtRatioB = this.tickToSqrtPriceX96(tickUpper)

    const sqrtPrice = sqrtPriceX96

    if (sqrtPrice <= sqrtRatioA) {
      // Current price below range — all token0
      return amount0 * sqrtRatioA * sqrtRatioB / Q96 / (sqrtRatioB - sqrtRatioA)
    } else if (sqrtPrice >= sqrtRatioB) {
      // Current price above range — all token1
      return amount1 * Q96 / (sqrtRatioB - sqrtRatioA)
    } else {
      // Current price within range — use min of both
      const liquidity0 = amount0 * sqrtPrice * sqrtRatioB / Q96 / (sqrtRatioB - sqrtPrice)
      const liquidity1 = amount1 * Q96 / (sqrtPrice - sqrtRatioA)
      return liquidity0 < liquidity1 ? liquidity0 : liquidity1
    }
  }

  /**
   * Convert a tick to sqrtPriceX96 using the standard formula.
   */
  private tickToSqrtPriceX96(tick: number): bigint {
    const absTick = Math.abs(tick)
    const Q96 = 1n << 96n

    // Use the binary decomposition approach
    let ratio = (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n

    if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n
    if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n
    if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n
    if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n
    if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n
    if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n
    if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n
    if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n
    if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n
    if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n
    if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n
    if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n
    if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n
    if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n
    if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n
    if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n
    if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n
    if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n
    if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n

    if (tick > 0) {
      ratio = (1n << 256n) / ratio
    }

    // Convert from Q128.128 to Q96
    return (ratio >> 32n) + (ratio % (1n << 32n) > 0n ? 1n : 0n)
  }

  /**
   * Query PoolRegistry for all registered pools.
   */
  async getPools(): Promise<RegistryPool[]> {
    console.log(`[UniswapV4] Getting registered pools from PoolRegistry`)

    try {
      const registry = this.requireRegistry()

      const poolCount = Number(await registry.poolCount())
      if (poolCount === 0) return []

      // Fetch pool IDs in batches of 50
      const batchSize = 50
      const pools: RegistryPool[] = []

      for (let offset = 0; offset < poolCount; offset += batchSize) {
        const limit = Math.min(batchSize, poolCount - offset)
        const poolIds: string[] = await registry.getPoolIds(offset, limit)

        for (const poolId of poolIds) {
          try {
            const poolData = await registry.pools(poolId)
            pools.push({
              poolId,
              token0: poolData[0],
              token1: poolData[1],
              tickSpacing: Number(poolData[2]),
              creator: poolData[3],
              name: poolData[4],
              active: poolData[5],
            })
          } catch {
            // Skip pools that fail to query
          }
        }
      }

      console.log(`[UniswapV4] Found ${pools.length} registered pools`)
      return pools
    } catch (error: any) {
      console.error('[UniswapV4] Failed to get pools:', error)
      throw new Error(`Failed to get pools: ${error.message}`)
    }
  }

  /**
   * Estimate pool APY from recent swap volume and fee rate.
   * Scans recent Swap events from PoolManager for the given pool.
   * APY = (dailyFeeRevenue / TVL) * 365
   */
  async estimatePoolAPY(tokenA: string, tokenB: string): Promise<{
    apy: number
    dailyVolume: string
    dailyFees: string
    tvl: string
    sampleBlocks: number
  }> {
    try {
      const tokenAInfo = getTokenInfo(this.chainName, tokenA)
      const tokenBInfo = getTokenInfo(this.chainName, tokenB)
      const poolKey = this.createHookPoolKey(tokenAInfo.address, tokenBInfo.address)
      const poolId = this.computePoolId(poolKey)

      // Get current pool state
      const poolInfo = await this.getPoolInfo(tokenA, tokenB)
      const liquidity = BigInt(poolInfo.liquidity)

      if (liquidity === 0n) {
        return { apy: 0, dailyVolume: '0', dailyFees: '0', tvl: '0', sampleBlocks: 0 }
      }

      // Query recent Swap events (last ~24h of blocks)
      // Estimate ~2s block time for most chains
      const provider = this.wallet.provider!
      const currentBlock = await provider.getBlockNumber()
      const blocksPerDay = Math.floor(86400 / 2) // ~43200 blocks/day at 2s
      const lookbackBlocks = Math.min(blocksPerDay, 10000) // Cap at 10k to avoid RPC limits
      const fromBlock = currentBlock - lookbackBlocks

      const swapFilter = this.poolManagerContract.filters.Swap(poolId)
      let swapEvents: any[] = []
      try {
        swapEvents = await this.poolManagerContract.queryFilter(swapFilter, fromBlock, currentBlock)
      } catch {
        // Some RPCs limit event queries — try smaller range
        try {
          swapEvents = await this.poolManagerContract.queryFilter(swapFilter, currentBlock - 2000, currentBlock)
        } catch {
          // Can't query events
        }
      }

      // Sum absolute volume (in token0 terms, using amount0)
      let totalVolume0 = 0n
      let totalFees = 0n
      for (const event of swapEvents) {
        const args = event.args
        if (!args) continue
        const absAmount0 = args.amount0 < 0n ? -args.amount0 : args.amount0
        totalVolume0 += absAmount0
        // Fee is in hundredths of bps — actual fee from event
        const feeRate = Number(args.fee) / 1_000_000
        totalFees += BigInt(Math.floor(Number(absAmount0) * feeRate))
      }

      // Extrapolate to 24h
      const scaleFactor = blocksPerDay / lookbackBlocks
      const dailyVolume0 = Number(totalVolume0) * scaleFactor
      const dailyFees0 = Number(totalFees) * scaleFactor

      // Estimate TVL from liquidity + current sqrtPrice (simplified)
      // For a rough estimate: TVL ≈ 2 * liquidity * sqrtPrice / 2^96 (in token0 terms)
      const sqrtPriceX96 = BigInt(poolInfo.sqrtPriceX96)
      const Q96 = 1n << 96n
      // TVL in token0 ≈ liquidity / sqrtPrice * 2 (both sides)
      const tvlToken0 = sqrtPriceX96 > 0n
        ? Number(liquidity * Q96 / sqrtPriceX96) * 2
        : 0

      const apy = tvlToken0 > 0 ? (dailyFees0 / tvlToken0) * 365 * 100 : 0

      // Format with token0 decimals
      const dec0 = tokenAInfo.address.toLowerCase() < tokenBInfo.address.toLowerCase()
        ? tokenAInfo.decimals : tokenBInfo.decimals

      return {
        apy: Math.round(apy * 100) / 100,
        dailyVolume: (dailyVolume0 / (10 ** dec0)).toFixed(2),
        dailyFees: (dailyFees0 / (10 ** dec0)).toFixed(4),
        tvl: (tvlToken0 / (10 ** dec0)).toFixed(2),
        sampleBlocks: lookbackBlocks,
      }
    } catch (error: any) {
      console.error('[UniswapV4] Failed to estimate APY:', error.message)
      return { apy: 0, dailyVolume: '0', dailyFees: '0', tvl: '0', sampleBlocks: 0 }
    }
  }

  // =====================================================================
  // TWAP Methods (delegated to TwapService)
  // =====================================================================

  /**
   * Start a TWAP (Time-Weighted Average Price) execution.
   * Splits a large swap into smaller slices executed over time.
   */
  async twap(params: TwapParams): Promise<TwapResult> {
    console.log(`[UniswapV4] Starting TWAP: ${params.totalAmount} ${params.tokenIn} -> ${params.tokenOut} over ${params.numSlices} slices`)

    try {
      const { twapService } = await import('../../../services/twap-service.js')

      const intervalMs = Math.floor(params.durationMs / params.numSlices)

      const twapId = twapService.startTwap({
        strategyId: this.strategyId,
        chainName: this.chainName,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        totalAmount: params.totalAmount,
        numSlices: params.numSlices,
        intervalMs,
        maxSlippage: params.maxSlippage || 50,
        // Pass a swap executor that uses this protocol instance
        swapFn: async (amountIn: string, slippage: number) => {
          return this.swap({
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn,
            slippage,
          })
        },
      })

      const estimatedEndAt = new Date(Date.now() + params.durationMs).toISOString()

      return {
        twapId,
        status: 'active',
        slicesTotal: params.numSlices,
        intervalMs,
        estimatedEndAt,
      }
    } catch (error: any) {
      console.error('[UniswapV4] TWAP start failed:', error)
      throw new Error(`TWAP start failed: ${error.message}`)
    }
  }

  /**
   * Get the current status of a TWAP execution.
   */
  async getTwapStatus(twapId: string): Promise<TwapStatus> {
    try {
      const { twapService } = await import('../../../services/twap-service.js')
      return twapService.getStatus(twapId)
    } catch (error: any) {
      console.error('[UniswapV4] TWAP status query failed:', error)
      throw new Error(`TWAP status query failed: ${error.message}`)
    }
  }

  /**
   * Cancel a running TWAP execution (remaining slices will not execute).
   */
  async cancelTwap(twapId: string): Promise<void> {
    try {
      const { twapService } = await import('../../../services/twap-service.js')
      twapService.cancel(twapId)
      console.log(`[UniswapV4] TWAP ${twapId} cancelled`)
    } catch (error: any) {
      console.error('[UniswapV4] TWAP cancel failed:', error)
      throw new Error(`TWAP cancel failed: ${error.message}`)
    }
  }
}
