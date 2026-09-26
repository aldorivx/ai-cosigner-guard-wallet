// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GuardWallet} from "../src/GuardWallet.sol";

contract DeployGuardWallet is Script {
    function run() external returns (GuardWallet wallet) {
        // 1. Ambil private key Deployer / Relayer dari environment (.env)
        uint256 deployerPrivateKey = vm.envUint("RELAYER_PK");
        address deployer = vm.addr(deployerPrivateKey);

        // 2. Ambil private key AI Signer dari environment (.env)
        uint256 aiSignerPrivateKey = vm.envUint("AI_SIGNER_PK");
        address aiSigner = vm.addr(aiSignerPrivateKey);

        // 3. Tentukan Owner (default ke deployer jika OWNER_ADDRESS tidak diset di .env)
        address owner = vm.envOr("OWNER_ADDRESS", deployer);

        console.log("==================================================");
        console.log(unicode"   🚀 Memulai Deployment GuardWallet ke Chain ID:", block.chainid);
        console.log("==================================================");
        console.log("Deployer Address :", deployer);
        console.log("Owner Address    :", owner);
        console.log("AI Signer Address:", aiSigner);
        console.log("Deployer Balance :", deployer.balance);

        require(owner != address(0), "Owner tidak boleh zero address");
        require(aiSigner != address(0), "AI Signer tidak boleh zero address");
        require(owner != aiSigner, "Owner dan AI Signer tidak boleh sama");

        // 4. Broadcast transaksi deployment on-chain
        vm.startBroadcast(deployerPrivateKey);

        wallet = new GuardWallet(owner, aiSigner);

        vm.stopBroadcast();

        console.log("--------------------------------------------------");
        console.log(unicode"   🎉 GuardWallet Berhasil Di-Deploy!");
        console.log("--------------------------------------------------");
        console.log("GuardWallet Address:", address(wallet));
        console.log("EIP-712 Domain Name:", "GuardWallet");
        console.log("EIP-712 Version    :", "1");
        console.log("==================================================");
    }
}
