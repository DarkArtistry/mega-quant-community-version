import type { Account } from '@/types'

function truncateAddress(address: string): string {
  if (address.length <= 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

interface AccountPickerProps {
  accounts: Account[]
  selectedAccountId?: string
  onSelect: (accountId: string) => void
  label?: string
  disabled?: boolean
}

export function AccountPicker({
  accounts,
  selectedAccountId,
  onSelect,
  label,
  disabled = false,
}: AccountPickerProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-2xs text-text-secondary">{label}</label>
      )}
      <select
        className="h-7 rounded border border-border bg-surface px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        value={selectedAccountId || ''}
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled}
      >
        <option value="">None</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name} ({truncateAddress(account.address)})
          </option>
        ))}
      </select>
    </div>
  )
}
