import { useState, useEffect, useMemo, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { SkeletonTable } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/components/ui/utils'
import { Wallet, ArrowUpDown, ChevronDown, ChevronRight } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import { pnlApi, type AccountPnlSummary } from '@/api/pnl'

type SortField = 'account_name' | 'realized_pnl' | 'unrealized_pnl' | 'total_pnl' | 'positions_count'
type SortDir = 'asc' | 'desc'

export function AccountPnlTable() {
  const { networkFilter } = useAppStore()
  const [isLoading, setIsLoading] = useState(true)
  const [accounts, setAccounts] = useState<AccountPnlSummary[]>([])
  const [sortField, setSortField] = useState<SortField>('total_pnl')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const net = networkFilter !== 'all' ? networkFilter : undefined
    try {
      const res = await pnlApi.getBreakdown(net)
      const data = res.data
      const accountSummaries: AccountPnlSummary[] = (data.byAccount || []).map((acct: any) => ({
        account_id: acct.accountId,
        account_name: acct.accountName || acct.accountId,
        address: acct.address || '',
        network: '',
        chain_id: 0,
        realized_pnl: acct.totalRealizedPnl || 0,
        unrealized_pnl: acct.totalUnrealizedPnl || 0,
        total_pnl: acct.totalPnl || 0,
        positions_count: acct.openPositionsCount || 0,
      }))
      setAccounts(accountSummaries)
    } catch (err) {
      console.error('[AccountPnlTable] Error fetching data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [networkFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const sorted = useMemo(() => {
    const copy = [...accounts]
    copy.sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortDir === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })
    return copy
  }, [accounts, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  if (isLoading) {
    return <SkeletonTable rows={4} cols={7} />
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={Wallet}
        title="No accounts found"
        description="Add accounts in Settings to track per-account PnL"
      />
    )
  }

  return (
    <div className="rounded border border-border bg-surface">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border text-2xs text-text-tertiary">
            <th className="p-2.5 w-6" />
            <SortableHeader
              label="Account"
              field="account_name"
              currentField={sortField}
              currentDir={sortDir}
              onToggle={toggleSort}
            />
            <th className="p-2.5 font-medium">Address</th>
            <SortableHeader
              label="Realized PnL"
              field="realized_pnl"
              currentField={sortField}
              currentDir={sortDir}
              onToggle={toggleSort}
              align="right"
            />
            <SortableHeader
              label="Unrealized PnL"
              field="unrealized_pnl"
              currentField={sortField}
              currentDir={sortDir}
              onToggle={toggleSort}
              align="right"
            />
            <SortableHeader
              label="Total PnL"
              field="total_pnl"
              currentField={sortField}
              currentDir={sortDir}
              onToggle={toggleSort}
              align="right"
            />
            <SortableHeader
              label="# Positions"
              field="positions_count"
              currentField={sortField}
              currentDir={sortDir}
              onToggle={toggleSort}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((acct) => {
            const isExpanded = expandedId === acct.account_id
            return (
              <AccountRow
                key={acct.account_id}
                account={acct}
                isExpanded={isExpanded}
                onToggleExpand={() =>
                  setExpandedId(isExpanded ? null : acct.account_id)
                }
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function formatUsd(value: number): string {
  const abs = Math.abs(value)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return value < 0 ? `-$${formatted}` : `$${formatted}`
}

function AccountRow({
  account,
  isExpanded,
  onToggleExpand,
}: {
  account: AccountPnlSummary
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <>
      <tr
        className="border-b border-border last:border-b-0 hover:bg-background cursor-pointer"
        onClick={onToggleExpand}
      >
        <td className="p-2.5 text-text-tertiary">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </td>
        <td className="p-2.5 text-2xs font-medium text-text-primary">
          {account.account_name}
        </td>
        <td className="p-2.5 text-2xs font-mono text-text-secondary">
          {account.address || '—'}
        </td>
        <td className="p-2.5 text-right">
          <PnlValue value={account.realized_pnl} />
        </td>
        <td className="p-2.5 text-right">
          <PnlValue value={account.unrealized_pnl} />
        </td>
        <td className="p-2.5 text-right">
          <PnlValue value={account.total_pnl} bold />
        </td>
        <td className="p-2.5 text-right text-2xs font-mono tabular-nums text-text-secondary">
          {account.positions_count}
        </td>
      </tr>

      {isExpanded && (
        <tr className="border-b border-border last:border-b-0">
          <td colSpan={7} className="p-0">
            <div className="bg-background px-6 py-3">
              {account.positions_count === 0 ? (
                <div className="text-2xs text-text-tertiary">
                  No open positions for this account
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-2xs text-text-tertiary font-medium mb-1">
                    Positions for {account.account_name}
                  </div>
                  <div className="text-2xs text-text-tertiary">
                    {account.positions_count} open position(s)
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function PnlValue({ value, bold }: { value: number; bold?: boolean }) {
  const color =
    value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-text-tertiary'
  return (
    <span
      className={cn(
        'text-2xs font-mono tabular-nums',
        color,
        bold && 'font-semibold'
      )}
    >
      {value >= 0 ? '+' : ''}{formatUsd(value)}
    </span>
  )
}

function SortableHeader({
  label,
  field,
  currentField,
  currentDir,
  onToggle,
  align,
}: {
  label: string
  field: SortField
  currentField: SortField
  currentDir: SortDir
  onToggle: (f: SortField) => void
  align?: 'right'
}) {
  const isActive = currentField === field
  return (
    <th
      className={cn(
        'p-2.5 font-medium cursor-pointer select-none hover:text-text-secondary',
        align === 'right' && 'text-right'
      )}
      onClick={() => onToggle(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          className={cn(
            'h-2.5 w-2.5',
            isActive ? 'text-text-secondary' : 'text-text-tertiary opacity-40'
          )}
        />
        {isActive && (
          <span className="text-text-tertiary">{currentDir === 'asc' ? '\u2191' : '\u2193'}</span>
        )}
      </span>
    </th>
  )
}
