// 1inch Protocol Implementation
// Ported from reference with slippage tracking and PnL integration enhancements
// Uses 1inch API v6.0 for swap aggregation across 300+ DEXs

import { Contract, parseUnits, formatUnits } from 'ethers'
import { ProtocolProxy, SwapParams, SwapResult, QuoteParams, QuoteResult } from '../ProtocolProxy.js'
import { ERC20_ABI } from '../abis/erc20.js'
import { getTokenInfo } from '../config/tokens.js'
import { getChainConfig } from '../config/chains.js'
import type { Wallet } from 'ethers'
import axios from 'axios'
import { apiKeyStore } from '../../../services/api-key-store.js'

// 1inch API v6.0 configuration
const ONEINCH_API_BASE = 'https://api.1inch.dev/swap/v6.0'

// Native ETH address used by 1inch
const NATIVE_ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

export class OneInchProtocol extends ProtocolProxy {
  private apiKey: string

  constructor(
    chainName: string,
    chainId: number,
    wallet: Wallet,
    executionId: string,
    strategyId: string,
    accountId?: string
  ) {
    super(chainName, chainId, wallet, '1inch', executionId, strategyId, accountId)

    // Get API key from in-memory store (loaded on app unlock)
    this.apiKey = apiKeyStore.getOneInchApiKey() || ''

    if (!this.apiKey) {
      console.warn('[OneInch] Warning: 1inch API key not set - API calls may fail')
      console.warn('[OneInch] Make sure to configure the API key in Settings and unlock the app')
    }

    console.log(`[OneInch] Initialized on ${chainName} (Chain ID: ${chainId})`)
  }

  /**
   * Get quote from 1inch aggregator
   * Finds best price across 300+ DEXs
   */
  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    console.log(`[OneInch] Getting quote on ${this.chainName}:`, params)

    try {
      // 1. Get token information
      const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

      console.log(`[OneInch] Token In: ${tokenInInfo.symbol} (${tokenInInfo.address})`)
      console.log(`[OneInch] Token Out: ${tokenOutInfo.symbol} (${tokenOutInfo.address})`)

      // 2. Convert to 1inch token addresses (handle native ETH)
      const srcToken = this.convertToOneInchAddress(tokenInInfo.address, tokenInInfo.symbol)
      const dstToken = this.convertToOneInchAddress(tokenOutInfo.address, tokenOutInfo.symbol)

      // 3. Parse amount with correct decimals
      const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)
      console.log(`[OneInch] Amount In: ${amountIn.toString()} (${params.amountIn} ${tokenInInfo.symbol})`)

      // 4. Call 1inch quote API
      const url = `${ONEINCH_API_BASE}/${this.chainId}/quote`
      const quoteParams = {
        src: srcToken,
        dst: dstToken,
        amount: amountIn.toString()
      }

      console.log('[OneInch] Fetching quote from 1inch API...')
      const response = await axios.get(url, {
        params: quoteParams,
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        timeout: 10000
      })

      const quoteData = response.data

      // 5. Parse response
      const amountOut = formatUnits(quoteData.dstAmount, tokenOutInfo.decimals)
      console.log(`[OneInch] Expected output: ${amountOut} ${tokenOutInfo.symbol}`)

      // 6. Calculate minimum amount with 0.5% slippage
      const slippage = 0.5
      const slippageMultiplier = (100 - slippage) / 100
      const amountOutMin = (parseFloat(amountOut) * slippageMultiplier).toString()

      // 7. Calculate exchange rate
      const exchangeRate = parseFloat(amountOut) / parseFloat(params.amountIn)

      // 8. Estimate price impact (if available from API)
      const priceImpact = quoteData.estimatedGas ? 0.1 : 0 // Placeholder

