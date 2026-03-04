import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'
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
      { label: 'Testnet Setup', id: 'testnet-guide' },
    ],
  },
  {
    title: 'Networks',
    id: 'networks',
    items: [
      { label: 'dt.ethereum', id: 'net-ethereum' },
      { label: 'dt.base', id: 'net-base' },
      { label: 'dt.unichain', id: 'net-unichain' },
      { label: 'dt.sepolia', id: 'net-sepolia' },
      { label: "dt['base-sepolia']", id: 'net-base-sepolia' },
      { label: "dt['unichain-sepolia']", id: 'net-unichain-sepolia' },
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
    items: [
      { label: 'Binance Spot', id: 'binance-spot' },
      { label: 'Binance Futures', id: 'binance-futures' },
      { label: 'Binance Options', id: 'binance-options' },
    ],
  },
  {
    title: 'DeFi Lending',
    id: 'lending',
    items: [{ label: 'Aave V3', id: 'aave-v3' }],
  },
  {
    title: 'Oracles',
    id: 'oracles',
    items: [{ label: 'Chainlink', id: 'chainlink' }],
  },
  {
    title: 'Order Lifecycle',
    id: 'order-lifecycle',
    items: [
      { label: 'DEX Orders', id: 'order-dex' },
      { label: 'CEX Orders', id: 'order-cex' },
      { label: 'V4 Hook Orders', id: 'order-hook' },
      { label: 'Comparison', id: 'order-comparison' },
    ],
  },
  {
    title: 'V4 Hooks',
    id: 'v4-hooks',
    items: [
      { label: 'Architecture', id: 'v4-architecture' },
      { label: 'Limit Orders', id: 'v4-limit-orders' },
      { label: 'Claim Tokens', id: 'v4-claim-tokens' },
      { label: 'Deployment', id: 'v4-deployment' },
    ],
  },
  {
    title: 'Orders',
    id: 'orders-section',
    items: [{ label: 'Query API', id: 'orders-api' }],
  },
  {
    title: 'PnL',
    id: 'pnl-section',
    items: [
      { label: 'How It Works', id: 'pnl-how' },
      { label: 'Query API', id: 'pnl-api' },
      { label: 'Multi-Instrument PnL', id: 'pnl-multi-instrument' },
    ],
  },
  {
    title: 'Examples',
    id: 'examples',
    items: [
      { label: 'Simple Swap', id: 'example-swap' },
      { label: 'Cross-chain Arb', id: 'example-arb' },
      { label: 'Delta Neutral', id: 'example-delta' },
      { label: 'Limit Grid', id: 'example-grid' },
      { label: 'Sepolia Test', id: 'example-sepolia' },
      { label: 'Base Sepolia Test', id: 'example-base-sepolia' },
      { label: 'Unichain Test', id: 'example-unichain' },
      { label: 'Binance Test', id: 'example-binance' },
      { label: 'Multi-Venue', id: 'example-multi-venue' },
      { label: 'Perps Strategy', id: 'example-perps' },
      { label: 'Options Strategy', id: 'example-options' },
      { label: 'Lending Strategy', id: 'example-lending' },
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
    // ================================================================
    // GETTING STARTED
    // ================================================================
    case 'overview':
      return (
        <>
          <DocHeader title="Overview" />
          <p className="text-xs text-text-secondary leading-relaxed">
            MEGA QUANT lets TradFi quants write strategies using a simple SDK pattern:{' '}
            <Code>network.protocol.action(params)</Code>. The <Code>dt</Code> object is your gateway
            to every venue — DEX protocols, CEX exchanges, oracle feeds, and order/PnL queries.
          </p>
          <p className="text-xs text-text-secondary leading-relaxed">
            <strong>Design principle:</strong> All order/trade recording happens INSIDE the wrapped
            protocol functions. You never call <Code>orders.place()</Code> — just call the protocol
            action and everything is recorded automatically. <Code>dt.orders</Code> and{' '}
            <Code>dt.pnl</Code> are READ-ONLY query interfaces.
          </p>
          <CodeBlock
            title="The SDK Pattern: network.protocol.action(params)"
            code={`// DEX swap on Ethereum via Uniswap V3
await dt.ethereum.uniswapV3.swap({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' })

// DEX swap on Base via Uniswap V4
await dt.base.uniswapV4.swap({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' })

// CEX spot order on Binance
await dt.binance.buy({ symbol: 'ETHUSDT', type: 'MARKET', quantity: 0.01 })

// Perpetual futures (leveraged)
await dt.binanceFutures.openLong({ symbol: 'ETHUSDT', quantity: 1, leverage: 10 })

// Options trading
await dt.binanceOptions.buyCall({ underlying: 'ETH', strikePrice: 4000, expiry: '2026-03-28', contracts: 5 })

// DeFi lending (Aave V3)
await dt.base.aave.supply({ asset: usdcAddress, assetSymbol: 'USDC', amount: '10000' })

// Oracle price feed
const price = await dt.ethereum.chainlink.getPrice('ETH/USD')`}
          />
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
          <DocTable
            headers={['DeFi Term', 'TradFi Equivalent', 'Description']}
            rows={[
              ['Gas fee', 'Exchange tx fee', 'Cost to execute on-chain, paid in ETH'],
              ['Block confirmation', 'Settlement (T+0)', '~12-24s on L1, ~2s on L2'],
              ['Slippage', 'Market impact', 'Price moves between quote and execution'],
              ['AMM pool', 'Market maker', 'Algorithmic liquidity at all prices'],
              ['Private key', 'Account credentials', 'Cryptographic ownership proof — never shared'],
              ['Testnet', 'Paper trading', 'Identical blockchain with fake tokens, zero risk'],
            ]}
          />
        </>
      )

    case 'quick-start':
      return (
        <>
          <DocHeader title="Quick Start" subtitle="From zero to first trade in 7 steps" />
          <p className="text-xs text-text-secondary leading-relaxed mb-4">
            This guide walks you through the full journey: creating a wallet, funding it with
            testnet tokens, writing a strategy, and executing your first trade — all on testnets
            with zero financial risk.
          </p>

          <h3 className="text-sm font-semibold mt-6 mb-2">Step 1: Set Master Password</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            When you first open the app, you'll be prompted to set a <strong>master password</strong>.
            This encrypts all wallet private keys and API credentials stored locally. Choose a strong
            password — there is no recovery if you forget it.
          </p>

          <h3 className="text-sm font-semibold mt-6 mb-2">Step 2: Create HD Wallet</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            Navigate to <strong>Settings → Wallets → Create HD Wallet</strong>. This generates a
            hierarchical deterministic wallet (like a prime brokerage master account in TradFi).
          </p>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Click <strong>Derive Account #0</strong> to create your first trading address. The address
            is automatically copied to your clipboard — you'll need it for faucets.
          </p>

          <h3 className="text-sm font-semibold mt-6 mb-2">Step 3: Fund Your Wallet</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            You need both <strong>ETH</strong> (for gas/transaction fees) and <strong>USDC or WETH</strong> (for trading).
            Use the faucets below to get free testnet tokens:
          </p>
          <DocTable
            headers={['Network', 'ETH Faucet', 'Token Faucet']}
            rows={[
              ['Sepolia', 'cloud.google.com/application/web3/faucet/ethereum/sepolia (0.05 ETH/day)', 'faucet.circle.com → Ethereum Sepolia (10 USDC)'],
              ['Base Sepolia', 'alchemy.com/faucets/base-sepolia', 'faucet.circle.com → Base Sepolia (10 USDC)'],
              ['Unichain Sepolia', 'Bridge Sepolia ETH via superbridge.app', 'Limited — test with WETH pairs'],
              ['Binance Testnet (CEX)', 'testnet.binance.vision → Login with GitHub', 'Pre-loaded with virtual BTC, ETH, BNB, USDT, etc.'],
            ]}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Step 4: Configure API Keys (optional)</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            Go to <strong>Settings → API Keys</strong> to configure:
          </p>
          <ul className="text-xs text-text-secondary leading-relaxed mb-3 list-disc list-inside space-y-1">
            <li><strong>Binance Testnet:</strong> API Key + Secret from testnet.binance.vision (click "Generate HMAC_SHA256 Key")</li>
            <li><strong>Alchemy API Key:</strong> Optional — provides faster/more reliable RPC connections</li>
          </ul>

          <h3 className="text-sm font-semibold mt-6 mb-2">Step 5: Create Strategy & Assign Accounts</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            Create a new strategy, then go to the <strong>Accounts</strong> tab:
          </p>
          <ul className="text-xs text-text-secondary leading-relaxed mb-3 list-disc list-inside space-y-1">
            <li>Assign your wallet account to target networks (Sepolia, Base Sepolia, etc.)</li>
            <li>For Binance: assign your CEX account</li>
            <li>Only chains with assigned accounts appear on the <Code>dt</Code> object</li>
          </ul>

          <h3 className="text-sm font-semibold mt-6 mb-2">Step 6: Paste & Run Test Code</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            Copy the strategy below, paste it into your strategy code editor, and click <strong>Run</strong>.
            This runs a continuous buy-low-sell-high loop across all your testnet DEXes and Binance:
          </p>
          <CodeBlock
            title="Multi-Network Trading Loop — paste this and click Run"
            code={`async function execute(dt) {
  const chains = dt.getConfiguredChains()
  console.log('Configured chains:', chains)
  console.log('Binance:', dt.binance ? 'Connected' : 'Not connected')

  // --- DEX: Wrap ETH to WETH on Sepolia (needed for Uniswap swaps) ---
  if (dt.sepolia) {
    try {
      console.log('\\n[Sepolia] Wrapping 0.002 ETH -> WETH...')
      const wrapTx = await dt.sepolia.wrapETH('0.002')
      console.log('[Sepolia] Wrap complete:', dt.sepolia.txLink(wrapTx))
    } catch (e) {
      console.log('[Sepolia] Wrap failed:', e.message)
    }
  }

  let tick = 0
  while (true) {
    await checkPause()
    tick++
    console.log('\\n========== Tick', tick, 'at', new Date().toLocaleTimeString(), '==========')

    // --- Sepolia DEX: alternate buy/sell each tick ---
    if (dt.sepolia && dt.sepolia.uniswapV3) {
      try {
        if (tick % 2 === 1) {
          // Check WETH balance before selling
          const wethAddr = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
          const wethBal = await dt.sepolia.getTokenBalance(wethAddr)
          const sellAmt = '0.001'
          if (parseFloat(wethBal) >= parseFloat(sellAmt)) {
            console.log('[Sepolia] Selling', sellAmt, 'WETH -> USDC...')
            const r = await dt.sepolia.uniswapV3.swap({
              tokenIn: 'WETH', tokenOut: 'USDC', amountIn: sellAmt
            })
            console.log('[Sepolia] Got', r.amountOut, 'USDC |', r.explorerUrl)
          } else {
            console.log('[Sepolia] Skipping sell — WETH balance', wethBal, '< ', sellAmt)
          }
        } else {
          console.log('[Sepolia] Buying WETH with 1 USDC...')
          const r = await dt.sepolia.uniswapV3.swap({
            tokenIn: 'USDC', tokenOut: 'WETH', amountIn: '1'
          })
          console.log('[Sepolia] Got', r.amountOut, 'WETH |', r.explorerUrl)
        }
      } catch (e) {
        console.log('[Sepolia] Trade failed:', e.message)
      }
    }

    // --- Binance CEX: alternate buy/sell ETHUSDT ---
    if (dt.binance) {
      try {
        if (tick % 2 === 1) {
          console.log('[Binance] Market BUY 0.01 ETH...')
          const r = await dt.binance.buy({
            symbol: 'ETHUSDT', type: 'MARKET', quantity: 0.01
          })
          console.log('[Binance] Bought', r.executedQty, 'ETH @', (parseFloat(r.cummulativeQuoteQty) / parseFloat(r.executedQty)).toFixed(2), '| Order:', r.orderId)
        } else {
          console.log('[Binance] Market SELL 0.01 ETH...')
          const r = await dt.binance.sell({
            symbol: 'ETHUSDT', type: 'MARKET', quantity: 0.01
          })
          console.log('[Binance] Sold', r.executedQty, 'ETH @', (parseFloat(r.cummulativeQuoteQty) / parseFloat(r.executedQty)).toFixed(2), '| Order:', r.orderId)
        }
      } catch (e) {
        console.log('[Binance] Trade failed:', e.message)
      }
    }

    // --- Binance CEX: BTC/USDT every 3rd tick ---
    if (dt.binance && tick % 3 === 0) {
      try {
        console.log('[Binance] Market BUY 0.001 BTC...')
        const r = await dt.binance.buy({
          symbol: 'BTCUSDT', type: 'MARKET', quantity: 0.001
        })
        console.log('[Binance] Bought', r.executedQty, 'BTC @', (parseFloat(r.cummulativeQuoteQty) / parseFloat(r.executedQty)).toFixed(2), '| Order:', r.orderId)
      } catch (e) {
        console.log('[Binance] BTC trade failed:', e.message)
      }
    }

    console.log('--- Sleeping 5s ---')
    await sleep(5000)
  }
}`}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Step 7: Check Logs</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            After running, your console should show output like this:
          </p>
          <CodeBlock
            title="Expected Console Output"
            code={`Configured chains: ['sepolia', 'base-sepolia', 'unichain-sepolia']
Binance: Connected
[Sepolia] Wrapping 0.002 ETH -> WETH...
[Sepolia] Wrap complete: https://sepolia.etherscan.io/tx/0xabc123...

========== Tick 1 at 2:08:15 PM ==========
[Sepolia] Selling 0.001 WETH -> USDC...
[Sepolia] Got 7.89 USDC | https://sepolia.etherscan.io/tx/0xdef456...
[Binance] Market BUY 0.01 ETH...
[Binance] Bought 0.01 ETH @ 1968.50 | Order: 12345678
--- Sleeping 5s ---`}
          />
          <ul className="text-xs text-text-secondary leading-relaxed mt-2 list-disc list-inside space-y-1">
            <li><strong>DEX:</strong> Click the explorer URL to verify the transaction on-chain</li>
            <li><strong>CEX:</strong> Shows filled quantity, price, and Binance order ID</li>
            <li><strong>Helpers:</strong> Use <Code>chain.txLink(hash)</Code> or <Code>result.explorerUrl</Code> for explorer links</li>
          </ul>
          <p className="text-xs text-text-secondary leading-relaxed mt-3">
            Once this works, explore the <strong>Examples</strong> section for more strategies including
            cross-chain arbitrage, delta-neutral hedging, and CEX trading.
          </p>
        </>
      )

    case 'sdk-object':
      return (
        <>
          <DocHeader title="SDK Object" subtitle="dt" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            The <Code>dt</Code> object is the complete trading interface passed to every strategy.
            It follows the pattern <Code>dt.network.protocol.action(params)</Code> for on-chain
            execution and <Code>dt.binance.action(params)</Code> for CEX execution.
          </p>
          <CodeBlock
            title="dt Object Structure"
            code={`dt
├── ethereum          // Ethereum Mainnet (Chain ID: 1)
│   ├── uniswapV3     //   .swap(), .getQuote()
│   ├── uniswapV4     //   .swap(), .limitOrder(), .cancelLimitOrder()
│   ├── oneInch       //   .swap(), .getQuote()
│   ├── chainlink     //   .getPrice()
│   └── aave          //   .supply(), .withdraw(), .borrow(), .repay()
├── base              // Base (Chain ID: 8453)
│   ├── (same DEX protocols)
│   └── aave          //   Aave V3 lending
├── unichain          // Unichain (Chain ID: 130)
│   └── (DEX protocols only)
├── sepolia           // Ethereum Sepolia testnet (Chain ID: 11155111)
│   ├── (same DEX protocols)
│   └── aave          //   Aave V3 testnet
├── ['base-sepolia']  // Base Sepolia testnet (Chain ID: 84532)
│   └── (DEX protocols)
├── ['unichain-sepolia'] // Unichain Sepolia testnet (Chain ID: 1301)
│   └── (DEX protocols)
├── binance           // Binance Spot (CEX)
│   ├── .getPrice(), .getOrderBook()
│   ├── .buy(), .sell()
│   └── .cancelOrder(), .getOpenOrders()
├── binanceFutures    // Binance USDM Perpetual Futures
│   ├── .openLong(), .closeLong()
│   ├── .openShort(), .closeShort()
│   ├── .setLeverage(), .setMarginType()
│   └── .getPositions(), .getMarkPrice()
├── binanceOptions    // Binance European Options
│   ├── .buyCall(), .sellCall()
│   ├── .buyPut(), .sellPut()
│   └── .getMarkPrice(), .getPositions()
├── orders            // Read-only order queries
│   └── .getAll(), .getPending(), .getHistory(), .getByAsset()
├── pnl               // Read-only PnL queries (spot FIFO)
│   └── .getHourly(), .getTotal(), .getPositions(), .getRealized()
├── getConfiguredChains()  // List which chains have accounts assigned
└── close()                // End execution, capture final inventory`}
          />
          <p className="text-xs text-text-secondary leading-relaxed">
            <strong>Important:</strong> Only chains with assigned accounts appear on <Code>dt</Code>.
            If you haven't assigned an account to Sepolia in the Accounts tab,{' '}
            <Code>dt.sepolia</Code> will be <Code>undefined</Code>. Always check before using.
          </p>
          <CodeBlock
            title="Checking Available Chains & Venues"
            code={`async function execute(dt) {
  const chains = dt.getConfiguredChains()
  console.log('Available chains:', chains) // e.g. ['sepolia', 'base']

  if (dt.sepolia) await dt.sepolia.uniswapV3.swap(...)
  if (dt.binance) await dt.binance.getPrice('ETHUSDT')
  if (dt.binanceFutures) await dt.binanceFutures.getMarkPrice('ETHUSDT')
  if (dt.binanceOptions) await dt.binanceOptions.getMarkPrice('ETH-260328-4000-C')
  if (dt.base?.aave) await dt.base.aave.getUserAccountData()
}`}
          />
        </>
      )

    case 'testnet-guide':
      return (
        <>
          <DocHeader title="Testnet Setup" subtitle="Paper trading with real blockchain infrastructure" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Testnets are the blockchain equivalent of <strong>paper trading</strong> — identical
            infrastructure with fake tokens, zero financial risk. Use them to validate strategies
            before going live.
          </p>

          <h3 className="text-sm font-semibold mt-6 mb-2">Ethereum Sepolia (Chain ID: 11155111)</h3>
          <DocTable
            headers={['Resource', 'URL', 'Notes']}
            rows={[
              ['Google Cloud Faucet', 'cloud.google.com/application/web3/faucet/ethereum/sepolia', '0.05 ETH/day, no auth'],
              ['Alchemy Faucet', 'alchemy.com/faucets/ethereum-sepolia', 'Free Alchemy account'],
              ['PoW Faucet', 'sepolia-faucet.pk910.de', 'Unlimited (mine it)'],
              ['USDC (Circle)', 'faucet.circle.com → Ethereum Sepolia', '10 USDC per request'],
            ]}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Base Sepolia (Chain ID: 84532)</h3>
          <DocTable
            headers={['Resource', 'URL', 'Notes']}
            rows={[
              ['Alchemy Faucet', 'alchemy.com/faucets/base-sepolia', 'Free Alchemy account'],
              ['Superbridge', 'superbridge.app/base-sepolia', 'Bridge Sepolia ETH → Base Sepolia'],
              ['USDC (Circle)', 'faucet.circle.com → Base Sepolia', '10 USDC per request'],
            ]}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Unichain Sepolia (Chain ID: 1301)</h3>
          <DocTable
            headers={['Resource', 'URL', 'Notes']}
            rows={[
              ['Superbridge', 'superbridge.app', 'Bridge Sepolia ETH → Unichain Sepolia'],
            ]}
          />
          <p className="text-xs text-text-secondary leading-relaxed">
            Token availability is limited on Unichain Sepolia — primarily test with WETH/USDC pairs.
            WETH address: <Code>0x4200000000000000000000000000000000000006</Code>
          </p>

          <h3 className="text-sm font-semibold mt-6 mb-2">Binance Testnet (CEX)</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-2">
            Simulated CEX with synthetic order books, pre-loaded with virtual funds (BTC, ETH, BNB, USDT, and more). Balances are periodically reset.
          </p>
          <DocTable
            headers={['Step', 'Action']}
            rows={[
              ['1', 'Go to testnet.binance.vision'],
              ['2', 'Login with GitHub account'],
              ['3', 'Click "Generate HMAC_SHA256 Key"'],
              ['4', 'Copy both API Key and Secret Key (secret shown only once)'],
            ]}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Setup in MEGA QUANT</h3>
          <CodeBlock
            title="Step-by-Step"
            code={`1. Open app → Set master password
2. Settings → Wallets → Create HD Wallet
3. Derive Account #0 (copies your address)
4. Fund address from faucets above
5. Settings → API Keys → Enter Binance testnet API key/secret
6. Settings → API Keys → (Optional) Enter Alchemy API key for better RPC
7. Create strategy → Accounts tab → Assign account to:
   - Sepolia (11155111)
   - Base Sepolia (84532)
   - Unichain Sepolia (1301)
8. For Binance: Accounts tab → Assign Binance CEX account
9. Run test scripts from the Examples section to verify`}
          />

          <DocTable
            headers={['DeFi Term', 'TradFi Equivalent']}
            rows={[
              ['Testnet', 'Paper trading / simulation'],
              ['Faucet', 'Paper trading credit dispenser'],
              ['Bridge', 'Cross-venue transfer'],
              ['HD wallet', 'Multi-account key hierarchy (prime brokerage master account)'],
              ['Gas fee', 'Exchange transaction fee (paid in ETH)'],
              ['WETH', 'Wrapped ETH — ERC20 token form required by DeFi protocols'],
              ['Wei', '1 ETH = 10^18 wei (like 1 dollar = 100 cents, but 18 decimals)'],
            ]}
          />
        </>
      )

    // ================================================================
    // NETWORKS
    // ================================================================
    case 'net-ethereum':
      return (
        <NetworkDoc
          name="Ethereum"
          accessor="dt.ethereum"
          chainId={1}
          type="L1 Mainnet"
          settlement="~12-24 seconds"
          explorer="etherscan.io"
          native="ETH"
          protocols={['Uniswap V3', 'Uniswap V4', '1inch', 'Chainlink']}
          tokens={['WETH', 'USDC', 'USDT', 'DAI', 'WBTC']}
        />
      )
    case 'net-base':
      return (
        <NetworkDoc
          name="Base"
          accessor="dt.base"
          chainId={8453}
          type="L2 (Coinbase)"
          settlement="~2 seconds"
          explorer="basescan.org"
          native="ETH"
          protocols={['Uniswap V3', 'Uniswap V4', '1inch']}
          tokens={['WETH', 'USDC', 'USDT', 'DAI']}
          notes="L2 = faster and cheaper than Ethereum L1. Same security guarantees via rollup proofs."
        />
      )
    case 'net-unichain':
      return (
        <NetworkDoc
          name="Unichain"
          accessor="dt.unichain"
          chainId={130}
          type="L2 (Uniswap)"
          settlement="~2 seconds"
          explorer="uniscan.xyz"
          native="ETH"
          protocols={['Uniswap V3', 'Uniswap V4']}
          tokens={['WETH', 'USDC']}
          notes="Uniswap's dedicated L2 chain, optimized for DeFi trading with lower fees."
        />
      )
    case 'net-sepolia':
      return (
        <NetworkDoc
          name="Sepolia"
          accessor="dt.sepolia"
          chainId={11155111}
          type="L1 Testnet"
          settlement="~12-24 seconds"
          explorer="sepolia.etherscan.io"
          native="ETH (testnet)"
          protocols={['Uniswap V3', 'Uniswap V4']}
          tokens={['WETH', 'USDC']}
          notes="Primary Ethereum testnet. Get ETH from Google Cloud faucet, USDC from Circle faucet. See Testnet Setup."
          testnet
        />
      )
    case 'net-base-sepolia':
      return (
        <NetworkDoc
          name="Base Sepolia"
          accessor="dt['base-sepolia']"
          chainId={84532}
          type="L2 Testnet"
          settlement="~2 seconds"
          explorer="sepolia.basescan.org"
          native="ETH (testnet)"
          protocols={['Uniswap V3', 'Uniswap V4']}
          tokens={['WETH', 'USDC']}
          notes="Base testnet. Bridge Sepolia ETH via Superbridge or get from Alchemy faucet. See Testnet Setup."
          testnet
        />
      )
    case 'net-unichain-sepolia':
      return (
        <NetworkDoc
          name="Unichain Sepolia"
          accessor="dt['unichain-sepolia']"
          chainId={1301}
          type="L2 Testnet"
          settlement="~2 seconds"
          explorer="sepolia.uniscan.xyz"
          native="ETH (testnet)"
          protocols={['Uniswap V3', 'Uniswap V4']}
          tokens={['WETH', 'USDC']}
          notes="Unichain testnet. Bridge Sepolia ETH via Superbridge. Limited token availability — test with WETH/USDC."
          testnet
        />
      )

    // ================================================================
    // DEX PROTOCOLS
    // ================================================================
    case 'uniswap-v3':
      return (
        <>
          <DocHeader title="Uniswap V3" subtitle="dt.<network>.uniswapV3" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Concentrated liquidity AMM. Think of it as a <strong>continuous market maker</strong> —
            algorithmic liquidity at all prices with a fixed fee. Swaps are <strong>market orders</strong>:
            atomic, immediate, no partial fills.
          </p>
          <ApiMethod
            name="swap"
            description="Execute a market swap. Auto-records trade with slippage data. Once broadcast, CANNOT be cancelled."
            params={[
              { name: 'tokenIn', type: 'string', desc: 'Input token symbol (e.g. "WETH")' },
              { name: 'tokenOut', type: 'string', desc: 'Output token symbol (e.g. "USDC")' },
              { name: 'amountIn', type: 'string', desc: 'Input amount (human-readable)' },
              { name: 'slippage', type: 'number?', desc: 'Max slippage % (default: 0.5). Like a limit price on a market order.' },
              { name: 'deadline', type: 'number?', desc: 'Seconds from now (default: 300)' },
            ]}
            returns="SwapResult { success, transactionHash, amountOut, gasUsed, gasCostUsd, explorerUrl }"
            example={`const result = await dt.ethereum.uniswapV3.swap({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',
  slippage: 0.5
})`}
          />
          <ApiMethod
            name="getQuote"
            description="Get a swap quote without executing. No gas cost. Like an RFQ — indicative price only."
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
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Next-gen AMM with MegaQuantHook integration. Supports <strong>volatility-adjusted
            dynamic fees</strong> and <strong>on-chain limit orders</strong> (see V4 Hooks section).
          </p>
          <ApiMethod
            name="swap"
            description="Execute a swap via MegaQuantRouter. Fee is dynamically adjusted based on pool volatility (0.05% - 1.0%)."
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
            description="Place an on-chain limit order at a specific tick via MegaQuantRouter. Tokens are deposited into the hook contract and you receive ERC1155 claim tokens. The order fills automatically when another user's swap crosses your tick. See V4 Hooks > Limit Orders for details."
            params={[
              { name: 'tokenIn', type: 'string', desc: 'Input token symbol (e.g. "WETH")' },
              { name: 'tokenOut', type: 'string', desc: 'Output token symbol (e.g. "USDC")' },
              { name: 'amountIn', type: 'string', desc: 'Order amount in input token' },
              { name: 'targetPrice', type: 'string', desc: 'Target price for the order' },
              { name: 'tick', type: 'number', desc: 'Target tick (~0.01% per tick). Like a price level on an order book.' },
              { name: 'deadline', type: 'number?', desc: 'Seconds until expiry (default: 86400)' },
            ]}
            returns="{ success, orderId, txHash, tick, amountIn, targetPrice, deadline }"
            example={`const order = await dt.ethereum.uniswapV4.limitOrder({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',
  targetPrice: '2000',
  tick: -200400,
  deadline: 3600
}, megaQuantRouterAddress)
console.log('Order ID:', order.orderId, 'Tx:', order.txHash)`}
          />
          <ApiMethod
            name="cancelLimitOrder"
            description="Cancel a pending limit order and reclaim deposited tokens. Calls hook.cancelOrder directly — wallet must hold the ERC1155 claim tokens."
            params={[
              { name: 'tokenIn', type: 'string', desc: 'Input token symbol' },
              { name: 'tokenOut', type: 'string', desc: 'Output token symbol' },
              { name: 'tick', type: 'number', desc: 'Tick of the order to cancel' },
              { name: 'hookAddress', type: 'string', desc: 'MegaQuantHook contract address' },
            ]}
            returns="{ success: boolean, txHash: string }"
            example={`await dt.ethereum.uniswapV4.cancelLimitOrder('WETH', 'USDC', -200400, hookAddress)`}
          />
          <ApiMethod
            name="redeemLimitOrder"
            description="Redeem output tokens from a filled limit order. Burns ERC1155 claim tokens and sends you a pro-rata share of the output."
            params={[
              { name: 'tokenIn', type: 'string', desc: 'Original input token symbol' },
              { name: 'tokenOut', type: 'string', desc: 'Original output token symbol' },
              { name: 'tick', type: 'number', desc: 'Tick where the order was placed' },
              { name: 'amount', type: 'string', desc: 'Amount of claim tokens to redeem' },
              { name: 'hookAddress', type: 'string', desc: 'MegaQuantHook contract address' },
            ]}
            returns="{ success: boolean, txHash: string }"
            example={`await dt.ethereum.uniswapV4.redeemLimitOrder('WETH', 'USDC', -200400, '1.0', hookAddress)`}
          />
          <ApiMethod
            name="batchSwap"
            description="Execute multiple swaps in a single transaction via MegaQuantRouter. All swaps share one unlock() call, saving gas through V4's flash accounting."
            params={[
              { name: 'swaps', type: 'Array', desc: 'Array of { tokenIn, tokenOut, amountIn, fee?, hookAddress? }' },
              { name: 'routerAddress', type: 'string', desc: 'MegaQuantRouter contract address' },
            ]}
            returns="Array<{ amountIn, tokenIn, tokenOut, success }>"
            example={`const results = await dt.ethereum.uniswapV4.batchSwap([
  { tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' },
  { tokenIn: 'WETH', tokenOut: 'DAI', amountIn: '0.5' },
], megaQuantRouterAddress)`}
          />
          <ApiMethod
            name="getVolatilityFee"
            description="Read the current volatility-adjusted fee for a pool. Calls hook.getPoolFee(poolId). Fee is calculated from EWMA variance of recent tick movements (0.05% to 1.0%)."
            params={[
              { name: 'tokenA', type: 'string', desc: 'First token symbol' },
              { name: 'tokenB', type: 'string', desc: 'Second token symbol' },
              { name: 'hookAddress', type: 'string', desc: 'MegaQuantHook contract address' },
            ]}
            returns="{ fee: number, feePercentage: string }"
            example={`const { fee, feePercentage } = await dt.ethereum.uniswapV4.getVolatilityFee('WETH', 'USDC', hookAddress)
console.log('Current fee:', fee, 'bps (', feePercentage, ')')`}
          />
        </>
      )

    case 'one-inch':
      return (
        <>
          <DocHeader title="1inch" subtitle="dt.<network>.oneInch" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            DEX aggregator that finds the best swap route across multiple liquidity sources.
            Think of it as a <strong>smart order router</strong> — it splits your order across
            Uniswap, SushiSwap, Curve, and other DEXs to minimize slippage.
          </p>
          <ApiMethod
            name="swap"
            description="Execute an aggregated swap across multiple DEXs for best execution."
            params={[
              { name: 'tokenIn', type: 'string', desc: 'Input token symbol' },
              { name: 'tokenOut', type: 'string', desc: 'Output token symbol' },
              { name: 'amountIn', type: 'string', desc: 'Input amount' },
              { name: 'slippage', type: 'number?', desc: 'Max slippage %' },
            ]}
            returns="SwapResult { success, transactionHash, amountOut, gasUsed, gasCostUsd, explorerUrl }"
            example={`const result = await dt.ethereum.oneInch.swap({
  tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '10.0', slippage: 0.5
})`}
          />
          <ApiMethod
            name="getQuote"
            description="Get the best aggregated quote without executing."
            params={[
              { name: 'tokenIn', type: 'string', desc: 'Input token symbol' },
              { name: 'tokenOut', type: 'string', desc: 'Output token symbol' },
              { name: 'amountIn', type: 'string', desc: 'Input amount' },
            ]}
            returns="QuoteResult { amountOut, amountOutMin, priceImpact, exchangeRate, gasCostUsd }"
            example={`const quote = await dt.ethereum.oneInch.getQuote({
  tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '10.0'
})`}
          />
        </>
      )

    // ================================================================
    // CEX
    // ================================================================
    case 'binance-spot':
      return (
        <>
          <DocHeader title="Binance Spot" subtitle="dt.binance" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Standard centralized exchange trading. If you've traded on any exchange, this is
            familiar — market orders, limit orders, cancellations, order book queries.
            Supports both production and <strong>testnet</strong> (testnet.binance.vision).
          </p>
          <ApiMethod
            name="getPrice"
            description="Get current price for a trading pair."
            params={[{ name: 'symbol', type: 'string', desc: 'Trading pair (e.g. "ETHUSDT")' }]}
            returns="number"
            example={`const price = await dt.binance.getPrice('ETHUSDT')
console.log('ETH:', price, 'USDT')`}
          />
          <ApiMethod
            name="getOrderBook"
            description="Get order book (bids and asks) for a symbol."
            params={[
              { name: 'symbol', type: 'string', desc: 'Trading pair' },
              { name: 'limit', type: 'number?', desc: 'Depth (default: 20)' },
            ]}
            returns="{ bids: [price, qty][], asks: [price, qty][] }"
            example={`const book = await dt.binance.getOrderBook('ETHUSDT', 5)
console.log('Best bid:', book.bids[0][0])`}
          />
          <ApiMethod
            name="buy"
            description="Place a buy order. Auto-records trade."
            params={[
              { name: 'symbol', type: 'string', desc: 'Trading pair' },
              { name: 'type', type: 'string', desc: '"LIMIT" or "MARKET"' },
              { name: 'price', type: 'number?', desc: 'Price (required for LIMIT)' },
              { name: 'quantity', type: 'number', desc: 'Order quantity' },
            ]}
            returns="{ orderId, status, executedQty, cummulativeQuoteQty, fills[] }"
            example={`// Market buy
await dt.binance.buy({ symbol: 'ETHUSDT', type: 'MARKET', quantity: 0.01 })

// Limit buy
await dt.binance.buy({ symbol: 'ETHUSDT', type: 'LIMIT', price: 2000, quantity: 0.5 })`}
          />
          <ApiMethod
            name="sell"
            description="Place a sell order. Auto-records trade."
            params={[
              { name: 'symbol', type: 'string', desc: 'Trading pair' },
              { name: 'type', type: 'string', desc: '"LIMIT" or "MARKET"' },
              { name: 'price', type: 'number?', desc: 'Price (required for LIMIT)' },
              { name: 'quantity', type: 'number', desc: 'Order quantity' },
            ]}
            returns="{ orderId, status, executedQty, fills[] }"
            example={`await dt.binance.sell({ symbol: 'ETHUSDT', type: 'MARKET', quantity: 0.5 })`}
          />
          <ApiMethod
            name="cancelOrder"
            description="Cancel an open limit order."
            params={[
              { name: 'symbol', type: 'string', desc: 'Trading pair' },
              { name: 'orderId', type: 'number', desc: 'Order ID to cancel' },
            ]}
            returns="{ orderId, status }"
            example={`await dt.binance.cancelOrder('ETHUSDT', 12345)`}
          />
          <ApiMethod
            name="getOpenOrders"
            description="Get all open (resting) orders, optionally filtered by symbol."
            params={[
              { name: 'symbol', type: 'string?', desc: 'Trading pair filter' },
            ]}
            returns="Order[]"
            example={`const open = await dt.binance.getOpenOrders('ETHUSDT')
console.log('Open orders:', open.length)`}
          />
        </>
      )

    // ================================================================
    // ORACLES
    // ================================================================
    case 'chainlink':
      return (
        <>
          <DocHeader title="Chainlink" subtitle="dt.ethereum.chainlink" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Decentralized oracle network providing tamper-proof price feeds. Think of it as a{' '}
            <strong>Bloomberg terminal data feed</strong> but on-chain — multiple independent nodes
            aggregate prices from exchanges and publish a consensus price. Currently available
            on <strong>Ethereum mainnet only</strong>.
          </p>
          <ApiMethod
            name="getPrice"
            description="Get the latest USD price for a supported pair. Read-only on-chain call, no gas cost. Pair must be one of the supported feeds listed below."
            params={[
              { name: 'pair', type: 'string', desc: 'Exact pair string (e.g. "ETH/USD") — see supported pairs below' },
            ]}
            returns="number (USD price)"
            example={`const ethPrice = await dt.ethereum.chainlink.getPrice('ETH/USD')
console.log('ETH:', ethPrice, 'USD')

const btcPrice = await dt.ethereum.chainlink.getPrice('BTC/USD')
console.log('BTC:', btcPrice, 'USD')`}
          />
          <ApiMethod
            name="getPriceData"
            description="Get full price data including round ID and update timestamp."
            params={[
              { name: 'pair', type: 'string', desc: 'Exact pair string (e.g. "ETH/USD")' },
            ]}
            returns="{ pair, price, roundId, updatedAt, answeredInRound }"
            example={`const data = await dt.ethereum.chainlink.getPriceData('ETH/USD')
console.log('Price:', data.price, 'Updated:', new Date(data.updatedAt * 1000))`}
          />
          <ApiMethod
            name="getSupportedPairs"
            description="List all supported Chainlink feed pairs."
            params={[]}
            returns="string[]"
            example={`const pairs = dt.ethereum.chainlink.getSupportedPairs()
// ['ETH/USD', 'BTC/USD', 'USDC/USD', ...]`}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">Supported Pairs (Ethereum Mainnet)</h3>
          <DocTable
            headers={['Pair', 'Feed Address']}
            rows={[
              ['ETH/USD', '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'],
              ['BTC/USD', '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'],
              ['USDC/USD', '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'],
              ['LINK/USD', '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c'],
              ['USDT/USD', '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'],
              ['DAI/USD', '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'],
              ['STETH/USD', '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8'],
              ['AAVE/USD', '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9'],
              ['UNI/USD', '0x553303d460EE0afB37EdFf9bE42922D8FF63220e'],
            ]}
          />
          <p className="text-xs text-text-secondary leading-relaxed mt-3">
            All feeds return 8-decimal USD prices. Using an unsupported pair will throw an error —
            call <Code>getSupportedPairs()</Code> to check availability.
          </p>
        </>
      )

    // ================================================================
    // ORDER LIFECYCLE
    // ================================================================
    case 'order-dex':
      return (
        <>
          <DocHeader title="DEX Order Lifecycle" subtitle="Uniswap V3/V4, 1inch" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            A DEX swap is a <strong>market order with guaranteed fill, no partial fills, and
            settlement in ~2-24 seconds</strong>. Once signed and broadcast, it <strong>cannot be
            cancelled</strong>.
          </p>
          <CodeBlock
            title="DEX Order Flow"
            code={`chain.swap('WETH', 'USDC', '0.01')
  │
  ├─ [1] Quote: Read-only call to quoter contract (like an RFQ)
  ├─ [2] Approve: ERC20.approve(router, amount)  ← broker authorization
  ├─ [3] Swap: Sign + broadcast tx
  │       → Order recorded: status=PENDING
  │       → ⚠ CANNOT BE CANCELLED — tx is signed and broadcast
  │
  ├─ [4] Wait for block inclusion (settlement)
  │
  ├─ [5a] SUCCESS → status=FILLED
  │        → filledQuantity, filledPrice, txHash set
  │        → Gas cost recorded (ETH spent on tx fee)
  │        → PnL engine processes trade (includes gas as cost)
  │
  └─ [5b] REVERT (rejection) → status=CANCELLED
           → Gas still consumed and recorded as loss
           → Revert reason logged`}
          />
          <DocTable
            headers={['Property', 'Value']}
            rows={[
              ['Cancellable', 'No — once signed and broadcast, it\'s final'],
              ['Partial fills', 'No — atomic success or full revert'],
              ['Settlement', 'On-chain (12-24s on L1, ~2s on L2)'],
              ['Gas cost', 'Paid in ETH regardless of success or failure'],
              ['Failed tx gas', 'Yes — reverted swaps still consume gas (recorded as loss)'],
              ['Slippage protection', 'amountOutMin rejects unfavorable prices (causes revert)'],
              ['Order types', 'Market only (no native limit orders)'],
            ]}
          />
          <p className="text-xs text-text-secondary leading-relaxed mt-3 mb-3">
            <strong>Important:</strong> A reverted swap still costs gas. If the price moves past
            your slippage tolerance between quote and execution, the tx reverts but you still pay
            the gas fee. This is like a rejected order that still incurs exchange fees. The gas
            cost is recorded as a loss in the PnL engine.
          </p>
          <DocTable
            headers={['DeFi Step', 'TradFi Equivalent']}
            rows={[
              ['Quote', 'Indicative price / RFQ from the AMM pool'],
              ['Approve', 'Broker authorization to move your tokens'],
              ['Swap broadcast', 'Order submission — irreversible once sent'],
              ['Block confirmation', 'Trade settlement (T+0, real-time)'],
              ['Revert', 'Trade rejection / DK — gas still consumed'],
              ['Slippage', 'Market impact — controlled via amountOutMin'],
            ]}
          />
        </>
      )

    case 'order-cex':
      return (
        <>
          <DocHeader title="CEX Order Lifecycle" subtitle="Binance" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Binance orders work exactly like traditional exchange orders. If you've traded on any
            exchange, this is familiar.
          </p>
          <CodeBlock
            title="Market Order Flow"
            code={`dt.binance.buy({ symbol: 'ETHUSDT', type: 'MARKET', quantity: 0.01 })
  │
  ├─ [1] POST /api/v3/order → exchange matches immediately
  │       → May produce multiple partial fills
  ├─ [2] Response contains fills array
  │       → Order: PENDING → FILLED (typically <100ms)
  │       → Commission fees recorded per fill
  │       → PnL engine processes trade (includes fees as cost)
  └─ Done`}
          />
          <CodeBlock
            title="Limit Order Flow"
            code={`dt.binance.buy({ symbol: 'ETHUSDT', type: 'LIMIT', price: 2000, quantity: 0.01 })
  │
  ├─ [1] Order placed on book → status=PENDING
  │
  ├─ [2a] Price reaches limit → fills (possibly partial)
  │        → status=PARTIAL → eventually FILLED
  │        → Commission recorded per partial fill
  │
  ├─ [2b] User cancels: dt.binance.cancelOrder(symbol, orderId)
  │        → status=CANCELLED, unfilled quantity released
  │        → Fees only on filled portion (if any partial fills)
  │
  └─ [2c] TimeInForce expires → status=EXPIRED`}
          />
          <DocTable
            headers={['Property', 'Value']}
            rows={[
              ['Cancellable', 'Yes — limit orders can be cancelled before fill'],
              ['Partial fills', 'Yes — limit orders may fill incrementally'],
              ['Settlement', 'Off-chain (exchange internal), instant'],
              ['Gas cost', 'None'],
              ['Fees', 'Commission (0.1% default, lower with BNB) — recorded per fill in PnL engine'],
              ['Order types', 'Market, Limit, Stop-Loss, Stop-Limit, OCO'],
              ['Time-in-force', 'GTC, IOC, FOK'],
            ]}
          />
        </>
      )

    case 'order-hook':
      return (
        <>
          <DocHeader title="V4 Hook Order Lifecycle" subtitle="On-chain limit orders" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            V4 Hook limit orders are <strong>on-chain resting limit orders</strong>, similar to a
            resting order on an ECN, executed by natural flow. No off-chain infrastructure needed.
            See V4 Hooks section for full architecture.
          </p>
          <CodeBlock
            title="V4 Hook Limit Order Flow"
            code={`dt.ethereum.uniswapV4.limitOrder({ tokenIn, tokenOut, amountIn, targetPrice, tick }, routerAddress)
  │
  ├─ [1] Tokens transferred to hook contract via MegaQuantRouter
  │       → status=PENDING, protocol=uniswap-v4-hook
  │       → ERC1155 claim tokens minted to user (your order receipt)
  │
  ├─ [2a] Another user's swap crosses your tick
  │        → afterSwap() hook auto-executes your order
  │        → status=FILLED
  │        → User calls redeemLimitOrder() to withdraw output tokens
  │
  ├─ [2b] User cancels: dt.ethereum.uniswapV4.cancelLimitOrder(tokenIn, tokenOut, tick, hookAddress)
  │        → Input tokens returned, claim tokens burned
  │        → status=CANCELLED
  │
  └─ [2c] Deadline expires
           → Order can still be cancelled by user
           → Does NOT auto-cancel (would require gas)`}
          />
          <DocTable
            headers={['Property', 'Value']}
            rows={[
              ['Cancellable', 'Yes — before execution'],
              ['Partial fills', 'No — atomic fill when tick is crossed'],
              ['Settlement', 'On-chain (via hook\'s afterSwap callback)'],
              ['Execution', 'Passive — triggered by other users\' swaps'],
              ['Gas for placement', 'Yes (on-chain tx to deposit tokens)'],
              ['Gas for execution', 'None for placer (swapper pays)'],
              ['Gas for claim', 'Yes (on-chain tx to redeem output tokens)'],
              ['Claim tokens', 'ERC1155 — transferable, composable'],
            ]}
          />
          <DocTable
            headers={['DeFi Step', 'TradFi Equivalent']}
            rows={[
              ['Place order', 'Deposit margin for a resting order'],
              ['ERC1155 claim token', 'Warehouse receipt / position token (transferable)'],
              ['Tick', 'Price level (~0.01% per tick)'],
              ['afterSwap execution', 'Resting order filled by crossing market order'],
              ['Redeem', 'Settle trade and receive proceeds'],
              ['zeroForOne', 'Direction flag (true = sell token0 for token1)'],
            ]}
          />
        </>
      )

    case 'order-comparison':
      return (
        <>
          <DocHeader title="Order Type Comparison" />
          <DocTable
            headers={['', 'DEX Swap', 'CEX (Binance)', 'V4 Hook Limit']}
            rows={[
              ['Cancellable', 'No', 'Yes (limit)', 'Yes'],
              ['Partial fills', 'No', 'Yes', 'No'],
              ['On-chain', 'Yes', 'No', 'Yes'],
              ['Fees', 'Gas (~200k gas, recorded)', '0.1% commission (recorded)', 'Gas (~150k place + ~50k claim)'],
              ['Order types', 'Market', 'Market, Limit, Stop', 'Limit (tick-based)'],
              ['Execution', 'Immediate', 'Immediate/queued', 'Passive (other swaps)'],
              ['Price format', 'Slippage %', 'USD', 'Uniswap tick'],
              ['Custody', 'Non-custodial', 'Custodial', 'Non-custodial'],
              ['Settlement', '~2-24s on-chain', 'Instant (off-chain)', '~2-24s on-chain'],
            ]}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">Unified Order Table</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            All order types are stored in the same <Code>orders</Code> table. Query them
            uniformly via <Code>dt.orders</Code>.
          </p>
          <CodeBlock
            title="Protocol Values"
            code={`orders.protocol:
  'uniswap-v3'       → DEX swap
  'uniswap-v4'       → DEX swap (V4 pools)
  '1inch'            → DEX aggregated swap
  'binance'          → CEX order
  'uniswap-v4-hook'  → On-chain limit order via hook

Status transitions:
  All venues:   PENDING → FILLED
  DEX only:     PENDING → CANCELLED (revert)
  CEX only:     PENDING → PARTIAL → FILLED
  CEX only:     PENDING → CANCELLED (user cancel)
  CEX only:     PENDING → EXPIRED (time-in-force)
  Hook only:    PENDING → FILLED → REDEEMED (claimed)
  Hook only:    PENDING → CANCELLED (user cancel)`}
          />
        </>
      )

    // ================================================================
    // V4 HOOKS
    // ================================================================
    case 'v4-architecture':
      return (
        <>
          <DocHeader title="V4 Hooks Architecture" subtitle="MegaQuantHook.sol" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Uniswap V4 introduced a revolutionary architecture: <strong>all pools are managed by a
            single PoolManager contract</strong> (the "singleton" design). Attached to each pool is
            an optional <strong>hook</strong> — a smart contract that executes custom logic at specific
            points in the swap lifecycle.
          </p>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            <strong>TradFi analogy:</strong> Hooks are like <strong>exchange-level automation
            rules</strong> that execute at specific trade lifecycle events. Like how an exchange
            runs risk checks before/after each trade, hooks run custom code before/after each swap.
          </p>
          <CodeBlock
            title="Hook Callbacks"
            code={`beforeInitialize / afterInitialize  → Pool creation
beforeSwap / afterSwap              → Every swap
beforeAddLiquidity / afterAddLiquidity → LP deposits
beforeRemoveLiquidity / afterRemoveLiquidity → LP withdrawals
beforeDonate / afterDonate          → Fee donations`}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">MegaQuantHook Contract</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Our hook combines two features: <strong>volatility-based dynamic fees</strong> (adjusts
            pool fees based on EWMA variance of tick movements, 0.05% to 1.0%) and <strong>on-chain
            limit orders</strong> (tick-based orders that execute via afterSwap).
          </p>
          <CodeBlock
            title="Contract Architecture"
            code={`MegaQuantHook.sol
├── Inherits: BaseHook, ERC1155, ReentrancyGuard
│
├── Volatility Fee System
│   ├── VolatilityState per pool (lastTick, ewmaVariance, observationCount)
│   ├── beforeSwap → returns dynamic fee (0.05% to 1.0%)
│   └── afterSwap → updates EWMA variance
│
├── Limit Order System
│   ├── pendingOrders[poolId][tick][zeroForOne] → aggregated amount
│   ├── claimableOutputTokens[orderId] → filled output amount
│   ├── placeOrder() → deposit tokens, mint ERC1155 claim tokens
│   ├── cancelOrder() → return tokens, burn claim tokens
│   ├── redeem() → withdraw output, burn claim tokens
│   └── afterSwap → _tryExecutingOrders() (up to 5 orders per swap)
│
└── Libraries
    ├── VolatilityMath.sol → EWMA calculations
    └── OrderLib.sol → Hook data encoding`}
          />
        </>
      )

    case 'v4-limit-orders':
      return (
        <>
          <DocHeader title="On-Chain Limit Orders" subtitle="How V4 hook limit orders work" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Traditional DEX swaps are immediate market orders. There's no way to say "buy ETH when
            it drops to $2,000" without running an off-chain bot. V4 Hook limit orders solve this.
          </p>

          <h3 className="text-sm font-semibold mt-4 mb-2">Why On-Chain Limit Orders?</h3>
          <DocTable
            headers={['Feature', 'Off-chain Bot', 'V4 Hook Limit']}
            rows={[
              ['Infrastructure', 'Server, monitoring, alerts', 'None (fully on-chain)'],
              ['Execution risk', 'Bot downtime = missed fills', 'Always active'],
              ['MEV risk', 'Vulnerable to frontrunning', 'Resistant (atomic execution)'],
              ['Gas for fill', 'Per-order (bot submits tx)', 'Zero (swapper pays)'],
              ['Capital while waiting', 'Idle', 'Can earn swap fees'],
              ['Trust model', 'Trust your infrastructure', 'Trust the smart contract'],
            ]}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">How Execution Works</h3>
          <CodeBlock
            title="Three-Step Lifecycle"
            code={`Step 1: PLACE ORDER
  hook.placeOrder(poolKey, tickToSellAt, zeroForOne, amount, deadline)
  → Tokens transferred FROM user TO hook contract
  → ERC1155 claim tokens minted TO user
  → Order aggregated with others at the same tick

Step 2: PRICE CROSSES TICK (automatic)
  When ANY user swaps and price moves through your order tick:
  → afterSwap() detects tick crossed (lastTick vs currentTick)
  → Hook executes aggregated order via poolManager.swap()
  → Output tokens stored in hook contract
  → Up to 5 orders executed per swap (gas limit protection)

Step 3: REDEEM
  hook.redeem(poolKey, tick, zeroForOne, amountToClaimFor)
  → Output calculated pro-rata: (yourClaim / totalClaim) × totalOutput
  → ERC1155 claim tokens burned
  → Output tokens transferred to you`}
          />
        </>
      )

    case 'v4-claim-tokens':
      return (
        <>
          <DocHeader title="ERC1155 Claim Tokens" subtitle="Order position tokens" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            When you place a limit order, you receive <strong>ERC1155 claim tokens</strong> —
            think of them as <strong>warehouse receipts</strong> representing your share of a
            pooled order at a specific tick.
          </p>
          <CodeBlock
            title="How Claim Tokens Work"
            code={`Order at tick -200000 (selling ETH for USDC):
  Alice deposits 1.0 ETH  → gets 1.0e18 ERC1155 tokens (orderId=0xabc...)
  Bob deposits 0.5 ETH    → gets 0.5e18 ERC1155 tokens (same orderId)
  Total pending: 1.5 ETH

After price crosses tick (auto-execution):
  1.5 ETH swapped → 3000 USDC received

Redemption (pro-rata):
  Alice redeems 1.0e18 tokens → gets 2000 USDC (1.0/1.5 × 3000)
  Bob redeems 0.5e18 tokens   → gets 1000 USDC (0.5/1.5 × 3000)`}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Properties</h3>
          <DocTable
            headers={['Property', 'Description', 'TradFi Equivalent']}
            rows={[
              ['Transferable', 'Sell your order position to someone else', 'Selling a warehouse receipt'],
              ['Composable', 'Use as collateral in lending protocols', 'Pledging a receipt for a loan'],
              ['Fungible per tick', 'All orders at the same tick are interchangeable', 'Fungible bonds of the same series'],
              ['Batch operations', 'Transfer multiple positions in one tx', 'Bulk security transfers'],
            ]}
          />
        </>
      )

    case 'v4-deployment':
      return (
        <>
          <DocHeader title="Deployment" subtitle="Infrastructure & chain addresses" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            <strong>MEGA QUANT deploys the infrastructure. Users just place orders.</strong> You
            never deploy contracts or create pools — that's handled by the team once per chain.
          </p>
          <CodeBlock
            title="Deployment Model"
            code={`MEGA QUANT Team (one-time per chain):
  1. Deploy MegaQuantHook.sol via CREATE2 (salt-mined address)
     → Address encodes hook permissions in least-significant bits
  2. Deploy MegaQuantRouter.sol
     → Handles swap routing + limit order placement
  3. Initialize pools with hook attached
     → ETH/USDC, ETH/USDT, WBTC/USDC, etc.

Users (via MEGA QUANT app):
  → Place limit orders on existing pools
  → Cancel pending orders
  → Redeem filled orders (claim output tokens)
  → View order status in the Orders tab
  → Users do NOT deploy contracts or create pools`}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">PoolManager Addresses</h3>
          <DocTable
            headers={['Chain', 'PoolManager Address', 'Status']}
            rows={[
              ['Ethereum', '0x00000000...4444c5dc75cB358380D2e3dE08A90', 'After testnet validation'],
              ['Base', '0x498581ff...956af099b2652b2b', 'After testnet validation'],
              ['Unichain', '0x1f984000...00000000000000004', 'After testnet validation'],
              ['Sepolia', '0xE03A1074...1536e203543', 'Test deployment'],
              ['Base Sepolia', '0x05E73354...6fA03408', 'Test deployment'],
              ['Unichain Sepolia', '0xC81462Fe...a35C1A', 'Test deployment'],
            ]}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Router Contract</h3>
          <DocTable
            headers={['Function', 'Description']}
            rows={[
              ['swap()', 'Single swap with dynamic fee'],
              ['batchSwap()', 'Multiple swaps in one tx (gas savings via flash accounting)'],
              ['placeLimitOrder()', 'Convenience wrapper for hook\'s placeOrder()'],
            ]}
          />
          <p className="text-xs text-text-secondary leading-relaxed mt-3">
            Uses transient storage (EIP-6090) to preserve msg.sender through callbacks. No factory
            contract needed — in V4, the PoolManager IS the universal factory.
          </p>
        </>
      )

    // ================================================================
    // ORDERS & PNL
    // ================================================================
    case 'orders-api':
      return (
        <>
          <DocHeader title="Orders (Read-Only)" subtitle="dt.orders" />
          <p className="text-xs text-text-secondary leading-relaxed mb-4">
            Orders are auto-recorded by protocol actions. These are query helpers — you never
            need to manually record an order.
          </p>
          <ApiMethod
            name="getAll"
            description="Get all trades and orders for the current strategy."
            params={[]}
            returns="Order[]"
            example={`const orders = dt.orders.getAll()
console.log('Total orders:', orders.length)`}
          />
          <ApiMethod
            name="getPending"
            description="Get unfilled limit orders (V4 hook + Binance) for this strategy."
            params={[]}
            returns="Order[]"
            example={`const pending = dt.orders.getPending()
console.log('Pending orders:', pending.length)`}
          />
          <ApiMethod
            name="getHistory"
            description="Get completed/filled trades."
            params={[{ name: 'limit', type: 'number?', desc: 'Max results (default: 50)' }]}
            returns="{ orders: Order[], total: number }"
            example={`const { orders, total } = dt.orders.getHistory(10)
console.log('Last 10 of', total, 'filled orders')`}
          />
          <ApiMethod
            name="getByAsset"
            description="Filter orders by asset symbol."
            params={[{ name: 'symbol', type: 'string', desc: 'Asset symbol (e.g. "ETH")' }]}
            returns="Order[]"
            example={`const ethOrders = dt.orders.getByAsset('ETH')
console.log('ETH orders:', ethOrders.length)`}
          />
        </>
      )

    case 'pnl-how':
      return (
        <>
          <DocHeader title="How PnL Works" subtitle="Fee tracking, cost basis, and time series" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            The PnL engine automatically tracks every trade, fee, and position change. You never
            call it directly — it's updated internally when you execute trades via any protocol.
          </p>

          <h3 className="text-sm font-semibold mt-4 mb-2">Fee Tracking</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            All execution costs are captured and deducted from realized PnL:
          </p>
          <DocTable
            headers={['Venue', 'Fee Type', 'How It\'s Captured', 'Unit']}
            rows={[
              ['DEX (Uniswap, 1inch)', 'Gas cost', 'From tx receipt: gasUsed × gasPrice, converted to USD', 'USD'],
              ['DEX (reverted tx)', 'Gas cost (loss)', 'Reverted swaps still consume gas — recorded as pure loss', 'USD'],
              ['CEX (Binance)', 'Commission', 'From each fill: fill.commission, summed across partial fills', 'Quote asset'],
              ['V4 Hook (place)', 'Gas cost', 'On-chain tx to deposit tokens into hook', 'USD'],
              ['V4 Hook (redeem)', 'Gas cost', 'On-chain tx to claim output tokens', 'USD'],
            ]}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Cost Basis Method</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Positions use <strong>weighted-average cost basis</strong>. When you add to a position,
            the entry price is recalculated as a weighted average:
          </p>
          <CodeBlock
            title="Cost Basis Calculation"
            code={`// Adding to an existing long position:
newAvgPrice = ((existingAvg × existingQty) + (tradePrice × tradeQty))
              / (existingQty + tradeQty)

// Example:
// Position: 1.0 ETH @ $2000 avg
// New buy:  0.5 ETH @ $2200
// New avg:  ((2000 × 1.0) + (2200 × 0.5)) / 1.5 = $2066.67`}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Realized PnL</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Calculated when you reduce or close a position. <strong>Fees are deducted:</strong>
          </p>
          <CodeBlock
            title="Realized PnL Formula"
            code={`// Closing a long position (selling):
realizedPnl = (sellPrice - avgEntryPrice) × quantity - fees

// Closing a short position (buying to cover):
realizedPnl = (avgEntryPrice - buyPrice) × quantity - fees

// "fees" = DEX gas cost (USD) or CEX commission`}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Unrealized PnL</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Mark-to-market on open positions using latest prices. Fees are <strong>not</strong>{' '}
            deducted from unrealized PnL (they're already deducted at realization):
          </p>
          <CodeBlock
            title="Unrealized PnL"
            code={`// Long position:
unrealizedPnl = (currentMarketPrice - avgEntryPrice) × quantity

// Short position:
unrealizedPnl = (avgEntryPrice - currentMarketPrice) × quantity`}
          />

          <h3 className="text-sm font-semibold mt-6 mb-2">Time Series & Trade Timing</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Accurate PnL time series requires knowing <strong>when</strong> each trade happened:
          </p>
          <DocTable
            headers={['Venue', 'Timestamp Source', 'Resolution']}
            rows={[
              ['DEX', 'Block number → block.timestamp (wall-clock)', '~12s (L1) / ~2s (L2)'],
              ['CEX (Binance)', 'Exchange transactTime (milliseconds)', 'Millisecond precision'],
              ['V4 Hook (fill)', 'Block number of the afterSwap tx', '~12s (L1) / ~2s (L2)'],
            ]}
          />
          <p className="text-xs text-text-secondary leading-relaxed mt-3">
            For DEX trades, the block number is recorded on the order/trade record. The PnL
            snapshotter uses block timestamps to place trades on the correct point in the
            time series. Hourly snapshots aggregate all trades and mark-to-market values.
          </p>

          <h3 className="text-sm font-semibold mt-6 mb-2">Position Tracking</h3>
          <DocTable
            headers={['Field', 'Description']}
            rows={[
              ['strategyId', 'Which strategy owns this position'],
              ['assetSymbol', 'e.g. "ETH", "BTC"'],
              ['side', '"long" or "short"'],
              ['quantity', 'Current position size'],
              ['avgEntryPrice', 'Weighted-average cost basis'],
              ['currentPrice', 'Latest market price (updated periodically)'],
              ['realizedPnl', 'Cumulative realized PnL (fees deducted)'],
              ['unrealizedPnl', 'Current mark-to-market PnL'],
              ['totalFees', 'Accumulated gas + commission fees paid'],
              ['status', '"open" or "closed"'],
            ]}
          />

          <DocTable
            headers={['TradFi Term', 'PnL Engine Equivalent']}
            rows={[
              ['Cost basis', 'avgEntryPrice (weighted average)'],
              ['Mark-to-market', 'unrealizedPnl (updated with latest prices)'],
              ['Realized P&L', 'realizedPnl (exit price - entry price - fees)'],
              ['Transaction costs', 'totalFees (gas + commission, accumulated)'],
              ['Settlement time', 'Block timestamp (DEX) or transactTime (CEX)'],
              ['Position', 'One record per asset/strategy/side combination'],
            ]}
          />
        </>
      )

    case 'pnl-api':
      return (
        <>
          <DocHeader title="PnL Query API (Read-Only)" subtitle="dt.pnl" />
          <p className="text-xs text-text-secondary leading-relaxed mb-4">
            PnL is auto-calculated per strategy. These are read-only query helpers — all
            values reflect fees (gas + commission) already deducted from realized PnL.
          </p>
          <ApiMethod
            name="getHourly"
            description="Get hourly PnL snapshots for time-series analysis. Each snapshot captures total value, realized PnL, unrealized PnL, and position count at that hour. DEX trades are placed on the timeline using block timestamps."
            params={[{ name: 'hours', type: 'number?', desc: 'Number of hours (default: 24)' }]}
            returns="PnlSnapshot[] — { timestamp, totalValueUsd, realizedPnlUsd, unrealizedPnlUsd, totalPnlUsd, positionsCount }"
            example={`const hourly = dt.pnl.getHourly(24)
for (const snap of hourly) {
  console.log(snap.timestamp, 'Total PnL:', snap.totalPnlUsd, 'Positions:', snap.positionsCount)
}`}
          />
          <ApiMethod
            name="getTotal"
            description="Get total PnL summary. totalRealizedPnl has fees already deducted. totalPnl = realized + unrealized."
            params={[]}
            returns="{ totalRealizedPnl, totalUnrealizedPnl, totalPnl, openPositionsCount, closedPositionsCount }"
            example={`const total = dt.pnl.getTotal()
console.log('Realized (net of fees):', total.totalRealizedPnl)
console.log('Unrealized:', total.totalUnrealizedPnl)
console.log('Total:', total.totalPnl)
console.log('Open positions:', total.openPositionsCount)`}
          />
          <ApiMethod
            name="getPositions"
            description="Get current open positions with mark-to-market values, cost basis, and accumulated fees."
            params={[{ name: 'status', type: 'string?', desc: '"open" | "closed" | "all" (default: "open")' }]}
            returns="Position[] — { assetSymbol, side, quantity, avgEntryPrice, currentPrice, unrealizedPnl, totalFees, status }"
            example={`const positions = dt.pnl.getPositions()
for (const p of positions) {
  console.log(p.assetSymbol, p.side, 'qty:', p.quantity, 'entry:', p.avgEntryPrice, 'fees:', p.totalFees)
}`}
          />
          <ApiMethod
            name="getRealized"
            description="Get cumulative realized PnL from closed positions. Fees (gas + commission) are already deducted."
            params={[]}
            returns="{ realizedPnl: number, totalFees: number }"
            example={`const { realizedPnl, totalFees } = dt.pnl.getRealized()
console.log('Net realized:', realizedPnl, '(fees:', totalFees, ')')`}
          />
        </>
      )

    // ================================================================
    // EXAMPLES
    // ================================================================
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
  console.log('Explorer:', result.explorerUrl)
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
      const buyLeg = await dt.base.uniswapV3.swap({ tokenIn: 'USDC', tokenOut: 'WETH', amountIn: '1000' })
      console.log('Buy leg:', buyLeg.explorerUrl)
      const sellLeg = await dt.ethereum.uniswapV3.swap({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '0.5' })
      console.log('Sell leg:', sellLeg.explorerUrl)
    } else {
      const buyLeg = await dt.ethereum.uniswapV3.swap({ tokenIn: 'USDC', tokenOut: 'WETH', amountIn: '1000' })
      console.log('Buy leg:', buyLeg.explorerUrl)
      const sellLeg = await dt.base.uniswapV3.swap({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '0.5' })
      console.log('Sell leg:', sellLeg.explorerUrl)
    }
    console.log('Arb executed!')
  }

  await dt.close()
}`}
          />
        </>
      )

    case 'example-delta':
      return (
        <>
          <DocHeader title="Example: Delta Neutral" />
          <CodeBlock
            title="Hedge DEX position with CEX short"
            code={`async function execute(dt) {
  // Buy ETH on DEX
  const dexBuy = await dt.ethereum.uniswapV3.swap({
    tokenIn: 'USDC', tokenOut: 'WETH', amountIn: '1000'
  })
  const ethBought = parseFloat(dexBuy.amountOut)
  console.log('DEX: Bought', ethBought, 'ETH')
  console.log('Explorer:', dexBuy.explorerUrl)

  // Hedge by selling equivalent on Binance
  await dt.binance.sell({
    symbol: 'ETHUSDT',
    type: 'MARKET',
    quantity: ethBought
  })
  console.log('CEX: Sold', ethBought, 'ETH (hedge)')

  // You're now delta-neutral: long ETH on-chain, short ETH on Binance
  // Profit comes from the spread between DEX and CEX prices

  // Check PnL
  const pnl = dt.pnl.getTotal()
  console.log('Net PnL:', pnl.totalPnl)

  await dt.close()
}`}
          />
        </>
      )

    case 'example-grid':
      return (
        <>
          <DocHeader title="Example: Limit Grid" />
          <CodeBlock
            title="Place grid of V4 hook limit orders"
            code={`async function execute(dt) {
  // NOTE: Requires deployed MegaQuantRouter and MegaQuantHook addresses
  const routerAddress = '0x...'  // Your MegaQuantRouter deployment
  const hookAddress = '0x...'    // Your MegaQuantHook deployment

  // Place a grid of limit buy orders at descending ticks
  const baseTick = -200000
  const tickSpacing = 100  // 1% apart
  const amountPerOrder = '0.5' // 0.5 WETH per level

  const orders = []
  for (let i = 1; i <= 5; i++) {
    const tick = baseTick - (i * tickSpacing)
    const order = await dt.ethereum.uniswapV4.limitOrder({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: amountPerOrder,
      targetPrice: '2000',
      tick,
      deadline: 3600
    }, routerAddress)
    orders.push(order)
    console.log('Placed order at tick', tick, '- ID:', order.orderId, 'Tx:', order.txHash)
  }

  console.log('Grid placed:', orders.length, 'orders')

  // Monitor fills
  await sleep(60000) // Wait 1 minute

  const pending = dt.orders.getPending()
  const { orders: filled } = dt.orders.getHistory()
  console.log('Pending:', pending.length, 'Filled:', filled.length)

  // Cancel unfilled orders
  for (const order of pending) {
    await dt.ethereum.uniswapV4.cancelLimitOrder(
      order.assetSymbol === 'WETH' ? 'WETH' : 'USDC',
      order.assetSymbol === 'WETH' ? 'USDC' : 'WETH',
      order.tick,
      hookAddress
    )
    console.log('Cancelled:', order.id)
  }

  await dt.close()
}`}
          />
        </>
      )

    case 'example-sepolia':
      return (
        <>
          <DocHeader title="Test: Sepolia DEX Buy/Sell" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Round-trip swap on Ethereum Sepolia testnet: WETH → USDC → WETH. Requires
            funded Sepolia wallet (see Testnet Setup).
          </p>
          <CodeBlock
            title="Sepolia DEX Test (Uniswap V3)"
            code={`async function execute(dt) {
  console.log("=== Sepolia DEX Test (Uniswap V3) ===")

  const chain = dt.sepolia
  if (!chain) {
    console.error("Sepolia not configured. Assign an account in Accounts tab.")
    return
  }

  // Check ETH balance (gas token)
  const ethBal = await chain.getNativeBalance()
  console.log('ETH balance:', ethBal, 'wei')
  if (ethBal < 1000000000000000n) { // < 0.001 ETH
    console.error("Insufficient ETH. See Testnet Setup for faucet links.")
    return
  }

  // Get quote: 0.001 WETH → USDC
  const quote = await chain.getSwapQuote('WETH', 'USDC', '0.001')
  console.log('Quote: 0.001 WETH →', quote.amountOut, 'USDC (rate:', quote.exchangeRate, ')')

  // Execute buy (buy USDC with WETH)
  console.log("Swapping: WETH → USDC...")
  const buyResult = await chain.swap('WETH', 'USDC', '0.001', 1.0)
  console.log('TX:', buyResult.transactionHash)
  console.log('  Got:', buyResult.amountOut, 'USDC')
  console.log('  Gas:', buyResult.gasUsed)
  console.log('  Explorer:', buyResult.explorerUrl)

  await sleep(10000) // wait for indexing

  // Sell back: swap USDC → WETH
  console.log("Swapping: USDC → WETH...")
  const sellResult = await chain.swap('USDC', 'WETH', buyResult.amountOut, 1.0)
  console.log('TX:', sellResult.transactionHash)
  console.log('  Got:', sellResult.amountOut, 'WETH back')
  console.log('  Explorer:', sellResult.explorerUrl)

  console.log("=== Sepolia Test Complete ===")
}`}
          />
        </>
      )

    case 'example-base-sepolia':
      return (
        <>
          <DocHeader title="Test: Base Sepolia DEX Buy/Sell" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Round-trip swap on Base Sepolia (L2 — faster and cheaper). Requires funded
            Base Sepolia wallet.
          </p>
          <CodeBlock
            title="Base Sepolia DEX Test"
            code={`async function execute(dt) {
  console.log("=== Base Sepolia DEX Test ===")

  const chain = dt['base-sepolia']
  if (!chain) { console.error("Base Sepolia not configured"); return }

  const ethBal = await chain.getNativeBalance()
  console.log('ETH balance:', ethBal, 'wei')

  // Quote and swap
  const quote = await chain.getSwapQuote('WETH', 'USDC', '0.001')
  console.log('Quote: 0.001 WETH →', quote.amountOut, 'USDC')

  const result = await chain.swap('WETH', 'USDC', '0.001', 1.0)
  console.log('TX:', result.transactionHash)
  console.log('  Got:', result.amountOut, 'USDC')
  console.log('  Gas:', result.gasUsed)
  console.log('  Explorer:', result.explorerUrl)

  await sleep(5000) // L2 is faster

  // Sell back
  const sellResult = await chain.swap('USDC', 'WETH', result.amountOut, 1.0)
  console.log('Sell TX:', sellResult.transactionHash)
  console.log('  Got:', sellResult.amountOut, 'WETH back')
  console.log('  Explorer:', sellResult.explorerUrl)

  console.log("=== Base Sepolia Test Complete ===")
}`}
          />
        </>
      )

    case 'example-unichain':
      return (
        <>
          <DocHeader title="Test: Unichain Sepolia DEX" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Round-trip swap on Unichain Sepolia. Bridge Sepolia ETH via Superbridge first.
          </p>
          <CodeBlock
            title="Unichain Sepolia DEX Test"
            code={`async function execute(dt) {
  console.log("=== Unichain Sepolia DEX Test ===")

  const chain = dt['unichain-sepolia']
  if (!chain) { console.error("Unichain Sepolia not configured"); return }

  const ethBal = await chain.getNativeBalance()
  console.log('ETH balance:', ethBal, 'wei')

  // Unichain Sepolia has WETH/USDC pools
  const quote = await chain.getSwapQuote('WETH', 'USDC', '0.001')
  console.log('Quote: 0.001 WETH →', quote.amountOut, 'USDC')

  const result = await chain.swap('WETH', 'USDC', '0.001', 1.0)
  console.log('TX:', result.transactionHash)
  console.log('  Got:', result.amountOut, 'USDC')
  console.log('  Gas:', result.gasUsed)
  console.log('  Explorer:', result.explorerUrl)

  await sleep(5000)

  const sellResult = await chain.swap('USDC', 'WETH', result.amountOut, 1.0)
  console.log('Sell TX:', sellResult.transactionHash)
  console.log('  Got:', sellResult.amountOut, 'WETH back')
  console.log('  Explorer:', sellResult.explorerUrl)

  console.log("=== Unichain Sepolia Test Complete ===")
}`}
          />
        </>
      )

    case 'example-binance':
      return (
        <>
          <DocHeader title="Test: Binance Testnet CEX" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Full Binance order lifecycle: market buy → limit sell → cancel → market sell.
            Requires Binance testnet API keys (see Testnet Setup).
          </p>
          <CodeBlock
            title="Binance Testnet Test"
            code={`async function execute(dt) {
  console.log("=== Binance Testnet Test ===")

  if (!dt.binance) {
    console.error("Binance not configured. Set API keys in Settings, assign to strategy.")
    return
  }

  // Get current price
  const price = await dt.binance.getPrice('ETHUSDT')
  console.log('ETH/USDT price: $' + price)

  // Get order book
  const book = await dt.binance.getOrderBook('ETHUSDT', 5)
  console.log('Best bid: $' + book.bids[0][0] + ', Best ask: $' + book.asks[0][0])

  // Market buy 0.01 ETH
  console.log("Placing market buy: 0.01 ETH...")
  const buyResult = await dt.binance.buy({
    symbol: 'ETHUSDT', type: 'MARKET', quantity: 0.01
  })
  console.log('Order ' + buyResult.orderId + ': filled ' + buyResult.executedQty + ' ETH')
  console.log('  Cost: ' + buyResult.cummulativeQuoteQty + ' USDT')
  console.log('  Fills: ' + buyResult.fills.length)

  await sleep(2000)

  // Place limit sell at 5% above current price
  const limitPrice = Math.round(price * 1.05 * 100) / 100
  console.log('Placing limit sell: 0.01 ETH @ $' + limitPrice + '...')
  const sellResult = await dt.binance.sell({
    symbol: 'ETHUSDT', type: 'LIMIT', price: limitPrice, quantity: 0.01
  })
  console.log('Limit order ' + sellResult.orderId + ' placed')

  // Check open orders
  const openOrders = await dt.binance.getOpenOrders('ETHUSDT')
  console.log('Open orders: ' + openOrders.length)

  // Cancel the limit order
  if (openOrders.length > 0) {
    console.log('Cancelling order ' + openOrders[0].orderId + '...')
    await dt.binance.cancelOrder('ETHUSDT', openOrders[0].orderId)
    console.log('Order cancelled')
  }

  // Market sell to close position
  console.log("Market sell to close...")
  const closeResult = await dt.binance.sell({
    symbol: 'ETHUSDT', type: 'MARKET', quantity: 0.01
  })
  console.log('Closed: ' + closeResult.executedQty + ' ETH @ ' + closeResult.cummulativeQuoteQty + ' USDT')

  console.log("=== Binance Test Complete ===")
}`}
          />
        </>
      )

    case 'example-multi-venue':
      return (
        <>
          <DocHeader title="Example: Multi-Venue" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Cross-venue price comparison — the foundation for arbitrage strategies.
          </p>
          <CodeBlock
            title="Multi-Venue Price Comparison"
            code={`async function execute(dt) {
  console.log("=== Multi-Venue Price Check ===")

  // Check what's available
  const chains = dt.getConfiguredChains()
  console.log('Configured chains:', chains.join(', '))
  console.log('Binance available:', !!dt.binance)

  // Get prices from multiple sources
  if (dt.binance) {
    const cexPrice = await dt.binance.getPrice('ETHUSDT')
    console.log('Binance ETH price: $' + cexPrice)
  }

  if (dt.sepolia) {
    const quote = await dt.sepolia.getSwapQuote('WETH', 'USDC', '1.0')
    console.log('Sepolia V3 rate:', quote.exchangeRate, 'USDC/WETH')
  }

  if (dt.sepolia && dt.sepolia.uniswapV4) {
    const v4Quote = await dt.sepolia.getSwapQuoteV4('WETH', 'USDC', '1.0')
    console.log('Sepolia V4 rate:', v4Quote.exchangeRate, 'USDC/WETH')
  }

  console.log("=== Multi-Venue Check Complete ===")
}`}
          />
        </>
      )

    // ================================================================
    // BINANCE FUTURES (PERPS)
    // ================================================================
    case 'binance-futures':
      return (
        <>
          <DocHeader title="Binance Futures (Perps)" subtitle="dt.binanceFutures" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Perpetual futures trading on Binance USDM Futures (<Code>fapi.binance.com</Code>).
            Uses the same API key as Binance Spot. Each action creates a{' '}
            <strong>single order</strong> (not linked pairs like spot swaps).
          </p>
          <p className="text-xs text-text-secondary leading-relaxed mb-4">
            PnL formula: <Code>(exit - entry) × size × direction + funding - fees</Code>
          </p>
          <ApiMethod
            name="openLong"
            description="Open a leveraged long position. Automatically sets leverage and margin type if provided."
            params={[
              { name: 'symbol', type: 'string', desc: 'e.g. "ETHUSDT"' },
              { name: 'quantity', type: 'number', desc: 'Position size in base asset' },
              { name: 'leverage', type: 'number?', desc: 'Leverage multiplier (e.g. 10)' },
              { name: 'marginType', type: 'string?', desc: '"CROSS" or "ISOLATED" (default: CROSS)' },
            ]}
            returns="FuturesOrderResult — { orderId, symbol, avgPrice, executedQty, status }"
            example={`await dt.binanceFutures.openLong({
  symbol: 'ETHUSDT',
  quantity: 1,
  leverage: 10,
  marginType: 'CROSS'
})`}
          />
          <ApiMethod
            name="closeLong"
            description="Close an existing long position (reduceOnly order)."
            params={[
              { name: 'symbol', type: 'string', desc: 'e.g. "ETHUSDT"' },
              { name: 'quantity', type: 'number', desc: 'Amount to close' },
            ]}
            returns="FuturesOrderResult"
            example={`await dt.binanceFutures.closeLong({ symbol: 'ETHUSDT', quantity: 1 })`}
          />
          <ApiMethod
            name="openShort / closeShort"
            description="Same interface as openLong/closeLong but for short positions."
            params={[
              { name: 'symbol', type: 'string', desc: 'Trading pair symbol' },
              { name: 'quantity', type: 'number', desc: 'Position size' },
            ]}
            returns="FuturesOrderResult"
            example={`await dt.binanceFutures.openShort({ symbol: 'BTCUSDT', quantity: 0.1, leverage: 5 })
