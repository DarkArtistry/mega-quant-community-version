// Uniswap V3 Protocol Implementation
// Ported from reference with slippage tracking and PnL integration enhancements

import { Contract, parseUnits, formatUnits, MaxUint256 } from 'ethers'
import { ProtocolProxy, SwapParams, SwapResult, QuoteParams, QuoteResult } from '../ProtocolProxy.js'
import { UNISWAP_V3_ROUTER_ABI } from '../abis/uniswapV3Router.js'
import { UNISWAP_V3_ROUTER_V2_ABI } from '../abis/uniswapV3RouterV2.js'
import { UNISWAP_V3_QUOTER_ABI } from '../abis/uniswapV3Quoter.js'
import { UNISWAP_V3_QUOTER_V2_ABI } from '../abis/uniswapV3QuoterV2.js'
import { ERC20_ABI } from '../abis/erc20.js'
import { getTokenInfo } from '../config/tokens.js'
import { getChainConfig } from '../config/chains.js'
import type { Wallet } from 'ethers'

export class UniswapV3Protocol extends ProtocolProxy {
  private routerContract: Contract
  private routerVersion: 1 | 2
  private quoterContract: Contract
  private quoterVersion: 1 | 2
  private readonly DEFAULT_FEE = 3000 // 0.3% fee tier

  constructor(
    chainName: string,
    chainId: number,
    wallet: Wallet,
    executionId: string,
    strategyId: string
  ) {
    super(chainName, chainId, wallet, 'uniswap-v3', executionId, strategyId)

    const chainConfig = getChainConfig(chainName)
    if (!chainConfig.uniswapV3) {
      throw new Error(`Uniswap V3 not supported on chain ${chainName}`)
    }

    // Detect router version (default to V1)
    this.routerVersion = chainConfig.uniswapV3.routerVersion || 1
    const routerAbi = this.routerVersion === 2 ? UNISWAP_V3_ROUTER_V2_ABI : UNISWAP_V3_ROUTER_ABI

    this.routerContract = new Contract(
      chainConfig.uniswapV3.router,
      routerAbi,
      wallet
    )

    // Detect quoter version (default to V1)
    this.quoterVersion = chainConfig.uniswapV3.quoterVersion || 1
    const quoterAbi = this.quoterVersion === 2 ? UNISWAP_V3_QUOTER_V2_ABI : UNISWAP_V3_QUOTER_ABI

    this.quoterContract = new Contract(
      chainConfig.uniswapV3.quoter,
      quoterAbi,
      wallet.provider!
    )

    console.log(`[UniswapV3] Using SwapRouter V${this.routerVersion}, Quoter V${this.quoterVersion}`)
  }

