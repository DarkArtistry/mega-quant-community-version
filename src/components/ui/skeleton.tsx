import { cn } from './utils'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded bg-surface-hover', className)} />
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded border border-border bg-surface p-3', className)}>
      <Skeleton className="h-3 w-20 mb-2" />
      <Skeleton className="h-6 w-28" />
    </div>
  )
}

export function SkeletonTable({
  rows = 3,
  cols = 4,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div className={cn('rounded border border-border bg-surface', className)}>
      {/* Header */}
      <div className="flex gap-4 p-2.5 border-b border-border">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4 p-2.5 border-b border-border last:border-b-0">
          {Array.from({ length: cols }).map((_, col) => (
            <Skeleton key={col} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}
