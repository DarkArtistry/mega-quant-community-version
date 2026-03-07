import express from 'express'
import { Wallet, JsonRpcProvider, Contract, formatEther, formatUnits, parseUnits } from 'ethers'
import { UniswapV4Protocol } from '../lib/trading/protocols/UniswapV4Protocol.js'
import { getChainConfig, CHAIN_CONFIGS } from '../lib/trading/config/chains.js'
import { getTokenByAddress, getTokenInfo } from '../lib/trading/config/tokens.js'
import { ERC20_ABI } from '../lib/trading/abis/erc20.js'
import { accountKeyStore } from '../services/account-key-store.js'
import { getDatabase } from '../db/index.js'

const router = express.Router()

/**
 * Create a standalone UniswapV4Protocol instance.
 * Uses a specific account if accountId is provided, otherwise the first unlocked account.
 */
function createStandaloneProtocol(chainName: string, accountId?: string): UniswapV4Protocol {
  const accounts = accountKeyStore.getAllAccounts()
  if (accounts.length === 0) {
    throw new Error('No accounts available. Please unlock the app first.')
  }

  const account = accountId
    ? accounts.find(a => a.accountId === accountId) || accounts[0]
    : accounts[0]

  const chainConfig = getChainConfig(chainName)
  const provider = new JsonRpcProvider(chainConfig.rpcUrl)
  const wallet = new Wallet(account.privateKey, provider)

  return new UniswapV4Protocol(
    chainName,
    chainConfig.chainId,
    wallet,
    'standalone',
    'ui-liquidity',
    account.accountId
  )
}

/**
 * Get a provider + wallet for balance checks (no protocol needed).
 */
function getWalletForChain(chainName: string, accountId?: string) {
  const accounts = accountKeyStore.getAllAccounts()
  if (accounts.length === 0) {
    throw new Error('No accounts available. Please unlock the app first.')
  }

  const account = accountId
    ? accounts.find(a => a.accountId === accountId) || accounts[0]
    : accounts[0]

  const chainConfig = getChainConfig(chainName)
  const provider = new JsonRpcProvider(chainConfig.rpcUrl)
  const wallet = new Wallet(account.privateKey, provider)

  return { wallet, account, chainConfig }
}

/**
 * GET /api/liquidity/chains
 * Returns all chains that have Uniswap V4 configured.
 */
