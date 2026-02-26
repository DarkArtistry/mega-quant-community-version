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
│       │       ├── protocols/  # Uniswap V3/V4, 1Inch
│       │       ├── cex/        # Binance
│       │       ├── oracles/    # Chainlink
│       │       ├── services/   # PriceAggregator, DefiLlama
│       │       ├── orders/     # OrderManager
│       │       ├── pnl/        # P&L engine + snapshotter
│       │       └── config/     # Token & chain registries
│       ├── routes/             # 14 Express route modules
│       ├── services/           # WebSocket, encryption, key stores
│       └── server.ts           # App entry, middleware, route mounting
│
├── contracts/                  # Solidity smart contracts
│   └── src/
│       ├── MegaQuantHook.sol   # Uniswap V4 Hook
│       └── MegaQuantRouter.sol # Multi-protocol swap router
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
| `/api/config-encrypted` | Encrypted API key storage |
| `/api/account-activity` | Activity audit log |

### Strategy Execution

Users write JavaScript in the Monaco Editor. When a strategy runs:

1. Code is saved to the database
2. `StrategyRunner` creates a Node.js VM sandbox
3. A `DeltaTrade` instance is injected as the `dt` global
4. The user's `execute()` function runs in the sandbox
5. Built-in helpers: `console.log/warn/error`, `sleep(ms)`, `checkPause()`

Example strategy:

```javascript
async function execute() {
  const price = await dt.getPrice('ETH', 'USD')
  console.log(`ETH price: $${price}`)

  if (price < 2000) {
    await dt.swap('ETH', 'USDC', '0.1', { protocol: 'uniswap-v3' })
  }

  await sleep(60000) // wait 1 minute
}
```

### Trading Engine

```
DeltaTrade (facade)
├── ProtocolProxy
│   ├── UniswapV3Protocol
│   ├── UniswapV4Protocol (with custom hooks)
│   ├── OneInchProtocol
│   └── BinanceProxy (CEX)
├── ChainProxy (Ethereum, Polygon, Arbitrum, Optimism)
├── OrderManager
└── PnlEngine (FIFO cost basis)
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

SQLite with 25 tables including: `strategies`, `accounts`, `hd_wallets`, `trades`, `positions`, `orders`, `portfolio_snapshots`, `pnl_snapshots`, `strategy_logs`, `app_security`, `api_configs`, and more. Schema auto-migrates on startup via `backend/src/db/sqlite.ts`.

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

## Smart Contracts

Uniswap V4 Hook contracts live in `contracts/`. Built with Foundry:

```bash
cd contracts
forge build
forge test
```

Key contracts:
- `MegaQuantHook.sol` — custom Uniswap V4 hook with before/after swap logic
- `MegaQuantRouter.sol` — multi-protocol swap router

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
