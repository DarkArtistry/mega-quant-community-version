import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-accent text-white hover:bg-accent-hover',
        destructive: 'bg-negative text-white hover:bg-negative/90',
        outline: 'border border-border bg-transparent hover:bg-surface-hover text-foreground',
        secondary: 'bg-surface-hover text-foreground hover:bg-surface-active',
        ghost: 'hover:bg-surface-hover text-foreground',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 py-1',
        sm: 'h-7 rounded px-2 text-xs',
        lg: 'h-9 rounded-md px-4',
        icon: 'h-7 w-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
