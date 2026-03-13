// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";

import {MegaQuantHook} from "../src/MegaQuantHook.sol";
import {MegaQuantRouter} from "../src/MegaQuantRouter.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract BothSidesExecutionTest is Test, Deployers, ERC1155Holder {
    using StateLibrary for IPoolManager;

    MegaQuantHook hook;
    MegaQuantRouter router;
    Currency token0;
    Currency token1;

    function setUp() public {
        deployFreshManagerAndRouters();
        (token0, token1) = deployMintAndApprove2Currencies();

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG |
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG
        );
        address hookAddress = address(flags);

        deployCodeTo(
            "MegaQuantHook.sol",
            abi.encode(manager, ""),
            hookAddress
        );
        hook = MegaQuantHook(hookAddress);
        router = new MegaQuantRouter(manager);

        MockERC20(Currency.unwrap(token0)).approve(address(hook), type(uint256).max);
        MockERC20(Currency.unwrap(token1)).approve(address(hook), type(uint256).max);
        MockERC20(Currency.unwrap(token0)).approve(address(router), type(uint256).max);
        MockERC20(Currency.unwrap(token1)).approve(address(router), type(uint256).max);

        (key,) = initPool(token0, token1, hook, LPFeeLibrary.DYNAMIC_FEE_FLAG, SQRT_PRICE_1_1);

        // Wide liquidity for order execution across many ticks
        modifyLiquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: 1000 ether,
                salt: bytes32(0)
            }),
            ZERO_BYTES
        );
    }

    function _doSwap(bool zeroForOne, int256 amountSpecified) internal {
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest
            .TestSettings({takeClaims: false, settleUsingBurn: false});

        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            }),
            testSettings,
            ZERO_BYTES
        );
    }

    // ========== 1. Limit Orders Both Sides - Swap ZeroForOne ==========

    function test_limitOrdersBothSides_swapZeroForOne() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        // zeroForOne limit at tick 60: executes when tick rises past 60 (oneForZero swap)
        int24 limitTickUp = hook.placeOrder(key, 60, true, amount, 0);
        // oneForZero limit at tick -60: executes when tick drops past -60 (zeroForOne swap)
        int24 limitTickDown = hook.placeOrder(key, -60, false, amount, 0);

        // Swap zeroForOne (tick drops)
        _doSwap(true, -5 ether);

        // oneForZero limit at -60 should have executed
        assertEq(hook.pendingOrders(poolId, limitTickDown, false), 0, "oneForZero limit at -60 should execute");
        uint256 orderIdDown = hook.getOrderId(key, limitTickDown, false);
        assertGt(hook.claimableOutputTokens(orderIdDown), 0, "Should have claimable output");

        // zeroForOne limit at 60 should remain pending
        assertEq(hook.pendingOrders(poolId, limitTickUp, true), amount, "zeroForOne limit at 60 should remain");
    }

    // ========== 2. Limit Orders Both Sides - Swap OneForZero ==========

    function test_limitOrdersBothSides_swapOneForZero() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        int24 limitTickUp = hook.placeOrder(key, 60, true, amount, 0);
        int24 limitTickDown = hook.placeOrder(key, -60, false, amount, 0);

        // Swap oneForZero (tick rises)
        _doSwap(false, -5 ether);

        // zeroForOne limit at 60 should have executed
        assertEq(hook.pendingOrders(poolId, limitTickUp, true), 0, "zeroForOne limit at 60 should execute");
        uint256 orderIdUp = hook.getOrderId(key, limitTickUp, true);
        assertGt(hook.claimableOutputTokens(orderIdUp), 0, "Should have claimable output");

        // oneForZero limit at -60 should remain pending
        assertEq(hook.pendingOrders(poolId, limitTickDown, false), amount, "oneForZero limit at -60 should remain");
    }

    // ========== 3. Stop Orders Both Sides - Swap ZeroForOne ==========
    // Note: In _tryExecutingStopOrders, the "tick rose" branch uses !executeZeroForOne,
    // so both stop-loss (below) and buy-stop (above) use zeroForOne=true at different ticks.

    function test_stopOrdersBothSides_swapZeroForOne() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        // Stop-loss at tick -60: executes when tick drops below -60
        int24 stopTickDown = hook.placeStopOrder(key, -60, true, amount, 0);
        // Buy-stop at tick 60: executes when tick rises above 60
        int24 stopTickUp = hook.placeStopOrder(key, 60, true, amount, 0);

        // Swap zeroForOne (tick drops)
        _doSwap(true, -5 ether);

        // Stop at -60 should have executed
        assertEq(hook.pendingStopOrders(poolId, stopTickDown, true), 0, "Stop at -60 should execute");
        uint256 stopIdDown = hook.getStopOrderId(key, stopTickDown, true);
        assertGt(hook.stopClaimableOutputTokens(stopIdDown), 0, "Should have claimable output");

        // Stop at 60 should remain pending
        assertEq(hook.pendingStopOrders(poolId, stopTickUp, true), amount, "Stop at 60 should remain");
    }

    // ========== 4. Stop Orders Both Sides - Swap OneForZero ==========

    function test_stopOrdersBothSides_swapOneForZero() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        int24 stopTickDown = hook.placeStopOrder(key, -60, true, amount, 0);
        int24 stopTickUp = hook.placeStopOrder(key, 60, true, amount, 0);

        // Swap oneForZero (tick rises)
        _doSwap(false, -5 ether);

        // Stop at 60 should have executed via !executeZeroForOne path
        assertEq(hook.pendingStopOrders(poolId, stopTickUp, true), 0, "Stop at 60 should execute");
        uint256 stopIdUp = hook.getStopOrderId(key, stopTickUp, true);
        assertGt(hook.stopClaimableOutputTokens(stopIdUp), 0, "Should have claimable output");

        // Stop at -60 should remain pending
        assertEq(hook.pendingStopOrders(poolId, stopTickDown, true), amount, "Stop at -60 should remain");
    }

    // ========== 5. Mixed Orders Both Sides - Swap ZeroForOne ==========

    function test_mixedOrdersBothSides_swapZeroForOne() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        // Limit orders on both sides
        int24 limitTickUp = hook.placeOrder(key, 60, true, amount, 0);
        int24 limitTickDown = hook.placeOrder(key, -60, false, amount, 0);

        // Stop orders on both sides
        int24 stopTickDown = hook.placeStopOrder(key, -60, true, amount, 0);
        int24 stopTickUp = hook.placeStopOrder(key, 60, true, amount, 0);

        // Swap zeroForOne (tick drops)
        _doSwap(true, -5 ether);

        // Should execute: limit[false]@-60 and stop[true]@-60
        assertEq(hook.pendingOrders(poolId, limitTickDown, false), 0, "Limit at -60 should execute");
        assertEq(hook.pendingStopOrders(poolId, stopTickDown, true), 0, "Stop at -60 should execute");

        // Should remain pending: limit[true]@60 and stop[true]@60
        assertEq(hook.pendingOrders(poolId, limitTickUp, true), amount, "Limit at 60 should remain");
        assertEq(hook.pendingStopOrders(poolId, stopTickUp, true), amount, "Stop at 60 should remain");

        // Verify claimable on executed orders
        uint256 limitId = hook.getOrderId(key, limitTickDown, false);
        assertGt(hook.claimableOutputTokens(limitId), 0, "Limit should have claimable output");
        uint256 stopId = hook.getStopOrderId(key, stopTickDown, true);
        assertGt(hook.stopClaimableOutputTokens(stopId), 0, "Stop should have claimable output");
    }

    // ========== 6. Mixed Orders Both Sides - Swap OneForZero ==========

    function test_mixedOrdersBothSides_swapOneForZero() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        int24 limitTickUp = hook.placeOrder(key, 60, true, amount, 0);
        int24 limitTickDown = hook.placeOrder(key, -60, false, amount, 0);
        int24 stopTickDown = hook.placeStopOrder(key, -60, true, amount, 0);
        int24 stopTickUp = hook.placeStopOrder(key, 60, true, amount, 0);

        // Swap oneForZero (tick rises)
        _doSwap(false, -5 ether);

        // Should execute: limit[true]@60 and stop[true]@60
        assertEq(hook.pendingOrders(poolId, limitTickUp, true), 0, "Limit at 60 should execute");
        assertEq(hook.pendingStopOrders(poolId, stopTickUp, true), 0, "Stop at 60 should execute");

        // Should remain pending: limit[false]@-60 and stop[true]@-60
        assertEq(hook.pendingOrders(poolId, limitTickDown, false), amount, "Limit at -60 should remain");
        assertEq(hook.pendingStopOrders(poolId, stopTickDown, true), amount, "Stop at -60 should remain");

        // Verify claimable on executed orders
        uint256 limitId = hook.getOrderId(key, limitTickUp, true);
        assertGt(hook.claimableOutputTokens(limitId), 0, "Limit should have claimable output");
        uint256 stopId = hook.getStopOrderId(key, stopTickUp, true);
        assertGt(hook.stopClaimableOutputTokens(stopId), 0, "Stop should have claimable output");
    }

    // ========== 7. Both Directions Sequential ==========

    function test_bothDirectionsSequential() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        // Place orders on both sides
        int24 limitTickUp = hook.placeOrder(key, 60, true, amount, 0);
        int24 limitTickDown = hook.placeOrder(key, -60, false, amount, 0);
        int24 stopTickDown = hook.placeStopOrder(key, -60, true, amount, 0);
        int24 stopTickUp = hook.placeStopOrder(key, 60, true, amount, 0);

        // First swap: zeroForOne (tick drops)
        _doSwap(true, -5 ether);

        // limit[false]@-60 and stop[true]@-60 should execute
        assertEq(hook.pendingOrders(poolId, limitTickDown, false), 0, "Limit at -60 should fill");
        assertEq(hook.pendingStopOrders(poolId, stopTickDown, true), 0, "Stop at -60 should fill");

        // Remaining orders still pending
        assertEq(hook.pendingOrders(poolId, limitTickUp, true), amount, "Limit at 60 still pending");
        assertEq(hook.pendingStopOrders(poolId, stopTickUp, true), amount, "Stop at 60 still pending");

        // Second swap: oneForZero (tick rises back past 60)
        _doSwap(false, -10 ether);

        // limit[true]@60 and stop[true]@60 should now execute
        assertEq(hook.pendingOrders(poolId, limitTickUp, true), 0, "Limit at 60 should fill");
        assertEq(hook.pendingStopOrders(poolId, stopTickUp, true), 0, "Stop at 60 should fill");

        // Redeem all filled orders and verify output tokens received
        uint256 token0Before = token0.balanceOfSelf();
        uint256 token1Before = token1.balanceOfSelf();

        // limit[false]@-60: sold token1, receive token0
        hook.redeem(key, limitTickDown, false, amount);
        // limit[true]@60: sold token0, receive token1
        hook.redeem(key, limitTickUp, true, amount);
        // stop[true]@-60: sold token0, receive token1
        hook.redeemStopOrder(key, stopTickDown, true, amount);
        // stop[true]@60: sold token0, receive token1
        hook.redeemStopOrder(key, stopTickUp, true, amount);

        assertGt(token0.balanceOfSelf(), token0Before, "Should receive token0 from limit[false] redemption");
        assertGt(token1.balanceOfSelf(), token1Before, "Should receive token1 from other redemptions");
    }

    // ========== 8. Both Sides via Router ==========

    function test_bothSidesViaRouter() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        // Place limit orders via router
        int24 limitTickUp = router.placeLimitOrder(key, 60, amount, true, 0, ZERO_BYTES);
        int24 limitTickDown = router.placeLimitOrder(key, -60, amount, false, 0, ZERO_BYTES);

        // Verify ERC1155 claim tokens are on the caller, not the router
        uint256 limitIdUp = hook.getOrderId(key, limitTickUp, true);
        uint256 limitIdDown = hook.getOrderId(key, limitTickDown, false);
        assertEq(hook.balanceOf(address(this), limitIdUp), amount, "Caller should hold claim tokens");
        assertEq(hook.balanceOf(address(router), limitIdUp), 0, "Router should not hold claim tokens");
        assertEq(hook.balanceOf(address(this), limitIdDown), amount, "Caller should hold claim tokens");
        assertEq(hook.balanceOf(address(router), limitIdDown), 0, "Router should not hold claim tokens");

        // Swap zeroForOne -> limit[false]@-60 executes
        _doSwap(true, -5 ether);
        assertEq(hook.pendingOrders(poolId, limitTickDown, false), 0, "Limit at -60 should execute");
        assertEq(hook.pendingOrders(poolId, limitTickUp, true), amount, "Limit at 60 should remain");

        // Swap oneForZero -> limit[true]@60 executes
        _doSwap(false, -10 ether);
        assertEq(hook.pendingOrders(poolId, limitTickUp, true), 0, "Limit at 60 should execute");

        // Redeem both and verify output
        uint256 token0Before = token0.balanceOfSelf();
        hook.redeem(key, limitTickDown, false, amount);
        assertGt(token0.balanceOfSelf(), token0Before, "Should receive token0 from limit[false]");

        uint256 token1Before = token1.balanceOfSelf();
        hook.redeem(key, limitTickUp, true, amount);
        assertGt(token1.balanceOfSelf(), token1Before, "Should receive token1 from limit[true]");
    }

    // ========== 9. Bracket Orders Both Directions ==========

    function test_bracketOrdersBothDirections() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        // Place bracket: limit@60 (take-profit) + stop@-60 (stop-loss), zeroForOne=true
        (int24 limitTick, int24 stopTick) = router.placeBracketOrder(
            key, 60, -60, true, amount, 0
        );

        uint256 limitId = hook.getOrderId(key, limitTick, true);
        uint256 stopId = hook.getStopOrderId(key, stopTick, true);

        // Verify bracket partners are linked
        assertEq(hook.bracketPartner(limitId), stopId, "Should be linked");
        assertEq(hook.bracketPartner(stopId), limitId, "Should be linked");

        // Swap oneForZero (tick rises) -> limit at 60 fills
        _doSwap(false, -5 ether);

        // Limit filled, bracket link cleared
        assertEq(hook.pendingOrders(poolId, limitTick, true), 0, "Limit should fill");
        assertEq(hook.bracketPartner(limitId), 0, "Filled side link should clear");
        assertEq(hook.bracketPartner(stopId), 0, "Partner link should clear");

        // Stop still has pending tokens (unlinked but not auto-cancelled)
        assertEq(hook.pendingStopOrders(poolId, stopTick, true), amount, "Stop tokens still pending");

        // Verify limit has claimable output
        assertGt(hook.claimableOutputTokens(limitId), 0, "Limit should have claimable output");

        // Now swap zeroForOne (tick drops) -> orphaned stop at -60 still executes independently
        _doSwap(true, -10 ether);

        assertEq(hook.pendingStopOrders(poolId, stopTick, true), 0, "Stop should execute independently");
        assertGt(hook.stopClaimableOutputTokens(stopId), 0, "Stop should have claimable output");
    }

    // ========== 10. Multiple Orders at Multiple Ticks ==========

    function test_multipleOrdersBothSidesMultipleTicks() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.005 ether;

        // zeroForOne=true limits at 60, 120 (execute when tick rises)
        hook.placeOrder(key, 60, true, amount, 0);
        hook.placeOrder(key, 120, true, amount, 0);

        // zeroForOne=false limits at -60, -120 (execute when tick drops)
        hook.placeOrder(key, -60, false, amount, 0);
        hook.placeOrder(key, -120, false, amount, 0);

        // Large swap oneForZero to cross multiple ticks upward
        _doSwap(false, -20 ether);

        // Both upward limits should have executed
        assertEq(hook.pendingOrders(poolId, 60, true), 0, "Limit at 60 should execute");
        assertEq(hook.pendingOrders(poolId, 120, true), 0, "Limit at 120 should execute");

        // Downward limits should remain pending (tick went up, not down)
        assertEq(hook.pendingOrders(poolId, -60, false), amount, "Limit at -60 should remain");
        assertEq(hook.pendingOrders(poolId, -120, false), amount, "Limit at -120 should remain");

        // Verify claimable on at least one executed order
        uint256 orderId60 = hook.getOrderId(key, 60, true);
        assertGt(hook.claimableOutputTokens(orderId60), 0, "Should have claimable at tick 60");
    }
}
