import { useState, useCallback, useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LogLine, type LogEntry } from '@/components/shared/LogConsole'
import { NetworkFilter } from '@/components/shared/NetworkFilter'
import { AccountAssignmentPanel } from '@/features/settings/AccountAssignmentPanel'
import { Play, Square, Pause, Save, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { strategyRunnerApi } from '@/api/strategy-runner'
import { ordersApi } from '@/api/orders'
import { pnlApi } from '@/api/pnl'
import type { Order, Position } from '@/types'

const DEFAULT_STRATEGY_CODE = `// MegaQuant Strategy
// The 'dt' object gives you access to all trading operations.
// Use sleep(ms) to wait, checkPause() to respect pause/resume.
// The strategy runs until execute() returns, or until you click Stop.

async function execute(dt) {
  console.log("Strategy started!")

  // Example: run a loop every 5 seconds
  let tick = 0
  while (true) {
    await checkPause()  // Respects pause/resume
    tick++
    console.log("Tick", tick, "at", new Date().toLocaleTimeString())

    // Your trading logic here:
    // if (dt) {
    //   const quote = await dt.ethereum.uniswapV3.getQuote({
    //     tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '0.1'
    //   })
    //   console.log('Quote:', quote.amountOut, 'USDC')
    // }

    await sleep(5000)  // Wait 5 seconds
  }
}
`

interface StrategyEditorProps {
  strategyId?: string
  initialCode?: string
  strategyName?: string
  status?: string
  runError?: string | null
  onSave?: (code: string) => void
  onRun?: () => void
  onStop?: () => void
  onPause?: () => void
  onCodeChange?: (code: string) => void
  onStatusChange?: (status: string) => void
}

export function StrategyEditor({
  strategyId,
  initialCode = DEFAULT_STRATEGY_CODE,
  strategyName = 'New Strategy',
  status = 'idle',
  runError,
  onSave,
  onRun,
  onStop,
  onPause,
  onCodeChange,
  onStatusChange,
}: StrategyEditorProps) {
  const { theme, networkFilter } = useAppStore()
  const [code, setCode] = useState(initialCode)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [dirty, setDirty] = useState(false)
  const lastLogTimestamp = useRef<string | undefined>(undefined)
  const prevStatusRef = useRef(status)
  const [hasMoreLogs, setHasMoreLogs] = useState(false)
  const [oldestLogId, setOldestLogId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const maxDisplayLogs = useRef(1000)

  // Trades & PnL state
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersTotal, setOrdersTotal] = useState(0)
  const [ordersPage, setOrdersPage] = useState(0)
  const TRADES_PAGE_SIZE = 50
  const [positions, setPositions] = useState<Position[]>([])
  const [pnlSummary, setPnlSummary] = useState<{ realized: number; unrealized: number; total: number } | null>(null)

  // Console scroll
  const consoleRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  // Resizable panel state
  const [bottomHeight, setBottomHeight] = useState(200)
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Notify parent of initial code (so auto-save works even without typing)
  useEffect(() => {
    onCodeChange?.(initialCode)
  }, []) // only on mount

  // Load initial historical logs from persistent storage
  useEffect(() => {
    if (!strategyId) return
    const loadInitialLogs = async () => {
      try {
        const res = await strategyRunnerApi.logs(strategyId, { limit: 1000 })
        if (res.data.logs.length > 0) {
          const entries: LogEntry[] = res.data.logs.map((l) => ({
            timestamp: l.timestamp,
            level: l.level as LogEntry['level'],
            message: l.message,
          }))
          setLogs(entries)
          setHasMoreLogs(res.data.hasMore)
          setOldestLogId(res.data.oldestId ? String(res.data.oldestId) : null)
        }
      } catch {
        // No persistent logs yet
      }
    }
    loadInitialLogs()
  }, [strategyId])

  const loadMoreLogs = async () => {
    if (!strategyId || !oldestLogId || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await strategyRunnerApi.logs(strategyId, { limit: 1000, before: oldestLogId })
      if (res.data.logs.length > 0) {
        const entries: LogEntry[] = res.data.logs.map((l) => ({
          timestamp: l.timestamp,
          level: l.level as LogEntry['level'],
          message: l.message,
        }))
        // Increase the cap to accommodate older logs
        maxDisplayLogs.current += 1000
        setLogs((prev) => [...entries, ...prev])
        setHasMoreLogs(res.data.hasMore)
        setOldestLogId(res.data.oldestId ? String(res.data.oldestId) : null)
      } else {
        setHasMoreLogs(false)
      }
    } catch {
      // ignore
    } finally {
      setLoadingMore(false)
    }
  }

  // Show run errors in the console panel
  useEffect(() => {
    if (runError) {
      setLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toISOString(),
          level: 'error' as const,
          message: runError,
        },
      ])
    }
  }, [runError])

  // Log polling when strategy is running/paused/initializing
  useEffect(() => {
    if (!strategyId) return

    const isActive = status === 'running' || status === 'paused' || status === 'init' || status === 'initializing'

    // Clear logs when transitioning to running from a non-active state
    if (
      (status === 'running' || status === 'initializing') &&
      prevStatusRef.current !== 'running' &&
      prevStatusRef.current !== 'paused' &&
      prevStatusRef.current !== 'initializing'
    ) {
      setLogs([])
      lastLogTimestamp.current = undefined
    }
    prevStatusRef.current = status

    if (!isActive) return

    const poll = async () => {
      try {
        const res = await strategyRunnerApi.status(strategyId, { since: lastLogTimestamp.current })
        const entries = res.data.logs || []
        if (entries.length > 0) {
          const newLogs: LogEntry[] = entries.map((entry) => ({
            timestamp: entry.timestamp,
            level: entry.level as LogEntry['level'],
            message: entry.message,
          }))
          setLogs((prev) => {
            const combined = [...prev, ...newLogs]
            if (combined.length > maxDisplayLogs.current) {
              setHasMoreLogs(true)
              return combined.slice(-maxDisplayLogs.current)
            }
            return combined
          })
          lastLogTimestamp.current = entries[entries.length - 1].timestamp
        }
        // Sync actual backend state back to parent
        const backendState = res.data.status?.state
        if (backendState && backendState !== status) {
          onStatusChange?.(backendState)
        }
        if (backendState === 'stopped' || backendState === 'error' || backendState === 'idle') {
          return 'done'
        }
      } catch {
        // Runner might not exist yet, ignore
      }
      return 'continue'
    }

    poll()
    const interval = setInterval(async () => {
      const result = await poll()
      if (result === 'done') {
        clearInterval(interval)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [strategyId, status])

  // Auto-scroll console to bottom (unless user scrolled up)
  useEffect(() => {
    const el = consoleRef.current
    if (el && shouldAutoScroll.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [logs.length])

  const handleConsoleScroll = useCallback(() => {
    const el = consoleRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    shouldAutoScroll.current = atBottom
  }, [])

  // Fetch orders and PnL for this strategy
  useEffect(() => {
    if (!strategyId) return
    const net = networkFilter !== 'all' ? networkFilter : undefined
    const fetchTradesAndPnl = async () => {
      try {
        const [ordersRes, positionsRes, totalRes] = await Promise.allSettled([
          ordersApi.getHistory({ strategy_id: strategyId, limit: TRADES_PAGE_SIZE, offset: ordersPage * TRADES_PAGE_SIZE, network: net }),
          pnlApi.getPositions(strategyId, undefined, 'open', net),
          pnlApi.getTotal(strategyId, undefined, net),
        ])
        if (ordersRes.status === 'fulfilled') {
          setOrders(ordersRes.value.data.orders || [])
          setOrdersTotal((ordersRes.value.data as any).total || 0)
        }
        if (positionsRes.status === 'fulfilled') setPositions(positionsRes.value.data.positions || [])
        if (totalRes.status === 'fulfilled') {
          const s = totalRes.value.data.summary
          setPnlSummary({
            realized: s?.realizedPnl ?? s?.totalRealizedPnl ?? 0,
            unrealized: s?.unrealizedPnl ?? s?.totalUnrealizedPnl ?? 0,
            total: s?.totalPnl ?? 0,
          })
        }
      } catch { /* ignore */ }
    }
    fetchTradesAndPnl()
    const interval = setInterval(fetchTradesAndPnl, 5000)
    return () => clearInterval(interval)
  }, [strategyId, status, ordersPage, networkFilter])

  const totalOrdersPages = Math.ceil(ordersTotal / TRADES_PAGE_SIZE)

  const handleCodeChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setCode(value)
      setDirty(true)
      onCodeChange?.(value)
    }
  }, [onCodeChange])

  const handleSave = () => {
    onSave?.(code)
    setDirty(false)
  }

  const handleRun = () => {
    setLogs([])
    lastLogTimestamp.current = undefined
    onRun?.()
  }

  // Drag handle for resizing
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true

    const startY = e.clientY
    const startHeight = bottomHeight

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const delta = startY - ev.clientY
      const newHeight = Math.max(80, Math.min(600, startHeight + delta))
      setBottomHeight(newHeight)
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [bottomHeight])

  const statusColors: Record<string, 'default' | 'positive' | 'warning' | 'negative'> = {
    idle: 'default',
    running: 'positive',
    paused: 'warning',
    stopped: 'default',
    error: 'negative',
    initializing: 'warning',
  }

  return (
    <div ref={containerRef} className="flex flex-col h-[calc(100vh-theme(spacing.topbar)-theme(spacing.statusbar)-32px)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface shrink-0">
        <span className="text-sm font-medium">{strategyName}</span>
        <Badge variant={statusColors[status] || 'default'}>{status}</Badge>
        {dirty && <Badge variant="warning">Unsaved</Badge>}

        <div className="flex-1" />

        <Button variant="ghost" size="sm" onClick={handleSave} disabled={!dirty}>
          <Save className="w-3.5 h-3.5" />
          Save
        </Button>

        {status === 'running' || status === 'paused' ? (
          <>
            <Button variant="ghost" size="sm" onClick={onPause}>
              <Pause className="w-3.5 h-3.5" />
              {status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="destructive" size="sm" onClick={onStop}>
              <Square className="w-3.5 h-3.5" />
              Stop
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={handleRun}>
            <Play className="w-3.5 h-3.5" />
            Run
          </Button>
        )}
      </div>

      {/* Editor + Bottom Panel */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Monaco Editor */}
        <div className="flex-1 min-h-[100px] overflow-hidden relative z-0">
          <Editor
            height="100%"
            language="javascript"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={code}
            onChange={handleCodeChange}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              lineHeight: 20,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 12, bottom: 12 },
              renderLineHighlight: 'line',
              cursorBlinking: 'smooth',
              tabSize: 2,
              wordWrap: 'on',
              bracketPairColorization: { enabled: true },
              automaticLayout: true,
            }}
          />
        </div>

        {/* Drag Handle */}
        <div
          onMouseDown={handleMouseDown}
          className="h-1 bg-border hover:bg-accent cursor-row-resize shrink-0 transition-colors"
        />

        {/* Bottom Panel */}
        <div style={{ height: bottomHeight }} className="shrink-0 flex flex-col relative z-10">
          <Tabs defaultValue="console" className="h-full flex flex-col">
            <div className="flex items-center border-b border-border bg-surface shrink-0">
              <TabsList className="rounded-none border-b-0 bg-transparent px-2">
                <TabsTrigger value="console">Console</TabsTrigger>
                <TabsTrigger value="trades">Trades</TabsTrigger>
                <TabsTrigger value="pnl">PnL</TabsTrigger>
                <TabsTrigger value="accounts">Accounts</TabsTrigger>
              </TabsList>
              <div className="flex-1" />
              <NetworkFilter className="mr-2" />
            </div>

            {/* Tab content area — relative container so each tab fills via absolute */}
            <div className="flex-1 min-h-0 relative">
              <TabsContent
                value="console"
                className="absolute inset-0 m-0 bg-background font-mono text-2xs"
                style={{ overflowY: 'auto' }}
                ref={consoleRef}
                onScroll={handleConsoleScroll}
              >
                {hasMoreLogs && (
                  <div className="sticky top-0 z-10">
                    <button
                      onClick={loadMoreLogs}
                      disabled={loadingMore}
                      className="flex items-center justify-center gap-1 py-1 w-full text-2xs text-text-tertiary hover:text-text-secondary bg-surface border-b border-border"
                    >
                      <ChevronUp className="w-3 h-3" />
                      {loadingMore ? 'Loading...' : 'Load older logs'}
                    </button>
                  </div>
                )}
                <div className="p-2 space-y-px">
                  {logs.length === 0 ? (
                    <div className="text-text-tertiary py-2 text-center">No logs yet</div>
                  ) : (
                    logs.map((log, i) => <LogLine key={i} log={log} />)
                  )}
                </div>
              </TabsContent>

              <TabsContent value="trades" className="absolute inset-0 m-0 overflow-hidden">
                <div className="h-full flex flex-col">
                {orders.length === 0 ? (
                  <div className="p-2 text-xs text-text-tertiary">No trades recorded</div>
                ) : (
                  <>
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-2xs">
                        <thead>
                          <tr className="border-b border-border text-text-tertiary sticky top-0 bg-surface">
                            <th className="text-left px-2 py-1 font-medium">Time</th>
                            <th className="text-left px-2 py-1 font-medium">Side</th>
                            <th className="text-left px-2 py-1 font-medium">Asset</th>
                            <th className="text-right px-2 py-1 font-medium">Qty</th>
                            <th className="text-right px-2 py-1 font-medium">Price</th>
                            <th className="text-left px-2 py-1 font-medium">Protocol</th>
                            <th className="text-left px-2 py-1 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map((o) => (
                            <tr key={o.id} className="border-b border-border last:border-b-0 hover:bg-background">
                              <td className="px-2 py-1 text-text-secondary">{formatCompactTime(o.filled_at || o.updated_at)}</td>
                              <td className="px-2 py-1">
                                <span className={o.side === 'buy' ? 'text-positive' : 'text-negative'}>{o.side}</span>
                              </td>
                              <td className="px-2 py-1 font-medium">{formatOrderPair(o)}</td>
                              <td className="px-2 py-1 text-right font-mono">{formatCompactQty(o.filled_quantity || o.quantity)}</td>
                              <td className="px-2 py-1 text-right font-mono">{formatCompactPrice(o.filled_price || o.price)}</td>
                              <td className="px-2 py-1 text-text-secondary">{o.protocol}</td>
                              <td className="px-2 py-1">
                                <Badge variant={o.status === 'filled' ? 'positive' : o.status === 'pending' ? 'warning' : 'default'}>
                                  {o.status}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {totalOrdersPages > 1 && (
                      <div className="flex items-center justify-between px-2 py-1 border-t border-border bg-surface shrink-0">
                        <span className="text-2xs text-text-tertiary">
                          Page {ordersPage + 1} of {totalOrdersPages} ({ordersTotal} trades)
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1 text-2xs"
                            disabled={ordersPage === 0}
                            onClick={() => setOrdersPage((p) => p - 1)}
                          >
                            <ChevronLeft className="w-3 h-3" />
                            Prev
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1 text-2xs"
                            disabled={ordersPage >= totalOrdersPages - 1}
                            onClick={() => setOrdersPage((p) => p + 1)}
                          >
                            Next
                            <ChevronRight className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                </div>
              </TabsContent>

              <TabsContent value="pnl" className="absolute inset-0 m-0 overflow-auto">
                {!pnlSummary && positions.length === 0 ? (
                  <div className="p-2 text-xs text-text-tertiary">Run strategy to see PnL</div>
                ) : (
                  <div className="p-2 space-y-2">
                    {/* PnL Summary */}
                    {pnlSummary && (
                      <div className="flex gap-4 text-2xs">
                        <div>
                          <span className="text-text-tertiary">Realized: </span>
                          <span className={pnlSummary.realized > 0 ? 'text-positive' : pnlSummary.realized < 0 ? 'text-negative' : ''}>
                            {formatPnlUsd(pnlSummary.realized)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">Unrealized: </span>
                          <span className={pnlSummary.unrealized > 0 ? 'text-positive' : pnlSummary.unrealized < 0 ? 'text-negative' : ''}>
                            {formatPnlUsd(pnlSummary.unrealized)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">Total: </span>
                          <span className={`font-semibold ${pnlSummary.total > 0 ? 'text-positive' : pnlSummary.total < 0 ? 'text-negative' : ''}`}>
                            {formatPnlUsd(pnlSummary.total)}
                          </span>
                        </div>
                      </div>
                    )}
                    {/* Positions */}
                    {positions.length > 0 && (
                      <table className="w-full text-2xs">
                        <thead>
                          <tr className="border-b border-border text-text-tertiary">
                            <th className="text-left px-2 py-1 font-medium">Asset</th>
                            <th className="text-left px-2 py-1 font-medium">Side</th>
                            <th className="text-right px-2 py-1 font-medium">Qty</th>
                            <th className="text-right px-2 py-1 font-medium">Entry</th>
                            <th className="text-right px-2 py-1 font-medium">Current</th>
                            <th className="text-right px-2 py-1 font-medium">Realized</th>
                            <th className="text-right px-2 py-1 font-medium">Unrealized</th>
                            <th className="text-left px-2 py-1 font-medium">Protocol</th>
                          </tr>
                        </thead>
                        <tbody>
                          {positions.map((p) => {
                            const unrealized = parseFloat(p.unrealized_pnl || '0')
                            const realized = parseFloat(p.realized_pnl || '0')
                            return (
                              <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-background">
                                <td className="px-2 py-1 font-medium">{p.asset_symbol}</td>
                                <td className="px-2 py-1">
                                  <span className={p.side === 'long' ? 'text-positive' : 'text-negative'}>{p.side}</span>
                                </td>
                                <td className="px-2 py-1 text-right font-mono">{formatCompactQty(p.quantity)}</td>
                                <td className="px-2 py-1 text-right font-mono">{formatCompactPrice(p.avg_entry_price)}</td>
                                <td className="px-2 py-1 text-right font-mono">{p.current_price ? formatCompactPrice(p.current_price) : '—'}</td>
                                <td className="px-2 py-1 text-right font-mono">
                                  <span className={realized > 0 ? 'text-positive' : realized < 0 ? 'text-negative' : 'text-text-tertiary'}>
                                    {formatPnlUsd(realized)}
                                  </span>
                                </td>
                                <td className="px-2 py-1 text-right font-mono">
                                  <span className={unrealized > 0 ? 'text-positive' : unrealized < 0 ? 'text-negative' : 'text-text-tertiary'}>
                                    {formatPnlUsd(unrealized)}
                                  </span>
                                </td>
                                <td className="px-2 py-1 text-text-secondary">{p.protocol || '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="accounts" className="absolute inset-0 m-0 overflow-auto">
                {strategyId ? (
                  <AccountAssignmentPanel strategyId={strategyId} />
                ) : (
                  <div className="p-3 text-xs text-text-tertiary">
                    Save the strategy first to configure account assignments.
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Helper functions for Trades & PnL tabs                            */
/* ------------------------------------------------------------------ */

function formatCompactTime(ts: string | undefined): string {
  if (!ts) return '—'
  try {
    const d = new Date(ts.endsWith('Z') ? ts : ts + 'Z')
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ts
  }
}

function formatCompactQty(value: string | undefined): string {
  if (!value) return '—'
  const num = parseFloat(value)
  if (isNaN(num)) return value
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  if (num < 1) return num.toFixed(6)
  if (num < 1000) return num.toFixed(4)
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatCompactPrice(value: string | undefined): string {
  if (!value) return '—'
  const num = parseFloat(value)
  if (isNaN(num)) return value
  if (num === 0) return '0'
  if (num < 0.01) return num.toExponential(2)
  if (num < 1) return num.toFixed(6)
  if (num < 100) return num.toFixed(4)
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatOrderPair(order: Order): string {
  if (order.token_in_symbol && order.token_out_symbol) {
    const counterpart =
      order.asset_symbol === order.token_in_symbol
        ? order.token_out_symbol
        : order.asset_symbol === order.token_out_symbol
          ? order.token_in_symbol
          : order.token_out_symbol
    return `${order.asset_symbol} / ${counterpart}`
  }
  return order.asset_symbol
}

function formatPnlUsd(value: number): string {
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value < 0 ? `-$${formatted}` : `$${formatted}`
}
