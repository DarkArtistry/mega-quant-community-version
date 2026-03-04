import { useRef, useEffect, type ReactNode } from 'react'
import { cn } from '@/components/ui/utils'

export interface LogEntry {
  timestamp: string
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
}

const URL_REGEX = /(https?:\/\/[^\s),]+)/g
const TX_HASH_IN_URL = /\/tx\/(0x[0-9a-fA-F]+)$/

export function linkifyMessage(message: string): ReactNode {
  const parts = message.split(URL_REGEX)
  if (parts.length === 1) return message
  return parts.map((part, i) => {
    if (URL_REGEX.test(part)) {
      // For block explorer tx URLs, show just the truncated hash
      const txMatch = part.match(TX_HASH_IN_URL)
      const label = txMatch ? txMatch[1] : part
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{label}</a>
      )
    }
    return part
  })
}

export const levelColors: Record<LogEntry['level'], string> = {
  log: 'text-text-secondary',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-negative',
}

export const levelLabels: Record<LogEntry['level'], string> = {
  log: 'LOG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
}

export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

/** Single log line — reusable in both LogConsole and inline contexts */
export function LogLine({ log }: { log: LogEntry }) {
  return (
    <div className="flex gap-2 py-px leading-relaxed">
      <span className="text-text-tertiary shrink-0 tabular-nums select-none">
        {formatTimestamp(log.timestamp)}
      </span>
      <span className={cn('shrink-0 font-semibold select-none', levelColors[log.level])}>
        [{levelLabels[log.level]}]
      </span>
      <span className="text-text-secondary break-all whitespace-pre-wrap">{linkifyMessage(log.message)}</span>
    </div>
  )
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
        'bg-background font-mono text-2xs overflow-auto overscroll-contain',
        className
      )}
      style={{ maxHeight }}
    >
      <div className="p-2 space-y-px">
        {logs.length === 0 ? (
          <div className="text-text-tertiary py-2 text-center">No logs yet</div>
        ) : (
          logs.map((log, i) => <LogLine key={i} log={log} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
