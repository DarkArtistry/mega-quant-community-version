// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title OrderLib
/// @notice Library for encoding and decoding order hook data
library OrderLib {
    /// @notice Order types
    uint8 public constant ORDER_TYPE_LIMIT = 1;
    uint8 public constant ORDER_TYPE_STOP_LOSS = 2;
    uint8 public constant ORDER_TYPE_TAKE_PROFIT = 3;

    /// @notice Struct representing a decoded order
    struct Order {
        address trader;
        uint64 strategyId;
        uint8 orderType;
        bytes extraData;
    }

    /// @notice Encodes order parameters into hookData bytes
    /// @param trader The address of the trader placing the order
    /// @param strategyId The strategy identifier
    /// @param orderType The type of order (limit, stop loss, take profit)
    /// @param extraData Additional arbitrary data for the order
    /// @return The ABI-encoded hook data
    function encodeHookData(
        address trader,
        uint64 strategyId,
        uint8 orderType,
        bytes memory extraData
    ) internal pure returns (bytes memory) {
        return abi.encode(trader, strategyId, orderType, extraData);
    }

    /// @notice Decodes hookData bytes into order parameters
    /// @param data The ABI-encoded hook data
    /// @return trader The address of the trader
    /// @return strategyId The strategy identifier
    /// @return orderType The type of order
    /// @return extraData Additional arbitrary data
    function decodeHookData(bytes memory data)
        internal
        pure
        returns (
            address trader,
            uint64 strategyId,
            uint8 orderType,
            bytes memory extraData
        )
    {
        (trader, strategyId, orderType, extraData) = abi.decode(
            data,
            (address, uint64, uint8, bytes)
        );
    }
}
