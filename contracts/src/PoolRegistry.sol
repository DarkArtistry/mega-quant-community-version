// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";

/// @title PoolRegistry
/// @notice Registry for MegaQuantHook pools. Tracks pool metadata for discovery.
contract PoolRegistry {
    using PoolIdLibrary for PoolKey;

    struct PoolInfo {
        address token0;
        address token1;
        int24 tickSpacing;
        address creator;
        string name;
        bool active;
    }

    IPoolManager public immutable poolManager;
    address public immutable hookAddress;

    /// @notice All registered pool IDs in order
    bytes32[] public poolIds;

    /// @notice Pool metadata by pool ID
    mapping(bytes32 => PoolInfo) public pools;

    /// @notice Pool IDs for a given token pair (sorted)
    mapping(address => mapping(address => bytes32[])) private pairPools;

    event PoolRegistered(
        bytes32 indexed poolId,
        address indexed token0,
        address indexed token1,
        int24 tickSpacing,
        address creator,
        string name
    );

    error InvalidTokenOrder();

    constructor(IPoolManager _poolManager, address _hookAddress) {
        poolManager = _poolManager;
        hookAddress = _hookAddress;
    }

    /// @notice Register a new pool and optionally initialize it on PoolManager
    /// @param currency0 Lower-addressed token
    /// @param currency1 Higher-addressed token
    /// @param tickSpacing Tick spacing for the pool
    /// @param sqrtPriceX96 Initial sqrt price (0 to skip initialization)
    /// @param name Human-readable pool name
    /// @return poolId The computed pool ID
    function createPool(
        address currency0,
        address currency1,
        int24 tickSpacing,
        uint160 sqrtPriceX96,
        string calldata name
    ) external returns (bytes32) {
        if (currency0 >= currency1) revert InvalidTokenOrder();

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: tickSpacing,
            hooks: IHooks(hookAddress)
        });

        bytes32 poolId = bytes32(PoolId.unwrap(key.toId()));

        // Initialize on PoolManager if sqrtPriceX96 > 0
        if (sqrtPriceX96 > 0) {
            poolManager.initialize(key, sqrtPriceX96);
        }

        // Store metadata
        pools[poolId] = PoolInfo({
            token0: currency0,
            token1: currency1,
            tickSpacing: tickSpacing,
            creator: msg.sender,
            name: name,
            active: true
        });

        poolIds.push(poolId);
        pairPools[currency0][currency1].push(poolId);

        emit PoolRegistered(poolId, currency0, currency1, tickSpacing, msg.sender, name);

        return poolId;
    }

    /// @notice Get the number of registered pools
    function poolCount() external view returns (uint256) {
        return poolIds.length;
    }

    /// @notice Get pool IDs for a specific token pair
    function getPoolsForPair(
        address currency0,
        address currency1
    ) external view returns (bytes32[] memory) {
        return pairPools[currency0][currency1];
    }

    /// @notice Get a paginated slice of pool IDs
    function getPoolIds(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory) {
        uint256 total = poolIds.length;
        if (offset >= total) {
            return new bytes32[](0);
        }

        uint256 end = offset + limit;
        if (end > total) end = total;

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = poolIds[i];
        }

        return result;
    }
}
