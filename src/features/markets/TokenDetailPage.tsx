import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import { pricesApi, type PriceSource } from '@/api/prices'

interface TokenDetailPageProps {
  symbol: string
  onBack: () => void
}

const SOURCE_META: Record<string, { label: string; type: string; color: string }> = {
  binance: { label: 'Binance', type: 'CEX', color: 'text-yellow-400' },
  chainlink: { label: 'Chainlink', type: 'Oracle', color: 'text-blue-400' },
  coinmarketcap: { label: 'CoinMarketCap', type: 'Aggregator', color: 'text-cyan-400' },
  coingecko: { label: 'CoinGecko', type: 'Aggregator', color: 'text-green-400' },
  defillama: { label: 'DefiLlama', type: 'DeFi', color: 'text-purple-400' },
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

function getSpreadBadge(spread: number): { variant: 'positive' | 'warning' | 'negative'; label: string } {
  if (spread < 0.1) return { variant: 'positive', label: 'Tight' }
  if (spread < 0.5) return { variant: 'warning', label: 'Moderate' }
  return { variant: 'negative', label: 'Wide' }
}

export function TokenDetailPage({ symbol, onBack }: TokenDetailPageProps) {
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
      const res = await pricesApi.aggregated(symbol)
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
  }, [symbol])

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

  const spreadBadge = getSpreadBadge(spread)

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
            <h2 className="text-xl font-bold">{symbol}/USD</h2>
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
        <MetricCard label="Sources" value={`${sources.length} / 5`} />
        <MetricCard
          label="Price Range"
          value={priceRange.range > 0 ? `$${formatPrice(priceRange.range)}` : '-'}
          sub={priceRange.range > 0 ? `$${formatPrice(priceRange.min)} - $${formatPrice(priceRange.max)}` : undefined}
        />
      </div>

      {/* Source Comparison Table */}
      <div className="rounded border border-border bg-surface">
        <div className="px-3 py-2 border-b border-border">
          <h3 className="text-xs font-semibold text-text-secondary">Price by Source</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-text-tertiary">
              <th className="text-left p-2.5 font-medium w-[200px]">Source</th>
              <th className="text-left p-2.5 font-medium w-[80px]">Type</th>
              <th className="text-right p-2.5 font-medium">Price (USD)</th>
              <th className="text-right p-2.5 font-medium w-[120px]">vs Median</th>
              <th className="p-2.5 font-medium w-[200px]">Deviation</th>
            </tr>
          </thead>
          <tbody>
            {sortedSources.map((src) => {
              const meta = SOURCE_META[src.source] || { label: src.source, type: '?', color: 'text-text-secondary' }
              const deviation = median > 0 ? ((src.price - median) / median) * 100 : 0
              const absDeviation = Math.abs(deviation)
              const maxBarWidth = 100 // max percentage width for the bar
              // Scale: 0.5% deviation = full bar
              const barWidth = Math.min(absDeviation / 0.5 * maxBarWidth, maxBarWidth)

              return (
                <tr key={src.source} className="border-b border-border last:border-b-0 hover:bg-background">
                  <td className="p-2.5">
                    <span className={`font-medium ${meta.color}`}>{meta.label}</span>
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
                          className={`h-full rounded-full transition-all ${
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

      {/* Missing Sources */}
      {sources.length < 5 && (
        <div className="rounded border border-border bg-surface p-3">
          <h3 className="text-xs font-semibold text-text-secondary mb-2">Unavailable Sources</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SOURCE_META)
              .filter(([key]) => !sources.find(s => s.source === key))
              .map(([key, meta]) => (
                <Badge key={key} variant="outline" className="text-text-tertiary">
                  {meta.label} - not configured or unavailable
                </Badge>
              ))}
          </div>
        </div>
      )}

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
