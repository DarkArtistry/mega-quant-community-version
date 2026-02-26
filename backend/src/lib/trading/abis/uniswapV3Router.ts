// Uniswap V3 SwapRouter ABI
// Supports both SwapRouter V1 (with deadline) and V2 (without deadline)

export const UNISWAP_V3_ROUTER_ABI = [
  // SwapRouter V1 (with deadline) - Ethereum Mainnet, Sepolia
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' }
        ],
        name: 'params',
        type: 'tuple'
      }
    ],
    name: 'exactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountOut', type: 'uint256' },
          { name: 'amountInMaximum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' }
        ],
        name: 'params',
        type: 'tuple'
      }
    ],
    name: 'exactOutputSingle',
    outputs: [{ name: 'amountIn', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function'
  }
] as const
