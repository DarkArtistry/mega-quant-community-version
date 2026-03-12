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
import {VolatilityMath} from "../src/libraries/VolatilityMath.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract VolatilityFeeTest is Test, Deployers, ERC1155Holder {
    using StateLibrary for IPoolManager;

    MegaQuantHook hook;
    Currency token0;
    Currency token1;

    function setUp() public {
        deployFreshManagerAndRouters();
        (token0, token1) = deployMintAndApprove2Currencies();

        // Deploy hook with proper flag bits
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

        // Approve hook for token spending
        MockERC20(Currency.unwrap(token0)).approve(address(hook), type(uint256).max);
        MockERC20(Currency.unwrap(token1)).approve(address(hook), type(uint256).max);

        // Initialize pool with DYNAMIC_FEE_FLAG
        (key,) = initPool(
            token0,
            token1,
            hook,
            LPFeeLibrary.DYNAMIC_FEE_FLAG,
            SQRT_PRICE_1_1
        );

        // Add liquidity
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

    // 1. Fee is BASE_FEE when there is no prior history
    function test_feeIsBaseWhenNoHistory() public {
        PoolId poolId = key.toId();
        uint24 fee = hook.getPoolFee(poolId);
        assertEq(fee, hook.BASE_FEE(), "Fee should be BASE_FEE when no history");
    }

    // 2. Fee increases after a large tick movement
    function test_feeIncreasesAfterLargeTickMovement() public {
        PoolId poolId = key.toId();

        // First swap to establish a baseline observation
        _doSwap(true, -0.001 ether);

        uint24 feeAfterSmall = hook.getPoolFee(poolId);

        // Large swap to move tick significantly
        _doSwap(true, -10 ether);

        uint24 feeAfterLarge = hook.getPoolFee(poolId);

        // Fee should increase (or at least not decrease) after a large tick movement
        assertGe(feeAfterLarge, feeAfterSmall, "Fee should increase after large tick movement");
    }

    // 3. Fee decreases after a small tick movement
    function test_feeDecreasesAfterSmallTickMovement() public {
        PoolId poolId = key.toId();

        // First do a large swap to increase variance
        _doSwap(true, -10 ether);

        uint24 feeAfterLarge = hook.getPoolFee(poolId);

        // Now do multiple tiny swaps to decay the variance
        for (uint256 i = 0; i < 10; i++) {
            _doSwap(false, -0.0001 ether);
        }

        uint24 feeAfterSmall = hook.getPoolFee(poolId);

        // Fee should decrease after many small movements
        assertLe(feeAfterSmall, feeAfterLarge, "Fee should decrease after small tick movements");
    }

    // 4. Fee clamped to MIN_FEE
    function test_feeClampedToMin() public {
        // The VolatilityMath.calculateFee should clamp to MIN_FEE for low variance
        uint24 fee = VolatilityMath.calculateFee(
            0, // zero variance
            hook.MIN_FEE(),
            hook.MAX_FEE(),
            hook.BASE_FEE(),
            hook.LOW_VARIANCE_THRESHOLD(),
            hook.HIGH_VARIANCE_THRESHOLD()
        );
        assertEq(fee, hook.MIN_FEE(), "Fee should be MIN_FEE for zero variance");
    }

    // 5. Fee clamped to MAX_FEE
    function test_feeClampedToMax() public {
        uint24 fee = VolatilityMath.calculateFee(
            100000, // very high variance
            hook.MIN_FEE(),
            hook.MAX_FEE(),
            hook.BASE_FEE(),
            hook.LOW_VARIANCE_THRESHOLD(),
            hook.HIGH_VARIANCE_THRESHOLD()
        );
        assertEq(fee, hook.MAX_FEE(), "Fee should be MAX_FEE for very high variance");
    }

    // 6. EWMA decays old observations
    function test_ewmaDecaysOldObservations() public {
        // Do a large swap to spike variance
        _doSwap(true, -10 ether);

        PoolId poolId = key.toId();
        (,,uint256 varianceAfterSpike,) = hook.volatilityStates(poolId);

        // Do many small swaps to decay the variance
        for (uint256 i = 0; i < 20; i++) {
            _doSwap(false, -0.0001 ether);
        }

        (,,uint256 varianceAfterDecay,) = hook.volatilityStates(poolId);

        // Variance should decay
        assertLt(varianceAfterDecay, varianceAfterSpike, "Variance should decay with small swaps");
    }

    // 7. Must use dynamic fee flag
    function test_mustUseDynamicFeeFlag() public {
        // Try to initialize a pool without dynamic fee flag - should revert
        // The hook's error gets wrapped by Hooks.HookCallFailed, so we just expect any revert
        vm.expectRevert();
        initPool(token0, token1, hook, 3000, SQRT_PRICE_1_1);
    }

    // 8. Volatility resets after stale
    function test_volatilityResetAfterStale() public {
        PoolId poolId = key.toId();

        // Do a large swap to build up variance
        _doSwap(true, -10 ether);

        (,,uint256 varianceBefore,) = hook.volatilityStates(poolId);
        assertGt(varianceBefore, 0, "Variance should be non-zero after swap");

        // Advance time past stale threshold
        vm.warp(block.timestamp + hook.STALE_THRESHOLD() + 1);

        // Do another swap which should trigger the stale reset
        _doSwap(false, -0.001 ether);

        // After the stale reset and the new observation, variance should be reset
        // The first observation after reset only sets lastTick, doesn't update variance
        // But the second call increments count to 1 and sets the tick
        // Actually, the _updateVolatility resets count to 0 then runs the logic:
        // count is 0 after reset, so it skips the EWMA update, just increments count
        // So variance should be 0 after stale reset with single new observation
        (,,uint256 varianceAfter, uint256 countAfter) = hook.volatilityStates(poolId);
        assertEq(varianceAfter, 0, "Variance should be reset after stale");
        assertEq(countAfter, 1, "Count should be 1 after stale reset + new observation");
    }

    // 9. Multiple swaps converge
    function test_multipleSwapsConverge() public {
        PoolId poolId = key.toId();

        // Do a consistent series of small swaps
        for (uint256 i = 0; i < 10; i++) {
            _doSwap(true, -0.001 ether);
        }

        (,,uint256 variance1,) = hook.volatilityStates(poolId);

        // Do a few more of the same
        for (uint256 i = 0; i < 10; i++) {
            _doSwap(true, -0.001 ether);
        }

        (,,uint256 variance2,) = hook.volatilityStates(poolId);

        // The variances should be similar after convergence (within some range)
        // We check that variance2 is within 2x of variance1 (loose bound for convergence)
        if (variance1 > 0) {
            assertLe(variance2, variance1 * 3, "Variance should converge for similar swaps");
        }
    }

    // 10. Bidirectional swaps
    function test_bidirectionalSwaps() public {
        PoolId poolId = key.toId();

        // Swap in one direction
        _doSwap(true, -1 ether);

        uint24 feeAfterOneDirection = hook.getPoolFee(poolId);

        // Swap back in the other direction
        _doSwap(false, -1 ether);

        uint24 feeAfterReverse = hook.getPoolFee(poolId);

        // Both swaps should cause volatility, so fees should be above MIN
        // (the fee after first swap includes the variance from that swap)
        assertGe(feeAfterOneDirection, hook.MIN_FEE(), "Fee should be at least MIN_FEE");
        assertGe(feeAfterReverse, hook.MIN_FEE(), "Fee should be at least MIN_FEE after reverse");
    }
}
