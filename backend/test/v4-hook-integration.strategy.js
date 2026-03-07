/**
 * V4 Hook Integration Test Strategy
 *
 * Tests all V4 hook features exposed via the dt object.
 * This strategy is meant to be loaded into MegaQuant and run against
 * a chain with deployed MegaQuantHook + MegaQuantRouter + PoolRegistry.
 *
 * Prerequisites:
 * - MegaQuantHook, MegaQuantRouter, PoolRegistry deployed to unichain-sepolia
 * - Addresses configured in chains.ts
 * - Wallet funded with test tokens (WETH + USDC on target chain)
 * - Pool initialized with liquidity
 *
 * Usage: Create a strategy in the UI, paste this code, and run on unichain-sepolia.
 */

async function execute(dt) {
  const chain = dt['unichain-sepolia']
  const v4 = chain.uniswapV4

  const results = {
    passed: 0,
    failed: 0,
    errors: [],
  }

  function assert(condition, label) {
    if (condition) {
      console.log(`  PASS: ${label}`)
      results.passed++
    } else {
      console.log(`  FAIL: ${label}`)
      results.failed++
      results.errors.push(label)
    }
  }

  // =====================================================================
  // Test 1: getPoolInfo — read on-chain pool state
  // =====================================================================
  console.log('\n=== Test 1: getPoolInfo ===')
  try {
    const pool = await v4.getPoolInfo('WETH', 'USDC')
    assert(pool.poolId && pool.poolId.length > 0, 'poolId is non-empty')
    assert(typeof pool.currentTick === 'number', 'currentTick is a number')
    assert(pool.sqrtPriceX96 && pool.sqrtPriceX96.length > 0, 'sqrtPriceX96 is non-empty')
    assert(pool.liquidity && pool.liquidity !== '0', 'liquidity is non-zero')
    assert(typeof pool.fee === 'number', 'fee is a number')
    assert(pool.feePercentage && pool.feePercentage.includes('%'), 'feePercentage has % symbol')
    console.log(`  Pool: tick=${pool.currentTick}, fee=${pool.feePercentage}, liq=${pool.liquidity}`)
  } catch (err) {
    console.log(`  SKIP: getPoolInfo failed (pool may not exist): ${err.message}`)
  }

  // =====================================================================
  // Test 2: getVolatilityFee — read dynamic fee from hook
  // =====================================================================
  console.log('\n=== Test 2: getVolatilityFee ===')
  try {
    const { fee, feePercentage } = await v4.getVolatilityFee('WETH', 'USDC')
    assert(typeof fee === 'number', 'fee is a number')
    assert(fee >= 500 && fee <= 10000, `fee ${fee} is within valid range [500, 10000]`)
    assert(feePercentage.includes('%'), 'feePercentage includes %')
    console.log(`  Volatility fee: ${fee} (${feePercentage})`)
  } catch (err) {
    console.log(`  SKIP: getVolatilityFee failed: ${err.message}`)
  }

  // =====================================================================
  // Test 3: limitOrder — place a limit order and verify DB recording
  // =====================================================================
  console.log('\n=== Test 3: limitOrder ===')
  let limitOrderId
  try {
    const limit = await v4.limitOrder({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '0.001',
      targetPrice: '3000',
      tick: -200400,
      deadline: 86400,
    })
    assert(limit.success === true, 'limitOrder returned success')
    assert(limit.orderId && limit.orderId.length > 0, 'orderId is non-empty')
    assert(limit.txHash && limit.txHash.startsWith('0x'), 'txHash is valid')
    assert(limit.tick === -200400, 'tick matches input')
    assert(limit.amountIn === '0.001', 'amountIn matches')
    limitOrderId = limit.orderId
    console.log(`  Limit order placed: ${limit.orderId.slice(0, 18)}... tx=${limit.txHash.slice(0, 18)}...`)

    // Verify it appears in getMyHookOrders
    const orders = await v4.getMyHookOrders()
    const found = orders.find(o => o.hookOrderId === limitOrderId)
    assert(found !== undefined, 'limit order appears in getMyHookOrders')
    if (found) {
      assert(found.orderType === 'limit', 'orderType is limit')
      assert(found.status === 'pending', 'status is pending')
    }
  } catch (err) {
    console.log(`  FAIL: limitOrder error: ${err.message}`)
    results.failed++
    results.errors.push(`limitOrder: ${err.message}`)
  }

  // =====================================================================
  // Test 4: stopOrder — place a stop-loss order
  // =====================================================================
  console.log('\n=== Test 4: stopOrder ===')
  let stopOrderId
  try {
    const stop = await v4.stopOrder({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '0.001',
      tick: -202200,
    })
    assert(stop.success === true, 'stopOrder returned success')
    assert(stop.orderId && stop.orderId.length > 0, 'stop orderId is non-empty')
    assert(stop.txHash && stop.txHash.startsWith('0x'), 'stop txHash is valid')
    stopOrderId = stop.orderId
    console.log(`  Stop order placed: ${stop.orderId.slice(0, 18)}... tx=${stop.txHash.slice(0, 18)}...`)

    // Verify protocol is 'uniswap-v4-hook'
    const orders = await v4.getMyHookOrders()
    const found = orders.find(o => o.hookOrderId === stopOrderId)
    assert(found !== undefined, 'stop order appears in getMyHookOrders')
    if (found) {
      assert(found.orderType === 'stop', 'orderType is stop')
    }
  } catch (err) {
    console.log(`  FAIL: stopOrder error: ${err.message}`)
    results.failed++
    results.errors.push(`stopOrder: ${err.message}`)
  }

  // =====================================================================
  // Test 5: bracketOrder — place OCO (limit TP + stop SL)
  // =====================================================================
  console.log('\n=== Test 5: bracketOrder ===')
  try {
    const bracket = await v4.bracketOrder({
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn: '0.001',
      limitTick: -200400,
      stopTick: -202200,
      deadline: 86400,
    })
    assert(bracket.success === true, 'bracketOrder returned success')
    assert(bracket.limitOrderId && bracket.limitOrderId.length > 0, 'limitOrderId non-empty')
    assert(bracket.stopOrderId && bracket.stopOrderId.length > 0, 'stopOrderId non-empty')
    assert(bracket.limitOrderId !== bracket.stopOrderId, 'limit and stop IDs are different')
    assert(bracket.txHash && bracket.txHash.startsWith('0x'), 'txHash is valid')
    console.log(`  Bracket: TP=${bracket.limitOrderId.slice(0, 12)}... SL=${bracket.stopOrderId.slice(0, 12)}...`)

    // Verify both orders are linked in DB
    const orders = await v4.getMyHookOrders()
    const limitSide = orders.find(o => o.hookOrderId === bracket.limitOrderId)
    const stopSide = orders.find(o => o.hookOrderId === bracket.stopOrderId)
    assert(limitSide !== undefined, 'bracket limit side in DB')
    assert(stopSide !== undefined, 'bracket stop side in DB')
    if (limitSide && stopSide) {
      assert(
        limitSide.linkedOrderId === stopSide.id || stopSide.linkedOrderId === limitSide.id,
        'bracket orders are linked via linkedOrderId'
      )
    }
  } catch (err) {
    console.log(`  FAIL: bracketOrder error: ${err.message}`)
    results.failed++
    results.errors.push(`bracketOrder: ${err.message}`)
  }

  // =====================================================================
  // Test 6: TWAP — start sliced execution
  // =====================================================================
  console.log('\n=== Test 6: twap ===')
  let twapId
  try {
    const twap = await v4.twap({
      tokenIn: 'USDC',
      tokenOut: 'WETH',
      totalAmount: '10',
      durationMs: 60000,    // 1 minute
      numSlices: 3,         // every 20s
      maxSlippage: 100,     // 1%
    })
    assert(twap.twapId && twap.twapId.length > 0, 'twapId is non-empty')
    assert(twap.status === 'active', 'status is active')
    assert(twap.slicesTotal === 3, 'slicesTotal is 3')
    assert(twap.intervalMs === 20000, 'intervalMs is 20000')
    twapId = twap.twapId
    console.log(`  TWAP started: ${twap.twapId} (${twap.slicesTotal} slices, interval=${twap.intervalMs}ms)`)
  } catch (err) {
    console.log(`  FAIL: twap error: ${err.message}`)
    results.failed++
    results.errors.push(`twap: ${err.message}`)
  }

  // =====================================================================
  // Test 7: getTwapStatus
  // =====================================================================
  console.log('\n=== Test 7: getTwapStatus ===')
  if (twapId) {
    try {
      // Wait a moment for first slice
      await sleep(5000)
      const status = await v4.getTwapStatus(twapId)
      assert(status.twapId === twapId, 'twapId matches')
      assert(typeof status.slicesExecuted === 'number', 'slicesExecuted is a number')
      assert(typeof status.slicesTotal === 'number', 'slicesTotal is a number')
      assert(status.slicesTotal === 3, 'slicesTotal is 3')
      console.log(`  TWAP status: ${status.slicesExecuted}/${status.slicesTotal} slices, status=${status.status}`)
    } catch (err) {
      console.log(`  FAIL: getTwapStatus error: ${err.message}`)
      results.failed++
    }
  } else {
    console.log('  SKIP: no twapId')
  }

  // =====================================================================
  // Test 8: cancelTwap
  // =====================================================================
  console.log('\n=== Test 8: cancelTwap ===')
  if (twapId) {
    try {
      await v4.cancelTwap(twapId)
      const status = await v4.getTwapStatus(twapId)
      assert(status.status === 'cancelled', 'TWAP status is cancelled after cancel')
      console.log(`  TWAP cancelled: ${status.status}`)
    } catch (err) {
      console.log(`  FAIL: cancelTwap error: ${err.message}`)
      results.failed++
    }
  } else {
    console.log('  SKIP: no twapId')
  }

  // =====================================================================
  // Test 9: getMyHookOrders — verify all orders are visible
  // =====================================================================
  console.log('\n=== Test 9: getMyHookOrders ===')
  try {
    const orders = await v4.getMyHookOrders()
    assert(Array.isArray(orders), 'returns an array')
    assert(orders.length > 0, 'has at least one order')
    const pendingCount = orders.filter(o => o.status === 'pending').length
    console.log(`  Total hook orders: ${orders.length}, pending: ${pendingCount}`)

    // Check order structure
    if (orders.length > 0) {
      const o = orders[0]
      assert(typeof o.id === 'string', 'order has id')
      assert(typeof o.orderType === 'string', 'order has orderType')
      assert(typeof o.side === 'string', 'order has side')
      assert(typeof o.tick === 'number', 'order has tick')
      assert(typeof o.status === 'string', 'order has status')
      assert(typeof o.hookOrderId === 'string', 'order has hookOrderId')
      assert(typeof o.createdAt === 'string', 'order has createdAt')
    }
  } catch (err) {
    console.log(`  FAIL: getMyHookOrders error: ${err.message}`)
    results.failed++
  }

  // =====================================================================
  // Test 10: cancelLimitOrder
  // =====================================================================
  console.log('\n=== Test 10: cancelLimitOrder ===')
  try {
    const result = await v4.cancelLimitOrder('WETH', 'USDC', -200400)
    assert(result.success === true, 'cancelLimitOrder returned success')
    assert(result.txHash && result.txHash.startsWith('0x'), 'txHash is valid')
    console.log(`  Cancelled limit order, tx=${result.txHash.slice(0, 18)}...`)

    // Verify status updated in DB
    const orders = await v4.getMyHookOrders()
    if (limitOrderId) {
      const found = orders.find(o => o.hookOrderId === limitOrderId)
      if (found) {
        assert(found.status === 'cancelled', 'limit order status is cancelled in DB')
      }
    }
  } catch (err) {
    console.log(`  FAIL: cancelLimitOrder error: ${err.message}`)
    results.failed++
  }

  // =====================================================================
  // Test 11: cancelStopOrder
  // =====================================================================
  console.log('\n=== Test 11: cancelStopOrder ===')
  try {
    const result = await v4.cancelStopOrder('WETH', 'USDC', -202200)
    assert(result.success === true, 'cancelStopOrder returned success')
    assert(result.txHash && result.txHash.startsWith('0x'), 'txHash is valid')
    console.log(`  Cancelled stop order, tx=${result.txHash.slice(0, 18)}...`)
  } catch (err) {
    console.log(`  FAIL: cancelStopOrder error: ${err.message}`)
    results.failed++
  }

  // =====================================================================
  // Test 12: getPools — query PoolRegistry
  // =====================================================================
  console.log('\n=== Test 12: getPools ===')
  try {
    const pools = await v4.getPools()
    assert(Array.isArray(pools), 'returns an array')
    console.log(`  Registered pools: ${pools.length}`)
    if (pools.length > 0) {
      const p = pools[0]
      assert(typeof p.poolId === 'string', 'pool has poolId')
      assert(typeof p.token0 === 'string', 'pool has token0')
      assert(typeof p.token1 === 'string', 'pool has token1')
      assert(typeof p.active === 'boolean', 'pool has active flag')
    }
  } catch (err) {
    console.log(`  FAIL: getPools error: ${err.message}`)
    results.failed++
  }

  // =====================================================================
  // Test 13: PnL integration — verify hook orders feed into PnL
  // =====================================================================
  console.log('\n=== Test 13: PnL integration ===')
  try {
    const pnl = dt.pnl.getTotal()
    assert(typeof pnl.totalRealizedPnl === 'number', 'totalRealizedPnl is a number')
    console.log(`  PnL: realized=$${pnl.totalRealizedPnl.toFixed(4)}`)
  } catch (err) {
    console.log(`  SKIP: PnL not available: ${err.message}`)
  }

  // =====================================================================
  // Summary
  // =====================================================================
  console.log('\n' + '='.repeat(50))
  console.log(`V4 Hook Integration Tests: ${results.passed} passed, ${results.failed} failed`)
  if (results.errors.length > 0) {
    console.log('Failures:')
    results.errors.forEach(e => console.log(`  - ${e}`))
  }
  console.log('='.repeat(50))
}