// ... later ...
await dt.binanceFutures.closeShort({ symbol: 'BTCUSDT', quantity: 0.1 })`}
          />
          <ApiMethod
            name="getPositions"
            description="Get all open futures positions from Binance."
            params={[{ name: 'symbol', type: 'string?', desc: 'Filter by symbol' }]}
            returns="FuturesPosition[] — { symbol, positionAmt, entryPrice, markPrice, unRealizedProfit, liquidationPrice, leverage }"
            example={`const positions = await dt.binanceFutures.getPositions('ETHUSDT')
for (const p of positions) {
  console.log(p.symbol, 'size:', p.positionAmt, 'PnL:', p.unRealizedProfit)
}`}
          />
          <ApiMethod
            name="getMarkPrice"
            description="Get the current mark price, index price, and funding rate."
            params={[{ name: 'symbol', type: 'string', desc: 'e.g. "ETHUSDT"' }]}
            returns="{ markPrice, indexPrice, fundingRate }"
            example={`const mark = await dt.binanceFutures.getMarkPrice('ETHUSDT')
console.log('Mark:', mark.markPrice, 'Funding rate:', mark.fundingRate)`}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">Funding Payments</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            Funding payments are polled automatically every hour by the FundingTracker service
            and recorded to the <Code>funding_payments</Code> table. They update{' '}
            <Code>perp_positions.total_funding</Code> and are included in the PnL calculation.
          </p>
        </>
      )

    // ================================================================
    // BINANCE OPTIONS
    // ================================================================
    case 'binance-options':
      return (
        <>
          <DocHeader title="Binance Options" subtitle="dt.binanceOptions" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            European-style options on Binance (<Code>eapi.binance.com</Code>).
            Uses the same API key as Binance Spot. Each action creates a{' '}
            <strong>single order</strong>.
          </p>
          <p className="text-xs text-text-secondary leading-relaxed mb-4">
            PnL formula: <Code>(exitPremium - entryPremium) × contracts × direction</Code> or
            settlement value at expiry.
          </p>
          <ApiMethod
            name="buyCall / sellCall / buyPut / sellPut"
            description="Open an options position. Symbol is auto-constructed from parameters (e.g. ETH-260328-4000-C)."
            params={[
              { name: 'underlying', type: 'string', desc: 'e.g. "ETH"' },
              { name: 'strikePrice', type: 'number', desc: 'Strike price (e.g. 4000)' },
              { name: 'expiry', type: 'string', desc: 'Expiry date, e.g. "2026-03-28"' },
              { name: 'contracts', type: 'number', desc: 'Number of contracts' },
              { name: 'price', type: 'number?', desc: 'Limit price (for LIMIT orders)' },
            ]}
            returns="OptionsOrderResult — { orderId, symbol, avgPrice, executedQty, status }"
            example={`// Buy 5 ETH call options
