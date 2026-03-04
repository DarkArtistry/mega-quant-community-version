import { useState, useEffect, useCallback, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SkeletonTable } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Search, TrendingUp, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, Star } from 'lucide-react'
import { pricesApi, type TradingPair } from '@/api/prices'
import { TokenDetailPage } from './TokenDetailPage'
import { useFavoritesStore } from '@/stores/useFavoritesStore'

interface MarketRow {
  base: string
  quote: string
  pairKey: string
  median: number
  spread: number
  sourceCount: number
}

const DEFAULT_PAIRS: TradingPair[] = [
  { base: 'BTC', quote: 'USD' }, { base: 'BTC', quote: 'USDT' },
  { base: 'WBTC', quote: 'USD' }, { base: 'WBTC', quote: 'USDT' }, { base: 'WBTC', quote: 'USDC' },
  { base: 'ETH', quote: 'USD' }, { base: 'ETH', quote: 'USDT' }, { base: 'ETH', quote: 'USDC' },
  { base: 'SOL', quote: 'USD' }, { base: 'SOL', quote: 'USDT' },
  { base: 'LINK', quote: 'USD' }, { base: 'LINK', quote: 'USDT' }, { base: 'LINK', quote: 'USDC' },
  { base: 'AAVE', quote: 'USD' }, { base: 'AAVE', quote: 'USDT' }, { base: 'AAVE', quote: 'USDC' },
  { base: 'UNI', quote: 'USD' }, { base: 'UNI', quote: 'USDT' }, { base: 'UNI', quote: 'USDC' },
  { base: 'OP', quote: 'USD' }, { base: 'OP', quote: 'USDT' }, { base: 'OP', quote: 'USDC' },
  { base: 'ARB', quote: 'USD' }, { base: 'ARB', quote: 'USDT' }, { base: 'ARB', quote: 'USDC' },
  { base: 'MON', quote: 'USD' },
  { base: 'SHIB', quote: 'USD' }, { base: 'SHIB', quote: 'USDT' }, { base: 'SHIB', quote: 'USDC' },
  { base: 'MNT', quote: 'USD' }, { base: 'MNT', quote: 'USDT' }, { base: 'MNT', quote: 'USDC' },
  { base: 'DOT', quote: 'USD' }, { base: 'DOT', quote: 'USDT' }, { base: 'DOT', quote: 'USDC' },
  { base: 'WLD', quote: 'USD' }, { base: 'WLD', quote: 'USDT' }, { base: 'WLD', quote: 'USDC' },
  { base: 'STETH', quote: 'USD' }, { base: 'STETH', quote: 'USDT' }, { base: 'STETH', quote: 'USDC' },
  { base: 'USDC', quote: 'USD' }, { base: 'USDC', quote: 'USDT' },
  { base: 'USDT', quote: 'USD' },
  { base: 'DAI', quote: 'USD' },
]

// For sorting: group by base, then order quotes USD > USDT > USDC
const QUOTE_ORDER: Record<string, number> = { 'USD': 0, 'USDT': 1, 'USDC': 2 }

type SortField = 'pair' | 'price' | 'spread' | 'sources'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE_OPTIONS = [15, 30, 45] as const

function getSpreadVariant(spread: number): 'positive' | 'warning' | 'negative' {
  if (spread < 0.1) return 'positive'
  if (spread < 0.5) return 'warning'
  return 'negative'
}

function SortIcon({ field, activeField, dir }: { field: SortField; activeField: SortField | null; dir: SortDir }) {
  if (activeField !== field) return <ChevronsUpDown className="inline w-3 h-3 ml-0.5 opacity-40" />
  return dir === 'asc'
    ? <ChevronUp className="inline w-3 h-3 ml-0.5" />
    : <ChevronDown className="inline w-3 h-3 ml-0.5" />
}

