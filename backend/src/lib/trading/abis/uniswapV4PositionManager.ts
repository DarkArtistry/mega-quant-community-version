// Minimal ABI for Uniswap V4 PositionManager (modifyLiquidities + nextTokenId)

export const POSITION_MANAGER_ACTIONS = {
  INCREASE_LIQUIDITY: 0,
  DECREASE_LIQUIDITY: 1,
  MINT_POSITION: 2,
  BURN_POSITION: 3,
  SETTLE: 11,
  SETTLE_PAIR: 13,
  TAKE: 14,
  CLOSE_CURRENCY: 18,
  SWEEP: 20,
} as const

export const UNISWAP_V4_POSITION_MANAGER_ABI = [
  {
    name: 'modifyLiquidities',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'unlockData', type: 'bytes' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'nextTokenId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
