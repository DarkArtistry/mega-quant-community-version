/**
 * Chainlink Oracle
 * Reads Chainlink price feeds on-chain for major trading pairs on Ethereum mainnet.
 * Uses ethers v6 Contract to call latestRoundData() on Chainlink Aggregator contracts.
 */

import { Contract, JsonRpcProvider } from 'ethers'
import type { Provider } from 'ethers'

// --- Chainlink Aggregator ABI (minimal, only what we need) ---

const AGGREGATOR_V3_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() external view returns (uint8)',
  'function description() external view returns (string)'
]

// --- Feed Addresses (Ethereum Mainnet) ---

const FEED_ADDRESSES: Record<string, string> = {
  'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
  'USDC/USD': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
  'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c'
}

// Chainlink price feeds use 8 decimals by default
const DEFAULT_DECIMALS = 8

// --- Interfaces ---

export interface ChainlinkPriceResult {
  pair: string
  price: number
  roundId: string
  updatedAt: number
  answeredInRound: string
}

// --- ChainlinkOracle Class ---

export class ChainlinkOracle {
  private provider: Provider
  private contracts: Map<string, Contract> = new Map()

  constructor(provider: Provider) {
    this.provider = provider

    // Pre-instantiate contracts for all known feeds
    for (const [pair, address] of Object.entries(FEED_ADDRESSES)) {
      this.contracts.set(pair, new Contract(address, AGGREGATOR_V3_ABI, this.provider))
    }
  }

  /**
   * Get the USD price for a supported pair.
   * Returns the price with proper decimal handling (Chainlink uses 8 decimals).
   *
   * @param pair - The price pair (e.g., 'ETH/USD', 'BTC/USD')
   * @returns The USD price as a number
   */
  async getPrice(pair: string): Promise<number> {
    const normalizedPair = pair.toUpperCase()
    const contract = this.contracts.get(normalizedPair)

    if (!contract) {
      throw new Error(
        `Unsupported Chainlink pair: ${pair}. Supported pairs: ${this.getSupportedPairs().join(', ')}`
      )
    }

    try {
      const [roundId, answer, startedAt, updatedAt, answeredInRound] =
        await contract.latestRoundData()

      // answer is an int256 with 8 decimal places
      // Convert from 8 decimals to a floating point number
      const price = Number(answer) / Math.pow(10, DEFAULT_DECIMALS)

      if (price <= 0) {
        throw new Error(`Invalid price from Chainlink for ${pair}: ${price}`)
      }

      return price
    } catch (error: any) {
      console.error(`[ChainlinkOracle] Failed to fetch price for ${pair}:`, error.message)
      throw error
    }
  }

  /**
   * Get the full price data including round information.
   *
   * @param pair - The price pair (e.g., 'ETH/USD')
   * @returns Full price result with metadata
   */
  async getPriceData(pair: string): Promise<ChainlinkPriceResult> {
    const normalizedPair = pair.toUpperCase()
    const contract = this.contracts.get(normalizedPair)

    if (!contract) {
      throw new Error(
        `Unsupported Chainlink pair: ${pair}. Supported pairs: ${this.getSupportedPairs().join(', ')}`
      )
    }

    try {
      const [roundId, answer, startedAt, updatedAt, answeredInRound] =
        await contract.latestRoundData()

      const price = Number(answer) / Math.pow(10, DEFAULT_DECIMALS)

      return {
        pair: normalizedPair,
        price,
        roundId: roundId.toString(),
        updatedAt: Number(updatedAt),
        answeredInRound: answeredInRound.toString()
      }
    } catch (error: any) {
      console.error(`[ChainlinkOracle] Failed to fetch price data for ${pair}:`, error.message)
      throw error
    }
  }

  /**
   * Get the list of supported trading pairs.
   */
  getSupportedPairs(): string[] {
    return Object.keys(FEED_ADDRESSES)
  }

  /**
   * Check if a pair is supported.
   */
  isPairSupported(pair: string): boolean {
    return FEED_ADDRESSES.hasOwnProperty(pair.toUpperCase())
  }

  /**
   * Get the feed address for a pair.
   */
  getFeedAddress(pair: string): string | undefined {
    return FEED_ADDRESSES[pair.toUpperCase()]
  }
}
