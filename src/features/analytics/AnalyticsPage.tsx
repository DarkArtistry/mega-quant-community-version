import { useState, useEffect, useCallback } from 'react'
import { SkeletonCard, Skeleton, SkeletonTable } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { BarChart3 } from 'lucide-react'
import { cn } from '@/components/ui/utils'
import { AccountPnlTable } from '@/features/analytics/AccountPnlTable'
import { pnlApi, type PnlBreakdown } from '@/api/pnl'

export function AnalyticsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [breakdown, setBreakdown] = useState<PnlBreakdown | null>(null)
  const [hourlyData, setHourlyData] = useState<any[]>([])

  const fetchData = useCallback(async () => {
    try {
      const [breakdownRes, hourlyRes] = await Promise.allSettled([
        pnlApi.getBreakdown(),
        pnlApi.getHourly(168),
      ])

      if (breakdownRes.status === 'fulfilled') {
        const data = breakdownRes.value.data
        setBreakdown({
          global: data.global,
          byStrategy: data.byStrategy,
          byAccount: data.byAccount,
          timestamp: data.timestamp,
        })
      }
      if (hourlyRes.status === 'fulfilled') {
        setHourlyData(hourlyRes.value.data.snapshots || [])
      }
    } catch (err) {
      console.error('[Analytics] Error fetching data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const global = breakdown?.global || {
    totalRealizedPnl: 0,
    totalUnrealizedPnl: 0,
    totalPnl: 0,
    openPositionsCount: 0,
    closedPositionsCount: 0,
  }

  const strategies = breakdown?.byStrategy || []
  const hasData = strategies.length > 0 || hourlyData.length > 0 || global.totalPnl !== 0

  if (!isLoading && !hasData) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Analytics</h2>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="by-account">By Account</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <EmptyState
              icon={BarChart3}
              title="No analytics data"
              description="Run strategies and execute trades to generate analytics"
            />
          </TabsContent>

          <TabsContent value="by-account">
            <div className="mt-2">
              <AccountPnlTable />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Analytics</h2>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="by-account">By Account</TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview">
          <div className="space-y-4">
            {/* Metric Cards */}
            {isLoading ? (
              <div className="grid grid-cols-4 gap-3">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                <MetricCard label="Total Realized PnL" value={formatUsd(global.totalRealizedPnl)} />
                <MetricCard label="Total Unrealized PnL" value={formatUsd(global.totalUnrealizedPnl)} />
                <MetricCard label="Open Positions" value={String(global.openPositionsCount)} />
                <MetricCard label="Closed Positions" value={String(global.closedPositionsCount)} />
              </div>
            )}

            {/* Charts */}
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="h-[300px] rounded border border-border bg-surface p-3">
                  <Skeleton className="h-3 w-20 mb-4" />
                  <Skeleton className="h-full w-full" />
                </div>
                <div className="h-[300px] rounded border border-border bg-surface p-3">
                  <Skeleton className="h-3 w-28 mb-4" />
                  <Skeleton className="h-full w-full" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="h-[300px] rounded border border-border bg-surface p-3">
                  <h3 className="text-xs font-medium text-text-secondary mb-2">Hourly PnL</h3>
                  {hourlyData.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
                      No hourly data yet
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
                      {hourlyData.length} hourly snapshots
                    </div>
                  )}
                </div>
                <div className="h-[300px] rounded border border-border bg-surface p-3">
                  <h3 className="text-xs font-medium text-text-secondary mb-2">Cumulative PnL</h3>
                  <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
                    {formatUsd(global.totalPnl)} total
                  </div>
                </div>
              </div>
            )}

            {/* Per-Strategy Breakdown */}
            {isLoading ? (
              <SkeletonTable rows={3} cols={7} />
            ) : strategies.length === 0 ? (
              <div className="rounded border border-border bg-surface p-3">
                <h3 className="text-xs font-medium text-text-secondary mb-2">Per-Strategy Breakdown</h3>
                <div className="text-xs text-text-tertiary">No strategy data yet</div>
              </div>
            ) : (
              <div className="rounded border border-border bg-surface">
                <div className="p-3 border-b border-border">
                  <h3 className="text-xs font-medium text-text-secondary">
                    Per-Strategy Breakdown
                  </h3>
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border text-2xs text-text-tertiary">
                      <th className="px-3 py-2 font-medium">Strategy</th>
                      <th className="px-3 py-2 font-medium text-right">Realized</th>
                      <th className="px-3 py-2 font-medium text-right">Unrealized</th>
                      <th className="px-3 py-2 font-medium text-right">Total PnL</th>
                      <th className="px-3 py-2 font-medium text-right">Open</th>
                      <th className="px-3 py-2 font-medium text-right">Closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategies.map((strat) => (
                      <tr
                        key={strat.strategyId}
                        className="border-b border-border last:border-b-0 hover:bg-background"
                      >
                        <td className="px-3 py-2 text-2xs font-medium text-text-primary">
                          {strat.strategyName || strat.strategyId}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <PnlCell value={strat.totalRealizedPnl} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <PnlCell value={strat.totalUnrealizedPnl} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <PnlCell value={strat.totalPnl} bold />
                        </td>
                        <td className="px-3 py-2 text-right text-2xs font-mono tabular-nums text-text-secondary">
                          {strat.openPositionsCount}
                        </td>
                        <td className="px-3 py-2 text-right text-2xs font-mono tabular-nums text-text-secondary">
                          {strat.closedPositionsCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* BY ACCOUNT TAB */}
        <TabsContent value="by-account">
          <div className="space-y-4">
            <AccountPnlTable />
          </div>
        </TabsContent>
      </Tabs>
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="text-2xs text-text-tertiary mb-1">{label}</div>
      <div className="text-base font-semibold font-mono tabular-nums">{value}</div>
    </div>
  )
}

function PnlCell({ value, bold }: { value: number; bold?: boolean }) {
  const color =
    value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-text-tertiary'
  return (
    <span
      className={cn(
        'text-2xs font-mono tabular-nums',
        color,
        bold && 'font-semibold'
      )}
    >
      {value >= 0 ? '+' : ''}{formatUsd(value)}
    </span>
  )
}