router.get('/chains', (_req, res) => {
  try {
    const v4Chains = Object.entries(CHAIN_CONFIGS)
      .filter(([_, config]) => !!config.uniswapV4)
      .map(([key, config]) => ({
        key,
        name: config.name,
        chainId: config.chainId,
        hasHook: !!config.uniswapV4?.megaQuantHook,
        hasRegistry: !!config.uniswapV4?.poolRegistry,
      }))

    res.json({ success: true, chains: v4Chains })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/liquidity/balance?chain=...&accountId=...&tokenA=...&tokenB=...
 * Returns native token balance + optional ERC20 token balances for a pool pair.
 */
router.get('/balance', async (req, res) => {
  try {
    const chain = (req.query.chain as string) || 'unichain-sepolia'
    const accountId = req.query.accountId as string | undefined
    const tokenA = req.query.tokenA as string | undefined
    const tokenB = req.query.tokenB as string | undefined

    const { wallet, account, chainConfig } = getWalletForChain(chain, accountId)
    const provider = wallet.provider!
    const balance = await provider.getBalance(wallet.address)

    const tokenBalances: { symbol: string; balance: string; decimals: number }[] = []

    // Fetch ERC20 balances if token symbols provided
    for (const symbol of [tokenA, tokenB]) {
      if (!symbol) continue
      try {
        const tokenInfo = getTokenInfo(chain, symbol)
        const tokenContract = new Contract(tokenInfo.address, ERC20_ABI, provider)
        const bal = await tokenContract.balanceOf(wallet.address)
        tokenBalances.push({
          symbol: tokenInfo.symbol,
          balance: formatUnits(bal, tokenInfo.decimals),
          decimals: tokenInfo.decimals,
        })
      } catch {
        tokenBalances.push({ symbol, balance: '0', decimals: 0 })
      }
    }

    res.json({
      success: true,
      address: account.address,
      accountName: account.accountName,
      balance: formatEther(balance),
      symbol: chainConfig.nativeCurrency.symbol,
      sufficient: balance > 0n,
      tokenBalances,
    })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/liquidity/pools?chain=unichain-sepolia
 * Returns all registered pools with their on-chain state.
 */
router.get('/pools', async (req, res) => {
  try {
    const chain = (req.query.chain as string) || 'unichain-sepolia'
    const accountId = req.query.accountId as string | undefined
    const protocol = createStandaloneProtocol(chain, accountId)

    const pools = await protocol.getPools()

    // Enrich each pool with on-chain info + token symbols
    const enriched = await Promise.all(
      pools.map(async (pool) => {
        const token0Symbol = getTokenByAddress(chain, pool.token0)?.symbol || pool.token0.slice(0, 10)
        const token1Symbol = getTokenByAddress(chain, pool.token1)?.symbol || pool.token1.slice(0, 10)

        let info = null
        try {
          info = await protocol.getPoolInfo(token0Symbol, token1Symbol)
        } catch {
          // Pool info may fail if tokens aren't in registry
        }

        return {
          ...pool,
          token0Symbol,
          token1Symbol,
          info,
        }
      })
    )

    res.json({ success: true, pools: enriched })
  } catch (error: any) {
    console.error('[Liquidity] Failed to get pools:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/liquidity/pool-info?chain=...&tokenA=...&tokenB=...
 * Returns on-chain state for a single pool.
 */
router.get('/pool-info', async (req, res) => {
  try {
    const chain = (req.query.chain as string) || 'unichain-sepolia'
    const tokenA = req.query.tokenA as string
    const tokenB = req.query.tokenB as string

    if (!tokenA || !tokenB) {
      return res.status(400).json({ success: false, error: 'tokenA and tokenB are required' })
    }

    const protocol = createStandaloneProtocol(chain)
    const info = await protocol.getPoolInfo(tokenA, tokenB)

    res.json({ success: true, info })
  } catch (error: any) {
    console.error('[Liquidity] Failed to get pool info:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/liquidity/wrap-eth
 * Body: { chain, amount, accountId? }
 * Wraps native ETH into WETH by sending ETH to the WETH contract.
 */
router.post('/wrap-eth', async (req, res) => {
  try {
    const { chain = 'unichain-sepolia', amount, accountId } = req.body
    if (!amount) {
      return res.status(400).json({ success: false, error: 'amount is required' })
    }

    const { wallet, chainConfig } = getWalletForChain(chain, accountId)
    const wethInfo = getTokenInfo(chain, 'WETH')
    const amountWei = parseUnits(amount, 18)

    // WETH deposit = send ETH to the WETH contract
    const tx = await wallet.sendTransaction({
      to: wethInfo.address,
      value: amountWei,
    })
    const receipt = await tx.wait()

    res.json({
      success: true,
      txHash: receipt!.hash,
      amount,
      explorerUrl: `${chainConfig.blockExplorer}/tx/${receipt!.hash}`,
    })
  } catch (error: any) {
    console.error('[Liquidity] Failed to wrap ETH:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * POST /api/liquidity/add
 * Body: { chain, tokenA, tokenB, amount0, amount1, tickLower?, tickUpper?, accountId? }
 */
router.post('/add', async (req, res) => {
  try {
    const { chain = 'unichain-sepolia', tokenA, tokenB, amount0, amount1, tickLower, tickUpper, accountId } = req.body

    if (!tokenA || !tokenB || !amount0 || !amount1) {
      return res.status(400).json({ success: false, error: 'tokenA, tokenB, amount0, and amount1 are required' })
    }

    const protocol = createStandaloneProtocol(chain, accountId)
    const result = await protocol.addLiquidity({
      tokenA,
      tokenB,
      amount0,
      amount1,
      tickLower,
      tickUpper,
    })

    res.json(result)
  } catch (error: any) {
    console.error('[Liquidity] Failed to add liquidity:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
