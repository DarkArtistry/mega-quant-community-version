// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MegaQuantHook} from "../../src/MegaQuantHook.sol";
import {MegaQuantRouter} from "../../src/MegaQuantRouter.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// @title Fork test against live Unichain Sepolia state
/// @notice Run: cd contracts && forge test --match-contract UnichainSepoliaForkTest -vvvv --fork-url https://sepolia.unichain.org
contract UnichainSepoliaForkTest is Test, ERC1155Holder {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // ========== Live Unichain Sepolia Addresses ==========
    address constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant MEGA_QUANT_HOOK = 0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0;
    address constant MEGA_QUANT_ROUTER = 0x608AEfA1DFD3621554a948E20159eB243C76235F;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;
    address constant USER_WALLET = 0x2602Ae57760aE3D3dF3A2B786EF5dEa8Daa95b55;

    IPoolManager manager;
    MegaQuantHook hook;
    MegaQuantRouter router;
    PoolKey key;

    function setUp() public {
        manager = IPoolManager(POOL_MANAGER);
        hook = MegaQuantHook(MEGA_QUANT_HOOK);
        router = MegaQuantRouter(payable(MEGA_QUANT_ROUTER));

        // Build the exact pool key used by the backend
        // currency0 < currency1: USDC < WETH
        key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: int24(60),
            hooks: IHooks(MEGA_QUANT_HOOK)
        });
    }

    /// @notice Diagnostic: read all the on-chain state to understand why swap fails
    function test_diagnosePoolState() public view {
        PoolId poolId = key.toId();
        console.log("=== Pool State Diagnosis ===");
        console.log("PoolId:");
        console.logBytes32(PoolId.unwrap(poolId));

        // Read slot0
        (uint160 sqrtPriceX96, int24 currentTick,,) = manager.getSlot0(poolId);
        console.log("sqrtPriceX96:", sqrtPriceX96);
        console.log("currentTick:");
        console.logInt(currentTick);

        // Read liquidity
        uint128 liquidity = manager.getLiquidity(poolId);
        console.log("liquidity:", liquidity);

        // Read hook's lastTick
        int24 lastTick = hook.lastTicks(poolId);
        console.log("hook.lastTicks:");
        console.logInt(lastTick);

        // Tick gap
        int24 gap = currentTick > lastTick ? currentTick - lastTick : lastTick - currentTick;
        console.log("tickGap:");
        console.logInt(gap);

        // Check pending orders at key ticks
        int24[7] memory ticks = [int24(0), int24(-60), int24(60), int24(-120), int24(120), int24(-180), int24(180)];
        for (uint256 i = 0; i < ticks.length; i++) {
            uint256 limitTrue = hook.pendingOrders(poolId, ticks[i], true);
            uint256 limitFalse = hook.pendingOrders(poolId, ticks[i], false);
            uint256 stopTrue = hook.pendingStopOrders(poolId, ticks[i], true);
            uint256 stopFalse = hook.pendingStopOrders(poolId, ticks[i], false);

            if (limitTrue > 0 || limitFalse > 0 || stopTrue > 0 || stopFalse > 0) {
                console.log("--- Tick", uint24(ticks[i] >= 0 ? ticks[i] : -ticks[i]), ticks[i] >= 0 ? "(+)" : "(-)");
                console.log("  limitOrders(z4o=true):", limitTrue);
                console.log("  limitOrders(z4o=false):", limitFalse);
                console.log("  stopOrders(z4o=true):", stopTrue);
                console.log("  stopOrders(z4o=false):", stopFalse);
            }
        }

        // Balances and approvals
        console.log("User WETH:", IERC20(WETH).balanceOf(USER_WALLET));
        console.log("User USDC:", IERC20(USDC).balanceOf(USER_WALLET));
        console.log("WETH allowance->router:", IERC20(WETH).allowance(USER_WALLET, MEGA_QUANT_ROUTER));
        console.log("Hook WETH:", IERC20(WETH).balanceOf(MEGA_QUANT_HOOK));
        console.log("Hook USDC:", IERC20(USDC).balanceOf(MEGA_QUANT_HOOK));
        console.log("Dynamic fee:", hook.getPoolFee(poolId));
    }

    /// @notice Try the exact swap that's failing in production
    function test_swapViaRouter() public {
        vm.startPrank(USER_WALLET);

        // Ensure approval
        IERC20(WETH).approve(MEGA_QUANT_ROUTER, type(uint256).max);

        // The exact swap: 0.0001 WETH -> USDC (zeroForOne=false since WETH is currency1)
        BalanceDelta delta = router.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(0.0001 ether),   // exact input
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            new bytes(0)
        );

        console.log("=== Swap Succeeded ===");
        console.log("delta.amount0 (USDC):");
        console.logInt(delta.amount0());
        console.log("delta.amount1 (WETH):");
        console.logInt(delta.amount1());

        vm.stopPrank();
    }

    /// @notice Swap with a fresh user (no pending orders, clean state)
    function test_swapWithFreshUser() public {
        address freshUser = makeAddr("freshUser");

        // Give fresh user some WETH
        deal(WETH, freshUser, 1 ether);

        vm.startPrank(freshUser);
        IERC20(WETH).approve(MEGA_QUANT_ROUTER, type(uint256).max);

        BalanceDelta delta = router.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(0.0001 ether),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            new bytes(0)
        );

        console.log("=== Fresh User Swap Succeeded ===");
        console.log("delta.amount0 (USDC):");
        console.logInt(delta.amount0());
        console.log("delta.amount1 (WETH):");
        console.logInt(delta.amount1());

        vm.stopPrank();
    }

    /// @notice Prove the swap works if we add concentrated liquidity first
    function test_swapAfterAddingLiquidity() public {
        // The pool has only 2M liquidity (full range). A 0.0001 WETH swap is 50M times
        // larger than the pool's effective reserve. We need concentrated liquidity.

        // Use PoolSwapTest (V4's test router) to add liquidity since it handles settlement
        PoolSwapTest swapTestRouter = new PoolSwapTest(manager);
        PoolModifyLiquidityTest modLiqRouter = new PoolModifyLiquidityTest(manager);

        address lp = makeAddr("liquidityProvider");
        deal(WETH, lp, 100 ether);
        deal(USDC, lp, 1_000_000_000e6);  // 1B USDC

        vm.startPrank(lp);
        IERC20(WETH).approve(address(modLiqRouter), type(uint256).max);
        IERC20(USDC).approve(address(modLiqRouter), type(uint256).max);

        // Add concentrated liquidity around tick 0 (-120 to 120)
        modLiqRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: -120,
                tickUpper: 120,
                liquidityDelta: 100_000_000_000_000_000, // 1e17 liquidity
                salt: bytes32(0)
            }),
            new bytes(0)
        );
        vm.stopPrank();

        // Check new liquidity
        uint128 newLiquidity = manager.getLiquidity(key.toId());
        console.log("Liquidity after adding:", newLiquidity);

        // Now try the swap as the actual user
        vm.startPrank(USER_WALLET);
        IERC20(WETH).approve(MEGA_QUANT_ROUTER, type(uint256).max);

        uint256 gasBefore = gasleft();
        BalanceDelta delta = router.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(0.0001 ether),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            new bytes(0)
        );
        uint256 gasUsed = gasBefore - gasleft();

        console.log("=== Swap WITH adequate liquidity ===");
        console.log("Gas used:", gasUsed);
        console.log("delta.amount0 (USDC received):");
        console.logInt(delta.amount0());
        console.log("delta.amount1 (WETH spent):");
        console.logInt(delta.amount1());

        vm.stopPrank();
    }

    /// @notice Show swap fails with tiny liquidity (current state)
    function test_swapFailsWithTinyLiquidity() public {
        // Expect this to use massive gas or revert
        address freshUser = makeAddr("tinyLiqUser");
        deal(WETH, freshUser, 1 ether);

        vm.startPrank(freshUser);
        IERC20(WETH).approve(MEGA_QUANT_ROUTER, type(uint256).max);

        // This should either: 1) use enormous gas, or 2) revert
        // We expect it to consume all gas due to afterSwap tick iteration
        uint256 gasBefore = gasleft();
        try router.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(0.0001 ether),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            new bytes(0)
        ) returns (BalanceDelta delta) {
            uint256 gasUsed = gasBefore - gasleft();
            console.log("Swap succeeded (unexpected!) with gas:", gasUsed);
            console.logInt(delta.amount0());
            console.logInt(delta.amount1());
        } catch {
            uint256 gasUsed = gasBefore - gasleft();
            console.log("Swap FAILED as expected. Gas consumed:", gasUsed);
        }

        vm.stopPrank();
    }
}
