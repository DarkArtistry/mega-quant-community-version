// Uniswap V4 Protocol Implementation
// Ported from reference with slippage tracking, PnL integration,
// limit order support via MegaQuantRouter, and volatility fee reading

import { Contract, parseUnits, formatUnits, MaxUint256, AbiCoder, ZeroAddress, solidityPacked } from 'ethers'
import { ProtocolProxy, SwapParams, SwapResult, QuoteParams, QuoteResult } from '../ProtocolProxy.js'
import { UNISWAP_V4_POOL_MANAGER_ABI } from '../abis/uniswapV4PoolManager.js'
import { UNISWAP_V4_STATE_VIEW_ABI } from '../abis/uniswapV4StateView.js'
import { UNISWAP_V4_QUOTER_ABI } from '../abis/uniswapV4Quoter.js'
import { UNISWAP_V4_UNIVERSAL_ROUTER_ABI, UNIVERSAL_ROUTER_COMMANDS, V4_ACTIONS } from '../abis/uniswapV4UniversalRouter.js'
import { ERC20_ABI } from '../abis/erc20.js'
import { PERMIT2_ABI, PERMIT2_ADDRESS } from '../abis/permit2.js'
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

// MegaQuantRouter ABI (limit order functions)
const MEGA_QUANT_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' }
        ],
        name: 'key',
        type: 'tuple'
      },
      { name: 'tickLower', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' },
      { name: 'amountIn', type: 'uint256' }
    ],
    name: 'placeLimitOrder',
    outputs: [{ name: 'orderId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      {
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' }
        ],
        name: 'key',
        type: 'tuple'
      },
      { name: 'tickLower', type: 'int24' },
      { name: 'zeroForOne', type: 'bool' }
    ],
    name: 'cancelLimitOrder',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const

