import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-[300px] rounded border border-border bg-surface">
      <Icon className="w-10 h-10 text-text-tertiary mb-3" />
      <p className="text-sm text-text-secondary mb-1">{title}</p>
      <p className="text-xs text-text-tertiary mb-4 max-w-sm text-center">{description}</p>
      {action && (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
