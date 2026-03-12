// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolRegistry} from "../src/PoolRegistry.sol";

contract DeployRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address poolManagerAddress = vm.envAddress("POOL_MANAGER");
        address hookAddress = vm.envAddress("HOOK_ADDRESS");

        require(poolManagerAddress != address(0), "POOL_MANAGER not set");
        require(hookAddress != address(0), "HOOK_ADDRESS not set");

        vm.startBroadcast(deployerPrivateKey);

        PoolRegistry registry = new PoolRegistry(
            IPoolManager(poolManagerAddress),
            hookAddress
        );

        console.log("PoolRegistry deployed at:", address(registry));

        vm.stopBroadcast();
    }
}