// MegaQuantHook ABI (volatility fee reading)
const MEGA_QUANT_HOOK_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' }
        ],
        name: 'key',
        type: 'tuple'
      }
    ],
    name: 'getVolatilityFee',
    outputs: [{ name: 'fee', type: 'uint24' }],
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
  private readonly DEFAULT_FEE = 3000 // 0.3% fee tier
  private readonly DEFAULT_TICK_SPACING = 60 // Standard tick spacing for 0.3% fee
  private readonly NO_HOOKS = ZeroAddress // No hooks by default

  constructor(
    chainName: string,
    chainId: number,
    wallet: Wallet,
    executionId: string,
    strategyId: string
  ) {
    super(chainName, chainId, wallet, 'uniswap-v4', executionId, strategyId)

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

    console.log(`[UniswapV4] Initialized on ${chainName}`)
    console.log(`[UniswapV4] PoolManager: ${chainConfig.uniswapV4.poolManager}`)
    console.log(`[UniswapV4] Quoter: ${chainConfig.uniswapV4.quoter}`)
    console.log(`[UniswapV4] StateView: ${chainConfig.uniswapV4.stateView}`)
    console.log(`[UniswapV4] UniversalRouter: ${chainConfig.uniswapV4.universalRouter}`)
    console.log(`[UniswapV4] Permit2: ${PERMIT2_ADDRESS}`)
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
      const poolKey = params.poolKey || this.createCustomPoolKey(
        tokenInInfo.address,
        tokenOutInfo.address,
        params.fee || this.DEFAULT_FEE,
        params.tickSpacing || this.DEFAULT_TICK_SPACING,
        params.hookData ? params.hookData : this.NO_HOOKS
      )

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

      // 6. Approve tokens via Permit2 (two-step approval) - Skip for native ETH
      const isNativeEth = tokenInInfo.address === '0x0000000000000000000000000000000000000000'
      if (!isNativeEth) {
        await this.approveTokenViaPermit2(tokenInInfo.address, amountIn)
      } else {
        console.log(`[UniswapV4] Skipping approval for native ETH`)
      }

      // 7. Determine swap direction
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

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

      // 12. Execute swap via Universal Router
      const txOptions: Record<string, unknown> = {
        gasLimit: 500000 // V4 swaps can use more gas
      }

      // If swapping native ETH, include value
      if (isNativeEth) {
        txOptions.value = amountIn
        console.log(`[UniswapV4] Sending ${formatUnits(amountIn, 18)} ETH with transaction`)
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

      // 13. Calculate gas cost
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

      // 17. Record trade with slippage data
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
        execution_price: slippageData.executionPrice
      })

      // Build explorer URL
      const explorerUrl = `${chainConfig.blockExplorer}/tx/${txHash}`

      return {
        success: true,
        transactionHash: txHash,
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

    const poolKey = this.createCustomPoolKey(
      tokenInInfo.address,
      tokenOutInfo.address,
      fee,
      tickSpacing
    )

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
   * @param params Limit order parameters
   * @param megaQuantRouterAddress Address of the deployed MegaQuantRouter contract
   * @returns Limit order result with orderId and tx details
   */
  async limitOrder(
    params: LimitOrderParams,
    megaQuantRouterAddress: string
  ): Promise<LimitOrderResult> {
    console.log(`[UniswapV4] Placing limit order: ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut} at tick ${params.tick}`)

    try {
      const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

      const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)

      // Create pool key
      const poolKey = this.createCustomPoolKey(
        tokenInInfo.address,
        tokenOutInfo.address,
        this.DEFAULT_FEE,
        this.DEFAULT_TICK_SPACING
      )

      // Determine swap direction
      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

      // Approve token for MegaQuantRouter
      await this.approveTokenForAddress(tokenInInfo.address, amountIn, megaQuantRouterAddress)

      // Create MegaQuantRouter contract instance
      const megaQuantRouter = new Contract(
        megaQuantRouterAddress,
        MEGA_QUANT_ROUTER_ABI,
        this.wallet
      )

      // Place limit order
      const tx = await megaQuantRouter.placeLimitOrder(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        params.tick,
        zeroForOne,
        amountIn
      )

      console.log(`[UniswapV4] Limit order tx submitted: ${tx.hash}`)

      const receipt = await tx.wait()
      console.log(`[UniswapV4] Limit order confirmed in block ${receipt.blockNumber}`)

      // Parse orderId from logs
      let orderId = tx.hash // fallback to tx hash
      for (const log of receipt.logs) {
        try {
          const parsed = megaQuantRouter.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          })
          if (parsed && parsed.args.orderId) {
            orderId = parsed.args.orderId
            break
          }
        } catch {
          // Continue searching
        }
      }

      const deadlineSeconds = params.deadline || 86400 // Default 24 hours

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
   * Cancel a pending limit order via MegaQuantRouter contract.
   * @param tokenIn Input token symbol
   * @param tokenOut Output token symbol
   * @param tick Tick of the limit order to cancel
   * @param megaQuantRouterAddress Address of the deployed MegaQuantRouter contract
   * @returns Transaction hash of the cancellation
   */
  async cancelLimitOrder(
    tokenIn: string,
    tokenOut: string,
    tick: number,
    megaQuantRouterAddress: string
  ): Promise<{ success: boolean; txHash: string }> {
    console.log(`[UniswapV4] Cancelling limit order at tick ${tick}`)

    try {
      const tokenInInfo = getTokenInfo(this.chainName, tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, tokenOut)

      const poolKey = this.createCustomPoolKey(
        tokenInInfo.address,
        tokenOutInfo.address,
        this.DEFAULT_FEE,
        this.DEFAULT_TICK_SPACING
      )

      const zeroForOne = this.isZeroForOne(tokenInInfo.address, tokenOutInfo.address, poolKey)

      const megaQuantRouter = new Contract(
        megaQuantRouterAddress,
        MEGA_QUANT_ROUTER_ABI,
        this.wallet
      )

      const tx = await megaQuantRouter.cancelLimitOrder(
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        tick,
        zeroForOne
      )

      console.log(`[UniswapV4] Cancel tx submitted: ${tx.hash}`)
      await tx.wait()
      console.log(`[UniswapV4] Limit order cancelled successfully`)

      return { success: true, txHash: tx.hash }
    } catch (error: any) {
      console.error('[UniswapV4] Cancel limit order failed:', error)
      throw new Error(`Cancel limit order failed: ${error.message}`)
    }
  }

  /**
   * Read the current volatility-adjusted fee from MegaQuantHook.
   * The hook dynamically adjusts fees based on market volatility.
   * @param tokenA First token symbol
   * @param tokenB Second token symbol
   * @param hookAddress Address of the MegaQuantHook contract
   * @returns Current dynamic fee in basis points (e.g., 3000 = 0.3%)
   */
  async getVolatilityFee(
    tokenA: string,
    tokenB: string,
    hookAddress: string
  ): Promise<{ fee: number; feePercentage: string }> {
    console.log(`[UniswapV4] Reading volatility fee from hook ${hookAddress}`)

    try {
      const tokenAInfo = getTokenInfo(this.chainName, tokenA)
      const tokenBInfo = getTokenInfo(this.chainName, tokenB)

      const poolKey = this.createCustomPoolKey(
        tokenAInfo.address,
        tokenBInfo.address,
        this.DEFAULT_FEE,
        this.DEFAULT_TICK_SPACING,
        hookAddress
      )

      const hookContract = new Contract(
        hookAddress,
        MEGA_QUANT_HOOK_ABI,
        this.wallet.provider!
      )

      const fee = await hookContract.getVolatilityFee([
        poolKey.currency0,
        poolKey.currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks
      ])

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
}
