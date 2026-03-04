// ChainProxy - Provides access to protocols on a specific chain
// Ported from reference, adapted for ethers v6 and new system architecture

import { JsonRpcProvider, Wallet, Contract, formatUnits, FetchRequest, Network } from 'ethers'
import { getChainConfig, type ChainConfig } from './config/chains.js'
import { TOKEN_ADDRESSES, type TokenInfo } from './config/tokens.js'
import { ChainlinkOracle } from './oracles/ChainlinkOracle.js'
import type { ProtocolProxy, SwapResult, QuoteResult } from './ProtocolProxy.js'
import type { DeltaTrade } from './DeltaTrade.js'

export class ChainProxy {
  public readonly chainName: string
  public readonly chainId: number
  public readonly provider: JsonRpcProvider
  public readonly wallet: Wallet
  public readonly deltaTrade: DeltaTrade
  public readonly accountId?: string

  // Token addresses for easy access
  public readonly tokens: Record<string, TokenInfo>

  // Lazy-initialized protocol proxies
  private _uniswapV3?: ProtocolProxy
  private _uniswapV4?: ProtocolProxy
  private _oneInch?: ProtocolProxy
  private _chainlinkOracle?: ChainlinkOracle
  private _chainConfig: ChainConfig

  constructor(chainName: string, privateKey: string, deltaTrade: DeltaTrade, accountId?: string) {
    this.chainName = chainName
    this.deltaTrade = deltaTrade

    // Get chain configuration (will resolve RPC URL dynamically)
    this._chainConfig = getChainConfig(chainName)
    this.chainId = this._chainConfig.chainId

    // Load token addresses for this chain
    this.tokens = TOKEN_ADDRESSES[chainName] || {}

    // Skip obviously bad URLs (placeholder keys)
    if (this._chainConfig.rpcUrl.includes('YOUR_KEY')) {
      throw new Error(`RPC URL for ${chainName} contains placeholder API key — skipping`)
    }

    // Set up provider with explicit network to skip eth_chainId detection (prevents infinite retry)
    const fetchReq = new FetchRequest(this._chainConfig.rpcUrl)
    fetchReq.timeout = 10_000
    const network = Network.from(this._chainConfig.chainId)
    this.provider = new JsonRpcProvider(fetchReq, network, { staticNetwork: network })
    this.wallet = new Wallet(privateKey, this.provider)
    this.accountId = accountId

    console.log(`[ChainProxy] Initialized ${chainName} (Chain ID: ${this.chainId})`)
    console.log(`[ChainProxy] Wallet address: ${this.wallet.address}`)
  }

  /**
   * Lazy-initialize and return the Uniswap V3 protocol proxy.
   * Protocol implementations are dynamically imported to avoid circular deps.
   */
  get uniswapV3(): ProtocolProxy | undefined {
    if (this._uniswapV3) return this._uniswapV3
    if (!this._chainConfig.uniswapV3) return undefined

    // Protocol will be initialized on first use via initProtocols()
    return this._uniswapV3
  }

  get uniswapV4(): ProtocolProxy | undefined {
    if (this._uniswapV4) return this._uniswapV4
    if (!this._chainConfig.uniswapV4) return undefined

    return this._uniswapV4
  }

  get oneInch(): ProtocolProxy | undefined {
    if (this._oneInch) return this._oneInch
    if (!this._chainConfig.oneInchSupported) return undefined

    return this._oneInch
  }

  get chainlink(): ChainlinkOracle | undefined {
    return this._chainlinkOracle
  }

