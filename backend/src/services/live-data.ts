/**
 * Live Data Service
 * WebSocket service for real-time updates using the 'ws' package.
 * Broadcasts trade executions, price updates, strategy updates, and order updates.
 * Attaches to existing HTTP server on path /ws/live-data.
 * Singleton pattern with heartbeat (30s ping/pong).
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HttpServer } from 'http'

// --- Interfaces ---

export interface TradeExecutionData {
  executionId: string
  strategyId: string
  side: string
  symbol: string
  quantity: string
  price: string
  timestamp: string
  [key: string]: any
}

export interface PriceUpdateData {
  symbol: string
  price: number
  source: string
  timestamp: number
  [key: string]: any
}

export interface StrategyUpdateData {
  strategyId: string
  status: string
  message?: string
  timestamp: number
  [key: string]: any
}

export interface OrderUpdateData {
  orderId: string
  strategyId: string
  status: string
  side: string
  symbol: string
  quantity: string
  price?: string
  timestamp: string
  [key: string]: any
}

export interface PerpPositionUpdateData {
  positionId: string
  marketSymbol: string
  side: string
  action: string
  size: string
  price: string
  realizedPnl?: number
  timestamp: string
  [key: string]: any
}

export interface OptionPositionUpdateData {
  positionId: string
  underlyingSymbol: string
  optionType: string
  action: string
  premium: string
  contracts: string
  realizedPnl?: number
  timestamp: string
  [key: string]: any
}

export interface LendingPositionUpdateData {
  positionId: string
  assetSymbol: string
  action: string
  amount: string
  accruedInterest?: string
  timestamp: string
  [key: string]: any
}

interface TrackedClient {
  ws: WebSocket
  id: string
  isAlive: boolean
  connectedAt: number
}

type MessageType = 'trade_execution' | 'price_update' | 'strategy_update' | 'order_update' | 'perp_position_update' | 'option_position_update' | 'lending_position_update' | 'ping' | 'pong' | 'error'

interface WSMessage {
  type: MessageType
  data: any
  timestamp: number
}

// --- LiveDataService Class ---

class LiveDataService {
  private wss: WebSocketServer | null = null
  private clients: Map<string, TrackedClient> = new Map()
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private clientIdCounter = 0

  private static instance: LiveDataService | null = null

  private constructor() {}

  /**
   * Get the singleton instance.
   */
  static getInstance(): LiveDataService {
    if (!LiveDataService.instance) {
      LiveDataService.instance = new LiveDataService()
    }
    return LiveDataService.instance
  }

  /**
   * Initialize the WebSocket server and attach it to the HTTP server.
   *
   * @param httpServer - The existing HTTP server instance
   */
  initialize(httpServer: HttpServer): void {
    if (this.wss) {
      console.warn('[LiveDataService] Already initialized')
      return
    }

    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws/live-data'
    })

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = `client-${++this.clientIdCounter}-${Date.now()}`
      const trackedClient: TrackedClient = {
        ws,
        id: clientId,
        isAlive: true,
        connectedAt: Date.now()
      }

      this.clients.set(clientId, trackedClient)
      console.log(`[LiveDataService] Client connected: ${clientId} (total: ${this.clients.size})`)

      // Send welcome message
      this.sendToClient(ws, {
        type: 'pong',
        data: { clientId, message: 'Connected to live-data stream' },
        timestamp: Date.now()
      })

      // Handle incoming messages
      ws.on('message', (rawData: Buffer) => {
        try {
          const message = JSON.parse(rawData.toString())

          if (message.type === 'ping') {
            trackedClient.isAlive = true
            this.sendToClient(ws, {
              type: 'pong',
              data: { clientId },
              timestamp: Date.now()
            })
          }
        } catch {
          // Ignore malformed messages
        }
      })

      // Handle pong responses for heartbeat
      ws.on('pong', () => {
        trackedClient.isAlive = true
      })

      // Handle client disconnect
      ws.on('close', () => {
        this.clients.delete(clientId)
        console.log(`[LiveDataService] Client disconnected: ${clientId} (total: ${this.clients.size})`)
      })

      // Handle errors
      ws.on('error', (error: Error) => {
        console.error(`[LiveDataService] Client error (${clientId}):`, error.message)
        this.clients.delete(clientId)
      })
    })

    // Start heartbeat interval (30s)
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat()
    }, 30000)

    console.log('[LiveDataService] WebSocket server initialized on /ws/live-data')
  }

  // --- Broadcast Methods ---

  /**
   * Broadcast a trade execution event to all connected clients.
   */
  broadcastTradeExecution(tradeData: TradeExecutionData): void {
    this.broadcast({
      type: 'trade_execution',
      data: tradeData,
      timestamp: Date.now()
    })
  }

  /**
   * Broadcast a price update to all connected clients.
   */
  broadcastPriceUpdate(priceData: PriceUpdateData): void {
    this.broadcast({
      type: 'price_update',
      data: priceData,
      timestamp: Date.now()
    })
  }

  /**
   * Broadcast a strategy status change to all connected clients.
   */
  broadcastStrategyUpdate(strategyData: StrategyUpdateData): void {
    this.broadcast({
      type: 'strategy_update',
      data: strategyData,
      timestamp: Date.now()
    })
  }

  /**
   * Broadcast an order status change to all connected clients.
   */
  broadcastOrderUpdate(orderData: OrderUpdateData): void {
    this.broadcast({
      type: 'order_update',
      data: orderData,
      timestamp: Date.now()
    })
  }

  /**
   * Broadcast a perp position update to all connected clients.
   */
  broadcastPerpPositionUpdate(data: PerpPositionUpdateData): void {
    this.broadcast({
      type: 'perp_position_update',
      data,
      timestamp: Date.now()
    })
  }

  /**
   * Broadcast an option position update to all connected clients.
   */
  broadcastOptionPositionUpdate(data: OptionPositionUpdateData): void {
    this.broadcast({
      type: 'option_position_update',
      data,
      timestamp: Date.now()
    })
  }

  /**
   * Broadcast a lending position update to all connected clients.
   */
  broadcastLendingPositionUpdate(data: LendingPositionUpdateData): void {
    this.broadcast({
      type: 'lending_position_update',
      data,
      timestamp: Date.now()
    })
  }

  // --- Utility Methods ---

  /**
   * Get the number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Check if the service is initialized.
   */
  isInitialized(): boolean {
    return this.wss !== null
  }

  /**
   * Shut down the WebSocket server.
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    if (this.wss) {
      // Close all client connections
      for (const [, client] of this.clients) {
        try {
          client.ws.close(1001, 'Server shutting down')
        } catch {
          // Ignore close errors
        }
      }

      this.clients.clear()
      this.wss.close()
      this.wss = null
      console.log('[LiveDataService] WebSocket server shut down')
    }
  }

  // --- Private Methods ---

  /**
   * Broadcast a message to all connected clients.
   */
  private broadcast(message: WSMessage): void {
    const payload = JSON.stringify(message)
    let sentCount = 0

    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload)
          sentCount++
        } catch (error: any) {
          console.error(`[LiveDataService] Failed to send to ${clientId}:`, error.message)
          this.clients.delete(clientId)
        }
      }
    }

    if (sentCount > 0 && message.type !== 'pong') {
      console.log(`[LiveDataService] Broadcast ${message.type} to ${sentCount} client(s)`)
    }
  }

  /**
   * Send a message to a single client.
   */
  private sendToClient(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message))
      } catch (error: any) {
        console.error('[LiveDataService] Failed to send to client:', error.message)
      }
    }
  }

  /**
   * Heartbeat: ping all clients and terminate those that did not respond.
   */
  private heartbeat(): void {
    for (const [clientId, client] of this.clients) {
      if (!client.isAlive) {
        // Client did not respond to last ping, terminate
        console.log(`[LiveDataService] Terminating unresponsive client: ${clientId}`)
        client.ws.terminate()
        this.clients.delete(clientId)
        continue
      }

      // Mark as not alive, wait for pong
      client.isAlive = false

      try {
        client.ws.ping()
      } catch {
        this.clients.delete(clientId)
      }
    }
  }
}

// Export singleton accessor
export const liveDataService = LiveDataService.getInstance()
