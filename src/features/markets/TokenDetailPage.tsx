import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Activity } from 'lucide-react'
import { pricesApi, type PriceSource } from '@/api/prices'
import { NetworkBadge } from '@/components/shared/NetworkBadge'

interface TokenDetailPageProps {
  base: string
  quote: string
  onBack: () => void
}

const SOURCE_META: Record<string, { label: string; type: string; color: string; barColor: string }> = {
  binance:        { label: 'Binance',       type: 'CEX',        color: 'text-yellow-400', barColor: 'bg-yellow-400' },
  chainlink:      { label: 'Chainlink',     type: 'Oracle',     color: 'text-blue-400',   barColor: 'bg-blue-400' },
  coinmarketcap:  { label: 'CoinMarketCap', type: 'Aggregator', color: 'text-cyan-400',   barColor: 'bg-cyan-400' },
  coingecko:      { label: 'CoinGecko',     type: 'Aggregator', color: 'text-green-400',  barColor: 'bg-green-400' },
  defillama:      { label: 'DefiLlama',     type: 'DeFi',       color: 'text-purple-400', barColor: 'bg-purple-400' },
  'uniswap-v3':   { label: 'Uniswap V3',   type: 'DEX',        color: 'text-pink-400',   barColor: 'bg-pink-400' },
  'uniswap-v4':   { label: 'Uniswap V4',   type: 'DEX',        color: 'text-rose-400',   barColor: 'bg-rose-400' },
}

// Expected sources per quote currency
const EXPECTED_SOURCES: Record<string, string[]> = {
  'USD':  ['coingecko', 'defillama', 'coinmarketcap', 'chainlink'],
  'USDT': ['binance', 'uniswap-v3', 'uniswap-v4', 'coingecko', 'defillama'],
  'USDC': ['binance', 'uniswap-v3', 'uniswap-v4', 'coingecko', 'defillama'],
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 8 })
}

function formatDeviation(dev: number): string {
  const sign = dev > 0 ? '+' : ''
  return `${sign}${dev.toFixed(4)}%`
}

function formatFeeTier(feeTier: number): string {
  return `${(feeTier / 10000).toFixed(2)}%`
}

function getSpreadBadge(spread: number): { variant: 'positive' | 'warning' | 'negative'; label: string } {
  if (spread < 0.1) return { variant: 'positive', label: 'Tight' }
  if (spread < 0.5) return { variant: 'warning', label: 'Moderate' }
  return { variant: 'negative', label: 'Wide' }
}

/** Unique key for a source row — DEX sources have duplicate source names across networks */
function sourceKey(src: PriceSource): string {
  if (src.network) return `${src.source}-${src.chainId}`
  return src.source
}

