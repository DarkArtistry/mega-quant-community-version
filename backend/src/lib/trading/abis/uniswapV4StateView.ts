// Uniswap V4 StateView ABI
// Used for reading pool state and getting quotes
// Source: https://github.com/Uniswap/v4-periphery

export const UNISWAP_V4_STATE_VIEW_ABI = [
  // Get quote for exact input swap
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'currency0', type: 'address' },
          { internalType: 'address', name: 'currency1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          { internalType: 'address', name: 'hooks', type: 'address' }
        ],
        internalType: 'struct PoolKey',
        name: 'key',
        type: 'tuple'
      },
      {
        components: [
          { internalType: 'bool', name: 'zeroForOne', type: 'bool' },
          { internalType: 'int256', name: 'amountSpecified', type: 'int256' },
          { internalType: 'uint160', name: 'sqrtPriceLimitX96', type: 'uint160' }
        ],
        internalType: 'struct IPoolManager.SwapParams',
        name: 'params',
        type: 'tuple'
      },
      { internalType: 'bytes', name: 'hookData', type: 'bytes' }
    ],
    name: 'quoteExactInput',
    outputs: [
      {
        components: [
          { internalType: 'int128', name: 'amount0', type: 'int128' },
          { internalType: 'int128', name: 'amount1', type: 'int128' }
        ],
        internalType: 'struct BalanceDelta',
        name: 'delta',
        type: 'tuple'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  // Get pool slot0
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'currency0', type: 'address' },
          { internalType: 'address', name: 'currency1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          { internalType: 'address', name: 'hooks', type: 'address' }
        ],
        internalType: 'struct PoolKey',
        name: 'key',
        type: 'tuple'
      }
    ],
    name: 'getSlot0',
    outputs: [
      { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
      { internalType: 'int24', name: 'tick', type: 'int24' },
      { internalType: 'uint24', name: 'protocolFee', type: 'uint24' },
      { internalType: 'uint24', name: 'lpFee', type: 'uint24' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  // Get pool liquidity
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'currency0', type: 'address' },
          { internalType: 'address', name: 'currency1', type: 'address' },
          { internalType: 'uint24', name: 'fee', type: 'uint24' },
          { internalType: 'int24', name: 'tickSpacing', type: 'int24' },
          { internalType: 'address', name: 'hooks', type: 'address' }
        ],
        internalType: 'struct PoolKey',
        name: 'key',
        type: 'tuple'
      }
    ],
    name: 'getLiquidity',
    outputs: [{ internalType: 'uint128', name: 'liquidity', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const
