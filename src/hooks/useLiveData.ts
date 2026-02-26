import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useLiveDataStore } from '@/stores/useLiveDataStore'
import { useStrategyStore } from '@/stores/useStrategyStore'
import { useAppStore } from '@/stores/useAppStore'

import type { WSMessage } from '@/hooks/useWebSocket'
import type { LiveTrade } from '@/stores/useLiveDataStore'

export function useLiveData() {
  const { isConnected, lastMessage } = useWebSocket()
  const queryClient = useQueryClient()

  const addTrade = useLiveDataStore((s) => s.addTrade)
  const updatePrice = useLiveDataStore((s) => s.updatePrice)
  const setConnected = useLiveDataStore((s) => s.setConnected)

  const updateStrategy = useStrategyStore((s) => s.updateStrategy)
  const setBackendStatus = useAppStore((s) => s.setBackendStatus)

  // Sync connection state to both live data store and app store
  useEffect(() => {
    setConnected(isConnected)
    setBackendStatus({ wsConnected: isConnected })
  }, [isConnected, setConnected, setBackendStatus])

  // Dispatch incoming messages to the appropriate stores
  useEffect(() => {
    if (!lastMessage) return

    handleMessage(lastMessage)
  }, [lastMessage])

  function handleMessage(message: WSMessage) {
    switch (message.type) {
      case 'trade_execution': {
        const data = message.data
        const trade: LiveTrade = {
          executionId: data.executionId,
          strategyId: data.strategyId,
          side: data.side,
          symbol: data.symbol,
          quantity: data.quantity,
          price: data.price,
          timestamp: data.timestamp,
        }
        addTrade(trade)
        break
      }

      case 'price_update': {
        const data = message.data
        updatePrice(data.symbol, data.price, data.timestamp)
        break
      }

      case 'strategy_update': {
        const data = message.data
        updateStrategy(data.strategyId, { status: data.status })
        // Also populate workerStates so StrategyDetailPage gets real-time status
        useStrategyStore.getState().setWorkerState(data.strategyId, {
          strategyId: data.strategyId,
          status: data.status,
          executionCount: data.executionCount ?? 0,
          errorCount: data.errorCount ?? 0,
          lastHeartbeat: new Date().toISOString(),
        })
        break
      }

      case 'order_update': {
        // Invalidate order queries so they refetch
        queryClient.invalidateQueries({ queryKey: ['orders'] })
        break
      }

      case 'pong': {
        // Heartbeat response, no action needed
        break
      }

      default:
        break
    }
  }

  return {
    recentTrades: useLiveDataStore((s) => s.recentTrades),
    latestPrices: useLiveDataStore((s) => s.latestPrices),
    isConnected,
  }
}
