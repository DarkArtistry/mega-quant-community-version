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
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {console} from "forge-std/console.sol";

import {MegaQuantHook} from "../src/MegaQuantHook.sol";
import {MegaQuantRouter} from "../src/MegaQuantRouter.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract MegaQuantHookIntegrationTest is Test, Deployers, ERC1155Holder {
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

        modifyLiquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: -60,
                tickUpper: 60,
                liquidityDelta: 100 ether,
                salt: bytes32(0)
            }),
            ZERO_BYTES
        );

        modifyLiquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: -120,
                tickUpper: 120,
                liquidityDelta: 100 ether,
                salt: bytes32(0)
            }),
            ZERO_BYTES
        );

        modifyLiquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: 100 ether,
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

    // 1. Volatility fee works alongside limit orders
    function test_volatilityFeeWithLimitOrders() public {
        PoolId poolId = key.toId();

        // Place a limit order
        hook.placeOrder(key, 60, true, 0.5 ether, 0);

        // Do a swap (this should update volatility AND check for limit orders)
        _doSwap(true, -0.001 ether);

        // Verify volatility state was updated
        (,,, uint256 count) = hook.volatilityStates(poolId);
        assertGt(count, 0, "Observation count should be updated");

        // Verify the fee is correct
        uint24 fee = hook.getPoolFee(poolId);
        assertGe(fee, hook.MIN_FEE());
        assertLe(fee, hook.MAX_FEE());

        // The limit order should still be pending (tick didn't cross 60 with a small swap)
        uint256 pending = hook.pendingOrders(poolId, 60, true);
        assertEq(pending, 0.5 ether, "Limit order should still be pending");
    }

    // 2. High volatility swap triggers limit order
    function test_highVolSwapTriggersLimitOrder() public {
        PoolId poolId = key.toId();

        // Place a zeroForOne limit order at tick 0 (current tick)
        int24 tickLower = hook.placeOrder(key, 0, true, 0.01 ether, 0);

        // Do a large swap in the opposite direction (oneForZero) to move tick up
        _doSwap(false, -1 ether);

        // Check that the limit order was executed
        uint256 pending = hook.pendingOrders(poolId, tickLower, true);
        assertEq(pending, 0, "Limit order should have been executed");

        // Check that volatility increased
        (,,uint256 variance,) = hook.volatilityStates(poolId);
        assertGt(variance, 0, "Variance should increase from large swap");

        // Verify claimable output
        uint256 orderId = hook.getOrderId(key, tickLower, true);
        uint256 claimable = hook.claimableOutputTokens(orderId);
        assertGt(claimable, 0, "Should have claimable output");
    }

    // 3. Hook data passthrough
    function test_hookDataPassthrough() public {
        // The hook receives hookData but doesn't use it currently - verify it doesn't break
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest
            .TestSettings({takeClaims: false, settleUsingBurn: false});

        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -0.001 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });

        // Pass some arbitrary hook data
        bytes memory hookData = abi.encode(address(this), uint64(42), uint8(1), bytes("extra"));

        swapRouter.swap(key, params, testSettings, hookData);

        // If we get here without reverting, the hookData passthrough works
        PoolId poolId = key.toId();
        (,,, uint256 count) = hook.volatilityStates(poolId);
        assertGt(count, 0, "Swap should succeed with arbitrary hookData");
    }

    // 4. End-to-end flow
    function test_endToEndFlow() public {
        PoolId poolId = key.toId();

        // Step 1: Initial state - fee should be base
        uint24 initialFee = hook.getPoolFee(poolId);
        assertEq(initialFee, hook.BASE_FEE(), "Initial fee should be BASE_FEE");

        // Step 2: Do some swaps to build up volatility
        _doSwap(true, -1 ether);
        _doSwap(false, -1 ether);

        uint24 feeAfterVol = hook.getPoolFee(poolId);
        // After swaps, fee should be affected by volatility
        assertGe(feeAfterVol, hook.MIN_FEE());

        // Step 3: Place a limit order
        int24 tickLower = hook.placeOrder(key, 60, true, 0.5 ether, 0);
        uint256 orderId = hook.getOrderId(key, tickLower, true);
        uint256 claimTokens = hook.balanceOf(address(this), orderId);
        assertEq(claimTokens, 0.5 ether, "Should have claim tokens");

        // Step 4: Swap to trigger the limit order
        _doSwap(false, -2 ether);

        // Step 5: Verify the order was executed
        uint256 pending = hook.pendingOrders(poolId, tickLower, true);
        assertEq(pending, 0, "Order should be executed");

        // Step 6: Redeem the output
        uint256 claimable = hook.claimableOutputTokens(orderId);
        assertGt(claimable, 0, "Should have output to claim");

        uint256 token1Before = token1.balanceOfSelf();
        hook.redeem(key, tickLower, true, 0.5 ether);
        uint256 token1After = token1.balanceOfSelf();
        assertGt(token1After, token1Before, "Should receive tokens after redeem");

        // Step 7: Verify volatility state has many observations
        (,,, uint256 count) = hook.volatilityStates(poolId);
        assertGt(count, 2, "Should have multiple observations");
    }
}
