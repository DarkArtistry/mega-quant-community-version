// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
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
import {console} from "forge-std/console.sol";

import {MegaQuantHook} from "../src/MegaQuantHook.sol";
import {MegaQuantRouter} from "../src/MegaQuantRouter.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract StopOrderTest is Test, Deployers, ERC1155Holder {
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

        (key,) = initPool(
            token0,
            token1,
            hook,
            LPFeeLibrary.DYNAMIC_FEE_FLAG,
            SQRT_PRICE_1_1
        );

        // Wide liquidity range for testing
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

        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: zeroForOne
                ? TickMath.MIN_SQRT_PRICE + 1
                : TickMath.MAX_SQRT_PRICE - 1
        });

        swapRouter.swap(key, params, testSettings, ZERO_BYTES);
    }

    // ========== Stop Order Placement ==========

    function test_placeStopOrder() public {
        PoolId poolId = key.toId();

        uint256 balanceBefore = token0.balanceOfSelf();
        int24 tick = hook.placeStopOrder(key, -60, true, 0.5 ether, 0);

        // Token should be transferred
        assertEq(balanceBefore - token0.balanceOfSelf(), 0.5 ether, "Should transfer tokens");

        // Pending stop orders should be recorded
        uint256 pending = hook.pendingStopOrders(poolId, tick, true);
        assertEq(pending, 0.5 ether, "Should have pending stop order");

        // ERC1155 claim tokens should be minted
        uint256 stopOrderId = hook.getStopOrderId(key, tick, true);
        uint256 claimTokens = hook.balanceOf(address(this), stopOrderId);
        assertEq(claimTokens, 0.5 ether, "Should have stop order claim tokens");
    }

    function test_placeStopOrderWithDeadline() public {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        int24 tick = hook.placeStopOrder(key, -60, true, 0.5 ether, deadline);

        uint256 stopOrderId = hook.getStopOrderId(key, tick, true);
        uint64 storedDeadline = hook.stopOrderDeadlines(stopOrderId);
        assertEq(storedDeadline, deadline, "Deadline should be stored");
    }

    function test_placeStopOrderTickRounding() public {
        // Place at tick -50, should round to -60 (spacing = 60)
        int24 tick = hook.placeStopOrder(key, -50, true, 0.5 ether, 0);
        assertEq(tick, -60, "Should round down to tick spacing boundary");
    }

    function test_placeMultipleStopOrders() public {
        PoolId poolId = key.toId();

        hook.placeStopOrder(key, -60, true, 0.3 ether, 0);
        hook.placeStopOrder(key, -60, true, 0.2 ether, 0);

        uint256 pending = hook.pendingStopOrders(poolId, -60, true);
        assertEq(pending, 0.5 ether, "Should accumulate stop orders at same tick");
    }

    // ========== Stop Order Cancellation ==========

    function test_cancelStopOrder() public {
        PoolId poolId = key.toId();
        int24 tick = hook.placeStopOrder(key, -60, true, 0.5 ether, 0);

        uint256 balanceBefore = token0.balanceOfSelf();
        hook.cancelStopOrder(key, tick, true);
        uint256 balanceAfter = token0.balanceOfSelf();

        // Tokens returned
        assertEq(balanceAfter - balanceBefore, 0.5 ether, "Should return tokens on cancel");

        // Pending cleared
        uint256 pending = hook.pendingStopOrders(poolId, tick, true);
        assertEq(pending, 0, "Pending should be zero after cancel");

        // Claim tokens burned
        uint256 stopOrderId = hook.getStopOrderId(key, tick, true);
        assertEq(hook.balanceOf(address(this), stopOrderId), 0, "Claim tokens should be burned");
    }

    function test_cancelStopOrder_revertsIfNoPosition() public {
        vm.expectRevert(MegaQuantHook.InvalidOrder.selector);
        hook.cancelStopOrder(key, -60, true);
    }

    // ========== Stop Order Execution ==========

    function test_stopOrderExecutedOnPriceDrop() public {
        PoolId poolId = key.toId();

        // Place a stop-loss at tick -60 (sell token0 when price drops)
        int24 tick = hook.placeStopOrder(key, -60, true, 0.01 ether, 0);

        // Swap to push price down (zeroForOne = true pushes tick down)
        _doSwap(true, -5 ether);

        // Verify current tick moved below our stop tick
        (, int24 currentTick,,) = manager.getSlot0(poolId);
        assertLt(currentTick, tick, "Tick should have moved below stop tick");

        // Stop order should have executed
        uint256 pending = hook.pendingStopOrders(poolId, tick, true);
        assertEq(pending, 0, "Stop order should have executed");

        // Should have claimable output
        uint256 stopOrderId = hook.getStopOrderId(key, tick, true);
        uint256 claimable = hook.stopClaimableOutputTokens(stopOrderId);
        assertGt(claimable, 0, "Should have claimable output from stop order");
    }

    function test_stopOrderNotExecutedIfPriceDoesntReach() public {
        PoolId poolId = key.toId();

        // Place stop at tick -120 (far away)
        int24 tick = hook.placeStopOrder(key, -120, true, 0.01 ether, 0);

        // Small swap - shouldn't reach tick -120
        _doSwap(true, -0.001 ether);

        // Stop order should still be pending
        uint256 pending = hook.pendingStopOrders(poolId, tick, true);
        assertEq(pending, 0.01 ether, "Stop order should still be pending");
    }

    // ========== Stop Order Redemption ==========

    function test_redeemStopOrder() public {
        // Place and trigger a stop order
        int24 tick = hook.placeStopOrder(key, -60, true, 0.01 ether, 0);
        _doSwap(true, -5 ether);

        uint256 stopOrderId = hook.getStopOrderId(key, tick, true);
        uint256 claimable = hook.stopClaimableOutputTokens(stopOrderId);
        assertGt(claimable, 0, "Should have claimable output");

        // Redeem
        uint256 token1Before = token1.balanceOfSelf();
        hook.redeemStopOrder(key, tick, true, 0.01 ether);
        uint256 token1After = token1.balanceOfSelf();

        assertGt(token1After, token1Before, "Should receive output tokens");
    }

    function test_redeemStopOrder_revertsIfNothingToClaim() public {
        // Place stop order but don't trigger it
        int24 tick = hook.placeStopOrder(key, -60, true, 0.01 ether, 0);

        vm.expectRevert(MegaQuantHook.NothingToClaim.selector);
        hook.redeemStopOrder(key, tick, true, 0.01 ether);
    }

    // ========== Stop Order ID is distinct from Limit Order ID ==========

    function test_stopOrderIdDistinctFromLimitOrderId() public {
        int24 tick = -60;
        bool zeroForOne = true;

        uint256 limitOrderId = hook.getOrderId(key, tick, zeroForOne);
        uint256 stopOrderId = hook.getStopOrderId(key, tick, zeroForOne);

        assertTrue(limitOrderId != stopOrderId, "Stop and limit order IDs should be different");
    }
}
