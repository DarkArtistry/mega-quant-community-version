// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {MegaQuantRouter} from "../src/MegaQuantRouter.sol";

contract DeployRouter is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address poolManagerAddress = vm.envAddress("POOL_MANAGER");

        require(poolManagerAddress != address(0), "POOL_MANAGER env var not set");

        vm.startBroadcast(deployerPrivateKey);

        MegaQuantRouter router = new MegaQuantRouter(IPoolManager(poolManagerAddress));

        console.log("MegaQuantRouter deployed at:", address(router));

        vm.stopBroadcast();
    }
}
