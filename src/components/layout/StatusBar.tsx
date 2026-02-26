import { useEffect, useState } from 'react'
import { cn } from '@/components/ui/utils'
import { useAppStore } from '@/stores/useAppStore'
import { useLiveDataStore } from '@/stores/useLiveDataStore'

export function StatusBar() {
  const { backendStatus } = useAppStore()
  const wsConnected = useLiveDataStore((s) => s.isConnected)
  const [utcTime, setUtcTime] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setUtcTime(
        now.toISOString().slice(11, 19)
      )
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <footer className="flex items-center h-statusbar px-3 bg-surface border-t border-border text-2xs text-text-tertiary tabular-nums gap-4">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-block w-1.5 h-1.5 rounded-full',
            backendStatus.connected ? 'bg-positive' : 'bg-negative'
          )}
        />
        <span>Backend: {backendStatus.connected ? 'Connected' : 'Disconnected'}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-block w-1.5 h-1.5 rounded-full',
            wsConnected ? 'bg-positive' : 'bg-text-tertiary'
          )}
        />
        <span>WS: {wsConnected ? 'Live' : 'Off'}</span>
      </div>
      <div className="flex-1" />
      <span>UTC: {utcTime}</span>
    </footer>
  )
}
