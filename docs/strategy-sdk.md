# Strategy SDK Reference

Complete API reference for writing strategies in MegaQuant. Strategies are JavaScript functions that run inside a sandboxed VM. This document covers every object, method, and global available to your strategy code.

## Table of Contents

1. [How Strategies Work](#how-strategies-work)
2. [Sandbox Globals](#sandbox-globals)
3. [The `dt` Object (DeltaTrade)](#the-dt-object-deltatrade)
4. [Chain Proxies](#chain-proxies)
5. [Protocol Reference](#protocol-reference)
   - [Uniswap V3](#uniswap-v3)
   - [Uniswap V4](#uniswap-v4)
   - [1inch](#1inch)
   - [Chainlink](#chainlink)
   - [Aave V3](#aave-v3)
6. [CEX Proxies](#cex-proxies)
   - [Binance Spot](#binance-spot)
   - [Binance Futures](#binance-futures)
   - [Binance Options](#binance-options)
7. [Orders API](#orders-api)
8. [PnL API](#pnl-api)
9. [Strategy Addresses](#strategy-addresses)
10. [Full Examples](#full-examples)

---

## How Strategies Work

Every strategy must define an `async function execute(dt)`. When you click "Run" in the strategy editor:

1. Your code is saved to the database
2. `StrategyRunner` creates a Node.js VM sandbox
3. A `DeltaTrade` instance is created and injected as the `dt` parameter
4. Your `execute(dt)` function runs inside the sandbox
5. When `execute()` returns (or throws), the strategy stops

```javascript
async function execute(dt) {
  // Your strategy logic here
  // dt gives you access to all trading protocols
  const chain = dt['unichain-sepolia']
  const price = await chain.uniswapV4.getPoolInfo('WETH', 'USDC')
  console.log(`Current tick: ${price.currentTick}`)
}
```

If your code doesn't define an `execute` function, you'll get: `Error: Strategy code must define an async function execute(dt) { ... }`

---

## Sandbox Globals

These are all the globals available inside your strategy code. The sandbox is deliberately restrictive — no file system access, no network requests outside of trading protocols, no `require()` or `import`.

### Trading Globals

| Global | Type | Description |
|--------|------|-------------|
| `dt` | `DeltaTrade` | The main trading object. Access chains, protocols, orders, PnL. |
| `addresses` | `object` | Frozen object with all token and contract addresses (see [Strategy Addresses](#strategy-addresses)) |
| `console` | `object` | `.log()`, `.warn()`, `.error()`, `.info()` — output appears in the strategy console |
| `sleep(ms)` | `function` | Pause execution. Abort-aware: rejects if the strategy is stopped. |
| `checkPause()` | `function` | If the strategy is paused, blocks until resumed. Rejects on stop. |

### JavaScript Built-ins

| Global | Available? | | Global | Available? |
|--------|:---:|-|--------|:---:|
| `Promise` | Yes | | `setTimeout` | Yes (tracked) |
| `Date` | Yes | | `clearTimeout` | Yes |
| `Math` | Yes | | `setInterval` | Yes (tracked) |
| `JSON` | Yes | | `clearInterval` | Yes |
| `Number` | Yes | | `parseFloat` | Yes |
| `String` | Yes | | `parseInt` | Yes |
| `Boolean` | Yes | | `isNaN` | Yes |
| `Array` | Yes | | `isFinite` | Yes |
| `Object` | Yes | | `BigInt` | Yes |
| `Map` | Yes | | `Error` | Yes |
| `Set` | Yes | | `undefined` | Yes |

### NOT Available

`require`, `import`, `process`, `Buffer`, `fetch`, `fs`, `__dirname`, `__filename`, `global`, `globalThis`, `eval`, `Function`

---

## The `dt` Object (DeltaTrade)

The `dt` parameter passed to your `execute()` function is the gateway to all trading functionality.

### Properties

```javascript
dt.executionId    // string — unique ID for this execution run
dt.strategyId     // string — the strategy's database ID
dt.executionType  // string — 'arbitrage', 'hedging', or 'default'
```

### Chain Proxies

Access blockchain-specific trading protocols:

```javascript
dt.ethereum              // Ethereum Mainnet (chain ID: 1)
dt.base                  // Base (chain ID: 8453)
dt.unichain              // Unichain (chain ID: 130)
dt.sepolia               // Sepolia Testnet (chain ID: 11155111)
dt['base-sepolia']       // Base Sepolia (chain ID: 84532)
dt['unichain-sepolia']   // Unichain Sepolia (chain ID: 1301)
```

Each is a `ChainProxy` instance (or `undefined` if the strategy has no account on that chain).

### CEX Proxies

Access centralized exchange APIs:

```javascript
dt.binance               // Binance Spot trading
dt.binanceFutures        // Binance USDM Futures
dt.binanceOptions        // Binance Options
```

Each is `undefined` if no Binance API keys are configured.

### Orders & PnL

```javascript
dt.orders    // Order query API (see Orders API section)
dt.pnl       // PnL query API (see PnL API section)
```

---

## Chain Proxies

Each `dt.<chain>` object provides access to protocols and utility methods for that specific blockchain.

### Protocol Accessors

```javascript
const chain = dt['unichain-sepolia']

chain.uniswapV3      // Uniswap V3 protocol (swap, getQuote)
chain.uniswapV4      // Uniswap V4 protocol (swap, limitOrder, stopOrder, etc.)
chain.oneInch        // 1inch aggregator (swap, getQuote) — ethereum & base only
chain.chainlink      // Chainlink oracle (getPrice) — ethereum only
chain.aave           // Aave V3 (supply, borrow, etc.) — ethereum, base, sepolia
```

### Utility Methods

```javascript
// Balances
await chain.getNativeBalance()              // bigint — ETH/native token balance
await chain.getTokenBalance(tokenAddress)   // bigint — ERC20 balance
await chain.getGasPrice()                   // bigint — current gas price
await chain.getGasPriceInfo()               // { gasPrice, gasPriceGwei, estimatedSwapGasCostUsd? }

// Token info
chain.getTokenInfo('WETH')                  // { address, symbol, decimals, name } or undefined
chain.getTokenByAddress('0x4200...')         // Same, but look up by address
chain.getAvailableTokens()                  // string[] — all token symbols on this chain

// ETH wrapping
await chain.wrapETH('1.0')                  // Returns txHash — wraps ETH to WETH
await chain.unwrapETH('1.0')                // Returns txHash — unwraps WETH to ETH

// Shortcuts (uses V3 by default)
await chain.swap('WETH', 'USDC', '1.0')                 // Quick V3 swap
await chain.getSwapQuote('WETH', 'USDC', '1.0')         // Quick V3 quote
await chain.swapV4('WETH', 'USDC', '1.0')               // Quick V4 swap
await chain.getSwapQuoteV4('WETH', 'USDC', '1.0')       // Quick V4 quote

// Explorer links
chain.getExplorerUrl()                      // Base explorer URL
chain.txLink('0xabc...')                    // Full link to transaction
```

### Chain Properties

```javascript
chain.chainName     // string — e.g., 'unichain-sepolia'
chain.chainId       // number — e.g., 1301
```

---

## Protocol Reference

### Uniswap V3

**Access**: `dt.<chain>.uniswapV3`
**Available on**: ethereum, base, unichain, sepolia, base-sepolia, unichain-sepolia

#### `swap`

Execute a token swap through Uniswap V3.

```javascript
const result = await chain.uniswapV3.swap({
  tokenIn: 'WETH',       // Token symbol or address
  tokenOut: 'USDC',      // Token symbol or address
  amountIn: '1.0',       // Amount in token units
  slippage: 0.5,         // Max slippage % (default: 0.5)
  deadline: 300           // Seconds until tx expires (default: 300)
})

// result: {
//   success: true,
//   transactionHash: '0x...',
//   txHash: '0x...',           // alias
//   amountIn: '1.0',
//   amountOut: '2012.50',
//   gasUsed: 150000,
//   gasCostUsd: 0.45,
//   explorerUrl: 'https://...'
// }
```

#### `getQuote`

Get a price quote without executing a swap.

```javascript
const quote = await chain.uniswapV3.getQuote({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0'
})

// quote: {
//   amountOut: '2012.50',
//   amountOutMin: '2002.44',    // with 0.5% slippage
//   priceImpact: 0.03,          // 0.03%
//   exchangeRate: 2012.50,
//   gasCostUsd: 0.45
// }
```

---

### Uniswap V4

**Access**: `dt.<chain>.uniswapV4`
**Available on**: All chains. Hook features (limit/stop/bracket orders) only on unichain-sepolia.

#### `swap`

```javascript
const result = await v4.swap({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '0.1',
  slippage: 0.5,          // default: 0.5%
  deadline: 300,           // default: 300s
  hookData: '0x...'        // optional: custom data for hook
})
// Same return shape as V3 swap
```

#### `getQuote`

```javascript
const quote = await v4.getQuote({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0'
})
// Same return shape as V3 getQuote
```

#### `getPoolInfo`

Read live pool state from the V4 PoolManager.

```javascript
const pool = await v4.getPoolInfo('WETH', 'USDC')

// pool: {
//   poolId: '0x...',           // bytes32 pool identifier
//   currentTick: 200280,       // current price tick
//   sqrtPriceX96: '...',       // internal price encoding
//   liquidity: '...',          // current pool liquidity
//   fee: 3000,                 // dynamic fee in basis points
//   feePercentage: '0.3000%'   // human-readable fee
// }
```

#### `getPools`

Fetch all pools from the on-chain PoolRegistry.

```javascript
const pools = await v4.getPools()

// pools: [{
//   poolId: '0x...',
//   token0: '0x...',
//   token1: '0x...',
//   tickSpacing: 60,
//   creator: '0x...',
//   name: 'WETH/USDC Dynamic Fee',
//   active: true
// }, ...]
```

#### `getVolatilityFee`

Read the current volatility-adjusted dynamic fee.

```javascript
const { fee, feePercentage } = await v4.getVolatilityFee('WETH', 'USDC')
// fee: 3000 (basis points)
// feePercentage: '0.3000%'
// Range: 500 bps (0.05% calm) to 10000 bps (1.0% volatile)
```

#### `limitOrder`

Place a limit order on-chain via the hook.

```javascript
const limit = await v4.limitOrder({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',
  tick: 200250,          // price tick where order fills
  deadline: 86400        // expires in 24 hours (seconds)
})

// limit: {
//   success: true,
//   orderId: '0x...',     // deterministic keccak256 order ID
//   txHash: '0x...',
//   tick: 200250,
//   amountIn: '1.0',
//   deadline: 86400
// }
```

#### `stopOrder`

Place a stop-loss order on-chain via the hook.

```javascript
const stop = await v4.stopOrder({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',
  tick: 200190,          // triggers if price drops here
  deadline: 0            // 0 = no expiry (default)
})

// stop: {
//   success: true,
//   orderId: '0x...',     // keccak256 with "STOP" prefix
//   txHash: '0x...',
//   tick: 200190,
//   amountIn: '1.0'
// }
```

#### `bracketOrder`

Place a linked take-profit + stop-loss (OCO).

```javascript
const bracket = await v4.bracketOrder({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',       // per side (total cost = 2x)
  limitTick: 200370,     // take-profit tick
  stopTick: 200190,      // stop-loss tick
  deadline: 86400
})

// bracket: {
//   success: true,
//   limitOrderId: '0x...',  // take-profit order ID
//   stopOrderId: '0x...',   // stop-loss order ID
//   txHash: '0x...',
//   limitTick: 200370,
//   stopTick: 200190
// }
```

#### `getMyHookOrders`

Get all hook orders for this strategy.

```javascript
const orders = await v4.getMyHookOrders()

// orders: [{
//   id: '...',
//   orderType: 'limit',                    // 'limit' or 'stop'
//   side: 'sell',
//   tokenIn: 'WETH',
//   tokenOut: 'USDC',
//   amountIn: '1.0',
//   tick: 200250,
//   status: 'pending',                     // 'pending', 'filled', 'cancelled', 'expired'
//   hookOrderId: '0x...',                  // on-chain ID
//   linkedOrderId: '...',                  // bracket partner (if any)
//   createdAt: '2026-03-08T...'
// }, ...]
```

#### `cancelLimitOrder`

Cancel a pending limit order.

```javascript
const result = await v4.cancelLimitOrder('WETH', 'USDC', 200250)
// result: { success: true, txHash: '0x...' }
```

#### `cancelStopOrder`

```javascript
const result = await v4.cancelStopOrder('WETH', 'USDC', 200190)
// result: { success: true, txHash: '0x...' }
```

#### `cancelBracketOrder`

Cancel both sides of a bracket order.

```javascript
const result = await v4.cancelBracketOrder('WETH', 'USDC', 200370, 200190)
// result: { success: true, txHash: '0x...' }
```

#### `redeemLimitOrder`

Claim output tokens from a filled limit order.

```javascript
const result = await v4.redeemLimitOrder('WETH', 'USDC', 200250, '1.0')
// result: { success: true, txHash: '0x...' }
```

#### `twap` (TWAP Execution)

Split a large order into smaller slices over time to minimize market impact.

```javascript
const twap = await v4.twap({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  totalAmount: '10.0',     // total amount to swap
  durationMs: 3600000,     // spread over 1 hour
  numSlices: 12,           // 12 slices (one every 5 minutes)
  maxSlippage: 50          // 0.5% max slippage per slice (bps)
})

// twap: {
//   twapId: '...',
//   status: 'active',
//   slicesTotal: 12,
//   intervalMs: 300000,          // 5 minutes between slices
//   estimatedEndAt: '2026-...'
// }

// Check progress:
const status = await v4.getTwapStatus(twap.twapId)
// status: { slicesExecuted: 5, slicesFailed: 0, totalAmountOut: '...', averagePrice: '...' }

// Cancel if needed:
await v4.cancelTwap(twap.twapId)
```

#### `addLiquidity`

Add liquidity to a V4 pool.

```javascript
const result = await v4.addLiquidity({
  tokenA: 'WETH',
  tokenB: 'USDC',
  amount0: '1.0',
  amount1: '2000.0',
  tickLower: -887220,    // optional: default = full range
  tickUpper: 887220,     // optional: default = full range
  slippage: 500          // optional: 5% default (in bps)
})

// result: { success: true, txHash: '0x...', liquidity: '...', tokenId: '...' }
```

#### `estimatePoolAPY`

Estimate the annual yield for providing liquidity.

```javascript
const apy = await v4.estimatePoolAPY('WETH', 'USDC')
// apy: { apy: 12.5, dailyVolume: '...', dailyFees: '...', tvl: '...' }
```

#### `batchSwap`

Execute multiple swaps in a single transaction.

```javascript
const results = await v4.batchSwap([
  { tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' },
  { tokenIn: 'WETH', tokenOut: 'DAI', amountIn: '0.5' }
])
// results: [{ success: true, amountIn: '1.0', ... }, ...]
```

---

### 1inch

**Access**: `dt.<chain>.oneInch`
**Available on**: ethereum, base

Aggregates across 300+ DEXs to find the best swap price.

#### `swap`

```javascript
const result = await chain.oneInch.swap({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',
  slippage: 0.5
})
// Same return shape as Uniswap swap
```

#### `getQuote`

```javascript
const quote = await chain.oneInch.getQuote({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0'
})
// Same return shape as Uniswap getQuote
```

---

### Chainlink

**Access**: `dt.ethereum.chainlink`
**Available on**: ethereum only

On-chain price oracle — provides reliable, tamper-proof price feeds.

#### `getPrice`

```javascript
const price = await chain.chainlink.getPrice('ETH/USD')
// price: 2012.50 (number)
```

#### `getPriceData`

```javascript
const data = await chain.chainlink.getPriceData('ETH/USD')
// data: {
//   pair: 'ETH/USD',
//   price: 2012.50,
//   roundId: '...',
//   updatedAt: 1709856000,
//   answeredInRound: '...'
// }
```

**Supported pairs**: `ETH/USD`, `BTC/USD`, `USDC/USD`, `LINK/USD`, `USDT/USD`, `DAI/USD`, `STETH/USD`, `AAVE/USD`, `UNI/USD`

---

### Aave V3

**Access**: `dt.<chain>.aave`
**Available on**: ethereum, base, sepolia

DeFi lending protocol — supply tokens to earn interest, borrow against collateral.

#### `supply`

```javascript
const txHash = await chain.aave.supply({
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  assetSymbol: 'USDC',
  amount: '10000'
})
```

#### `withdraw`

```javascript
const txHash = await chain.aave.withdraw({
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  assetSymbol: 'USDC',
  amount: 'max'           // 'max' withdraws everything including interest
})
```

#### `borrow`

```javascript
const txHash = await chain.aave.borrow({
  asset: '0x...',
  assetSymbol: 'USDC',
  amount: '5000',
  interestRateMode: 2     // 1 = stable, 2 = variable (default)
})
```

#### `repay`

```javascript
const txHash = await chain.aave.repay({
  asset: '0x...',
  assetSymbol: 'USDC',
  amount: 'max',          // 'max' repays full debt
  interestRateMode: 2
})
```

#### `getUserAccountData`

```javascript
const account = await chain.aave.getUserAccountData()
// account: { healthFactor, totalCollateral, totalDebt, availableBorrows, ... }
```

---

## CEX Proxies

### Binance Spot

**Access**: `dt.binance`

#### `buy`

```javascript
const result = await dt.binance.buy({
  symbol: 'ETHUSDT',
  type: 'MARKET',           // 'MARKET' or 'LIMIT'
  quantity: 1.0,
  price: 2000               // required for LIMIT orders
})

// result: {
//   symbol: 'ETHUSDT',
//   orderId: 123456,
//   executedQty: '1.00000000',
//   cummulativeQuoteQty: '2012.50000000',
//   status: 'FILLED',
//   fills: [{ price: '2012.50', qty: '1.0', commission: '0.001', ... }]
// }
```

#### `sell`

```javascript
const result = await dt.binance.sell({
  symbol: 'ETHUSDT',
  type: 'MARKET',
  quantity: 1.0
})
```

---

### Binance Futures

**Access**: `dt.binanceFutures`

#### `openLong`

Open a long position (profit when price goes up).

```javascript
const result = await dt.binanceFutures.openLong({
  symbol: 'ETHUSDT',
  quantity: 0.5,
  leverage: 10,                // auto-sets leverage
  marginType: 'CROSS',        // auto-sets margin type
  type: 'MARKET'               // default
})

// result: {
//   orderId: 789,
//   symbol: 'ETHUSDT',
//   status: 'FILLED',
//   avgPrice: '2012.50',
//   executedQty: '0.5',
//   side: 'BUY',
//   positionSide: 'LONG'
// }
```

#### `closeLong`

Close a long position (automatically sets `reduceOnly: true`).

```javascript
const result = await dt.binanceFutures.closeLong({
  symbol: 'ETHUSDT',
  quantity: 0.5
})
```

#### `openShort`

Open a short position (profit when price goes down).

```javascript
const result = await dt.binanceFutures.openShort({
  symbol: 'ETHUSDT',
  quantity: 0.5,
  leverage: 5
})
```

#### `closeShort`

```javascript
const result = await dt.binanceFutures.closeShort({
  symbol: 'ETHUSDT',
  quantity: 0.5
})
```

---

### Binance Options

**Access**: `dt.binanceOptions`

#### `buyCall`

Buy call options (right to buy at strike price).

```javascript
const result = await dt.binanceOptions.buyCall({
  underlying: 'ETH',
  strikePrice: 4000,
  expiry: '2026-03-28',      // auto-formats to Binance symbol
  contracts: 5,
  type: 'MARKET'              // default
})
```

#### `sellCall`

```javascript
const result = await dt.binanceOptions.sellCall({
  underlying: 'ETH',
  strikePrice: 4000,
  expiry: '2026-03-28',
  contracts: 5
})
```

#### `buyPut`

Buy put options (right to sell at strike price).

```javascript
const result = await dt.binanceOptions.buyPut({
  underlying: 'ETH',
  strikePrice: 3500,
  expiry: '2026-03-28',
  contracts: 5
})
```

#### `sellPut`

```javascript
const result = await dt.binanceOptions.sellPut({
  underlying: 'ETH',
  strikePrice: 3500,
  expiry: '2026-03-28',
  contracts: 5
})
```

#### `getMarkPrice`

```javascript
const mark = await dt.binanceOptions.getMarkPrice('ETH-260328-4000-C')
// mark: { markPrice, delta, impliedVolatility, ... }
```

---

## Orders API

**Access**: `dt.orders`

Query orders for the current strategy.

```javascript
// Get all orders
const all = dt.orders.getAll()

// Get only pending orders
const pending = dt.orders.getPending()

// Get order history with pagination
const history = dt.orders.getHistory(50)
// history: { orders: [...], total: 142 }

// Get orders for a specific asset
const ethOrders = dt.orders.getByAsset('WETH')
```

---

## PnL API

**Access**: `dt.pnl`

Query profit/loss data for the current strategy.

```javascript
// Total PnL summary
const total = dt.pnl.getTotal()
// total: {
//   totalRealizedPnl: 1250.50,
//   totalUnrealizedPnl: 340.20,
//   totalFees: 12.30,
//   positionCount: 5
// }

// Hourly PnL data (for charts)
const hourly = dt.pnl.getHourly(24)  // last 24 hours

// Get positions
const open = dt.pnl.getPositions('open')
const closed = dt.pnl.getPositions('closed')
const all = dt.pnl.getPositions('all')

// Realized PnL only
const realized = dt.pnl.getRealized()
// realized: { realizedPnl: 1250.50, totalFees: 12.30 }
```

---

## Strategy Addresses

**Access**: `addresses` (global)

A frozen object containing all token and contract addresses. Two access patterns:

### Flat Access (uppercase, underscored)

```javascript
addresses.UNICHAIN_SEPOLIA_WETH               // '0x4200...'
addresses.UNICHAIN_SEPOLIA_USDC               // '0x31d0...'
addresses.UNICHAIN_SEPOLIA_POOL_MANAGER        // '0x00b0...'
addresses.UNICHAIN_SEPOLIA_HOOK                // '0xB591...'
addresses.UNICHAIN_SEPOLIA_ROUTER              // '0x608A...'
addresses.UNICHAIN_SEPOLIA_POOL_REGISTRY       // '0x6807...'
addresses.ETHEREUM_WETH                         // '0xC02a...'
addresses.BASE_USDC                             // '0x8335...'
// Pattern: <CHAIN>_<TOKEN_OR_CONTRACT>
```

### Structured Access

```javascript
const chain = addresses['unichain-sepolia']

chain.chainId             // 1301
chain.name                // 'Unichain Sepolia Testnet'
chain.blockExplorer       // 'https://sepolia.uniscan.xyz'

// Tokens
chain.tokens.WETH         // '0x4200...'
chain.tokens.USDC         // '0x31d0...'

// Protocol addresses
chain.uniswapV3.router    // V3 SwapRouter address
chain.uniswapV3.quoter    // V3 Quoter address

chain.uniswapV4.poolManager      // '0x00b0...'
chain.uniswapV4.megaQuantHook    // '0xB591...'
chain.uniswapV4.megaQuantRouter  // '0x608A...'
chain.uniswapV4.poolRegistry     // '0x6807...'
chain.uniswapV4.universalRouter  // Universal Router address
chain.uniswapV4.stateView        // StateView address

chain.aaveV3.pool         // Aave V3 Pool address (if available)
chain.aaveV3.dataProvider  // Aave V3 Data Provider address
```

### Available Chains

| Chain Key | Chain ID | MegaQuant Hook | 1inch | Aave V3 |
|-----------|----------|:-:|:-:|:-:|
| `ethereum` | 1 | - | Yes | Yes |
| `base` | 8453 | - | Yes | Yes |
| `unichain` | 130 | - | - | - |
| `sepolia` | 11155111 | - | - | - |
| `base-sepolia` | 84532 | - | - | - |
| `unichain-sepolia` | 1301 | Yes | - | - |

### Complete Address Tables

These are all the addresses available via the `addresses` global. Use these when you need raw contract addresses (e.g., for Aave's `asset` parameter or custom contract interactions).

#### Token Addresses

**Ethereum (Chain ID: 1)**

| Symbol | Address | Decimals |
|--------|---------|----------|
| ETH | `0x0000000000000000000000000000000000000000` | 18 |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | 18 |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| WBTC | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | 8 |
| DAI | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | 18 |
| LINK | `0x514910771AF9Ca656af840dff83E8264EcF986CA` | 18 |
| UNI | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` | 18 |
| AAVE | `0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9` | 18 |
| STETH | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | 18 |
| WSTETH | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | 18 |

**Base (Chain ID: 8453)**

| Symbol | Address | Decimals |
|--------|---------|----------|
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| USDT | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | 6 |
| DAI | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | 18 |
| WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` | 8 |
| LINK | `0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196` | 18 |
| AAVE | `0x63706e401c06ac8513145b7687A14804d17f814b` | 18 |

**Unichain (Chain ID: 130)**

| Symbol | Address | Decimals |
|--------|---------|----------|
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x078D782b760474a361dDA0AF3839290b0EF57AD6` | 6 |
| USDT | `0x588CE4F028D8e7B53B687865d6A67b3A54C75518` | 6 |
| UNI | `0x8f187aA05619a017077f5308904739877ce9eA21` | 18 |
| WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` | 8 |
| LINK | `0xEF66491eab4bbB582c57b14778afd8dFb70D8A1A` | 18 |

**Unichain Sepolia (Chain ID: 1301)**

| Symbol | Address | Decimals |
|--------|---------|----------|
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x31d0220469e10c4E71834a79b1f276d740d3768F` | 6 |
| USDT | `0x3C5000e61F0A10acD0c826e09b90ddeF5AbFc3b5` | 6 |

**Sepolia (Chain ID: 11155111)**

| Symbol | Address | Decimals |
|--------|---------|----------|
| WETH | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` | 18 |
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 6 |
| USDT | `0x7169D38820dfd117C3FA1f22a697dBA58d90BA06` | 6 |
| DAI | `0x68194a729C2450ad26072b3D33ADaCbcef39D574` | 18 |

**Base Sepolia (Chain ID: 84532)**

| Symbol | Address | Decimals |
|--------|---------|----------|
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 |
| USDT | `0x637B07e1a2D4E84d9aA9fB87bA3acf9D4DA55619` | 6 |
| DAI | `0xB8e007e0FD81b28087f29fE4e9C5E14B0B830183` | 18 |

#### Protocol Contract Addresses

**MegaQuant Custom Contracts (Unichain Sepolia only)**

| Contract | Address | Flat Key |
|----------|---------|----------|
| MegaQuantHook | `0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0` | `addresses.UNICHAIN_SEPOLIA_HOOK` |
| MegaQuantRouter | `0x608AEfA1DFD3621554a948E20159eB243C76235F` | `addresses.UNICHAIN_SEPOLIA_ROUTER` |
| PoolRegistry | `0x680762A631334098eeF5F24EAAafac0F07Cb2e3a` | `addresses.UNICHAIN_SEPOLIA_POOL_REGISTRY` |

**Uniswap V4 PoolManager**

| Chain | Address | Flat Key |
|-------|---------|----------|
| Ethereum | `0x000000000004444c5dc75cB358380D2e3dE08A90` | `addresses.ETHEREUM_POOL_MANAGER` |
| Base | `0x498581ff718922c3f8e6a244956af099b2652b2b` | `addresses.BASE_POOL_MANAGER` |
| Unichain | `0x1f98400000000000000000000000000000000004` | `addresses.UNICHAIN_POOL_MANAGER` |
| Unichain Sepolia | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` | `addresses.UNICHAIN_SEPOLIA_POOL_MANAGER` |
| Sepolia | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` | `addresses.SEPOLIA_POOL_MANAGER` |
| Base Sepolia | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` | `addresses.BASE_SEPOLIA_POOL_MANAGER` |

**Aave V3 Pool**

| Chain | Address | Flat Key |
|-------|---------|----------|
| Ethereum | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `addresses.ETHEREUM_AAVE_POOL` |
| Base | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `addresses.BASE_AAVE_POOL` |

### Usage Examples

```javascript
async function execute(dt) {
  // Flat access — great for quick lookups
  const hookAddr = addresses.UNICHAIN_SEPOLIA_HOOK
  console.log(`Hook address: ${hookAddr}`)

  // Structured access — great for iterating
  const chain = addresses['unichain-sepolia']
  console.log(`Chain: ${chain.name} (${chain.chainId})`)
  console.log(`WETH: ${chain.tokens.WETH}`)
  console.log(`Hook: ${chain.uniswapV4.megaQuantHook}`)

  // Use in Aave calls (need raw address)
  const baseUsdc = addresses.BASE_USDC
  await dt.base.aave.supply({
    asset: baseUsdc,
    assetSymbol: 'USDC',
    amount: '1000'
  })

  // Get explorer link for a token
  const explorer = addresses.ethereum.blockExplorer
  console.log(`View WETH: ${explorer}/token/${addresses.ETHEREUM_WETH}`)
}
```

---

## Full Examples

### Arbitrage Between V3 and V4

```javascript
async function execute(dt) {
  const chain = dt.ethereum

  while (true) {
    // Get quotes from both protocols
    const v3Quote = await chain.uniswapV3.getQuote({
      tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0'
    })
    const v4Quote = await chain.uniswapV4.getQuote({
      tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0'
    })

    const spread = Math.abs(v3Quote.exchangeRate - v4Quote.exchangeRate)
    console.log(`V3: ${v3Quote.exchangeRate}, V4: ${v4Quote.exchangeRate}, Spread: ${spread}`)

    // If spread is profitable after gas
    if (spread > 5) {
      if (v3Quote.exchangeRate > v4Quote.exchangeRate) {
        await chain.uniswapV3.swap({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' })
      } else {
        await chain.uniswapV4.swap({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '1.0' })
      }
    }

    await sleep(30000) // check every 30 seconds
    await checkPause()
  }
}
```

### Hook Orders with Risk Management

```javascript
async function execute(dt) {
  const v4 = dt['unichain-sepolia'].uniswapV4

  // Get current pool state
  const pool = await v4.getPoolInfo('WETH', 'USDC')
  console.log(`Current tick: ${pool.currentTick}, Fee: ${pool.feePercentage}`)

  // Place a bracket order: take-profit +2% / stop-loss -1%
  const bracket = await v4.bracketOrder({
    tokenIn: 'WETH',
    tokenOut: 'USDC',
    amountIn: '0.5',
    limitTick: pool.currentTick + 120,  // ~2% above
    stopTick: pool.currentTick - 60,    // ~1% below
    deadline: 86400
  })
  console.log(`Bracket placed: TP=${bracket.limitTick}, SL=${bracket.stopTick}`)

  // Monitor until filled
  while (true) {
    const orders = await v4.getMyHookOrders()
    const pending = orders.filter(o => o.status === 'pending')
    console.log(`Pending orders: ${pending.length}`)

    if (pending.length === 0) {
      console.log('All orders resolved!')
      break
    }

    await sleep(15000)
    await checkPause()
  }

  // Check final PnL
  const pnl = dt.pnl.getTotal()
  console.log(`Realized PnL: $${pnl.totalRealizedPnl.toFixed(4)}`)
}
```

### Multi-Instrument Portfolio

```javascript
async function execute(dt) {
  // 1. Spot: swap on DEX
  const swap = await dt.ethereum.uniswapV4.swap({
    tokenIn: 'WETH', tokenOut: 'USDC', amountIn: '0.5'
  })
  console.log(`Swapped 0.5 WETH for ${swap.amountOut} USDC`)

  // 2. Futures: hedge with a short
  const short = await dt.binanceFutures.openShort({
    symbol: 'ETHUSDT', quantity: 0.5, leverage: 5
  })
  console.log(`Opened short: ${short.executedQty} ETH`)

  // 3. Lending: earn yield on idle USDC
  const supplyTx = await dt.base.aave.supply({
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    assetSymbol: 'USDC',
    amount: '5000'
  })
  console.log(`Supplied 5000 USDC to Aave`)

  // 4. Check combined PnL
  const pnl = dt.pnl.getTotal()
  console.log(`Total PnL: $${(pnl.totalRealizedPnl + (pnl.totalUnrealizedPnl || 0)).toFixed(2)}`)
}
```

---

See also:
- [V4 Hooks Deep Dive](./v4-hooks.md) — How the on-chain hook works
- [Multi-Instrument Architecture](./multi-instrument.md) — Order lifecycles and PnL engines
- [Smart Contracts Reference](./smart-contracts.md) — Contract function signatures
- [README](../README.md) — Quick start guide
