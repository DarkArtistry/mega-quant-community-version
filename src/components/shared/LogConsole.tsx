import { useRef, useEffect } from 'react'
import { cn } from '@/components/ui/utils'

export interface LogEntry {
  timestamp: string
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
}

const levelColors: Record<LogEntry['level'], string> = {
  log: 'text-text-secondary',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-negative',
}

const levelLabels: Record<LogEntry['level'], string> = {
  log: 'LOG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

interface LogConsoleProps {
  logs: LogEntry[]
  className?: string
  maxHeight?: string
}

export function LogConsole({ logs, className, maxHeight = '200px' }: LogConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  return (
    <div
      ref={scrollRef}
      className={cn(
        'bg-background font-mono text-2xs overflow-auto',
        className
      )}
      style={{ maxHeight, height: maxHeight === '100%' ? '100%' : undefined }}
    >
      <div className="p-2 space-y-px">
        {logs.length === 0 ? (
          <div className="text-text-tertiary py-2 text-center">No logs yet</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-2 py-px leading-relaxed">
              <span className="text-text-tertiary shrink-0 tabular-nums select-none">
                {formatTimestamp(log.timestamp)}
              </span>
              <span className={cn('shrink-0 font-semibold select-none', levelColors[log.level])}>
                [{levelLabels[log.level]}]
              </span>
              <span className="text-text-secondary break-all whitespace-pre-wrap">{log.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
