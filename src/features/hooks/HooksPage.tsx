import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Anchor, ExternalLink, Copy, Check } from 'lucide-react'

// This can be updated after deployment (Phase A4)
const DEPLOYED_HOOK_ADDRESS = import.meta.env.VITE_HOOK_ADDRESS || ''
const DEPLOYED_ROUTER_ADDRESS = import.meta.env.VITE_ROUTER_ADDRESS || ''
const HOOK_CHAIN = 'Unichain Sepolia'
const EXPLORER_BASE = 'https://sepolia.uniscan.xyz/address/'

export function HooksPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [showDeployDialog, setShowDeployDialog] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300)
    return () => clearTimeout(timer)
  }, [])

  const isDeployed = !!DEPLOYED_HOOK_ADDRESS

  function handleCopy(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Uniswap V4 Hooks</h2>
        <Button size="sm" onClick={() => setShowDeployDialog(!showDeployDialog)}>
          {isDeployed ? 'View Details' : 'Deploy Instructions'}
        </Button>
      </div>

      {/* Hook Info */}
      {isLoading ? (
        <div className="rounded border border-border bg-surface p-4">
          <div className="flex items-center gap-3 mb-3">
            <Skeleton className="w-5 h-5 rounded" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      ) : (
        <div className="rounded border border-border bg-surface p-4">
          <div className="flex items-center gap-3 mb-3">
            <Anchor className="w-5 h-5 text-accent" />
            <div>
              <h3 className="text-sm font-medium">MegaQuantHook</h3>
              <p className="text-2xs text-text-tertiary">
                Combined Volatility Fee + Limit Order Hook
              </p>
            </div>
            <Badge
              variant={isDeployed ? 'positive' : 'warning'}
              className="ml-auto"
            >
              {isDeployed ? 'Deployed' : 'Not Deployed'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-text-tertiary">Features: </span>
              <span>Dynamic Volatility Fees, On-chain Limit Orders</span>
            </div>
            <div>
              <span className="text-text-tertiary">Target Chain: </span>
              <span>{HOOK_CHAIN}</span>
            </div>
          </div>

          {isDeployed && (
            <div className="mt-3 space-y-2">
              <AddressRow
                label="Hook"
                address={DEPLOYED_HOOK_ADDRESS}
                onCopy={handleCopy}
                copied={copied}
              />
              {DEPLOYED_ROUTER_ADDRESS && (
                <AddressRow
                  label="Router"
                  address={DEPLOYED_ROUTER_ADDRESS}
                  onCopy={handleCopy}
                  copied={copied}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Deploy Instructions Dialog */}
      {showDeployDialog && !isDeployed && (
        <div className="rounded border border-border bg-surface p-4 space-y-3">
          <h3 className="text-xs font-medium text-text-secondary">Deployment Instructions</h3>
          <div className="text-2xs text-text-secondary space-y-2">
            <p>1. Set up your deployer account with testnet ETH on {HOOK_CHAIN}</p>
            <p>2. Create <code className="bg-background px-1 py-0.5 rounded font-mono">contracts/.env</code> with your private key</p>
            <p>3. Run the deployment script:</p>
            <pre className="bg-background p-2 rounded text-2xs font-mono overflow-x-auto">
{`cd contracts
forge script script/DeployHook.s.sol \\
  --rpc-url https://sepolia.unichain.org \\
  --broadcast`}
            </pre>
            <p>4. After deployment, set <code className="bg-background px-1 py-0.5 rounded font-mono">VITE_HOOK_ADDRESS</code> in your .env</p>
          </div>
        </div>
      )}

      {/* Volatility State */}
      {isLoading ? (
        <div className="rounded border border-border bg-surface p-3">
          <Skeleton className="h-3 w-24 mb-3" />
          <Skeleton className="h-3 w-48" />
        </div>
      ) : (
        <div className="rounded border border-border bg-surface p-3">
          <h3 className="text-xs font-medium text-text-secondary mb-2">Volatility State</h3>
          <div className="text-xs text-text-tertiary">
            {isDeployed ? 'Connect to view live volatility data' : 'Deploy hook to view volatility data'}
          </div>
        </div>
      )}

      {/* On-chain Orders */}
      {isLoading ? (
        <div className="rounded border border-border bg-surface p-3">
          <Skeleton className="h-3 w-32 mb-3" />
          <Skeleton className="h-3 w-40" />
        </div>
      ) : (
        <div className="rounded border border-border bg-surface p-3">
          <h3 className="text-xs font-medium text-text-secondary mb-2">On-chain Limit Orders</h3>
          <div className="text-xs text-text-tertiary">No active on-chain orders</div>
        </div>
      )}
    </div>
  )
}

function AddressRow({
  label,
  address,
  onCopy,
  copied,
}: {
  label: string
  address: string
  onCopy: (text: string, label: string) => void
  copied: string | null
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-text-tertiary w-12">{label}:</span>
      <code className="font-mono text-text-secondary">{address}</code>
      <button
        className="text-text-tertiary hover:text-text-secondary"
        onClick={() => onCopy(address, label)}
      >
        {copied === label ? <Check className="w-3 h-3 text-positive" /> : <Copy className="w-3 h-3" />}
      </button>
      <a
        href={`${EXPLORER_BASE}${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-text-tertiary hover:text-accent"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  )
}
