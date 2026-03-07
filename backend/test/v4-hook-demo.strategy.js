/**
 * MegaQuant V4 Hook Demo Strategy
 *
 * A walkthrough of every Uniswap V4 hook feature, designed to be run
 * during a live demo. Each step prints rich console output with tx hashes,
 * explorer links, and explanations of what the hook is doing on-chain.
 *
 * Prerequisites:
 * - MegaQuantHook, MegaQuantRouter, PoolRegistry deployed to unichain-sepolia
 * - Addresses configured in chains.ts (already done)
 * - Wallet funded with test tokens (WETH + USDC)
 * - USDC/WETH pool initialized with liquidity
 *
 * Usage: Create a strategy in the UI, paste this code, select unichain-sepolia, and run.
 *
 * Deployed contracts (Unichain Sepolia):
 *   Hook:     0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0
 *   Router:   0x608AEfA1DFD3621554a948E20159eB243C76235F
 *   Registry: 0x680762A631334098eeF5F24EAAafac0F07Cb2e3a
 */

async function execute(dt) {
  const EXPLORER = 'https://sepolia.uniscan.xyz'
  const chain = dt['unichain-sepolia']
  const v4 = chain.uniswapV4

  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║         MegaQuant V4 Hook Live Demo             ║')
  console.log('║         Chain: Unichain Sepolia (1301)          ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log('')

  // ──────────────────────────────────────────────────────────────
  // STEP 1: Pool Discovery
  // ──────────────────────────────────────────────────────────────
  // PoolRegistry (0x680762A6...) is an on-chain contract that stores
  // metadata for every pool created with our MegaQuantHook. Strategies
  // call getPools() to discover tradeable pools without hardcoding.
  console.log('━━━ STEP 1: Pool Discovery via PoolRegistry ━━━')
  console.log('Calling PoolRegistry.getPoolIds() + pools() on-chain...')
  console.log(`Registry contract: ${EXPLORER}/address/0x680762A631334098eeF5F24EAAafac0F07Cb2e3a`)
  console.log('')

  try {
    const pools = await v4.getPools()
    console.log(`Found ${pools.length} registered pool(s):`)
    for (const p of pools) {
      console.log(`  ┌─ ${p.name}`)
      console.log(`  │  Pool ID: ${p.poolId}`)
      console.log(`  │  Tokens:  ${p.token0} / ${p.token1}`)
      console.log(`  │  Tick Spacing: ${p.tickSpacing}  |  Active: ${p.active}`)
      console.log(`  └─ Creator: ${p.creator}`)
    }
  } catch (err) {
    console.log(`  [SKIP] getPools failed: ${err.message}`)
  }
  console.log('')

  // ──────────────────────────────────────────────────────────────
  // STEP 2: Live Pool State
  // ──────────────────────────────────────────────────────────────
  // Reads the WETH/USDC pool state from the V4 PoolManager singleton.
  // - "tick" encodes the current price (each tick = 0.01% price step)
  // - "sqrtPriceX96" is Uniswap's Q64.96 fixed-point internal price
  // - "fee" is the CURRENT dynamic fee set by our volatility hook
  // - "liquidity" is the active liquidity at the current tick
  console.log('━━━ STEP 2: Read Live Pool State from PoolManager ━━━')
  console.log('Calling PoolManager.getSlot0() for WETH/USDC...')
  console.log(`PoolManager: ${EXPLORER}/address/0x00b036b58a818b1bc34d502d3fe730db729e62ac`)
  console.log('')

  let currentTick = 0
  try {
    const pool = await v4.getPoolInfo('WETH', 'USDC')
    currentTick = pool.currentTick
    console.log(`  Pool ID:       ${pool.poolId}`)
    console.log(`  Current Tick:  ${pool.currentTick}`)
    console.log(`  sqrtPriceX96:  ${pool.sqrtPriceX96}`)
    console.log(`  Liquidity:     ${pool.liquidity}`)
    console.log(`  Dynamic Fee:   ${pool.fee} bps (${pool.feePercentage})`)
    console.log(`  Hook contract: ${EXPLORER}/address/0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0`)
  } catch (err) {
    console.log(`  [SKIP] getPoolInfo failed: ${err.message}`)
  }
  console.log('')

  // ──────────────────────────────────────────────────────────────
  // STEP 3: Volatility-Based Dynamic Fee
  // ──────────────────────────────────────────────────────────────
  // The hook maintains an EWMA (Exponentially Weighted Moving Average)
  // of squared tick changes. Higher variance → higher fee.
  //
  // How it works in the contract:
  //   beforeSwap() {
  //     ewmaVariance = alpha * (tickDelta^2) + (1-alpha) * ewmaVariance
  //     fee = baseFee + scale * sqrt(ewmaVariance)
  //     return fee   // overrides the pool's LP fee for this swap
  //   }
  //
  // Fee range: 500 bps (0.05%) in calm markets → 10000 bps (1.0%) in chaos.
  // This protects LPs the same way traditional market makers widen spreads.
  console.log('━━━ STEP 3: Volatility-Based Dynamic Fee ━━━')
  console.log('Calling MegaQuantHook.getVolatilityState() on-chain...')
  console.log('')

  try {
    const { fee, feePercentage } = await v4.getVolatilityFee('WETH', 'USDC')
    console.log(`  Current Fee:     ${fee} bps (${feePercentage})`)
    console.log(`  Fee Range:       500 bps (0.05%) ←calm── ──volatile→ 10000 bps (1.0%)`)
    console.log(`  Mechanism:       EWMA of tick^2 changes across swaps`)
    console.log(`  Hook Callback:   beforeSwap() returns dynamic fee override`)
  } catch (err) {
    console.log(`  [SKIP] getVolatilityFee failed: ${err.message}`)
  }
  console.log('')

  // ──────────────────────────────────────────────────────────────
  // STEP 4: Execute a V4 Swap
  // ──────────────────────────────────────────────────────────────
  // A standard swap through Uniswap V4. The hook intercepts it:
  //
  //   User calls swap(USDC → WETH, 5 USDC)
  //     → beforeSwap():  hook computes EWMA fee, returns override
  //     → PoolManager:   executes swap at the dynamic fee
  //     → afterSwap():   hook updates volatility state,
  //                      checks if any limit/stop orders should trigger,
  //                      executes matching orders atomically
  //
  // The tx hash lets you inspect the swap on the block explorer —
  // you'll see the token transfers, fee charged, and any orders triggered.
  console.log('━━━ STEP 4: Execute Swap (USDC → WETH) ━━━')
  console.log('Sending swap transaction to Uniswap V4 PoolManager...')
  console.log('')

  try {
    const swap = await v4.swap({
      tokenIn: 'USDC',
      tokenOut: 'WETH',
      amountIn: '5',
      slippage: 1.0
    })
    console.log(`  ✓ Swap Executed!`)
    console.log(`  Amount In:   ${swap.amountIn} USDC`)
    console.log(`  Amount Out:  ${swap.amountOut} WETH`)
    console.log(`  TX Hash:     ${swap.txHash}`)
    console.log(`  ► View TX:   ${EXPLORER}/tx/${swap.txHash}`)
    console.log(`  (Click the link above to see token transfers + hook fee on explorer)`)
  } catch (err) {
    console.log(`  [SKIP] swap failed: ${err.message}`)
  }
  console.log('')

  // ──────────────────────────────────────────────────────────────
  // STEP 5: Place a Limit Order
  // ──────────────────────────────────────────────────────────────
  // On-chain limit order, stored directly in the MegaQuantHook contract.
  //
  // What happens on-chain:
  //   1. Your WETH is transferred to the hook contract
  //   2. Hook mints ERC1155 "claim tokens" to your wallet
  //      (tokenId = keccak256(poolId, tick, zeroForOne))
  //   3. Order is stored in pendingOrders[poolId][tick][direction]
  //   4. On ANY future swap that crosses tick -60:
  //      → afterSwap() detects the tick was crossed
  //      → Executes the order atomically within the same tx
  //      → Stores output in claimableOutputTokens
  //   5. You can redeem output anytime by burning claim tokens
  //
  // No off-chain keeper needed — fully on-chain execution!
  const limitTick = currentTick - 60 || -60  // Place below current tick
  console.log('━━━ STEP 5: Place Limit Order ━━━')
  console.log(`Placing on-chain limit order: Sell 0.001 WETH at tick ${limitTick}...`)
  console.log('')

  let limitOrderId
  try {
    const limit = await v4.limitOrder({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '0.001',
      tick: limitTick,
      deadline: 86400
    })
    limitOrderId = limit.orderId
    console.log(`  ✓ Limit Order Placed!`)
    console.log(`  Order ID:    ${limit.orderId}`)
    console.log(`  Tick:        ${limit.tick}`)
    console.log(`  Amount:      ${limit.amountIn} WETH`)
    console.log(`  Deadline:    ${limit.deadline}s from now`)
    console.log(`  TX Hash:     ${limit.txHash}`)
    console.log(`  ► View TX:   ${EXPLORER}/tx/${limit.txHash}`)
    console.log(`  (On explorer: see ERC1155 Transfer event = your claim tokens)`)
    console.log(`  (When price crosses tick ${limit.tick}, hook auto-fills this order)`)
  } catch (err) {
    console.log(`  [SKIP] limitOrder failed: ${err.message}`)
  }
  console.log('')

  // ──────────────────────────────────────────────────────────────
  // STEP 6: Place a Stop-Loss Order
  // ──────────────────────────────────────────────────────────────
  // Stop orders trigger when price moves AGAINST you:
  //   - Long position? Set stop below current tick.
  //   - Short position? Set stop above current tick.
  //
  // The hook stores these in a SEPARATE mapping (pendingStopOrders)
  // and checks them in afterSwap() when the tick moves past the stop.
  // The stop order ID uses a different hash domain:
  //   stopId = keccak256("STOP", poolId, tick, zeroForOne)
  //   limitId = keccak256(poolId, tick, zeroForOne)
  // So stops and limits at the same tick don't collide.
  const stopTick = currentTick - 120 || -120  // Further below = stop-loss
  console.log('━━━ STEP 6: Place Stop-Loss Order ━━━')
  console.log(`Placing stop-loss: Sell 0.001 WETH if tick drops to ${stopTick}...`)
  console.log('')

  let stopOrderId
  try {
    const stop = await v4.stopOrder({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '0.001',
      tick: stopTick
    })
    stopOrderId = stop.orderId
    console.log(`  ✓ Stop-Loss Order Placed!`)
    console.log(`  Order ID:    ${stop.orderId}`)
    console.log(`  Tick:        ${stop.tick}`)
    console.log(`  Amount:      ${stop.amountIn} WETH`)
    console.log(`  TX Hash:     ${stop.txHash}`)
    console.log(`  ► View TX:   ${EXPLORER}/tx/${stop.txHash}`)
    console.log(`  (If price drops past tick ${stop.tick}, hook auto-sells to cut losses)`)
  } catch (err) {
    console.log(`  [SKIP] stopOrder failed: ${err.message}`)
  }
  console.log('')

  // ──────────────────────────────────────────────────────────────
  // STEP 7: Place a Bracket (OCO) Order
  // ──────────────────────────────────────────────────────────────
  // A bracket = take-profit limit + stop-loss, linked together.
  // OCO = "One-Cancels-Other".
  //
  // On-chain mechanics:
  //   1. Router.placeBracketOrder() places BOTH orders in one tx
  //   2. Hook.setBracketPartner(limitId, stopId) links them via
  //      the bracketPartner mapping (bidirectional)
  //   3. Total cost = 2x amountIn (one deposit per side)
  //   4. When EITHER side fills in afterSwap():
  //      → _cancelBracketPartner() is called
  //      → The OTHER side's pending amount is zeroed out
  //      → Bracket partner links are cleared
  //      → Deposited tokens for cancelled side are returned
  //
  // This is the classic TP/SL bracket from traditional exchanges,
  // running 100% on-chain with no centralized order book.
  const tpTick = currentTick + 60 || 60      // Take profit above
  const slTick = currentTick - 120 || -120    // Stop loss below
  console.log('━━━ STEP 7: Place Bracket (OCO) Order ━━━')
  console.log(`Placing OCO: TP at tick ${tpTick} + SL at tick ${slTick}...`)
  console.log('')

  try {
    const bracket = await v4.bracketOrder({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '0.001',
      limitTick: tpTick,
      stopTick: slTick,
      deadline: 86400
    })
    console.log(`  ✓ Bracket (OCO) Order Placed!`)
    console.log(`  Take-Profit:`)
    console.log(`    Order ID:  ${bracket.limitOrderId}`)
    console.log(`    Tick:      ${bracket.limitTick} (above current)`)
    console.log(`  Stop-Loss:`)
    console.log(`    Order ID:  ${bracket.stopOrderId}`)
    console.log(`    Tick:      ${bracket.stopTick} (below current)`)
    console.log(`  Linked:     YES (bracketPartner mapping on-chain)`)
    console.log(`  TX Hash:    ${bracket.txHash}`)
    console.log(`  ► View TX:  ${EXPLORER}/tx/${bracket.txHash}`)
    console.log(`  (On explorer: see TWO ERC1155 mints + setBracketPartner call)`)
    console.log(`  (When one side fills, the other is auto-cancelled by the hook)`)
  } catch (err) {
    console.log(`  [SKIP] bracketOrder failed: ${err.message}`)
  }
  console.log('')

  // ──────────────────────────────────────────────────────────────
  // STEP 8: TWAP Execution
  // ──────────────────────────────────────────────────────────────
  // TWAP (Time-Weighted Average Price) splits a large order into
  // smaller "slices" executed at regular intervals. This reduces
  // price impact for large trades.
  //
  // Unlike limit/stop orders, TWAP runs as a BACKEND service:
  //   - TwapService schedules timers for each slice
  //   - Each slice calls v4.swap() as a separate on-chain tx
  //   - Strategy can poll getTwapStatus() or cancelTwap()
  //
  // Each slice is a real swap with its own tx hash on-chain.
  console.log('━━━ STEP 8: TWAP Execution ━━━')
  console.log('Starting TWAP: 10 USDC → WETH over 60s in 3 slices...')
  console.log('')

  let twapId
  try {
    const twap = await v4.twap({
      tokenIn: 'USDC',
      tokenOut: 'WETH',
      totalAmount: '10',
      durationMs: 60000,    // 1 minute total
      numSlices: 3,         // 3 slices = every 20 seconds
      maxSlippage: 100      // 1% max slippage per slice
    })
    twapId = twap.twapId
    console.log(`  ✓ TWAP Started!`)
    console.log(`  TWAP ID:      ${twap.twapId}`)
    console.log(`  Total Amount: 10 USDC`)
    console.log(`  Slices:       ${twap.slicesTotal} (each ~3.33 USDC)`)
    console.log(`  Interval:     ${twap.intervalMs}ms between slices`)
    console.log(`  Status:       ${twap.status}`)
    console.log(`  (Each slice will appear as a separate swap tx on-chain)`)
  } catch (err) {
    console.log(`  [SKIP] twap failed: ${err.message}`)
  }
  console.log('')

  // Wait a moment for first slice to execute
  if (twapId) {
    console.log('  Waiting 5s for first TWAP slice...')
    await sleep(5000)

    try {
      const status = await v4.getTwapStatus(twapId)
      console.log(`  TWAP Progress: ${status.slicesExecuted}/${status.slicesTotal} slices`)
      console.log(`  Status: ${status.status}`)
      if (status.totalAmountOut) {
        console.log(`  Total WETH received so far: ${status.totalAmountOut}`)
      }
    } catch (err) {
      console.log(`  [SKIP] getTwapStatus: ${err.message}`)
    }

    // Cancel remaining slices for the demo
    try {
      await v4.cancelTwap(twapId)
      console.log(`  TWAP cancelled (remaining slices stopped)`)
    } catch (err) {
      console.log(`  [SKIP] cancelTwap: ${err.message}`)
    }
    console.log('')
  }

  // ──────────────────────────────────────────────────────────────
  // STEP 9: View All Hook Orders
  // ──────────────────────────────────────────────────────────────
  // All hook orders are tracked in the database with protocol='uniswap-v4-hook'.
  // The HookOrderListener service polls on-chain events (OrderExecuted,
  // StopOrderExecuted, BracketPartnerCancelled) to auto-update statuses.
  // These orders also appear in the "Hooks" tab in the MegaQuant UI.
  console.log('━━━ STEP 9: View All Hook Orders ━━━')

  try {
    const orders = await v4.getMyHookOrders()
    console.log(`Total hook orders: ${orders.length}`)
    console.log('')
    console.log('  ┌──────────┬────────┬────────┬──────────┬────────────────────────────┐')
    console.log('  │ Type     │ Side   │ Tick   │ Status   │ Hook Order ID              │')
    console.log('  ├──────────┼────────┼────────┼──────────┼────────────────────────────┤')
    for (const o of orders) {
      const type = (o.orderType || '?').padEnd(8)
      const side = (o.side || '?').padEnd(6)
      const tick = String(o.tick || 0).padEnd(6)
      const status = (o.status || '?').padEnd(8)
      const id = (o.hookOrderId || '').slice(0, 26)
      console.log(`  │ ${type} │ ${side} │ ${tick} │ ${status} │ ${id} │`)
    }
    console.log('  └──────────┴────────┴────────┴──────────┴────────────────────────────┘')

    const pending = orders.filter(o => o.status === 'pending').length
    const filled = orders.filter(o => o.status === 'filled').length
    const cancelled = orders.filter(o => o.status === 'cancelled').length
    console.log(`  Summary: ${pending} pending, ${filled} filled, ${cancelled} cancelled`)
    console.log(`  These are all visible in the MegaQuant UI → Hooks tab`)
  } catch (err) {
    console.log(`  [SKIP] getMyHookOrders: ${err.message}`)
  }
  console.log('')

  // ──────────────────────────────────────────────────────────────
  // STEP 10: Cancel & Cleanup
  // ──────────────────────────────────────────────────────────────
  // Cancellation sends an on-chain tx to the hook contract:
  //   - Burns your ERC1155 claim tokens
  //   - Returns your deposited tokens
  //   - Zeros out pendingOrders/pendingStopOrders for that tick
  //   - OrderManager updates DB status to 'cancelled'
  console.log('━━━ STEP 10: Cancel Orders & Check PnL ━━━')

  if (limitOrderId) {
    try {
      const cancel = await v4.cancelLimitOrder('WETH', 'USDC', limitTick)
      console.log(`  ✓ Limit order cancelled`)
      console.log(`    TX Hash:  ${cancel.txHash}`)
      console.log(`    ► View:   ${EXPLORER}/tx/${cancel.txHash}`)
    } catch (err) {
      console.log(`  [SKIP] cancelLimitOrder: ${err.message}`)
    }
  }

  if (stopOrderId) {
    try {
      const cancel = await v4.cancelStopOrder('WETH', 'USDC', stopTick)
      console.log(`  ✓ Stop order cancelled`)
      console.log(`    TX Hash:  ${cancel.txHash}`)
      console.log(`    ► View:   ${EXPLORER}/tx/${cancel.txHash}`)
    } catch (err) {
      console.log(`  [SKIP] cancelStopOrder: ${err.message}`)
    }
  }

  // PnL — unified across all protocols (V3, V4, V4 hooks, Binance)
  try {
    const pnl = dt.pnl.getTotal()
    console.log('')
    console.log(`  Portfolio PnL (all protocols combined):`)
    console.log(`    Realized PnL:   $${pnl.totalRealizedPnl.toFixed(4)}`)
    console.log(`    Unrealized PnL: $${(pnl.totalUnrealizedPnl || 0).toFixed(4)}`)
  } catch (err) {
    console.log(`  [SKIP] PnL: ${err.message}`)
  }

  // ──────────────────────────────────────────────────────────────
  // DONE
  // ──────────────────────────────────────────────────────────────
  console.log('')
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║              Demo Complete!                      ║')
  console.log('║                                                  ║')
  console.log('║  All transactions are live on Unichain Sepolia.  ║')
  console.log('║  Click any TX hash above to open block explorer. ║')
  console.log('║                                                  ║')
  console.log('║  Key contracts:                                  ║')
  console.log('║  Hook:     0xB591b509...f6f0c0                   ║')
  console.log('║  Router:   0x608AEfA1...6235F                    ║')
  console.log('║  Registry: 0x680762A6...8C2a                     ║')
  console.log('╚══════════════════════════════════════════════════╝')
}
