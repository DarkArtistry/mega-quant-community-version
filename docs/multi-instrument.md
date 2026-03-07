# Multi-Instrument Trading Architecture

MegaQuant supports 4 types of financial instruments, each with its own order flow, position model, and profit/loss calculation. This document explains how each instrument works, how orders flow through the system, and why each is handled differently.

> **New to trading?** An "instrument" is a type of financial product you can trade. Buying ETH on Uniswap is different from betting on ETH's future price (futures) or buying the right to buy ETH later at a fixed price (options). Each behaves differently, so each needs different tracking.

## Table of Contents

1. [Instrument Overview](#instrument-overview)
2. [Order Lifecycles by Product](#order-lifecycles-by-product)
3. [Database Schema](#database-schema)
4. [PnL Engines](#pnl-engines)
5. [Trading Proxies](#trading-proxies)
6. [Background Services](#background-services)
7. [API Routes](#api-routes)
8. [Strategy Code Examples](#strategy-code-examples)
9. [Architecture Decisions](#architecture-decisions)

---

## Instrument Overview

| Instrument | What It Is | Protocol | PnL Engine | Position Table |
|-----------|-----------|----------|------------|----------------|
| **Spot** | Buy/sell tokens directly | Uniswap V3/V4, 1inch, Binance Spot | `PnlEngine` (FIFO) | `positions` |
| **Perps** | Bet on price direction with leverage | Binance Futures | `PerpPnlEngine` | `perp_positions` |
| **Options** | Buy the right (not obligation) to trade at a fixed price | Binance Options | `OptionsPnlEngine` | `options_positions` |
| **Lending** | Earn interest by lending, or borrow against collateral | Aave V3 | `LendingPnlEngine` | `lending_positions` |

**Key point**: All instruments share a unified `orders` table with an `instrument_type` column. This keeps order management consistent while allowing each instrument to have its own position tracking and PnL calculation.

---

## Order Lifecycles by Product

Each trading product has a fundamentally different order lifecycle. Understanding these differences is essential for understanding how MegaQuant tracks positions and calculates profit/loss.

### Spot Swaps (DEX & CEX)

**What happens**: You exchange one token for another at the current market price. You give up Token A and receive Token B.

**Why it's "two-sided"**: A swap is actually two simultaneous trades — you're SELLING Token A and BUYING Token B. MegaQuant records both sides because your portfolio changes for both tokens.

```
Strategy calls: await dt['unichain-sepolia'].uniswapV4.swap({
  tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0'
})

1. BEFORE execution: Record intent (crash protection)
   → INSERT order (status='submitted')

2. EXECUTION: On-chain swap via Uniswap
   → Permit2 approval → Router swap → Wait for tx confirmation
   → Capture: amountIn, amountOut, gas cost, slippage

3. AFTER execution: Record BOTH sides
   → SELL order: { side: 'sell', asset: 'WETH', quantity: '1.0', status: 'filled' }
   → BUY order:  { side: 'buy', asset: 'USDC', quantity: '2012.5', status: 'filled' }
   → Orders linked via linked_order_id

4. PnL update: PnlEngine.processTrade() for BOTH tokens
   → WETH: reduces/closes long position (realizes PnL if any)
   → USDC: opens/adds to long position (records cost basis)

5. Result in database:
   → 2 orders (SELL + BUY, both 'filled', linked)
   → 1 trade record
   → 2 position updates (FIFO cost basis)
```

**Key characteristic**: Instant execution. When the transaction confirms, the swap is done. No waiting for a fill.

### V4 Hook Limit Orders

**What happens**: You deposit tokens into the hook contract at a specific price. When the market price reaches your target, the order fills automatically on-chain.

**Why it's different from a spot swap**: The order doesn't fill immediately. It could take minutes, hours, or days — whenever someone else's swap moves the price past your tick.

```
Strategy calls: await v4.limitOrder({
  tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0', tick: 200250
})

1. PLACEMENT: On-chain transaction
   → MegaQuantRouter.placeLimitOrder() → MegaQuantHook.placeOrder()
   → Your WETH transferred to hook contract
   → You receive ERC1155 claim tokens
   → DB: INSERT order (status='pending', protocol='uniswap-v4-hook')

2. WAITING: Order sits on-chain
   → HookOrderListener polls every 15 seconds
   → Checks for OrderExecuted events from FINALIZED blocks only
   → Order visible in Hooks tab of UI

3. FILL: Triggered by another user's swap
   → afterSwap() detects price crossed your tick
   → Hook swaps your tokens internally
   → Emits OrderExecuted event
   → HookOrderListener detects event:
     → Updates order status: 'pending' → 'filled'
     → Records trade + PnL (same two-sided pattern as spot)
     → Broadcasts via WebSocket

4. REDEMPTION: Claim your output tokens
   → hook.redeem() burns claim tokens, sends output
   → Or auto-redemption by HookOrderListener

Alternative ending — CANCELLATION:
   → v4.cancelLimitOrder() → hook.cancelOrder()
   → Burns claim tokens, returns your deposited tokens
   → Order status: 'pending' → 'cancelled'
```

**Key characteristic**: Deferred execution. The fill timing is unknown. A background service monitors for fills.

### V4 Hook Stop-Loss Orders

**What happens**: You set a "safety net" price. If the market drops to that level, your tokens are automatically sold to prevent further losses.

```
Strategy calls: await v4.stopOrder({
  tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0', tick: 200190
})

Lifecycle is identical to limit orders, except:
- Triggers in the OPPOSITE direction (sells when price drops, not when price rises)
- Uses separate on-chain storage (pendingStopOrders mapping)
- Order ID has a "STOP" prefix to avoid collision with limit orders
- Emits StopOrderExecuted event instead of OrderExecuted
```

### V4 Hook Bracket (OCO) Orders

**What happens**: Two linked orders — a take-profit (limit) and a stop-loss. Whichever fills first, the other is automatically cancelled.

```
Strategy calls: await v4.bracketOrder({
  tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0',
  limitTick: 200370, stopTick: 200190
})

1. PLACEMENT: Two orders placed in one transaction
   → Limit order at take-profit tick
   → Stop order at stop-loss tick
   → Linked via bracketPartner mapping on-chain
   → DB: 2 orders (one limit, one stop), both 'pending'

2. FILL: One side triggers
   → If take-profit fills: stop-loss auto-cancelled (tokens returned)
   → If stop-loss fills: take-profit auto-cancelled (tokens returned)
   → BracketPartnerCancelled event emitted

3. RESULT: 1 filled order + 1 cancelled order
```

### Binance Spot Orders

**What happens**: Buy or sell tokens on the Binance centralized exchange.

```
Strategy calls: await dt.binance.buy({
  symbol: 'ETHUSDT', type: 'MARKET', quantity: 1.0
})

1. API call to Binance (api.binance.com)
2. Binance executes the order (usually instant for MARKET)
3. Response includes fills with prices, quantities, commissions
4. Record as spot order (same two-sided pattern as DEX swaps)
5. PnlEngine processes both sides with FIFO cost basis
```

**Key characteristic**: Faster than DEX (no blockchain confirmation wait), but requires Binance API keys and trust in the exchange.

### Perpetual Futures (Binance Futures)

**What happens**: You bet on whether a token's price will go up or down, with leverage. You don't actually buy or sell the token — you open a "position" that gains or loses value based on price movement.

**Why it's "single-sided"**: Unlike a swap, there's no token exchange. You're opening a directional bet. A long ETH perp gains value when ETH goes up and loses when it goes down.

```
Strategy calls: await dt.binanceFutures.openLong({
  symbol: 'ETHUSDT', quantity: 1.0, leverage: 10, marginType: 'CROSS'
})

1. Set leverage (if specified): Binance API call
2. Set margin type (if specified): Binance API call
3. Place order: POST to fapi.binance.com
4. Record: ONE order with instrument_type='perp', position_side='LONG'
5. PerpPnlEngine creates/updates perp position:
   → Tracks entry price, leverage, margin, liquidation price

Closing:
await dt.binanceFutures.closeLong({ symbol: 'ETHUSDT', quantity: 1.0 })
   → Places reduce-only order
   → PerpPnlEngine calculates realized PnL:
     PnL = (exit_price - entry_price) × quantity × direction + funding - fees
   → Position closed, PnL recorded
```

**Key characteristics**:
- **Leverage**: 10x leverage means 10x gains AND 10x losses
- **Funding payments**: Every 8 hours, longs pay shorts (or vice versa) based on the funding rate. The `FundingTracker` service records these automatically.
- **Liquidation**: If losses exceed your margin, the position is forcibly closed
- **No token exchange**: You never actually hold ETH — just a contract referencing its price

### Options (Binance Options)

**What happens**: You buy the RIGHT (not obligation) to buy or sell a token at a specific price by a specific date. You pay a "premium" upfront for this right.

```
Strategy calls: await dt.binanceOptions.buyCall({
  underlying: 'ETH', strikePrice: 4000, expiry: '2026-03-28', contracts: 5
})

1. Construct option symbol: ETH-260328-4000-C
2. Place order via eapi.binance.com
3. Record: ONE order with instrument_type='option'
4. OptionsPnlEngine creates options position:
   → Tracks premium, strike, expiry, option type (CALL/PUT)
   → Updates Greeks (delta, gamma, theta, vega, IV)

At expiry:
   → OptionsExpiryChecker service runs hourly
   → If option is "in the money" (ITM): exercise for profit
   → If option is "out of the money" (OTM): expires worthless, premium lost
```

**Key characteristics**:
- **Time decay**: Options lose value over time (theta). The closer to expiry, the faster the decay.
- **Maximum loss is premium**: If you BUY an option, the most you can lose is what you paid. Unlike futures, you can't get liquidated.
- **Greeks**: Mathematical measures of how the option's value changes with price (delta), volatility (vega), time (theta), etc.
- **Expiry**: Options have a fixed end date. They either settle profitably or expire worthless.

### Lending (Aave V3)

**What happens**: You deposit tokens into Aave to earn interest, or you borrow tokens against your collateral.

```
Strategy calls: await dt.base.aave.supply({
  asset: '0xA0b8...', assetSymbol: 'USDC', amount: '10000'
})

1. On-chain transaction: approve + supply to Aave V3 Pool
2. You receive aTokens (interest-bearing receipt tokens)
3. Record: ONE order with instrument_type='lending', lending_action='supply'
4. LendingPnlEngine creates lending position:
   → Tracks principal, current amount, accrued interest
   → Interest grows automatically via Aave's liquidity index

Interest tracking:
   → AaveInterestTracker runs every 5 minutes
   → Reads Aave's reserve liquidity index
   → current_amount = principal × (current_index / entry_index)
   → PnL = current_amount - principal

Withdrawal:
await dt.base.aave.withdraw({
  asset: '0xA0b8...', assetSymbol: 'USDC', amount: 'max'
})
   → Withdraws all principal + earned interest
   → Position closed, PnL = interest earned
```

**Key characteristics**:
- **Passive income**: Your tokens earn interest while deposited
- **Health factor**: If you borrow, you must maintain sufficient collateral. If the health factor drops below 1, you get liquidated.
- **Variable rates**: Interest rates change based on supply/demand in the lending pool
- **No expiry**: Unlike options/futures, lending positions run indefinitely until you withdraw

---

## Database Schema

### Orders Table (Extended)

All instruments share a single `orders` table with these additional columns:

| Column | Type | Used By | Purpose |
|--------|------|---------|---------|
| `instrument_type` | `'spot' \| 'perp' \| 'option' \| 'lending'` | All | Identifies which PnL engine to use |
| `position_side` | `'LONG' \| 'SHORT'` | Perps | Direction of the bet |
| `leverage` | `number` | Perps | Leverage multiplier (e.g., 10) |
| `reduce_only` | `boolean` | Perps | Whether this only closes a position |
| `margin_type` | `'CROSS' \| 'ISOLATED'` | Perps | How margin is calculated |
| `option_type` | `'CALL' \| 'PUT'` | Options | Type of option |
| `strike_price` | `number` | Options | Price at which option can be exercised |
| `expiry` | `string` | Options | Expiration date |
| `underlying_symbol` | `string` | Options | Underlying asset (e.g., 'ETH') |
| `lending_action` | `'supply' \| 'withdraw' \| 'borrow' \| 'repay'` | Lending | What action was taken |
| `interest_rate_mode` | `'variable' \| 'stable'` | Lending | Aave interest rate type |

### Perp Positions (`perp_positions`)

Tracks leveraged futures positions: entry price, leverage, margin amount, liquidation price, unrealized PnL, accumulated funding payments.

### Options Positions (`options_positions`)

Tracks option contracts: premium paid/received, strike price, expiry, type (call/put), Greeks (delta, gamma, theta, vega, implied volatility).

### Lending Positions (`lending_positions`)

Tracks Aave deposits/borrows: principal amount, current amount (with interest), accrued interest, Aave liquidity index at entry, health factor.

### Funding Payments (`funding_payments`)

Per-position history of funding payments for perps. Recorded automatically by the FundingTracker service every 8 hours.

---

## PnL Engines

Each instrument has its own PnL engine because the math is fundamentally different.

### PnlEngine (Spot)

**File**: `backend/src/lib/trading/pnl/PnlEngine.ts`

**Method**: FIFO (First In, First Out) cost basis. When you sell a token, the cost basis of your OLDEST purchase is used to calculate profit/loss.

**Example**: You bought 1 ETH at $2000, then 1 ETH at $2200. You sell 1 ETH at $2500. PnL = $2500 - $2000 = $500 (uses the first purchase price).

**Key methods**: `processTrade()`, `updateUnrealizedPnl()`, `getTotalPnl()`

### PerpPnlEngine

**File**: `backend/src/lib/trading/pnl/PerpPnlEngine.ts`

**Method**: Mark-to-market with funding. PnL is based on the difference between entry price and current/exit price, multiplied by position size and leverage direction.

**Formula**: `PnL = (exit_price - entry_price) × size × direction + funding - fees`

Where `direction` is +1 for long, -1 for short.

**Key methods**: `processPerp()`, `recordFundingPayment()`, `updateUnrealizedPnl()`

### OptionsPnlEngine

**File**: `backend/src/lib/trading/pnl/OptionsPnlEngine.ts`

**Method**: Premium-based with expiry settlement. PnL is based on the change in option premium, or the settlement value at expiry.

**Formula**: `PnL = (exit_premium - entry_premium) × contracts × direction`

At expiry: `PnL = settlement_value - premium_paid` (for buyers)

**Key methods**: `processOption()`, `updateGreeks()`, `getExpiredOpenPositions()`

### LendingPnlEngine

**File**: `backend/src/lib/trading/pnl/LendingPnlEngine.ts`

**Method**: Interest accrual via Aave's liquidity index. Your balance grows automatically as borrowers pay interest.

**Formula**: `PnL = current_amount - principal` (positive for suppliers, negative for borrowers)

Where `current_amount = principal × (current_index / entry_index)`

**Key methods**: `processLending()`, `updateInterestAccrual()`

### PnlAggregator

**File**: `backend/src/lib/trading/pnl/PnlAggregator.ts`

Combines all 4 engines into a unified portfolio view. `getTotalPnl(strategyId?)` returns a breakdown by instrument type so you can see how much you're making/losing from each type of trading.

---

## Trading Proxies

### BinanceFuturesProxy

**File**: `backend/src/lib/trading/cex/BinanceFuturesProxy.ts`
**API**: `fapi.binance.com` (USDM Futures)
**Access**: `dt.binanceFutures`

| Method | What It Does |
|--------|-------------|
| `openLong({ symbol, quantity, leverage?, marginType? })` | Open a long futures position (profit when price goes up) |
| `closeLong({ symbol, quantity })` | Close a long position (reduce-only order) |
| `openShort({ symbol, quantity, leverage?, marginType? })` | Open a short futures position (profit when price goes down) |
| `closeShort({ symbol, quantity })` | Close a short position (reduce-only order) |

### BinanceOptionsProxy

**File**: `backend/src/lib/trading/cex/BinanceOptionsProxy.ts`
**API**: `eapi.binance.com`
**Access**: `dt.binanceOptions`

| Method | What It Does |
|--------|-------------|
| `buyCall({ underlying, strikePrice, expiry, contracts })` | Buy call options (right to buy at strike price) |
| `sellCall({ underlying, strikePrice, expiry, contracts })` | Sell call options |
| `buyPut({ underlying, strikePrice, expiry, contracts })` | Buy put options (right to sell at strike price) |
| `sellPut({ underlying, strikePrice, expiry, contracts })` | Sell put options |

### AaveV3Protocol

**File**: `backend/src/lib/trading/protocols/AaveV3Protocol.ts`
**Contract**: Aave V3 Pool (on-chain)
**Access**: `dt.<chain>.aave` (supported on: ethereum, base, sepolia)

| Method | What It Does |
|--------|-------------|
| `supply({ asset, assetSymbol, amount })` | Deposit tokens to earn interest |
| `withdraw({ asset, assetSymbol, amount })` | Withdraw tokens (use `'max'` for full withdrawal) |
| `borrow({ asset, assetSymbol, amount, interestRateMode? })` | Borrow tokens against your collateral |
| `repay({ asset, assetSymbol, amount, interestRateMode? })` | Repay borrowed tokens (use `'max'` for full repayment) |

---

## Background Services

These services run automatically in the background, handling things that happen asynchronously (not triggered by user actions).

| Service | Interval | What It Does |
|---------|----------|-------------|
| `FundingTracker` | 1 hour | Polls Binance Futures for funding payments and records them to `funding_payments`. Futures positions pay/receive funding every 8 hours — this service captures those automatically. |
| `OptionsExpiryChecker` | 1 hour | Checks for expired options. In-the-money (ITM) options are exercised for profit. Out-of-the-money (OTM) options expire worthless. Updates positions accordingly. |
| `AaveInterestTracker` | 5 min | Updates interest accrual for Aave positions by reading the reserve liquidity index. This is how your balance grows over time — no on-chain transaction needed. |
| `PnlSnapshotter` | 1 hour | Takes snapshots of all position values across all instruments. Powers the historical PnL charts and time-series analytics. |
| `OrderReconciler` | 30 sec | Checks pending order statuses across DEXs and Binance. Catches any orders that may have filled without proper callback. |
| `HookOrderListener` | 15 sec | Polls for V4 hook events (OrderExecuted, StopOrderExecuted, BracketPartnerCancelled) from finalized blocks. Detects when limit/stop/bracket orders fill. |

---

## API Routes

### Perps

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/perps/positions` | GET | List perp positions (filter by strategy_id, status) |
| `/api/perps/positions/:id` | GET | Get single perp position details |
| `/api/perps/funding/:positionId` | GET | Get funding payment history for a position |
| `/api/perps/pnl` | GET | Get perp-specific PnL summary |

### Options

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/options/positions` | GET | List option positions |
| `/api/options/positions/:id` | GET | Get single option position details |
| `/api/options/pnl` | GET | Get options-specific PnL summary |

### Lending

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/lending/positions` | GET | List lending positions |
| `/api/lending/positions/:id` | GET | Get single lending position details |
| `/api/lending/pnl` | GET | Get lending-specific PnL summary |

### Aggregated

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/portfolio/aggregated-pnl` | GET | Combined PnL across all instrument types |

### WebSocket Events

| Event | Triggered By |
|-------|-------------|
| `perp_position_update` | Perp position opened/closed/funding received |
| `option_position_update` | Option position opened/closed/expired |
| `lending_position_update` | Lending supply/withdraw/interest accrual |

---

## Strategy Code Examples

### Perpetual Futures Strategy

```javascript
async function execute(dt) {
  // Open a 10x leveraged long on ETH
  const result = await dt.binanceFutures.openLong({
    symbol: 'ETHUSDT',
    quantity: 0.5,
    leverage: 10,
    marginType: 'CROSS'
  })
  console.log(`Opened long: ${result.executedQty} ETH at ${result.avgPrice}`)

  // Wait and check unrealized PnL
  await sleep(60000)
  const pnl = dt.pnl.getTotal()
  console.log(`Unrealized PnL: $${pnl.totalUnrealizedPnl}`)

  // Close the position
  const close = await dt.binanceFutures.closeLong({
    symbol: 'ETHUSDT',
    quantity: 0.5
  })
  console.log(`Closed at ${close.avgPrice}, realized PnL: $${pnl.totalRealizedPnl}`)
}
```

### Options Strategy

```javascript
async function execute(dt) {
  // Buy 5 ETH call options
  const result = await dt.binanceOptions.buyCall({
    underlying: 'ETH',
    strikePrice: 4000,
    expiry: '2026-03-28',
    contracts: 5
  })
  console.log(`Bought ${result.executedQty} calls at ${result.avgPrice}`)

  // Check mark price and Greeks
  const mark = await dt.binanceOptions.getMarkPrice('ETH-260328-4000-C')
  console.log(`Mark price: ${mark.markPrice}`)
  console.log(`Delta: ${mark.delta}, IV: ${mark.impliedVolatility}`)
}
```

### Lending Strategy

```javascript
async function execute(dt) {
  const aave = dt.base.aave

  // Supply 10,000 USDC to Aave on Base
  const supplyTx = await aave.supply({
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetSymbol: 'USDC',
    amount: '10000'
  })
  console.log(`Supplied USDC, tx: ${supplyTx}`)

  // Check health factor
  const account = await aave.getUserAccountData()
  console.log(`Health factor: ${account.healthFactor}`)

  // Later: withdraw everything
  await sleep(86400000) // wait 24 hours
  const withdrawTx = await aave.withdraw({
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetSymbol: 'USDC',
    amount: 'max'
  })
  console.log(`Withdrew all USDC + interest, tx: ${withdrawTx}`)
}
```

---

## Architecture Decisions

### Why single-sided orders for non-spot instruments?

Spot swaps create two orders (SELL token A + BUY token B) because you're exchanging tokens. But a long ETH perp isn't a token exchange — it's a directional bet. There's no "other side" token. Same for options (you pay a premium for a right) and lending (you deposit tokens, not exchange them).

### Why separate PnL engines?

Each instrument has fundamentally different profit/loss math:
- **Spot**: FIFO cost basis (oldest purchase first)
- **Perps**: Mark-to-market + funding payments + leverage
- **Options**: Premium delta + time decay + settlement at expiry
- **Lending**: Interest accrual via protocol index

Trying to force these into one engine would break the tested spot logic and create an unmaintainable mess.

### Why separate position tables?

Each instrument has domain-specific fields. Perps need leverage and liquidation price. Options need strike, expiry, and Greeks. Lending needs liquidity index and health factor. A single table with 30+ nullable columns would be confusing and error-prone.

### Why a unified orders table?

Despite different instruments, an "order" is conceptually similar across all of them — it has a side, quantity, price, status, timestamp. The `instrument_type` discriminator lets us keep order management unified (one orders page, one order history, one reconciler) while routing PnL to the correct engine.

### Why background services?

Several things happen asynchronously, not triggered by user actions:
- **Funding payments** arrive every 8 hours whether or not the user is active
- **Interest accrues** continuously on Aave positions
- **Options expire** at a fixed date regardless of user interaction
- **Hook orders fill** when OTHER users swap through the pool

Background services ensure none of these events are missed.

---

See also:
- [Strategy SDK Reference](./strategy-sdk.md) — Full API for all instruments
- [V4 Hooks Deep Dive](./v4-hooks.md) — How on-chain hook orders work
- [Smart Contracts Reference](./smart-contracts.md) — Contract functions and state
- [README](../README.md) — Quick start guide