  /**
   * Initialize protocol proxies.
   * Called separately to allow async dynamic imports.
   * Protocol implementations (UniswapV3Protocol, etc.) are expected at:
   *   ./protocols/UniswapV3Protocol.js
   *   ./protocols/UniswapV4Protocol.js
   *   ./protocols/OneInchProtocol.js
   */
  async initProtocols(): Promise<void> {
    if (this._chainConfig.uniswapV3) {
      try {
        const { UniswapV3Protocol } = await import('./protocols/UniswapV3Protocol.js')
        this._uniswapV3 = new UniswapV3Protocol(
          this.chainName,
          this.chainId,
          this.wallet,
          this.deltaTrade.executionId,
          this.deltaTrade.strategyId,
          this.accountId
        )
        console.log('[ChainProxy] Uniswap V3 protocol initialized')
      } catch (error: any) {
        console.warn(`[ChainProxy] Could not initialize Uniswap V3: ${error.message}`)
      }
    }

    if (this._chainConfig.uniswapV4) {
      try {
        const { UniswapV4Protocol } = await import('./protocols/UniswapV4Protocol.js')
        this._uniswapV4 = new UniswapV4Protocol(
          this.chainName,
          this.chainId,
          this.wallet,
          this.deltaTrade.executionId,
          this.deltaTrade.strategyId,
          this.accountId
        )
        console.log('[ChainProxy] Uniswap V4 protocol initialized')
      } catch (error: any) {
        console.warn(`[ChainProxy] Could not initialize Uniswap V4: ${error.message}`)
      }
    }

    if (this._chainConfig.oneInchSupported) {
      try {
        const { OneInchProtocol } = await import('./protocols/OneInchProtocol.js')
        this._oneInch = new OneInchProtocol(
          this.chainName,
          this.chainId,
          this.wallet,
          this.deltaTrade.executionId,
          this.deltaTrade.strategyId,
          this.accountId
        )
        console.log('[ChainProxy] 1inch protocol initialized')
      } catch (error: any) {
        console.warn(`[ChainProxy] Could not initialize 1inch: ${error.message}`)
      }
    }

    // Initialize Chainlink oracle on Ethereum mainnet only
    if (this.chainName === 'ethereum') {
      try {
        this._chainlinkOracle = new ChainlinkOracle(this.provider)
        console.log('[ChainProxy] Chainlink oracle initialized')
      } catch (error: any) {
        console.warn(`[ChainProxy] Could not initialize Chainlink oracle: ${error.message}`)
      }
    }
  }

  // ============================================================
  // Balance and Gas Helpers
  // ============================================================

  /**
   * Get native token balance (ETH, etc.)
   */
  async getNativeBalance(): Promise<bigint> {
    return await this.provider.getBalance(this.wallet.address)
  }

  /**
   * Get ERC20 token balance
   */
  async getTokenBalance(tokenAddress: string): Promise<bigint> {
    const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']
    const contract = new Contract(tokenAddress, ERC20_ABI, this.provider)
    return await contract.balanceOf(this.wallet.address)
  }

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<bigint> {
    const feeData = await this.provider.getFeeData()
    return feeData.gasPrice || 0n
  }

  /**
   * Get block explorer URL, optionally for a specific transaction
   */
  getExplorerUrl(txHash?: string): string {
    if (txHash) {
      return `${this._chainConfig.blockExplorer}/tx/${txHash}`
    }
    return this._chainConfig.blockExplorer
  }

  /**
   * Shorthand: get a clickable block explorer link for a transaction hash.
   * Usage: console.log(dt.sepolia.txLink(hash))
   */
  txLink(txHash: string): string {
    return `${this._chainConfig.blockExplorer}/tx/${txHash}`
  }

  /**
   * Get detailed gas price information including estimated swap cost in USD
   */
  async getGasPriceInfo(): Promise<{
    gasPrice: bigint
    gasPriceGwei: string
    estimatedSwapGasCostUsd?: number
  }> {
    const feeData = await this.provider.getFeeData()
    const gasPrice = feeData.gasPrice || 0n
    const gasPriceGwei = formatUnits(gasPrice, 'gwei')

    // Estimate typical swap gas cost (200k gas for Uniswap V3 swap)
    const typicalSwapGas = 200000n
    const gasCostWei = gasPrice * typicalSwapGas

    let estimatedSwapGasCostUsd: number | undefined
    try {
      const gasCostEth = Number(formatUnits(gasCostWei, 18))
      // Simple estimate: use a fixed ETH price as fallback
      // Protocol implementations should use a proper price service
      const ethPriceUsd = 2500 // conservative fallback
      estimatedSwapGasCostUsd = gasCostEth * ethPriceUsd
    } catch (error: any) {
      console.warn(`[ChainProxy] Could not calculate gas cost in USD:`, error.message)
    }

    return {
      gasPrice,
      gasPriceGwei,
      estimatedSwapGasCostUsd
    }
  }

  // ============================================================
  // Token Info Helpers
  // ============================================================

  /**
   * Get token info by symbol for this chain
   */
  getTokenInfo(symbol: string): TokenInfo | undefined {
    return this.tokens[symbol.toUpperCase()]
  }

  /**
   * Get token info by address for this chain (case-insensitive)
   */
  getTokenByAddress(address: string): TokenInfo | undefined {
    return Object.values(this.tokens).find(
      t => t.address.toLowerCase() === address.toLowerCase()
    )
  }

