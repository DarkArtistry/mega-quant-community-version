# MegaQuant Smart Contracts

Uniswap V4 Hook contracts for the MegaQuant quantitative trading platform. Built with [Foundry](https://getfoundry.sh/).

## Contracts

| Contract | Description |
|----------|-------------|
| `MegaQuantHook.sol` | V4 hook with EWMA volatility-based dynamic fees, limit orders, stop-loss orders, bracket (OCO) orders |
| `MegaQuantRouter.sol` | Router for placing limit, stop, and bracket orders through the hook |
| `PoolRegistry.sol` | On-chain registry for MegaQuant-managed pools with metadata |

## Deployed Addresses

### Unichain Sepolia (Chain ID: 1301)

| Contract | Address |
|----------|---------|
| PoolManager (Uniswap) | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` |
| **MegaQuantHook** | `0xB591b5096dA183Fa8d2F4C916Dcb0B4904f6f0c0` |
| **MegaQuantRouter** | `0x608AEfA1DFD3621554a948E20159eB243C76235F` |
| **PoolRegistry** | `0x680762A631334098eeF5F24EAAafac0F07Cb2e3a` |

Block explorer: https://sepolia.uniscan.xyz

### Mainnet

Not yet deployed.

## Build & Test

```bash
forge build
forge test -vvv
```

## Deploy

```bash
# Hook (uses CREATE2 salt mining via HookMiner)
PRIVATE_KEY=0x... forge script script/DeployHook.s.sol --rpc-url https://sepolia.unichain.org --broadcast

# Router
PRIVATE_KEY=0x... POOL_MANAGER=0x000000000004444c5dc75cB358380D2e3dE08A90 forge script script/DeployRouter.s.sol --rpc-url https://sepolia.unichain.org --broadcast

# Registry
PRIVATE_KEY=0x... POOL_MANAGER=0x000000000004444c5dc75cB358380D2e3dE08A90 HOOK_ADDRESS=<hook_addr> forge script script/DeployRegistry.s.sol --rpc-url https://sepolia.unichain.org --broadcast
```

## Hook Features

- **Dynamic Fees**: EWMA volatility tracking adjusts swap fees between 0.05% and 1% based on recent price movements
- **Limit Orders**: Place orders at specific ticks, auto-executed when price crosses the tick during swaps
- **Stop-Loss Orders**: Trigger sells when price drops below a threshold tick
- **Bracket (OCO) Orders**: Linked limit + stop orders where filling one cancels the other
- **ERC1155 Claim Tokens**: Order positions are represented as ERC1155 tokens for composability

## Test Coverage

55 tests across 4 test files:
- `MegaQuantHook.t.sol` — Core hook functionality (31 tests)
- `StopOrder.t.sol` — Stop order placement, execution, cancellation (11 tests)
- `BracketOrder.t.sol` — Bracket orders, partner linking, OCO cancellation (6 tests)
- `PoolRegistry.t.sol` — Pool creation, metadata, pagination (7 tests)
