import { useState, useEffect, useCallback, useMemo } from 'react'
import { SkeletonCard, Skeleton, SkeletonTable } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { NetworkFilter } from '@/components/shared/NetworkFilter'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { BarChart3, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/components/ui/utils'
import { AccountPnlTable } from '@/features/analytics/AccountPnlTable'
import { PnlLineChart } from '@/components/charts/PnlLineChart'
import { useAppStore } from '@/stores/useAppStore'
import { pnlApi, type PnlBreakdown } from '@/api/pnl'
import type { Position } from '@/types'

export function AnalyticsPage() {
  const { networkFilter } = useAppStore()
  const [isLoading, setIsLoading] = useState(true)
  const [breakdown, setBreakdown] = useState<PnlBreakdown | null>(null)
  const [hourlyData, setHourlyData] = useState<any[]>([])

  const fetchData = useCallback(async () => {
    const net = networkFilter !== 'all' ? networkFilter : undefined
    try {
      const [breakdownRes, hourlyRes] = await Promise.allSettled([
        pnlApi.getBreakdown(net),
        pnlApi.getHourly(168, undefined, undefined, net),
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
  }, [networkFilter])

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

  // Transform hourly snapshots into chart data
  const hourlyChartData = useMemo(() => {
    const points = hourlyData
      .map((s: any) => ({
        time: Math.floor(new Date(s.timestamp).getTime() / 1000) as any,
        value: s.total_pnl_usd ?? s.totalPnl ?? 0,
      }))
      .sort((a: any, b: any) => a.time - b.time)
      .filter((item: any, i: number, arr: any[]) => i === 0 || item.time > arr[i - 1].time)
    return points
  }, [hourlyData])

  // Cumulative PnL chart: snapshots + current real-time PnL as latest point
  const cumulativeChartData = useMemo(() => {
    const points = [...hourlyChartData]
    // Append current real-time PnL so the chart shows up-to-date values
    if (global.totalPnl !== 0 || points.length > 0) {
      const now = Math.floor(Date.now() / 1000) as any
      if (points.length === 0 || now > points[points.length - 1].time) {
        points.push({ time: now, value: global.totalPnl })
      }
    }
    return points
  }, [hourlyChartData, global.totalPnl])

  if (!isLoading && !hasData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Analytics</h2>
          <NetworkFilter />
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="by-strategy">By Strategy</TabsTrigger>
            <TabsTrigger value="by-account">By Account</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <EmptyState
              icon={BarChart3}
              title="No analytics data"
              description="Run strategies and execute trades to generate analytics"
            />
          </TabsContent>

          <TabsContent value="by-strategy">
            <div className="mt-2 text-xs text-text-tertiary">No strategy data yet</div>
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Analytics</h2>
        <NetworkFilter />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="by-strategy">By Strategy</TabsTrigger>
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
                  {hourlyChartData.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
                      No hourly data yet
                    </div>
                  ) : (
                    <PnlLineChart data={hourlyChartData} height={250} showArea={false} />
                  )}
                </div>
                <div className="h-[300px] rounded border border-border bg-surface p-3">
                  <h3 className="text-xs font-medium text-text-secondary mb-2">Cumulative PnL</h3>
                  {cumulativeChartData.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
                      No data yet
                    </div>
                  ) : (
                    <PnlLineChart data={cumulativeChartData} height={250} />
                  )}
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

        {/* BY STRATEGY TAB */}
        <TabsContent value="by-strategy">
          <div className="space-y-4">
            {strategies.length === 0 ? (
              <div className="text-xs text-text-tertiary">No strategy data yet</div>
            ) : (
              <StrategyPnlTable strategies={strategies} />
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

/* ------------------------------------------------------------------ */
/*  By-Strategy expandable table                                      */
/* ------------------------------------------------------------------ */

interface StrategyEntry {
  strategyId: string
  strategyName: string
  totalRealizedPnl: number
  totalUnrealizedPnl: number
  totalPnl: number
  openPositionsCount: number
  closedPositionsCount: number
}

function StrategyPnlTable({ strategies }: { strategies: StrategyEntry[] }) {
  const { networkFilter } = useAppStore()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [positions, setPositions] = useState<Record<string, Position[]>>({})

  const toggle = async (strategyId: string) => {
    const net = networkFilter !== 'all' ? networkFilter : undefined
    const isOpen = expanded[strategyId]
    setExpanded((prev) => ({ ...prev, [strategyId]: !isOpen }))
    if (!isOpen && !positions[strategyId]) {
      try {
        const res = await pnlApi.getPositions(strategyId, undefined, 'open', net)
        setPositions((prev) => ({ ...prev, [strategyId]: res.data.positions || [] }))
      } catch {
        setPositions((prev) => ({ ...prev, [strategyId]: [] }))
      }
    }
  }

  return (
    <div className="rounded border border-border bg-surface">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border text-2xs text-text-tertiary">
            <th className="px-3 py-2 font-medium w-6" />
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
            <>
              <tr
                key={strat.strategyId}
                className="border-b border-border last:border-b-0 hover:bg-background cursor-pointer"
                onClick={() => toggle(strat.strategyId)}
              >
                <td className="px-3 py-2 text-text-tertiary">
                  {expanded[strat.strategyId] ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </td>
                <td className="px-3 py-2 text-2xs font-medium text-text-primary">
                  {strat.strategyName || strat.strategyId}
                </td>
                <td className="px-3 py-2 text-right"><PnlCell value={strat.totalRealizedPnl} /></td>
                <td className="px-3 py-2 text-right"><PnlCell value={strat.totalUnrealizedPnl} /></td>
                <td className="px-3 py-2 text-right"><PnlCell value={strat.totalPnl} bold /></td>
                <td className="px-3 py-2 text-right text-2xs font-mono tabular-nums text-text-secondary">
                  {strat.openPositionsCount}
                </td>
                <td className="px-3 py-2 text-right text-2xs font-mono tabular-nums text-text-secondary">
                  {strat.closedPositionsCount}
                </td>
              </tr>
              {expanded[strat.strategyId] && (
                <tr key={`${strat.strategyId}-positions`}>
                  <td colSpan={7} className="p-0">
                    <div className="bg-background px-6 py-2">
                      {!positions[strat.strategyId] ? (
                        <div className="text-2xs text-text-tertiary">Loading...</div>
                      ) : positions[strat.strategyId].length === 0 ? (
                        <div className="text-2xs text-text-tertiary">No open positions</div>
                      ) : (
                        <table className="w-full text-2xs">
                          <thead>
                            <tr className="text-text-tertiary">
                              <th className="text-left px-2 py-1 font-medium whitespace-nowrap">Asset</th>
                              <th className="text-left px-2 py-1 font-medium whitespace-nowrap">Side</th>
                              <th className="text-right px-2 py-1 font-medium whitespace-nowrap">Qty</th>
                              <th className="text-right px-2 py-1 font-medium whitespace-nowrap">Entry Price</th>
                              <th className="text-right px-2 py-1 font-medium whitespace-nowrap">Current</th>
                              <th className="text-right px-2 py-1 font-medium whitespace-nowrap">Realized</th>
                              <th className="text-right px-2 py-1 font-medium whitespace-nowrap">Unrealized</th>
                              <th className="text-left px-2 py-1 font-medium whitespace-nowrap">Protocol</th>
                            </tr>
                          </thead>
                          <tbody>
                            {positions[strat.strategyId].map((p) => {
                              const rpnl = parseFloat(p.realized_pnl || '0')
                              const upnl = parseFloat(p.unrealized_pnl || '0')
                              return (
                                <tr key={p.id} className="border-t border-border/50">
                                  <td className="px-2 py-1 font-medium">{p.asset_symbol}</td>
                                  <td className="px-2 py-1">
                                    <span className={p.side === 'long' ? 'text-positive' : 'text-negative'}>{p.side}</span>
                                  </td>
                                  <td className="px-2 py-1 text-right font-mono">{formatQty(p.quantity)}</td>
                                  <td className="px-2 py-1 text-right font-mono">{formatPrice(p.avg_entry_price)}</td>
                                  <td className="px-2 py-1 text-right font-mono">{p.current_price ? formatPrice(p.current_price) : '—'}</td>
                                  <td className="px-2 py-1 text-right"><PnlCell value={rpnl} /></td>
                                  <td className="px-2 py-1 text-right"><PnlCell value={upnl} /></td>
                                  <td className="px-2 py-1 text-text-secondary">{p.protocol || '—'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatQty(value: string): string {
  const num = parseFloat(value)
  if (isNaN(num)) return value
  if (num < 0.0001) return '<0.0001'
  if (num < 1) return num.toFixed(6)
  if (num < 1000) return num.toFixed(4)
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatPrice(value: string): string {
  const num = parseFloat(value)
  if (isNaN(num)) return value
  if (num < 0.01) return num.toExponential(2)
  if (num < 1) return num.toFixed(6)
  if (num < 100) return num.toFixed(4)
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
