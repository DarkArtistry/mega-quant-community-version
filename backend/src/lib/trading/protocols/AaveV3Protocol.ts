/**
 * Aave V3 Protocol
 *
 * On-chain Aave V3 Pool operations: supply/withdraw/borrow/repay.
 * Tracks positions via LendingPnlEngine.
 * Uses the Aave V3 Pool contract on supported chains.
 */

import { Contract, Wallet, formatUnits, parseUnits, MaxUint256 } from 'ethers'
import { lendingPnlEngine } from '../pnl/LendingPnlEngine.js'
import { orderManager } from '../orders/OrderManager.js'

// Aave V3 Pool ABI (minimal — only the methods we need)
const POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
]

const POOL_DATA_PROVIDER_ABI = [
  'function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)',
  'function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)'
]

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
]

// Aave V3 Pool addresses per chain
export const AAVE_V3_ADDRESSES: Record<string, { pool: string; dataProvider: string }> = {
  ethereum: {
    pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    dataProvider: '0x7B4EB56E7CD4b454BA8ff71E4518426c9EB28E3d'
  },
  base: {
    pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    dataProvider: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac'
  },
  // Testnets (Aave V3 testnet deployments)
  sepolia: {
    pool: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
    dataProvider: '0x3e9708d80f7B3e43118013075F7e95CE3AB31F31'
  }
}

export interface AaveSupplyParams {
  asset: string          // Token address
  assetSymbol: string    // e.g., 'USDC'
  amount: string         // Human-readable amount (e.g., '10000')
  decimals?: number
}

export interface AaveWithdrawParams {
  asset: string
  assetSymbol: string
  amount: string         // Human-readable amount, or 'max' for full withdrawal
  decimals?: number
}

export interface AaveBorrowParams {
  asset: string
  assetSymbol: string
  amount: string
  interestRateMode?: number  // 1 = stable, 2 = variable (default)
  decimals?: number
}

export interface AaveRepayParams {
  asset: string
  assetSymbol: string
  amount: string         // Human-readable amount, or 'max' for full repayment
  interestRateMode?: number
  decimals?: number
}

export class AaveV3Protocol {
  private pool: Contract
  private dataProvider: Contract
  private wallet: Wallet
  private chainName: string
  private chainId: number
  private strategyId: string
  private accountId?: string

  constructor(
    chainName: string,
    chainId: number,
    wallet: Wallet,
    strategyId: string,
    accountId?: string
  ) {
    this.chainName = chainName
    this.chainId = chainId
    this.wallet = wallet
    this.strategyId = strategyId
    this.accountId = accountId

    const addresses = AAVE_V3_ADDRESSES[chainName]
    if (!addresses) {
      throw new Error(`Aave V3 not available on ${chainName}. Supported: ${Object.keys(AAVE_V3_ADDRESSES).join(', ')}`)
    }

    this.pool = new Contract(addresses.pool, POOL_ABI, wallet)
    this.dataProvider = new Contract(addresses.dataProvider, POOL_DATA_PROVIDER_ABI, wallet)
  }

  // --- Supply ---

  async supply(params: AaveSupplyParams): Promise<string> {
    const decimals = params.decimals || await this.getDecimals(params.asset)
    const amount = parseUnits(params.amount, decimals)

    // Approve pool to spend tokens
    await this.ensureApproval(params.asset, amount)

    console.log(`[AaveV3] Supplying ${params.amount} ${params.assetSymbol} on ${this.chainName}...`)
    const tx = await this.pool.supply(params.asset, amount, this.wallet.address, 0)
    const receipt = await tx.wait()

    // Get liquidity index for PnL tracking
    const reserveData = await this.getReserveData(params.asset)

    // Record in PnL engine and order manager
    this.recordLendingAction('supply', params.assetSymbol, params.asset, params.amount, reserveData, receipt.hash)

    console.log(`[AaveV3] Supplied ${params.amount} ${params.assetSymbol} (tx: ${receipt.hash})`)
    return receipt.hash
  }

  // --- Withdraw ---

  async withdraw(params: AaveWithdrawParams): Promise<string> {
    const decimals = params.decimals || await this.getDecimals(params.asset)
    const amount = params.amount === 'max' ? MaxUint256 : parseUnits(params.amount, decimals)

    console.log(`[AaveV3] Withdrawing ${params.amount} ${params.assetSymbol} on ${this.chainName}...`)
    const tx = await this.pool.withdraw(params.asset, amount, this.wallet.address)
    const receipt = await tx.wait()

    const reserveData = await this.getReserveData(params.asset)

    // For 'max' withdrawal, we need to figure out the actual amount withdrawn
    const withdrawAmount = params.amount === 'max' ? await this.getSuppliedBalance(params.asset, decimals) : params.amount

    this.recordLendingAction('withdraw', params.assetSymbol, params.asset, withdrawAmount, reserveData, receipt.hash)

    console.log(`[AaveV3] Withdrawn ${withdrawAmount} ${params.assetSymbol} (tx: ${receipt.hash})`)
    return receipt.hash
  }

  // --- Borrow ---

  async borrow(params: AaveBorrowParams): Promise<string> {
    const decimals = params.decimals || await this.getDecimals(params.asset)
    const amount = parseUnits(params.amount, decimals)
    const interestRateMode = params.interestRateMode || 2 // default: variable

    console.log(`[AaveV3] Borrowing ${params.amount} ${params.assetSymbol} on ${this.chainName}...`)
    const tx = await this.pool.borrow(params.asset, amount, interestRateMode, 0, this.wallet.address)
    const receipt = await tx.wait()

    const reserveData = await this.getReserveData(params.asset)

    this.recordLendingAction('borrow', params.assetSymbol, params.asset, params.amount, reserveData, receipt.hash, interestRateMode === 1 ? 'stable' : 'variable')

    console.log(`[AaveV3] Borrowed ${params.amount} ${params.assetSymbol} (tx: ${receipt.hash})`)
    return receipt.hash
  }

