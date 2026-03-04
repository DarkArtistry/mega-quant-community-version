import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SkeletonTable } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ClipboardList, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'
import { ordersApi } from '@/api/orders'
import { strategiesApi } from '@/api/strategies'
import type { Order } from '@/types'

const statusColors: Record<string, 'default' | 'positive' | 'warning' | 'negative'> = {
  pending: 'warning',
  filled: 'positive',
  cancelled: 'default',
  rejected: 'negative',
  partial: 'warning',
}

// Chain ID → block explorer base URL
const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io',
  8453: 'https://basescan.org',
  130: 'https://uniscan.xyz',
  11155111: 'https://sepolia.etherscan.io',
  84532: 'https://sepolia.basescan.org',
  1301: 'https://sepolia.uniscan.xyz',
}

function getExplorerTxUrl(order: Order): string | null {
  if (!order.tx_hash || !order.chain_id) return null
  const base = EXPLORER_URLS[order.chain_id]
  if (!base) return null
  return `${base}/tx/${order.tx_hash}`
}

/** Format a trading pair as "ASSET / COUNTER" so each leg of a linked swap looks different */
function formatPair(order: Order): { label: string; detail?: string } {
  if (order.token_in_symbol && order.token_out_symbol) {
    // Show {asset_symbol} / {counterpart} — sell USDT shows "USDT / ETH", buy ETH shows "ETH / USDT"
    const counterpart =
      order.asset_symbol === order.token_in_symbol
        ? order.token_out_symbol
        : order.asset_symbol === order.token_out_symbol
          ? order.token_in_symbol
          : order.token_out_symbol
    return { label: `${order.asset_symbol} / ${counterpart}` }
  }
  return { label: order.asset_symbol }
}

