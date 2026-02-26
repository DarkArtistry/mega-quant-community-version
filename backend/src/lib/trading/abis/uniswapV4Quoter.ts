/**
 * Uniswap V4 Quoter ABI
 * Contract for getting swap quotes (read-only, simulates swaps)
 */

export const UNISWAP_V4_QUOTER_ABI = [
  {
    "inputs": [
      {
        "components": [
          {
            "components": [
              { "name": "currency0", "type": "address" },
              { "name": "currency1", "type": "address" },
              { "name": "fee", "type": "uint24" },
              { "name": "tickSpacing", "type": "int24" },
              { "name": "hooks", "type": "address" }
            ],
            "name": "poolKey",
            "type": "tuple"
          },
          { "name": "zeroForOne", "type": "bool" },
          { "name": "exactAmount", "type": "uint128" },
          { "name": "hookData", "type": "bytes" }
        ],
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "quoteExactInputSingle",
    "outputs": [
      { "name": "amountOut", "type": "uint256" },
      { "name": "gasEstimate", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          { "name": "currencyIn", "type": "address" },
          {
            "components": [
              {
                "components": [
                  { "name": "intermediateCurrency", "type": "address" },
                  { "name": "fee", "type": "uint24" },
                  { "name": "tickSpacing", "type": "int24" },
                  { "name": "hooks", "type": "address" },
                  { "name": "hookData", "type": "bytes" }
                ],
                "name": "pathKey",
                "type": "tuple"
              }
            ],
            "name": "path",
            "type": "tuple[]"
          },
          { "name": "exactAmount", "type": "uint128" }
        ],
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "quoteExactInput",
    "outputs": [
      { "name": "amountOut", "type": "uint256" },
      { "name": "gasEstimate", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "components": [
              { "name": "currency0", "type": "address" },
              { "name": "currency1", "type": "address" },
              { "name": "fee", "type": "uint24" },
              { "name": "tickSpacing", "type": "int24" },
              { "name": "hooks", "type": "address" }
            ],
            "name": "poolKey",
            "type": "tuple"
          },
          { "name": "zeroForOne", "type": "bool" },
          { "name": "exactAmount", "type": "uint128" },
          { "name": "hookData", "type": "bytes" }
        ],
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "quoteExactOutputSingle",
    "outputs": [
      { "name": "amountIn", "type": "uint256" },
      { "name": "gasEstimate", "type": "uint256" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const
