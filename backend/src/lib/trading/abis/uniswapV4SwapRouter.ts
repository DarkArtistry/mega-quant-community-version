// ABI for our custom Uniswap V4 SwapRouter contract
// This router implements IUnlockCallback to enable swaps on V4

export const UNISWAP_V4_SWAP_ROUTER_ABI = [
  {
    inputs: [{ internalType: 'address', name: '_poolManager', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'constructor'
  },
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
        internalType: 'struct IPoolManager.PoolKey',
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
    name: 'executeSwap',
    outputs: [
      { internalType: 'int128', name: 'amount0Delta', type: 'int128' },
      { internalType: 'int128', name: 'amount1Delta', type: 'int128' }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'bytes', name: 'data', type: 'bytes' }],
    name: 'unlockCallback',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'poolManager',
    outputs: [{ internalType: 'contract IPoolManager', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'recoverToken',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'sender', type: 'address' },
      { indexed: true, internalType: 'address', name: 'tokenIn', type: 'address' },
      { indexed: true, internalType: 'address', name: 'tokenOut', type: 'address' },
      { indexed: false, internalType: 'int256', name: 'amountSpecified', type: 'int256' },
      { indexed: false, internalType: 'int128', name: 'amount0Delta', type: 'int128' },
      { indexed: false, internalType: 'int128', name: 'amount1Delta', type: 'int128' }
    ],
    name: 'SwapExecuted',
    type: 'event'
  }
] as const
