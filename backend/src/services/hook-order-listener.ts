/**
 * HookOrderListener Service
 *
 * Polls on-chain events from MegaQuantHook to detect limit/stop order fills
 * and bracket partner cancellations. Updates OrderManager and PnlEngine accordingly.
 *
 * Event signatures monitored:
 * - OrderExecuted(PoolId indexed, int24 tick, bool zeroForOne, uint256 amountIn, uint256 amountOut)
 * - StopOrderExecuted(PoolId indexed, int24 tick, bool zeroForOne, uint256 amountIn, uint256 amountOut)
 * - BracketPartnerCancelled(uint256 indexed cancelledOrderId, uint256 indexed partnerOrderId)
 */

import { Contract, Interface, keccak256, AbiCoder, JsonRpcProvider } from 'ethers'
import { getChainConfig } from '../lib/trading/config/chains.js'

// ABI fragments for the events we listen to
const HOOK_EVENTS_ABI = [
  'event OrderExecuted(bytes32 indexed poolId, int24 tick, bool zeroForOne, uint256 amountIn, uint256 amountOut)',
  'event StopOrderExecuted(bytes32 indexed poolId, int24 tick, bool zeroForOne, uint256 amountIn, uint256 amountOut)',
  'event BracketPartnerCancelled(uint256 indexed cancelledOrderId, uint256 indexed partnerOrderId)',
  'event OrderCancelled(address indexed trader, bytes32 indexed poolId, int24 tick, bool zeroForOne, uint256 amount)',
  'event StopOrderCancelled(address indexed trader, bytes32 indexed poolId, int24 tick, bool zeroForOne, uint256 amount)',
]

interface ListenerConfig {
  chainName: string
  hookAddress: string
  pollIntervalMs?: number   // Default: 15000 (15s)
}

class HookOrderListener {
  private listeners = new Map<string, {
    config: ListenerConfig
    provider: JsonRpcProvider
    hookInterface: Interface
    lastBlock: number
    timer?: ReturnType<typeof setInterval>
  }>()

  /**
   * Start listening for hook events on a specific chain.
   */
  async start(config: ListenerConfig): Promise<void> {
    const chainConfig = getChainConfig(config.chainName)
    const provider = new JsonRpcProvider(chainConfig.rpcUrl)
    const hookInterface = new Interface(HOOK_EVENTS_ABI)

    // Start from the current block
    const currentBlock = await provider.getBlockNumber()

    const state = {
      config,
      provider,
      hookInterface,
      lastBlock: currentBlock,
    }

    const pollInterval = config.pollIntervalMs || 15000

    console.log(`[HookOrderListener] Started on ${config.chainName}, hook=${config.hookAddress}, from block ${currentBlock}, polling every ${pollInterval}ms`)

    const timer = setInterval(() => this.poll(config.chainName), pollInterval)
    this.listeners.set(config.chainName, { ...state, timer })

    // Do an initial poll
    await this.poll(config.chainName)
  }

  /**
   * Poll for new events since last checked block.
   */
  private async poll(chainName: string): Promise<void> {
    const state = this.listeners.get(chainName)
    if (!state) return

    try {
      const currentBlock = await state.provider.getBlockNumber()
      if (currentBlock <= state.lastBlock) return

      const fromBlock = state.lastBlock + 1
      const toBlock = currentBlock

      // Query all hook events in the block range
      const logs = await state.provider.getLogs({
        address: state.config.hookAddress,
        fromBlock,
        toBlock,
      })

      if (logs.length > 0) {
        console.log(`[HookOrderListener] ${chainName}: ${logs.length} events in blocks ${fromBlock}-${toBlock}`)
      }

      for (const log of logs) {
        try {
          const parsed = state.hookInterface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          })
          if (!parsed) continue

          await this.handleEvent(chainName, parsed.name, parsed.args, log.transactionHash, log.blockNumber)
        } catch {
          // Unknown event, skip
        }
      }

