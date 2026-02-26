import { useState, useCallback, useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LogConsole, type LogEntry } from '@/components/shared/LogConsole'
import { AccountAssignmentPanel } from '@/features/settings/AccountAssignmentPanel'
import { Play, Square, Pause, Save, ChevronUp } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { strategyRunnerApi } from '@/api/strategy-runner'

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
  const { theme } = useAppStore()
  const [code, setCode] = useState(initialCode)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [dirty, setDirty] = useState(false)
  const lastLogTimestamp = useRef<string | undefined>(undefined)
  const prevStatusRef = useRef(status)
  const [hasMoreLogs, setHasMoreLogs] = useState(false)
  const [oldestLogId, setOldestLogId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

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
          setLogs((prev) => [...prev, ...newLogs])
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
        <div className="flex-1 min-h-[100px]">
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
        <div style={{ height: bottomHeight }} className="shrink-0 flex flex-col">
          <Tabs defaultValue="console" className="h-full flex flex-col">
            <TabsList className="rounded-none border-b border-border bg-surface px-2 shrink-0">
              <TabsTrigger value="console">Console</TabsTrigger>
              <TabsTrigger value="trades">Trades</TabsTrigger>
              <TabsTrigger value="pnl">PnL</TabsTrigger>
              <TabsTrigger value="accounts">Accounts</TabsTrigger>
            </TabsList>

            <TabsContent value="console" className="flex-1 m-0 overflow-hidden">
              <div className="h-full flex flex-col">
                {hasMoreLogs && (
                  <button
                    onClick={loadMoreLogs}
                    disabled={loadingMore}
                    className="flex items-center justify-center gap-1 py-1 text-2xs text-text-tertiary hover:text-text-secondary bg-surface border-b border-border shrink-0"
                  >
                    <ChevronUp className="w-3 h-3" />
                    {loadingMore ? 'Loading...' : 'Load older logs'}
                  </button>
                )}
                <div className="flex-1 min-h-0">
                  <LogConsole logs={logs} maxHeight="100%" className="h-full rounded-none border-0" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="trades" className="flex-1 m-0 p-2">
              <div className="text-xs text-text-tertiary">No trades recorded</div>
            </TabsContent>

            <TabsContent value="pnl" className="flex-1 m-0 p-2">
              <div className="text-xs text-text-tertiary">Run strategy to see PnL</div>
            </TabsContent>

            <TabsContent value="accounts" className="flex-1 m-0 overflow-auto">
              {strategyId ? (
                <AccountAssignmentPanel strategyId={strategyId} />
              ) : (
                <div className="p-3 text-xs text-text-tertiary">
                  Save the strategy first to configure account assignments.
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