await dt.binanceOptions.buyCall({
  underlying: 'ETH',
  strikePrice: 4000,
  expiry: '2026-03-28',
  contracts: 5
})

// Sell a put
await dt.binanceOptions.sellPut({
  underlying: 'BTC',
  strikePrice: 60000,
  expiry: '2026-06-30',
  contracts: 2
})`}
          />
          <ApiMethod
            name="getMarkPrice"
            description="Get mark price with full Greeks for an option symbol."
            params={[{ name: 'symbol', type: 'string', desc: 'e.g. "ETH-260328-4000-C"' }]}
            returns="{ markPrice, bidIV, askIV, markIV, delta, gamma, theta, vega, underlyingPrice }"
            example={`const mark = await dt.binanceOptions.getMarkPrice('ETH-260328-4000-C')
console.log('Delta:', mark.delta, 'IV:', mark.markIV, 'Theta:', mark.theta)`}
          />
          <ApiMethod
            name="getPositions"
            description="Get all open options positions from Binance."
            params={[{ name: 'underlying', type: 'string?', desc: 'Filter by underlying (e.g. "ETH")' }]}
            returns="Position[]"
            example={`const positions = await dt.binanceOptions.getPositions('ETH')`}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">Automatic Expiry Settlement</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            The OptionsExpiryChecker service runs hourly and automatically settles expired options:
          </p>
          <DocTable
            headers={['Condition', 'Action', 'PnL']}
            rows={[
              ['Call ITM (spot > strike)', 'Exercised', 'max(spot - strike, 0) × qty - premium_paid'],
              ['Put ITM (strike > spot)', 'Exercised', 'max(strike - spot, 0) × qty - premium_paid'],
              ['OTM (any type)', 'Expires worthless', '-premium_paid (total loss for long)'],
            ]}
          />
        </>
      )

    // ================================================================
    // AAVE V3 LENDING
    // ================================================================
    case 'aave-v3':
      return (
        <>
          <DocHeader title="Aave V3 Lending" subtitle="dt.<chain>.aave" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            On-chain Aave V3 Pool operations. Available on Ethereum, Base, and Sepolia.
            Access via the chain proxy: <Code>dt.base.aave.supply(...)</Code>.
          </p>
          <p className="text-xs text-text-secondary leading-relaxed mb-4">
            PnL formula: <Code>interest earned (supply) or -interest paid (borrow)</Code>.
            Interest accrual is tracked via Aave's liquidity index, updated every 5 minutes.
          </p>
          <ApiMethod
            name="supply"
            description="Supply tokens to Aave. Automatically approves the Pool contract if needed."
            params={[
              { name: 'asset', type: 'string', desc: 'Token contract address' },
              { name: 'assetSymbol', type: 'string', desc: 'e.g. "USDC"' },
              { name: 'amount', type: 'string', desc: 'Human-readable amount (e.g. "10000")' },
            ]}
            returns="string — transaction hash"
            example={`const usdcAddress = dt.base.tokens['USDC'].address
