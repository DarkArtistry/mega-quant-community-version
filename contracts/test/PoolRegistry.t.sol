// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {MegaQuantHook} from "../src/MegaQuantHook.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract PoolRegistryTest is Test, Deployers, ERC1155Holder {
    MegaQuantHook hook;
    PoolRegistry registry;
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
        registry = new PoolRegistry(manager, hookAddress);
    }

    function test_createPool() public {
        address t0 = Currency.unwrap(token0);
        address t1 = Currency.unwrap(token1);

        // Ensure t0 < t1
        if (t0 > t1) (t0, t1) = (t1, t0);

        uint160 sqrtPriceX96 = 79228162514264337593543950336; // SQRT_PRICE_1_1

        bytes32 poolId = registry.createPool(t0, t1, 60, sqrtPriceX96, "WETH/USDC");

        assertTrue(poolId != bytes32(0), "Pool ID should be non-zero");
        assertEq(registry.poolCount(), 1, "Should have 1 pool");
    }

    function test_createPoolStoresMetadata() public {
        address t0 = Currency.unwrap(token0);
        address t1 = Currency.unwrap(token1);
        if (t0 > t1) (t0, t1) = (t1, t0);

        bytes32 poolId = registry.createPool(
            t0, t1, 60, 79228162514264337593543950336, "TestPool"
        );

        (address rToken0, address rToken1, int24 tickSpacing, address creator, string memory name, bool active) =
            registry.pools(poolId);

        assertEq(rToken0, t0, "token0 mismatch");
        assertEq(rToken1, t1, "token1 mismatch");
        assertEq(tickSpacing, 60, "tickSpacing mismatch");
        assertEq(creator, address(this), "creator mismatch");
        assertEq(name, "TestPool", "name mismatch");
        assertTrue(active, "Should be active");
    }

    function test_createPool_revertsIfBadOrder() public {
        address t0 = Currency.unwrap(token0);
        address t1 = Currency.unwrap(token1);
        if (t0 > t1) (t0, t1) = (t1, t0);

        // Pass in wrong order
        vm.expectRevert(PoolRegistry.InvalidTokenOrder.selector);
        registry.createPool(t1, t0, 60, 79228162514264337593543950336, "Bad");
    }

    function test_getPoolsForPair() public {
        address t0 = Currency.unwrap(token0);
        address t1 = Currency.unwrap(token1);
        if (t0 > t1) (t0, t1) = (t1, t0);

        registry.createPool(t0, t1, 60, 79228162514264337593543950336, "Pool1");
        registry.createPool(t0, t1, 10, 79228162514264337593543950336, "Pool2");

        bytes32[] memory pools = registry.getPoolsForPair(t0, t1);
        assertEq(pools.length, 2, "Should have 2 pools for this pair");
    }

    function test_getPoolIds_pagination() public {
        address t0 = Currency.unwrap(token0);
        address t1 = Currency.unwrap(token1);
        if (t0 > t1) (t0, t1) = (t1, t0);

        registry.createPool(t0, t1, 60, 79228162514264337593543950336, "Pool1");
        registry.createPool(t0, t1, 10, 79228162514264337593543950336, "Pool2");
        registry.createPool(t0, t1, 200, 79228162514264337593543950336, "Pool3");

        assertEq(registry.poolCount(), 3);

        // First page
        bytes32[] memory page1 = registry.getPoolIds(0, 2);
        assertEq(page1.length, 2, "First page should have 2 items");

        // Second page
        bytes32[] memory page2 = registry.getPoolIds(2, 2);
        assertEq(page2.length, 1, "Second page should have 1 item");

        // Out of range
        bytes32[] memory page3 = registry.getPoolIds(10, 5);
        assertEq(page3.length, 0, "Out of range should return empty");
    }

    function test_poolCount_empty() public view {
        assertEq(registry.poolCount(), 0, "Should start with 0 pools");
    }

    function test_createPoolWithoutInit() public {
        address t0 = Currency.unwrap(token0);
        address t1 = Currency.unwrap(token1);
        if (t0 > t1) (t0, t1) = (t1, t0);

        // sqrtPriceX96 = 0 means skip initialization
        bytes32 poolId = registry.createPool(t0, t1, 60, 0, "NoInit");

        assertTrue(poolId != bytes32(0), "Pool ID should be non-zero");
        assertEq(registry.poolCount(), 1, "Should register even without init");
    }
}
