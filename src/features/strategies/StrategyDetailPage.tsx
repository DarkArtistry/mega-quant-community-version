import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { StrategyEditor } from './StrategyEditor'
import { strategiesApi } from '@/api/strategies'
import { strategyRunnerApi } from '@/api/strategy-runner'
import { useStrategyStore } from '@/stores/useStrategyStore'
import type { Strategy } from '@/types'

interface StrategyDetailPageProps {
  strategyId: string
  onBack: () => void
}

export function StrategyDetailPage({ strategyId, onBack }: StrategyDetailPageProps) {
  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [loading, setLoading] = useState(true)
  const [runError, setRunError] = useState<string | null>(null)
  const editorCodeRef = useRef<string>('')
  const workerStates = useStrategyStore((s) => s.workerStates)
  const workerState = workerStates.get(strategyId)

  const fetchStrategy = useCallback(async () => {
    try {
      const res = await strategiesApi.get(strategyId)
      setStrategy(res.data.strategy)
      editorCodeRef.current = res.data.strategy.code || ''
    } catch (err) {
      console.error('[StrategyDetail] Error fetching:', err)
    } finally {
      setLoading(false)
    }
  }, [strategyId])

  useEffect(() => {
    fetchStrategy()
  }, [fetchStrategy])

  const currentStatus = workerState?.status ?? strategy?.status ?? 'idle'

  const handleSave = async (code: string) => {
    try {
      await strategiesApi.update(strategyId, { code })
      setStrategy((prev) => (prev ? { ...prev, code } : prev))
      editorCodeRef.current = code
    } catch (err) {
      console.error('[StrategyDetail] Save error:', err)
    }
  }

  const handleCodeChange = (code: string) => {
    editorCodeRef.current = code
  }

  const handleRun = async () => {
    setRunError(null)
    try {
      // Always save the current editor code before running
      const currentCode = editorCodeRef.current
      if (currentCode) {
        await strategiesApi.update(strategyId, { code: currentCode })
        setStrategy((prev) => (prev ? { ...prev, code: currentCode } : prev))
      }
      const res = await strategyRunnerApi.start(strategyId)
      if (res.data.success) {
        setStrategy((prev) => (prev ? { ...prev, status: 'running' } : prev))
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Run failed'
      console.error('[StrategyDetail] Run error:', errorMsg)
      setRunError(errorMsg)
    }
  }

  const handleStop = async () => {
    try {
      const res = await strategyRunnerApi.stop(strategyId)
      // Use the actual state from the backend response
      const backendState = (res.data?.status?.state || 'stopped') as Strategy['status']
      setStrategy((prev) => (prev ? { ...prev, status: backendState } : prev))
    } catch (err: any) {
      console.error('[StrategyDetail] Stop error:', err)
      // Force status update even if the API call fails — the strategy is likely already errored/stopped
      setStrategy((prev) => (prev ? { ...prev, status: 'stopped' } : prev))
    }
  }

  const handlePause = async () => {
    try {
      if (currentStatus === 'paused') {
        await strategyRunnerApi.resume(strategyId)
        setStrategy((prev) => (prev ? { ...prev, status: 'running' } : prev))
      } else {
        await strategyRunnerApi.pause(strategyId)
        setStrategy((prev) => (prev ? { ...prev, status: 'paused' } : prev))
      }
    } catch (err) {
      console.error('[StrategyDetail] Pause/Resume error:', err)
    }
  }

  const handleStatusChange = (newStatus: string) => {
    setStrategy((prev) => (prev ? { ...prev, status: newStatus as Strategy['status'] } : prev))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-tertiary text-sm">
        Loading strategy...
      </div>
    )
  }

  if (!strategy) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Button>
        <div className="text-text-tertiary text-sm">Strategy not found</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <StrategyEditor
          strategyId={strategyId}
          initialCode={strategy.code || undefined}
          strategyName={strategy.name}
          status={currentStatus}
          runError={runError}
          onSave={handleSave}
          onRun={handleRun}
          onStop={handleStop}
          onPause={handlePause}
          onCodeChange={handleCodeChange}
          onStatusChange={handleStatusChange}
        />
      </div>
    </div>
  )
}
