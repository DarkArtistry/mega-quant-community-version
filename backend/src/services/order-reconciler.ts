/**
 * Order Reconciler Service
 *
 * Periodically checks pending/partial orders and reconciles their status:
 * - DEX orders: Check tx receipt via provider to confirm/fail
 * - CEX (Binance) orders: Query order status via REST API
 *
 * Runs on startup and every 30 seconds while there are pending orders.
 */

import { getDatabase } from '../db/index.js'
import { JsonRpcProvider, Network, FetchRequest } from 'ethers'
import { apiKeyStore } from './api-key-store.js'
import axios from 'axios'
import crypto from 'crypto'

// Chain ID → RPC URL resolution (simplified — reuses chain config)
const CHAIN_RPC_FALLBACKS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  130: 'https://mainnet.unichain.org',
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  84532: 'https://sepolia.base.org',
  1301: 'https://sepolia.unichain.org',
}

function getProviderForChain(chainId: number): JsonRpcProvider | null {
  // Try Alchemy first
  const alchemyKey = apiKeyStore.getAlchemyApiKey()
  const alchemySlugs: Record<number, string> = {
    1: 'eth-mainnet',
    11155111: 'eth-sepolia',
    8453: 'base-mainnet',
    84532: 'base-sepolia',
  }

  let rpcUrl: string | undefined
  if (alchemyKey && alchemySlugs[chainId]) {
    rpcUrl = `https://${alchemySlugs[chainId]}.g.alchemy.com/v2/${alchemyKey}`
  } else {
    rpcUrl = CHAIN_RPC_FALLBACKS[chainId]
  }

  if (!rpcUrl) return null

  const fetchReq = new FetchRequest(rpcUrl)
  fetchReq.timeout = 10_000
  const network = Network.from(chainId)
  return new JsonRpcProvider(fetchReq, network, { staticNetwork: network })
}

export class OrderReconciler {
  private interval: ReturnType<typeof setInterval> | null = null
  private running = false
  private static readonly POLL_INTERVAL_MS = 30_000 // 30 seconds

