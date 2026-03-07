# MEGA QUANT

Enterprise quantitative trading platform with multi-protocol DEX/CEX execution, real-time price aggregation, sandboxed strategy scripting, and Uniswap V4 Hook development — packaged as an Electron desktop app.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 33 |
| Frontend | React 18 + TypeScript + Vite 6 |
| Backend | Express 4 + TypeScript |
| Database | SQLite 3 (better-sqlite3) |
| Blockchain | ethers.js v6 + viem |
| Styling | Tailwind CSS 3 + Radix UI |
| State | Zustand + TanStack React Query |
| Real-Time | WebSocket (ws) |
| Code Editor | Monaco Editor |
| Charts | Lightweight Charts |
| Smart Contracts | Solidity (Foundry/Forge) |

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- macOS (Electron builder currently targets DMG)

## Getting Started

```bash
# Clone the repo
git clone <repo-url> && cd mega-quant

# Install root + frontend dependencies
npm install

# Install backend dependencies
cd backend && npm install && cd ..

# Copy environment files
cp .env.example .env
cp backend/.env.example backend/.env

# Start everything (backend + Vite + Electron)
npm start
```

This runs three processes concurrently:
1. **Backend** — Express API on `http://localhost:3001` (tsx watch, auto-restarts on changes)
2. **Frontend** — Vite dev server on `http://localhost:5173` (HMR)
3. **Electron** — Desktop window loading from the Vite dev server

### Running individually

```bash
# Backend only
npm run backend:dev

# Frontend only (opens in browser, no Electron)
npm run dev

# Type-check
npx tsc --noEmit

# Build frontend
npm run build

# Build backend
npm run build:backend

# Build macOS DMG
npm run dist
```

## Project Structure

```
mega-quant/
├── backend/                    # Express API server
│   └── src/
│       ├── db/                 # SQLite schema & queries (25 tables)
│       ├── lib/
│       │   ├── strategy/       # Sandboxed VM strategy runner
│       │   └── trading/        # Trading engine
│       │       ├── protocols/  # Uniswap V3/V4, 1inch, Aave V3
│       │       ├── cex/        # Binance Spot, Futures, Options
│       │       ├── oracles/    # Chainlink
│       │       ├── services/   # PriceAggregator, DefiLlama, FundingTracker,
│       │       │               # OptionsExpiryChecker, AaveInterestTracker
│       │       ├── orders/     # OrderManager
│       │       ├── pnl/        # PnL engines (Spot, Perp, Options, Lending) + snapshotter
│       │       └── config/     # Token & chain registries
│       ├── routes/             # 19 Express route modules
│       ├── services/           # WebSocket, encryption, key stores,
│       │                       # HookOrderListener, TWAP service
│       └── server.ts           # App entry, middleware, route mounting
│
├── contracts/                  # Solidity smart contracts (Foundry)
│   └── src/
│       ├── MegaQuantHook.sol   # Uniswap V4 Hook (limit orders, stop orders,
│       │                       # bracket orders, EWMA dynamic fees)
│       ├── MegaQuantRouter.sol # Swap router + order placement
│       ├── PoolRegistry.sol    # On-chain pool discovery registry
│       └── libraries/
│           ├── VolatilityMath.sol  # EWMA variance + fee calculation
│           └── OrderLib.sol        # Order type encoding/decoding
│
├── electron/                   # Electron main + preload
│   ├── main.ts                 # Window creation, backend spawning, IPC
│   └── preload.ts              # Context bridge (backup/restore)
│
├── src/                        # React frontend
│   ├── api/                    # Typed API clients (axios)
│   ├── app/                    # App root, layout, auth gate
│   ├── components/
│   │   ├── ui/                 # Radix UI primitives (button, badge, dialog, etc.)
│   │   ├── shared/             # Reusable components (LogConsole, EmptyState, etc.)
│   │   ├── layout/             # Sidebar, TopBar, StatusBar
│   │   └── charts/             # PnL chart
│   ├── features/               # Feature pages
│   │   ├── dashboard/          # Dashboard with portfolio overview
│   │   ├── strategies/         # Strategy CRUD + Monaco editor + runner
│   │   ├── markets/            # Market overview + token detail (5-source aggregation)
│   │   ├── orders/             # Order management
│   │   ├── analytics/          # P&L analytics
│   │   ├── hooks/              # Uniswap V4 Hook IDE
│   │   ├── settings/           # App settings, backup/restore
│   │   └── docs/               # API & strategy documentation
│   ├── hooks/                  # Custom React hooks (WebSocket, theme, shortcuts)
│   ├── stores/                 # Zustand stores (app, live data, strategy)
│   ├── types/                  # Shared TypeScript interfaces
│   └── styles/                 # Global CSS
│
├── docs/                       # Deep-dive documentation
│   ├── v4-hooks.md             # V4 hook architecture, EWMA, order lifecycle
│   ├── smart-contracts.md      # Contract function reference
│   ├── multi-instrument.md     # Order flows for spot/perps/options/lending
│   └── strategy-sdk.md         # Strategy API reference
│
├── vite.config.ts              # Vite + Electron plugin config
├── tailwind.config.js          # Design system (dark mode, custom colors)
└── tsconfig.json               # TypeScript (strict, path aliases @/*)
```

