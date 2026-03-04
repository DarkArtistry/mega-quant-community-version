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
import { healthApi, type ServiceTestResult } from '@/api/health'
import { hdWalletsApi, type HdWallet } from '@/api/hd-wallets'
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
  Copy,
  ChevronDown,
  ChevronRight,
  Activity,
  Wifi,
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
  const [hdWallets, setHdWallets] = useState<HdWallet[]>([])
  const [loading, setLoading] = useState(true)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [hdDialogOpen, setHdDialogOpen] = useState(false)
  const [deriveDialogWalletId, setDeriveDialogWalletId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadData = useCallback(async () => {
    if (!password) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [accountsRes, walletsRes] = await Promise.all([
        configApi.getAccounts(password),
        hdWalletsApi.list(),
      ])
      setAccounts(accountsRes.data.accounts || [])
      setHdWallets(walletsRes.data.wallets || [])
    } catch (err) {
      console.error('Failed to load wallet data:', err)
    } finally {
      setLoading(false)
    }
  }, [password])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDelete = async () => {
    if (!deleteTarget || !password) return
    setDeleting(true)
    try {
      await configApi.deleteAccount(password, deleteTarget.id)
      setDeleteTarget(null)
      await loadData()
    } catch (err) {
      console.error('Failed to delete account:', err)
    } finally {
      setDeleting(false)
    }
  }

  const handleImportSuccess = () => {
    setImportDialogOpen(false)
    loadData()
  }

  const handleHdWalletCreated = () => {
    setHdDialogOpen(false)
    loadData()
  }

  const handleDeriveSuccess = () => {
    setDeriveDialogWalletId(null)
    loadData()
  }

  // Separate imported accounts and HD-derived accounts
  const importedAccounts = accounts.filter((a) => a.accountType === 'imported')
  const hdAccounts = accounts.filter((a) => a.accountType === 'hd')

  return (
    <div className="space-y-4">
      {/* HD Wallets Section */}
      <div className="rounded border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">HD Wallets</h3>
          <Button variant="outline" size="sm" onClick={() => setHdDialogOpen(true)}>
            <KeyRound className="w-3.5 h-3.5" />
            Create HD Wallet
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
            <span className="text-xs text-text-tertiary">Loading wallets...</span>
          </div>
        ) : hdWallets.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-center">
            <KeyRound className="w-6 h-6 text-text-tertiary mb-2" />
            <div className="text-xs text-text-tertiary">
              No HD wallets. Create one to generate deterministic accounts.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {hdWallets.map((wallet) => (
              <HdWalletRow
                key={wallet.id}
                wallet={wallet}
                accounts={hdAccounts.filter((a) => a.hdWalletId === wallet.id)}
                password={password}
                onDeriveAccount={() => setDeriveDialogWalletId(wallet.id)}
                onDeleteAccount={(account) => setDeleteTarget(account)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Imported Accounts Section */}
      <div className="rounded border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Imported Accounts</h3>
          <Button size="sm" onClick={() => setImportDialogOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            Import Account
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
          </div>
        ) : importedAccounts.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-center">
            <Wallet className="w-6 h-6 text-text-tertiary mb-2" />
            <div className="text-xs text-text-tertiary">
              No imported accounts. Import a private key to get started.
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {importedAccounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                password={password}
                onDelete={() => setDeleteTarget(account)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <ImportAccountDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        password={password}
        onSuccess={handleImportSuccess}
      />

      <HdWalletDialog
        open={hdDialogOpen}
        onOpenChange={setHdDialogOpen}
        password={password}
        onSuccess={handleHdWalletCreated}
      />

      <DeriveAccountDialog
        open={!!deriveDialogWalletId}
        onOpenChange={(open) => { if (!open) setDeriveDialogWalletId(null) }}
        password={password}
        walletId={deriveDialogWalletId}
        onSuccess={handleDeriveSuccess}
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
  password,
  onDelete,
}: {
  account: Account
  password: string | null
  onDelete: () => void
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleCopyPrivateKey = async () => {
    if (!password) return
    try {
      const res = await hdWalletsApi.exportPrivateKey(password, account.id)
      if (res.data.success) {
        copyToClipboard(res.data.privateKey, 'pk')
      }
    } catch (err) {
      console.error('Failed to export private key:', err)
    }
  }

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded border border-border hover:bg-surface-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate">{account.name}</span>
          <Badge variant={account.accountType === 'hd' ? 'accent' : 'default'}>
            {account.accountType === 'hd' ? 'HD' : 'Imported'}
          </Badge>
        </div>
        <div className="text-2xs text-text-tertiary mt-0.5 font-mono">
          {truncateAddress(account.address)}
        </div>
      </div>

      {account.hdWalletId && (
        <div className="text-2xs text-text-tertiary">
          Index: {account.derivationIndex ?? 0}
        </div>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="text-text-tertiary hover:text-foreground shrink-0"
        onClick={() => copyToClipboard(account.address, 'addr')}
        title="Copy address"
      >
        {copiedId === 'addr' ? (
          <Check className="w-3.5 h-3.5 text-positive" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-text-tertiary hover:text-warning shrink-0"
        onClick={handleCopyPrivateKey}
        title="Copy private key"
      >
        {copiedId === 'pk' ? (
          <Check className="w-3.5 h-3.5 text-positive" />
        ) : (
          <KeyRound className="w-3.5 h-3.5" />
        )}
      </Button>
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
// HD Wallet Row (expandable)
// ============================================================================

function HdWalletRow({
  wallet,
  accounts,
  password,
  onDeriveAccount,
  onDeleteAccount,
}: {
  wallet: HdWallet
  accounts: Account[]
  password: string | null
  onDeriveAccount: () => void
  onDeleteAccount: (account: Account) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleCopyPrivateKey = async (account: Account) => {
    if (!password) return
    try {
      const res = await hdWalletsApi.exportPrivateKey(password, account.id)
      if (res.data.success) {
        copyToClipboard(res.data.privateKey, `pk-${account.id}`)
      }
    } catch (err) {
      console.error('Failed to export private key:', err)
    }
  }

  return (
    <div className="rounded border border-border">
      <div
        className="flex items-center gap-3 py-2.5 px-3 cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
        )}
        <KeyRound className="w-3.5 h-3.5 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium">{wallet.name}</span>
        </div>
        <Badge variant="accent">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onDeriveAccount() }}
        >
          <Plus className="w-3 h-3" />
          Derive
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1">
          {accounts.length === 0 ? (
            <div className="text-2xs text-text-tertiary py-2 text-center">
              No derived accounts yet. Click &quot;Derive&quot; to create one.
            </div>
          ) : (
            accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-surface-hover transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-medium">{account.name}</span>
                    <span className="text-2xs text-text-tertiary">
                      m/44&apos;/60&apos;/0&apos;/0/{account.derivationIndex ?? 0}
                    </span>
                  </div>
                  <div className="text-2xs text-text-tertiary font-mono">
                    {truncateAddress(account.address)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-text-tertiary hover:text-foreground shrink-0 h-6 w-6"
                  onClick={() => copyToClipboard(account.address, `addr-${account.id}`)}
                  title="Copy address"
                >
                  {copiedId === `addr-${account.id}` ? (
                    <Check className="w-3 h-3 text-positive" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-text-tertiary hover:text-warning shrink-0 h-6 w-6"
                  onClick={() => handleCopyPrivateKey(account)}
                  title="Copy private key"
                >
                  {copiedId === `pk-${account.id}` ? (
                    <Check className="w-3 h-3 text-positive" />
                  ) : (
                    <KeyRound className="w-3 h-3" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-text-tertiary hover:text-negative shrink-0 h-6 w-6"
                  onClick={() => onDeleteAccount(account)}
                  title="Delete account"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// HD Wallet Dialog
// ============================================================================

function HdWalletDialog({
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
  const [walletName, setWalletName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCreate = async () => {
    if (!password || !walletName.trim()) return
    setCreating(true)
    setError('')
    try {
      const res = await hdWalletsApi.create(password, walletName.trim())
      if (res.data.success && res.data.mnemonic) {
        setMnemonic(res.data.mnemonic)
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create HD wallet')
    } finally {
      setCreating(false)
    }
  }

  const handleCopyMnemonic = () => {
    if (!mnemonic) return
    navigator.clipboard.writeText(mnemonic)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    if (mnemonic) {
      // Wallet was created, trigger refresh
      onSuccess()
    } else {
      onOpenChange(false)
    }
    // Reset state
    setWalletName('')
    setError('')
    setMnemonic(null)
    setCopied(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create HD Wallet</DialogTitle>
          <DialogDescription>
            Generate a new BIP39 hierarchical deterministic wallet. Multiple accounts
            can be derived from a single seed phrase.
          </DialogDescription>
        </DialogHeader>

        {mnemonic ? (
          // Success: show mnemonic for backup
          <div className="space-y-3 pt-2">
            <div className="rounded border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              Write down this seed phrase and store it securely. It will NOT be shown again.
            </div>

            <div className="rounded border border-border bg-background p-3">
              <div className="grid grid-cols-3 gap-2">
                {mnemonic.split(' ').map((word, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <span className="text-text-tertiary w-4 text-right">{i + 1}.</span>
                    <span className="font-mono font-medium">{word}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between items-center pt-1">
              <Button variant="outline" size="sm" onClick={handleCopyMnemonic}>
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button size="sm" onClick={handleClose}>
                <Check className="w-3.5 h-3.5" />
                I&apos;ve backed it up
              </Button>
            </div>
          </div>
        ) : (
          // Form: enter wallet name
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-2xs text-text-secondary mb-1 block">Wallet Name</label>
              <Input
                placeholder="e.g. Main Wallet"
                value={walletName}
                onChange={(e) => setWalletName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              />
              <div className="text-2xs text-text-tertiary mt-1">
                Minimum 3 characters
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
                onClick={handleCreate}
                disabled={creating || walletName.trim().length < 3}
              >
                {creating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <KeyRound className="w-3.5 h-3.5" />
                )}
                Generate Wallet
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Derive Account Dialog
// ============================================================================

function DeriveAccountDialog({
  open,
  onOpenChange,
  password,
  walletId,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  password: string | null
  walletId: string | null
  onSuccess: () => void
}) {
  const [accountName, setAccountName] = useState('')
  const [nextIndex, setNextIndex] = useState(0)
  const [deriving, setDeriving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && walletId) {
      setAccountName('')
      setError('')
      hdWalletsApi.getNextIndex(walletId).then((res) => {
        if (res.data.success) setNextIndex(res.data.nextIndex)
      }).catch(() => {})
    }
  }, [open, walletId])

  const handleDerive = async () => {
    if (!password || !walletId || !accountName.trim()) return
    setDeriving(true)
    setError('')
    try {
      const res = await hdWalletsApi.deriveAccount(password, walletId, accountName.trim(), nextIndex)
      if (res.data.success) {
        onSuccess()
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to derive account')
    } finally {
      setDeriving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Derive Account</DialogTitle>
          <DialogDescription>
            Create a new account from this HD wallet at derivation index {nextIndex}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div>
            <label className="text-2xs text-text-secondary mb-1 block">Account Name</label>
            <Input
              placeholder="e.g. Trading Account 1"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDerive() }}
            />
          </div>

          <div className="text-2xs text-text-tertiary">
            Derivation path: m/44&apos;/60&apos;/0&apos;/0/{nextIndex}
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
              onClick={handleDerive}
              disabled={deriving || !accountName.trim()}
            >
              {deriving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Derive Account
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
  const [binanceTestnet, setBinanceTestnet] = useState(false)
  const [binanceTestnetDirty, setBinanceTestnetDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testingAll, setTestingAll] = useState(false)
  const [healthResults, setHealthResults] = useState<Map<string, ServiceTestResult>>(new Map())

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
      setBinanceTestnet(!!config.binance_testnet)
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
      const payload: any = { ...values }
      if (binanceTestnetDirty) {
        payload.binanceTestnet = binanceTestnet
      }
      await configApi.updateApiConfig(password, payload)
      // Update configured status for keys that were just saved
      const updated = new Set(configuredKeys)
      for (const [key, value] of Object.entries(values)) {
        if (value && typeof value === 'string' && value.trim()) {
          updated.add(key)
        }
      }
      setConfiguredKeys(updated)
      setValues({})
      setBinanceTestnetDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Failed to save API config:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleTestAll = async () => {
    setTestingAll(true)
    setHealthResults(new Map())
    try {
      const res = await healthApi.testServices()
      const map = new Map<string, ServiceTestResult>()
      for (const r of res.data.results) {
        map.set(r.service, r)
      }
      setHealthResults(map)
    } catch (err) {
      console.error('Health check failed:', err)
    } finally {
      setTestingAll(false)
    }
  }

  const hasChanges = Object.values(values).some(
    (v) => typeof v === 'string' && v.trim()
  ) || binanceTestnetDirty

  return (
    <div className="rounded border border-border bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">API Keys</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleTestAll}
          disabled={testingAll}
        >
          {testingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
          Test All Services
        </Button>
      </div>

      {/* Service connectivity status (shown after test) */}
      {(testingAll || healthResults.size > 0) && (
        <div className="rounded border border-border bg-background p-2.5">
          <div className="text-2xs text-text-tertiary mb-2 font-medium">Service Connectivity</div>
          <div className="grid grid-cols-2 gap-1.5">
            {['coingecko', 'defillama', 'coinmarketcap', 'binance', 'chainlink', 'rpc-ethereum', 'rpc-base', 'rpc-unichain', 'rpc-sepolia', 'rpc-base-sepolia', 'rpc-unichain-sepolia'].map((svc) => {
              const result = healthResults.get(svc)
              const displayNames: Record<string, string> = {
                coingecko: 'CoinGecko', defillama: 'DefiLlama', coinmarketcap: 'CoinMarketCap',
                binance: 'Binance', chainlink: 'Chainlink', 'rpc-ethereum': 'RPC Ethereum', 'rpc-base': 'RPC Base',
                'rpc-unichain': 'RPC Unichain', 'rpc-sepolia': 'RPC Sepolia', 'rpc-base-sepolia': 'RPC Base Sepolia', 'rpc-unichain-sepolia': 'RPC Unichain Sepolia',
              }
              return (
                <div key={svc} className="flex items-center justify-between py-1 px-2 rounded bg-surface">
                  <span className="text-2xs text-text-secondary">{displayNames[svc] || svc}</span>
                  {testingAll && !result ? (
                    <Loader2 className="w-3 h-3 animate-spin text-text-tertiary" />
                  ) : !result ? (
                    <span className="text-2xs text-text-tertiary">-</span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {result.status === 'ok' && result.provider && (
                        <span className="text-2xs text-accent">{result.provider}</span>
                      )}
                      <Badge variant={
                        result.status === 'ok' ? 'positive' :
                        result.status === 'not_configured' ? 'default' : 'negative'
                      }>
                        {result.status === 'ok' ? `${result.latencyMs}ms` :
                         result.status === 'not_configured' ? 'No key' :
                         'Error'}
                      </Badge>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {healthResults.size > 0 && !testingAll && (
            <div className="text-2xs text-text-tertiary mt-1.5">
              {healthResults.size} services tested &middot; {
                Array.from(healthResults.values()).filter(r => r.status === 'ok').length
              } online
            </div>
          )}
        </div>
      )}

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
                  value={(values[field.key] as string) || ''}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                />
              ))}
            </div>

            {/* Binance section */}
            <div className="border-t border-border pt-4">
              <h4 className="text-xs font-medium mb-3">Binance</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={binanceTestnet}
                      onChange={(e) => {
                        setBinanceTestnet(e.target.checked)
                        setBinanceTestnetDirty(true)
                      }}
                      className="rounded border-border"
                    />
                    <span className="text-2xs text-text-secondary">Testnet mode</span>
                  </label>
                  <span className="text-2xs text-text-tertiary">
                    {binanceTestnet ? '(testnet.binance.vision)' : '(api.binance.com)'}
                  </span>
                </div>
                {API_KEY_FIELDS.filter((f) => f.group === 'Binance').map((field) => (
                  <ApiKeyField
                    key={field.key}
                    label={field.label}
                    placeholder={field.placeholder}
                    configured={configuredKeys.has(field.key)}
                    value={(values[field.key] as string) || ''}
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
  { name: 'Unichain', chainId: 130, networkId: 130 },
  { name: 'Sepolia', chainId: 11155111, networkId: 11155111 },
  { name: 'Base Sepolia', chainId: 84532, networkId: 84532 },
  { name: 'Unichain Sepolia', chainId: 1301, networkId: 1301 },
]

const CHAIN_ID_TO_SERVICE: Record<number, string> = {
  1: 'rpc-ethereum',
  8453: 'rpc-base',
  130: 'rpc-unichain',
  11155111: 'rpc-sepolia',
  84532: 'rpc-base-sepolia',
  1301: 'rpc-unichain-sepolia',
}

function NetworksTab({ password }: { password: string | null }) {
  const [networkConfigs, setNetworkConfigs] = useState<NetworkConfig[]>([])
  const [customRpcs, setCustomRpcs] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rpcStatuses, setRpcStatuses] = useState<Record<number, 'online' | 'offline' | 'idle'>>({})
  const [testingRpc, setTestingRpc] = useState(false)
  const [rpcTestResults, setRpcTestResults] = useState<Map<string, ServiceTestResult>>(new Map())

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
      // Backend returns network_id (not chain_id), so handle both
      const rpcs: Record<number, string> = {}
      for (const cfg of configs) {
        const id = (cfg as any).network_id ?? cfg.chain_id
        const url = cfg.custom_rpc_url ?? (cfg as any).customRpcUrl
        if (url && id) {
          rpcs[id] = url
        }
      }
      setCustomRpcs(rpcs)

      // Set initial statuses based on whether config has a custom URL
      const statuses: Record<number, 'online' | 'offline' | 'idle'> = {}
      for (const net of DEFAULT_NETWORKS) {
        const hasUrl = !!rpcs[net.chainId]
        statuses[net.chainId] = hasUrl ? 'online' : 'idle'
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

  // Auto-test RPC connectivity when tab loads
  useEffect(() => {
    if (!loading) {
      handleTestRpc()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const handleSaveRpc = async (chainId: number) => {
    if (!password) return
    setSaving(true)
    try {
      await configApi.saveNetworkConfigs(password, [{
        chain_id: chainId,
        custom_rpc_url: customRpcs[chainId] || undefined,
      }])
      setRpcStatuses((prev) => ({ ...prev, [chainId]: customRpcs[chainId] ? 'online' : 'idle' }))
    } catch (err) {
      console.error('Failed to save network config:', err)
      setRpcStatuses((prev) => ({ ...prev, [chainId]: 'offline' }))
    } finally {
      setSaving(false)
    }
  }

  const handleTestRpc = async () => {
    setTestingRpc(true)
    setRpcTestResults(new Map())
    try {
      const res = await healthApi.testServices()
      const map = new Map<string, ServiceTestResult>()
      for (const r of res.data.results) {
        if (r.service.startsWith('rpc-')) {
          map.set(r.service, r)
        }
      }
      setRpcTestResults(map)
    } catch (err) {
      console.error('RPC test failed:', err)
    } finally {
      setTestingRpc(false)
    }
  }

  return (
    <div className="rounded border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Network Configuration</h3>
        <Button variant="outline" size="sm" onClick={handleTestRpc} disabled={testingRpc}>
          {testingRpc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
          Test RPC
        </Button>
      </div>

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

            const rpcTestResult = rpcTestResults.get(CHAIN_ID_TO_SERVICE[network.chainId])

            return (
              <div
                key={network.chainId}
                className="rounded border border-border hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center gap-3 py-2.5 px-3">
                  <div className="w-28 shrink-0">
                    <NetworkBadge chainId={network.chainId} />
                  </div>

                  <div className="text-2xs text-text-tertiary shrink-0 w-24">
                    Chain ID: {network.chainId}
                  </div>

                  <div className="flex-1 min-w-0">
                    <Input
                      className="h-6 text-2xs"
                      placeholder="https:// or wss:// RPC URL (override)"
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
                    status={
                      rpcTestResult
                        ? rpcTestResult.status === 'ok' ? 'online' : 'offline'
                        : rpcStatus
                    }
                    label={
                      rpcTestResult
                        ? rpcTestResult.status === 'ok' ? 'Online' : 'Offline'
                        : rpcStatus === 'online' ? 'Saved' : rpcStatus === 'offline' ? 'Error' : 'Not tested'
                    }
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
                {/* RPC test result */}
                {rpcTestResult && (
                  <div className="px-3 pb-2 flex items-center gap-2">
                    {rpcTestResult.provider && (
                      <Badge variant="accent">{rpcTestResult.provider}</Badge>
                    )}
                    {rpcTestResult.status === 'ok' ? (
                      <Badge variant="positive">
                        {rpcTestResult.message} ({rpcTestResult.latencyMs}ms)
                      </Badge>
                    ) : (
                      <Badge variant="negative" title={rpcTestResult.message}>
                        {rpcTestResult.message.slice(0, 60)}
                      </Badge>
                    )}
                  </div>
                )}
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
