// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MegaQuantRouter} from "../../src/MegaQuantRouter.sol";
import {PoolRegistry} from "../../src/PoolRegistry.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/// @title Test the LIVE deployed realistic pool (no new pool creation)
/// @notice Run: cd contracts && forge test --match-contract LivePoolTest -vvvv --fork-url https://sepolia.unichain.org
contract LivePoolTest is Test, ERC1155Holder {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    address constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant MEGA_QUANT_HOOK = 0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0;
    address constant MEGA_QUANT_ROUTER = 0x608AEfA1DFD3621554a948E20159eB243C76235F;
    address constant POOL_REGISTRY = 0x680762A631334098eeF5F24EAAafac0F07Cb2e3a;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;
    address constant USER_WALLET = 0x2602Ae57760aE3D3dF3A2B786EF5dEa8Daa95b55;

    IPoolManager manager;
    MegaQuantRouter router;
    PoolKey key;

    function setUp() public {
        manager = IPoolManager(POOL_MANAGER);
        router = MegaQuantRouter(payable(MEGA_QUANT_ROUTER));

        // Use the NEW realistic pool (tickSpacing=10)
        key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: int24(10),
            hooks: IHooks(MEGA_QUANT_HOOK)
        });
    }

    /// @notice Verify the live pool state
    function test_livePoolState() public view {
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96, int24 currentTick,,) = manager.getSlot0(poolId);
        uint128 liquidity = manager.getLiquidity(poolId);

        console.log("=== Live Realistic Pool ===");
        console.log("sqrtPriceX96:", sqrtPriceX96);
        console.log("currentTick:");
        console.logInt(currentTick);
        console.log("liquidity:", liquidity);

        assertTrue(sqrtPriceX96 > 0, "Pool should be initialized");
        assertTrue(currentTick >= 200300 && currentTick <= 200320, "Tick should be ~200310");
        assertTrue(liquidity > 0, "Pool should have liquidity");
    }

    /// @notice Swap 0.0001 WETH → USDC using the actual user wallet
    function test_liveSwap() public {
        vm.startPrank(USER_WALLET);
        IERC20(WETH).approve(MEGA_QUANT_ROUTER, type(uint256).max);

        uint256 wethBefore = IERC20(WETH).balanceOf(USER_WALLET);
        uint256 usdcBefore = IERC20(USDC).balanceOf(USER_WALLET);
        console.log("Before - WETH:", wethBefore, "USDC:", usdcBefore);

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

        uint256 wethAfter = IERC20(WETH).balanceOf(USER_WALLET);
        uint256 usdcAfter = IERC20(USDC).balanceOf(USER_WALLET);

        console.log("=== Live Swap Result ===");
        console.log("Gas used:", gasUsed);
        console.log("USDC received:");
        console.logInt(delta.amount0());
        console.log("WETH spent:");
        console.logInt(delta.amount1());
        console.log("After - WETH:", wethAfter, "USDC:", usdcAfter);

        assertTrue(delta.amount0() > 0, "Should receive USDC");
        assertTrue(gasUsed < 300_000, "Gas should be reasonable");

        vm.stopPrank();
    }

    /// @notice Check registry has 2 pools
    function test_registryHasTwoPools() public view {
        PoolRegistry reg = PoolRegistry(POOL_REGISTRY);
        uint256 count = reg.poolCount();
        console.log("Registered pools:", count);
        assertTrue(count == 2, "Should have 2 pools (old + new)");
    }
}