function formatQty(value: string): string {
  const num = parseFloat(value)
  if (isNaN(num)) return value
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  if (num < 1) return num.toFixed(6)
  if (num < 1000) return num.toFixed(4)
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatFees(order: Order): string {
  if (order.gas_cost_usd != null && order.gas_cost_usd > 0) {
    return `$${order.gas_cost_usd.toFixed(4)} gas`
  }
  if (order.commission) {
    const asset = order.commission_asset || ''
    return `${parseFloat(order.commission).toFixed(6)} ${asset}`.trim()
  }
  return '—'
}

const PAGE_SIZE = 50

export function OrdersPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [orderHistory, setOrderHistory] = useState<Order[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)

  // Filters
  const [strategies, setStrategies] = useState<Array<{ id: string; name: string }>>([])
  const [filterStrategy, setFilterStrategy] = useState<string>('')

  // Load strategies for filter dropdown
  useEffect(() => {
    strategiesApi.list().then((res) => {
      setStrategies((res.data.strategies || []).map((s: any) => ({ id: s.id, name: s.name })))
    }).catch(() => {})
  }, [])

  const fetchOrders = useCallback(async () => {
    try {
      const params: Record<string, any> = {}
      if (filterStrategy) params.strategy_id = filterStrategy

      const [pendingRes, historyRes] = await Promise.allSettled([
        ordersApi.getAll({ ...params, status: 'pending' }),
        ordersApi.getHistory({ limit: PAGE_SIZE, offset: historyPage * PAGE_SIZE, strategy_id: filterStrategy || undefined }),
      ])

      if (pendingRes.status === 'fulfilled') {
        setActiveOrders(pendingRes.value.data.orders || [])
      }
      if (historyRes.status === 'fulfilled') {
        setOrderHistory(historyRes.value.data.orders || [])
        setHistoryTotal((historyRes.value.data as any).total || 0)
      }
    } catch (err) {
      console.error('[Orders] Error fetching:', err)
    } finally {
      setIsLoading(false)
    }
  }, [filterStrategy, historyPage])

  useEffect(() => {
    fetchOrders()
    const interval = setInterval(fetchOrders, 15000)
    return () => clearInterval(interval)
  }, [fetchOrders])

  // Reset page when filter changes
  useEffect(() => {
    setHistoryPage(0)
  }, [filterStrategy])

  const totalHistoryPages = Math.ceil(historyTotal / PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Orders</h2>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <select
            value={filterStrategy}
            onChange={(e) => setFilterStrategy(e.target.value)}
            className="text-2xs bg-background border border-border rounded px-1.5 py-0.5 text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">All Strategies</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active Orders ({activeOrders.length})</TabsTrigger>
          <TabsTrigger value="history">Order History ({historyTotal})</TabsTrigger>
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
            <div className="rounded border border-border bg-surface overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-text-tertiary">
                    <th className="text-left p-2.5 font-medium">Time</th>
                    <th className="text-left p-2.5 font-medium">Type</th>
                    <th className="text-left p-2.5 font-medium">Side</th>
                    <th className="text-left p-2.5 font-medium">Pair</th>
                    <th className="text-right p-2.5 font-medium">Amounts</th>
                    <th className="text-right p-2.5 font-medium">Price</th>
                    <th className="text-left p-2.5 font-medium">Status</th>
                    <th className="text-right p-2.5 font-medium">Fees</th>
                    <th className="text-left p-2.5 font-medium">Protocol</th>
                    <th className="text-left p-2.5 font-medium w-6" />
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.map((order) => (
                    <OrderRow key={order.id} order={order} showFilledTime={false} />
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
            <>
              <div className="rounded border border-border bg-surface overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-text-tertiary">
                      <th className="text-left p-2.5 font-medium">Filled</th>
                      <th className="text-left p-2.5 font-medium">Type</th>
                      <th className="text-left p-2.5 font-medium">Side</th>
                      <th className="text-left p-2.5 font-medium">Pair</th>
                      <th className="text-right p-2.5 font-medium">Amounts</th>
                      <th className="text-right p-2.5 font-medium">Fill Price</th>
                      <th className="text-left p-2.5 font-medium">Status</th>
                      <th className="text-right p-2.5 font-medium">Fees</th>
                      <th className="text-left p-2.5 font-medium">Protocol</th>
                      <th className="text-left p-2.5 font-medium w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {orderHistory.map((order) => (
                      <OrderRow key={order.id} order={order} showFilledTime />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalHistoryPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-2xs text-text-tertiary">
                    Page {historyPage + 1} of {totalHistoryPages} ({historyTotal} orders)
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={historyPage === 0}
                      onClick={() => setHistoryPage((p) => p - 1)}
                    >
                      <ChevronLeft className="w-3 h-3" />
                      Prev
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={historyPage >= totalHistoryPages - 1}
                      onClick={() => setHistoryPage((p) => p + 1)}
                    >
                      Next
                      <ChevronRight className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function OrderRow({ order, showFilledTime }: { order: Order; showFilledTime: boolean }) {
  const pair = formatPair(order)
  const explorerUrl = getExplorerTxUrl(order)
  const timeStr = showFilledTime
    ? formatTime(order.filled_at || order.updated_at)
    : formatTime(order.created_at)

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-background">
      <td className="p-2.5 text-text-secondary">{timeStr}</td>
      <td className="p-2.5">{order.order_type}</td>
      <td className="p-2.5">
        <span className={order.side === 'buy' ? 'text-positive' : 'text-negative'}>
          {order.side}
        </span>
      </td>
      <td className="p-2.5 font-medium">{pair.label}</td>
      <td className="p-2.5 text-right font-mono text-text-secondary">
        {formatQty(showFilledTime ? (order.filled_quantity || order.quantity) : order.quantity)}
      </td>
      <td className="p-2.5 text-right font-mono">
        {showFilledTime ? (order.filled_price || order.price || '—') : (order.price || '—')}
      </td>
      <td className="p-2.5">
        <Badge variant={statusColors[order.status] || 'default'}>{order.status}</Badge>
      </td>
      <td className="p-2.5 text-right font-mono text-text-tertiary">{formatFees(order)}</td>
      <td className="p-2.5 text-text-secondary">{order.protocol}</td>
      <td className="p-2.5">
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent/80 transition-colors"
            title="View on block explorer"
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : null}
      </td>
    </tr>
  )
}

function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return '—'
  try {
    // UTC timestamps from DB are displayed in local time
    const date = new Date(timestamp.endsWith('Z') ? timestamp : timestamp + 'Z')
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return timestamp
  }
}
