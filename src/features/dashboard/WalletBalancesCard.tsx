import { useState, useEffect, useCallback, useRef } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { NetworkBadge } from '@/components/shared/NetworkBadge'
import { Skeleton, SkeletonTable } from '@/components/ui/skeleton'
import { walletsApi, type WalletAccount, type ChainBalances, type TokenBalance, type CexBalance } from '@/api/wallets'
import { pricesApi } from '@/api/prices'

// Testnet chain IDs — visible but excluded from USD totals
const TESTNET_CHAIN_IDS = new Set([11155111, 84532, 1301])

function isTestnet(chainId: number): boolean {
  return TESTNET_CHAIN_IDS.has(chainId)
}

function formatBalance(value: string): string {
  const num = parseFloat(value)
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  if (num < 1) return num.toFixed(6)
  if (num < 1000) return num.toFixed(4)
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatUsd(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return '<$0.01'
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface ChainWithBalances {
  chain: ChainBalances
  nonZeroTokens: Array<TokenBalance & { usdValue?: number }>
}

export function WalletBalancesCard() {
  const [accounts, setAccounts] = useState<WalletAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [chainBalances, setChainBalances] = useState<ChainBalances[]>([])
  const [binanceBalances, setBinanceBalances] = useState<CexBalance[]>([])
  const [hasBinance, setHasBinance] = useState(false)
  const [binanceError, setBinanceError] = useState<string | null>(null)
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true)
  const [isLoadingBalances, setIsLoadingBalances] = useState(false)
  const [activeTab, setActiveTab] = useState('all')
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>()

  // Load accounts on mount
  useEffect(() => {
    walletsApi.getAccounts()
      .then((res) => {
        const accts = res.data.accounts || []
        setAccounts(accts)
        if (accts.length > 0) {
          setSelectedAccountId(accts[0].id)
        }
      })
      .catch((err) => {
        console.error('[WalletBalances] Failed to load accounts:', err)
      })
      .finally(() => setIsLoadingAccounts(false))
  }, [])

  // Fetch balances when account changes
  const fetchBalances = useCallback(async (address: string) => {
    setIsLoadingBalances(true)
    try {
      // Fetch on-chain balances + Binance balances in parallel
      const chainsRes = await walletsApi.getSupportedChains()
      const chains = chainsRes.data.chains || []

      const [balancesRes, binanceRes] = await Promise.allSettled([
        walletsApi.getMultiChainBalances(address, chains),
        walletsApi.getBinanceBalances(),
      ])

      const balances = balancesRes.status === 'fulfilled' ? balancesRes.value.data.balances || [] : []
      setChainBalances(balances)

      if (binanceRes.status === 'fulfilled') {
        const bData = binanceRes.value.data
        setBinanceBalances(bData.balances || [])
        setHasBinance(bData.configured ?? false)
        setBinanceError(bData.error || null)
        if (!bData.configured) {
          console.log('[WalletBalances] Binance not configured — keys not found in api-key-store')
        }
        if (bData.error) {
          console.warn('[WalletBalances] Binance API error:', bData.error)
        }
      } else {
        console.error('[WalletBalances] Binance request failed:', binanceRes.reason)
        setBinanceError('Failed to connect to Binance')
      }

      // Collect unique symbols for price lookup (mainnet on-chain + Binance)
      const symbols = new Set<string>()
      for (const cb of balances) {
        if (isTestnet(cb.chainId)) continue
        if (parseFloat(cb.nativeBalance.formattedBalance) > 0) {
          symbols.add(cb.nativeBalance.symbol)
        }
        for (const t of cb.tokens) {
          if (parseFloat(t.formattedBalance) > 0) {
            symbols.add(t.symbol)
          }
        }
      }
      // Binance balances
      if (binanceRes.status === 'fulfilled') {
        for (const b of binanceRes.value.data.balances || []) {
          if (parseFloat(b.total) > 0) symbols.add(b.asset)
        }
      }

      if (symbols.size > 0) {
        try {
          const priceRes = await pricesApi.batch(Array.from(symbols))
          setPrices(priceRes.data.prices || {})
        } catch {
          setPrices({})
        }
      } else {
        setPrices({})
      }
    } catch (err) {
      console.error('[WalletBalances] Failed to fetch balances:', err)
    } finally {
      setIsLoadingBalances(false)
    }
  }, [])

  // Trigger balance fetch on account selection
  useEffect(() => {
    const account = accounts.find((a) => a.id === selectedAccountId)
    if (!account) return

    fetchBalances(account.address)

    // Auto-refresh every 60s
    clearInterval(refreshTimerRef.current)
    refreshTimerRef.current = setInterval(() => fetchBalances(account.address), 60000)
    return () => clearInterval(refreshTimerRef.current)
  }, [selectedAccountId, accounts, fetchBalances])

  // Build display data — only chains with non-zero balances
  const chainsWithBalances: ChainWithBalances[] = chainBalances
    .map((cb) => {
      const allTokens: Array<TokenBalance & { usdValue?: number }> = []
      const testnet = isTestnet(cb.chainId)

      // Native balance
      if (parseFloat(cb.nativeBalance.formattedBalance) > 0) {
        const price = testnet ? undefined : prices[cb.nativeBalance.symbol]
        allTokens.push({
          ...cb.nativeBalance,
          usdValue: price ? parseFloat(cb.nativeBalance.formattedBalance) * price : undefined,
        })
      }

      // ERC20 tokens
      for (const t of cb.tokens) {
        if (parseFloat(t.formattedBalance) > 0) {
          const price = testnet ? undefined : prices[t.symbol]
          allTokens.push({
            ...t,
            usdValue: price ? parseFloat(t.formattedBalance) * price : undefined,
          })
        }
      }

      return { chain: cb, nonZeroTokens: allTokens }
    })
    .filter((c) => c.nonZeroTokens.length > 0)

  // Binance display data
  const binanceWithPrices = binanceBalances.map((b) => {
    const price = prices[b.asset]
    const total = parseFloat(b.total)
    return {
      ...b,
      usdValue: price ? total * price : undefined,
    }
  })

  const binanceUsd = binanceWithPrices.reduce((sum, b) => sum + (b.usdValue || 0), 0)

  // Total USD (mainnets on-chain + Binance)
  const onChainUsd = chainsWithBalances
    .filter((c) => !isTestnet(c.chain.chainId))
    .reduce(
      (sum, c) => sum + c.nonZeroTokens.reduce((s, t) => s + (t.usdValue || 0), 0),
      0
    )
  const totalUsd = onChainUsd + binanceUsd

  const handleRefresh = () => {
    const account = accounts.find((a) => a.id === selectedAccountId)
    if (account) fetchBalances(account.address)
  }

  // --- Render ---

  if (isLoadingAccounts) {
    return <SkeletonTable rows={3} cols={3} />
  }

  return (
    <div className="rounded border border-border bg-surface p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-text-secondary">Wallet Balances</h3>
          {totalUsd > 0 && (
            <span className="text-xs font-mono tabular-nums text-text-primary">{formatUsd(totalUsd)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <select
              value={selectedAccountId}
              onChange={(e) => {
                setSelectedAccountId(e.target.value)
                setActiveTab('all')
              }}
              className="text-2xs bg-background border border-border rounded px-1.5 py-0.5 text-text-primary focus:outline-none focus:border-accent"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.address.slice(0, 6) + '...' + a.address.slice(-4)}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleRefresh}
            disabled={isLoadingBalances}
            className="text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
            title="Refresh balances"
          >
            <svg
              className={`w-3.5 h-3.5 ${isLoadingBalances ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* States */}
      {accounts.length === 0 ? (
        <div className="text-xs text-text-tertiary">No accounts found — unlock the app and add a wallet</div>
      ) : isLoadingBalances ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : chainsWithBalances.length === 0 && binanceBalances.length === 0 && !hasBinance ? (
        <div className="text-xs text-text-tertiary">No non-zero balances found</div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-1">
            <TabsTrigger value="all">All</TabsTrigger>
            {chainsWithBalances.map((c) => (
              <TabsTrigger key={c.chain.chain} value={c.chain.chain}>
                {c.chain.chain}
              </TabsTrigger>
            ))}
            {hasBinance && (
              <TabsTrigger value="binance">Binance</TabsTrigger>
            )}
          </TabsList>

          {/* All tab — on-chain first, CEX at bottom */}
          <TabsContent value="all">
            <div className="space-y-3">
              {chainsWithBalances.map((c) => (
                <ChainSection key={c.chain.chain} data={c} />
              ))}
              {hasBinance && (
                binanceBalances.length > 0
                  ? <BinanceSection balances={binanceWithPrices} />
                  : <BinanceErrorSection error={binanceError} />
              )}
            </div>
          </TabsContent>

          {/* Per-chain tabs */}
          {chainsWithBalances.map((c) => (
            <TabsContent key={c.chain.chain} value={c.chain.chain}>
              <ChainSection data={c} />
            </TabsContent>
          ))}

          {/* Binance tab */}
          {hasBinance && (
            <TabsContent value="binance">
              {binanceBalances.length > 0
                ? <BinanceSection balances={binanceWithPrices} />
                : <BinanceErrorSection error={binanceError} />
              }
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  )
}

const PREVIEW_COUNT = 5

function ChainSection({ data }: { data: ChainWithBalances }) {
  const testnet = isTestnet(data.chain.chainId)
  const [expanded, setExpanded] = useState(false)
  const allTokens = data.nonZeroTokens
  const displayTokens = expanded ? allTokens : allTokens.slice(0, PREVIEW_COUNT)
  const remaining = allTokens.length - PREVIEW_COUNT

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <NetworkBadge chainId={data.chain.chainId} />
        {testnet && (
          <Badge className="bg-yellow-500/10 text-yellow-400 text-2xs">Testnet</Badge>
        )}
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border text-2xs text-text-tertiary">
            <th className="pb-1 font-medium">Token</th>
            <th className="pb-1 font-medium text-right">Balance</th>
            <th className="pb-1 font-medium text-right">USD Value</th>
          </tr>
        </thead>
        <tbody>
          {displayTokens.map((t) => (
            <tr key={t.symbol} className="border-b border-border last:border-b-0 hover:bg-background">
              <td className="py-1 text-2xs text-text-primary font-medium">{t.symbol}</td>
              <td className="py-1 text-2xs font-mono tabular-nums text-right text-text-secondary">
                {formatBalance(t.formattedBalance)}
              </td>
              <td className="py-1 text-2xs font-mono tabular-nums text-right text-text-secondary">
                {testnet ? (
                  <span className="text-text-tertiary">--</span>
                ) : t.usdValue !== undefined ? (
                  formatUsd(t.usdValue)
                ) : (
                  <span className="text-text-tertiary">--</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!expanded && remaining > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-1 text-2xs text-accent hover:text-accent/80 transition-colors"
        >
          Show {remaining} more
        </button>
      )}
      {expanded && allTokens.length > PREVIEW_COUNT && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-1 text-2xs text-accent hover:text-accent/80 transition-colors"
        >
          Show less
        </button>
      )}
    </div>
  )
}

function BinanceErrorSection({ error }: { error: string | null }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Badge className="bg-yellow-500/10 text-yellow-400">Binance</Badge>
        <span className="text-2xs text-text-tertiary">CEX</span>
      </div>
      <div className="text-2xs text-negative py-1">
        {error || 'No balances found'}
      </div>
    </div>
  )
}

function BinanceSection({ balances }: { balances: Array<CexBalance & { usdValue?: number }> }) {
  const [expanded, setExpanded] = useState(false)
  const displayBalances = expanded ? balances : balances.slice(0, PREVIEW_COUNT)
  const remaining = balances.length - PREVIEW_COUNT

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <Badge className="bg-yellow-500/10 text-yellow-400">Binance</Badge>
        <span className="text-2xs text-text-tertiary">CEX</span>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border text-2xs text-text-tertiary">
            <th className="pb-1 font-medium">Asset</th>
            <th className="pb-1 font-medium text-right">Free</th>
            <th className="pb-1 font-medium text-right">Locked</th>
            <th className="pb-1 font-medium text-right">Total</th>
            <th className="pb-1 font-medium text-right">USD Value</th>
          </tr>
        </thead>
        <tbody>
          {displayBalances.map((b) => (
            <tr key={b.asset} className="border-b border-border last:border-b-0 hover:bg-background">
              <td className="py-1 text-2xs text-text-primary font-medium">{b.asset}</td>
              <td className="py-1 text-2xs font-mono tabular-nums text-right text-text-secondary">
                {formatBalance(b.free)}
              </td>
              <td className="py-1 text-2xs font-mono tabular-nums text-right text-text-secondary">
                {parseFloat(b.locked) > 0 ? formatBalance(b.locked) : <span className="text-text-tertiary">--</span>}
              </td>
              <td className="py-1 text-2xs font-mono tabular-nums text-right text-text-secondary">
                {formatBalance(b.total)}
              </td>
              <td className="py-1 text-2xs font-mono tabular-nums text-right text-text-secondary">
                {b.usdValue !== undefined ? formatUsd(b.usdValue) : <span className="text-text-tertiary">--</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!expanded && remaining > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-1 text-2xs text-accent hover:text-accent/80 transition-colors"
        >
          Show {remaining} more
        </button>
      )}
      {expanded && balances.length > PREVIEW_COUNT && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-1 text-2xs text-accent hover:text-accent/80 transition-colors"
        >
          Show less
        </button>
      )}
    </div>
  )
}
