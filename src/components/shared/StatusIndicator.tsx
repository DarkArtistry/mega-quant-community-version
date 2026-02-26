import { cn } from '@/components/ui/utils'

type Status = 'online' | 'offline' | 'warning' | 'idle'

const statusColors: Record<Status, string> = {
  online: 'bg-positive',
  offline: 'bg-negative',
  warning: 'bg-warning',
  idle: 'bg-text-tertiary',
}

interface StatusIndicatorProps {
  status: Status
  label?: string
  className?: string
  pulse?: boolean
}

export function StatusIndicator({ status, label, className, pulse = false }: StatusIndicatorProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className={cn(
          'inline-block w-1.5 h-1.5 rounded-full',
          statusColors[status],
          pulse && status === 'online' && 'animate-pulse'
        )}
      />
      {label && <span className="text-2xs text-text-secondary">{label}</span>}
    </span>
  )
}
