import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/components/ui/utils'

type DocSection = {
  title: string
  id: string
  items: { label: string; id: string }[]
}

const sections: DocSection[] = [
  {
    title: 'Getting Started',
    id: 'getting-started',
    items: [
      { label: 'Overview', id: 'overview' },
      { label: 'Quick Start', id: 'quick-start' },
      { label: 'SDK Object', id: 'sdk-object' },
    ],
  },
  {
    title: 'Networks',
    id: 'networks',
    items: [
      { label: 'dt.ethereum', id: 'ethereum' },
      { label: 'dt.base', id: 'base' },
      { label: 'dt.sepolia', id: 'sepolia' },
      { label: 'dt.baseSepolia', id: 'base-sepolia' },
    ],
  },
  {
    title: 'DEX Protocols',
    id: 'dex',
    items: [
      { label: 'Uniswap V3', id: 'uniswap-v3' },
      { label: 'Uniswap V4', id: 'uniswap-v4' },
      { label: '1inch', id: 'one-inch' },
    ],
  },
  {
    title: 'CEX',
    id: 'cex',
    items: [{ label: 'Binance Spot', id: 'binance-spot' }],
  },
  {
    title: 'Oracles',
    id: 'oracles',
    items: [{ label: 'Chainlink', id: 'chainlink' }],
  },
  {
    title: 'Orders',
    id: 'orders-section',
    items: [{ label: 'Query API', id: 'orders-api' }],
  },
  {
    title: 'PnL',
    id: 'pnl-section',
    items: [{ label: 'Query API', id: 'pnl-api' }],
  },
  {
    title: 'Examples',
    id: 'examples',
    items: [
      { label: 'Simple Swap', id: 'example-swap' },
      { label: 'Cross-chain Arb', id: 'example-arb' },
      { label: 'Delta Neutral', id: 'example-delta' },
      { label: 'Limit Grid', id: 'example-grid' },
    ],
  },
]

