// Uniswap V4 PoolManager ABI
// Source: https://github.com/Uniswap/v4-core

export const UNISWAP_V4_POOL_MANAGER_ABI = [
  // Unlock function - required for all pool operations
  {
    inputs: [{ internalType: 'bytes', name: 'data', type: 'bytes' }],
    name: 'unlock',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Swap function
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
    name: 'swap',
    outputs: [
      {
        components: [
          { internalType: 'int128', name: 'amount0', type: 'int128' },
          { internalType: 'int128', name: 'amount1', type: 'int128' }
        ],
        internalType: 'struct BalanceDelta',
        name: '',
        type: 'tuple'
      }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Initialize pool
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
      { internalType: 'uint160', name: 'sqrtPriceX96', type: 'uint160' },
      { internalType: 'bytes', name: 'hookData', type: 'bytes' }
    ],
    name: 'initialize',
    outputs: [{ internalType: 'int24', name: 'tick', type: 'int24' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Get lock data
  {
    inputs: [],
    name: 'getLock',
    outputs: [
      { internalType: 'uint128', name: 'nonzeroDeltaCount', type: 'uint128' },
      { internalType: 'address', name: 'locker', type: 'address' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const