## Architecture Overview

### Frontend Navigation

No React Router — the app uses a single `activeScreen` state in Zustand. The `Sidebar` component switches between screens: Dashboard, Strategies, Markets, Orders, Analytics, Hooks, Docs, Settings.

Detail pages (Strategy Detail, Token Detail) use a `selectedId` state pattern with conditional rendering within each feature page.

### Backend API

All routes are mounted under `/api/`:

| Route | Purpose |
|-------|---------|
| `/api/security` | Master password setup, unlock, reset |
| `/api/hd-wallets` | HD wallet creation & management |
| `/api/wallets` | Wallet info & balances |
| `/api/strategies` | Strategy CRUD |
| `/api/strategy-runner` | Start/stop/pause/resume strategy execution |
| `/api/strategy-accounts` | Strategy-to-account mapping per network |
| `/api/executions` | Execution lifecycle tracking |
| `/api/trades` | Trade history |
| `/api/trading` | Direct trade execution (swap, quote) |
| `/api/orders` | Order book management |
| `/api/portfolio` | Portfolio snapshot |
| `/api/pnl` | P&L data & snapshots |
| `/api/prices` | Price data (single, batch, aggregated from 5 sources) |
| `/api/perps` | Perpetual futures positions & PnL |
| `/api/options` | Options positions & PnL |
| `/api/lending` | Lending/borrowing positions & PnL |
| `/api/liquidity` | V4 liquidity provision |
| `/api/config-encrypted` | Encrypted API key storage |
| `/api/account-activity` | Activity audit log |

### Strategy Execution

Users write JavaScript in the Monaco Editor. When a strategy runs:

1. Code is saved to the database
2. `StrategyRunner` creates a Node.js VM sandbox
3. A `DeltaTrade` instance is injected as the `dt` parameter
4. The user's `execute(dt)` function runs in the sandbox
5. Built-in helpers: `console.log/warn/error`, `sleep(ms)`, `checkPause()`

Example strategy:

```javascript
async function execute(dt) {
  const chain = dt['unichain-sepolia']
  const v4 = chain.uniswapV4

  // Get current pool state
  const pool = await v4.getPoolInfo('WETH', 'USDC')
  console.log(`WETH/USDC tick: ${pool.currentTick}, fee: ${pool.feePercentage}`)

  // Swap 0.01 WETH → USDC via Uniswap V4
  const swap = await v4.swap({
    tokenIn: 'WETH',
    tokenOut: 'USDC',
    amountIn: '0.01',
    slippage: 0.5
  })
  console.log(`Swapped ${swap.amountIn} WETH for ${swap.amountOut} USDC`)

  // Check PnL
  const pnl = dt.pnl.getTotal()
  console.log(`Realized PnL: $${pnl.totalRealizedPnl.toFixed(4)}`)
}
```

