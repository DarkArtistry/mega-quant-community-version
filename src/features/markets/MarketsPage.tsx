import { useState, useEffect, useCallback, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SkeletonTable } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Search, TrendingUp, ChevronRight } from 'lucide-react'
import { pricesApi } from '@/api/prices'
import { TokenDetailPage } from './TokenDetailPage'

interface MarketRow {
  symbol: string
  median: number
  spread: number
  sourceCount: number
}

const DEFAULT_SYMBOLS = ['BTC', 'ETH', 'WBTC', 'AAVE', 'LINK', 'UNI', 'OP', 'ARB', 'SOL', 'USDC', 'USDT', 'DAI']

function getSpreadVariant(spread: number): 'positive' | 'warning' | 'negative' {
  if (spread < 0.1) return 'positive'
  if (spread < 0.5) return 'warning'
  return 'negative'
}

export function MarketsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [markets, setMarkets] = useState<MarketRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedToken, setSelectedToken] = useState<string | null>(null)

  const fetchPrices = useCallback(async () => {
    try {
      const res = await pricesApi.aggregatedBatch(DEFAULT_SYMBOLS)

      if (res.data.success && res.data.prices) {
        const rows: MarketRow[] = Object.entries(res.data.prices).map(([symbol, data]) => ({
          symbol,
          median: data.median,
          spread: data.spread,
          sourceCount: data.sourceCount,
        }))
        // Sort by price descending
        rows.sort((a, b) => b.median - a.median)
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
    if (!searchQuery.trim()) return markets
    const q = searchQuery.toLowerCase()
    return markets.filter((m) => m.symbol.toLowerCase().includes(q))
  }, [markets, searchQuery])

  // Show detail page if a token is selected
  if (selectedToken) {
    return (
      <TokenDetailPage
        symbol={selectedToken}
        onBack={() => setSelectedToken(null)}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Markets</h2>
        <span className="text-2xs text-text-tertiary">
          {markets.length} tokens &middot; Auto-refreshes every 30s
        </span>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
        <Input
          placeholder="Search tokens..."
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
        <div className="rounded border border-border bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-text-tertiary">
                <th className="text-left p-2.5 font-medium">Token</th>
                <th className="text-right p-2.5 font-medium">Price (USD)</th>
                <th className="text-right p-2.5 font-medium">Spread</th>
                <th className="text-center p-2.5 font-medium">Sources</th>
                <th className="w-8 p-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr
                  key={m.symbol}
                  onClick={() => setSelectedToken(m.symbol)}
                  className="border-b border-border last:border-b-0 hover:bg-background cursor-pointer transition-colors"
                >
                  <td className="p-2.5">
                    <span className="font-semibold">{m.symbol}</span>
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
                    <span className="text-text-secondary">{m.sourceCount}/5</span>
                  </td>
                  <td className="p-2.5 text-right">
                    <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
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