export function MarketsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [markets, setMarkets] = useState<MarketRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedPair, setSelectedPair] = useState<{ base: string; quote: string } | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)

  const { favorites, toggleFavorite } = useFavoritesStore()

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  // Reset page to 1 when filters/sort/pageSize change
  useEffect(() => {
    setPage(1)
  }, [searchQuery, sortField, sortDir, pageSize])

  const fetchPrices = useCallback(async () => {
    try {
      const res = await pricesApi.aggregatedBatchPairs(DEFAULT_PAIRS)

      if (res.data.success && res.data.prices) {
        const rows: MarketRow[] = Object.entries(res.data.prices).map(([pairKey, data]) => ({
          base: data.base,
          quote: data.quote,
          pairKey,
          median: data.median,
          spread: data.spread,
          sourceCount: data.sourceCount,
        }))
        // Sort: group by base (by highest median price first), then USD > USDT > USDC within each group
        rows.sort((a, b) => {
          if (a.base !== b.base) return b.median - a.median
          return (QUOTE_ORDER[a.quote] ?? 9) - (QUOTE_ORDER[b.quote] ?? 9)
        })
        setMarkets(rows)
      }
    } catch (err) {
      console.error('[Markets] Error fetching prices:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrices()
    const interval = setInterval(fetchPrices, 30000)
    return () => clearInterval(interval)
  }, [fetchPrices])

  const filtered = useMemo(() => {
    // 1. Filter by search query
    let rows = markets
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      rows = rows.filter((m) =>
        m.base.toLowerCase().includes(q) ||
        m.quote.toLowerCase().includes(q) ||
        m.pairKey.toLowerCase().includes(q)
      )
    }

    // 2. Apply user sort
    if (sortField) {
      const dir = sortDir === 'asc' ? 1 : -1
      rows = [...rows].sort((a, b) => {
        switch (sortField) {
          case 'pair': return dir * a.pairKey.localeCompare(b.pairKey)
          case 'price': return dir * (a.median - b.median)
          case 'spread': return dir * (a.spread - b.spread)
          case 'sources': return dir * (a.sourceCount - b.sourceCount)
          default: return 0
        }
      })
    }

    // 3. Stable-partition: favorites first, non-favorites second
    const favSet = new Set(favorites)
    const favRows = rows.filter((m) => favSet.has(m.pairKey))
    const nonFavRows = rows.filter((m) => !favSet.has(m.pairKey))
    return [...favRows, ...nonFavRows]
  }, [markets, searchQuery, sortField, sortDir, favorites])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginatedRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  // Show detail page if a pair is selected
  if (selectedPair) {
    return (
      <TokenDetailPage
        base={selectedPair.base}
        quote={selectedPair.quote}
        onBack={() => setSelectedPair(null)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Markets</h2>
        <span className="text-2xs text-text-tertiary">
          {markets.length} pairs &middot; Auto-refreshes every 30s
        </span>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
        <Input
          placeholder="Search pairs..."
          className="pl-8"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} cols={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title={markets.length === 0 ? 'No market data' : 'No matches'}
          description={markets.length === 0 ? 'Connect to backend to view market data' : 'Try a different search term'}
        />
      ) : (
        <>
          <div className="rounded border border-border bg-surface">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-text-tertiary">
                  <th className="w-8 p-2.5"></th>
                  <th className="text-left p-2.5 font-medium cursor-pointer select-none hover:text-text-secondary" onClick={() => toggleSort('pair')}>
                    Pair<SortIcon field="pair" activeField={sortField} dir={sortDir} />
                  </th>
                  <th className="text-right p-2.5 font-medium cursor-pointer select-none hover:text-text-secondary" onClick={() => toggleSort('price')}>
                    Price<SortIcon field="price" activeField={sortField} dir={sortDir} />
                  </th>
                  <th className="text-right p-2.5 font-medium cursor-pointer select-none hover:text-text-secondary" onClick={() => toggleSort('spread')}>
                    Spread<SortIcon field="spread" activeField={sortField} dir={sortDir} />
                  </th>
                  <th className="text-center p-2.5 font-medium cursor-pointer select-none hover:text-text-secondary" onClick={() => toggleSort('sources')}>
                    Sources<SortIcon field="sources" activeField={sortField} dir={sortDir} />
                  </th>
                  <th className="w-8 p-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((m) => {
                  const isFav = favorites.includes(m.pairKey)
                  return (
                    <tr
                      key={m.pairKey}
                      onClick={() => setSelectedPair({ base: m.base, quote: m.quote })}
                      className="border-b border-border last:border-b-0 hover:bg-background cursor-pointer transition-colors"
                    >
                      <td className="p-2.5 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFavorite(m.pairKey)
                          }}
                          className="hover:scale-110 transition-transform"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${isFav ? 'fill-yellow-400 text-yellow-400' : 'text-text-tertiary hover:text-text-secondary'}`}
                          />
                        </button>
                      </td>
                      <td className="p-2.5">
                        <span className="font-semibold">{m.base}</span>
                        <span className="text-text-tertiary">/{m.quote}</span>
                      </td>
                      <td className="p-2.5 text-right font-mono tabular-nums font-medium">
                        ${m.median > 0
                          ? m.median.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: m.median >= 1 ? 2 : 6,
                            })
                          : '-.--'}
                      </td>
                      <td className="p-2.5 text-right">
                        {m.sourceCount > 1 ? (
                          <Badge variant={getSpreadVariant(m.spread)}>
                            {m.spread.toFixed(3)}%
                          </Badge>
                        ) : (
                          <span className="text-text-tertiary">-</span>
                        )}
                      </td>
                      <td className="p-2.5 text-center">
                        <span className="text-text-secondary">{m.sourceCount}</span>
                      </td>
                      <td className="p-2.5 text-right">
                        <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination controls */}
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <div className="flex items-center gap-1.5">
              <span className="text-text-tertiary">Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="bg-surface border border-border rounded px-1.5 py-0.5 text-xs text-text-secondary outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-text-tertiary">
                Page {safePage} of {totalPages}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="p-1 rounded border border-border hover:bg-background disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="p-1 rounded border border-border hover:bg-background disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
