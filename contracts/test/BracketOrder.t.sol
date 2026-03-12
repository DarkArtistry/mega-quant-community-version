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
import {console} from "forge-std/console.sol";

import {MegaQuantHook} from "../src/MegaQuantHook.sol";
import {MegaQuantRouter} from "../src/MegaQuantRouter.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract BracketOrderTest is Test, Deployers, ERC1155Holder {
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

    // ========== Bracket Partner Linking ==========

    function test_setBracketPartner() public {
        uint256 limitOrderId = 123;
        uint256 stopOrderId = 456;

        hook.setBracketPartner(limitOrderId, stopOrderId);

        assertEq(hook.bracketPartner(limitOrderId), stopOrderId, "Limit -> stop link");
        assertEq(hook.bracketPartner(stopOrderId), limitOrderId, "Stop -> limit link");
    }

    // ========== Place Bracket via Router ==========

    function test_placeBracketOrderViaRouter() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        uint256 balanceBefore = token0.balanceOfSelf();

        (int24 actualLimitTick, int24 actualStopTick) = router.placeBracketOrder(
            key,
            60,     // limit (TP) tick — above current
            -60,    // stop (SL) tick — below current
            true,   // zeroForOne
            amount,
            uint64(block.timestamp + 1 hours)
        );

        uint256 balanceAfter = token0.balanceOfSelf();

        // Should spend 2x amount (one per side)
        assertEq(balanceBefore - balanceAfter, amount * 2, "Should spend 2x amount for bracket");

        // Both sides should have pending orders
        uint256 limitPending = hook.pendingOrders(poolId, actualLimitTick, true);
        assertEq(limitPending, amount, "Limit side should be pending");

        uint256 stopPending = hook.pendingStopOrders(poolId, actualStopTick, true);
        assertEq(stopPending, amount, "Stop side should be pending");

        // Bracket partners should be linked
        uint256 limitId = hook.getOrderId(key, actualLimitTick, true);
        uint256 stopId = hook.getStopOrderId(key, actualStopTick, true);
        assertEq(hook.bracketPartner(limitId), stopId, "Limit should link to stop");
        assertEq(hook.bracketPartner(stopId), limitId, "Stop should link to limit");

        // Claim tokens should be transferred to this contract (the caller)
        assertGt(hook.balanceOf(address(this), limitId), 0, "Should have limit claim tokens");
        assertGt(hook.balanceOf(address(this), stopId), 0, "Should have stop claim tokens");
    }

    // ========== Bracket Cancellation on Fill ==========

    function test_bracketPartnerCancelledOnLimitFill() public {
        uint256 amount = 0.01 ether;

        (int24 limitTick, int24 stopTick) = router.placeBracketOrder(
            key, 60, -60, true, amount, 0
        );

        uint256 limitId = hook.getOrderId(key, limitTick, true);
        uint256 stopId = hook.getStopOrderId(key, stopTick, true);

        // Verify both linked
        assertEq(hook.bracketPartner(limitId), stopId);

        // Swap to trigger the limit order (push tick up past 60)
        _doSwap(false, -5 ether);

        // Limit should have executed
        PoolId poolId = key.toId();
        uint256 limitPending = hook.pendingOrders(poolId, limitTick, true);
        assertEq(limitPending, 0, "Limit order should have filled");

        // Bracket partner link should be cleared
        assertEq(hook.bracketPartner(limitId), 0, "Filled side link should be cleared");
        assertEq(hook.bracketPartner(stopId), 0, "Partner link should be cleared");
    }

    function test_bracketPartnerCancelledOnStopFill() public {
        uint256 amount = 0.01 ether;

        (int24 limitTick, int24 stopTick) = router.placeBracketOrder(
            key, 60, -60, true, amount, 0
        );

        uint256 limitId = hook.getOrderId(key, limitTick, true);
        uint256 stopId = hook.getStopOrderId(key, stopTick, true);

        // Swap to trigger the stop order (push tick down past -60)
        _doSwap(true, -5 ether);

        // Stop should have executed
        PoolId poolId = key.toId();
        uint256 stopPending = hook.pendingStopOrders(poolId, stopTick, true);
        assertEq(stopPending, 0, "Stop order should have filled");

        // Bracket partner link should be cleared
        assertEq(hook.bracketPartner(limitId), 0, "Partner link should be cleared");
        assertEq(hook.bracketPartner(stopId), 0, "Filled side link should be cleared");
    }

    // ========== Place Stop Order via Router ==========

    function test_placeStopOrderViaRouter() public {
        PoolId poolId = key.toId();
        uint256 amount = 0.01 ether;

        uint256 balanceBefore = token0.balanceOfSelf();

        int24 actualTick = router.placeStopOrder(
            key, -60, amount, true, 0, ZERO_BYTES
        );

        uint256 balanceAfter = token0.balanceOfSelf();
        assertEq(balanceBefore - balanceAfter, amount, "Should spend exact amount");

        uint256 pending = hook.pendingStopOrders(poolId, actualTick, true);
        assertEq(pending, amount, "Should have pending stop via router");

        // Claim tokens should be on the caller, not the router
        uint256 stopId = hook.getStopOrderId(key, actualTick, true);
        assertEq(hook.balanceOf(address(this), stopId), amount, "Claim tokens should be on caller");
        assertEq(hook.balanceOf(address(router), stopId), 0, "Router should not hold claim tokens");
    }

    // ========== getVolatilityState view ==========

    function test_getVolatilityState() public {
        PoolId poolId = key.toId();

        // Before any swaps
        (int24 lastTick, uint256 lastTimestamp, uint256 ewmaVariance, uint256 observationCount) =
            hook.getVolatilityState(poolId);

        assertEq(observationCount, 0, "No observations yet");

        // Do a swap
        _doSwap(true, -1 ether);

        (lastTick, lastTimestamp, ewmaVariance, observationCount) =
            hook.getVolatilityState(poolId);

        assertGt(observationCount, 0, "Should have observations after swap");
        assertEq(lastTimestamp, block.timestamp, "Timestamp should be current block");
    }
}
