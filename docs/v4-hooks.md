# Uniswap V4 Hooks — Deep Dive

This document explains how MegaQuant's custom Uniswap V4 hook works, what problems it solves, and how every component fits together. It's written for developers and traders who want to understand what's happening on-chain when they place orders or execute swaps through our hook.

> **Quick context**: Uniswap V4 lets anyone attach a "hook" contract to a liquidity pool. The hook runs custom code at key moments — before/after swaps, when pools are created, etc. MegaQuant's hook adds three things that Uniswap doesn't have natively: **limit orders**, **stop-loss orders**, and **volatility-based dynamic fees**.

## Table of Contents

1. [How Uniswap V4 Works (The Basics)](#how-uniswap-v4-works-the-basics)
2. [What Our Hook Does](#what-our-hook-does)
3. [Volatility-Based Dynamic Fees (EWMA)](#volatility-based-dynamic-fees-ewma)
4. [On-Chain Limit Orders](#on-chain-limit-orders)
5. [Stop-Loss Orders](#stop-loss-orders)
6. [Bracket (OCO) Orders](#bracket-oco-orders)
7. [Order ID Generation](#order-id-generation)
8. [ERC1155 Claim Tokens](#erc1155-claim-tokens)
9. [Hook Order Lifecycle](#hook-order-lifecycle)
10. [Pool Lifecycle with Our Hook](#pool-lifecycle-with-our-hook)
11. [Hook Callback Reference](#hook-callback-reference)

---

## How Uniswap V4 Works (The Basics)

### Singleton PoolManager

Unlike Uniswap V3 (where every pool was its own contract), V4 uses a **single `PoolManager` contract** for ALL pools. Every pool lives inside this one contract. This saves gas because multi-hop swaps don't need to transfer tokens between separate pool contracts.

### Pool Keys

Every pool is identified by a `PoolKey`:

```
PoolKey {
  currency0: address      // Token A (lower address, sorted)
  currency1: address      // Token B
  fee: uint24             // Fee tier — or DYNAMIC_FEE_FLAG (0x800000)
  tickSpacing: int24      // Tick spacing (e.g., 60)
  hooks: address          // Hook contract address
}
```

### Hooks

A hook is an external contract that intercepts pool events. Each pool has exactly ONE hook. The hook's address itself encodes which callbacks it uses (via address bit flags — this is why hooks need CREATE2 salt mining during deployment).

### Flash Accounting

V4 uses transient storage (EIP-1153) so tokens only transfer at the END of a transaction. During execution, the PoolManager tracks "deltas" (IOUs). This means a multi-hop swap only needs 2 token transfers total (one in, one out) instead of intermediate transfers at each hop.

### What We Deploy vs What Uniswap Deploys

| Component | Deployed By | Notes |
|-----------|-------------|-------|
| **PoolManager** | Uniswap | Singleton, already live on all chains |
| **Universal Router** | Uniswap | Standard swap router, already live |
| **MegaQuantHook** | Us | Custom hook with limit orders + dynamic fees |
| **MegaQuantRouter** | Us | Custom router for advanced order types |
| **PoolRegistry** | Us | Registry for discovering our hook's pools |

---

## What Our Hook Does

MegaQuantHook implements four hook callbacks:

| Callback | When It Fires | What We Do |
|----------|---------------|------------|
| `beforeInitialize` | Pool is being created | Validate that the pool uses dynamic fees (reject if not) |
| `afterInitialize` | Pool just created | Initialize volatility tracking state, store starting tick |
| `beforeSwap` | Before each swap | Calculate the current volatility-adjusted fee and override the pool's fee |
| `afterSwap` | After each swap | Update volatility state, check if any limit/stop orders should trigger |

The hook does NOT use `beforeAddLiquidity`, `afterAddLiquidity`, `beforeRemoveLiquidity`, `afterRemoveLiquidity`, `beforeDonate`, or `afterDonate`.

---

## Volatility-Based Dynamic Fees (EWMA)

### The Problem

In traditional Uniswap pools, the swap fee is fixed (e.g., 0.3%). This creates a problem:

- **During calm markets**: 0.3% might be too expensive, pushing traders to other venues
- **During volatile markets**: 0.3% might be too cheap — liquidity providers (LPs) lose money to arbitrageurs who exploit stale prices

This is the same reason a market maker at a trading desk widens their bid-ask spread when the market gets choppy — they need to charge more to compensate for the risk that prices move against them between trades.

### The Solution: EWMA Volatility Tracking

Our hook tracks how much the price has been moving and adjusts the fee automatically:

- **Low volatility** → Fee drops to **0.05%** (500 bps) — cheaper trades, more volume
- **Normal volatility** → Fee sits around **0.30%** (3000 bps) — standard Uniswap rate
- **High volatility** → Fee rises to **1.0%** (10000 bps) — protects LPs from getting picked off

### What is EWMA?

**EWMA = Exponentially Weighted Moving Average.** It's a way to calculate a running average that gives more weight to recent data points and less weight to old ones.

Think of it like a weather forecast: yesterday's temperature matters more than last week's temperature when predicting today's weather. EWMA works the same way — the most recent price movements matter more than older ones.

### Why EWMA Instead of Simple Average?

We chose EWMA over simpler approaches for three practical reasons:

1. **Gas efficiency**: EWMA only needs to store ONE number (the current variance) and updates it with simple arithmetic. A simple moving average would need to store a window of N past observations, which is expensive on-chain.

2. **Responsiveness**: EWMA reacts quickly to sudden volatility spikes. A simple average of the last 20 observations treats a sudden crash the same as 20 small moves — EWMA immediately reflects the shock.

3. **Decay**: Old observations naturally fade out. If the market was volatile 2 hours ago but has been calm since, the fee automatically comes back down. No need to "forget" old data — it decays on its own.

### The Math (Simplified)

Every time someone swaps, the hook:

1. **Measures the tick change**: `delta = currentTick - lastTick`
2. **Squares it**: `squaredDelta = delta * delta` (squaring makes big moves count much more)
3. **Blends it into the running variance**:
   ```
   newVariance = α × squaredDelta + (1 - α) × oldVariance
   ```
   where `α = 0.20` (20%) — meaning new observations get 20% weight, history gets 80%

4. **Maps variance to a fee** using linear interpolation:
   ```
   If variance ≤ 10  → fee = 500 bps (0.05%)     // calm
   If variance ≥ 1000 → fee = 10000 bps (1.0%)    // volatile
   Otherwise          → linear interpolation        // smooth transition
   ```

### Staleness Protection

If no swaps happen for over 1 hour, the EWMA state is considered "stale" and resets. This prevents the fee from being stuck at an old volatility level after a period of inactivity.

### Hook Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `BASE_FEE` | 3000 | 0.3% — the default starting fee |
| `MIN_FEE` | 500 | 0.05% — floor during calm markets |
| `MAX_FEE` | 10000 | 1.0% — ceiling during volatile markets |
| `EWMA_ALPHA` | 2000 | 20% smoothing factor (in basis points) |
| `STALE_THRESHOLD` | 1 hour | Reset EWMA if no swaps for this long |
| `LOW_VARIANCE_THRESHOLD` | 10 | Below this → MIN_FEE |
| `HIGH_VARIANCE_THRESHOLD` | 1000 | Above this → MAX_FEE |

### Reading the Current Fee

From a strategy:
```javascript
const { fee, feePercentage } = await v4.getVolatilityFee('WETH', 'USDC')
// fee = 3000 (basis points), feePercentage = '0.3000%'
```

From Solidity:
```solidity
uint24 fee = hook.getPoolFee(poolId);
```

---

## On-Chain Limit Orders

### What They Are

A limit order says: "Sell my WETH when the price reaches $2500." In traditional Uniswap, there are no limit orders — you can only do instant swaps at whatever the current price is. Our hook adds real limit orders directly on-chain.

### How They Work

1. **You place an order** by depositing tokens into the hook contract at a specific price tick
2. **You receive ERC1155 "claim tokens"** as a receipt (proof you deposited)
3. **When someone else swaps** and the price crosses your tick, the hook's `afterSwap()` callback automatically fills your order
4. **You redeem** your claim tokens for the output tokens

No keeper, no off-chain matching engine, no trust assumptions. The execution is fully on-chain and atomic — it happens inside the same transaction as the swap that triggered it.

### Placing a Limit Order (Strategy Code)

```javascript
const limit = await v4.limitOrder({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',
  tick: 200250,       // price tick where order fills
  deadline: 86400     // expires in 24 hours
})
// limit.orderId, limit.txHash, limit.tick
```

### How Filling Works (afterSwap)

After every swap, the hook checks whether the price has crossed any tick with pending orders:

```
Before swap: price at tick 200300
After swap:  price dropped to tick 200240

The hook scans ticks from 200300 down to 200240.
If tick 200250 has pending limit orders → execute them.
```

The hook executes up to `MAX_EXECUTIONS_PER_SWAP` (5) orders per swap to prevent gas exhaustion.

### Cancelling a Limit Order

```javascript
const result = await v4.cancelLimitOrder('WETH', 'USDC', 200250)
// result.txHash — your tokens are returned
```

Cancelling sends an on-chain transaction that burns your ERC1155 claim tokens and returns your deposited tokens.

---

## Stop-Loss Orders

### What They Are

A stop-loss says: "If the price drops to $1800, sell my WETH immediately." It's a safety net — you accept a loss to prevent a bigger loss.

### How They Differ from Limit Orders

The key difference is the **trigger direction**:

- **Limit orders** fill when the price moves TOWARD a favorable level (buy low / sell high)
- **Stop orders** fill when the price moves AGAINST you (sell at a loss to cut exposure)

Internally, this means stop orders use a separate mapping (`pendingStopOrders`) and trigger in the **same direction** as the swap (opposite to limit orders).

```
Limit orders:
  Price goes UP   → execute sell limits (take profit)
  Price goes DOWN → execute buy limits (buy the dip)

Stop orders:
  Price goes DOWN → execute stop-losses (sell to cut losses)
  Price goes UP   → execute stop-buys (cover short positions)
```

### Placing a Stop-Loss

```javascript
const stop = await v4.stopOrder({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',
  tick: 200190        // if price drops here, auto-sell
})
```

### Stop Order ID

Stop orders use a different hash domain from limit orders to prevent ID collisions:

```solidity
// Limit: keccak256(poolId, tick, zeroForOne)
// Stop:  keccak256("STOP", poolId, tick, zeroForOne)
```

---

## Bracket (OCO) Orders

### What They Are

A bracket order is a **take-profit + stop-loss combined**. "OCO" stands for "One-Cancels-Other" — when either side fills, the other is automatically cancelled.

### Real-World Example

You bought 1 ETH at $2000 and want to:
- **Take profit** if price reaches $2500 (limit sell at upper tick)
- **Cut losses** if price drops to $1800 (stop sell at lower tick)

Whichever happens first, the other order is cancelled and your tokens are returned. This is standard bracket order behavior from traditional exchanges, implemented fully on-chain.

### How It Works On-Chain

1. You deposit tokens for BOTH sides (2x the amount — one for each order)
2. The hook places a limit order at the take-profit tick and a stop order at the stop-loss tick
3. The two orders are linked via `bracketPartner[limitOrderId] = stopOrderId` (and vice versa)
4. When one side fills, `_cancelBracketPartner()` automatically clears the other side and returns those tokens

### Placing a Bracket Order

```javascript
const bracket = await v4.bracketOrder({
  tokenIn: 'WETH',
  tokenOut: 'USDC',
  amountIn: '1.0',     // per side (total cost = 2 WETH)
  limitTick: 200370,    // take-profit tick
  stopTick: 200190,     // stop-loss tick
  deadline: 86400
})
// bracket.limitOrderId, bracket.stopOrderId, bracket.txHash
```

---

## Order ID Generation

Order IDs are deterministic — computed from the pool, tick, and direction. This means anyone can verify an order ID independently.

### Limit Order IDs

```solidity
orderId = uint256(keccak256(abi.encode(poolId, tick, zeroForOne)))
```

### Stop Order IDs

```solidity
orderId = uint256(keccak256(abi.encode("STOP", poolId, tick, zeroForOne)))
```

The `"STOP"` prefix ensures limit and stop orders at the same tick never collide.

### Bracket Partner Mapping

```solidity
bracketPartner[limitOrderId] = stopOrderId;
bracketPartner[stopOrderId] = limitOrderId;
```

---

## ERC1155 Claim Tokens

When you place an order (limit or stop), the hook mints ERC1155 tokens to your wallet. These tokens represent your claim on the order.

### Why ERC1155?

- **Fungible within a tick**: All orders at the same (pool, tick, direction) share the same token ID. This makes them efficiently batchable.
- **Transferable**: You can transfer your claim tokens to another wallet (e.g., for portfolio rebalancing).
- **Pro-rata redemption**: When an order fills, each claim token holder gets their proportional share of the output.

### Token ID = Order ID

The ERC1155 token ID is the same as the order ID (`keccak256(poolId, tick, zeroForOne)` for limits, with `"STOP"` prefix for stops).

### Lifecycle

1. **Placement** → Hook mints claim tokens to you, takes your input tokens
2. **Fill** → Hook executes the swap internally, stores output in `claimableOutputTokens[orderId]`
3. **Redemption** → You call `redeem()`, burning your claim tokens and receiving your share of the output

### Supply Tracking

```solidity
claimTokensSupply[orderId]       // Total supply of claim tokens for this order
claimableOutputTokens[orderId]   // Total output tokens available for redemption
```

Your pro-rata share: `yourOutput = (yourBalance / claimTokensSupply) × claimableOutputTokens`

---

## Hook Order Lifecycle

This is the complete flow from order placement to redemption.

### Step 1: Placement

```
Strategy calls dt['unichain-sepolia'].uniswapV4.limitOrder({...})
  → UniswapV4Protocol builds the PoolKey and encodes params
  → Calls MegaQuantRouter.placeLimitOrder()
    → Router approves tokens to hook
    → Router calls hook.placeOrder()
      → Hook validates order (tick spacing, amount > 0)
      → Hook transfers tokens from router to itself
      → Hook mints ERC1155 claim tokens to router
      → Router forwards claim tokens to your wallet
  → Order recorded in DB with status='pending', protocol='uniswap-v4-hook'
  → WebSocket broadcasts order_update
```

### Step 2: Waiting (Pending)

The order sits on-chain until a swap moves the price past your tick. The `HookOrderListener` background service polls for fill events every 15 seconds.

### Step 3: Fill Detection

```
An unrelated trader swaps through the pool
  → afterSwap() fires on MegaQuantHook
  → Hook checks: did the price cross any pending order ticks?
  → If yes: hook executes the order (swaps internally)
  → Emits OrderExecuted event
  → HookOrderListener detects the event (from finalized blocks only)
    → Updates order status in DB: 'pending' → 'filled'
    → Records trade for PnL calculation
    → Broadcasts via WebSocket
```

**Important**: The listener only processes events from **finalized blocks**, not the latest block. This prevents phantom fills from block reorgs corrupting PnL data.

### Step 4: Redemption

```
Auto-redemption triggers (or user calls manually):
  → hook.redeem(poolKey, tick, zeroForOne, amountToClaimFor)
  → Hook burns ERC1155 claim tokens
  → Hook sends output tokens to user
  → Emits event, order marked complete
```

---

## Pool Lifecycle with Our Hook

```
1. Deploy MegaQuantHook (CREATE2 with salt mining for correct address bits)
2. Deploy MegaQuantRouter (references PoolManager)
3. Deploy PoolRegistry (references PoolManager + Hook)
4. Create pool via PoolRegistry.createPool(token0, token1, tickSpacing, sqrtPrice, name)
   → Calls PoolManager.initialize(PoolKey{..., hooks: MegaQuantHook}, sqrtPrice)
   → beforeInitialize: validates pool uses DYNAMIC_FEE_FLAG
   → afterInitialize: initializes volatility state, stores initial tick
5. Users trade via MegaQuantRouter
   → beforeSwap: calculates EWMA fee, returns fee override to PoolManager
   → afterSwap: updates volatility, scans for triggered limit/stop orders
6. Users place limit orders via MegaQuantRouter → MegaQuantHook.placeOrder()
   → Hook holds tokens, mints ERC1155 claim tokens
7. When price crosses order tick, afterSwap auto-executes the order
8. Users redeem filled orders via MegaQuantHook.redeem()
```

---

## Hook Callback Reference

### Uniswap V4 Available Callbacks

| Callback | When It Fires | Used by Our Hook? |
|----------|---------------|:-:|
| `beforeInitialize` | Pool creation | Yes |
| `afterInitialize` | After pool created | Yes |
| `beforeSwap` | Before each swap | Yes |
| `afterSwap` | After each swap | Yes |
| `beforeAddLiquidity` | Before LP deposit | No |
| `afterAddLiquidity` | After LP deposit | No |
| `beforeRemoveLiquidity` | Before LP withdrawal | No |
| `afterRemoveLiquidity` | After LP withdrawal | No |
| `beforeDonate` | Before fee donation | No |
| `afterDonate` | After fee donation | No |

### Our Hook's Callback Implementations

**`beforeInitialize`**: Validates that the pool's fee field has the `DYNAMIC_FEE_FLAG` set. Reverts with `MustUseDynamicFee()` if not. This ensures every pool using our hook supports dynamic fees.

**`afterInitialize`**: Stores the pool's initial tick in `lastTicks[poolId]` and initializes a fresh `VolatilityState` with zero variance and observation count.

**`beforeSwap`**: Reads the current EWMA-based fee via `getPoolFee(poolId)` and returns it with the `OVERRIDE_FEE_FLAG`. The PoolManager uses this fee instead of the pool's default.

**`afterSwap`**: The most complex callback. In order:
1. Updates the EWMA volatility state with the new tick
2. If the swap was initiated by the hook itself (filling an order), skip order scanning
3. Scans for triggered **limit orders** between `lastTick` and `currentTick` (up to 5)
4. Scans for triggered **stop orders** in the reverse direction (up to 5 total)
5. Updates `lastTick` for the next swap

---

See also:
- [Smart Contracts Reference](./smart-contracts.md) — Full function signatures and state variables
- [Strategy SDK Reference](./strategy-sdk.md) — How to use V4 features from strategy code
- [README](../README.md) — Quick start and 9-step demo
