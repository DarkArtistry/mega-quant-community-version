/**
 * Aave Interest Tracker Service
 *
 * Periodically updates interest accrual for open lending positions
 * by reading current liquidity index from Aave V3 reserve data.
 * Runs every 5 minutes.
 */

import { getDatabase } from '../../../db/index.js'
import { lendingPnlEngine } from '../pnl/LendingPnlEngine.js'
import { Contract, JsonRpcProvider, FetchRequest, Network, formatUnits } from 'ethers'
import { AAVE_V3_ADDRESSES } from '../protocols/AaveV3Protocol.js'
import { apiKeyStore } from '../../../services/api-key-store.js'

const POOL_DATA_PROVIDER_ABI = [
  'function getReserveData(address asset) view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint40)'
]

// Alchemy network slugs for building RPC URLs
const ALCHEMY_SLUGS: Record<string, string> = {
  ethereum: 'eth-mainnet',
  base: 'base-mainnet',
  sepolia: 'eth-sepolia'
}

const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  base: 8453,
  sepolia: 11155111
}

function getProvider(chainName: string): JsonRpcProvider | null {
  const alchemyKey = apiKeyStore.getAlchemyApiKey()
  const slug = ALCHEMY_SLUGS[chainName]

  let rpcUrl: string
  if (alchemyKey && slug) {
    rpcUrl = `https://${slug}.g.alchemy.com/v2/${alchemyKey}`
  } else {
    const PUBLIC_RPCS: Record<string, string> = {
      ethereum: 'https://ethereum-rpc.publicnode.com',
      base: 'https://base-rpc.publicnode.com',
      sepolia: 'https://ethereum-sepolia-rpc.publicnode.com'
    }
    rpcUrl = PUBLIC_RPCS[chainName]
    if (!rpcUrl) return null
  }

  const fetchReq = new FetchRequest(rpcUrl)
  fetchReq.timeout = 10_000
  const network = Network.from(CHAIN_IDS[chainName])
  return new JsonRpcProvider(fetchReq, network, { staticNetwork: network })
}

export class AaveInterestTracker {
  private intervalHandle: ReturnType<typeof setInterval> | null = null
  private intervalMs: number
  private running = false

  constructor(intervalMs: number = 5 * 60 * 1000) { // Default 5 minutes
    this.intervalMs = intervalMs
  }

  start(): void {
    if (this.intervalHandle) return
    console.log(`[AaveInterestTracker] Starting with interval: ${this.intervalMs / 1000}s`)

    this.update()
    this.intervalHandle = setInterval(() => this.update(), this.intervalMs)
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
    console.log('[AaveInterestTracker] Stopped')
  }

  private async update(): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      const db = getDatabase()

      // Get all open lending positions grouped by asset and chain
      const positions = db.prepare(`
        SELECT DISTINCT asset_symbol, asset_address, chain_id, protocol
        FROM lending_positions
        WHERE status = 'open' AND initial_liquidity_index IS NOT NULL
      `).all() as any[]

      if (positions.length === 0) return

      // Group by chain for provider reuse
      const byChain = new Map<string, any[]>()
      for (const pos of positions) {
        const chainName = this.chainIdToName(pos.chain_id)
        if (!chainName) continue
        if (!byChain.has(chainName)) byChain.set(chainName, [])
        byChain.get(chainName)!.push(pos)
      }

      for (const [chainName, chainPositions] of byChain) {
        const addresses = AAVE_V3_ADDRESSES[chainName]
        if (!addresses) continue

        const provider = getProvider(chainName)
        if (!provider) continue

        const dataProvider = new Contract(addresses.dataProvider, POOL_DATA_PROVIDER_ABI, provider)

        for (const pos of chainPositions) {
          if (!pos.asset_address) continue

          try {
            const reserveData = await dataProvider.getReserveData(pos.asset_address)
            const liquidityIndex = formatUnits(reserveData[9], 27)
            const liquidityRate = formatUnits(reserveData[5], 27)

            // Convert rate to APY: rate is per-second, annualize
            const ratePerSecond = parseFloat(liquidityRate)
            const apy = ratePerSecond > 0 ? ((1 + ratePerSecond / 31536000) ** 31536000 - 1) * 100 : 0

            lendingPnlEngine.updateInterestAccrual(
              pos.asset_symbol,
              liquidityIndex,
              apy.toFixed(4)
            )
          } catch (err: any) {
            console.warn(`[AaveInterestTracker] Error updating ${pos.asset_symbol} on ${chainName}:`, err.message)
          }
        }
      }
    } catch (err: any) {
      console.error('[AaveInterestTracker] Update error:', err.message)
    } finally {
      this.running = false
    }
  }

  private chainIdToName(chainId: number): string | null {
    for (const [name, id] of Object.entries(CHAIN_IDS)) {
      if (id === chainId) return name
    }
    return null
  }

  isRunning(): boolean {
    return this.intervalHandle !== null
  }
}

export const aaveInterestTracker = new AaveInterestTracker()
