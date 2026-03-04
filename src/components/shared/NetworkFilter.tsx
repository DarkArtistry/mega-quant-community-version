import { cn } from '@/components/ui/utils'
import { useAppStore, type NetworkFilterValue } from '@/stores/useAppStore'

const options: Array<{ value: NetworkFilterValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'mainnet', label: 'Mainnet' },
  { value: 'testnet', label: 'Testnet' },
]

export function NetworkFilter({ className }: { className?: string }) {
  const { networkFilter, setNetworkFilter } = useAppStore()

  return (
    <div className={cn('inline-flex rounded border border-border bg-surface text-2xs', className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setNetworkFilter(opt.value)}
          className={cn(
            'px-2 py-0.5 transition-colors cursor-pointer',
            networkFilter === opt.value
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
