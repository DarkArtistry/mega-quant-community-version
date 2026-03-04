# Multi-Instrument Architecture

## Overview

MEGA QUANT supports 4 instrument types, each with its own order flow, PnL engine, and position model:

| Instrument | Protocol | Order Model | PnL Engine | Position Table |
|-----------|----------|-------------|------------|----------------|
| **Spot** | DEX (Uniswap), Binance Spot | Linked pair (SELL + BUY) | `PnlEngine` (FIFO) | `positions` |
| **Perps** | Binance Futures | Single-sided | `PerpPnlEngine` | `perp_positions` |
| **Options** | Binance Options | Single-sided | `OptionsPnlEngine` | `options_positions` |
| **Lending** | Aave V3 | Single-sided | `LendingPnlEngine` | `lending_positions` |

All instruments share the unified `orders` table with `instrument_type` discriminator.

---

## Order Flow

### Spot (existing)
```
swap('WETH', 'USDC', '1.0')
  -> OrderManager.recordOrder(side:'sell', asset:'WETH', instrument_type:'spot')
  -> OrderManager.recordOrder(side:'buy', asset:'USDC', linked_order_id:...)
  -> PnlEngine.processTrade(side:'sell', asset:'WETH')   <- FIFO
  -> PnlEngine.processTrade(side:'buy', asset:'USDC')
TWO orders, TWO PnL entries per swap.
```

### Perps
```
dt.binanceFutures.openLong({ symbol:'ETHUSDT', quantity:1, leverage:10 })
  -> OrderManager.recordOrder({ instrument_type:'perp', side:'buy', positionSide:'LONG' })
  -> PerpPnlEngine.processPerp({ action:'open', side:'long', price, size })
     -> INSERT into perp_positions
ONE order per action. PnL = (exit - entry) x size x direction + funding - fees.
```

### Options
```
dt.binanceOptions.buyCall({ underlying:'ETH', strike:4000, expiry:'2026-03-28', contracts:5 })
  -> OrderManager.recordOrder({ instrument_type:'option', optionType:'CALL', strike:'4000' })
  -> OptionsPnlEngine.processOption({ action:'open', premium:'120.50', contracts:'5' })
     -> INSERT into options_positions
ONE order per action. PnL = premium delta or settlement value.
```

### Lending
```
dt.base.aave.supply({ asset:'0x...', assetSymbol:'USDC', amount:'10000' })
  -> OrderManager.recordOrder({ instrument_type:'lending', lendingAction:'supply' })
  -> LendingPnlEngine.processLending({ action:'supply', amount:'10000', liquidityIndex })
     -> INSERT into lending_positions
ONE order per action. PnL = interest earned (supply) or -interest paid (borrow).
```

---

## Database Schema

### Orders Table (extended)
New columns on the unified `orders` table:
- `instrument_type` — `'spot'` | `'perp'` | `'option'` | `'lending'` (default: `'spot'`)
- `position_side` — `'LONG'` | `'SHORT'` (perps)
- `leverage` — leverage multiplier (perps)
- `reduce_only` — close-only flag (perps)
- `margin_type` — `'CROSS'` | `'ISOLATED'` (perps)
- `option_type` — `'CALL'` | `'PUT'` (options)
- `strike_price` — strike price (options)
- `expiry` — expiry date (options)
- `underlying_symbol` — underlying asset (options)
- `lending_action` — `'supply'` | `'withdraw'` | `'borrow'` | `'repay'` (lending)
- `interest_rate_mode` — `'variable'` | `'stable'` (lending)

### Perp Positions (`perp_positions`)
Full position tracking with leverage, margin, liquidation price, funding payments.

### Options Positions (`options_positions`)
Tracks premium, strike, expiry, Greeks (delta/gamma/theta/vega/IV).

### Lending Positions (`lending_positions`)
Tracks principal, current amount, accrued interest, Aave liquidity index, health factor.

### Funding Payments (`funding_payments`)
Per-position funding payment history for perps.

---

## PnL Engines

### PnlEngine (Spot — existing, unchanged)
- **File**: `backend/src/lib/trading/pnl/PnlEngine.ts`
- **Method**: FIFO cost basis
- **Table**: `positions`
- **Key methods**: `processTrade()`, `updateUnrealizedPnl()`, `getTotalPnl()`

### PerpPnlEngine
- **File**: `backend/src/lib/trading/pnl/PerpPnlEngine.ts`
- **Method**: Mark-to-market with funding
- **Table**: `perp_positions`
- **Key methods**: `processPerp()`, `recordFundingPayment()`, `updateUnrealizedPnl()`
- **PnL formula**: `(exit - entry) x size x direction + funding - fees`

### OptionsPnlEngine
- **File**: `backend/src/lib/trading/pnl/OptionsPnlEngine.ts`
- **Method**: Premium-based with expiry settlement
- **Table**: `options_positions`
- **Key methods**: `processOption()`, `updateGreeks()`, `getExpiredOpenPositions()`
- **PnL formula**: `(exit_premium - entry_premium) x contracts x direction` or settlement value at expiry

### LendingPnlEngine
- **File**: `backend/src/lib/trading/pnl/LendingPnlEngine.ts`
- **Method**: Interest accrual via Aave liquidity index
- **Table**: `lending_positions`
- **Key methods**: `processLending()`, `updateInterestAccrual()`
- **PnL formula**: `current_amount - principal` (supply) or `-(current_amount - principal)` (borrow)

### PnlAggregator
- **File**: `backend/src/lib/trading/pnl/PnlAggregator.ts`
- **Purpose**: Combines all 4 engines into unified view
- **Key method**: `getTotalPnl(strategyId?)` returns breakdown by instrument type

