import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const badgeVariants = cva(
  'inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium tabular-nums',
  {
    variants: {
      variant: {
        default: 'bg-surface-hover text-text-secondary',
        positive: 'bg-positive-bg text-positive',
        negative: 'bg-negative-bg text-negative',
        warning: 'bg-warning-bg text-warning',
        accent: 'bg-accent/10 text-accent',
        outline: 'border border-border text-text-secondary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
