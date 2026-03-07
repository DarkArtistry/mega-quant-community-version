# Smart Contracts Reference

Complete reference for all Solidity contracts in the MegaQuant system. These contracts run on-chain and handle the core trading logic — swaps, order placement, order execution, fee calculation, and pool discovery.

> **New to smart contracts?** Think of these as programs that live on the blockchain. Once deployed, nobody can change them — they execute exactly as written. Users interact with them by sending transactions.

## Table of Contents

1. [MegaQuantHook.sol](#megaquanthooksol)
2. [MegaQuantRouter.sol](#megaquantroutersol)
3. [PoolRegistry.sol](#poolregistrysol)
4. [VolatilityMath.sol](#volatilitymathsol)
5. [OrderLib.sol](#orderlibsol)
6. [Contract Interaction Flows](#contract-interaction-flows)
7. [Deployment](#deployment)

---

## MegaQuantHook.sol

**Inherits**: `BaseHook`, `ERC1155`, `ReentrancyGuard`

The heart of the system. This contract plugs into Uniswap V4's PoolManager and adds four features that Uniswap doesn't natively support:

- **Dynamic swap fees** that adjust automatically based on market volatility
- **Limit orders** that fill when the price reaches a target level
- **Stop-loss orders** that trigger when the price moves against you
- **Bracket orders** (OCO) that link a take-profit and stop-loss together

### Why does this contract exist?

Uniswap V4 only supports instant swaps — you swap at whatever the current price is. There's no way to say "buy when the price drops to X" or "sell if the price crashes below Y." Our hook adds these order types directly on-chain, so they execute automatically without any off-chain infrastructure.

The dynamic fee feature protects liquidity providers. Without it, LPs use a fixed fee that can't adapt to market conditions — they get picked off by arbitrage bots during volatile periods.

### Structs

```solidity
struct VolatilityState {
    int24 lastTick;           // Last observed tick
    uint256 lastTimestamp;    // When the last observation was recorded
    uint256 ewmaVariance;    // Running EWMA variance (how volatile the market is)
    uint256 observationCount; // Total number of observations
}
```

### Constants

| Name | Value | What It Controls |
|------|-------|-----------------|
| `BASE_FEE` | 3000 (0.3%) | Default fee before volatility adjustment |
| `MIN_FEE` | 500 (0.05%) | Lowest possible fee — used when market is calm |
| `MAX_FEE` | 10000 (1.0%) | Highest possible fee — used when market is very volatile |
| `EWMA_ALPHA` | 2000 (20%) | How much weight to give the latest price move vs history |
| `STALE_THRESHOLD` | 1 hour | If no swaps happen for this long, reset volatility tracking |
| `LOW_VARIANCE_THRESHOLD` | 10 | Below this variance, use MIN_FEE |
| `HIGH_VARIANCE_THRESHOLD` | 1000 | Above this variance, use MAX_FEE |
| `MAX_EXECUTIONS_PER_SWAP` | 5 | Max orders that can trigger in a single swap (prevents gas exhaustion) |

### Events

```solidity
// Limit orders
event OrderPlaced(address indexed trader, PoolId indexed poolId, int24 tick, bool zeroForOne, uint256 amount, uint64 deadline)
event OrderExecuted(PoolId indexed poolId, int24 tick, bool zeroForOne, uint256 amountIn, uint256 amountOut)
event OrderCancelled(address indexed trader, PoolId indexed poolId, int24 tick, bool zeroForOne, uint256 amount)

// Stop orders
event StopOrderPlaced(address indexed trader, PoolId indexed poolId, int24 tick, bool zeroForOne, uint256 amount, uint64 deadline)
event StopOrderExecuted(PoolId indexed poolId, int24 tick, bool zeroForOne, uint256 amountIn, uint256 amountOut)
event StopOrderCancelled(address indexed trader, PoolId indexed poolId, int24 tick, bool zeroForOne, uint256 amount)

// Bracket orders
event BracketPartnerCancelled(uint256 indexed cancelledOrderId, uint256 indexed partnerOrderId)
```

### State Variables

```solidity
// Volatility tracking — one state per pool
mapping(PoolId => VolatilityState) public volatilityStates;
mapping(PoolId => int24) public lastTicks;

// Limit orders — amount of tokens waiting at each (pool, tick, direction)
mapping(PoolId => mapping(int24 => mapping(bool => uint256))) public pendingOrders;
mapping(uint256 => uint256) public claimableOutputTokens;   // orderId → output tokens available
mapping(uint256 => uint256) public claimTokensSupply;       // orderId → total ERC1155 supply
mapping(uint256 => uint64) public orderDeadlines;           // orderId → expiry timestamp

// Stop orders — same structure, separate mappings
mapping(PoolId => mapping(int24 => mapping(bool => uint256))) public pendingStopOrders;
mapping(uint256 => uint256) public stopClaimableOutputTokens;
mapping(uint256 => uint256) public stopClaimTokensSupply;
mapping(uint256 => uint64) public stopOrderDeadlines;

// Bracket linking — connects take-profit ↔ stop-loss
mapping(uint256 => uint256) public bracketPartner;
```

### Public Functions

#### Volatility & Fee Reading

| Function | What It Does |
|----------|-------------|
| `getPoolFee(PoolId poolId) → uint24` | Returns the current dynamic fee for a pool in basis points. This is what traders actually pay when they swap. The fee changes after every swap based on the EWMA variance. |
| `getVolatilityState(PoolId poolId) → (int24 lastTick, uint256 lastTimestamp, uint256 ewmaVariance, uint256 observationCount)` | Returns the raw volatility tracking data. Useful for analytics — you can see exactly how volatile the pool has been and how many swaps have been observed. |

#### Limit Order Functions

| Function | What It Does |
|----------|-------------|
| `placeOrder(key, tickToSellAt, zeroForOne, inputAmount, deadline) → int24` | Deposits your tokens into the hook at a specific price tick. You get ERC1155 claim tokens back. Returns the actual tick used (snapped to tick spacing). The `zeroForOne` parameter indicates swap direction: `true` = sell token0 for token1, `false` = the reverse. |
| `cancelOrder(key, tickToSellAt, zeroForOne)` | Cancels your pending limit order. Burns your ERC1155 claim tokens and returns your deposited tokens. Only works if the order hasn't been filled yet. |
| `redeem(key, tickToSellAt, zeroForOne, inputAmountToClaimFor)` | After an order fills, claim your share of the output tokens. Burns your claim tokens and sends you the proportional output. |
| `getOrderId(key, tick, zeroForOne) → uint256` | Compute the deterministic order ID for a limit order. This is a pure function — it doesn't read any state. Useful for checking ERC1155 balances. |

#### Stop Order Functions

| Function | What It Does |
|----------|-------------|
| `placeStopOrder(key, tickToSellAt, zeroForOne, inputAmount, deadline) → int24` | Same as `placeOrder` but for stop orders. Stop orders trigger in the opposite direction — they're protective exits (stop-losses). |
| `cancelStopOrder(key, tickToSellAt, zeroForOne)` | Cancel a pending stop order and get your tokens back. |
| `redeemStopOrder(key, tickToSellAt, zeroForOne, inputAmountToClaimFor)` | Claim output tokens from a filled stop order. |
| `getStopOrderId(key, tick, zeroForOne) → uint256` | Compute the deterministic ID for a stop order. Uses a `"STOP"` prefix to avoid collision with limit order IDs at the same tick. |

#### Bracket Order Functions

| Function | What It Does |
|----------|-------------|
| `setBracketPartner(orderId, partnerId)` | Links two orders as bracket partners. When one fills, the hook automatically cancels the other. Usually called by MegaQuantRouter during bracket order placement. |

#### Hook Permission

| Function | What It Does |
|----------|-------------|
| `getHookPermissions() → Hooks.Permissions` | Returns which V4 callbacks this hook uses: `beforeInitialize`, `afterInitialize`, `beforeSwap`, `afterSwap`. |

---

## MegaQuantRouter.sol

**Inherits**: `IUnlockCallback`, `IMsgSender`

The user-facing entry point for swaps and order placement. It handles the V4 PoolManager's "unlock" pattern (all V4 operations must happen inside an unlock callback) and provides convenience functions.

### Why does this contract exist?

Uniswap V4 requires a specific interaction pattern: you call `poolManager.unlock()`, which calls back into your contract's `unlockCallback()`, and all swaps/operations happen inside that callback. The router abstracts this complexity so users just call `swap()` or `placeLimitOrder()` normally.

The router also handles the token flow for orders — it transfers tokens from the user to the hook, and forwards ERC1155 claim tokens back to the user.

### Structs

```solidity
struct SwapCallbackData {
    address sender;        // Original caller
    PoolKey key;           // Which pool to swap in
    SwapParams params;     // Swap parameters (direction, amount, price limit)
    bytes hookData;        // Extra data passed to the hook
}

struct BatchSwapCallbackData {
    address sender;
    PoolKey[] keys;
    SwapParams[] paramsArray;
    bytes[] hookDataArray;
}
```

### Public Functions

#### Swapping

| Function | What It Does |
|----------|-------------|
| `swap(key, params, hookData) → BalanceDelta` | Execute a single swap through V4. Handles the unlock callback pattern, settles all token transfers. The `BalanceDelta` return tells you exactly how many tokens moved in each direction. |
| `batchSwap(keys[], paramsArray[], hookDataArray[]) → BalanceDelta[]` | Execute multiple swaps in a single transaction. All swaps happen inside one `unlock()` call, saving gas through V4's flash accounting (intermediate hops don't need separate transfers). |

#### Order Placement

| Function | What It Does |
|----------|-------------|
| `placeLimitOrder(key, tick, amountIn, zeroForOne, deadline, hookData) → int24` | Place a limit order through the hook. Transfers your tokens to the hook, receives ERC1155 claim tokens, and forwards them to your wallet. Returns the actual tick used. |
| `placeStopOrder(key, tick, amountIn, zeroForOne, deadline, hookData) → int24` | Same as above but for stop orders. |
| `placeBracketOrder(key, limitTick, stopTick, zeroForOne, amountIn, deadline) → (int24, int24)` | Place a linked take-profit + stop-loss. Requires 2x `amountIn` (one for each side). Automatically links the two orders via `bracketPartner`. Returns both actual ticks. |

#### Callback & Utility

| Function | What It Does |
|----------|-------------|
| `unlockCallback(rawData) → bytes` | Called by PoolManager during `unlock()`. Dispatches to swap or batch swap handler. |
| `msgSender() → address` | Returns the original caller (stored in transient storage during the unlock callback). |
| `onERC1155Received(...)` | Required to receive ERC1155 claim tokens from the hook. |
| `onERC1155BatchReceived(...)` | Required for batch ERC1155 transfers. |

---

## PoolRegistry.sol

A simple registry contract for discovering pools that use MegaQuantHook. Since V4's PoolManager has no built-in way to list pools, this registry lets the frontend and strategies discover available markets.

### Why does this contract exist?

In Uniswap V4, there's no way to query "show me all pools using hook X." The PoolManager doesn't provide pool enumeration. Without a registry, users would need to know pool IDs in advance or rely on off-chain indexing (subgraphs). The registry makes pool discovery possible on-chain.

### Structs

```solidity
struct PoolInfo {
    address token0;        // First token address (sorted, lower)
    address token1;        // Second token address
    int24 tickSpacing;     // Pool tick spacing
    address creator;       // Who created this pool
    string name;           // Human-readable name (e.g., "WETH/USDC Dynamic Fee")
    bool active;           // Whether pool is active
}
```

### Events

```solidity
event PoolRegistered(
    bytes32 indexed poolId,
    address indexed token0,
    address indexed token1,
    int24 tickSpacing,
    address creator,
    string name
)
```

### State Variables

```solidity
IPoolManager public immutable poolManager;    // V4 PoolManager reference
address public immutable hookAddress;          // MegaQuantHook address
bytes32[] public poolIds;                      // All registered pool IDs
mapping(bytes32 => PoolInfo) public pools;     // Pool metadata by ID
```

### Public Functions

| Function | What It Does |
|----------|-------------|
| `createPool(currency0, currency1, tickSpacing, sqrtPriceX96, name) → bytes32` | Register a new pool. If `sqrtPriceX96 > 0`, also initializes the pool on the PoolManager. Returns the pool ID. Reverts if tokens are in wrong order (`InvalidTokenOrder`). |
| `poolCount() → uint256` | How many pools are registered. |
| `getPoolsForPair(currency0, currency1) → bytes32[]` | Find all pools for a specific token pair (e.g., all WETH/USDC pools). |
| `getPoolIds(offset, limit) → bytes32[]` | Paginated listing of all pool IDs. Used by the backend to fetch pools in batches. |

---

## VolatilityMath.sol

**Type**: Library (pure functions, no state)

The math engine behind dynamic fees. Contains two functions that the hook calls every swap.

### Why does this library exist?

Separating the math into a library makes it independently testable and keeps the main hook contract focused on lifecycle logic. The EWMA algorithm needs to be correct and gas-efficient — isolating it makes both easier to verify.

### Functions

#### `updateEWMA`

```solidity
function updateEWMA(
    uint256 currentVariance,
    int24 lastTick,
    int24 currentTick,
    uint256 alpha
) internal pure returns (uint256)
```

**What it does**: Updates the running volatility estimate. Called after every swap.

**In plain English**: "How different is the current price from the last price? Blend that difference into our running average, giving 20% weight to the new data and 80% weight to the historical average."

**The math**:
```
tickDelta = currentTick - lastTick
squaredDelta = tickDelta × tickDelta
newVariance = (alpha × squaredDelta + (10000 - alpha) × currentVariance) / 10000
```

**Why squared?** Squaring the delta means big price moves count much more than small ones. A 10-tick move contributes 100 to the variance, while a 1-tick move only contributes 1. This matches how real volatility works — what matters is the magnitude of moves, not their direction.

#### `calculateFee`

```solidity
function calculateFee(
    uint256 variance,
    uint256 minFee,
    uint256 maxFee,
    uint256 baseFee,
    uint256 lowThreshold,
    uint256 highThreshold
) internal pure returns (uint24 fee)
```

**What it does**: Converts the current variance into a fee between `minFee` and `maxFee`.

**In plain English**: "Given how volatile the market is right now, what fee should we charge?" Low volatility → low fee (0.05%), high volatility → high fee (1.0%), with a smooth transition in between.

**The math**:
```
If variance ≤ lowThreshold  → return minFee (0.05%)
If variance ≥ highThreshold → return maxFee (1.0%)
Otherwise → linear interpolation:
  fee = minFee + ((variance - lowThreshold) × (maxFee - minFee)) / (highThreshold - lowThreshold)
```

---

## OrderLib.sol

**Type**: Library (pure functions, no state)

Utility library for encoding and decoding order metadata that gets passed as "hook data" in V4 transactions.

### Why does this library exist?

When placing an order through V4, you can attach arbitrary bytes as "hook data." OrderLib provides a standard way to encode/decode order metadata (who placed it, what strategy it belongs to, what type of order it is) into those bytes.

### Constants

| Name | Value | Meaning |
|------|-------|---------|
| `ORDER_TYPE_LIMIT` | 1 | Standard limit order |
| `ORDER_TYPE_STOP_LOSS` | 2 | Stop-loss order |
| `ORDER_TYPE_TAKE_PROFIT` | 3 | Take-profit order |

### Structs

```solidity
struct Order {
    address trader;       // Who placed the order
    uint64 strategyId;    // Which strategy this belongs to
    uint8 orderType;      // LIMIT, STOP_LOSS, or TAKE_PROFIT
    bytes extraData;      // Any additional data
}
```

### Functions

| Function | What It Does |
|----------|-------------|
| `encodeHookData(trader, strategyId, orderType, extraData) → bytes` | Packs order metadata into bytes for passing as V4 hook data. |
| `decodeHookData(data) → (trader, strategyId, orderType, extraData)` | Unpacks hook data bytes back into structured order metadata. |

---

## Contract Interaction Flows

### Swap Flow

```
User → MegaQuantRouter.swap(poolKey, params, hookData)
  → Router calls poolManager.unlock(callbackData)
    → PoolManager calls router.unlockCallback(data)
      → Router stores msg.sender in transient storage
      → Router calls poolManager.swap(key, params, hookData)
        → PoolManager calls hook.beforeSwap() → returns dynamic fee
        → PoolManager executes swap at the dynamic fee
        → PoolManager calls hook.afterSwap()
          → Hook updates EWMA volatility
          → Hook checks for triggered limit/stop orders
          → If orders trigger: hook executes them internally
      → Router settles token balances (transfers in/out)
  → User receives swapped tokens
```

### Limit Order Placement Flow

```
User → MegaQuantRouter.placeLimitOrder(key, tick, amount, zeroForOne, deadline, hookData)
  → Router transfers input tokens from user
  → Router approves tokens to hook
  → Router calls hook.placeOrder(key, tick, zeroForOne, amount, deadline)
    → Hook validates tick spacing and amount
    → Hook transfers tokens from router to itself
    → Hook adds amount to pendingOrders[poolId][tick][zeroForOne]
    → Hook mints ERC1155 claim tokens to router
    → Hook emits OrderPlaced event
  → Router forwards ERC1155 claim tokens to user
```

### Limit Order Fill Flow

```
A third party swaps through the pool
  → afterSwap() fires
  → Hook sees price crossed from tick A to tick B
  → Hook scans ticks between A and B for pending orders
  → For each tick with orders:
    → Hook executes a reverse swap (filling the order)
    → Stores output in claimableOutputTokens[orderId]
    → Cancels any bracket partner
    → Emits OrderExecuted event
```

### Stop Order Fill Flow

```
A third party swaps through the pool
  → afterSwap() fires
  → After checking limit orders, hook checks stop orders
  → Stop orders trigger in the SAME direction as the swap (opposite to limits)
    → Price drops → stop-loss sells fire
    → Price rises → stop-buy covers fire
  → Execution and settlement is identical to limit order fills
  → If bracket-linked, the partner order is auto-cancelled
```

### Bracket Order Placement Flow

```
User → MegaQuantRouter.placeBracketOrder(key, limitTick, stopTick, zeroForOne, amount, deadline)
  → Router transfers 2x amount from user (one for each side)
  → Router calls hook.placeOrder() for the limit (take-profit) side
  → Router calls hook.placeStopOrder() for the stop (stop-loss) side
  → Router calls hook.setBracketPartner(limitOrderId, stopOrderId)
  → Router forwards all ERC1155 claim tokens to user
```

---

## Deployment

Contracts are built with [Foundry](https://book.getfoundry.sh/):

```bash
cd contracts
forge build    # compile
forge test     # run tests
```

### Deployment Scripts

Located in `contracts/script/`:

- `DeployHook.s.sol` — Deploys MegaQuantHook with CREATE2 salt mining (hook address must encode the correct callback flags)
- `DeployRouter.s.sol` — Deploys MegaQuantRouter (references PoolManager)
- `DeployPoolRegistry.s.sol` — Deploys PoolRegistry (references PoolManager + Hook)
- `CreatePool.s.sol` — Creates a pool via the registry

### Deployed Addresses

#### Unichain Sepolia (Chain ID: 1301)

| Contract | Address |
|----------|---------|
| PoolManager (Uniswap) | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` |
| MegaQuantHook | `0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0` |
| MegaQuantRouter | `0x608AEfA1DFD3621554a948E20159eB243C76235F` |
| PoolRegistry | `0x680762A631334098eeF5F24EAAafac0F07Cb2e3a` |

---

See also:
- [V4 Hooks Deep Dive](./v4-hooks.md) — Architecture, EWMA explanation, order lifecycle
- [Strategy SDK Reference](./strategy-sdk.md) — How to call these contracts from strategy code
- [README](../README.md) — Quick start guide