---

## Trading Proxies

### BinanceFuturesProxy
- **File**: `backend/src/lib/trading/cex/BinanceFuturesProxy.ts`
- **API**: `fapi.binance.com` (USDM Futures)
- **Methods**: `openLong()`, `closeLong()`, `openShort()`, `closeShort()`, `setLeverage()`, `setMarginType()`
- **Access**: `dt.binanceFutures.openLong({ symbol, quantity, leverage })`

### BinanceOptionsProxy
- **File**: `backend/src/lib/trading/cex/BinanceOptionsProxy.ts`
- **API**: `eapi.binance.com`
- **Methods**: `buyCall()`, `sellCall()`, `buyPut()`, `sellPut()`, `getMarkPrice()`
- **Access**: `dt.binanceOptions.buyCall({ underlying, strikePrice, expiry, contracts })`

### AaveV3Protocol
- **File**: `backend/src/lib/trading/protocols/AaveV3Protocol.ts`
- **Contract**: Aave V3 Pool (on-chain)
- **Methods**: `supply()`, `withdraw()`, `borrow()`, `repay()`, `getUserAccountData()`
- **Access**: `dt.base.aave.supply({ asset, assetSymbol, amount })`
- **Supported chains**: Ethereum, Base, Sepolia

---

## Background Services

| Service | Interval | Purpose |
|---------|----------|---------|
| `FundingTracker` | 1 hour | Polls Binance Futures funding payments, records to `funding_payments` |
| `OptionsExpiryChecker` | 1 hour | Settles expired options (ITM = exercise, OTM = expire worthless) |
| `AaveInterestTracker` | 5 min | Updates interest accrual via Aave reserve liquidity index |
| `PnlSnapshotter` | 1 hour | Takes snapshots of all position values (existing, enhanced) |
| `OrderReconciler` | 30 sec | Checks pending order status (DEX, Binance Spot, Binance Futures) |

---

## API Routes

### Perps
- `GET /api/perps/positions` — List perp positions (filter: `strategy_id`, `status`)
- `GET /api/perps/positions/:id` — Get single perp position
- `GET /api/perps/funding/:positionId` — Get funding payment history
- `GET /api/perps/pnl` — Get perp PnL summary

### Options
- `GET /api/options/positions` — List option positions
- `GET /api/options/positions/:id` — Get single option position
- `GET /api/options/pnl` — Get options PnL summary

### Lending
- `GET /api/lending/positions` — List lending positions
- `GET /api/lending/positions/:id` — Get single lending position
- `GET /api/lending/pnl` — Get lending PnL summary

### Portfolio (aggregated)
- `GET /api/portfolio/aggregated-pnl` — Combined PnL across all instrument types

### WebSocket Events (new)
- `perp_position_update` — Perp position opened/closed/funding
- `option_position_update` — Option position opened/closed/expired
- `lending_position_update` — Lending position supply/withdraw/interest

---

## Strategy Code Examples

### Perps Strategy
```typescript
const dt = await createDeltaTrade('perp-strategy', strategyId)

// Open a 10x leveraged long on ETHUSDT
await dt.binanceFutures.openLong({
  symbol: 'ETHUSDT',
  quantity: 1,
  leverage: 10,
  marginType: 'CROSS'
})

// Check position
const positions = await dt.binanceFutures.getPositions('ETHUSDT')
console.log('Unrealized PnL:', positions[0].unRealizedProfit)

// Close position
await dt.binanceFutures.closeLong({
  symbol: 'ETHUSDT',
  quantity: 1
})
```

### Options Strategy
```typescript
const dt = await createDeltaTrade('options-strategy', strategyId)

// Buy 5 ETH call options
await dt.binanceOptions.buyCall({
  underlying: 'ETH',
  strikePrice: 4000,
  expiry: '2026-03-28',
  contracts: 5
})

// Get mark price with Greeks
const mark = await dt.binanceOptions.getMarkPrice('ETH-260328-4000-C')
console.log('Delta:', mark.delta, 'IV:', mark.markIV)
```

### Lending Strategy
```typescript
const dt = await createDeltaTrade('lending-strategy', strategyId)

// Supply USDC to Aave on Base
const usdcAddress = dt.base.tokens['USDC'].address
await dt.base.aave.supply({
  asset: usdcAddress,
  assetSymbol: 'USDC',
  amount: '10000'
})

// Check health factor
const accountData = await dt.base.aave.getUserAccountData()
console.log('Health Factor:', accountData.healthFactor)

// Withdraw
await dt.base.aave.withdraw({
  asset: usdcAddress,
  assetSymbol: 'USDC',
  amount: 'max'
})
```

---

## Architecture Decisions

1. **Single-sided orders for non-spot**: Perps/options/lending create ONE order per action (not linked pairs). A long ETH perp is a directional bet, not a token swap.

2. **Separate PnL engines**: Each instrument has fundamentally different PnL math. Separate engines avoid breaking the tested spot FIFO logic.

3. **Separate position tables**: Domain-specific columns (leverage/liquidation for perps, strike/greeks for options, index/healthFactor for lending). One table with 30+ nullable columns would be confusing.

4. **Unified orders table**: Orders are conceptually similar across instruments. `instrument_type` discriminator keeps order management unified.

5. **Same credential model**: Binance Futures/Options use the same API key as Spot. Aave uses the same wallet private key. No new credential storage needed.

6. **Background services**: Funding payments (perps), interest accrual (lending), and option expiry happen asynchronously, not triggered by user orders.
