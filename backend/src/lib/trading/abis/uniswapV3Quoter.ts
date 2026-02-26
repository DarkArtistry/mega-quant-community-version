// Uniswap V3 Quoter ABI
// For getting price quotes before executing swaps

export const UNISWAP_V3_QUOTER_ABI = [
  {
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' }
    ],
    name: 'quoteExactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' }
    ],
    name: 'quoteExactOutputSingle',
    outputs: [{ name: 'amountIn', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const
