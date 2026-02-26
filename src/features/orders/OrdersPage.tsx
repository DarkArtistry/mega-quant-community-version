import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SkeletonTable } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'
import { ClipboardList } from 'lucide-react'
import { ordersApi } from '@/api/orders'
import type { Order } from '@/types'

const statusColors: Record<string, 'default' | 'positive' | 'warning' | 'negative'> = {
  pending: 'warning',
  filled: 'positive',
  cancelled: 'default',
  rejected: 'negative',
  partial: 'warning',
}

export function OrdersPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [orderHistory, setOrderHistory] = useState<Order[]>([])

  const fetchOrders = useCallback(async () => {
    try {
      const [pendingRes, historyRes] = await Promise.allSettled([
        ordersApi.getPending(),
        ordersApi.getHistory(),
      ])

      if (pendingRes.status === 'fulfilled') {
        setActiveOrders(pendingRes.value.data.orders || [])
      }
      if (historyRes.status === 'fulfilled') {
        setOrderHistory(historyRes.value.data.orders || [])
      }
    } catch (err) {
      console.error('[Orders] Error fetching:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOrders()
    const interval = setInterval(fetchOrders, 15000)
    return () => clearInterval(interval)
  }, [fetchOrders])

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Orders</h2>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active Orders ({activeOrders.length})</TabsTrigger>
          <TabsTrigger value="history">Order History ({orderHistory.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {isLoading ? (
            <SkeletonTable rows={4} cols={8} />
          ) : activeOrders.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No active orders"
              description="Orders placed by your strategies will appear here"
            />
          ) : (
            <div className="rounded border border-border bg-surface">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-text-tertiary">
                    <th className="text-left p-2.5 font-medium">Time</th>
                    <th className="text-left p-2.5 font-medium">Type</th>
                    <th className="text-left p-2.5 font-medium">Side</th>
                    <th className="text-left p-2.5 font-medium">Asset</th>
                    <th className="text-right p-2.5 font-medium">Qty</th>
                    <th className="text-right p-2.5 font-medium">Price</th>
                    <th className="text-left p-2.5 font-medium">Status</th>
                    <th className="text-left p-2.5 font-medium">Protocol</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.map((order) => (
                    <tr key={order.id} className="border-b border-border last:border-b-0 hover:bg-background">
                      <td className="p-2.5 text-text-secondary">{formatTime(order.created_at)}</td>
                      <td className="p-2.5">{order.order_type}</td>
                      <td className="p-2.5">
                        <span className={order.side === 'buy' ? 'text-positive' : 'text-negative'}>
                          {order.side}
                        </span>
                      </td>
                      <td className="p-2.5 font-medium">{order.asset_symbol}</td>
                      <td className="p-2.5 text-right font-mono">{order.quantity}</td>
                      <td className="p-2.5 text-right font-mono">{order.price || '—'}</td>
                      <td className="p-2.5">
                        <Badge variant={statusColors[order.status] || 'default'}>{order.status}</Badge>
                      </td>
                      <td className="p-2.5 text-text-secondary">{order.protocol}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          {isLoading ? (
            <SkeletonTable rows={4} cols={8} />
          ) : orderHistory.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No order history"
              description="Completed and cancelled orders will appear here"
            />
          ) : (
            <div className="rounded border border-border bg-surface">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-text-tertiary">
                    <th className="text-left p-2.5 font-medium">Time</th>
                    <th className="text-left p-2.5 font-medium">Type</th>
                    <th className="text-left p-2.5 font-medium">Side</th>
                    <th className="text-left p-2.5 font-medium">Asset</th>
                    <th className="text-right p-2.5 font-medium">Qty</th>
                    <th className="text-right p-2.5 font-medium">Fill Price</th>
                    <th className="text-left p-2.5 font-medium">Status</th>
                    <th className="text-left p-2.5 font-medium">Protocol</th>
                  </tr>
                </thead>
                <tbody>
                  {orderHistory.map((order) => (
                    <tr key={order.id} className="border-b border-border last:border-b-0 hover:bg-background">
                      <td className="p-2.5 text-text-secondary">{formatTime(order.created_at)}</td>
                      <td className="p-2.5">{order.order_type}</td>
                      <td className="p-2.5">
                        <span className={order.side === 'buy' ? 'text-positive' : 'text-negative'}>
                          {order.side}
                        </span>
                      </td>
                      <td className="p-2.5 font-medium">{order.asset_symbol}</td>
                      <td className="p-2.5 text-right font-mono">{order.filled_quantity || order.quantity}</td>
                      <td className="p-2.5 text-right font-mono">{order.filled_price || order.price || '—'}</td>
                      <td className="p-2.5">
                        <Badge variant={statusColors[order.status] || 'default'}>{order.status}</Badge>
                      </td>
                      <td className="p-2.5 text-text-secondary">{order.protocol}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return '—'
  try {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return timestamp
  }
}
