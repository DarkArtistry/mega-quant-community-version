// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title VolatilityMath
/// @notice Library for EWMA-based volatility calculations used in dynamic fee pricing
library VolatilityMath {
    /// @notice Updates the EWMA variance given a new tick observation
    /// @param currentVariance The current EWMA variance value
    /// @param lastTick The previous tick observation
    /// @param currentTick The new tick observation
    /// @param alpha The smoothing factor in basis points (e.g. 2000 = 20%)
    /// @return The updated EWMA variance
    function updateEWMA(
        uint256 currentVariance,
        int24 lastTick,
        int24 currentTick,
        uint256 alpha
    ) internal pure returns (uint256) {
        // Calculate the squared tick difference as the instantaneous variance proxy
        int256 tickDelta = int256(currentTick) - int256(lastTick);
        uint256 squaredDelta = uint256(tickDelta * tickDelta);

        // EWMA formula: newVariance = alpha * squaredDelta + (1 - alpha) * currentVariance
        // alpha is in basis points (10000 = 100%)
        uint256 newVariance = (alpha * squaredDelta + (10000 - alpha) * currentVariance) / 10000;

        return newVariance;
    }

    /// @notice Calculates the dynamic fee based on the current variance
    /// @param variance The current EWMA variance
    /// @param minFee The minimum fee in hundredths of a bip
    /// @param maxFee The maximum fee in hundredths of a bip
    /// @param baseFee The base fee used when variance is between thresholds
    /// @param lowThreshold Below this variance, fee equals minFee
    /// @param highThreshold Above this variance, fee equals maxFee
    /// @return fee The calculated fee in hundredths of a bip
    function calculateFee(
        uint256 variance,
        uint256 minFee,
        uint256 maxFee,
        uint256 baseFee,
        uint256 lowThreshold,
        uint256 highThreshold
    ) internal pure returns (uint24 fee) {
        // If variance is below the low threshold, return minimum fee
        if (variance <= lowThreshold) {
            return uint24(minFee);
        }

        // If variance is above the high threshold, return maximum fee
        if (variance >= highThreshold) {
            return uint24(maxFee);
        }

        // Linear interpolation between minFee and maxFee based on where variance
        // falls between lowThreshold and highThreshold
        uint256 range = highThreshold - lowThreshold;
        uint256 feeRange = maxFee - minFee;
        uint256 position = variance - lowThreshold;

        fee = uint24(minFee + (position * feeRange) / range);

        // Sanity clamp (should not be needed due to logic above, but defensive)
        if (fee < uint24(minFee)) fee = uint24(minFee);
        if (fee > uint24(maxFee)) fee = uint24(maxFee);
    }
}
