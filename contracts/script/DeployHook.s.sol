// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";
import {MegaQuantHook} from "../src/MegaQuantHook.sol";

contract DeployHook is Script {
    // PoolManager on Unichain Sepolia (from https://docs.uniswap.org/contracts/v4/deployments)
    address constant DEFAULT_POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;

    // Standard CREATE2 Deployer Proxy (available on most chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address poolManagerAddress = vm.envOr("POOL_MANAGER", DEFAULT_POOL_MANAGER);

        require(poolManagerAddress != address(0), "POOL_MANAGER env var not set");

        IPoolManager poolManager = IPoolManager(poolManagerAddress);

        // Calculate the required hook flags
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG |
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG
        );

        // Mine a salt using HookMiner (searches against CREATE2 deployer proxy)
        bytes memory constructorArgs = abi.encode(poolManager, "https://megaquant.xyz/api/token/{id}");

        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            type(MegaQuantHook).creationCode,
            constructorArgs
        );

        console.log("Found salt:", uint256(salt));
        console.log("Expected hook address:", hookAddress);

        // Deploy using the mined salt
        vm.startBroadcast(deployerPrivateKey);

        MegaQuantHook hook = new MegaQuantHook{salt: salt}(
            poolManager,
            "https://megaquant.xyz/api/token/{id}"
        );

        require(address(hook) == hookAddress, "Hook deployed to unexpected address");
        console.log("MegaQuantHook deployed at:", address(hook));

        // Optionally initialize a pool
        address token0Addr = vm.envOr("TOKEN0", address(0));
        address token1Addr = vm.envOr("TOKEN1", address(0));

        if (token0Addr != address(0) && token1Addr != address(0)) {
            // Ensure token0 < token1
            if (token0Addr > token1Addr) {
                (token0Addr, token1Addr) = (token1Addr, token0Addr);
            }

            PoolKey memory poolKey = PoolKey({
                currency0: Currency.wrap(token0Addr),
                currency1: Currency.wrap(token1Addr),
                fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
                tickSpacing: int24(60),
                hooks: IHooks(hookAddress)
            });

            uint160 sqrtPriceX96 = 79228162514264337593543950336; // SQRT_PRICE_1_1
            poolManager.initialize(poolKey, sqrtPriceX96);
            console.log("Pool initialized");
        }

        vm.stopBroadcast();
    }
}