  /**
   * Get all token symbols available on this chain
   */
  getAvailableTokens(): string[] {
    return Object.keys(this.tokens)
  }

  // ============================================================
  // ETH Wrapping
  // ============================================================

  /**
   * Wrap native ETH into WETH (ERC20).
   * Required before swapping on Uniswap V3 which only handles ERC20 tokens.
   * @param amount Amount of ETH to wrap (e.g., '0.001')
   */
  async wrapETH(amount: string): Promise<string> {
    const wethInfo = this.tokens['WETH']
    if (!wethInfo) {
      throw new Error(`WETH not configured for ${this.chainName}`)
    }

    const WETH_ABI = ['function deposit() payable', 'function withdraw(uint256 wad)']
    const wethContract = new Contract(wethInfo.address, WETH_ABI, this.wallet)

    const value = BigInt(Math.floor(parseFloat(amount) * 1e18))
    console.log(`[ChainProxy] Wrapping ${amount} ETH -> WETH on ${this.chainName}...`)

    const tx = await wethContract.deposit({ value })
    const receipt = await tx.wait()
    console.log(`[ChainProxy] Wrapped ${amount} ETH -> WETH (tx: ${receipt.hash})`)
    return receipt.hash
  }

  /**
   * Unwrap WETH back to native ETH.
   * @param amount Amount of WETH to unwrap (e.g., '0.001')
   */
  async unwrapETH(amount: string): Promise<string> {
    const wethInfo = this.tokens['WETH']
    if (!wethInfo) {
      throw new Error(`WETH not configured for ${this.chainName}`)
    }

    const WETH_ABI = ['function deposit() payable', 'function withdraw(uint256 wad)']
    const wethContract = new Contract(wethInfo.address, WETH_ABI, this.wallet)

    const wad = BigInt(Math.floor(parseFloat(amount) * 1e18))
    console.log(`[ChainProxy] Unwrapping ${amount} WETH -> ETH on ${this.chainName}...`)

    const tx = await wethContract.withdraw(wad)
    const receipt = await tx.wait()
    console.log(`[ChainProxy] Unwrapped ${amount} WETH -> ETH (tx: ${receipt.hash})`)
    return receipt.hash
  }

  // ============================================================
  // Trading Methods
  // ============================================================

  /**
   * Get swap quote from Uniswap V3
   */
  async getSwapQuote(
    tokenInSymbol: string,
    tokenOutSymbol: string,
    amountIn: string
  ): Promise<QuoteResult> {
    if (!this._uniswapV3) {
      throw new Error(`Uniswap V3 not available on ${this.chainName}. Call initProtocols() first.`)
    }

    return await this._uniswapV3.getQuote({
      tokenIn: tokenInSymbol,
      tokenOut: tokenOutSymbol,
      amountIn
    })
  }

  /**
   * Execute a swap on Uniswap V3 (convenience method)
   */
  async swap(
    tokenInSymbol: string,
    tokenOutSymbol: string,
    amountIn: string,
    slippage?: number
  ): Promise<SwapResult> {
    if (!this._uniswapV3) {
      throw new Error(`Uniswap V3 not available on ${this.chainName}. Call initProtocols() first.`)
    }

    return await this._uniswapV3.swap({
      tokenIn: tokenInSymbol,
      tokenOut: tokenOutSymbol,
      amountIn,
      slippage
    })
  }

  /**
   * Get swap quote from Uniswap V4
   */
  async getSwapQuoteV4(
    tokenInSymbol: string,
    tokenOutSymbol: string,
    amountIn: string
  ): Promise<QuoteResult> {
    if (!this._uniswapV4) {
      throw new Error(`Uniswap V4 not available on ${this.chainName}. Call initProtocols() first.`)
    }

    return await this._uniswapV4.getQuote({
      tokenIn: tokenInSymbol,
      tokenOut: tokenOutSymbol,
      amountIn
    })
  }

  /**
   * Execute a swap on Uniswap V4 (convenience method)
   */
  async swapV4(
    tokenInSymbol: string,
    tokenOutSymbol: string,
    amountIn: string,
    slippage?: number
  ): Promise<SwapResult> {
    if (!this._uniswapV4) {
      throw new Error(`Uniswap V4 not available on ${this.chainName}. Call initProtocols() first.`)
    }

    return await this._uniswapV4.swap({
      tokenIn: tokenInSymbol,
      tokenOut: tokenOutSymbol,
      amountIn,
      slippage
    })
  }
}
