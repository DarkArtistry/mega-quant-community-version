// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

import {VolatilityMath} from "./libraries/VolatilityMath.sol";

contract MegaQuantHook is BaseHook, ERC1155, ReentrancyGuard {
    using StateLibrary for IPoolManager;
    using LPFeeLibrary for uint24;
    using FixedPointMathLib for uint256;
    using SafeERC20 for IERC20;

    // ========== Errors ==========
    error MustUseDynamicFee();
    error InvalidOrder();
    error NothingToClaim();
    error NotEnoughToClaim();
    error OrderExpired();
    error NoBracketPartner();

    // ========== Events ==========
    event OrderPlaced(
        address indexed trader,
        PoolId indexed poolId,
        int24 tick,
        bool zeroForOne,
        uint256 amount,
        uint64 deadline
    );
    event OrderExecuted(
        PoolId indexed poolId,
        int24 tick,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut
    );
    event OrderCancelled(
        address indexed trader,
        PoolId indexed poolId,
        int24 tick,
        bool zeroForOne,
        uint256 amount
    );
    event StopOrderPlaced(
        address indexed trader,
        PoolId indexed poolId,
        int24 tick,
        bool zeroForOne,
        uint256 amount,
        uint64 deadline
    );
    event StopOrderExecuted(
        PoolId indexed poolId,
        int24 tick,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut
    );
    event StopOrderCancelled(
        address indexed trader,
        PoolId indexed poolId,
        int24 tick,
        bool zeroForOne,
        uint256 amount
    );
    event BracketPartnerCancelled(
        uint256 indexed cancelledOrderId,
        uint256 indexed partnerOrderId
    );

    // ========== Volatility Fee Constants ==========
    uint24 public constant BASE_FEE = 3000; // 0.3%
    uint24 public constant MIN_FEE = 500; // 0.05%
    uint24 public constant MAX_FEE = 10000; // 1.0%
    uint256 public constant EWMA_ALPHA = 2000; // 20% in basis points
    uint256 public constant STALE_THRESHOLD = 1 hours;
    uint256 public constant LOW_VARIANCE_THRESHOLD = 10;
    uint256 public constant HIGH_VARIANCE_THRESHOLD = 1000;

    // ========== Limit Order Constants ==========
    uint256 public constant MAX_EXECUTIONS_PER_SWAP = 5;

    // ========== Volatility Fee State ==========
    struct VolatilityState {
        int24 lastTick;
        uint256 lastTimestamp;
        uint256 ewmaVariance;
        uint256 observationCount;
    }

    mapping(PoolId => VolatilityState) public volatilityStates;

    // ========== Limit Order State ==========
    mapping(PoolId => mapping(int24 => mapping(bool => uint256))) public pendingOrders;
    mapping(uint256 => uint256) public claimableOutputTokens;
    mapping(uint256 => uint256) public claimTokensSupply;
    mapping(uint256 => uint64) public orderDeadlines;
    mapping(PoolId => int24) public lastTicks;

    // ========== Stop Order State ==========
    mapping(PoolId => mapping(int24 => mapping(bool => uint256))) public pendingStopOrders;
    mapping(uint256 => uint256) public stopClaimableOutputTokens;
    mapping(uint256 => uint256) public stopClaimTokensSupply;
    mapping(uint256 => uint64) public stopOrderDeadlines;

    // ========== Bracket (OCO) State ==========
    /// @notice Maps an orderId to its bracket partner orderId. If one fills, the partner is cancelled.
    mapping(uint256 => uint256) public bracketPartner;

    // ========== Constructor ==========
    constructor(
        IPoolManager _manager,
        string memory _uri
    ) BaseHook(_manager) ERC1155(_uri) {}

    // ========== Hook Permissions ==========
    function getHookPermissions()
        public
        pure
        override
        returns (Hooks.Permissions memory)
    {
        return
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: true,
                beforeAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterAddLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            });
    }

    // ========== Hook Implementations ==========

    function _beforeInitialize(
        address,
        PoolKey calldata key,
        uint160
    ) internal pure override returns (bytes4) {
        if (!key.fee.isDynamicFee()) revert MustUseDynamicFee();
        return this.beforeInitialize.selector;
    }

    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24 tick
    ) internal override returns (bytes4) {
        PoolId poolId = key.toId();
        lastTicks[poolId] = tick;
        volatilityStates[poolId] = VolatilityState({
            lastTick: tick,
            lastTimestamp: block.timestamp,
            ewmaVariance: 0,
            observationCount: 0
        });
        return this.afterInitialize.selector;
    }

    function _beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata,
        bytes calldata
    ) internal view override returns (bytes4, BeforeSwapDelta, uint24) {
        uint24 fee = getPoolFee(key.toId());
        uint24 feeWithFlag = fee | LPFeeLibrary.OVERRIDE_FEE_FLAG;
        return (
            this.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            feeWithFlag
        );
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        PoolId poolId = key.toId();

        // Update EWMA variance based on tick movement
        (, int24 currentTick,,) = poolManager.getSlot0(poolId);
        _updateVolatility(poolId, currentTick);

        // Skip limit order execution if the sender is this hook (to avoid recursion)
        if (sender == address(this)) {
            lastTicks[poolId] = currentTick;
            return (this.afterSwap.selector, 0);
        }

        // Try to execute triggered limit orders
        uint256 executions = 0;
        bool tryMore = true;

        while (tryMore && executions < MAX_EXECUTIONS_PER_SWAP) {
            (tryMore, currentTick) = _tryExecutingOrders(key, !params.zeroForOne);
            if (tryMore) {
                executions++;
            }
        }

        // Try to execute triggered stop orders
        // Stop orders trigger in the SAME direction as the swap (not opposite like limits)
        // e.g., price dropping triggers sell stop-losses
        tryMore = true;
        while (tryMore && executions < MAX_EXECUTIONS_PER_SWAP) {
            (tryMore, currentTick) = _tryExecutingStopOrders(key, params.zeroForOne);
            if (tryMore) {
                executions++;
            }
        }

        lastTicks[poolId] = currentTick;
        return (this.afterSwap.selector, 0);
    }

    // ========== Volatility Fee Functions ==========

    /// @notice Get the dynamic fee for a specific pool
    function getPoolFee(PoolId poolId) public view returns (uint24) {
        VolatilityState memory state = volatilityStates[poolId];

        // If no observations yet, return base fee
        if (state.observationCount == 0) {
            return BASE_FEE;
        }

        // If the last observation is stale, reset to base fee
        if (block.timestamp - state.lastTimestamp > STALE_THRESHOLD) {
            return BASE_FEE;
        }

        return VolatilityMath.calculateFee(
            state.ewmaVariance,
            MIN_FEE,
            MAX_FEE,
            BASE_FEE,
            LOW_VARIANCE_THRESHOLD,
            HIGH_VARIANCE_THRESHOLD
        );
    }

    function _updateVolatility(PoolId poolId, int24 currentTick) internal {
        VolatilityState storage state = volatilityStates[poolId];

        // If the observation is stale, reset variance but keep lastTick for next delta
        if (state.lastTimestamp > 0 && block.timestamp - state.lastTimestamp > STALE_THRESHOLD) {
            state.ewmaVariance = 0;
            state.observationCount = 0;
        }

        // Update EWMA variance whenever we have a valid lastTick reference
        // (afterInitialize sets lastTick, so first swap can compute delta)
        if (state.lastTimestamp > 0) {
            state.ewmaVariance = VolatilityMath.updateEWMA(
                state.ewmaVariance,
                state.lastTick,
                currentTick,
                EWMA_ALPHA
            );
        }

        state.lastTick = currentTick;
        state.lastTimestamp = block.timestamp;
        state.observationCount++;
    }

    // ========== Limit Order Functions ==========

    function getLowerUsableTick(
        int24 tick,
        int24 tickSpacing
    ) private pure returns (int24) {
        int24 intervals = tick / tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) intervals--;
        return intervals * tickSpacing;
    }

    function getOrderId(
        PoolKey calldata key,
        int24 tick,
        bool zeroForOne
    ) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(key.toId(), tick, zeroForOne)));
    }

    function placeOrder(
        PoolKey calldata key,
        int24 tickToSellAt,
        bool zeroForOne,
        uint256 inputAmount,
        uint64 deadline
    ) external nonReentrant returns (int24) {
        int24 tick = getLowerUsableTick(tickToSellAt, key.tickSpacing);
        PoolId poolId = key.toId();

        pendingOrders[poolId][tick][zeroForOne] += inputAmount;

        uint256 orderId = getOrderId(key, tick, zeroForOne);
        claimTokensSupply[orderId] += inputAmount;

        if (deadline > 0) {
            orderDeadlines[orderId] = deadline;
        }

        _mint(msg.sender, orderId, inputAmount, "");

        address sellToken = zeroForOne
            ? Currency.unwrap(key.currency0)
            : Currency.unwrap(key.currency1);
        IERC20(sellToken).safeTransferFrom(msg.sender, address(this), inputAmount);

        emit OrderPlaced(msg.sender, poolId, tick, zeroForOne, inputAmount, deadline);

        return tick;
    }

    function cancelOrder(
        PoolKey calldata key,
        int24 tickToSellAt,
        bool zeroForOne
    ) external nonReentrant {
        int24 tick = getLowerUsableTick(tickToSellAt, key.tickSpacing);
        uint256 orderId = getOrderId(key, tick, zeroForOne);

        uint256 positionTokens = balanceOf(msg.sender, orderId);
        if (positionTokens == 0) revert InvalidOrder();

        PoolId poolId = key.toId();

        pendingOrders[poolId][tick][zeroForOne] -= positionTokens;
        claimTokensSupply[orderId] -= positionTokens;
        _burn(msg.sender, orderId, positionTokens);

        Currency token = zeroForOne ? key.currency0 : key.currency1;
        token.transfer(msg.sender, positionTokens);

        emit OrderCancelled(msg.sender, poolId, tick, zeroForOne, positionTokens);
    }

    function redeem(
        PoolKey calldata key,
        int24 tickToSellAt,
        bool zeroForOne,
        uint256 inputAmountToClaimFor
    ) external nonReentrant {
        int24 tick = getLowerUsableTick(tickToSellAt, key.tickSpacing);
        uint256 orderId = getOrderId(key, tick, zeroForOne);

        if (claimableOutputTokens[orderId] == 0) revert NothingToClaim();

        uint256 claimTokens = balanceOf(msg.sender, orderId);
        if (claimTokens < inputAmountToClaimFor) revert NotEnoughToClaim();

        uint256 totalClaimableForPosition = claimableOutputTokens[orderId];
        uint256 totalInputAmountForPosition = claimTokensSupply[orderId];

        uint256 outputAmount = inputAmountToClaimFor.mulDivDown(
            totalClaimableForPosition,
            totalInputAmountForPosition
        );

        claimableOutputTokens[orderId] -= outputAmount;
        claimTokensSupply[orderId] -= inputAmountToClaimFor;
        _burn(msg.sender, orderId, inputAmountToClaimFor);

        Currency token = zeroForOne ? key.currency1 : key.currency0;
        token.transfer(msg.sender, outputAmount);
    }

    // ========== Stop Order Functions ==========

    function getStopOrderId(
        PoolKey calldata key,
        int24 tick,
        bool zeroForOne
    ) public pure returns (uint256) {
        return uint256(keccak256(abi.encode("STOP", key.toId(), tick, zeroForOne)));
    }

    function placeStopOrder(
        PoolKey calldata key,
        int24 tickToSellAt,
        bool zeroForOne,
        uint256 inputAmount,
        uint64 deadline
    ) external nonReentrant returns (int24) {
        int24 tick = getLowerUsableTick(tickToSellAt, key.tickSpacing);
        PoolId poolId = key.toId();

        pendingStopOrders[poolId][tick][zeroForOne] += inputAmount;

        uint256 orderId = getStopOrderId(key, tick, zeroForOne);
        stopClaimTokensSupply[orderId] += inputAmount;

        if (deadline > 0) {
            stopOrderDeadlines[orderId] = deadline;
        }

        _mint(msg.sender, orderId, inputAmount, "");

        address sellToken = zeroForOne
            ? Currency.unwrap(key.currency0)
            : Currency.unwrap(key.currency1);
        IERC20(sellToken).safeTransferFrom(msg.sender, address(this), inputAmount);

        emit StopOrderPlaced(msg.sender, poolId, tick, zeroForOne, inputAmount, deadline);

        return tick;
    }

    function cancelStopOrder(
        PoolKey calldata key,
        int24 tickToSellAt,
        bool zeroForOne
    ) external nonReentrant {
        int24 tick = getLowerUsableTick(tickToSellAt, key.tickSpacing);
        uint256 orderId = getStopOrderId(key, tick, zeroForOne);

        uint256 positionTokens = balanceOf(msg.sender, orderId);
        if (positionTokens == 0) revert InvalidOrder();

        PoolId poolId = key.toId();

        pendingStopOrders[poolId][tick][zeroForOne] -= positionTokens;
        stopClaimTokensSupply[orderId] -= positionTokens;
        _burn(msg.sender, orderId, positionTokens);

        Currency token = zeroForOne ? key.currency0 : key.currency1;
        token.transfer(msg.sender, positionTokens);

        emit StopOrderCancelled(msg.sender, poolId, tick, zeroForOne, positionTokens);
    }

    function redeemStopOrder(
        PoolKey calldata key,
        int24 tickToSellAt,
        bool zeroForOne,
        uint256 inputAmountToClaimFor
    ) external nonReentrant {
        int24 tick = getLowerUsableTick(tickToSellAt, key.tickSpacing);
        uint256 orderId = getStopOrderId(key, tick, zeroForOne);

        if (stopClaimableOutputTokens[orderId] == 0) revert NothingToClaim();

        uint256 claimTokens = balanceOf(msg.sender, orderId);
        if (claimTokens < inputAmountToClaimFor) revert NotEnoughToClaim();

        uint256 totalClaimableForPosition = stopClaimableOutputTokens[orderId];
        uint256 totalInputAmountForPosition = stopClaimTokensSupply[orderId];

        uint256 outputAmount = inputAmountToClaimFor.mulDivDown(
            totalClaimableForPosition,
            totalInputAmountForPosition
        );

        stopClaimableOutputTokens[orderId] -= outputAmount;
        stopClaimTokensSupply[orderId] -= inputAmountToClaimFor;
        _burn(msg.sender, orderId, inputAmountToClaimFor);

        Currency token = zeroForOne ? key.currency1 : key.currency0;
        token.transfer(msg.sender, outputAmount);
    }

    // ========== Bracket (OCO) Functions ==========

    /// @notice Link two orders as bracket partners (called by MegaQuantRouter)
    function setBracketPartner(uint256 orderId, uint256 partnerId) external {
        // Only the router should call this, but we allow anyone for composability
        bracketPartner[orderId] = partnerId;
        bracketPartner[partnerId] = orderId;
    }

    /// @notice Get the volatility state for a pool
    function getVolatilityState(PoolId poolId)
        external
        view
        returns (int24 lastTick, uint256 lastTimestamp, uint256 ewmaVariance, uint256 observationCount)
    {
        VolatilityState memory state = volatilityStates[poolId];
        return (state.lastTick, state.lastTimestamp, state.ewmaVariance, state.observationCount);
    }

    // ========== Limit Order Execution ==========

    function _tryExecutingOrders(
        PoolKey calldata key,
        bool executeZeroForOne
    ) internal returns (bool tryMore, int24 newTick) {
        (, int24 currentTick,,) = poolManager.getSlot0(key.toId());
        int24 lastTick_ = lastTicks[key.toId()];

        // Align iteration start to tick spacing boundaries
        int24 spacing = key.tickSpacing;

        if (currentTick > lastTick_) {
            // Tick moved up: iterate aligned ticks between lastTick and currentTick
            int24 startTick = getLowerUsableTick(lastTick_, spacing);
            for (
                int24 tick = startTick;
                tick < currentTick;
                tick += spacing
            ) {
                uint256 inputAmount = pendingOrders[key.toId()][tick][executeZeroForOne];
                if (inputAmount > 0) {
                    _executeOrder(key, tick, executeZeroForOne, inputAmount);
                    return (true, currentTick);
                }
            }
        } else if (currentTick < lastTick_) {
            // Tick moved down: iterate aligned ticks between currentTick and lastTick
            int24 startTick = getLowerUsableTick(lastTick_, spacing) + spacing;
            for (
                int24 tick = startTick;
                tick > currentTick;
                tick -= spacing
            ) {
                uint256 inputAmount = pendingOrders[key.toId()][tick][executeZeroForOne];
                if (inputAmount > 0) {
                    _executeOrder(key, tick, executeZeroForOne, inputAmount);
                    return (true, currentTick);
                }
            }
        }

        return (false, currentTick);
    }

    function _computeOrderId(PoolId poolId, int24 tick, bool zeroForOne) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(poolId, tick, zeroForOne)));
    }

    function _executeOrder(
        PoolKey calldata key,
        int24 tick,
        bool zeroForOne,
        uint256 inputAmount
    ) internal {
        BalanceDelta delta = _swapAndSettleBalances(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(inputAmount),
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            })
        );

        pendingOrders[key.toId()][tick][zeroForOne] -= inputAmount;
        uint256 orderId = _computeOrderId(key.toId(), tick, zeroForOne);
        uint256 outputAmount = zeroForOne
            ? uint256(int256(delta.amount1()))
            : uint256(int256(delta.amount0()));

        claimableOutputTokens[orderId] += outputAmount;

        emit OrderExecuted(key.toId(), tick, zeroForOne, inputAmount, outputAmount);

        // Handle bracket partner cancellation
        _cancelBracketPartner(orderId);
    }

    // ========== Stop Order Execution ==========

    function _tryExecutingStopOrders(
        PoolKey calldata key,
        bool executeZeroForOne
    ) internal returns (bool tryMore, int24 newTick) {
        (, int24 currentTick,,) = poolManager.getSlot0(key.toId());
        int24 lastTick_ = lastTicks[key.toId()];

        int24 spacing = key.tickSpacing;

        // Stop orders trigger when price moves THROUGH the tick
        // For zeroForOne stops (sell stops): trigger when tick drops below stop tick
        if (currentTick < lastTick_) {
            int24 startTick = getLowerUsableTick(lastTick_, spacing);
            for (
                int24 tick = startTick;
                tick > currentTick;
                tick -= spacing
            ) {
                uint256 inputAmount = pendingStopOrders[key.toId()][tick][executeZeroForOne];
                if (inputAmount > 0) {
                    _executeStopOrder(key, tick, executeZeroForOne, inputAmount);
                    return (true, currentTick);
                }
            }
        } else if (currentTick > lastTick_) {
            int24 startTick = getLowerUsableTick(lastTick_, spacing);
            for (
                int24 tick = startTick;
                tick < currentTick;
                tick += spacing
            ) {
                uint256 inputAmount = pendingStopOrders[key.toId()][tick][!executeZeroForOne];
                if (inputAmount > 0) {
                    _executeStopOrder(key, tick, !executeZeroForOne, inputAmount);
                    return (true, currentTick);
                }
            }
        }

        return (false, currentTick);
    }

    function _computeStopOrderId(PoolId poolId, int24 tick, bool zeroForOne) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode("STOP", poolId, tick, zeroForOne)));
    }

    function _executeStopOrder(
        PoolKey calldata key,
        int24 tick,
        bool zeroForOne,
        uint256 inputAmount
    ) internal {
        BalanceDelta delta = _swapAndSettleBalances(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(inputAmount),
                sqrtPriceLimitX96: zeroForOne
                    ? TickMath.MIN_SQRT_PRICE + 1
                    : TickMath.MAX_SQRT_PRICE - 1
            })
        );

        pendingStopOrders[key.toId()][tick][zeroForOne] -= inputAmount;
        uint256 orderId = _computeStopOrderId(key.toId(), tick, zeroForOne);
        uint256 outputAmount = zeroForOne
            ? uint256(int256(delta.amount1()))
            : uint256(int256(delta.amount0()));

        stopClaimableOutputTokens[orderId] += outputAmount;

        emit StopOrderExecuted(key.toId(), tick, zeroForOne, inputAmount, outputAmount);

        // Handle bracket partner cancellation
        _cancelBracketPartner(orderId);
    }

    /// @notice If this order has a bracket partner, cancel the partner
    function _cancelBracketPartner(uint256 filledOrderId) internal {
        uint256 partnerId = bracketPartner[filledOrderId];
        if (partnerId == 0) return;

        // Clear the bracket link
        bracketPartner[filledOrderId] = 0;
        bracketPartner[partnerId] = 0;

        emit BracketPartnerCancelled(filledOrderId, partnerId);
        // Note: The partner's tokens remain claimable by the user via cancel.
        // The frontend/backend should detect this event and update UI.
    }

    function _swapAndSettleBalances(
        PoolKey calldata key,
        SwapParams memory params
    ) internal returns (BalanceDelta) {
        BalanceDelta delta = poolManager.swap(key, params, "");

        if (params.zeroForOne) {
            if (delta.amount0() < 0) {
                _settle(key.currency0, uint128(-delta.amount0()));
            }
            if (delta.amount1() > 0) {
                _take(key.currency1, uint128(delta.amount1()));
            }
        } else {
            if (delta.amount1() < 0) {
                _settle(key.currency1, uint128(-delta.amount1()));
            }
            if (delta.amount0() > 0) {
                _take(key.currency0, uint128(delta.amount0()));
            }
        }

        return delta;
    }

    function _settle(Currency currency, uint128 amount) internal {
        poolManager.sync(currency);
        currency.transfer(address(poolManager), amount);
        poolManager.settle();
    }

    function _take(Currency currency, uint128 amount) internal {
        poolManager.take(currency, address(this), amount);
    }

    // ========== View Helpers ==========

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override
        returns (bool)
    {
        return ERC1155.supportsInterface(interfaceId);
    }
}
