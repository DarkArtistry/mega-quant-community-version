/**
 * Test script to debug add-liquidity flow step by step.
 * Run: cd backend && npx tsx test/test-add-liquidity.ts
 */
import { Wallet, JsonRpcProvider, Contract, formatUnits, parseUnits, MaxUint256 } from 'ethers'
import { getChainConfig } from '../src/lib/trading/config/chains.js'
import { getTokenInfo } from '../src/lib/trading/config/tokens.js'
import { ERC20_ABI } from '../src/lib/trading/abis/erc20.js'
import { PERMIT2_ABI, PERMIT2_ADDRESS } from '../src/lib/trading/abis/permit2.js'
import { UNISWAP_V4_POSITION_MANAGER_ABI } from '../src/lib/trading/abis/uniswapV4PositionManager.js'
import { accountKeyStore } from '../src/services/account-key-store.js'

const CHAIN = 'unichain-sepolia'

async function main() {
  const chainConfig = getChainConfig(CHAIN)
  const provider = new JsonRpcProvider(chainConfig.rpcUrl)

  // Use hardcoded test key or get from key store
  // For testing, we'll read from env or use a dummy check
  const testPrivateKey = process.env.TEST_PRIVATE_KEY
  if (!testPrivateKey) {
    console.error('Set TEST_PRIVATE_KEY env var to run this test')
    process.exit(1)
  }

  const wallet = new Wallet(testPrivateKey, provider)
  const walletAddress = await wallet.getAddress()
  console.log(`\nWallet: ${walletAddress}`)

  // 1. Check native balance
  const ethBalance = await provider.getBalance(walletAddress)
  console.log(`ETH Balance: ${formatUnits(ethBalance, 18)}`)
  if (ethBalance === 0n) {
    console.error('ERROR: No ETH for gas!')
    process.exit(1)
  }

  // 2. Get token info
  const usdc = getTokenInfo(CHAIN, 'USDC')
  const weth = getTokenInfo(CHAIN, 'WETH')
  console.log(`\nUSDC: ${usdc.address} (${usdc.decimals} decimals)`)
  console.log(`WETH: ${weth.address} (${weth.decimals} decimals)`)

  // Sort tokens (currency0 < currency1)
  const [currency0, currency1] = usdc.address.toLowerCase() < weth.address.toLowerCase()
    ? [usdc, weth] : [weth, usdc]
  console.log(`\nSorted: currency0=${currency0.symbol} (${currency0.address})`)
  console.log(`        currency1=${currency1.symbol} (${currency1.address})`)

  // 3. Check ERC20 balances
  const usdcContract = new Contract(usdc.address, ERC20_ABI, wallet)
  const wethContract = new Contract(weth.address, ERC20_ABI, wallet)
  const usdcBal = await usdcContract.balanceOf(walletAddress)
  const wethBal = await wethContract.balanceOf(walletAddress)
  console.log(`\nUSDC Balance: ${formatUnits(usdcBal, usdc.decimals)}`)
  console.log(`WETH Balance: ${formatUnits(wethBal, weth.decimals)}`)

  if (usdcBal === 0n) console.warn('WARNING: Zero USDC balance!')
  if (wethBal === 0n) console.warn('WARNING: Zero WETH balance!')

  // 4. Check PositionManager address
  const positionManagerAddress = chainConfig.uniswapV4!.positionManager
  console.log(`\nPositionManager: ${positionManagerAddress}`)

  // 5. Check Permit2 state
  const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, wallet)
  console.log(`Permit2: ${PERMIT2_ADDRESS}`)

  // 5a. Check ERC20 allowance to Permit2
  const usdcAllowanceToPermit2 = await usdcContract.allowance(walletAddress, PERMIT2_ADDRESS)
  const wethAllowanceToPermit2 = await wethContract.allowance(walletAddress, PERMIT2_ADDRESS)
  console.log(`\n--- ERC20 Allowances to Permit2 ---`)
  console.log(`USDC -> Permit2: ${formatUnits(usdcAllowanceToPermit2, usdc.decimals)}`)
  console.log(`WETH -> Permit2: ${formatUnits(wethAllowanceToPermit2, weth.decimals)}`)

  // 5b. Check Permit2 allowance to PositionManager
  const usdcPermit2Allowance = await permit2.allowance(walletAddress, usdc.address, positionManagerAddress)
  const wethPermit2Allowance = await permit2.allowance(walletAddress, weth.address, positionManagerAddress)
  console.log(`\n--- Permit2 Allowances to PositionManager ---`)
  console.log(`USDC: amount=${usdcPermit2Allowance[0]}, expiration=${usdcPermit2Allowance[1]}`)
  console.log(`WETH: amount=${wethPermit2Allowance[0]}, expiration=${wethPermit2Allowance[1]}`)

  const now = Math.floor(Date.now() / 1000)
  const usdcExpired = Number(usdcPermit2Allowance[1]) < now
  const wethExpired = Number(wethPermit2Allowance[1]) < now
  console.log(`USDC expired? ${usdcExpired} (exp=${usdcPermit2Allowance[1]}, now=${now})`)
  console.log(`WETH expired? ${wethExpired} (exp=${wethPermit2Allowance[1]}, now=${now})`)

  // 5c. ALSO check direct ERC20 allowance to PositionManager (no Permit2)
  const usdcDirectAllowance = await usdcContract.allowance(walletAddress, positionManagerAddress)
  const wethDirectAllowance = await wethContract.allowance(walletAddress, positionManagerAddress)
  console.log(`\n--- Direct ERC20 Allowances to PositionManager ---`)
  console.log(`USDC -> PM: ${formatUnits(usdcDirectAllowance, usdc.decimals)}`)
  console.log(`WETH -> PM: ${formatUnits(wethDirectAllowance, weth.decimals)}`)

  // 6. Check what transfer mechanism the PositionManager uses
  console.log(`\n--- Analysis ---`)
  console.log(`The V4 PositionManager uses Permit2 for token transfers.`)
  console.log(`TRANSFER_FROM_FAILED means the PM called Permit2.transferFrom() but:`)
  console.log(`  a) ERC20 hasn't approved Permit2 (allowance=0), OR`)
  console.log(`  b) Permit2 hasn't approved PositionManager (amount=0 or expired), OR`)
  console.log(`  c) Insufficient token balance`)
  console.log(``)

  // Diagnose
  const amount0 = parseUnits('2', currency0.decimals)
  const amount1 = parseUnits('0.02', currency1.decimals)
  console.log(`Requested: ${formatUnits(amount0, currency0.decimals)} ${currency0.symbol} + ${formatUnits(amount1, currency1.decimals)} ${currency1.symbol}`)

  const c0Contract = currency0.symbol === 'USDC' ? usdcContract : wethContract
  const c1Contract = currency1.symbol === 'USDC' ? usdcContract : wethContract
  const c0Bal = currency0.symbol === 'USDC' ? usdcBal : wethBal
  const c1Bal = currency1.symbol === 'USDC' ? usdcBal : wethBal

  if (c0Bal < amount0) console.error(`FAIL: Insufficient ${currency0.symbol} balance: have ${formatUnits(c0Bal, currency0.decimals)}, need ${formatUnits(amount0, currency0.decimals)}`)
  if (c1Bal < amount1) console.error(`FAIL: Insufficient ${currency1.symbol} balance: have ${formatUnits(c1Bal, currency1.decimals)}, need ${formatUnits(amount1, currency1.decimals)}`)

  // Check if PM actually uses Permit2 or direct transferFrom
  // The V4 PositionManager calls `permit2.transferFrom(msg.sender, address(this), amount, token)`
  // But wait — some PM implementations use `currency.settle()` which may require
  // direct approval to the PM, NOT via Permit2
  console.log(`\nNOTE: V4 PositionManager uses SETTLE pattern, not direct Permit2 transferFrom.`)
  console.log(`The caller must transfer tokens TO the PositionManager before/during the call.`)
  console.log(`With SETTLE_PAIR action, PM calls permit2.transferFrom(msg.sender, PM, amount, token).`)
  console.log(`So the flow is: ERC20.approve(Permit2) -> Permit2.approve(PM) -> PM.modifyLiquidities()`)

  console.log(`\nDone.`)
}

main().catch(console.error)