export function DocsPage() {
  const [activeItem, setActiveItem] = useState('overview')

  return (
    <div className="flex gap-4 h-[calc(100vh-88px)]">
      {/* Sidebar Navigation */}
      <nav className="w-[200px] shrink-0">
        <ScrollArea className="h-full">
          <div className="space-y-4 pr-3">
            {sections.map((section) => (
              <div key={section.id}>
                <h4 className="text-2xs font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                  {section.title}
                </h4>
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => setActiveItem(item.id)}
                        className={cn(
                          'text-xs w-full text-left py-0.5 transition-colors',
                          activeItem === item.id
                            ? 'text-accent font-medium'
                            : 'text-text-secondary hover:text-foreground'
                        )}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>
      </nav>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-2xl space-y-6 pb-12">
          <DocContent activeItem={activeItem} />
        </div>
      </ScrollArea>
    </div>
  )
}

function DocContent({ activeItem }: { activeItem: string }) {
  switch (activeItem) {
    case 'overview':
      return (
        <>
          <DocHeader title="Overview" />
          <p className="text-xs text-text-secondary leading-relaxed">
            The <Code>dt</Code> object is the main interface for interacting with the MegaQuant
            trading engine. It provides access to DEX protocols, CEX exchanges, oracle price feeds,
            and read-only order/PnL query interfaces.
          </p>
          <p className="text-xs text-text-secondary leading-relaxed">
            <strong>Design principle:</strong> All order/trade recording happens INSIDE the wrapped
            protocol functions. You never call <Code>orders.place()</Code> -- just call the protocol
            action and everything is recorded automatically. <Code>dt.orders</Code> and{' '}
            <Code>dt.pnl</Code> are READ-ONLY query interfaces.
          </p>
          <CodeBlock
            title="Auto-Recording Flow"
            code={`// When you call:
dt.ethereum.uniswapV3.swap({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' })

// Internally:
// 1. Get quote (capture expected_output)
// 2. Execute swap on-chain (capture actual_output, execution_price)
// 3. recordTrade() -> inserts into trades table with slippage data
// 4. PnlEngine.processTrade() -> updates positions, calculates realized PnL
// 5. Return result to you`}
          />
        </>
      )
    case 'quick-start':
      return (
        <>
          <DocHeader title="Quick Start" />
          <CodeBlock
            title="Hello World Strategy"
            code={`async function execute(dt) {
  // Get ETH/USDC price
  const quote = await dt.ethereum.uniswapV3.getQuote({
    tokenIn: 'WETH',
    tokenOut: 'USDC',
    amountIn: '1.0'
  })
  console.log('ETH price:', quote.exchangeRate, 'USDC')

  // Swap 0.1 ETH for USDC
  const result = await dt.ethereum.uniswapV3.swap({
    tokenIn: 'WETH',
    tokenOut: 'USDC',
    amountIn: '0.1'
  })
  console.log('Received:', result.amountOut, 'USDC')
  console.log('Tx:', result.transactionHash)

  // Close execution and capture final inventory
  await dt.close()
}`}
          />
        </>
      )
    case 'uniswap-v3':
      return (
        <>
          <DocHeader title="Uniswap V3" subtitle="dt.<network>.uniswapV3" />
          <ApiMethod
            name="swap"
            description="Execute a market swap on Uniswap V3. Auto-records trade with slippage data."
            params={[
              { name: 'tokenIn', type: 'string', desc: 'Input token symbol (e.g. "WETH")' },
              { name: 'tokenOut', type: 'string', desc: 'Output token symbol (e.g. "USDC")' },
              { name: 'amountIn', type: 'string', desc: 'Input amount (human-readable)' },
              { name: 'slippage', type: 'number?', desc: 'Max slippage % (default: 0.5)' },
              { name: 'deadline', type: 'number?', desc: 'Seconds from now (default: 300)' },
            ]}
            returns="SwapResult { success, transactionHash, amountOut, gasUsed, gasCostUsd }"
            example={`const result = await dt.ethereum.uniswapV3.swap({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',
  slippage: 0.5
})`}
          />
          <ApiMethod
            name="getQuote"
            description="Get a swap quote without executing. No gas cost."
            params={[
              { name: 'tokenIn', type: 'string', desc: 'Input token symbol' },
              { name: 'tokenOut', type: 'string', desc: 'Output token symbol' },
              { name: 'amountIn', type: 'string', desc: 'Input amount' },
            ]}
            returns="QuoteResult { amountOut, amountOutMin, priceImpact, exchangeRate }"
            example={`const quote = await dt.ethereum.uniswapV3.getQuote({
  tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0'
})`}
          />
        </>
      )
    case 'uniswap-v4':
      return (
        <>
          <DocHeader title="Uniswap V4" subtitle="dt.<network>.uniswapV4" />
          <p className="text-xs text-text-secondary leading-relaxed">
            Uniswap V4 with MegaQuantHook integration. Supports volatility-adjusted fees and
            on-chain limit orders.
          </p>
          <ApiMethod
            name="swap"
            description="Execute a swap via MegaQuantRouter. Fee is dynamically adjusted based on pool volatility."
            params={[
              { name: 'tokenIn', type: 'string', desc: 'Input token symbol' },
              { name: 'tokenOut', type: 'string', desc: 'Output token symbol' },
              { name: 'amountIn', type: 'string', desc: 'Input amount' },
              { name: 'slippage', type: 'number?', desc: 'Max slippage %' },
            ]}
            returns="SwapResult"
            example={`const result = await dt.ethereum.uniswapV4.swap({
  tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0'
})`}
          />
          <ApiMethod
            name="limitOrder"
            description="Place a limit order at a specific tick via MegaQuantHook. Auto-records order."
            params={[
              { name: 'pair', type: 'string', desc: 'Trading pair (e.g. "ETH/USDC")' },
              { name: 'tick', type: 'number', desc: 'Target tick for order execution' },
              { name: 'amount', type: 'string', desc: 'Order amount in input token' },
              { name: 'deadline', type: 'number?', desc: 'Seconds until expiry (default: 3600)' },
            ]}
            returns="{ orderId: string, tick: number, status: string }"
            example={`const order = await dt.ethereum.uniswapV4.limitOrder({
  pair: 'ETH/USDC',
  tick: -200400,
  amount: '1000',
  deadline: 3600
})`}
          />
          <ApiMethod
            name="cancelLimitOrder"
            description="Cancel a pending limit order."
            params={[{ name: 'orderId', type: 'string', desc: 'Order ID to cancel' }]}
            returns="{ success: boolean }"
            example={`await dt.ethereum.uniswapV4.cancelLimitOrder(orderId)`}
          />
          <ApiMethod
            name="getVolatilityFee"
            description="Read the current volatility-adjusted fee for a pool."
            params={[{ name: 'poolId', type: 'string', desc: 'Pool identifier' }]}
            returns="number (fee in basis points)"
            example={`const fee = await dt.ethereum.uniswapV4.getVolatilityFee(poolId)
console.log('Current fee:', fee, 'bps')`}
          />
        </>
      )
    case 'binance-spot':
      return (
        <>
          <DocHeader title="Binance Spot" subtitle="dt.binance.spot" />
          <ApiMethod
            name="getPrice"
            description="Get current price for a trading pair."
            params={[{ name: 'pair', type: 'string', desc: 'Trading pair (e.g. "ETHUSDT")' }]}
            returns="{ price: string, timestamp: number }"
            example={`const { price } = await dt.binance.spot.getPrice('ETHUSDT')`}
          />
          <ApiMethod
            name="buy"
            description="Place a buy order. Auto-records order."
            params={[
              { name: 'symbol', type: 'string', desc: 'Trading pair' },
              { name: 'type', type: 'string', desc: '"LIMIT" or "MARKET"' },
              { name: 'price', type: 'string?', desc: 'Price (required for LIMIT)' },
              { name: 'quantity', type: 'string', desc: 'Order quantity' },
            ]}
            returns="{ orderId: string, status: string, fills: array }"
            example={`await dt.binance.spot.buy({
  symbol: 'ETHUSDT', type: 'LIMIT', price: '3100', quantity: '0.5'
})`}
          />
          <ApiMethod
            name="sell"
            description="Place a sell order. Auto-records order."
            params={[
              { name: 'symbol', type: 'string', desc: 'Trading pair' },
              { name: 'type', type: 'string', desc: '"LIMIT" or "MARKET"' },
              { name: 'quantity', type: 'string', desc: 'Order quantity' },
            ]}
            returns="{ orderId: string, status: string }"
            example={`await dt.binance.spot.sell({
  symbol: 'ETHUSDT', type: 'MARKET', quantity: '0.5'
})`}
          />
        </>
      )
    case 'orders-api':
      return (
        <>
          <DocHeader title="Orders (Read-Only)" subtitle="dt.orders" />
          <p className="text-xs text-text-secondary leading-relaxed mb-4">
            Orders are auto-recorded by protocol actions. These are query helpers.
          </p>
          <ApiMethod
            name="getAll"
            description="Get all trades and orders for the current strategy."
            params={[]}
            returns="Order[]"
            example={`const orders = await dt.orders.getAll()`}
          />
          <ApiMethod
            name="getPending"
            description="Get unfilled limit orders (V4 hook + Binance)."
            params={[]}
            returns="Order[]"
            example={`const pending = await dt.orders.getPending()`}
          />
          <ApiMethod
            name="getHistory"
            description="Get completed/filled trades."
            params={[]}
            returns="Order[]"
            example={`const history = await dt.orders.getHistory()`}
          />
          <ApiMethod
            name="getByAsset"
            description="Filter orders by asset symbol."
            params={[{ name: 'symbol', type: 'string', desc: 'Asset symbol (e.g. "ETH")' }]}
            returns="Order[]"
            example={`const ethOrders = await dt.orders.getByAsset('ETH')`}
          />
        </>
      )
    case 'pnl-api':
      return (
        <>
          <DocHeader title="PnL (Read-Only)" subtitle="dt.pnl" />
          <p className="text-xs text-text-secondary leading-relaxed mb-4">
            PnL is auto-calculated per strategy. These are query helpers.
          </p>
          <ApiMethod
            name="getHourly"
            description="Get hourly PnL snapshots."
            params={[{ name: 'hours', type: 'number?', desc: 'Number of hours (default: 24)' }]}
            returns="PnlSnapshot[]"
            example={`const hourly = await dt.pnl.getHourly(24)`}
          />
          <ApiMethod
            name="getTotal"
            description="Get total realized + unrealized PnL."
            params={[]}
            returns="{ realized_pnl, unrealized_pnl, total_pnl, total_value }"
            example={`const total = await dt.pnl.getTotal()`}
          />
          <ApiMethod
            name="getPositions"
            description="Get current open positions with mark-to-market."
            params={[]}
            returns="Position[]"
            example={`const positions = await dt.pnl.getPositions()`}
          />
          <ApiMethod
            name="getRealized"
            description="Get realized PnL from closed positions."
            params={[]}
            returns="{ realized_pnl: number }"
            example={`const { realized_pnl } = await dt.pnl.getRealized()`}
          />
        </>
      )
    case 'example-swap':
      return (
        <>
          <DocHeader title="Example: Simple Swap" />
          <CodeBlock
            title="Swap ETH for USDC on multiple DEXs"
            code={`async function execute(dt) {
  // Compare prices across DEXs
  const [v3Quote, v4Quote, inchQuote] = await Promise.all([
    dt.ethereum.uniswapV3.getQuote({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' }),
    dt.ethereum.uniswapV4.getQuote({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' }),
    dt.ethereum.oneInch.getQuote({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' }),
  ])

  console.log('V3:', v3Quote.amountOut, 'USDC')
  console.log('V4:', v4Quote.amountOut, 'USDC')
  console.log('1inch:', inchQuote.amountOut, 'USDC')

  // Execute on the best DEX
  const best = [
    { name: 'V3', quote: v3Quote, proto: dt.ethereum.uniswapV3 },
    { name: 'V4', quote: v4Quote, proto: dt.ethereum.uniswapV4 },
    { name: '1inch', quote: inchQuote, proto: dt.ethereum.oneInch },
  ].sort((a, b) => parseFloat(b.quote.amountOut) - parseFloat(a.quote.amountOut))[0]

  console.log('Best price:', best.name, best.quote.amountOut, 'USDC')

  const result = await best.proto.swap({
    tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0'
  })

  console.log('Executed on', best.name, '- Received:', result.amountOut)
  await dt.close()
}`}
          />
        </>
      )
    case 'example-arb':
      return (
        <>
          <DocHeader title="Example: Cross-Chain Arbitrage" />
          <CodeBlock
            title="ETH/USDC arbitrage between Ethereum and Base"
            code={`async function execute(dt) {
  // Check price on Ethereum (Uniswap V3)
  const ethQuote = await dt.ethereum.uniswapV3.getQuote({
    tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0'
  })

  // Check price on Base (Uniswap V3)
  const baseQuote = await dt.base.uniswapV3.getQuote({
    tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0'
  })

  const ethPrice = parseFloat(ethQuote.amountOut)
  const basePrice = parseFloat(baseQuote.amountOut)
  const spread = Math.abs(ethPrice - basePrice) / Math.min(ethPrice, basePrice) * 100

  console.log('ETH Mainnet:', ethPrice, 'USDC')
  console.log('Base:', basePrice, 'USDC')
  console.log('Spread:', spread.toFixed(3), '%')

  // Execute arb if spread > 0.5%
  if (spread > 0.5) {
    if (ethPrice > basePrice) {
      // Buy on Base (cheap), sell on Ethereum (expensive)
      await dt.base.uniswapV3.swap({ tokenIn: 'USDC', tokenOut: 'WETH', amountIn: '1000' })
      await dt.ethereum.uniswapV3.swap({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '0.5' })
    } else {
      // Buy on Ethereum, sell on Base
      await dt.ethereum.uniswapV3.swap({ tokenIn: 'USDC', tokenOut: 'WETH', amountIn: '1000' })
      await dt.base.uniswapV3.swap({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '0.5' })
    }
    console.log('Arb executed!')
  }

  await dt.close()
}`}
          />
        </>
      )
    default:
      return (
        <>
          <DocHeader title="Select a topic" />
          <p className="text-xs text-text-secondary">Choose a section from the sidebar.</p>
        </>
      )
  }
}

// Helper components

function DocHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-border pb-3 mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && <code className="text-xs text-accent font-mono">{subtitle}</code>}
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-accent bg-surface-hover px-1 py-0.5 rounded text-2xs">
      {children}
    </code>
  )
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded border border-border bg-surface overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border bg-surface-hover">
        <span className="text-2xs text-text-tertiary">{title}</span>
      </div>
      <pre className="font-mono text-2xs text-text-secondary p-3 overflow-x-auto leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

function ApiMethod({
  name,
  description,
  params,
  returns,
  example,
}: {
  name: string
  description: string
  params: { name: string; type: string; desc: string }[]
  returns: string
  example: string
}) {
  return (
    <div className="rounded border border-border bg-surface p-4 space-y-3">
      <div>
        <h3 className="text-sm font-mono font-semibold text-accent">.{name}()</h3>
        <p className="text-xs text-text-secondary mt-0.5">{description}</p>
      </div>

      {params.length > 0 && (
        <div>
          <h4 className="text-2xs font-semibold text-text-tertiary uppercase mb-1">Parameters</h4>
          <div className="space-y-1">
            {params.map((p) => (
              <div key={p.name} className="flex gap-2 text-2xs">
                <code className="font-mono text-accent shrink-0">{p.name}</code>
                <span className="text-text-tertiary shrink-0">{p.type}</span>
                <span className="text-text-secondary">{p.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-2xs font-semibold text-text-tertiary uppercase mb-1">Returns</h4>
        <code className="text-2xs font-mono text-text-secondary">{returns}</code>
      </div>

      <pre className="font-mono text-2xs text-text-secondary bg-background p-2.5 rounded overflow-x-auto">
        {example}
      </pre>
    </div>
  )
}
