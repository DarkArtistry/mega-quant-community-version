import { Badge } from '@/components/ui/badge'

const networkNames: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  130: 'Unichain',
  1301: 'Unichain Sepolia',
}

const networkColors: Record<number, string> = {
  1: 'bg-blue-500/10 text-blue-400',
  8453: 'bg-blue-400/10 text-blue-300',
  11155111: 'bg-gray-500/10 text-gray-400',
  84532: 'bg-gray-400/10 text-gray-300',
  130: 'bg-pink-500/10 text-pink-400',
  1301: 'bg-pink-500/10 text-pink-400',
}

interface NetworkBadgeProps {
  chainId: number
  className?: string
}

export function NetworkBadge({ chainId, className }: NetworkBadgeProps) {
  return (
    <Badge
      className={`${networkColors[chainId] || 'bg-surface-hover text-text-secondary'} ${className || ''}`}
    >
      {networkNames[chainId] || `Chain ${chainId}`}
    </Badge>
  )
}
