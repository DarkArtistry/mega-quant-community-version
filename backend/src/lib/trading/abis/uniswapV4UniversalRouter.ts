// Uniswap V4 Universal Router ABI
// The Universal Router is the standard way to interact with V4 pools

export const UNISWAP_V4_UNIVERSAL_ROUTER_ABI = [
  {
    inputs: [
      { internalType: 'bytes', name: 'commands', type: 'bytes' },
      { internalType: 'bytes[]', name: 'inputs', type: 'bytes[]' }
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'bytes', name: 'commands', type: 'bytes' },
      { internalType: 'bytes[]', name: 'inputs', type: 'bytes[]' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' }
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
] as const

// Universal Router Commands for V4
export const UNIVERSAL_ROUTER_COMMANDS = {
  V4_SWAP: 0x10, // Command for V4 swaps (hex value: 0x10, decimal: 16)
} as const

// V4 Router Actions
export const V4_ACTIONS = {
  SWAP_EXACT_IN_SINGLE: 6,   // Swap exact input using single pool
  SWAP_EXACT_IN: 7,           // Swap exact input (multi-hop)
  SWAP_EXACT_OUT_SINGLE: 8,   // Swap exact output using single pool
  SWAP_EXACT_OUT: 9,          // Swap exact output (multi-hop)
  SETTLE: 11,                 // Settle specific currency
  SETTLE_ALL: 12,             // Settle all tokens
  SETTLE_PAIR: 13,            // Settle pair of currencies
  TAKE: 14,                   // Take specific currency
  TAKE_ALL: 15,               // Take all tokens
  TAKE_PORTION: 16,           // Take portion of tokens
  TAKE_PAIR: 17,              // Take pair of currencies
  CLOSE_CURRENCY: 18,         // Close currency balance
  SWEEP: 20                   // Sweep remaining balance
} as const
