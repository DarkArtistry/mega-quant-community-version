// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MegaQuantHook} from "../../src/MegaQuantHook.sol";
import {MegaQuantRouter} from "../../src/MegaQuantRouter.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract MainnetForkTest is Test, ERC1155Holder {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // ========== Mainnet Addresses ==========
    address constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    // ========== Constants ==========
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    bytes constant ZERO_BYTES = new bytes(0);

    // ========== State ==========
    IPoolManager manager;
    MegaQuantHook hook;
    MegaQuantRouter router;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest modifyLiquidityRouter;
    PoolKey key;
    Currency currency0;
    Currency currency1;

    /// @dev Forks mainnet using ETH_RPC_URL env var.
    ///      Returns false if the env var is not set, so tests skip gracefully.
    function _forkMainnet() internal returns (bool) {
        string memory rpcUrl = vm.envOr("ETH_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            return false;
        }
        vm.createSelectFork(rpcUrl);
        return true;
    }

    /// @dev Common setup for both fork tests: deploys the hook, router, and test routers
    ///      against the live mainnet PoolManager.
    function _setupFork() internal {
        manager = IPoolManager(POOL_MANAGER);

        // Deploy test routers pointing at the live PoolManager
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);

        // Compute the hook address from the required permission flags
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG |
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG
        );
        address hookAddress = address(flags);

        // Deploy MegaQuantHook to the flag-derived address using deployCodeTo
        deployCodeTo(
            "MegaQuantHook.sol",
            abi.encode(manager, ""),
            hookAddress
        );
        hook = MegaQuantHook(hookAddress);

        // Deploy MegaQuantRouter
        router = new MegaQuantRouter(manager);

        // Sort currencies so currency0 < currency1 (required by Uniswap v4)
        if (uint160(USDC) < uint160(WETH)) {
            currency0 = Currency.wrap(USDC);
            currency1 = Currency.wrap(WETH);
        } else {
            currency0 = Currency.wrap(WETH);
            currency1 = Currency.wrap(USDC);
        }

        // Give this test contract tokens via deal()
        deal(WETH, address(this), 1000 ether);
        deal(USDC, address(this), 1_000_000e6);

        // Approve all routers and the hook to spend tokens
        IERC20(WETH).approve(address(swapRouter), type(uint256).max);
        IERC20(USDC).approve(address(swapRouter), type(uint256).max);
        IERC20(WETH).approve(address(modifyLiquidityRouter), type(uint256).max);
        IERC20(USDC).approve(address(modifyLiquidityRouter), type(uint256).max);
        IERC20(WETH).approve(address(hook), type(uint256).max);
        IERC20(USDC).approve(address(hook), type(uint256).max);
        IERC20(WETH).approve(address(router), type(uint256).max);
        IERC20(USDC).approve(address(router), type(uint256).max);

        // Build the pool key with dynamic fee
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: int24(60),
            hooks: IHooks(hookAddress)
        });

        // Initialize the pool against the live PoolManager
        manager.initialize(key, SQRT_PRICE_1_1);
    }

    // ================================================================
    // Test 1: Deploy and initialize on mainnet fork
    // ================================================================
    function test_deployOnMainnetFork() public {
        bool forked = _forkMainnet();
        if (!forked) {
            console.log("Skipping test_deployOnMainnetFork: no RPC available");
            return;
        }

        _setupFork();

        // Verify the pool is initialized by reading its slot0
        PoolId poolId = key.toId();
        (uint160 sqrtPriceX96, int24 tick,,) = manager.getSlot0(poolId);

        assertGt(sqrtPriceX96, 0, "Pool sqrtPriceX96 should be non-zero after init");
        console.log("Pool initialized on mainnet fork");
        console.log("  sqrtPriceX96:", sqrtPriceX96);
        console.log("  tick:");
        console.logInt(tick);

        // Verify the hook address matches expected flag bits
        uint160 hookAddr = uint160(address(hook));
        assertTrue(
            hookAddr & uint160(Hooks.BEFORE_INITIALIZE_FLAG) != 0,
            "Hook should have BEFORE_INITIALIZE_FLAG"
        );
        assertTrue(
            hookAddr & uint160(Hooks.AFTER_SWAP_FLAG) != 0,
            "Hook should have AFTER_SWAP_FLAG"
        );

        // Verify fee is BASE_FEE (no swaps yet, so volatility is zero)
        uint24 fee = hook.getPoolFee(poolId);
        assertEq(fee, hook.BASE_FEE(), "Initial fee should be BASE_FEE");
    }

    // ================================================================
    // Test 2: Swap on mainnet fork with volatility tracking
    // ================================================================
    function test_swapOnMainnetFork() public {
        bool forked = _forkMainnet();
        if (!forked) {
            console.log("Skipping test_swapOnMainnetFork: no RPC available");
            return;
        }

        _setupFork();

        PoolId poolId = key.toId();

        // ----- Add liquidity across several tick ranges -----
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

        // ----- Execute a swap (zeroForOne, exact input) -----
        PoolSwapTest.TestSettings memory testSettings = PoolSwapTest
            .TestSettings({takeClaims: false, settleUsingBurn: false});

        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -0.01 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });

        swapRouter.swap(key, params, testSettings, ZERO_BYTES);

        // ----- Verify volatility state was updated -----
        (
            int24 lastTick,
            uint256 lastTimestamp,
            uint256 ewmaVariance,
            uint256 observationCount
        ) = hook.volatilityStates(poolId);

        assertGt(observationCount, 0, "Observation count should be > 0 after swap");
        assertGt(lastTimestamp, 0, "Last timestamp should be set");
        console.log("After swap:");
        console.log("  observationCount:", observationCount);
        console.log("  ewmaVariance:", ewmaVariance);
        console.log("  lastTick:");
        console.logInt(lastTick);

        // ----- Verify fee is within bounds -----
        uint24 fee = hook.getPoolFee(poolId);
        assertGe(fee, hook.MIN_FEE(), "Fee should be >= MIN_FEE");
        assertLe(fee, hook.MAX_FEE(), "Fee should be <= MAX_FEE");
        console.log("  dynamicFee:", fee);

        // ----- Execute a second swap in the opposite direction -----
        SwapParams memory params2 = SwapParams({
            zeroForOne: false,
            amountSpecified: -0.01 ether,
            sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
        });

        swapRouter.swap(key, params2, testSettings, ZERO_BYTES);

        // Verify observation count increased
        (,,, uint256 countAfter) = hook.volatilityStates(poolId);
        assertGt(countAfter, observationCount, "Observation count should increase after second swap");

        // Fee should still be in bounds
        uint24 feeAfter = hook.getPoolFee(poolId);
        assertGe(feeAfter, hook.MIN_FEE(), "Fee after second swap should be >= MIN_FEE");
        assertLe(feeAfter, hook.MAX_FEE(), "Fee after second swap should be <= MAX_FEE");
        console.log("After second swap:");
        console.log("  dynamicFee:", feeAfter);
    }
}