export function TokenDetailPage({ base, quote, onBack }: TokenDetailPageProps) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [median, setMedian] = useState(0)
  const [spread, setSpread] = useState(0)
  const [sources, setSources] = useState<PriceSource[]>([])
  const [lastUpdate, setLastUpdate] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    setError(null)
    try {
      const res = await pricesApi.aggregated(base, quote)
      if (res.data.success) {
        setMedian(res.data.median)
        setSpread(res.data.spread)
        setSources(res.data.sources)
        setLastUpdate(res.data.timestamp)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch price data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [base, quote])

  useEffect(() => {
    fetchData()
    const interval = setInterval(() => fetchData(), 15000)
    return () => clearInterval(interval)
  }, [fetchData])

  const sortedSources = useMemo(() => {
    return [...sources].sort((a, b) => b.price - a.price)
  }, [sources])

  const priceRange = useMemo(() => {
    if (sources.length < 2) return { min: 0, max: 0, range: 0 }
    const prices = sources.map(s => s.price)
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    return { min, max, range: max - min }
  }, [sources])

  // Pre-compute deviations for the chart
  const deviations = useMemo(() => {
    if (median <= 0 || sources.length === 0) return []
    return sortedSources.map(src => ({
      key: sourceKey(src),
      source: src,
      deviation: ((src.price - median) / median) * 100,
    }))
  }, [sortedSources, median, sources.length])

  const maxAbsDeviation = useMemo(() => {
    if (deviations.length === 0) return 0.1
    const max = Math.max(...deviations.map(d => Math.abs(d.deviation)))
    return Math.max(max, 0.01) // minimum scale
  }, [deviations])

  const spreadBadge = getSpreadBadge(spread)

  const expectedSources = EXPECTED_SOURCES[quote] || []

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </Button>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Button>
      </div>

      {/* Token Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{base}/{quote}</h2>
            <Badge variant={spreadBadge.variant}>{spreadBadge.label} spread</Badge>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-mono font-bold tabular-nums">
              ${formatPrice(median)}
            </span>
            <span className="text-xs text-text-tertiary">median across {sources.length} sources</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2.5 rounded border border-negative/30 bg-negative/5 text-xs text-negative">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Key Metrics Row */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Median Price" value={`$${formatPrice(median)}`} />
        <MetricCard
          label="Spread"
          value={`${spread.toFixed(4)}%`}
          badge={spreadBadge}
        />
        <MetricCard label="Sources" value={`${sources.length} / ${expectedSources.length}`} />
        <MetricCard
          label="Price Range"
          value={priceRange.range > 0 ? `$${formatPrice(priceRange.range)}` : '-'}
          sub={priceRange.range > 0 ? `$${formatPrice(priceRange.min)} - $${formatPrice(priceRange.max)}` : undefined}
        />
      </div>

      {/* Price Deviation Chart — butterfly/divergence style */}
      {deviations.length > 0 && (
        <div className="rounded border border-border bg-surface overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-text-tertiary" />
              <h3 className="text-xs font-semibold text-text-secondary">Price Spread Fingerprint</h3>
            </div>
            <span className="text-2xs text-text-tertiary font-mono">
              median: ${formatPrice(median)}
            </span>
          </div>
          <div className="px-3 py-2.5">
            {/* Scale header */}
            <div className="flex items-center mb-1.5 text-2xs text-text-tertiary font-mono">
              <span className="w-[130px] shrink-0" />
              <div className="flex-1 flex items-center">
                <span className="flex-1 text-right pr-1">-{maxAbsDeviation.toFixed(3)}%</span>
                <span className="w-px" />
                <span className="flex-1 text-left pl-1">+{maxAbsDeviation.toFixed(3)}%</span>
              </div>
              <span className="w-[70px] shrink-0" />
            </div>
            {/* Bars */}
            {deviations.map(({ key, source: src, deviation }) => {
              const meta = SOURCE_META[src.source] || { label: src.source, type: '?', color: 'text-text-secondary', barColor: 'bg-text-tertiary' }
              const label = src.network ? `${meta.label} (${src.network})` : meta.label
              // Bar width: deviation relative to max, capped at 50% of the available space
              const pct = maxAbsDeviation > 0 ? Math.abs(deviation) / maxAbsDeviation : 0
              const barWidthPct = Math.min(pct * 50, 50)
              const isPositive = deviation >= 0

              return (
                <div key={key} className="flex items-center h-6 group">
                  {/* Label */}
                  <div className="w-[130px] shrink-0 text-2xs truncate pr-2">
                    <span className={`font-medium ${meta.color}`}>{label}</span>
                  </div>
                  {/* Bar area — left half = negative, right half = positive */}
                  <div className="flex-1 flex items-center h-full relative">
                    {/* Background grid lines */}
                    <div className="absolute inset-0 flex">
                      <div className="flex-1 border-r border-border/30" />
                      <div className="flex-1" />
                    </div>
                    {/* Center line */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-text-tertiary/40" />
                    {/* Bar */}
                    {isPositive ? (
                      <>
                        <div className="flex-1" />
                        <div className="flex-1 flex items-center">
                          <div
                            className={`h-3 rounded-r-sm ${meta.barColor} opacity-80 group-hover:opacity-100 transition-all duration-500 ease-out`}
                            style={{ width: `${barWidthPct}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 flex items-center justify-end">
                          <div
                            className={`h-3 rounded-l-sm ${meta.barColor} opacity-80 group-hover:opacity-100 transition-all duration-500 ease-out`}
                            style={{ width: `${barWidthPct}%` }}
                          />
                        </div>
                        <div className="flex-1" />
                      </>
                    )}
                  </div>
                  {/* Deviation value */}
                  <div className="w-[70px] shrink-0 text-right text-2xs font-mono tabular-nums pl-2">
                    <span className={
                      deviation > 0.01 ? 'text-positive' :
                      deviation < -0.01 ? 'text-negative' :
                      'text-text-tertiary'
                    }>
                      {formatDeviation(deviation)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Source Comparison Table */}
      <div className="rounded border border-border bg-surface">
        <div className="px-3 py-2 border-b border-border">
          <h3 className="text-xs font-semibold text-text-secondary">Price by Source</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-text-tertiary">
              <th className="text-left p-2.5 font-medium w-[220px]">Source</th>
              <th className="text-left p-2.5 font-medium w-[80px]">Type</th>
              <th className="text-right p-2.5 font-medium">Price ({quote})</th>
              <th className="text-right p-2.5 font-medium w-[120px]">vs Median</th>
              <th className="p-2.5 font-medium w-[200px]">Deviation</th>
            </tr>
          </thead>
          <tbody>
            {sortedSources.map((src) => {
              const meta = SOURCE_META[src.source] || { label: src.source, type: '?', color: 'text-text-secondary', barColor: 'bg-text-tertiary' }
              const deviation = median > 0 ? ((src.price - median) / median) * 100 : 0
              const absDeviation = Math.abs(deviation)
              const maxBarWidth = 100
              const barWidth = Math.min(absDeviation / 0.5 * maxBarWidth, maxBarWidth)
              const isDex = src.source === 'uniswap-v3' || src.source === 'uniswap-v4'

              return (
                <tr key={sourceKey(src)} className="border-b border-border last:border-b-0 hover:bg-background">
                  <td className="p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                      {src.network && src.chainId && (
                        <NetworkBadge chainId={src.chainId} className="text-2xs px-1.5 py-0" />
                      )}
                    </div>
                    {isDex && src.feeTier && (
                      <div className="text-2xs text-text-tertiary mt-0.5">
                        {src.path && src.path.length > 1 && (
                          <span className="mr-2">{src.path.join(' → ')}</span>
                        )}
                        Fee: {formatFeeTier(src.feeTier)}
                        {src.gasEstimateGwei != null && src.gasPriceGwei != null && (
                          <span className="ml-2">
                            Gas: ~{(src.gasEstimateGwei * src.gasPriceGwei * 1e-9).toFixed(6)} ETH
                          </span>
                        )}
                        {src.gasEstimateGwei != null && !src.gasPriceGwei && (
                          <span className="ml-2">Gas: ~{src.gasEstimateGwei.toLocaleString()} units</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-2.5">
                    <Badge variant="outline">{meta.type}</Badge>
                  </td>
                  <td className="p-2.5 text-right font-mono tabular-nums font-medium">
                    ${formatPrice(src.price)}
                  </td>
                  <td className="p-2.5 text-right font-mono tabular-nums">
                    <span className={
                      deviation > 0.01 ? 'text-positive' :
                      deviation < -0.01 ? 'text-negative' :
                      'text-text-tertiary'
                    }>
                      {deviation > 0.01 && <TrendingUp className="w-3 h-3 inline mr-1" />}
                      {deviation < -0.01 && <TrendingDown className="w-3 h-3 inline mr-1" />}
                      {Math.abs(deviation) <= 0.01 && <Minus className="w-3 h-3 inline mr-1" />}
                      {formatDeviation(deviation)}
                    </span>
                  </td>
                  <td className="p-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ease-out ${
                            deviation > 0.01 ? 'bg-positive' :
                            deviation < -0.01 ? 'bg-negative' :
                            'bg-text-tertiary'
                          }`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              )
            })}
            {sources.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-text-tertiary">
                  No price data available from any source
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Missing Sources for this quote currency */}
      {(() => {
        const missingSources = expectedSources.filter(key => !sources.find(s => s.source === key))
        if (missingSources.length === 0) return null
        return (
          <div className="rounded border border-border bg-surface p-3">
            <h3 className="text-xs font-semibold text-text-secondary mb-2">Unavailable Sources</h3>
            <div className="flex flex-wrap gap-2">
              {missingSources.map(key => {
                const meta = SOURCE_META[key]
                return (
                  <Badge key={key} variant="outline" className="text-text-tertiary">
                    {meta?.label || key} - not configured or unavailable
                  </Badge>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Footer */}
      <div className="text-2xs text-text-tertiary">
        Last updated: {lastUpdate ? new Date(lastUpdate).toLocaleString() : 'Never'} &middot; Auto-refreshes every 15s
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub, badge }: {
  label: string
  value: string
  sub?: string
  badge?: { variant: 'positive' | 'warning' | 'negative'; label: string }
}) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="text-2xs text-text-tertiary mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-semibold tabular-nums">{value}</span>
        {badge && <Badge variant={badge.variant} className="text-2xs">{badge.label}</Badge>}
      </div>
      {sub && <div className="text-2xs text-text-tertiary mt-0.5 font-mono">{sub}</div>}
    </div>
  )
}
