import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { NetworkBadge } from '@/components/shared/NetworkBadge'
import { AccountPicker } from '@/components/shared/AccountPicker'
import { accountsApi } from '@/api/accounts'
import { configApi } from '@/api/config'
import { useAppStore } from '@/stores/useAppStore'
import type { Account, StrategyAccountMapping } from '@/types'
import { Loader2, X } from 'lucide-react'

const NETWORKS = [
  { id: 1, chainId: 1, name: 'Ethereum' },
  { id: 8453, chainId: 8453, name: 'Base' },
  { id: 11155111, chainId: 11155111, name: 'Sepolia' },
  { id: 84532, chainId: 84532, name: 'Base Sepolia' },
]

const CEX_EXCHANGES = [
  { name: 'Binance', label: 'Binance' },
]

interface AccountAssignmentPanelProps {
  strategyId: string
}

export function AccountAssignmentPanel({ strategyId }: AccountAssignmentPanelProps) {
  const { sessionPassword } = useAppStore()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [mappings, setMappings] = useState<StrategyAccountMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [savingNetwork, setSavingNetwork] = useState<number | null>(null)
  const [savingCex, setSavingCex] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [accountsRes, mappingsRes] = await Promise.all([
        sessionPassword
          ? configApi.getAccounts(sessionPassword)
          : accountsApi.getAccounts(),
        accountsApi.getStrategyMappings(strategyId),
      ])
      setAccounts(accountsRes.data.accounts || [])
      setMappings(mappingsRes.data.mappings || [])
    } catch (err) {
      console.error('Failed to load account assignment data:', err)
    } finally {
      setLoading(false)
    }
  }, [strategyId, sessionPassword])

  useEffect(() => {
    loadData()
  }, [loadData])

  const getNetworkMapping = (networkId: number) =>
    mappings.find((m) => m.networkId === networkId && !m.exchangeName)

  const getCexMapping = (exchangeName: string) =>
    mappings.find((m) => m.exchangeName === exchangeName)

  const handleNetworkAccountChange = async (networkId: number, accountId: string) => {
    setSavingNetwork(networkId)
    try {
      if (accountId) {
        await accountsApi.setStrategyNetworkAccount(strategyId, networkId, accountId)
      } else {
        await accountsApi.removeStrategyNetworkAccount(strategyId, networkId)
      }
      await loadData()
    } catch (err) {
      console.error('Failed to update network account:', err)
    } finally {
      setSavingNetwork(null)
    }
  }

  const handleCexToggle = async (exchangeName: string) => {
    setSavingCex(exchangeName)
    try {
      const existing = getCexMapping(exchangeName)
      if (existing) {
        await accountsApi.removeStrategyCexAccount(strategyId, exchangeName)
      } else {
        await accountsApi.setStrategyCexAccount(strategyId, exchangeName)
      }
      await loadData()
    } catch (err) {
      console.error('Failed to update CEX account:', err)
    } finally {
      setSavingCex(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
        <span className="ml-2 text-xs text-text-tertiary">Loading account assignments...</span>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3">
      <div className="text-xs text-text-secondary font-medium">
        Assign wallet accounts to each network for this strategy.
      </div>

      {/* Network rows */}
      <div className="space-y-1">
        {NETWORKS.map((network) => {
          const mapping = getNetworkMapping(network.id)
          const isSaving = savingNetwork === network.id

          return (
            <div
              key={network.id}
              className="flex items-center gap-3 py-2 px-3 rounded border border-border bg-surface hover:bg-surface-hover transition-colors"
            >
              <div className="w-28 shrink-0">
                <NetworkBadge chainId={network.chainId} />
              </div>

              <div className="flex-1 min-w-0">
                <AccountPicker
                  accounts={accounts}
                  selectedAccountId={mapping?.accountId}
                  onSelect={(accountId) =>
                    handleNetworkAccountChange(network.id, accountId)
                  }
                  disabled={isSaving}
                />
              </div>

              {isSaving && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-text-tertiary shrink-0" />
              )}

              {mapping && !isSaving && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() =>
                    handleNetworkAccountChange(network.id, '')
                  }
                  title="Remove assignment"
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          )
        })}
      </div>

      {/* CEX section */}
      <div className="pt-2 border-t border-border">
        <div className="text-xs text-text-secondary font-medium mb-2">
          CEX Connections
        </div>
        {CEX_EXCHANGES.map((exchange) => {
          const mapping = getCexMapping(exchange.name)
          const isSaving = savingCex === exchange.name

          return (
            <div
              key={exchange.name}
              className="flex items-center gap-3 py-2 px-3 rounded border border-border bg-surface"
            >
              <div className="w-28 shrink-0">
                <Badge className="bg-yellow-500/10 text-yellow-400">
                  {exchange.label}
                </Badge>
              </div>

              <div className="flex-1 text-xs text-text-secondary">
                {mapping ? 'Connected' : 'Not connected'}
              </div>

              <Button
                variant={mapping ? 'destructive' : 'outline'}
                size="sm"
                onClick={() => handleCexToggle(exchange.name)}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : mapping ? (
                  'Disconnect'
                ) : (
                  'Connect'
                )}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