      state.lastBlock = toBlock
    } catch (error: any) {
      console.error(`[HookOrderListener] ${chainName} poll error:`, error.message)
    }
  }

  /**
   * Handle a parsed event.
   */
  private async handleEvent(
    chainName: string,
    eventName: string,
    args: any,
    txHash: string,
    blockNumber: number
  ): Promise<void> {
    console.log(`[HookOrderListener] ${chainName}: ${eventName} in tx ${txHash}`)

    try {
      const { orderManager } = await import('../lib/trading/orders/OrderManager.js')

      switch (eventName) {
        case 'OrderExecuted': {
          // Limit order filled
          const { poolId, tick, zeroForOne, amountIn, amountOut } = args
          const abiCoder = AbiCoder.defaultAbiCoder()
          const orderId = keccak256(abiCoder.encode(
            ['bytes32', 'int24', 'bool'],
            [poolId, tick, zeroForOne]
          ))

          // Find matching order by hookOrderId
          const pendingOrders = orderManager.getPending()
          const match = pendingOrders.find(o =>
            o.hookOrderId === orderId && o.protocol === 'uniswap-v4-hook'
          )
          if (match) {
            orderManager.updateOrderStatus(match.id, 'filled', {
              filledQuantity: amountIn.toString(),
              filledPrice: amountOut.toString(),
              txHash,
            })
            console.log(`[HookOrderListener] Limit order ${match.id} filled: ${amountIn} -> ${amountOut}`)

            // Feed PnlEngine
            await this.feedPnl(match, amountIn.toString(), amountOut.toString(), txHash, blockNumber)
          }
          break
        }

        case 'StopOrderExecuted': {
          // Stop order filled
          const { poolId, tick, zeroForOne, amountIn, amountOut } = args
          const abiCoder = AbiCoder.defaultAbiCoder()
          const orderId = keccak256(abiCoder.encode(
            ['string', 'bytes32', 'int24', 'bool'],
            ['STOP', poolId, tick, zeroForOne]
          ))

          const pendingOrders = orderManager.getPending()
          const match = pendingOrders.find(o =>
            o.hookOrderId === orderId && o.protocol === 'uniswap-v4-hook'
          )
          if (match) {
            orderManager.updateOrderStatus(match.id, 'filled', {
              filledQuantity: amountIn.toString(),
              filledPrice: amountOut.toString(),
              txHash,
            })
            console.log(`[HookOrderListener] Stop order ${match.id} filled: ${amountIn} -> ${amountOut}`)

            await this.feedPnl(match, amountIn.toString(), amountOut.toString(), txHash, blockNumber)
          }
          break
        }

        case 'BracketPartnerCancelled': {
          // One side of a bracket filled, cancel the partner
          const { partnerOrderId } = args
          const partnerIdStr = partnerOrderId.toString()

          const pendingOrders = orderManager.getPending()
          const match = pendingOrders.find(o =>
            o.hookOrderId === partnerIdStr && o.protocol === 'uniswap-v4-hook'
          )
          if (match) {
            orderManager.updateOrderStatus(match.id, 'cancelled')
            console.log(`[HookOrderListener] Bracket partner ${match.id} cancelled (partner filled)`)
          }
          break
        }
      }

      // Broadcast update via WebSocket
      try {
        const wsModule = await import('./live-data.js').catch(() => null)
        if (wsModule?.liveDataService) {
          wsModule.liveDataService.broadcastOrderUpdate({
            orderId: '',
            strategyId: '',
            status: eventName.includes('Executed') ? 'filled' : 'cancelled',
            side: '',
            symbol: '',
            quantity: '',
            timestamp: new Date().toISOString(),
            eventType: eventName,
            txHash,
            chainName,
          })
        }
      } catch { /* non-critical */ }

    } catch (error: any) {
      console.error(`[HookOrderListener] Error handling ${eventName}:`, error.message)
    }
  }

  /**
   * Feed a filled order into the PnL engine.
   */
  private async feedPnl(
    order: any,
    amountIn: string,
    amountOut: string,
    txHash: string,
    blockNumber: number
  ): Promise<void> {
    try {
      const { pnlEngine } = await import('../lib/trading/pnl/PnlEngine.js')

      let blockTimestamp: string | undefined
      // We don't have a provider reference here easily, so use current time as fallback
      blockTimestamp = new Date().toISOString()

      const stablecoins = ['USDC', 'USDT', 'DAI']
      const tokenInSymbol = order.tokenInSymbol || order.assetSymbol
      const tokenOutSymbol = order.tokenOutSymbol || ''
      const inAmt = parseFloat(amountIn)
      const outAmt = parseFloat(amountOut)

      const tokenInIsStable = stablecoins.includes(tokenInSymbol.toUpperCase())
      const tokenOutIsStable = stablecoins.includes(tokenOutSymbol.toUpperCase())

      let priceUsd = '0'
      if (tokenInIsStable && inAmt > 0) {
        priceUsd = '1'
      } else if (tokenOutIsStable && inAmt > 0) {
        priceUsd = (outAmt / inAmt).toString()
      }

      pnlEngine.processTrade({
        tradeId: `${txHash}-hook-${order.id}`,
        strategyId: order.strategyId,
        side: order.side,
        assetSymbol: tokenInSymbol,
        assetAddress: order.assetAddress || '',
        chainId: order.chainId || 0,
        quantity: amountIn,
        price: priceUsd,
        fees: '0',
        timestamp: blockTimestamp,
        accountId: order.accountId,
        quoteAssetSymbol: tokenOutSymbol,
        protocol: 'uniswap-v4-hook',
      })
    } catch (error: any) {
      console.warn(`[HookOrderListener] PnL feed failed for order ${order.id}:`, error.message)
    }
  }

  /**
   * Stop listening on a specific chain.
   */
  stop(chainName: string): void {
    const state = this.listeners.get(chainName)
    if (state?.timer) {
      clearInterval(state.timer)
    }
    this.listeners.delete(chainName)
    console.log(`[HookOrderListener] Stopped on ${chainName}`)
  }

  /**
   * Stop all listeners.
   */
  shutdown(): void {
    for (const [chainName] of this.listeners) {
      this.stop(chainName)
    }
    console.log('[HookOrderListener] All listeners shut down')
  }

  /**
   * Get status of all listeners.
   */
  getStatus(): Array<{ chainName: string; lastBlock: number; hookAddress: string }> {
    const status: Array<{ chainName: string; lastBlock: number; hookAddress: string }> = []
    for (const [chainName, state] of this.listeners) {
      status.push({
        chainName,
        lastBlock: state.lastBlock,
        hookAddress: state.config.hookAddress,
      })
    }
    return status
  }
}

// Singleton
export const hookOrderListener = new HookOrderListener()