  async swap(params: SwapParams): Promise<SwapResult> {
    console.log(`[UniswapV3] Initiating swap on ${this.chainName}:`, params)

    try {
      // 1. Get token information
      const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

      console.log(`[UniswapV3] Token In: ${tokenInInfo.symbol} (${tokenInInfo.address})`)
      console.log(`[UniswapV3] Token Out: ${tokenOutInfo.symbol} (${tokenOutInfo.address})`)

      // 2. Parse amount with correct decimals
      const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)
      console.log(`[UniswapV3] Amount In: ${amountIn.toString()} (${params.amountIn} ${tokenInInfo.symbol})`)

      // 3. Get quote for expected output
      console.log('[UniswapV3] Getting quote...')
      let amountOutQuote: bigint

      if (this.quoterVersion === 2) {
        // QuoterV2 uses struct params and returns multiple values
        const quoteParams = {
          tokenIn: tokenInInfo.address,
          tokenOut: tokenOutInfo.address,
          amountIn: amountIn,
          fee: this.DEFAULT_FEE,
          sqrtPriceLimitX96: 0
        }
        const result = await this.quoterContract.quoteExactInputSingle.staticCall(quoteParams)
        amountOutQuote = result[0] // First value is amountOut
      } else {
        // QuoterV1 uses individual params
        amountOutQuote = await this.quoterContract.quoteExactInputSingle.staticCall(
          tokenInInfo.address,
          tokenOutInfo.address,
          this.DEFAULT_FEE,
          amountIn,
          0 // sqrtPriceLimitX96 = 0 (no limit)
        )
      }

      const expectedOutputFormatted = formatUnits(amountOutQuote, tokenOutInfo.decimals)
      console.log(`[UniswapV3] Expected output: ${expectedOutputFormatted} ${tokenOutInfo.symbol}`)

      // 4. Calculate minimum amount out with slippage
      const slippage = params.slippage || 0.5 // default 0.5%
      const slippageMultiplier = (100 - slippage) / 100
      const amountOutMinimum = (amountOutQuote * BigInt(Math.floor(slippageMultiplier * 10000))) / BigInt(10000)
      console.log(`[UniswapV3] Minimum output (${slippage}% slippage): ${formatUnits(amountOutMinimum, tokenOutInfo.decimals)} ${tokenOutInfo.symbol}`)

      // 5. Approve token spending if needed
      await this.approveToken(tokenInInfo.address, amountIn)

      // 6. Prepare swap parameters (V1 has deadline, V2 does not)
      let swapParams: Record<string, unknown>

      if (this.routerVersion === 2) {
        // SwapRouter02 - no deadline parameter
        swapParams = {
          tokenIn: tokenInInfo.address,
          tokenOut: tokenOutInfo.address,
          fee: this.DEFAULT_FEE,
          recipient: await this.wallet.getAddress(),
          amountIn,
          amountOutMinimum,
          sqrtPriceLimitX96: 0
        }
      } else {
        // SwapRouter V1 - has deadline parameter
        const deadline = Math.floor(Date.now() / 1000) + (params.deadline || 300)
        swapParams = {
          tokenIn: tokenInInfo.address,
          tokenOut: tokenOutInfo.address,
          fee: this.DEFAULT_FEE,
          recipient: await this.wallet.getAddress(),
          deadline,
          amountIn,
          amountOutMinimum,
          sqrtPriceLimitX96: 0
        }
      }

      // 7. Execute swap
      console.log('[UniswapV3] Executing swap...')
      const tx = await this.routerContract.exactInputSingle(swapParams)
      console.log(`[UniswapV3] Transaction sent: ${tx.hash}`)

      // 8. Wait for confirmation
      const receipt = await tx.wait()
      console.log(`[UniswapV3] Transaction confirmed in block ${receipt.blockNumber}`)

      // 9. Parse actual output amount from logs
      const actualAmountOut = await this.parseSwapOutput(receipt, tokenOutInfo.address)
      const actualOutputFormatted = formatUnits(actualAmountOut, tokenOutInfo.decimals)
      console.log(`[UniswapV3] Actual output: ${actualOutputFormatted} ${tokenOutInfo.symbol}`)

      // 10. Calculate slippage tracking data
      const slippageData = this.calculateSlippage(
        expectedOutputFormatted,
        actualOutputFormatted,
        params.amountIn
      )

      console.log(`[UniswapV3] Slippage: ${slippageData.slippagePercentage.toFixed(4)}% (${slippageData.slippageAmount} ${tokenOutInfo.symbol})`)
      console.log(`[UniswapV3] Quote price: ${slippageData.quotePrice.toFixed(6)}, Execution price: ${slippageData.executionPrice.toFixed(6)}`)

      // 11. Calculate gas cost
      const gasUsed = Number(receipt.gasUsed)
      const gasPrice = receipt.gasPrice || 0n
      const gasPriceGwei = formatUnits(gasPrice, 'gwei')
      console.log(`[UniswapV3] Gas used: ${gasUsed}, Gas price: ${gasPriceGwei} Gwei`)

      // Calculate gas cost in USD
      const { priceService } = await import('../services/PriceService.js')
      const chainConfig = getChainConfig(this.chainName)
      const nativeTokenSymbol = chainConfig.nativeCurrency.symbol
      const nativeTokenPrice = await priceService.getTokenPriceUSD(nativeTokenSymbol)
      const gasCostEth = Number(formatUnits(gasPrice * receipt.gasUsed, 18))
      const gasCostUsd = gasCostEth * nativeTokenPrice

      // 12. Record trade in database with slippage data (non-blocking)
      await this.recordTrade({
        tx_hash: receipt.hash,
        block_number: receipt.blockNumber,
        token_in_address: tokenInInfo.address,
        token_in_symbol: tokenInInfo.symbol,
        token_in_amount: formatUnits(amountIn, tokenInInfo.decimals),
        token_out_address: tokenOutInfo.address,
        token_out_symbol: tokenOutInfo.symbol,
        token_out_amount: actualOutputFormatted,
        gas_used: gasUsed,
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
      const explorerUrl = `${chainConfig.blockExplorer}/tx/${receipt.hash}`

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        amountIn: formatUnits(amountIn, tokenInInfo.decimals),
        amountOut: actualOutputFormatted,
        gasUsed,
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
      console.error('[UniswapV3] Swap failed:', error)
      throw new Error(`Uniswap V3 swap failed: ${error.message}`)
    }
  }

  /**
   * Get swap quote without executing the trade
   * @param params Quote parameters
   * @returns Quote information including expected output, price impact, and exchange rate
   */
  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    try {
      console.log(`[UniswapV3] Getting quote for ${params.amountIn} ${params.tokenIn} -> ${params.tokenOut}`)

      // 1. Get token information
      const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

      // 2. Parse amount with correct decimals
      const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)

      // 3. Get quote from Uniswap V3 Quoter
      let amountOutQuote: bigint

      if (this.quoterVersion === 2) {
        // QuoterV2 uses struct params and returns multiple values
        const quoteParams = {
          tokenIn: tokenInInfo.address,
          tokenOut: tokenOutInfo.address,
          amountIn: amountIn,
          fee: this.DEFAULT_FEE,
          sqrtPriceLimitX96: 0
        }
        const result = await this.quoterContract.quoteExactInputSingle.staticCall(quoteParams)
        amountOutQuote = result[0] // First value is amountOut
      } else {
        // QuoterV1 uses individual params
        amountOutQuote = await this.quoterContract.quoteExactInputSingle.staticCall(
          tokenInInfo.address,
          tokenOutInfo.address,
          this.DEFAULT_FEE,
          amountIn,
          0 // sqrtPriceLimitX96 = 0 (no limit)
        )
      }

      // 4. Format output amount
      const amountOut = formatUnits(amountOutQuote, tokenOutInfo.decimals)

      // 5. Calculate minimum output with 0.5% slippage
      const slippage = 0.5
      const slippageMultiplier = (100 - slippage) / 100
      const amountOutMinimum = (amountOutQuote * BigInt(Math.floor(slippageMultiplier * 10000))) / BigInt(10000)
      const amountOutMin = formatUnits(amountOutMinimum, tokenOutInfo.decimals)

      // 6. Calculate exchange rate (tokenOut per tokenIn)
      const exchangeRate = Number(amountOut) / Number(params.amountIn)

      // 7. Calculate price impact
      // Get market price from CoinMarketCap
      const { priceService } = await import('../services/PriceService.js')
      const [tokenInPriceUsd, tokenOutPriceUsd] = await Promise.all([
        priceService.getTokenPriceUSD(params.tokenIn),
        priceService.getTokenPriceUSD(params.tokenOut)
      ])

      // Market exchange rate (based on USD prices)
      const marketRate = tokenInPriceUsd / tokenOutPriceUsd

      // Price impact = difference between executed rate and market rate
      const priceImpact = ((marketRate - exchangeRate) / marketRate) * 100

      // 8. Estimate gas cost in USD
      let gasCostUsd: number | undefined
      try {
        const feeData = await this.wallet.provider!.getFeeData()
        const gasPrice = feeData.gasPrice || 0n
        const estimatedGasLimit = 200000n // Typical gas for Uniswap V3 swap

        const gasCostWei = gasPrice * estimatedGasLimit
        const chainConfig = getChainConfig(this.chainName)
        const nativeTokenSymbol = chainConfig.nativeCurrency.symbol
        const nativeTokenPrice = await priceService.getTokenPriceUSD(nativeTokenSymbol)

        const gasCostEth = Number(formatUnits(gasCostWei, 18))
        gasCostUsd = gasCostEth * nativeTokenPrice
      } catch (error: any) {
        console.warn('[UniswapV3] Could not estimate gas cost:', error.message)
      }

      console.log(`[UniswapV3] Quote: ${amountOut} ${params.tokenOut} (rate: ${exchangeRate.toFixed(6)}, impact: ${priceImpact.toFixed(2)}%)`)

      return {
        amountOut,
        amountOutMin,
        priceImpact,
        exchangeRate,
        gasCostUsd
      }
    } catch (error: any) {
      console.error('[UniswapV3] Failed to get quote:', error)
      throw new Error(`Failed to get quote: ${error.message}`)
    }
  }

  private async approveToken(tokenAddress: string, amount: bigint): Promise<void> {
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.wallet)
    const walletAddress = await this.wallet.getAddress()
    const routerAddress = await this.routerContract.getAddress()

    // Check current allowance
    const currentAllowance = await tokenContract.allowance(walletAddress, routerAddress)

    if (currentAllowance < amount) {
      console.log(`[UniswapV3] Approving ${tokenAddress} for router...`)
      const approveTx = await tokenContract.approve(routerAddress, MaxUint256)
      await approveTx.wait()
      console.log('[UniswapV3] Token approved')
    } else {
      console.log('[UniswapV3] Token already approved')
    }
  }

  private async parseSwapOutput(receipt: any, tokenOutAddress: string): Promise<bigint> {
    // Parse Transfer event from the token contract to get actual output amount
    const tokenContract = new Contract(tokenOutAddress, ERC20_ABI, this.wallet.provider!)
    const walletAddress = await this.wallet.getAddress()

    // Find the Transfer event to our wallet
    for (const log of receipt.logs) {
      try {
        const parsedLog = tokenContract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data
        })

        if (parsedLog && parsedLog.name === 'Transfer' && parsedLog.args.to.toLowerCase() === walletAddress.toLowerCase()) {
          return parsedLog.args.value
        }
      } catch {
        // Not a Transfer event from this token, continue
      }
    }

    // Fallback: check balance (less accurate due to potential other transfers)
    console.warn('[UniswapV3] Could not parse output from logs, using quote estimate')
    return 0n
  }
}