  // --- Repay ---

  async repay(params: AaveRepayParams): Promise<string> {
    const decimals = params.decimals || await this.getDecimals(params.asset)
    const amount = params.amount === 'max' ? MaxUint256 : parseUnits(params.amount, decimals)
    const interestRateMode = params.interestRateMode || 2

    await this.ensureApproval(params.asset, amount)

    console.log(`[AaveV3] Repaying ${params.amount} ${params.assetSymbol} on ${this.chainName}...`)
    const tx = await this.pool.repay(params.asset, amount, interestRateMode, this.wallet.address)
    const receipt = await tx.wait()

    const reserveData = await this.getReserveData(params.asset)
    const repayAmount = params.amount === 'max' ? await this.getBorrowedBalance(params.asset, decimals) : params.amount

    this.recordLendingAction('repay', params.assetSymbol, params.asset, repayAmount, reserveData, receipt.hash, interestRateMode === 1 ? 'stable' : 'variable')

    console.log(`[AaveV3] Repaid ${repayAmount} ${params.assetSymbol} (tx: ${receipt.hash})`)
    return receipt.hash
  }

  // --- Account Data ---

  async getUserAccountData(): Promise<{
    totalCollateralUsd: number
    totalDebtUsd: number
    availableBorrowsUsd: number
    healthFactor: number
    ltv: number
    liquidationThreshold: number
  }> {
    const data = await this.pool.getUserAccountData(this.wallet.address)
    return {
      totalCollateralUsd: parseFloat(formatUnits(data[0], 8)),
      totalDebtUsd: parseFloat(formatUnits(data[1], 8)),
      availableBorrowsUsd: parseFloat(formatUnits(data[2], 8)),
      healthFactor: parseFloat(formatUnits(data[5], 18)),
      ltv: Number(data[4]) / 100,
      liquidationThreshold: Number(data[3]) / 100
    }
  }

  async getReserveData(asset: string): Promise<{ liquidityIndex: string; variableBorrowIndex: string; liquidityRate: string; variableBorrowRate: string }> {
    const data = await this.dataProvider.getReserveData(asset)
    return {
      liquidityIndex: formatUnits(data[9], 27),    // RAY (27 decimals)
      variableBorrowIndex: formatUnits(data[10], 27),
      liquidityRate: formatUnits(data[5], 27),
      variableBorrowRate: formatUnits(data[6], 27)
    }
  }

  // --- Private Helpers ---

  private async ensureApproval(asset: string, amount: bigint): Promise<void> {
    const token = new Contract(asset, ERC20_ABI, this.wallet)
    const addresses = AAVE_V3_ADDRESSES[this.chainName]
    const currentAllowance = await token.allowance(this.wallet.address, addresses.pool)

    if (currentAllowance < amount) {
      console.log(`[AaveV3] Approving pool to spend tokens...`)
      const tx = await token.approve(addresses.pool, MaxUint256)
      await tx.wait()
    }
  }

  private async getDecimals(asset: string): Promise<number> {
    const token = new Contract(asset, ERC20_ABI, this.wallet)
    return await token.decimals()
  }

  private async getSuppliedBalance(asset: string, decimals: number): Promise<string> {
    const userData = await this.dataProvider.getUserReserveData(asset, this.wallet.address)
    return formatUnits(userData[0], decimals)
  }

  private async getBorrowedBalance(asset: string, decimals: number): Promise<string> {
    const userData = await this.dataProvider.getUserReserveData(asset, this.wallet.address)
    const variableDebt = userData[2]
    const stableDebt = userData[1]
    const totalDebt = variableDebt + stableDebt
    return formatUnits(totalDebt, decimals)
  }

  private recordLendingAction(
    action: 'supply' | 'withdraw' | 'borrow' | 'repay',
    assetSymbol: string,
    assetAddress: string,
    amount: string,
    reserveData: { liquidityIndex: string; variableBorrowIndex: string },
    txHash: string,
    interestRateMode?: string
  ): void {
    try {
      const positionType = (action === 'supply' || action === 'withdraw') ? 'supply' : 'borrow'
      const side = (action === 'supply' || action === 'borrow') ? 'buy' : 'sell'
      const liquidityIndex = positionType === 'supply' ? reserveData.liquidityIndex : reserveData.variableBorrowIndex

      // Record in OrderManager (single order)
      const order = orderManager.recordOrder({
        strategyId: this.strategyId,
        orderType: 'market',
        side,
        assetSymbol,
        assetAddress,
        chainId: this.chainId,
        protocol: `aave-v3`,
        quantity: amount,
        accountId: this.accountId,
        instrumentType: 'lending',
        lendingAction: action,
        interestRateMode: interestRateMode || 'variable'
      })
      orderManager.updateOrderStatus(order.id, 'filled', {
        filledQuantity: amount,
        filledPrice: '1', // Lending is 1:1 (no price impact)
        txHash
      })

      // Record in LendingPnlEngine
      lendingPnlEngine.processLending({
        strategyId: this.strategyId,
        accountId: this.accountId,
        protocol: 'aave-v3',
        chainId: this.chainId,
        assetSymbol,
        assetAddress,
        action,
        positionType,
        amount,
        interestRateMode: interestRateMode || 'variable',
        liquidityIndex
      })
    } catch (error: any) {
      console.error(`[AaveV3] Failed to record ${action}:`, error.message)
    }
  }
}
