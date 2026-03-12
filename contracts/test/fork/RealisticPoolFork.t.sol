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
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MegaQuantHook} from "../../src/MegaQuantHook.sol";
import {MegaQuantRouter} from "../../src/MegaQuantRouter.sol";
import {PoolRegistry} from "../../src/PoolRegistry.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// @title Fork test for realistic-priced USDC/WETH pool (tickSpacing=10)
/// @notice Run: cd contracts && forge test --match-contract RealisticPoolForkTest -vvvv --fork-url https://sepolia.unichain.org
contract RealisticPoolForkTest is Test, ERC1155Holder {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // ========== Live Unichain Sepolia Addresses ==========
    address constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant MEGA_QUANT_HOOK = 0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0;
    address constant MEGA_QUANT_ROUTER = 0x608AEfA1DFD3621554a948E20159eB243C76235F;
    address constant POOL_REGISTRY = 0x680762A631334098eeF5F24EAAafac0F07Cb2e3a;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;

    // ========== New Pool Parameters ==========
    int24 constant TICK_SPACING = 10;
    int24 constant INITIAL_TICK = 200310; // ≈ 1 WETH = 2000 USDC

    IPoolManager manager;
    MegaQuantHook hook;
    MegaQuantRouter router;
    PoolRegistry registry;
    PoolKey key;

    function setUp() public {
        manager = IPoolManager(POOL_MANAGER);
        hook = MegaQuantHook(MEGA_QUANT_HOOK);
        router = MegaQuantRouter(payable(MEGA_QUANT_ROUTER));
        registry = PoolRegistry(POOL_REGISTRY);

        // Create the realistic pool via PoolRegistry
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        registry.createPool(USDC, WETH, TICK_SPACING, sqrtPriceX96, "USDC/WETH (Realistic)");

        // Build the pool key
        key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(MEGA_QUANT_HOOK)
        });
    }

    /// @notice Verify pool was created at the correct tick
    function test_poolCreated() public view {
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96, int24 currentTick,,) = manager.getSlot0(poolId);

        console.log("=== New Realistic Pool ===");
        console.log("sqrtPriceX96:", sqrtPriceX96);
        console.log("currentTick:");
        console.logInt(currentTick);

        uint128 liquidity = manager.getLiquidity(poolId);
        console.log("liquidity:", liquidity);

        assertTrue(currentTick >= 200300 && currentTick <= 200320, "Tick should be ~200310");
    }

    /// @notice Add liquidity and swap 0.0001 WETH → USDC
    function test_swapWithRealisticPrice() public {
        // 1. Add concentrated liquidity
        PoolModifyLiquidityTest modLiqRouter = new PoolModifyLiquidityTest(manager);

        address lp = makeAddr("lp");
        deal(WETH, lp, 10 ether);
        deal(USDC, lp, 1_000_000e6); // 1M USDC

        vm.startPrank(lp);
        IERC20(WETH).approve(address(modLiqRouter), type(uint256).max);
        IERC20(USDC).approve(address(modLiqRouter), type(uint256).max);

        // ±500 ticks around initial tick (about ±5% price range)
        int24 tickLower = ((INITIAL_TICK - 500) / TICK_SPACING) * TICK_SPACING; // 199810
        int24 tickUpper = ((INITIAL_TICK + 500) / TICK_SPACING) * TICK_SPACING; // 200810

        modLiqRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: 1e15,
                salt: bytes32(0)
            }),
            new bytes(0)
        );
        vm.stopPrank();

        // Check liquidity
        uint128 newLiquidity = manager.getLiquidity(key.toId());
        console.log("Liquidity after adding:", newLiquidity);

        // 2. Swap 0.0001 WETH → USDC (zeroForOne=false since WETH is currency1)
        address swapper = makeAddr("swapper");
        deal(WETH, swapper, 1 ether);

        vm.startPrank(swapper);
        IERC20(WETH).approve(MEGA_QUANT_ROUTER, type(uint256).max);

        uint256 gasBefore = gasleft();
        BalanceDelta delta = router.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(0.0001 ether), // exact input
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            new bytes(0)
        );
        uint256 gasUsed = gasBefore - gasleft();

        console.log("=== Realistic Price Swap ===");
        console.log("Gas used:", gasUsed);
        console.log("delta.amount0 (USDC received):");
        console.logInt(delta.amount0());
        console.log("delta.amount1 (WETH spent):");
        console.logInt(delta.amount1());

        // USDC received should be positive (~0.2 USDC = 200000 raw at $2000/ETH)
        assertTrue(delta.amount0() > 0, "Should receive USDC");
        // Gas should be reasonable (< 500k)
        assertTrue(gasUsed < 500_000, "Gas should be < 500k");

        vm.stopPrank();
    }

    /// @notice Test with a smaller amount of liquidity (realistic for a user with limited funds)
    function test_swapWithModestLiquidity() public {
        PoolModifyLiquidityTest modLiqRouter = new PoolModifyLiquidityTest(manager);

        address lp = makeAddr("modestLP");
        deal(WETH, lp, 0.05 ether);
        deal(USDC, lp, 100e6); // 100 USDC

        vm.startPrank(lp);
        IERC20(WETH).approve(address(modLiqRouter), type(uint256).max);
        IERC20(USDC).approve(address(modLiqRouter), type(uint256).max);

        // Tighter range: ±100 ticks (~1% price range)
        int24 tickLower = ((INITIAL_TICK - 100) / TICK_SPACING) * TICK_SPACING; // 200210
        int24 tickUpper = ((INITIAL_TICK + 100) / TICK_SPACING) * TICK_SPACING; // 200410

        modLiqRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: 1e14,
                salt: bytes32(0)
            }),
            new bytes(0)
        );
        vm.stopPrank();

        uint128 liquidity = manager.getLiquidity(key.toId());
        console.log("Modest liquidity:", liquidity);

        // Swap smaller amount: 0.00001 WETH
        address swapper = makeAddr("swapper2");
        deal(WETH, swapper, 0.01 ether);

        vm.startPrank(swapper);
        IERC20(WETH).approve(MEGA_QUANT_ROUTER, type(uint256).max);

        BalanceDelta delta = router.swap(
            key,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -int256(0.00001 ether),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            new bytes(0)
        );

        console.log("=== Modest Liquidity Swap ===");
        console.log("USDC received:");
        console.logInt(delta.amount0());
        console.log("WETH spent:");
        console.logInt(delta.amount1());

        assertTrue(delta.amount0() > 0, "Should receive USDC");
        vm.stopPrank();
    }

    /// @notice Verify limit order placement works on the new pool
    function test_limitOrderOnRealisticPool() public {
        // First add liquidity so the pool is functional
        PoolModifyLiquidityTest modLiqRouter = new PoolModifyLiquidityTest(manager);
        address lp = makeAddr("lp");
        deal(WETH, lp, 10 ether);
        deal(USDC, lp, 1_000_000e6);

        vm.startPrank(lp);
        IERC20(WETH).approve(address(modLiqRouter), type(uint256).max);
        IERC20(USDC).approve(address(modLiqRouter), type(uint256).max);

        int24 tickLower = ((INITIAL_TICK - 500) / TICK_SPACING) * TICK_SPACING;
        int24 tickUpper = ((INITIAL_TICK + 500) / TICK_SPACING) * TICK_SPACING;

        modLiqRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: 1e15,
                salt: bytes32(0)
            }),
            new bytes(0)
        );
        vm.stopPrank();

        // Place a limit order: sell 0.001 WETH at tick 200400 (slightly above market)
        address trader = makeAddr("trader");
        deal(WETH, trader, 0.01 ether);

        vm.startPrank(trader);
        IERC20(WETH).approve(MEGA_QUANT_ROUTER, type(uint256).max);

        int24 orderTick = 200400; // Above current tick — sell WETH when price rises
        uint256 orderAmount = 0.001 ether;

        router.placeLimitOrder(
            key,
            orderTick,
            orderAmount,
            false, // zeroForOne=false (selling WETH = token1)
            uint64(block.timestamp + 86400),
            new bytes(0)
        );

        // Check pending order
        PoolId poolId = key.toId();
        uint256 pending = hook.pendingOrders(poolId, orderTick, false);
        console.log("Pending limit order amount:", pending);
        assertTrue(pending > 0, "Limit order should be pending");

        vm.stopPrank();
    }

    /// @notice Show the pool count in the registry
    function test_registryPoolCount() public view {
        uint256 count = registry.poolCount();
        console.log("Total registered pools:", count);
        // Should have at least 2 (old pool + new one)
        assertTrue(count >= 2, "Should have at least 2 pools");
    }
}