      // 9. Get gas estimate
      let gasCostUsd: number | undefined
      if (quoteData.estimatedGas) {
        try {
          const feeData = await this.wallet.provider!.getFeeData()
          const gasCostWei = BigInt(quoteData.estimatedGas) * (feeData.gasPrice || 0n)

          // Get native token price
          const { priceService } = await import('../services/PriceService.js')
          const chainConfig = getChainConfig(this.chainName)
          const nativeTokenPrice = await priceService.getTokenPriceUSD(chainConfig.nativeCurrency.symbol)

          const gasCostEth = Number(formatUnits(gasCostWei, 18))
          gasCostUsd = gasCostEth * nativeTokenPrice

          console.log(`[OneInch] Estimated gas cost: $${gasCostUsd.toFixed(2)}`)
        } catch (error: any) {
          console.warn('[OneInch] Could not estimate gas cost:', error.message)
        }
      }

      return {
        amountOut,
        amountOutMin,
        priceImpact,
        exchangeRate,
        gasCostUsd
      }
    } catch (error: any) {
      console.error('[OneInch] Quote error:', error.message)
      if (error.response?.data) {
        console.error('[OneInch] API error details:', JSON.stringify(error.response.data, null, 2))
      }
      if (error.response?.status) {
        console.error('[OneInch] HTTP Status:', error.response.status)
      }
      const errorMsg = error.response?.data?.description || error.response?.data?.error || error.message
      throw new Error(`1inch quote failed: ${errorMsg}`)
    }
  }

  /**
   * Execute swap via 1inch aggregator
   * Automatically routes through best DEXs
   * Enhanced with slippage tracking between quote and actual execution
   */
  async swap(params: SwapParams): Promise<SwapResult> {
    console.log(`[OneInch] Initiating swap on ${this.chainName}:`, params)

    try {
      // 1. Get token information
      const tokenInInfo = getTokenInfo(this.chainName, params.tokenIn)
      const tokenOutInfo = getTokenInfo(this.chainName, params.tokenOut)

      console.log(`[OneInch] Token In: ${tokenInInfo.symbol} (${tokenInInfo.address})`)
      console.log(`[OneInch] Token Out: ${tokenOutInfo.symbol} (${tokenOutInfo.address})`)

      // 2. Convert to 1inch token addresses
      const srcToken = this.convertToOneInchAddress(tokenInInfo.address, tokenInInfo.symbol)
      const dstToken = this.convertToOneInchAddress(tokenOutInfo.address, tokenOutInfo.symbol)

      // 3. Parse amount with correct decimals
      const amountIn = parseUnits(params.amountIn, tokenInInfo.decimals)
      console.log(`[OneInch] Amount In: ${amountIn.toString()} (${params.amountIn} ${tokenInInfo.symbol})`)

      // 4. Get wallet address
      const fromAddress = await this.wallet.getAddress()

      // 5. Get pre-swap quote for slippage tracking
      console.log('[OneInch] Getting pre-swap quote for slippage tracking...')
      let expectedOutputFormatted: string | undefined
      try {
        const preQuote = await this.getQuote({
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn
        })
        expectedOutputFormatted = preQuote.amountOut
        console.log(`[OneInch] Pre-swap expected output: ${expectedOutputFormatted} ${tokenOutInfo.symbol}`)
      } catch (quoteError: any) {
        console.warn('[OneInch] Pre-swap quote failed (continuing with swap):', quoteError.message)
      }

      // 6. Approve token if not native ETH
      if (tokenInInfo.symbol !== 'ETH' && tokenInInfo.address !== '0x0000000000000000000000000000000000000000') {
        await this.approveOneInch(tokenInInfo.address, amountIn)
      }

      // 7. Record balance before swap for accurate slippage tracking
      let balanceBefore = 0n
      if (tokenOutInfo.address !== '0x0000000000000000000000000000000000000000') {
        const tokenOutContract = new Contract(tokenOutInfo.address, ERC20_ABI, this.wallet.provider!)
        balanceBefore = await tokenOutContract.balanceOf(fromAddress)
      }

      // 8. Call 1inch swap API
      const url = `${ONEINCH_API_BASE}/${this.chainId}/swap`
      const slippage = params.slippage || 0.5
      const swapParams = {
        src: srcToken,
        dst: dstToken,
        amount: amountIn.toString(),
        from: fromAddress,
        slippage: slippage.toString(),
        disableEstimate: 'false',
        allowPartialFill: 'false'
      }

      console.log('[OneInch] Fetching swap transaction from 1inch API...')
      const response = await axios.get(url, {
        params: swapParams,
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        timeout: 15000
      })

      const swapData = response.data

      // Capture the API's expected output for slippage tracking
      const apiExpectedOutput = formatUnits(swapData.dstAmount, tokenOutInfo.decimals)
      if (!expectedOutputFormatted) {
        expectedOutputFormatted = apiExpectedOutput
      }

      // 9. Execute transaction
      console.log('[OneInch] Executing swap transaction...')
      const tx = await this.wallet.sendTransaction({
        to: swapData.tx.to,
        data: swapData.tx.data,
        value: swapData.tx.value,
        gasLimit: swapData.tx.gas || undefined
      })

      console.log(`[OneInch] Transaction sent: ${tx.hash}`)

      // 10. Wait for confirmation
      const receipt = await tx.wait()
      console.log(`[OneInch] Transaction confirmed in block ${receipt!.blockNumber}`)

      // 11. Get actual output amount from balance difference
      let actualOutputFormatted: string
      if (tokenOutInfo.address !== '0x0000000000000000000000000000000000000000') {
        const tokenOutContract = new Contract(tokenOutInfo.address, ERC20_ABI, this.wallet.provider!)
        const balanceAfter = await tokenOutContract.balanceOf(fromAddress)
        const actualDelta = balanceAfter - balanceBefore
        actualOutputFormatted = formatUnits(
          actualDelta > 0n ? actualDelta : BigInt(swapData.dstAmount),
          tokenOutInfo.decimals
        )
      } else {
        // For native ETH output, use the API's expected output
        actualOutputFormatted = apiExpectedOutput
      }

      console.log(`[OneInch] Actual output: ${actualOutputFormatted} ${tokenOutInfo.symbol}`)

      // 12. Calculate slippage tracking data
      let slippageData: {
        slippageAmount: string
        slippagePercentage: number
        quotePrice: number
        executionPrice: number
      } | undefined

      if (expectedOutputFormatted) {
        slippageData = this.calculateSlippage(
          expectedOutputFormatted,
          actualOutputFormatted,
          params.amountIn
        )

        console.log(`[OneInch] Slippage: ${slippageData.slippagePercentage.toFixed(4)}% (${slippageData.slippageAmount} ${tokenOutInfo.symbol})`)
        console.log(`[OneInch] Quote price: ${slippageData.quotePrice.toFixed(6)}, Execution price: ${slippageData.executionPrice.toFixed(6)}`)
      }

      // 13. Fetch block timestamp for accurate PnL time-series
      let blockTimestamp: string | undefined
      try {
        const block = await this.wallet.provider!.getBlock(receipt!.blockNumber)
        if (block) {
          blockTimestamp = new Date(block.timestamp * 1000).toISOString()
        }
      } catch (error: any) {
        console.warn('[OneInch] Could not fetch block timestamp:', error.message)
      }

      // 14. Calculate gas cost
      const gasUsed = Number(receipt!.gasUsed)
      const gasPrice = receipt!.gasPrice || 0n
      const gasCostWei = receipt!.gasUsed * gasPrice

      let gasCostUsd = 0
      try {
        const { priceService } = await import('../services/PriceService.js')
        const chainConfig = getChainConfig(this.chainName)
        const nativeTokenPrice = await priceService.getTokenPriceUSD(chainConfig.nativeCurrency.symbol)
        const gasCostEth = Number(formatUnits(gasCostWei, 18))
        gasCostUsd = gasCostEth * nativeTokenPrice
      } catch (error) {
        console.warn('[OneInch] Could not calculate gas cost in USD')
      }

      // 15. Record trade in database with slippage data
      const chainConfig = getChainConfig(this.chainName)

      await this.recordTrade({
        tx_hash: tx.hash,
        block_number: receipt!.blockNumber,
        token_in_address: tokenInInfo.address,
        token_in_symbol: tokenInInfo.symbol,
        token_in_amount: params.amountIn,
        token_out_address: tokenOutInfo.address,
        token_out_symbol: tokenOutInfo.symbol,
        token_out_amount: actualOutputFormatted,
        gas_used: gasUsed,
        gas_price_gwei: formatUnits(gasPrice, 'gwei'),
        gas_cost_usd: gasCostUsd,
        // Enhanced slippage tracking fields
        expected_output: expectedOutputFormatted,
        slippage_amount: slippageData?.slippageAmount,
        slippage_percentage: slippageData?.slippagePercentage,
        quote_price: slippageData?.quotePrice,
        execution_price: slippageData?.executionPrice,
        block_timestamp: blockTimestamp
      })

      // 15. Get explorer URL
      const explorerUrl = `${chainConfig.blockExplorer}/tx/${tx.hash}`

      return {
        success: true,
        transactionHash: tx.hash,
        blockNumber: receipt!.blockNumber,
        amountIn: params.amountIn,
        amountOut: actualOutputFormatted,
        gasUsed,
        gasCostUsd,
        timestamp: Date.now(),
        explorerUrl,
        // Slippage tracking in result
        expectedOutput: expectedOutputFormatted,
        slippageAmount: slippageData?.slippageAmount,
        slippagePercentage: slippageData?.slippagePercentage,
        quotePrice: slippageData?.quotePrice,
        executionPrice: slippageData?.executionPrice
      }
    } catch (error: any) {
      console.error('[OneInch] Swap error:', error.message)
      if (error.response?.data) {
        console.error('[OneInch] API error details:', JSON.stringify(error.response.data, null, 2))
      }
      if (error.response?.status) {
        console.error('[OneInch] HTTP Status:', error.response.status)
      }
      const errorMsg = error.response?.data?.description || error.response?.data?.error || error.message
      throw new Error(`1inch swap failed: ${errorMsg}`)
    }
  }

  /**
   * Convert token address to 1inch format
   * Native ETH uses special address 0xEeee...
   */
  private convertToOneInchAddress(address: string, symbol: string): string {
    // Native ETH uses 0x0 in our system but 1inch expects 0xEeee...
    if (symbol === 'ETH' || address === '0x0000000000000000000000000000000000000000') {
      return NATIVE_ETH_ADDRESS
    }
    return address
  }

  /**
   * Approve 1inch router to spend tokens
   */
  private async approveOneInch(tokenAddress: string, amount: bigint): Promise<void> {
    try {
      // Get 1inch router address for approval
      const approvalUrl = `${ONEINCH_API_BASE}/${this.chainId}/approve/spender`
      const response = await axios.get(approvalUrl, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        timeout: 5000
      })

      const spenderAddress = response.data.address

      console.log(`[OneInch] Checking approval for 1inch router: ${spenderAddress}`)

      // Check current allowance
      const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.wallet)
      const currentAllowance = await tokenContract.allowance(
        await this.wallet.getAddress(),
        spenderAddress
      )

      if (currentAllowance < amount) {
        console.log('[OneInch] Insufficient allowance, approving tokens...')
        const approveTx = await tokenContract.approve(spenderAddress, amount)
        await approveTx.wait()
        console.log('[OneInch] Tokens approved')
      } else {
        console.log('[OneInch] Sufficient allowance already exists')
      }
    } catch (error: any) {
      console.error('[OneInch] Approval error:', error.message)
      throw new Error(`Token approval failed: ${error.message}`)
    }
  }
}
