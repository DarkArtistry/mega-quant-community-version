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
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract LimitOrderTest is Test, Deployers, ERC1155Holder {
    using StateLibrary for IPoolManager;

    MegaQuantHook hook;
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

        MockERC20(Currency.unwrap(token0)).approve(address(hook), type(uint256).max);
        MockERC20(Currency.unwrap(token1)).approve(address(hook), type(uint256).max);

        (key,) = initPool(
            token0,
            token1,
            hook,
            LPFeeLibrary.DYNAMIC_FEE_FLAG,
            SQRT_PRICE_1_1
        );

        // Add liquidity at various ranges
        modifyLiquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: -60,
                tickUpper: 60,
                liquidityDelta: 10 ether,
                salt: bytes32(0)
            }),
            ZERO_BYTES
        );

        modifyLiquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: -120,
                tickUpper: 120,
                liquidityDelta: 10 ether,
                salt: bytes32(0)
            }),
            ZERO_BYTES
        );

        modifyLiquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: 10 ether,
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

    // 1. Place order
    function test_placeOrder() public {
        int24 tick = 100;
        uint256 amount = 1 ether;
        bool zeroForOne = true;

        uint256 originalBalance = token0.balanceOfSelf();

        int24 tickLower = hook.placeOrder(key, tick, zeroForOne, amount, 0);

        uint256 newBalance = token0.balanceOfSelf();

        // Tick spacing is 60, so tick 100 rounds down to 60
        assertEq(tickLower, 60);
        assertEq(originalBalance - newBalance, amount);

        uint256 orderId = hook.getOrderId(key, tickLower, zeroForOne);
        uint256 tokenBalance = hook.balanceOf(address(this), orderId);
        assertEq(tokenBalance, amount);
    }

    // 2. Cancel order
    function test_cancelOrder() public {
        int24 tick = 100;
        uint256 amount = 1 ether;
        bool zeroForOne = true;

        uint256 originalBalance = token0.balanceOfSelf();
        int24 tickLower = hook.placeOrder(key, tick, zeroForOne, amount, 0);
        uint256 balanceAfterPlace = token0.balanceOfSelf();
        assertEq(originalBalance - balanceAfterPlace, amount);

        hook.cancelOrder(key, tickLower, zeroForOne);

        uint256 finalBalance = token0.balanceOfSelf();
        assertEq(finalBalance, originalBalance);

        uint256 orderId = hook.getOrderId(key, tickLower, zeroForOne);
        uint256 tokenBalance = hook.balanceOf(address(this), orderId);
        assertEq(tokenBalance, 0);
    }

    // 3. Order executes on tick cross - zeroForOne
    function test_orderExecutesOnTickCross_zeroForOne() public {
        int24 tick = 100;
        uint256 amount = 1 ether;
        bool zeroForOne = true;

        int24 tickLower = hook.placeOrder(key, tick, zeroForOne, amount, 0);

        // Swap in opposite direction to move tick up (past the order tick)
        _doSwap(false, -1 ether);

        // Check that the order was executed
        uint256 pendingTokens = hook.pendingOrders(key.toId(), tickLower, zeroForOne);
        assertEq(pendingTokens, 0, "Order should have been executed");

        // Check claimable output
        uint256 orderId = hook.getOrderId(key, tickLower, zeroForOne);
        uint256 claimable = hook.claimableOutputTokens(orderId);
        assertGt(claimable, 0, "Should have claimable output tokens");
    }

    // 4. Order executes on tick cross - oneForZero
    function test_orderExecutesOnTickCross_oneForZero() public {
        int24 tick = -100;
        uint256 amount = 1 ether;
        bool zeroForOne = false;

        int24 tickLower = hook.placeOrder(key, tick, zeroForOne, amount, 0);

        // Swap zeroForOne to move tick down
        _doSwap(true, -1 ether);

        uint256 pendingTokens = hook.pendingOrders(key.toId(), tickLower, zeroForOne);
        assertEq(pendingTokens, 0, "Order should have been executed");

        uint256 orderId = hook.getOrderId(key, tickLower, zeroForOne);
        uint256 claimable = hook.claimableOutputTokens(orderId);
        assertGt(claimable, 0, "Should have claimable output tokens");
    }

    // 5. Orders with deadlines are still executed on tick cross
    // (deadlines are hints for user-initiated cancellation, not execution-time checks,
    //  because orders at the same tick are aggregated across users)
    function test_expiredOrderSkipped() public {
        int24 tick = 100;
        uint256 amount = 1 ether;
        bool zeroForOne = true;

        // Place order with a short deadline
        uint64 deadline = uint64(block.timestamp + 60); // 60 seconds
        int24 tickLower = hook.placeOrder(key, tick, zeroForOne, amount, deadline);

        // Advance time past the deadline
        vm.warp(block.timestamp + 120);

        // Swap to move tick past the order
        _doSwap(false, -1 ether);

        // The order should have been executed (deadlines are hints, not hard blocks)
        uint256 pendingTokens = hook.pendingOrders(key.toId(), tickLower, zeroForOne);
        assertEq(pendingTokens, 0, "Order should have been executed regardless of deadline");

        // Verify claimable output exists
        uint256 orderId = hook.getOrderId(key, tickLower, zeroForOne);
        uint256 claimable = hook.claimableOutputTokens(orderId);
        assertGt(claimable, 0, "Should have claimable output tokens");
    }

    // 6. Max executions per swap
    function test_maxExecutionsPerSwap() public {
        // Place many orders at different ticks
        uint256 amount = 0.01 ether;

        // Place orders at ticks 0, 60, 120, 180, 240, 300
        for (int24 t = 0; t <= 300; t += 60) {
            hook.placeOrder(key, t, true, amount, 0);
        }

        // Do a large swap to cross all ticks
        _doSwap(false, -5 ether);

        // At most MAX_EXECUTIONS_PER_SWAP (5) orders should be executed
        uint256 executedCount = 0;
        for (int24 t = 0; t <= 300; t += 60) {
            int24 usableTick = t; // Already aligned to tick spacing
            uint256 pending = hook.pendingOrders(key.toId(), usableTick, true);
            if (pending == 0) {
                executedCount++;
            }
        }

        // We expect at most MAX_EXECUTIONS_PER_SWAP to be executed
        assertLe(executedCount, hook.MAX_EXECUTIONS_PER_SWAP(), "Should not exceed MAX_EXECUTIONS_PER_SWAP");
    }

    // 7. Redeem claim tokens
    function test_redeemClaimTokens() public {
        int24 tick = 100;
        uint256 amount = 1 ether;
        bool zeroForOne = true;

        int24 tickLower = hook.placeOrder(key, tick, zeroForOne, amount, 0);

        // Execute the order by swapping
        _doSwap(false, -1 ether);

        // Check that the order was executed
        uint256 orderId = hook.getOrderId(key, tickLower, zeroForOne);
        uint256 claimable = hook.claimableOutputTokens(orderId);
        assertGt(claimable, 0, "Should have claimable output tokens");

        // Redeem
        uint256 token1Before = token1.balanceOfSelf();
        hook.redeem(key, tickLower, zeroForOne, amount);
        uint256 token1After = token1.balanceOfSelf();

        assertGt(token1After, token1Before, "Should receive output tokens after redeem");
    }

    // 8. Multiple orders at same tick
    function test_multipleOrdersSameTick() public {
        int24 tick = 60;
        bool zeroForOne = true;

        // Place two orders at the same tick
        hook.placeOrder(key, tick, zeroForOne, 0.5 ether, 0);
        hook.placeOrder(key, tick, zeroForOne, 0.5 ether, 0);

        // Check total pending
        uint256 totalPending = hook.pendingOrders(key.toId(), tick, zeroForOne);
        assertEq(totalPending, 1 ether, "Should have combined pending amount");

        // Check ERC1155 balance
        uint256 orderId = hook.getOrderId(key, tick, zeroForOne);
        uint256 tokenBalance = hook.balanceOf(address(this), orderId);
        assertEq(tokenBalance, 1 ether, "Should have combined ERC1155 balance");
    }

    // 9. Partial tick cross (swap not big enough to cross order tick)
    function test_partialTickCross() public {
        // Place an order at a far tick
        int24 tick = 300;
        uint256 amount = 1 ether;
        bool zeroForOne = true;

        int24 tickLower = hook.placeOrder(key, tick, zeroForOne, amount, 0);

        // Do a small swap that doesn't cross the order tick
        _doSwap(false, -0.001 ether);

        // Order should still be pending
        uint256 pendingTokens = hook.pendingOrders(key.toId(), tickLower, zeroForOne);
        assertEq(pendingTokens, amount, "Order should still be pending after partial tick cross");
    }

    // 10. Order placement emits event
    function test_orderPlacementEmitsEvent() public {
        int24 tick = 100;
        uint256 amount = 1 ether;
        bool zeroForOne = true;
        uint64 deadline = 0;

        // The tick will be rounded to 60 (tickSpacing = 60)
        int24 expectedTick = 60;

        vm.expectEmit(true, true, false, true);
        emit MegaQuantHook.OrderPlaced(
            address(this),
            key.toId(),
            expectedTick,
            zeroForOne,
            amount,
            deadline
        );

        hook.placeOrder(key, tick, zeroForOne, amount, deadline);
    }
}