await dt.base.aave.supply({
  asset: usdcAddress,
  assetSymbol: 'USDC',
  amount: '10000'
})`}
          />
          <ApiMethod
            name="withdraw"
            description="Withdraw supplied tokens from Aave. Use 'max' to withdraw everything."
            params={[
              { name: 'asset', type: 'string', desc: 'Token contract address' },
              { name: 'assetSymbol', type: 'string', desc: 'e.g. "USDC"' },
              { name: 'amount', type: 'string', desc: 'Amount or "max"' },
            ]}
            returns="string — transaction hash"
            example={`await dt.base.aave.withdraw({
  asset: usdcAddress,
  assetSymbol: 'USDC',
  amount: 'max'  // Withdraw everything including interest
})`}
          />
          <ApiMethod
            name="borrow"
            description="Borrow tokens from Aave against your supplied collateral."
            params={[
              { name: 'asset', type: 'string', desc: 'Token contract address' },
              { name: 'assetSymbol', type: 'string', desc: 'e.g. "USDC"' },
              { name: 'amount', type: 'string', desc: 'Amount to borrow' },
              { name: 'interestRateMode', type: 'number?', desc: '1 = stable, 2 = variable (default)' },
            ]}
            returns="string — transaction hash"
            example={`await dt.ethereum.aave.borrow({
  asset: usdcAddress,
  assetSymbol: 'USDC',
  amount: '5000',
  interestRateMode: 2  // variable rate
})`}
          />
          <ApiMethod
            name="repay"
            description="Repay borrowed tokens. Use 'max' to repay everything."
            params={[
              { name: 'asset', type: 'string', desc: 'Token contract address' },
              { name: 'assetSymbol', type: 'string', desc: 'e.g. "USDC"' },
              { name: 'amount', type: 'string', desc: 'Amount or "max"' },
            ]}
            returns="string — transaction hash"
            example={`await dt.ethereum.aave.repay({
  asset: usdcAddress,
  assetSymbol: 'USDC',
  amount: 'max'
})`}
          />
          <ApiMethod
            name="getUserAccountData"
            description="Get account health metrics from Aave."
            params={[]}
            returns="{ totalCollateralUsd, totalDebtUsd, availableBorrowsUsd, healthFactor, ltv, liquidationThreshold }"
            example={`const data = await dt.base.aave.getUserAccountData()
