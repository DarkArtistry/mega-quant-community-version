import { useState, useEffect, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard, SkeletonTable, Skeleton } from '@/components/ui/skeleton'
import { NetworkFilter } from '@/components/shared/NetworkFilter'
import { PnlLineChart } from '@/components/charts/PnlLineChart'
import { useLiveDataStore } from '@/stores/useLiveDataStore'
import { useAppStore } from '@/stores/useAppStore'
import { cn } from '@/components/ui/utils'
import { pnlApi, type PnlBreakdown } from '@/api/pnl'
import { WalletBalancesCard } from './WalletBalancesCard'
import type { Position } from '@/types'

export function DashboardPage() {
  const { networkFilter } = useAppStore()
  const [isLoading, setIsLoading] = useState(true)
  const [positions, setPositions] = useState<Position[]>([])
  const [breakdown, setBreakdown] = useState<PnlBreakdown | null>(null)
  const [totalPnl, setTotalPnl] = useState<{ totalRealizedPnl: number; totalUnrealizedPnl: number; totalPnl: number; openPositionsCount: number } | null>(null)
  const [hourlyData, setHourlyData] = useState<any[]>([])
  const recentTrades = useLiveDataStore((s) => s.recentTrades)

  const fetchData = useCallback(async () => {
    const net = networkFilter !== 'all' ? networkFilter : undefined
    try {
      const [totalRes, positionsRes, hourlyRes, breakdownRes] = await Promise.allSettled([
        pnlApi.getTotal(undefined, undefined, net),
        pnlApi.getPositions(undefined, undefined, 'open', net),
        pnlApi.getHourly(24, undefined, undefined, net),
        pnlApi.getBreakdown(net),
      ])

      if (totalRes.status === 'fulfilled') {
        const s = totalRes.value.data.summary
        setTotalPnl({
          totalRealizedPnl: s.realizedPnl ?? s.totalRealizedPnl ?? 0,
          totalUnrealizedPnl: s.unrealizedPnl ?? s.totalUnrealizedPnl ?? 0,
          totalPnl: s.totalPnl ?? 0,
          openPositionsCount: s.openPositions ?? s.openPositionsCount ?? 0,
        })
      }
      if (positionsRes.status === 'fulfilled') {
        setPositions(positionsRes.value.data.positions || [])
      }
      if (hourlyRes.status === 'fulfilled') {
        setHourlyData(hourlyRes.value.data.snapshots || [])
      }
      if (breakdownRes.status === 'fulfilled') {
        const data = breakdownRes.value.data
        setBreakdown({
          global: data.global,
          byStrategy: data.byStrategy,
          byAccount: data.byAccount,
          timestamp: data.timestamp,
        })
      }
    } catch (err) {
      console.error('[Dashboard] Error fetching data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [networkFilter])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  const summary = totalPnl || { totalRealizedPnl: 0, totalUnrealizedPnl: 0, totalPnl: 0, openPositionsCount: 0 }
  const accounts = breakdown?.byAccount || []

  const chartData = useMemo(() => {
    const points = hourlyData
      .map((snapshot: any) => ({
        time: Math.floor(new Date(snapshot.timestamp).getTime() / 1000) as any,
        value: snapshot.total_pnl_usd ?? snapshot.totalPnl ?? 0,
      }))
      .sort((a: any, b: any) => a.time - b.time)
      .filter((item: any, i: number, arr: any[]) => i === 0 || item.time > arr[i - 1].time)

    // Append current real-time PnL as the latest data point so chart stays up-to-date
    if (summary.totalPnl !== 0 || points.length > 0) {
      const now = Math.floor(Date.now() / 1000) as any
      // Only append if it's newer than the last snapshot
      if (points.length === 0 || now > points[points.length - 1].time) {
        points.push({ time: now, value: summary.totalPnl })
      }
    }

    return points
  }, [hourlyData, summary.totalPnl])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <div className="flex items-center gap-2">
          <NetworkFilter />
          <Badge variant="accent">Live</Badge>
        </div>
      </div>

      {/* Portfolio Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          <SummaryCard label="Portfolio Value (All Accounts)" value={formatUsd(summary.totalPnl)} />
          <SummaryCard label="Realized PnL" value={formatUsd(summary.totalRealizedPnl)} change={summary.totalRealizedPnl} />
          <SummaryCard label="Unrealized PnL" value={formatUsd(summary.totalUnrealizedPnl)} change={summary.totalUnrealizedPnl} />
          <SummaryCard label="Open Positions" value={String(summary.openPositionsCount)} />
        </div>
      )}

      {/* Wallet Balances */}
      <WalletBalancesCard />

      {/* Charts + Recent Trades */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 h-[300px] rounded border border-border bg-surface p-3">
            <Skeleton className="h-3 w-20 mb-4" />
            <Skeleton className="h-full w-full" />
          </div>
          <div className="h-[300px] rounded border border-border bg-surface p-3">
            <Skeleton className="h-3 w-24 mb-4" />
            <Skeleton className="h-full w-full" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 h-[300px] rounded border border-border bg-surface p-3">
            <h3 className="text-xs font-medium text-text-secondary mb-2">Total PnL</h3>
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
                No PnL data yet — run strategies to generate data
              </div>
            ) : (
              <PnlLineChart data={chartData} height={250} />
            )}
          </div>
          <div className="h-[300px] rounded border border-border bg-surface p-3 flex flex-col">
            <h3 className="text-xs font-medium text-text-secondary mb-2">Recent Trades</h3>
            {recentTrades.length === 0 ? (
              <div className="flex items-center justify-center flex-1 text-text-tertiary text-xs">
                No trades yet
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-1">
                {recentTrades.map((trade) => (
                  <div
                    key={trade.executionId}
                    className="flex items-center justify-between text-2xs py-1 px-1.5 rounded hover:bg-background"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'font-medium uppercase',
                          trade.side === 'buy' ? 'text-positive' : 'text-negative'
                        )}
                      >
                        {trade.side}
                      </span>
                      <span className="text-text-primary font-medium">{trade.symbol}</span>
                    </div>
                    <div className="flex items-center gap-2 text-text-tertiary">
                      <span className="font-mono tabular-nums">{trade.quantity}</span>
                      <span className="font-mono tabular-nums">@{trade.price}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Positions Table */}
      {isLoading ? (
        <SkeletonTable rows={3} cols={5} />
      ) : positions.length === 0 ? (
        <div className="rounded border border-border bg-surface p-3">
          <h3 className="text-xs font-medium text-text-secondary mb-2">Open Positions</h3>
          <div className="text-xs text-text-tertiary">No open positions</div>
        </div>
      ) : (
        <div className="rounded border border-border bg-surface p-3">
          <h3 className="text-xs font-medium text-text-secondary mb-2">Open Positions</h3>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-2xs text-text-tertiary">
                <th className="pb-1.5 font-medium">Pair</th>
                <th className="pb-1.5 font-medium">Side</th>
                <th className="pb-1.5 font-medium">Venue</th>
                <th className="pb-1.5 font-medium text-right">Qty</th>
                <th className="pb-1.5 font-medium text-right">Avg Entry</th>
                <th className="pb-1.5 font-medium text-right">Unrealized PnL</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr key={pos.id} className="border-b border-border last:border-b-0 hover:bg-background">
                  <td className="py-1.5 text-2xs font-medium text-text-primary">
                    {pos.asset_symbol}
                    {pos.quote_asset_symbol && (
                      <span className="text-text-tertiary"> / {pos.quote_asset_symbol}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-2xs">
                    <span className={pos.side === 'long' ? 'text-positive' : 'text-negative'}>{pos.side}</span>
                  </td>
                  <td className="py-1.5 text-2xs text-text-secondary">
                    {pos.protocol || getVenueName(pos.chain_id)}
                  </td>
                  <td className="py-1.5 text-2xs font-mono tabular-nums text-right text-text-secondary">{pos.quantity}</td>
                  <td className="py-1.5 text-2xs font-mono tabular-nums text-right text-text-secondary">{pos.avg_entry_price}</td>
                  <td className="py-1.5 text-2xs font-mono tabular-nums text-right">
                    <PnlInline value={parseFloat(pos.unrealized_pnl || '0')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Local helper components                                           */
/* ------------------------------------------------------------------ */

function formatUsd(value: number): string {
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value < 0 ? `-$${formatted}` : `$${formatted}`
}

function SummaryCard({
  label,
  value,
  change,
}: {
  label: string
  value: string
  change?: number
}) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="text-2xs text-text-tertiary mb-1">{label}</div>
      <div className="text-lg font-semibold font-mono tabular-nums">{value}</div>
      {change !== undefined && (
        <div
          className={`text-2xs font-mono tabular-nums mt-0.5 ${
            change > 0 ? 'text-positive' : change < 0 ? 'text-negative' : 'text-text-tertiary'
          }`}
        >
          {change >= 0 ? '+' : ''}{formatUsd(change)}
        </div>
      )}
    </div>
  )
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  130: 'Unichain',
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  1301: 'Unichain Sepolia',
}

function getVenueName(chainId?: number): string {
  if (!chainId) return 'Binance'
  return CHAIN_NAMES[chainId] || `Chain ${chainId}`
}

function PnlInline({ value }: { value: number }) {
  const color = value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-text-tertiary'
  return (
    <span className={cn('text-2xs font-mono tabular-nums', color)}>
      {value >= 0 ? '+' : ''}{formatUsd(value)}
    </span>
  )
}
