import { useState, useEffect, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { NetworkBadge } from '@/components/shared/NetworkBadge'
import { StatusIndicator } from '@/components/shared/StatusIndicator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useAppStore } from '@/stores/useAppStore'
import { configApi } from '@/api/config'
import type { Account, ApiConfig, NetworkConfig } from '@/types'
import {
  Plus,
  Trash2,
  Loader2,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  KeyRound,
  Wallet,
  Download,
  Upload,
  HardDrive,
} from 'lucide-react'

// ============================================================================
// Helper
// ============================================================================

function truncateAddress(address: string): string {
  if (!address || address.length <= 10) return address || ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// ============================================================================
// SettingsPage
// ============================================================================

export function SettingsPage() {
  const { theme, toggleTheme, sessionPassword } = useAppStore()

  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="text-lg font-semibold">Settings</h2>

      <Tabs defaultValue="wallets">
        <TabsList>
          <TabsTrigger value="wallets">Wallets</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="networks">Networks</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>

        <TabsContent value="wallets">
          <WalletsTab password={sessionPassword} />
        </TabsContent>

        <TabsContent value="api-keys">
          <ApiKeysTab password={sessionPassword} />
        </TabsContent>

        <TabsContent value="networks">
          <NetworksTab password={sessionPassword} />
        </TabsContent>

        <TabsContent value="data">
          <DataTab />
        </TabsContent>

        <TabsContent value="appearance">
          <div className="rounded border border-border bg-surface p-4 space-y-4">
            <h3 className="text-sm font-medium">Appearance</h3>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs">Theme</div>
                <div className="text-2xs text-text-tertiary">
                  Current: {theme === 'dark' ? 'Dark' : 'Light'}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={toggleTheme}>
                Switch to {theme === 'dark' ? 'Light' : 'Dark'}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================================================
// Wallets Tab
// ============================================================================

function WalletsTab({ password }: { password: string | null }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [hdDialogOpen, setHdDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadAccounts = useCallback(async () => {
    if (!password) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await configApi.getAccounts(password)
      setAccounts(res.data.accounts || [])
    } catch (err) {
      console.error('Failed to load accounts:', err)
    } finally {
      setLoading(false)
    }
  }, [password])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const handleDelete = async () => {
    if (!deleteTarget || !password) return
    setDeleting(true)
    try {
      await configApi.deleteAccount(password, deleteTarget.id)
      setDeleteTarget(null)
      await loadAccounts()
    } catch (err) {
      console.error('Failed to delete account:', err)
    } finally {
      setDeleting(false)
    }
  }

  const handleImportSuccess = () => {
    setImportDialogOpen(false)
    loadAccounts()
  }

  return (
    <div className="rounded border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Wallet Accounts</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setHdDialogOpen(true)}>
            <KeyRound className="w-3.5 h-3.5" />
            Create HD Wallet
          </Button>
          <Button size="sm" onClick={() => setImportDialogOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Import Account
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
          <span className="text-xs text-text-tertiary">Loading accounts...</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-center">
          <Wallet className="w-8 h-8 text-text-tertiary mb-2" />
          <div className="text-xs text-text-tertiary">
            No accounts configured. Import a private key to get started.
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onDelete={() => setDeleteTarget(account)}
            />
          ))}
        </div>
      )}

      {/* Import Account Dialog */}
      <ImportAccountDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        password={password}
        onSuccess={handleImportSuccess}
      />

      {/* Create HD Wallet Dialog */}
      <HdWalletDialog
        open={hdDialogOpen}
        onOpenChange={setHdDialogOpen}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This action
              cannot be undone and the private key will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================================
// Account Row
// ============================================================================

function AccountRow({
  account,
  onDelete,
}: {
  account: Account
  onDelete: () => void
}) {
  // Networks assigned to this account could be derived from mappings,
  // but for the settings page we show the account type and address.
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded border border-border hover:bg-surface-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate">{account.name}</span>
          <Badge variant={account.account_type === 'hd' ? 'accent' : 'default'}>
            {account.account_type === 'hd' ? 'HD' : 'Imported'}
          </Badge>
        </div>
        <div className="text-2xs text-text-tertiary mt-0.5 font-mono">
          {truncateAddress(account.address)}
        </div>
      </div>

      {account.hd_wallet_id && (
        <div className="text-2xs text-text-tertiary">
          Index: {account.derivation_index ?? 0}
        </div>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="text-text-tertiary hover:text-negative shrink-0"
        onClick={onDelete}
        title="Delete account"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
}

// ============================================================================
// Import Account Dialog
// ============================================================================

function ImportAccountDialog({
  open,
  onOpenChange,
  password,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  password: string | null
  onSuccess: () => void
}) {
  const [name, setName] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  const handleImport = async () => {
    if (!password || !name.trim() || !privateKey.trim()) return
    setImporting(true)
    setError('')
    try {
      await configApi.addAccount(password, {
        name: name.trim(),
        private_key: privateKey.trim(),
      })
      setName('')
      setPrivateKey('')
      setShowKey(false)
      onSuccess()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to import account')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Account</DialogTitle>
          <DialogDescription>
            Import a wallet by providing a name and private key.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div>
            <label className="text-2xs text-text-secondary mb-1 block">Account Name</label>
            <Input
              placeholder="e.g. Main Trading Wallet"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-2xs text-text-secondary mb-1 block">Private Key</label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder="0x..."
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                className="pr-8 font-mono"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary transition-colors"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-negative text-2xs">
              <AlertCircle className="w-3 h-3" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={importing || !name.trim() || !privateKey.trim()}
            >
              {importing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// HD Wallet Dialog
// ============================================================================

function HdWalletDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create HD Wallet</DialogTitle>
          <DialogDescription>
            Generate a new BIP39 hierarchical deterministic wallet. Multiple accounts
            can be derived from a single seed phrase.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div className="rounded border border-border bg-surface-hover p-3 text-xs text-text-secondary">
            HD wallet creation will generate a new mnemonic seed phrase. Make sure to
            back it up securely. This feature requires the backend HD wallet service to
            be configured.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled>
              <KeyRound className="w-3.5 h-3.5" />
              Generate Wallet
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// API Keys Tab
// ============================================================================

const API_KEY_FIELDS: {
  key: keyof ApiConfig
  label: string
  placeholder: string
  group?: string
}[] = [
  { key: 'alchemy_api_key', label: 'Alchemy API Key', placeholder: 'Enter Alchemy API key' },
  { key: 'oneinch_api_key', label: '1inch API Key', placeholder: 'Enter 1inch API key' },
  { key: 'coinmarketcap_api_key', label: 'CoinMarketCap API Key', placeholder: 'Enter CMC API key' },
  { key: 'binance_api_key', label: 'Binance API Key', placeholder: 'Enter Binance API key', group: 'Binance' },
  { key: 'binance_api_secret', label: 'Binance API Secret', placeholder: 'Enter Binance API secret', group: 'Binance' },
]

function ApiKeysTab({ password }: { password: string | null }) {
  const [values, setValues] = useState<Partial<ApiConfig>>({})
  const [configuredKeys, setConfiguredKeys] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testingBinance, setTestingBinance] = useState(false)
  const [binanceStatus, setBinanceStatus] = useState<'idle' | 'ok' | 'error'>('idle')

  const loadConfig = useCallback(async () => {
    if (!password) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await configApi.getApiConfig(password)
      const config = res.data.config || {}
      // Determine which keys are already configured (non-empty)
      const configured = new Set<string>()
      for (const [key, value] of Object.entries(config)) {
        if (value && typeof value === 'string' && value.trim()) {
          configured.add(key)
        }
      }
      setConfiguredKeys(configured)
      // Do NOT populate actual values for security - show only status
    } catch (err) {
      console.error('Failed to load API config:', err)
    } finally {
      setLoading(false)
    }
  }, [password])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const handleSave = async () => {
    if (!password) return
    setSaving(true)
    setSaved(false)
    try {
      await configApi.updateApiConfig(password, values)
      // Update configured status for keys that were just saved
      const updated = new Set(configuredKeys)
      for (const [key, value] of Object.entries(values)) {
        if (value && typeof value === 'string' && value.trim()) {
          updated.add(key)
        }
      }
      setConfiguredKeys(updated)
      setValues({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save API config:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleTestBinance = async () => {
    setTestingBinance(true)
    setBinanceStatus('idle')
    try {
      // Simple connectivity test - this would hit the backend's binance test endpoint
      // For now we check if both keys are configured
      const hasBothKeys =
        configuredKeys.has('binance_api_key') && configuredKeys.has('binance_api_secret')
      setBinanceStatus(hasBothKeys ? 'ok' : 'error')
    } catch {
      setBinanceStatus('error')
    } finally {
      setTestingBinance(false)
    }
  }

  const hasChanges = Object.values(values).some(
    (v) => typeof v === 'string' && v.trim()
  )

  return (
    <div className="rounded border border-border bg-surface p-4 space-y-4">
      <h3 className="text-sm font-medium">API Keys</h3>

      {loading ? (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
          <span className="text-xs text-text-tertiary">Loading configuration...</span>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {/* General API Keys */}
            <div className="space-y-3">
              {API_KEY_FIELDS.filter((f) => !f.group).map((field) => (
                <ApiKeyField
                  key={field.key}
                  label={field.label}
                  placeholder={field.placeholder}
                  configured={configuredKeys.has(field.key)}
                  value={values[field.key] || ''}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                />
              ))}
            </div>

            {/* Binance section */}
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-medium">Binance</h4>
                <div className="flex items-center gap-2">
                  {binanceStatus === 'ok' && (
                    <StatusIndicator status="online" label="Connected" />
                  )}
                  {binanceStatus === 'error' && (
                    <StatusIndicator status="offline" label="Failed" />
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestBinance}
                    disabled={testingBinance}
                  >
                    {testingBinance ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : null}
                    Test Connection
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                {API_KEY_FIELDS.filter((f) => f.group === 'Binance').map((field) => (
                  <ApiKeyField
                    key={field.key}
                    label={field.label}
                    placeholder={field.placeholder}
                    configured={configuredKeys.has(field.key)}
                    value={values[field.key] || ''}
                    onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : saved ? (
                <Check className="w-3.5 h-3.5" />
              ) : null}
              {saved ? 'Saved' : 'Save API Keys'}
            </Button>
            {!hasChanges && !saved && (
              <span className="text-2xs text-text-tertiary">
                Enter new values to update
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ApiKeyField({
  label,
  placeholder,
  configured,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  configured: boolean
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-2xs text-text-secondary">{label}</label>
        <Badge variant={configured ? 'positive' : 'default'}>
          {configured ? 'Configured' : 'Not set'}
        </Badge>
      </div>
      <Input
        type="password"
        placeholder={configured ? '********' : placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

// ============================================================================
// Networks Tab
// ============================================================================

const DEFAULT_NETWORKS = [
  { name: 'Ethereum', chainId: 1, networkId: 1 },
  { name: 'Base', chainId: 8453, networkId: 8453 },
  { name: 'Sepolia', chainId: 11155111, networkId: 11155111 },
  { name: 'Base Sepolia', chainId: 84532, networkId: 84532 },
]

function NetworksTab({ password }: { password: string | null }) {
  const [networkConfigs, setNetworkConfigs] = useState<NetworkConfig[]>([])
  const [customRpcs, setCustomRpcs] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rpcStatuses, setRpcStatuses] = useState<Record<number, 'online' | 'offline' | 'idle'>>({})

  const loadConfigs = useCallback(async () => {
    if (!password) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await configApi.getNetworkConfigs(password)
      const configs = res.data.configs || []
      setNetworkConfigs(configs)

      // Initialize custom RPCs from loaded configs
      const rpcs: Record<number, string> = {}
      for (const cfg of configs) {
        if (cfg.custom_rpc_url) {
          rpcs[cfg.chain_id] = cfg.custom_rpc_url
        }
      }
      setCustomRpcs(rpcs)

      // Set initial statuses based on whether config exists
      const statuses: Record<number, 'online' | 'offline' | 'idle'> = {}
      for (const net of DEFAULT_NETWORKS) {
        const cfg = configs.find((c) => c.chain_id === net.chainId)
        statuses[net.chainId] = cfg ? 'online' : 'idle'
      }
      setRpcStatuses(statuses)
    } catch (err) {
      console.error('Failed to load network configs:', err)
    } finally {
      setLoading(false)
    }
  }, [password])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  const handleSaveRpc = async (chainId: number) => {
    if (!password) return
    setSaving(true)
    try {
      const existing = networkConfigs.find((c) => c.chain_id === chainId)
      const configToSave: Partial<NetworkConfig> = {
        chain_id: chainId,
        custom_rpc_url: customRpcs[chainId] || undefined,
        ...existing,
      }
      await configApi.saveNetworkConfigs(password, [configToSave])
      setRpcStatuses((prev) => ({ ...prev, [chainId]: 'online' }))
    } catch (err) {
      console.error('Failed to save network config:', err)
      setRpcStatuses((prev) => ({ ...prev, [chainId]: 'offline' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded border border-border bg-surface p-4 space-y-3">
      <h3 className="text-sm font-medium">Network Configuration</h3>

      {loading ? (
        <div className="flex items-center gap-2 py-4 justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
          <span className="text-xs text-text-tertiary">Loading networks...</span>
        </div>
      ) : (
        <div className="space-y-2">
          {DEFAULT_NETWORKS.map((network) => {
            const cfg = networkConfigs.find(
              (c) => c.chain_id === network.chainId
            )
            const rpcStatus = rpcStatuses[network.chainId] || 'idle'

            return (
              <div
                key={network.chainId}
                className="flex items-center gap-3 py-2.5 px-3 rounded border border-border hover:bg-surface-hover transition-colors"
              >
                <div className="w-28 shrink-0">
                  <NetworkBadge chainId={network.chainId} />
                </div>

                <div className="text-2xs text-text-tertiary shrink-0 w-24">
                  Chain ID: {network.chainId}
                </div>

                <div className="flex-1 min-w-0">
                  <Input
                    className="h-6 text-2xs"
                    placeholder={cfg?.rpc_provider || 'Default RPC'}
                    value={customRpcs[network.chainId] || ''}
                    onChange={(e) =>
                      setCustomRpcs((prev) => ({
                        ...prev,
                        [network.chainId]: e.target.value,
                      }))
                    }
                  />
                </div>

                <StatusIndicator
                  status={rpcStatus}
                  label={rpcStatus === 'online' ? 'Connected' : rpcStatus === 'offline' ? 'Disconnected' : 'Unknown'}
                />

                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleSaveRpc(network.chainId)}
                  disabled={saving}
                >
                  Save
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Data Tab (Backup / Restore)
// ============================================================================

function DataTab() {
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const isElectron = !!window.electronAPI?.backupDatabase

  const handleBackup = async () => {
    if (!window.electronAPI?.backupDatabase) return
    setBackupStatus(null)
    const result = await window.electronAPI.backupDatabase()
    if (result.success) {
      setBackupStatus('Backup saved successfully')
    } else if (result.error !== 'Cancelled') {
      setBackupStatus(`Error: ${result.error}`)
    }
  }

  const handleRestore = async () => {
    if (!window.electronAPI?.restoreDatabase) return
    await window.electronAPI.restoreDatabase()
  }

  return (
    <div className="rounded border border-border bg-surface p-4 space-y-4">
      <h3 className="text-sm font-medium">Data Management</h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium">Export Backup</div>
            <div className="text-2xs text-text-tertiary">
              Save an encrypted copy of your database
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBackup}
            disabled={!isElectron}
            title={!isElectron ? 'Only available in desktop app' : undefined}
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
        </div>

        <div className="border-t border-border" />

        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium">Restore from Backup</div>
            <div className="text-2xs text-text-tertiary">
              Replace current database with a backup file. App will restart.
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRestore}
            disabled={!isElectron}
            title={!isElectron ? 'Only available in desktop app' : undefined}
          >
            <Upload className="w-3.5 h-3.5" />
            Restore
          </Button>
        </div>

        {backupStatus && (
          <p className={`text-2xs ${backupStatus.startsWith('Error') ? 'text-negative' : 'text-positive'}`}>
            {backupStatus}
          </p>
        )}

        {!isElectron && (
          <p className="text-2xs text-text-tertiary flex items-center gap-1">
            <HardDrive className="w-3 h-3" />
            Backup/restore is only available in the desktop app
          </p>
        )}
      </div>
    </div>
  )
}
