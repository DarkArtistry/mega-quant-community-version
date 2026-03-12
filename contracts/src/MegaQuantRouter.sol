// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IPoolManager, SwapParams} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {IMsgSender} from "v4-periphery/src/interfaces/IMsgSender.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {MegaQuantHook} from "./MegaQuantHook.sol";

contract MegaQuantRouter is IUnlockCallback, IMsgSender {
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;

    IPoolManager public immutable manager;

    // Transient storage slot for storing the original msg.sender
    // keccak256("MSG_SENDER")
    uint256 private constant MSG_SENDER_SLOT = 0x9ddd6a81cfa26d88d670ca7d1814e0a61739bb989946b2eb98ca6a45044fbc76;

    error CallerNotManager();

    // Callback action types
    uint8 private constant ACTION_SWAP = 1;
    uint8 private constant ACTION_BATCH_SWAP = 2;

    struct SwapCallbackData {
        address sender;
        PoolKey key;
        SwapParams params;
        bytes hookData;
    }

    struct BatchSwapCallbackData {
        address sender;
        PoolKey[] keys;
        SwapParams[] paramsArray;
        bytes[] hookDataArray;
    }

    struct CallbackData {
        uint8 action;
        bytes data;
    }

    constructor(IPoolManager _manager) {
        manager = _manager;
    }

    // IMsgSender implementation
    function msgSender() external view returns (address) {
        address stored;
        assembly {
            stored := tload(MSG_SENDER_SLOT)
        }
        return stored;
    }

    /// @notice Execute a single swap
    function swap(
        PoolKey memory key,
        SwapParams memory params,
        bytes memory hookData
    ) external payable returns (BalanceDelta delta) {
        delta = abi.decode(
            manager.unlock(
                abi.encode(
                    CallbackData({
                        action: ACTION_SWAP,
                        data: abi.encode(
                            SwapCallbackData({
                                sender: msg.sender,
                                key: key,
                                params: params,
                                hookData: hookData
                            })
                        )
                    })
                )
            ),
            (BalanceDelta)
        );

        // Return any remaining ETH
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            CurrencyLibrary.ADDRESS_ZERO.transfer(msg.sender, ethBalance);
        }
    }

    /// @notice Execute multiple swaps in a single unlock
    function batchSwap(
        PoolKey[] memory keys,
        SwapParams[] memory paramsArray,
        bytes[] memory hookDataArray
    ) external payable returns (BalanceDelta[] memory deltas) {
        require(keys.length == paramsArray.length, "Length mismatch");
        require(keys.length == hookDataArray.length, "Length mismatch");

        bytes memory result = manager.unlock(
            abi.encode(
                CallbackData({
                    action: ACTION_BATCH_SWAP,
                    data: abi.encode(
                        BatchSwapCallbackData({
                            sender: msg.sender,
                            keys: keys,
                            paramsArray: paramsArray,
                            hookDataArray: hookDataArray
                        })
                    )
                })
            )
        );

        deltas = abi.decode(result, (BalanceDelta[]));

        // Return any remaining ETH
        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            CurrencyLibrary.ADDRESS_ZERO.transfer(msg.sender, ethBalance);
        }
    }

    /// @notice Convenience function for placing a limit order through the hook
    function placeLimitOrder(
        PoolKey memory key,
        int24 tick,
        uint256 amountIn,
        bool zeroForOne,
        uint64 deadline,
        bytes memory hookData
    ) external returns (int24) {
        MegaQuantHook hook = MegaQuantHook(address(key.hooks));

        // Transfer tokens from user to this router, then approve hook
        address sellToken = zeroForOne
            ? Currency.unwrap(key.currency0)
            : Currency.unwrap(key.currency1);

        // Transfer from user to router
        IERC20Minimal(sellToken).transferFrom(msg.sender, address(this), amountIn);

        // Approve hook to spend
        IERC20Minimal(sellToken).approve(address(hook), amountIn);

        // Place the order using a low-level call since placeOrder takes calldata key
        (bool success, bytes memory returnData) = address(hook).call(
            abi.encodeWithSelector(
                MegaQuantHook.placeOrder.selector,
                key,
                tick,
                zeroForOne,
                amountIn,
                deadline
            )
        );
        require(success, "placeOrder failed");

        // Decode the returned tick
        int24 actualTick = abi.decode(returnData, (int24));

        // Transfer ERC1155 claim tokens to the user
        // Compute orderId the same way the hook does
        uint256 orderId = uint256(keccak256(abi.encode(key.toId(), actualTick, zeroForOne)));
        uint256 claimBalance = hook.balanceOf(address(this), orderId);
        if (claimBalance > 0) {
            hook.safeTransferFrom(address(this), msg.sender, orderId, claimBalance, "");
        }

        return actualTick;
    }

    /// @notice Convenience function for placing a stop order through the hook
    function placeStopOrder(
        PoolKey memory key,
        int24 tick,
        uint256 amountIn,
        bool zeroForOne,
        uint64 deadline,
        bytes memory /* hookData */
    ) external returns (int24) {
        MegaQuantHook hook = MegaQuantHook(address(key.hooks));

        address sellToken = zeroForOne
            ? Currency.unwrap(key.currency0)
            : Currency.unwrap(key.currency1);

        IERC20Minimal(sellToken).transferFrom(msg.sender, address(this), amountIn);
        IERC20Minimal(sellToken).approve(address(hook), amountIn);

        (bool success, bytes memory returnData) = address(hook).call(
            abi.encodeWithSelector(
                MegaQuantHook.placeStopOrder.selector,
                key,
                tick,
                zeroForOne,
                amountIn,
                deadline
            )
        );
        require(success, "placeStopOrder failed");

        int24 actualTick = abi.decode(returnData, (int24));

        // Transfer ERC1155 claim tokens to the user
        uint256 orderId = uint256(keccak256(abi.encode("STOP", key.toId(), actualTick, zeroForOne)));
        uint256 claimBalance = hook.balanceOf(address(this), orderId);
        if (claimBalance > 0) {
            hook.safeTransferFrom(address(this), msg.sender, orderId, claimBalance, "");
        }

        return actualTick;
    }

    /// @notice Place a bracket (OCO) order — limit + stop in one call
    function placeBracketOrder(
        PoolKey memory key,
        int24 limitTick,
        int24 stopTick,
        bool zeroForOne,
        uint256 amountIn,
        uint64 deadline
    ) external returns (int24 actualLimitTick, int24 actualStopTick) {
        MegaQuantHook hook = MegaQuantHook(address(key.hooks));

        address sellToken = zeroForOne
            ? Currency.unwrap(key.currency0)
            : Currency.unwrap(key.currency1);

        // Transfer 2x amount (one for limit, one for stop)
        uint256 totalAmount = amountIn * 2;
        IERC20Minimal(sellToken).transferFrom(msg.sender, address(this), totalAmount);
        IERC20Minimal(sellToken).approve(address(hook), totalAmount);

        // Place limit order
        {
            (bool success, bytes memory returnData) = address(hook).call(
                abi.encodeWithSelector(
                    MegaQuantHook.placeOrder.selector,
                    key,
                    limitTick,
                    zeroForOne,
                    amountIn,
                    deadline
                )
            );
            require(success, "placeLimitOrder failed");
            actualLimitTick = abi.decode(returnData, (int24));
        }

        // Place stop order
        {
            (bool success, bytes memory returnData) = address(hook).call(
                abi.encodeWithSelector(
                    MegaQuantHook.placeStopOrder.selector,
                    key,
                    stopTick,
                    zeroForOne,
                    amountIn,
                    deadline
                )
            );
            require(success, "placeStopOrder failed");
            actualStopTick = abi.decode(returnData, (int24));
        }

        // Link as bracket partners
        uint256 limitOrderId = uint256(keccak256(abi.encode(key.toId(), actualLimitTick, zeroForOne)));
        uint256 stopOrderId = uint256(keccak256(abi.encode("STOP", key.toId(), actualStopTick, zeroForOne)));
        hook.setBracketPartner(limitOrderId, stopOrderId);

        // Transfer ERC1155 claim tokens to the user
        uint256 limitBalance = hook.balanceOf(address(this), limitOrderId);
        if (limitBalance > 0) {
            hook.safeTransferFrom(address(this), msg.sender, limitOrderId, limitBalance, "");
        }
        uint256 stopBalance = hook.balanceOf(address(this), stopOrderId);
        if (stopBalance > 0) {
            hook.safeTransferFrom(address(this), msg.sender, stopOrderId, stopBalance, "");
        }
    }

    function unlockCallback(
        bytes calldata rawData
    ) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert CallerNotManager();

        CallbackData memory cbData = abi.decode(rawData, (CallbackData));

        if (cbData.action == ACTION_SWAP) {
            return _handleSwap(cbData.data);
        } else if (cbData.action == ACTION_BATCH_SWAP) {
            return _handleBatchSwap(cbData.data);
        }

        revert("Unknown action");
    }

    function _handleSwap(bytes memory data) internal returns (bytes memory) {
        SwapCallbackData memory swapData = abi.decode(data, (SwapCallbackData));

        // Store the original sender in transient storage
        address sender = swapData.sender;
        assembly {
            tstore(MSG_SENDER_SLOT, sender)
        }

        BalanceDelta delta = manager.swap(swapData.key, swapData.params, swapData.hookData);

        _settleBalances(swapData.sender, swapData.key, delta);

        return abi.encode(delta);
    }

    function _handleBatchSwap(bytes memory data) internal returns (bytes memory) {
        BatchSwapCallbackData memory batchData = abi.decode(data, (BatchSwapCallbackData));

        // Store the original sender in transient storage
        address sender = batchData.sender;
        assembly {
            tstore(MSG_SENDER_SLOT, sender)
        }

        BalanceDelta[] memory deltas = new BalanceDelta[](batchData.keys.length);

        for (uint256 i = 0; i < batchData.keys.length; i++) {
            deltas[i] = manager.swap(
                batchData.keys[i],
                batchData.paramsArray[i],
                batchData.hookDataArray[i]
            );
            _settleBalances(batchData.sender, batchData.keys[i], deltas[i]);
        }

        return abi.encode(deltas);
    }

    function _settleBalances(
        address sender,
        PoolKey memory key,
        BalanceDelta delta
    ) internal {
        int256 delta0 = delta.amount0();
        if (delta0 < 0) {
            key.currency0.settle(manager, sender, uint256(-delta0), false);
        } else if (delta0 > 0) {
            key.currency0.take(manager, sender, uint256(delta0), false);
        }

        int256 delta1 = delta.amount1();
        if (delta1 < 0) {
            key.currency1.settle(manager, sender, uint256(-delta1), false);
        } else if (delta1 > 0) {
            key.currency1.take(manager, sender, uint256(delta1), false);
        }
    }

    /// @notice Required to receive ERC1155 tokens
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    receive() external payable {}
}
