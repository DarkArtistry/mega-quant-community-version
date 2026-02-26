// Permit2 Contract ABI
// Uniswap's next-generation token approvals mechanism
// Deployed at: 0x000000000022D473030F116dDEE9F6B43aC78BA3 (same address on all chains)

export const PERMIT2_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint160', name: 'amount', type: 'uint160' },
      { internalType: 'uint48', name: 'expiration', type: 'uint48' }
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' }
    ],
    name: 'allowance',
    outputs: [
      { internalType: 'uint160', name: 'amount', type: 'uint160' },
      { internalType: 'uint48', name: 'expiration', type: 'uint48' },
      { internalType: 'uint48', name: 'nonce', type: 'uint48' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
] as const

// Permit2 is deployed at the same address on all chains
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
