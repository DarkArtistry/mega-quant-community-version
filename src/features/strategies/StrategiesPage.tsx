import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Plus, Play, Square, Code2 } from 'lucide-react'
import { strategiesApi } from '@/api/strategies'
import { strategyRunnerApi } from '@/api/strategy-runner'
import { StrategyDetailPage } from './StrategyDetailPage'
import * as Dialog from '@radix-ui/react-dialog'
import type { Strategy } from '@/types'

const statusColors = {
  idle: 'default' as const,
  running: 'positive' as const,
  paused: 'warning' as const,
  stopped: 'default' as const,
  error: 'negative' as const,
}

export function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await strategiesApi.list()
      setStrategies(res.data.strategies || [])
    } catch (err) {
      console.error('[Strategies] Error fetching:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStrategies()
  }, [fetchStrategies])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await strategiesApi.create({ name: newName.trim(), code: '' })
      setNewName('')
      setDialogOpen(false)
      await fetchStrategies()
    } catch (err) {
      console.error('[Strategies] Error creating:', err)
    } finally {
      setCreating(false)
    }
  }

  const handleRunStop = async (e: React.MouseEvent, strategy: Strategy) => {
    e.stopPropagation()
    try {
      if (strategy.status === 'running') {
        await strategyRunnerApi.stop(strategy.id)
        setStrategies((prev) =>
          prev.map((s) => (s.id === strategy.id ? { ...s, status: 'stopped' } : s))
        )
      } else {
        await strategyRunnerApi.start(strategy.id)
        setStrategies((prev) =>
          prev.map((s) => (s.id === strategy.id ? { ...s, status: 'running' } : s))
        )
      }
    } catch (err) {
      console.error('[Strategies] Run/Stop error:', err)
    }
  }

  // If a strategy is selected, show the detail page
  if (selectedStrategyId) {
    return (
      <StrategyDetailPage
        strategyId={selectedStrategyId}
        onBack={() => {
          setSelectedStrategyId(null)
          fetchStrategies()
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Strategies</h2>
        <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Trigger asChild>
            <Button size="sm">
              <Plus className="w-3.5 h-3.5" />
              New Strategy
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-lg p-6 w-[400px] z-50 shadow-xl">
              <Dialog.Title className="text-sm font-semibold mb-4">
                Create New Strategy
              </Dialog.Title>
              <input
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder="Strategy name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-4">
                <Dialog.Close asChild>
                  <Button variant="ghost" size="sm">Cancel</Button>
                </Dialog.Close>
                <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || creating}>
                  {creating ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded border border-border bg-surface"
            >
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-7 w-7" />
            </div>
          ))}
        </div>
      ) : strategies.length === 0 ? (
        <EmptyState
          icon={Code2}
          title="No strategies yet"
          description="Create your first strategy to start trading"
          action={{ label: 'Create Strategy', onClick: () => setDialogOpen(true) }}
        />
      ) : (
        <div className="grid gap-2">
          {strategies.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedStrategyId(s.id)}
              className="flex items-center gap-3 p-3 rounded border border-border bg-surface hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{s.name}</span>
                  <Badge variant={statusColors[(s.status as keyof typeof statusColors) || 'stopped']}>
                    {s.status}
                  </Badge>
                </div>
                <p className="text-2xs text-text-tertiary mt-0.5 truncate">
                  {s.description || 'No description'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {s.status === 'running' ? (
                  <Button variant="ghost" size="icon" onClick={(e) => handleRunStop(e, s)}>
                    <Square className="w-3.5 h-3.5" />
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" onClick={(e) => handleRunStop(e, s)}>
                    <Play className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
