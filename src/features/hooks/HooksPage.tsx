import { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Anchor, ExternalLink, Copy, Check, RefreshCw, XCircle, ArrowUpDown, Clock, Target, Shield, Droplets } from 'lucide-react'
import { ordersApi } from '@/api/orders'
import { liquidityApi } from '@/api/liquidity'
import type { PoolWithInfo, V4Chain, WalletAccount, BalanceInfo } from '@/api/liquidity'
import type { Order } from '@/types'

const DEPLOYED_HOOK_ADDRESS = import.meta.env.VITE_HOOK_ADDRESS || '0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0'
const DEPLOYED_ROUTER_ADDRESS = import.meta.env.VITE_ROUTER_ADDRESS || '0x608AEfA1DFD3621554a948E20159eB243C76235F'
const DEPLOYED_REGISTRY_ADDRESS = import.meta.env.VITE_REGISTRY_ADDRESS || '0x680762A631334098eeF5F24EAAafac0F07Cb2e3a'
const HOOK_CHAIN = 'Unichain Sepolia'
const EXPLORER_BASE = 'https://sepolia.uniscan.xyz'

type Tab = 'orders' | 'pools' | 'info'

export function HooksPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('orders')
  const [copied, setCopied] = useState<string | null>(null)
  const [hookOrders, setHookOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [showDeployDialog, setShowDeployDialog] = useState(false)

  const isDeployed = !!DEPLOYED_HOOK_ADDRESS

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300)
    return () => clearTimeout(timer)
  }, [])

  const fetchHookOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const res = await ordersApi.getAll()
      const orders = res.data?.orders || []
      setHookOrders(orders.filter(o => o.protocol === 'uniswap-v4-hook'))
    } catch {
      // API may not be available
    } finally {
      setOrdersLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHookOrders()
    const interval = setInterval(fetchHookOrders, 15000)
    return () => clearInterval(interval)
  }, [fetchHookOrders])

  function handleCopy(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const pendingOrders = hookOrders.filter(o => o.status === 'pending')
  const filledOrders = hookOrders.filter(o => o.status === 'filled')
  const cancelledOrders = hookOrders.filter(o => o.status === 'cancelled' || o.status === 'expired')

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Uniswap V4 Hooks</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={fetchHookOrders} disabled={ordersLoading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${ordersLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowDeployDialog(!showDeployDialog)}>
            {isDeployed ? 'Addresses' : 'Deploy'}
          </Button>
        </div>
      </div>

      {/* Hook Status Card */}
      {isLoading ? (
        <LoadingCard />
      ) : (
        <div className="rounded border border-border bg-surface p-4">
          <div className="flex items-center gap-3 mb-3">
            <Anchor className="w-5 h-5 text-accent" />
            <div>
              <h3 className="text-sm font-medium">MegaQuantHook</h3>
              <p className="text-2xs text-text-tertiary">
                Volatility Fees + Limit Orders + Stop Orders + Bracket (OCO)
              </p>
            </div>
            <Badge variant={isDeployed ? 'positive' : 'warning'} className="ml-auto">
              {isDeployed ? 'Deployed' : 'Not Deployed'}
            </Badge>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <FeaturePill icon={<ArrowUpDown className="w-3 h-3" />} label="Dynamic Fees" />
            <FeaturePill icon={<Target className="w-3 h-3" />} label="Limit Orders" />
            <FeaturePill icon={<Shield className="w-3 h-3" />} label="Stop Orders" />
            <FeaturePill icon={<ArrowUpDown className="w-3 h-3" />} label="Bracket (OCO)" />
            <FeaturePill icon={<Clock className="w-3 h-3" />} label="TWAP" />
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-4 text-xs">
            <StatCell label="Pending" value={pendingOrders.length.toString()} variant="warning" />
            <StatCell label="Filled" value={filledOrders.length.toString()} variant="positive" />
            <StatCell label="Cancelled" value={cancelledOrders.length.toString()} />
            <StatCell label="Chain" value={HOOK_CHAIN} />
          </div>

          {/* Addresses */}
          {isDeployed && showDeployDialog && (
            <div className="mt-3 pt-3 border-t border-border space-y-1.5">
              <AddressRow label="Hook" address={DEPLOYED_HOOK_ADDRESS} onCopy={handleCopy} copied={copied} />
              {DEPLOYED_ROUTER_ADDRESS && (
                <AddressRow label="Router" address={DEPLOYED_ROUTER_ADDRESS} onCopy={handleCopy} copied={copied} />
              )}
              {DEPLOYED_REGISTRY_ADDRESS && (
                <AddressRow label="Registry" address={DEPLOYED_REGISTRY_ADDRESS} onCopy={handleCopy} copied={copied} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Deploy dialog (when not deployed) */}
      {showDeployDialog && !isDeployed && (
        <div className="rounded border border-border bg-surface p-4 space-y-3">
          <h3 className="text-xs font-medium text-text-secondary">Deployment Instructions</h3>
          <div className="text-2xs text-text-secondary space-y-2">
            <p>1. Set up your deployer account with testnet ETH on {HOOK_CHAIN}</p>
            <p>2. Create <code className="bg-background px-1 py-0.5 rounded font-mono">contracts/.env</code> with your private key</p>
            <p>3. Deploy hook, router, and registry:</p>
            <pre className="bg-background p-2 rounded text-2xs font-mono overflow-x-auto">
{`cd contracts
forge script script/DeployHook.s.sol --rpc-url https://sepolia.unichain.org --broadcast
forge script script/DeployRouter.s.sol --rpc-url https://sepolia.unichain.org --broadcast
forge script script/DeployRegistry.s.sol --rpc-url https://sepolia.unichain.org --broadcast`}
            </pre>
            <p>4. Set env vars: <code className="bg-background px-1 py-0.5 rounded font-mono">VITE_HOOK_ADDRESS</code>, <code className="bg-background px-1 py-0.5 rounded font-mono">VITE_ROUTER_ADDRESS</code>, <code className="bg-background px-1 py-0.5 rounded font-mono">VITE_REGISTRY_ADDRESS</code></p>
            <p>5. Update <code className="bg-background px-1 py-0.5 rounded font-mono">backend/src/lib/trading/config/chains.ts</code> with deployed addresses</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabButton active={activeTab === 'orders'} onClick={() => setActiveTab('orders')}>
          Hook Orders {pendingOrders.length > 0 && <Badge variant="warning" className="ml-1.5 text-2xs">{pendingOrders.length}</Badge>}
        </TabButton>
        <TabButton active={activeTab === 'pools'} onClick={() => setActiveTab('pools')}>
          Pools
        </TabButton>
        <TabButton active={activeTab === 'info'} onClick={() => setActiveTab('info')}>
          Volatility
        </TabButton>
      </div>

      {/* Tab content */}
      {activeTab === 'orders' && (
        <HookOrdersTab
          orders={hookOrders}
          loading={ordersLoading}
          onRefresh={fetchHookOrders}
        />
      )}

      {activeTab === 'pools' && (
        <PoolsTab isDeployed={isDeployed} />
      )}

      {activeTab === 'info' && (
        <div className="rounded border border-border bg-surface p-4">
          <h3 className="text-xs font-medium text-text-secondary mb-2">Volatility State</h3>
          <p className="text-2xs text-text-tertiary">
            {isDeployed ? 'Run a strategy with getVolatilityFee() or getPoolInfo() to view live data.' : 'Deploy hook to view volatility data.'}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded bg-background p-2">
              <div className="text-text-tertiary text-2xs">EWMA Variance</div>
              <div className="font-mono">—</div>
            </div>
            <div className="rounded bg-background p-2">
              <div className="text-text-tertiary text-2xs">Current Fee</div>
              <div className="font-mono">—</div>
            </div>
            <div className="rounded bg-background p-2">
              <div className="text-text-tertiary text-2xs">Observations</div>
              <div className="font-mono">—</div>
            </div>
            <div className="rounded bg-background p-2">
              <div className="text-text-tertiary text-2xs">Last Update</div>
              <div className="font-mono">—</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Pools Tab
// ============================================================================

function PoolsTab({ isDeployed }: { isDeployed: boolean }) {
  const [chains, setChains] = useState<V4Chain[]>([])
  const [accounts, setAccounts] = useState<WalletAccount[]>([])
  const [selectedChain, setSelectedChain] = useState('unichain-sepolia')
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>()
  const [pools, setPools] = useState<PoolWithInfo[]>([])
  const [selectedPool, setSelectedPool] = useState<PoolWithInfo | null>(null)
  const [poolsLoading, setPoolsLoading] = useState(false)
  const [poolsError, setPoolsError] = useState<string | null>(null)

  // Balance state
  const [balanceInfo, setBalanceInfo] = useState<BalanceInfo | null>(null)

  // Add liquidity form state
  const [amount0, setAmount0] = useState('20')
  const [amount1, setAmount1] = useState('0.01')
  const [fullRange, setFullRange] = useState(true)
  const [tickLower, setTickLower] = useState('')
  const [tickUpper, setTickUpper] = useState('')
  const [wrapAmount, setWrapAmount] = useState('0.05')
  const [wrapping, setWrapping] = useState(false)
  const [addingLiquidity, setAddingLiquidity] = useState(false)
  const [addResult, setAddResult] = useState<{ txHash: string; explorerUrl: string } | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  // Fetch available V4 chains + accounts on mount
  useEffect(() => {
    liquidityApi.getChains().then(res => {
      setChains(res.data?.chains || [])
    }).catch(() => {})
    liquidityApi.getAccounts().then(res => {
      const accts = res.data?.accounts || []
      setAccounts(accts)
      if (accts.length > 0 && !selectedAccountId) {
        setSelectedAccountId(accts[0].id)
      }
    }).catch(() => {})
  }, [])

  // Fetch balance when chain, account, or selected pool changes
  const fetchBalance = useCallback(async () => {
    if (!selectedAccountId) return
    try {
      const res = await liquidityApi.getBalance(
        selectedChain,
        selectedAccountId,
        selectedPool?.token0Symbol,
        selectedPool?.token1Symbol,
      )
      if (res.data?.success) {
        setBalanceInfo(res.data)
      }
    } catch {
      setBalanceInfo(null)
    }
  }, [selectedChain, selectedAccountId, selectedPool?.token0Symbol, selectedPool?.token1Symbol])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  const fetchPools = useCallback(async () => {
    setPoolsLoading(true)
    setPoolsError(null)
    try {
      const res = await liquidityApi.getPools(selectedChain, selectedAccountId)
      const fetched = res.data?.pools || []
      setPools(fetched)
      if (fetched.length > 0 && !selectedPool) {
        setSelectedPool(fetched[0])
      }
    } catch (err: any) {
      setPoolsError(err?.response?.data?.error || err?.message || 'Failed to fetch pools')
      setPools([])
    } finally {
      setPoolsLoading(false)
    }
  }, [selectedChain, selectedAccountId, selectedPool])

  useEffect(() => {
    fetchPools()
    const interval = setInterval(fetchPools, 30000)
    return () => clearInterval(interval)
  }, [fetchPools])

  function handleChainChange(chain: string) {
    setSelectedChain(chain)
    setSelectedPool(null)
    setPools([])
    setBalanceInfo(null)
    setAddResult(null)
    setAddError(null)
  }

  function handleAccountChange(accountId: string) {
    setSelectedAccountId(accountId)
    setBalanceInfo(null)
    setAddResult(null)
    setAddError(null)
  }

  async function handleAddLiquidity() {
    if (!selectedPool) return
    setAddingLiquidity(true)
    setAddResult(null)
    setAddError(null)

    try {
      const res = await liquidityApi.addLiquidity({
        chain: selectedChain,
        tokenA: selectedPool.token0Symbol,
        tokenB: selectedPool.token1Symbol,
        amount0,
        amount1,
        accountId: selectedAccountId,
        ...(!fullRange && tickLower ? { tickLower: parseInt(tickLower) } : {}),
        ...(!fullRange && tickUpper ? { tickUpper: parseInt(tickUpper) } : {}),
      })
      if (res.data?.success) {
        setAddResult({ txHash: res.data.txHash, explorerUrl: res.data.explorerUrl })
        fetchPools()
        fetchBalance()
      } else {
        setAddError(res.data?.error || 'Transaction failed')
      }
    } catch (err: any) {
      setAddError(err?.response?.data?.error || err?.message || 'Failed to add liquidity')
    } finally {
      setAddingLiquidity(false)
    }
  }

  if (poolsLoading && pools.length === 0 && chains.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded border border-border bg-surface p-4 space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      </div>
    )
  }

  const token0Label = selectedPool?.token0Symbol || 'Token0'
  const token1Label = selectedPool?.token1Symbol || 'Token1'

  return (
    <div className="space-y-3">
      {/* Chain + Account selector */}
      <div className="rounded border border-border bg-surface p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-2xs text-text-tertiary mb-1 block">Chain</label>
            <select
              value={selectedChain}
              onChange={(e) => handleChainChange(e.target.value)}
              className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {chains.map(c => (
                <option key={c.key} value={c.key}>
                  {c.name} {c.hasHook ? '' : '(no hook)'}
                </option>
              ))}
              {chains.length === 0 && <option value={selectedChain}>{selectedChain}</option>}
            </select>
          </div>
          <div>
            <label className="text-2xs text-text-tertiary mb-1 block">Account</label>
            <select
              value={selectedAccountId || ''}
              onChange={(e) => handleAccountChange(e.target.value)}
              className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.address.slice(0, 6)}...{a.address.slice(-4)})
                </option>
              ))}
              {accounts.length === 0 && <option value="">No accounts</option>}
            </select>
          </div>
          {/* Balance display */}
          {balanceInfo && (
            <div className="ml-auto flex items-center gap-3 text-xs">
              <div className="text-right">
                <div className="text-2xs text-text-tertiary">Gas ({balanceInfo.symbol})</div>
                <div className={`font-mono ${balanceInfo.sufficient ? 'text-text-primary' : 'text-negative'}`}>
                  {parseFloat(balanceInfo.balance).toFixed(6)}
                </div>
              </div>
              {balanceInfo.tokenBalances.map(tb => (
                <div key={tb.symbol} className="text-right">
                  <div className="text-2xs text-text-tertiary">{tb.symbol}</div>
                  <div className="font-mono">{parseFloat(tb.balance).toFixed(tb.decimals > 6 ? 6 : tb.decimals)}</div>
                </div>
              ))}
              {!balanceInfo.sufficient && (
                <Badge variant="negative" className="text-2xs">No gas</Badge>
              )}
            </div>
          )}
        </div>
        {/* Wrap ETH row — show when WETH balance is 0 and user has ETH */}
        {balanceInfo && balanceInfo.sufficient && balanceInfo.tokenBalances.some(tb => tb.symbol === 'WETH' && parseFloat(tb.balance) === 0) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            <span className="text-2xs text-warning">No WETH — wrap some ETH first:</span>
            <Input
              type="text"
              value={wrapAmount}
              onChange={(e) => setWrapAmount(e.target.value)}
              className="font-mono w-24 h-7 text-xs"
              placeholder="0.05"
            />
            <span className="text-2xs text-text-tertiary">ETH</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                setWrapping(true)
                try {
                  const res = await liquidityApi.wrapEth(selectedChain, wrapAmount, selectedAccountId)
                  if (res.data?.success) {
                    fetchBalance()
                  }
                } catch (err: any) {
                  setAddError(err?.response?.data?.error || err?.message || 'Failed to wrap ETH')
                } finally {
                  setWrapping(false)
                }
              }}
              disabled={wrapping || !wrapAmount}
            >
              {wrapping ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Wrap ETH'}
            </Button>
          </div>
        )}
      </div>

      {/* Pool list */}
      <div className="rounded border border-border bg-surface p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-text-secondary">Registered Pools</h3>
          <Button size="sm" variant="ghost" onClick={fetchPools} disabled={poolsLoading}>
            <RefreshCw className={`w-3 h-3 mr-1 ${poolsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {poolsError && (
          <p className="text-2xs text-negative mb-2">{poolsError}</p>
        )}

        {pools.length === 0 && !poolsError ? (
          <p className="text-2xs text-text-tertiary">
            {poolsLoading ? 'Loading...' : 'No pools registered on this chain.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {pools.map((pool) => (
              <button
                key={pool.poolId}
                onClick={() => setSelectedPool(pool)}
                className={`w-full text-left rounded p-2.5 text-xs transition-colors ${
                  selectedPool?.poolId === pool.poolId
                    ? 'bg-accent/10 border border-accent/30'
                    : 'bg-background hover:bg-background/80 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Droplets className="w-3.5 h-3.5 text-accent" />
                    <span className="font-medium">{pool.token0Symbol}/{pool.token1Symbol}</span>
                    <span className="text-text-tertiary text-2xs">tickSpacing={pool.tickSpacing}</span>
                  </div>
                  <Badge variant={pool.active ? 'positive' : 'default'} className="text-2xs">
                    {pool.active ? 'active' : 'inactive'}
                  </Badge>
                </div>
                {pool.info && (
                  <div className="mt-1.5 flex items-center gap-3 text-2xs text-text-tertiary">
                    <span>Tick: {pool.info.currentTick}</span>
                    <span>Fee: {pool.info.feePercentage}</span>
                    <span>Liq: {formatLiquidity(pool.info.liquidity)}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pool detail + Add Liquidity */}
      {selectedPool && (
        <>
          {/* Pool State */}
          <div className="rounded border border-border bg-surface p-4">
            <h3 className="text-xs font-medium text-text-secondary mb-3">Pool State</h3>
            {selectedPool.info ? (
              <>
                <div className="grid grid-cols-4 gap-3 text-xs mb-3">
                  <div className="rounded bg-background p-2">
                    <div className="text-text-tertiary text-2xs">Tick</div>
                    <div className="font-mono">{selectedPool.info.currentTick}</div>
                  </div>
                  <div className="rounded bg-background p-2">
                    <div className="text-text-tertiary text-2xs">Fee</div>
                    <div className="font-mono">{selectedPool.info.feePercentage}</div>
                  </div>
                  <div className="rounded bg-background p-2">
                    <div className="text-text-tertiary text-2xs">Liquidity</div>
                    <div className="font-mono">{formatLiquidity(selectedPool.info.liquidity)}</div>
                  </div>
                  <div className="rounded bg-background p-2">
                    <div className="text-text-tertiary text-2xs">Price (sqrtX96)</div>
                    <div className="font-mono text-2xs truncate" title={selectedPool.info.sqrtPriceX96}>
                      {selectedPool.info.sqrtPriceX96.slice(0, 12)}...
                    </div>
                  </div>
                </div>

                {/* Liquidity bar */}
                <LiquidityBar liquidity={selectedPool.info.liquidity} />
              </>
            ) : (
              <p className="text-2xs text-text-tertiary">Unable to fetch on-chain state for this pool.</p>
            )}
          </div>

          {/* Add Liquidity */}
          <div className="rounded border border-border bg-surface p-4">
            <h3 className="text-xs font-medium text-text-secondary mb-3">Add Liquidity</h3>
            <div className="flex items-end gap-3 mb-3">
              <div className="flex-1">
                <label className="text-2xs text-text-tertiary mb-1 block">{token0Label}</label>
                <Input
                  type="text"
                  value={amount0}
                  onChange={(e) => setAmount0(e.target.value)}
                  placeholder="0.0"
                  className="font-mono"
                />
              </div>
              <div className="flex-1">
                <label className="text-2xs text-text-tertiary mb-1 block">{token1Label}</label>
                <Input
                  type="text"
                  value={amount1}
                  onChange={(e) => setAmount1(e.target.value)}
                  placeholder="0.0"
                  className="font-mono"
                />
              </div>
              <Button
                size="sm"
                onClick={handleAddLiquidity}
                disabled={addingLiquidity || !amount0 || !amount1 || !balanceInfo?.sufficient}
              >
                {addingLiquidity ? (
                  <>
                    <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <Droplets className="w-3 h-3 mr-1.5" />
                    Add Liquidity
                  </>
                )}
              </Button>
            </div>

            {/* Tick range controls */}
            <div className="flex items-center gap-3 mb-3">
              <label className="flex items-center gap-1.5 text-2xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={fullRange}
                  onChange={(e) => setFullRange(e.target.checked)}
                  className="rounded border-border"
                />
                Full Range
              </label>
              {fullRange ? (
                <span className="text-2xs text-text-tertiary">
                  tickSpacing={selectedPool.tickSpacing} (min: {-(Math.floor(887272 / selectedPool.tickSpacing) * selectedPool.tickSpacing)} / max: {Math.floor(887272 / selectedPool.tickSpacing) * selectedPool.tickSpacing})
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <div>
                    <label className="text-2xs text-text-tertiary mb-0.5 block">Tick Lower</label>
                    <Input
                      type="number"
                      value={tickLower}
                      onChange={(e) => setTickLower(e.target.value)}
                      placeholder={String(-(Math.floor(887272 / selectedPool.tickSpacing) * selectedPool.tickSpacing))}
                      className="font-mono w-32 h-7 text-xs"
                      step={selectedPool.tickSpacing}
                    />
                  </div>
                  <div>
                    <label className="text-2xs text-text-tertiary mb-0.5 block">Tick Upper</label>
                    <Input
                      type="number"
                      value={tickUpper}
                      onChange={(e) => setTickUpper(e.target.value)}
                      placeholder={String(Math.floor(887272 / selectedPool.tickSpacing) * selectedPool.tickSpacing)}
                      className="font-mono w-32 h-7 text-xs"
                      step={selectedPool.tickSpacing}
                    />
                  </div>
                  <p className="text-2xs text-text-tertiary self-end pb-1">
                    Must be multiples of {selectedPool.tickSpacing}
                  </p>
                </div>
              )}
            </div>

            {addError && (
              <div className="rounded bg-negative/10 border border-negative/20 p-2.5 text-2xs text-negative">
                {addError}
              </div>
            )}

            {addResult && (
              <div className="rounded bg-positive/10 border border-positive/20 p-2.5 text-2xs text-positive">
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Liquidity added successfully!</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-text-secondary">
                  <span className="font-mono">{addResult.txHash.slice(0, 14)}...{addResult.txHash.slice(-8)}</span>
                  <a
                    href={addResult.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline inline-flex items-center gap-0.5"
                  >
                    View on Explorer <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function LiquidityBar({ liquidity }: { liquidity: string }) {
  // Simple visual indicator — log scale fill from 0 to ~1e20
  const liq = parseFloat(liquidity) || 0
  const maxLog = 20 // log10(1e20)
  const fillPct = liq > 0 ? Math.min(100, (Math.log10(liq) / maxLog) * 100) : 0

  return (
    <div className="w-full h-2 rounded-full bg-background overflow-hidden">
      <div
        className="h-full rounded-full bg-accent transition-all"
        style={{ width: `${fillPct}%` }}
      />
    </div>
  )
}

function formatLiquidity(liq: string): string {
  const n = parseFloat(liq)
  if (n === 0) return '0'
  if (n >= 1e18) return `${(n / 1e18).toFixed(2)}e18`
  if (n >= 1e15) return `${(n / 1e15).toFixed(2)}e15`
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}e12`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

// ============================================================================
// Hook Orders Tab
// ============================================================================

function HookOrdersTab({
  orders,
  loading,
  onRefresh,
}: {
  orders: Order[]
  loading: boolean
  onRefresh: () => void
}) {
  if (loading && orders.length === 0) {
    return (
      <div className="rounded border border-border bg-surface p-4 space-y-2">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="rounded border border-border bg-surface p-6 text-center">
        <Target className="w-8 h-8 mx-auto mb-2 text-text-tertiary" />
        <p className="text-sm text-text-secondary">No hook orders yet</p>
        <p className="text-2xs text-text-tertiary mt-1">
          Use v4.limitOrder(), v4.stopOrder(), or v4.bracketOrder() in a strategy
        </p>
      </div>
    )
  }

  return (
    <div className="rounded border border-border bg-surface overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-text-tertiary text-2xs">
            <th className="text-left py-2 px-3 font-medium">Time</th>
            <th className="text-left py-2 px-3 font-medium">Type</th>
            <th className="text-left py-2 px-3 font-medium">Side</th>
            <th className="text-left py-2 px-3 font-medium">Pair</th>
            <th className="text-right py-2 px-3 font-medium">Amount</th>
            <th className="text-right py-2 px-3 font-medium">Tick</th>
            <th className="text-center py-2 px-3 font-medium">Status</th>
            <th className="text-center py-2 px-3 font-medium">Link</th>
            <th className="text-right py-2 px-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {orders.map(order => (
            <HookOrderRow key={order.id} order={order} onRefresh={onRefresh} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HookOrderRow({ order, onRefresh }: { order: Order; onRefresh: () => void }) {
  const [cancelling, setCancelling] = useState(false)

  const pair = order.token_in_symbol && order.token_out_symbol
    ? `${order.token_in_symbol}/${order.token_out_symbol}`
    : order.asset_symbol

  const orderTypeLabel = order.order_type === 'stop' ? 'Stop' : 'Limit'
  const isLinked = !!order.linked_order_id

  const statusVariant = {
    pending: 'warning' as const,
    filled: 'positive' as const,
    cancelled: 'default' as const,
    expired: 'default' as const,
    partial: 'warning' as const,
  }[order.status] || 'default' as const

  async function handleCancel() {
    setCancelling(true)
    try {
      await ordersApi.cancel(order.id)
      onRefresh()
    } catch {
      // ignore
    } finally {
      setCancelling(false)
    }
  }

  const time = order.created_at
    ? new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'

  return (
    <tr className="border-b border-border/50 hover:bg-background/50 transition-colors">
      <td className="py-2 px-3 text-text-secondary font-mono">{time}</td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-1">
          <span>{orderTypeLabel}</span>
          {isLinked && (
            <Badge variant="default" className="text-2xs px-1 py-0">OCO</Badge>
          )}
        </div>
      </td>
      <td className="py-2 px-3">
        <Badge variant={order.side === 'buy' ? 'positive' : 'negative'} className="text-2xs">
          {order.side.toUpperCase()}
        </Badge>
      </td>
      <td className="py-2 px-3 font-medium">{pair}</td>
      <td className="py-2 px-3 text-right font-mono">
        {order.token_in_amount || order.quantity}
      </td>
      <td className="py-2 px-3 text-right font-mono text-text-secondary">
        {order.tick ?? '—'}
      </td>
      <td className="py-2 px-3 text-center">
        <Badge variant={statusVariant} className="text-2xs">
          {order.status}
        </Badge>
      </td>
      <td className="py-2 px-3 text-center">
        {order.tx_hash ? (
          <a
            href={`${EXPLORER_BASE}/tx/${order.tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-tertiary hover:text-accent"
          >
            <ExternalLink className="w-3 h-3 inline" />
          </a>
        ) : '—'}
      </td>
      <td className="py-2 px-3 text-right">
        {order.status === 'pending' && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-text-tertiary hover:text-negative transition-colors disabled:opacity-50"
            title="Cancel order"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}

// ============================================================================
// Shared components
// ============================================================================

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors flex items-center ${
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-tertiary hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

function FeaturePill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-background text-2xs text-text-secondary border border-border">
      {icon}
      {label}
    </span>
  )
}

function StatCell({ label, value, variant }: { label: string; value: string; variant?: 'positive' | 'warning' | 'negative' }) {
  const colorClass = variant === 'positive' ? 'text-positive' : variant === 'warning' ? 'text-warning' : variant === 'negative' ? 'text-negative' : 'text-text-primary'
  return (
    <div>
      <div className="text-text-tertiary text-2xs">{label}</div>
      <div className={`font-medium ${colorClass}`}>{value}</div>
    </div>
  )
}

function LoadingCard() {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex items-center gap-3 mb-3">
        <Skeleton className="w-5 h-5 rounded" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
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
      <span className="text-text-tertiary w-14">{label}:</span>
      <code className="font-mono text-text-secondary">{address}</code>
      <button
        className="text-text-tertiary hover:text-text-secondary"
        onClick={() => onCopy(address, label)}
      >
        {copied === label ? <Check className="w-3 h-3 text-positive" /> : <Copy className="w-3 h-3" />}
      </button>
      <a
        href={`${EXPLORER_BASE}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-text-tertiary hover:text-accent"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  )
}