> For the complete strategy API reference, see [docs/strategy-sdk.md](docs/strategy-sdk.md).

### Uniswap V4 Hook Quick Start

MegaQuant includes a custom Uniswap V4 hook that adds advanced order types to on-chain trading. The hook uses **EWMA (Exponentially Weighted Moving Average) volatility tracking** to dynamically adjust swap fees — higher volatility means higher fees, protecting LPs during volatile periods. All hook features are accessible via the `dt.<chain>.uniswapV4` object in strategies.

> For deep dives on hook architecture, EWMA math, and order lifecycle, see [docs/v4-hooks.md](docs/v4-hooks.md).

```javascript
async function execute(dt) {
  const EXPLORER = 'https://sepolia.uniscan.xyz'
  const chain = dt['unichain-sepolia']
  const v4 = chain.uniswapV4

  console.log('========================================')
  console.log('  MegaQuant V4 Hook Demo')
  console.log('  Chain: Unichain Sepolia (1301)')
  console.log('========================================\n')

  // ──────────────────────────────────────────────
  // STEP 1: Pool Discovery via PoolRegistry
  // ──────────────────────────────────────────────
  // The PoolRegistry contract (0x680762A6...) stores metadata for every
  // pool created with our MegaQuantHook. This lets strategies discover
  // available pools on-chain without hardcoding addresses.
  console.log('[1/9] Querying PoolRegistry for registered pools...')
  const pools = await v4.getPools()
  console.log(`  Found ${pools.length} pool(s):`)
  for (const p of pools) {
    console.log(`    - ${p.name} | token0=${p.token0} token1=${p.token1}`)
    console.log(`      tickSpacing=${p.tickSpacing} | active=${p.active}`)
    console.log(`      Pool ID: ${p.poolId}`)
  }
  console.log(`  Registry: ${EXPLORER}/address/0x680762A631334098eeF5F24EAAafac0F07Cb2e3a\n`)

  // ──────────────────────────────────────────────
  // STEP 2: Read Live Pool State
  // ──────────────────────────────────────────────
  // Reads the pool's on-chain state directly from the V4 PoolManager.
  // The "tick" encodes the current price — each tick is a 0.01% price step.
  // sqrtPriceX96 is Uniswap's internal Q64.96 fixed-point price encoding.
  // The fee shown here is the DYNAMIC fee set by our hook's volatility model.
  console.log('[2/9] Reading live WETH/USDC pool state from PoolManager...')
  const pool = await v4.getPoolInfo('WETH', 'USDC')
  console.log(`  Pool ID:      ${pool.poolId}`)
  console.log(`  Current Tick:  ${pool.currentTick}`)
  console.log(`  sqrtPriceX96:  ${pool.sqrtPriceX96}`)
  console.log(`  Liquidity:     ${pool.liquidity}`)
  console.log(`  Dynamic Fee:   ${pool.fee} bps (${pool.feePercentage})`)
  console.log(`  Hook: ${EXPLORER}/address/0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0\n`)

  // ──────────────────────────────────────────────
  // STEP 3: Volatility-Based Dynamic Fee
  // ──────────────────────────────────────────────
  // Our hook tracks an EWMA (Exponentially Weighted Moving Average) of
  // tick changes across swaps. Higher variance = higher fee (0.05% to 1%).
  // This protects LPs during volatile conditions, similar to how traditional
  // market makers widen spreads during high volatility.
  console.log('[3/9] Checking volatility-based dynamic fee...')
  const { fee, feePercentage } = await v4.getVolatilityFee('WETH', 'USDC')
  console.log(`  Current Fee: ${fee} bps (${feePercentage})`)
  console.log(`  Fee range: 500 bps (0.05%) calm → 10000 bps (1.0%) volatile`)
  console.log(`  The hook\'s beforeSwap() callback overrides the pool fee`)
  console.log(`  with this dynamically computed value on every swap.\n`)

  // ──────────────────────────────────────────────
  // STEP 4: Execute a V4 Swap (with hook-managed fees)
  // ──────────────────────────────────────────────
  // A standard swap through Uniswap V4. Under the hood:
  //   1. beforeSwap() → hook computes EWMA fee, returns dynamic override
  //   2. PoolManager executes the swap at the dynamic fee
  //   3. afterSwap() → hook updates volatility state, checks limit/stop triggers
  console.log('[4/9] Executing swap: 0.0001 WETH → USDC via V4...')
  const swap = await v4.swap({
    tokenIn: 'WETH',
    tokenOut: 'USDC',
    amountIn: '0.0001',
    slippage: 0.5       // 0.5% max slippage tolerance
  })
  console.log(`  Swap complete!`)
  console.log(`  Amount In:  ${swap.amountIn} WETH`)
  console.log(`  Amount Out: ${swap.amountOut} USDC`)
  console.log(`  TX Hash:    ${swap.txHash}`)
  console.log(`  View TX:    ${EXPLORER}/tx/${swap.txHash}\n`)

  // ──────────────────────────────────────────────
  // STEP 5: Place a Limit Order (on-chain, via hook)
  // ──────────────────────────────────────────────
  // Limit orders are placed directly into the MegaQuantHook contract.
  // Your tokens are transferred to the hook and you receive ERC1155
  // "claim tokens" as a receipt (tokenId = keccak256(poolId, tick, direction)).
  //
  // When any future swap crosses your tick, the hook's afterSwap()
  // callback automatically fills the order. No keeper or off-chain
  // matching needed — execution is fully on-chain and atomic.
  console.log('[5/9] Placing LIMIT ORDER: Sell 0.001 WETH at tick 200250...')
  const limit = await v4.limitOrder({
    tokenIn: 'WETH',
    tokenOut: 'USDC',
    amountIn: '0.001',
    tick: 200250,       // ~0.6% below current tick (~$2012 USDC/WETH)
    deadline: 86400     // Order expires in 24 hours (seconds from now)
  })
  console.log(`  Limit Order Placed!`)
  console.log(`  Order ID:   ${limit.orderId}`)
  console.log(`  Tick:        ${limit.tick}`)
  console.log(`  Amount:      ${limit.amountIn} WETH`)
  console.log(`  TX Hash:     ${limit.txHash}`)
  console.log(`  View TX:     ${EXPLORER}/tx/${limit.txHash}`)
  console.log(`  When price crosses tick ${limit.tick}, the hook auto-fills this order.\n`)

  // ──────────────────────────────────────────────
  // STEP 6: Place a Stop-Loss Order (on-chain, via hook)
  // ──────────────────────────────────────────────
  // Stop orders work like limit orders but trigger in the OPPOSITE direction.
  // A stop-loss at tick 200190 means: "if the price drops to that level, sell."
  //
  // Internally, the hook stores these separately from limit orders
  // (different mapping: pendingStopOrders vs pendingOrders) and checks
  // them in afterSwap() when the tick moves in the stop direction.
  console.log('[6/9] Placing STOP-LOSS ORDER: Sell 0.001 WETH if tick drops to 200190...')
  const stop = await v4.stopOrder({
    tokenIn: 'WETH',
    tokenOut: 'USDC',
    amountIn: '0.001',
    tick: 200190        // ~1.2% below current tick (~$2024 USDC/WETH stop-loss)
  })
  console.log(`  Stop-Loss Order Placed!`)
  console.log(`  Order ID:   ${stop.orderId}`)
  console.log(`  Tick:        ${stop.tick}`)
  console.log(`  Amount:      ${stop.amountIn} WETH`)
  console.log(`  TX Hash:     ${stop.txHash}`)
  console.log(`  View TX:     ${EXPLORER}/tx/${stop.txHash}`)
  console.log(`  If price drops past tick ${stop.tick}, hook auto-sells to cut losses.\n`)

  // ──────────────────────────────────────────────
  // STEP 7: Place a Bracket (OCO) Order
  // ──────────────────────────────────────────────
  // A bracket order = take-profit + stop-loss linked together.
  // "OCO" = One-Cancels-Other. When EITHER side fills:
  //   1. The filled side executes the swap
  //   2. afterSwap() detects the fill via bracketPartner mapping
  //   3. The OTHER side is automatically cancelled (tokens returned)
  //
  // This is the standard TP/SL bracket from traditional trading,
  // implemented fully on-chain with no off-chain keeper required.
  console.log('[7/9] Placing BRACKET (OCO) ORDER: TP at tick 200370, SL at tick 200190...')
  const bracket = await v4.bracketOrder({
    tokenIn: 'WETH',
    tokenOut: 'USDC',
    amountIn: '0.001',  // Amount per side (total cost = 2x this)
    limitTick: 200370,  // Take-profit tick (~0.6% above current = ~$1988 USDC/WETH)
    stopTick: 200190,   // Stop-loss tick (~1.2% below current = ~$2024 USDC/WETH)
    deadline: 86400
  })
  console.log(`  Bracket Order Placed! (2 linked on-chain orders)`)
  console.log(`  Take-Profit ID: ${bracket.limitOrderId}  (tick ${bracket.limitTick})`)
  console.log(`  Stop-Loss ID:   ${bracket.stopOrderId}  (tick ${bracket.stopTick})`)
  console.log(`  TX Hash:        ${bracket.txHash}`)
  console.log(`  View TX:        ${EXPLORER}/tx/${bracket.txHash}`)
  console.log(`  These are linked via bracketPartner mapping on-chain.`)
  console.log(`  When one fills, the hook\'s afterSwap automatically cancels the other.\n`)

  // ──────────────────────────────────────────────
  // STEP 8: View All Pending Hook Orders
  // ──────────────────────────────────────────────
  // All hook orders (limit, stop, bracket) are recorded in the database
  // with protocol='uniswap-v4-hook'. The HookOrderListener service polls
  // on-chain events to detect fills and update statuses automatically.
  console.log('[8/9] Fetching all hook orders for this strategy...')
  const orders = await v4.getMyHookOrders()
  console.log(`  Total orders: ${orders.length}`)
  console.log(`  ┌──────────┬────────┬────────┬──────────┬──────────────────────┐`)
  console.log(`  │ Type     │ Side   │ Tick   │ Status   │ Order ID             │`)
  console.log(`  ├──────────┼────────┼────────┼──────────┼──────────────────────┤`)
  for (const o of orders) {
    const type = o.orderType.padEnd(8)
    const side = o.side.padEnd(6)
    const tick = String(o.tick).padEnd(6)
    const status = o.status.padEnd(8)
    const id = o.hookOrderId.slice(0, 20)
    console.log(`  │ ${type} │ ${side} │ ${tick} │ ${status} │ ${id} │`)
  }
  console.log(`  └──────────┴────────┴────────┴──────────┴──────────────────────┘`)
  console.log(`  Pending: ${orders.filter(o => o.status === 'pending').length}`)
  console.log(`  Orders are visible in the Hooks tab of the MegaQuant UI.\n`)

  // ──────────────────────────────────────────────
  // STEP 9: Cancel Orders & Check PnL
  // ──────────────────────────────────────────────
  // Cancelling sends an on-chain tx to the hook contract, which
  // burns your ERC1155 claim tokens and returns your deposited tokens.
  // The OrderManager updates the DB status to 'cancelled'.
  console.log('[9/9] Cancelling limit order and checking PnL...')
  const cancelResult = await v4.cancelLimitOrder('WETH', 'USDC', 200250)
  console.log(`  Limit order cancelled!`)
  console.log(`  TX Hash:  ${cancelResult.txHash}`)
  console.log(`  View TX:  ${EXPLORER}/tx/${cancelResult.txHash}`)

  // PnL is unified across all protocols. Hook order fills feed into
  // the same FIFO cost-basis engine used for V3/CEX trades.
  const pnl = dt.pnl.getTotal()
  console.log(`\n  Portfolio PnL Summary:`)
  console.log(`    Realized PnL:   $${pnl.totalRealizedPnl.toFixed(4)}`)
  console.log(`    Unrealized PnL: $${(pnl.totalUnrealizedPnl || 0).toFixed(4)}`)

  console.log('\n========================================')
  console.log('  Demo Complete!')
  console.log('  All transactions are on Unichain Sepolia.')
  console.log('  Click any TX hash above to view on block explorer.')
  console.log('========================================')
}
```

### Trading Engine

```
DeltaTrade (facade)
├── ChainProxy (ethereum, base, unichain, sepolia, base-sepolia, unichain-sepolia)
│   ├── UniswapV3Protocol    — swap, getQuote
│   ├── UniswapV4Protocol    — swap, limitOrder, stopOrder, bracketOrder, twap, +more
│   ├── OneInchProtocol      — aggregated swap (ethereum, base)
│   ├── AaveV3Protocol       — supply, borrow, repay, withdraw (ethereum, base, sepolia)
│   └── ChainlinkOracle     — getPrice (ethereum)
├── BinanceProxy             — spot buy/sell
├── BinanceFuturesProxy      — openLong, closeLong, openShort, closeShort
├── BinanceOptionsProxy      — buyCall, sellCall, buyPut, sellPut
├── OrderManager
└── PnlEngine (FIFO cost basis) + PerpPnlEngine + OptionsPnlEngine + LendingPnlEngine
```

### Price Aggregation

The `PriceAggregator` fetches from 5 sources in parallel via `Promise.allSettled`:

- **Binance** (CEX spot price)
- **Chainlink** (on-chain oracle)
- **CoinMarketCap** (aggregator)
- **CoinGecko** (aggregator)
- **DefiLlama** (DeFi aggregator)

Returns median price and spread percentage across available sources.

### Real-Time Updates

`LiveDataService` runs a WebSocket server on the same HTTP server. Message types:

- `trade_execution` — new trade filled
- `price_update` — price tick
- `strategy_update` — strategy state change
- `order_update` — order status change
- `perp_position_update` — perp position opened/closed/funding
- `option_position_update` — option position opened/closed/expired
- `lending_position_update` — lending supply/withdraw/interest
- `ping/pong` — heartbeat (30s interval)

Frontend connects via the `useWebSocket` hook and dispatches messages to Zustand stores.

### Security Model

- **Master password** — required on first launch; hashed and stored
- **Private keys** — AES-256-GCM encrypted with password-derived key
- **HD mnemonics** — AES-256-GCM encrypted
- **API keys** — AES-256-GCM encrypted with separate salt
- **Database backup** — exports the raw SQLite file (encrypted data remains encrypted)
- **App reset** — `POST /api/security/reset` wipes all tables

### Database

SQLite with 25 tables including: `strategies`, `accounts`, `hd_wallets`, `trades`, `positions`, `orders`, `portfolio_snapshots`, `pnl_snapshots`, `strategy_logs`, `app_security`, `api_configs`, `perp_positions`, `options_positions`, `lending_positions`, `funding_payments`, and more. Schema auto-migrates on startup via `backend/src/db/sqlite.ts`.

## Multi-Instrument Trading

MegaQuant supports 4 instrument types, each with its own order lifecycle and PnL engine:

| Instrument | Protocol | How Orders Work | PnL Method |
|-----------|----------|----------------|------------|
| **Spot** | Uniswap V3/V4, 1inch, Binance | Two-sided (SELL + BUY linked) | FIFO cost basis |
| **Perps** | Binance Futures | Single-sided directional bets | Mark-to-market + funding |
| **Options** | Binance Options | Single-sided premium-based | Premium delta + expiry settlement |
| **Lending** | Aave V3 | Single-sided deposits/borrows | Interest accrual via protocol index |

> For complete order lifecycle diagrams, PnL engine details, and strategy examples for each instrument, see [docs/multi-instrument.md](docs/multi-instrument.md).

## Smart Contracts

Uniswap V4 Hook contracts live in `contracts/`. Built with Foundry:

```bash
cd contracts
forge build
forge test
```

Key contracts:

| Contract | Purpose |
|----------|---------|
| **MegaQuantHook.sol** | Uniswap V4 hook — EWMA dynamic fees, limit orders, stop-loss orders, bracket (OCO) orders |
| **MegaQuantRouter.sol** | Swap router + order placement (handles V4 unlock callback pattern) |
| **PoolRegistry.sol** | On-chain registry for discovering MegaQuant-managed pools |
| **VolatilityMath.sol** | EWMA variance calculation + fee interpolation library |
| **OrderLib.sol** | Order type encoding/decoding library |

> For full function signatures, state variables, and interaction flow diagrams, see [docs/smart-contracts.md](docs/smart-contracts.md).

### Deployed Contract Addresses

#### Unichain Sepolia (Chain ID: 1301)

| Contract | Address | Explorer |
|----------|---------|----------|
| PoolManager (Uniswap) | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` | [View](https://sepolia.uniscan.xyz/address/0x00b036b58a818b1bc34d502d3fe730db729e62ac) |
| MegaQuantHook | `0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0` | [View](https://sepolia.uniscan.xyz/address/0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0) |
| MegaQuantRouter | `0x608AEfA1DFD3621554a948E20159eB243C76235F` | [View](https://sepolia.uniscan.xyz/address/0x608AEfA1DFD3621554a948E20159eB243C76235F) |
| PoolRegistry | `0x680762A631334098eeF5F24EAAafac0F07Cb2e3a` | [View](https://sepolia.uniscan.xyz/address/0x680762A631334098eeF5F24EAAafac0F07Cb2e3a) |

#### Mainnet

| Contract | Address | Explorer |
|----------|---------|----------|
| MegaQuantHook | _Not yet deployed_ | — |
| MegaQuantRouter | _Not yet deployed_ | — |
| PoolRegistry | _Not yet deployed_ | — |

## Environment Variables

### Frontend (`.env`)

```bash
VITE_API_BASE_URL=http://localhost:3001
```

### Backend (`backend/.env`)

```bash
PORT=3001
NODE_ENV=development
# MEGAQUANT_DATA_DIR=/path/to/data  # optional: override DB location
```

API keys for price sources and exchanges are configured through the Settings page in the app (stored encrypted in the database), not in `.env`.

## Documentation

| Document | Description |
|----------|-------------|
| [docs/v4-hooks.md](docs/v4-hooks.md) | V4 hook architecture, EWMA volatility math, order lifecycle, callback reference |
| [docs/smart-contracts.md](docs/smart-contracts.md) | All contract functions, state variables, and interaction flow diagrams |
| [docs/multi-instrument.md](docs/multi-instrument.md) | Order lifecycles for spot/perps/options/lending, PnL engines, background services |
| [docs/strategy-sdk.md](docs/strategy-sdk.md) | Complete strategy API — sandbox globals, DeltaTrade, all protocol methods |

## Contributing

1. Fork the repo and create a feature branch
2. Run `npx tsc --noEmit` to verify type safety
3. Run `npx vite build` to verify the build passes
4. Keep PRs focused — one feature or fix per PR
5. Follow existing patterns (Zustand stores, API client modules, Tailwind utility classes)

### Code Conventions

- **TypeScript strict mode** — no `any` unless unavoidable
- **Path aliases** — use `@/` for imports from `src/`
- **API clients** — each module exports a plain object with typed methods (see `src/api/`)
- **Components** — feature pages in `src/features/`, reusable UI in `src/components/`
- **Styling** — Tailwind utility classes; custom design tokens defined in `tailwind.config.js`
- **State** — Zustand for global state, local `useState` for component state, TanStack Query for server cache
