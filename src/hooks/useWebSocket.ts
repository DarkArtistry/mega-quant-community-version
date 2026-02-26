import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '@/stores/useAppStore'
import { getWebSocketUrl } from '@/api/client'

const WS_URL = getWebSocketUrl()
const INITIAL_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 30000
const HEARTBEAT_INTERVAL = 25000 // Send ping every 25s (server expects within 30s)

export interface WSMessage {
  type: string
  data: any
  timestamp: number
}

export function useWebSocket() {
  const isUnlocked = useAppStore((s) => s.isUnlocked)
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const shouldConnectRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current)
      heartbeatTimerRef.current = null
    }
  }, [])

  const disconnect = useCallback(() => {
    clearTimers()
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect')
      wsRef.current = null
    }
    setIsConnected(false)
  }, [clearTimers])

  const send = useCallback((message: WSMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  const startHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current)
    }
    heartbeatTimerRef.current = setInterval(() => {
      send({ type: 'ping', data: {}, timestamp: Date.now() })
    }, HEARTBEAT_INTERVAL)
  }, [send])

  const connect = useCallback(() => {
    // Don't connect if there's already an active connection
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return
    }

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY
        startHeartbeat()
      }

      ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data)
          setLastMessage(message)
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onclose = (event) => {
        setIsConnected(false)
        clearTimers()
        wsRef.current = null

        // Only reconnect if we should still be connected and it wasn't a clean close
        if (shouldConnectRef.current && event.code !== 1000) {
          reconnectTimerRef.current = setTimeout(() => {
            // Double the delay for exponential backoff
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 2,
              MAX_RECONNECT_DELAY
            )
            connect()
          }, reconnectDelayRef.current)
        }
      }

      ws.onerror = () => {
        // The onclose handler will fire after this and handle reconnection
      }
    } catch {
      // Connection failed, schedule reconnect
      if (shouldConnectRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * 2,
            MAX_RECONNECT_DELAY
          )
          connect()
        }, reconnectDelayRef.current)
      }
    }
  }, [clearTimers, startHeartbeat])

  useEffect(() => {
    if (isUnlocked) {
      shouldConnectRef.current = true
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY
      connect()
    } else {
      shouldConnectRef.current = false
      disconnect()
    }

    return () => {
      shouldConnectRef.current = false
      disconnect()
    }
  }, [isUnlocked, connect, disconnect])

  return { isConnected, lastMessage, send }
}