  /**
   * Start the reconciler. Runs immediately, then every 30 seconds.
   */
  start(): void {
    if (this.interval) return
    console.log('[OrderReconciler] Starting...')

    // Run immediately on startup
    this.reconcile()

    // Then poll periodically
    this.interval = setInterval(() => this.reconcile(), OrderReconciler.POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    console.log('[OrderReconciler] Stopped')
  }

  private async reconcile(): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      const db = getDatabase()

      // Get all pending/partial orders
      const pendingOrders = db.prepare(`
        SELECT * FROM orders
        WHERE status IN ('pending', 'partial')
        ORDER BY created_at ASC
      `).all() as any[]

      if (pendingOrders.length === 0) {
        return
      }

      console.log(`[OrderReconciler] Checking ${pendingOrders.length} pending order(s)...`)

      for (const order of pendingOrders) {
        try {
          if (order.protocol === 'binance-futures') {
            await this.reconcileBinanceFuturesOrder(order)
          } else if (order.protocol === 'binance') {
            await this.reconcileBinanceOrder(order)
          } else if (order.tx_hash && order.chain_id) {
            await this.reconcileDexOrder(order)
          } else {
            // No tx_hash and not Binance — mark as expired if older than 1 hour
            const createdAt = new Date(order.created_at + 'Z')
            const ageMs = Date.now() - createdAt.getTime()
            if (ageMs > 3600_000) {
              db.prepare(`
                UPDATE orders SET status = 'expired', updated_at = datetime('now') WHERE id = ?
              `).run(order.id)
              console.log(`[OrderReconciler] Expired stale order ${order.id} (no tx_hash, age: ${Math.round(ageMs / 60000)}min)`)
            }
          }
        } catch (err: any) {
          console.warn(`[OrderReconciler] Error checking order ${order.id}:`, err.message)
        }
      }
    } catch (err: any) {
      console.error('[OrderReconciler] Reconciliation error:', err.message)
    } finally {
      this.running = false
    }
  }

  /**
   * Check a DEX order by looking up the tx receipt on-chain.
   */
  private async reconcileDexOrder(order: any): Promise<void> {
    const provider = getProviderForChain(order.chain_id)
    if (!provider) return

    try {
      const receipt = await provider.getTransactionReceipt(order.tx_hash)

      if (!receipt) {
        // Tx not yet mined — check if it's been too long (30 min = probably dropped)
        const createdAt = new Date(order.created_at + 'Z')
        const ageMs = Date.now() - createdAt.getTime()
        if (ageMs > 1800_000) {
          const db = getDatabase()
          db.prepare(`
            UPDATE orders SET status = 'expired', updated_at = datetime('now') WHERE id = ?
          `).run(order.id)
          console.log(`[OrderReconciler] DEX order ${order.id} expired (tx not mined after 30min)`)
        }
        return
      }

      const db = getDatabase()
      if (receipt.status === 1) {
        // Success — mark as filled
        db.prepare(`
          UPDATE orders
          SET status = 'filled', filled_at = datetime('now'), updated_at = datetime('now'),
              block_number = ?
          WHERE id = ? AND status IN ('pending', 'partial')
        `).run(receipt.blockNumber, order.id)
        console.log(`[OrderReconciler] DEX order ${order.id} confirmed (block ${receipt.blockNumber})`)
      } else {
        // Failed tx
        db.prepare(`
          UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?
        `).run(order.id)
        console.log(`[OrderReconciler] DEX order ${order.id} failed (tx reverted)`)
      }
    } catch (err: any) {
      // Provider error — skip for now
      console.warn(`[OrderReconciler] Provider error for chain ${order.chain_id}:`, err.message)
    }
  }

  /**
   * Check a Binance order by querying the order status.
   */
  private async reconcileBinanceOrder(order: any): Promise<void> {
    const apiKey = apiKeyStore.getBinanceApiKey()
    const apiSecret = apiKeyStore.getBinanceApiSecret()
    if (!apiKey || !apiSecret) return

    // The tx_hash field stores the Binance orderId for CEX orders
    const binanceOrderId = order.tx_hash
    if (!binanceOrderId) return

    // We need the symbol — derive from asset_symbol + common quote pairs
    // The token_in_symbol and token_out_symbol should give us the full pair
    let symbol: string | null = null
    if (order.token_in_symbol && order.token_out_symbol) {
      // Try both directions
      const a = order.token_in_symbol
      const b = order.token_out_symbol
      const quoteAssets = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB']
      if (quoteAssets.includes(b)) {
        symbol = a + b
      } else if (quoteAssets.includes(a)) {
        symbol = b + a
      }
    }
    if (!symbol) {
      // Fallback: use asset_symbol + USDT
      symbol = order.asset_symbol + 'USDT'
    }

    try {
      const isTestnet = apiKeyStore.isBinanceTestnet?.() ?? false
      const baseUrl = isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com'

      const params: Record<string, string> = {
        symbol: symbol.toUpperCase(),
        orderId: binanceOrderId,
        timestamp: Date.now().toString()
      }

      const queryString = new URLSearchParams(params).toString()
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex')
      params.signature = signature

      const response = await axios.get(`${baseUrl}/api/v3/order`, {
        params,
        headers: { 'X-MBX-APIKEY': apiKey },
        timeout: 10_000
      })

      const binanceStatus = response.data.status as string
      const db = getDatabase()

      if (binanceStatus === 'FILLED') {
        db.prepare(`
          UPDATE orders
          SET status = 'filled',
              filled_quantity = ?,
              filled_price = ?,
              filled_at = datetime('now'),
              updated_at = datetime('now')
          WHERE id = ? AND status IN ('pending', 'partial')
        `).run(
          response.data.executedQty,
          response.data.price !== '0.00000000'
            ? response.data.price
            : (parseFloat(response.data.cummulativeQuoteQty) / parseFloat(response.data.executedQty)).toString(),
          order.id
        )
        console.log(`[OrderReconciler] Binance order ${order.id} filled`)
      } else if (binanceStatus === 'PARTIALLY_FILLED') {
        db.prepare(`
          UPDATE orders
          SET status = 'partial',
              filled_quantity = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(response.data.executedQty, order.id)
      } else if (binanceStatus === 'CANCELED' || binanceStatus === 'REJECTED' || binanceStatus === 'EXPIRED') {
        db.prepare(`
          UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?
        `).run(order.id)
        console.log(`[OrderReconciler] Binance order ${order.id} ${binanceStatus.toLowerCase()}`)
      }
      // NEW or PENDING_CANCEL — leave as-is, will check again next cycle
    } catch (err: any) {
      // Binance API error — skip
      if (err.response?.status === 400) {
        // Order not found — probably a different symbol format, skip
      } else {
        console.warn(`[OrderReconciler] Binance API error for order ${order.id}:`, err.message)
      }
    }
  }
  /**
   * Check a Binance Futures order by querying the FAPI order status.
   */
  private async reconcileBinanceFuturesOrder(order: any): Promise<void> {
    const apiKey = apiKeyStore.getBinanceApiKey()
    const apiSecret = apiKeyStore.getBinanceApiSecret()
    if (!apiKey || !apiSecret) return

    const binanceOrderId = order.tx_hash
    if (!binanceOrderId) return

    const symbol = order.asset_symbol

    try {
      const isTestnet = apiKeyStore.isBinanceTestnet?.() ?? false
      const baseUrl = isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com'

      const params: Record<string, string> = {
        symbol: symbol.toUpperCase(),
        orderId: binanceOrderId,
        timestamp: Date.now().toString()
      }

      const queryString = new URLSearchParams(params).toString()
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex')
      params.signature = signature

      const response = await axios.get(`${baseUrl}/fapi/v1/order`, {
        params,
        headers: { 'X-MBX-APIKEY': apiKey },
        timeout: 10_000
      })

      const futuresStatus = response.data.status as string
      const db = getDatabase()

      if (futuresStatus === 'FILLED') {
        db.prepare(`
          UPDATE orders
          SET status = 'filled',
              filled_quantity = ?,
              filled_price = ?,
              filled_at = datetime('now'),
              updated_at = datetime('now')
          WHERE id = ? AND status IN ('pending', 'partial')
        `).run(
          response.data.executedQty,
          response.data.avgPrice || response.data.price,
          order.id
        )
        console.log(`[OrderReconciler] Binance Futures order ${order.id} filled`)
      } else if (futuresStatus === 'PARTIALLY_FILLED') {
        db.prepare(`
          UPDATE orders SET status = 'partial', filled_quantity = ?, updated_at = datetime('now') WHERE id = ?
        `).run(response.data.executedQty, order.id)
      } else if (['CANCELED', 'REJECTED', 'EXPIRED'].includes(futuresStatus)) {
        db.prepare('UPDATE orders SET status = \'cancelled\', updated_at = datetime(\'now\') WHERE id = ?').run(order.id)
        console.log(`[OrderReconciler] Binance Futures order ${order.id} ${futuresStatus.toLowerCase()}`)
      }
    } catch (err: any) {
      if (err.response?.status !== 400) {
        console.warn(`[OrderReconciler] Binance Futures API error for order ${order.id}:`, err.message)
      }
    }
  }
}

export const orderReconciler = new OrderReconciler()
