/**
 * Wallet balance routes — on-chain balance queries + CEX (Binance) balances.
 */

import { Router, type Request, type Response } from 'express'
import { accountKeyStore } from '../services/account-key-store.js'
import {
  readAllBalances,
  getSupportedChainNames,
  readBinanceBalances,
  hasBinanceCredentials,
} from '../lib/trading/services/BalanceReader.js'

const router = Router()

/**
 * GET /accounts
 * List all accounts (id, name, address — no private keys).
 */
router.get('/accounts', (_req: Request, res: Response) => {
  try {
    if (!accountKeyStore.isAppUnlocked()) {
      return res.status(403).json({ success: false, error: 'App is locked. Please unlock first.' })
    }

    const accounts = accountKeyStore.getAllAccounts().map((a) => ({
      id: a.accountId,
      name: a.accountName,
      address: a.address,
    }))

    return res.json({ success: true, accounts })
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /supported-chains
 * List chain names that have token configs.
 */
router.get('/supported-chains', (_req: Request, res: Response) => {
  return res.json({ success: true, chains: getSupportedChainNames() })
})

/**
 * GET /balances/binance
 * Read Binance spot account balances (non-zero only).
 * MUST be registered before /balances/:address/:chain to avoid param capture.
 */
router.get('/balances/binance', async (_req: Request, res: Response) => {
  try {
    // Import apiKeyStore to check raw key state
    const { apiKeyStore: aks } = await import('../services/api-key-store.js')
    const rawKey = aks.getBinanceApiKey()
    const rawSecret = aks.getBinanceApiSecret()
    const hasKeys = hasBinanceCredentials()
    console.log(`[Wallets] Binance balance request — hasCredentials: ${hasKeys}, appUnlocked: ${accountKeyStore.isAppUnlocked()}, apiKey: ${rawKey ? rawKey.slice(0, 6) + '...' : 'undefined'}, apiSecret: ${rawSecret ? '***set***' : 'undefined'}`)

    if (!hasKeys) {
      return res.json({ success: true, balances: [], exchange: 'binance', configured: false })
    }

    const result = await readBinanceBalances()
    return res.json({ success: true, ...result, configured: true })
  } catch (error: any) {
    console.error('[Wallets] Error reading Binance balances:', error.message)
    return res.json({ success: false, balances: [], exchange: 'binance', configured: true, error: error.message })
  }
})

/**
 * POST /balances/multi
 * Multi-chain batch balance read.
 * Body: { address: string, chains: string[] }
 * Uses Promise.allSettled so one failing chain doesn't block others.
 */
router.post('/balances/multi', async (req: Request, res: Response) => {
  try {
    const { address, chains } = req.body

    if (!address || !Array.isArray(chains) || chains.length === 0) {
      return res.status(400).json({ success: false, error: 'address and chains[] are required' })
    }

    const results = await Promise.allSettled(
      chains.map((chain: string) => readAllBalances(address, chain))
    )

    const balances: any[] = []
    const errors: Array<{ chain: string; error: string }> = []

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        balances.push(result.value)
      } else {
        errors.push({ chain: chains[i], error: result.reason?.message || 'Unknown error' })
      }
    })

    return res.json({ success: true, balances, errors })
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /balances/:address/:chain
 * Single-chain balance read.
 */
router.get('/balances/:address/:chain', async (req: Request, res: Response) => {
  try {
    const { address, chain } = req.params
    const balances = await readAllBalances(address, chain)
    return res.json({ success: true, balances })
  } catch (error: any) {
    console.error(`[Wallets] Error reading balances for ${req.params.address} on ${req.params.chain}:`, error.message)
    return res.status(500).json({ success: false, error: error.message })
  }
})

export default router
