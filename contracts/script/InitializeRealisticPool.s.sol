// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";

/// @title Initialize a realistic-priced USDC/WETH pool
/// @notice 1 WETH ≈ 2000 USDC (tick ~200310, tickSpacing=10)
/// @dev Run: cd contracts && forge script script/InitializeRealisticPool.s.sol --rpc-url https://sepolia.unichain.org --broadcast
contract InitializeRealisticPool is Script {
    // ========== Live Addresses ==========
    address constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant MEGA_QUANT_HOOK = 0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0;
    address constant POOL_REGISTRY = 0x680762A631334098eeF5F24EAAafac0F07Cb2e3a;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x31d0220469e10c4E71834a79b1f276d740d3768F;

    // ========== Pool Parameters ==========
    int24 constant TICK_SPACING = 10;
    int24 constant INITIAL_TICK = 200310; // ≈ 1 WETH = 2000 USDC

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Deployer ETH balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        IPoolManager poolManager = IPoolManager(POOL_MANAGER);
        PoolRegistry poolRegistry = PoolRegistry(POOL_REGISTRY);

        // 1. Compute sqrtPriceX96 from tick
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(INITIAL_TICK);
        console.log("Initial sqrtPriceX96:", sqrtPriceX96);
        console.log("Initial tick:", uint24(INITIAL_TICK));

        // 2. Create pool via PoolRegistry (also initializes on PoolManager)
        bytes32 poolId = poolRegistry.createPool(
            USDC,
            WETH,
            TICK_SPACING,
            sqrtPriceX96,
            "USDC/WETH (Realistic)"
        );
        console.log("Pool created, ID:");
        console.logBytes32(poolId);

        // 3. Deploy a PoolModifyLiquidityTest to add liquidity
        PoolModifyLiquidityTest modLiqRouter = new PoolModifyLiquidityTest(poolManager);
        console.log("PoolModifyLiquidityTest deployed at:", address(modLiqRouter));

        // 4. Wrap ETH to WETH (0.02 ETH)
        uint256 wethToWrap = 0.02 ether;
        require(deployer.balance >= wethToWrap, "Insufficient ETH for wrapping");
        (bool ok,) = WETH.call{value: wethToWrap}("");
        require(ok, "WETH wrap failed");
        console.log("Wrapped ETH to WETH:", wethToWrap);

        // 5. Check token balances
        uint256 usdcBal = IERC20(USDC).balanceOf(deployer);
        uint256 wethBal = IERC20(WETH).balanceOf(deployer);
        console.log("Deployer USDC:", usdcBal);
        console.log("Deployer WETH:", wethBal);
        require(usdcBal > 0, "Need USDC! Mint or acquire test USDC first.");
        require(wethBal > 0, "Need WETH!");

        // 6. Approve tokens for the modLiqRouter
        IERC20(WETH).approve(address(modLiqRouter), type(uint256).max);
        IERC20(USDC).approve(address(modLiqRouter), type(uint256).max);

        // 7. Build pool key
        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(MEGA_QUANT_HOOK)
        });

        // 8. Add concentrated liquidity ±100 ticks around current price (~1% range)
        int24 tickLower = ((INITIAL_TICK - 100) / TICK_SPACING) * TICK_SPACING; // 200210
        int24 tickUpper = ((INITIAL_TICK + 100) / TICK_SPACING) * TICK_SPACING; // 200410

        console.log("Adding liquidity in range:");
        console.log("  tickLower:", uint24(tickLower));
        console.log("  tickUpper:", uint24(tickUpper));

        modLiqRouter.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: 1e14, // Moderate liquidity — adjust based on available tokens
                salt: bytes32(0)
            }),
            new bytes(0)
        );

        console.log("=== Pool Setup Complete ===");
        console.log("Pool is ready for swaps at ~$2000 USDC/WETH");

        vm.stopBroadcast();
    }
}