console.log('Collateral:', data.totalCollateralUsd)
console.log('Debt:', data.totalDebtUsd)
console.log('Health Factor:', data.healthFactor)
console.log('Available to borrow:', data.availableBorrowsUsd)`}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">Supported Chains</h3>
          <DocTable
            headers={['Chain', 'Access', 'Pool Address']}
            rows={[
              ['Ethereum', 'dt.ethereum.aave', '0x8787...4E2'],
              ['Base', 'dt.base.aave', '0xA238...1c5'],
              ['Sepolia', 'dt.sepolia.aave', '0x6Ae4...951'],
            ]}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">Interest Tracking</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            The AaveInterestTracker service reads Aave's <Code>liquidityIndex</Code> every 5 minutes
            and updates <Code>lending_positions.current_amount</Code> and{' '}
            <Code>accrued_interest</Code>. Interest is reflected in the PnL aggregator as unrealized
            gains (supply) or costs (borrow).
          </p>
        </>
      )

    // ================================================================
    // MULTI-INSTRUMENT PNL
    // ================================================================
    case 'pnl-multi-instrument':
      return (
        <>
          <DocHeader title="Multi-Instrument PnL" subtitle="Aggregated PnL across all instruments" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            The PnlAggregator combines PnL from all 4 instrument engines into a unified view.
            Each instrument has its own PnL formula:
          </p>
          <DocTable
            headers={['Instrument', 'PnL Engine', 'Formula', 'Position Table']}
            rows={[
              ['Spot', 'PnlEngine (FIFO)', '(exit - entry) × qty - fees', 'positions'],
              ['Perps', 'PerpPnlEngine', '(exit - entry) × size × direction + funding - fees', 'perp_positions'],
              ['Options', 'OptionsPnlEngine', 'Premium delta or settlement value - fees', 'options_positions'],
              ['Lending', 'LendingPnlEngine', 'Interest earned (supply) or -interest paid (borrow)', 'lending_positions'],
            ]}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">Aggregated PnL API</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            The aggregated PnL endpoint returns a breakdown by instrument type:
          </p>
          <CodeBlock
            title="GET /api/portfolio/aggregated-pnl"
            code={`// Response structure:
{
  totalRealizedPnl: 1250.00,
  totalUnrealizedPnl: 340.50,
  totalPnl: 1590.50,
  totalOpenPositions: 8,
  spot: { totalRealizedPnl, totalUnrealizedPnl, totalPnl, openPositionsCount, closedPositionsCount },
  perps: { totalRealizedPnl, totalUnrealizedPnl, totalFunding, totalPnl, openPositionsCount, closedPositionsCount },
  options: { totalRealizedPnl, totalUnrealizedPnl, totalPnl, openPositionsCount, closedPositionsCount },
  lending: { totalRealizedPnl, totalAccruedInterest, totalPnl, openPositionsCount, closedPositionsCount }
}`}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">Instrument-Specific APIs</h3>
          <DocTable
            headers={['Instrument', 'Positions', 'PnL', 'Extra']}
            rows={[
              ['Perps', 'GET /api/perps/positions', 'GET /api/perps/pnl', 'GET /api/perps/funding/:id'],
              ['Options', 'GET /api/options/positions', 'GET /api/options/pnl', '—'],
              ['Lending', 'GET /api/lending/positions', 'GET /api/lending/pnl', '—'],
              ['Spot', 'GET /api/pnl/positions', 'GET /api/pnl/total', 'GET /api/pnl/hourly'],
            ]}
          />
          <h3 className="text-sm font-semibold mt-6 mb-2">Order Types by Instrument</h3>
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            The unified <Code>orders</Code> table uses <Code>instrument_type</Code> to differentiate:
          </p>
          <DocTable
            headers={['Instrument', 'instrument_type', 'Orders Per Action', 'Extra Fields']}
            rows={[
              ['Spot', 'spot', '2 (linked sell + buy)', 'linked_order_id'],
              ['Perps', 'perp', '1', 'position_side, leverage, reduce_only, margin_type'],
              ['Options', 'option', '1', 'option_type, strike_price, expiry, underlying_symbol'],
              ['Lending', 'lending', '1', 'lending_action, interest_rate_mode'],
            ]}
          />
        </>
      )

    // ================================================================
    // NEW EXAMPLES: PERPS, OPTIONS, LENDING
    // ================================================================
    case 'example-perps':
      return (
        <>
          <DocHeader title="Example: Perps Strategy" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Leveraged directional trading with automatic position and funding tracking.
          </p>
          <CodeBlock
            title="Long ETH with Leverage"
            code={`async function execute(dt) {
  // Check current mark price and funding rate
  const mark = await dt.binanceFutures.getMarkPrice('ETHUSDT')
  console.log('ETH mark price:', mark.markPrice)
  console.log('Funding rate:', mark.fundingRate)

  // Open 10x leveraged long
  const entry = await dt.binanceFutures.openLong({
    symbol: 'ETHUSDT',
    quantity: 1,
    leverage: 10,
    marginType: 'CROSS'
  })
  console.log('Opened long @ ', entry.avgPrice)

  // Monitor position
  const positions = await dt.binanceFutures.getPositions('ETHUSDT')
  for (const p of positions) {
    console.log('Unrealized PnL:', p.unRealizedProfit)
    console.log('Liquidation price:', p.liquidationPrice)
  }

  // Close when done
  await dt.binanceFutures.closeLong({ symbol: 'ETHUSDT', quantity: 1 })
  console.log('Position closed')

  // Check realized PnL
  const pnl = dt.pnl.getTotal()
  console.log('Total PnL:', pnl.totalPnl)
  await dt.close()
}`}
          />
          <CodeBlock
            title="Short with Stop Logic"
            code={`async function execute(dt) {
  // Short BTC with 5x leverage
  await dt.binanceFutures.openShort({
    symbol: 'BTCUSDT',
    quantity: 0.01,
    leverage: 5
  })

  // Poll price and close at target
  for (let i = 0; i < 60; i++) {
    const mark = await dt.binanceFutures.getMarkPrice('BTCUSDT')
    const positions = await dt.binanceFutures.getPositions('BTCUSDT')

    if (positions.length === 0) break

    const pnl = parseFloat(positions[0].unRealizedProfit)
    console.log('Mark:', mark.markPrice, 'PnL:', pnl)

    // Take profit at $50 or stop loss at -$30
    if (pnl > 50 || pnl < -30) {
      await dt.binanceFutures.closeShort({ symbol: 'BTCUSDT', quantity: 0.01 })
      console.log(pnl > 0 ? 'Take profit!' : 'Stop loss!')
      break
    }

    await new Promise(r => setTimeout(r, 5000))
  }
  await dt.close()
}`}
          />
        </>
      )

    case 'example-options':
      return (
        <>
          <DocHeader title="Example: Options Strategy" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Options trading with Greeks monitoring and premium-based PnL.
          </p>
          <CodeBlock
            title="Buy Call Spread"
            code={`async function execute(dt) {
  // Buy a call (long leg)
  await dt.binanceOptions.buyCall({
    underlying: 'ETH',
    strikePrice: 4000,
    expiry: '2026-03-28',
    contracts: 5
  })

  // Sell a higher strike call (short leg)
  await dt.binanceOptions.sellCall({
    underlying: 'ETH',
    strikePrice: 4500,
    expiry: '2026-03-28',
    contracts: 5
  })

  console.log('Call spread opened: long 4000C / short 4500C')

  // Monitor Greeks
  const longMark = await dt.binanceOptions.getMarkPrice('ETH-260328-4000-C')
  const shortMark = await dt.binanceOptions.getMarkPrice('ETH-260328-4500-C')

  console.log('Long delta:', longMark.delta, 'Short delta:', shortMark.delta)
  console.log('Net delta:', parseFloat(longMark.delta) - parseFloat(shortMark.delta))
  console.log('Long IV:', longMark.markIV, 'Short IV:', shortMark.markIV)

  // The OptionsExpiryChecker will auto-settle at expiry
  await dt.close()
}`}
          />
        </>
      )

    case 'example-lending':
      return (
        <>
          <DocHeader title="Example: Lending Strategy" />
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            Aave V3 supply/borrow operations with automatic interest tracking.
          </p>
          <CodeBlock
            title="Supply & Earn Yield on Base"
            code={`async function execute(dt) {
  const usdcAddress = dt.base.tokens['USDC'].address

  // Supply USDC to earn yield
  await dt.base.aave.supply({
    asset: usdcAddress,
    assetSymbol: 'USDC',
    amount: '10000'
  })
  console.log('Supplied 10,000 USDC to Aave on Base')

  // Check account data
  const account = await dt.base.aave.getUserAccountData()
  console.log('Collateral:', account.totalCollateralUsd, 'USD')
  console.log('Health Factor:', account.healthFactor)
  console.log('Available to borrow:', account.availableBorrowsUsd, 'USD')

  // Interest accrues automatically (tracked every 5min)
  // Wait and check...
  await new Promise(r => setTimeout(r, 60000))

  // Withdraw with interest
  await dt.base.aave.withdraw({
    asset: usdcAddress,
    assetSymbol: 'USDC',
    amount: 'max'
  })
  console.log('Withdrawn all USDC + interest')

  await dt.close()
}`}
          />
          <CodeBlock
            title="Leveraged Yield: Supply + Borrow Loop"
            code={`async function execute(dt) {
  const wethAddress = dt.ethereum.tokens['WETH'].address
  const usdcAddress = dt.ethereum.tokens['USDC'].address

  // Supply ETH as collateral
  await dt.ethereum.aave.supply({
    asset: wethAddress,
    assetSymbol: 'WETH',
    amount: '5.0'
  })

  // Borrow USDC against ETH collateral
  await dt.ethereum.aave.borrow({
    asset: usdcAddress,
    assetSymbol: 'USDC',
    amount: '5000',
    interestRateMode: 2  // variable
  })

  // Monitor health factor
  const account = await dt.ethereum.aave.getUserAccountData()
  console.log('Health Factor:', account.healthFactor)

  if (account.healthFactor < 1.5) {
    console.log('WARNING: Health factor low, repaying...')
    await dt.ethereum.aave.repay({
      asset: usdcAddress,
      assetSymbol: 'USDC',
      amount: 'max'
    })
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

// ================================================================
// HELPER COMPONENTS
// ================================================================

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
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded border border-border overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border bg-surface-hover flex items-center justify-between">
        <span className="text-2xs text-text-tertiary">{title}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-2xs text-text-tertiary hover:text-foreground transition-colors"
        >
          {copied ? (
            <>
              <Check size={12} />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language="javascript"
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '12px',
          background: '#1a1d27',
          fontSize: '11px',
          lineHeight: '1.625',
        }}
        codeTagProps={{
          style: { fontFamily: 'inherit' },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

function DocTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="rounded border border-border bg-surface overflow-hidden">
      <table className="w-full text-2xs">
        <thead>
          <tr className="border-b border-border bg-surface-hover">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-1.5 font-semibold text-text-tertiary uppercase tracking-wider">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5 text-text-secondary">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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

function NetworkDoc({
  name,
  accessor,
  chainId,
  type,
  settlement,
  explorer,
  native,
  protocols,
  tokens,
  notes,
  testnet,
}: {
  name: string
  accessor: string
  chainId: number
  type: string
  settlement: string
  explorer: string
  native: string
  protocols: string[]
  tokens: string[]
  notes?: string
  testnet?: boolean
}) {
  return (
    <>
      <DocHeader title={name} subtitle={accessor} />
      {testnet && (
        <p className="text-xs text-yellow-500 bg-yellow-500/10 rounded px-3 py-1.5 mb-3">
          Testnet — uses fake tokens with zero financial risk. See Testnet Setup for funding.
        </p>
      )}
      <DocTable
        headers={['Property', 'Value']}
        rows={[
          ['Chain ID', chainId.toString()],
          ['Type', type],
          ['Settlement', settlement],
          ['Explorer', explorer],
          ['Native Currency', native],
          ['Protocols', protocols.join(', ')],
          ['Tokens', tokens.join(', ')],
        ]}
      />
      {notes && (
        <p className="text-xs text-text-secondary leading-relaxed mt-3">{notes}</p>
      )}
      <CodeBlock
        title="Usage"
        code={`async function execute(dt) {
  const chain = ${accessor}
  if (!chain) {
    console.error('${name} not configured. Assign an account in Accounts tab.')
    return
  }

  // Get swap quote
  const quote = await chain.uniswapV3.getQuote({
    tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0'
  })
  console.log('Rate:', quote.exchangeRate, 'USDC/WETH')

  // Execute swap
  const result = await chain.uniswapV3.swap({
    tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '0.1'
  })
  console.log('TX:', result.transactionHash)
}`}
      />
    </>
  )
}
