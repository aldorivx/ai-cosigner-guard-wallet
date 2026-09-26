import {
  getAddress,
  isAddress,
  formatEther,
  parseEther,
  maxUint256,
  encodeFunctionData,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  PORT,
  getGuardWalletAddress,
  getRelayerPK,
  getAISignerPK,
  getPublicClient,
} from "../config";
import {
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  BSC_TESTNET_CHAIN_ID,
  EIP712_TYPES,
} from "../services/coSigner";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const GUARD_WALLET_ABI = parseAbi([
  "function execute(address to, uint256 value, bytes calldata data, uint256 _nonce, uint256 deadline, bytes calldata userSignature, bytes calldata aiSignature) external payable returns (bytes memory)",
  "function nonce() external view returns (uint256)",
  "function owner() external view returns (address)",
  "function aiSigner() external view returns (address)",
]);

async function runLiveRelayTest() {
  console.log(`\n${C.bold}${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║       🚀 LIVE ON-CHAIN RELAY TEST - BNB SMART CHAIN TESTNET 🚀             ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}║                 GuardWallet 2-of-2 Multi-Sig Execution                     ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  const baseUrl = `http://localhost:${PORT || 3000}`;
  const publicClient = getPublicClient();
  const walletAddress = getGuardWalletAddress();
  const relayerPk = getRelayerPK();
  const aiSignerPk = getAISignerPK();

  if (!walletAddress || !isAddress(walletAddress)) {
    throw new Error(`GUARD_WALLET_ADDRESS tidak valid atau belum diisi: ${walletAddress}`);
  }
  if (!relayerPk) {
    throw new Error("RELAYER_PK belum dikonfigurasi di .env.");
  }

  const checksummedWallet = getAddress(walletAddress);
  const formattedPk = (relayerPk.startsWith("0x") ? relayerPk : `0x${relayerPk}`) as Hex;
  const ownerAccount = privateKeyToAccount(formattedPk);

  // 1. Verifikasi Status Awal On-Chain
  console.log(`${C.bold}1. Status Kontrak & Akun On-Chain:${C.reset}`);
  const [onChainOwner, onChainAISigner, currentNonce, initialBalance, relayerBalance] =
    await Promise.all([
      publicClient.readContract({
        address: checksummedWallet,
        abi: GUARD_WALLET_ABI,
        functionName: "owner",
      }),
      publicClient.readContract({
        address: checksummedWallet,
        abi: GUARD_WALLET_ABI,
        functionName: "aiSigner",
      }),
      publicClient.readContract({
        address: checksummedWallet,
        abi: GUARD_WALLET_ABI,
        functionName: "nonce",
      }),
      publicClient.getBalance({ address: checksummedWallet }),
      publicClient.getBalance({ address: ownerAccount.address }),
    ]);

  console.log(`   • GuardWallet Address : ${C.yellow}${checksummedWallet}${C.reset}`);
  console.log(`   • GuardWallet Balance : ${C.green}${formatEther(initialBalance)} tBNB${C.reset}`);
  console.log(`   • GuardWallet Nonce   : ${C.yellow}${currentNonce.toString()}${C.reset}`);
  console.log(`   • Registered Owner    : ${onChainOwner}`);
  console.log(`   • Registered AI Signer: ${onChainAISigner}`);
  console.log(`   • Relayer/User Wallet : ${ownerAccount.address} (Saldo: ${formatEther(relayerBalance)} tBNB)\n`);

  if (onChainOwner.toLowerCase() !== ownerAccount.address.toLowerCase()) {
    console.warn(`${C.yellow}⚠️ Peringatan: Owner on-chain berbeda dari signer relayer.${C.reset}`);
  }

  if (initialBalance === 0n) {
    throw new Error("GuardWallet saldo 0 tBNB. Harap kirim sedikit tBNB ke GuardWallet sebelum pengujian.");
  }

  /* ========================================================================= */
  /* TAHAP 1: LIVE RELAY TRANSAKSI NORMAL (0.0005 tBNB)                        */
  /* ========================================================================= */
  console.log(`${C.bold}${C.green}────────────────────────────────────────────────────────────────────────────${C.reset}`);
  console.log(`${C.bold}${C.green}▶ LIVE RELAY 1: Transaksi Normal (Kirim 0.0005 tBNB dari GuardWallet)${C.reset}`);
  console.log(`${C.bold}${C.green}────────────────────────────────────────────────────────────────────────────${C.reset}`);

  // Kirim kembali ke owner sebagai pembuktian
  const recipient = ownerAccount.address;
  const transferValue = parseEther("0.0005");
  const transferValueStr = transferValue.toString();
  const txNonce = currentNonce.toString();
  const deadline = (Math.floor(Date.now() / 1000) + 3600).toString();

  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: BSC_TESTNET_CHAIN_ID,
    verifyingContract: checksummedWallet,
  } as const;

  const message = {
    to: getAddress(recipient),
    value: transferValue,
    data: "0x" as Hex,
    nonce: BigInt(txNonce),
    deadline: BigInt(deadline),
  };

  console.log(`[User] Menandatangani EIP-712 Typed Data via Viem (Signature 1-of-2)...`);
  const userSignature = await ownerAccount.signTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: "Transaction",
    message,
  });
  console.log(`[User] Signature: ${userSignature.slice(0, 20)}...${userSignature.slice(-8)}`);

  console.log(`\n[Client] Mengirim request ke Backend Relay (autoRelay = true)...`);
  const postBody = {
    walletAddress: checksummedWallet,
    to: recipient,
    value: transferValueStr,
    data: "0x",
    nonce: txNonce,
    deadline,
    userSignature,
    autoRelay: true,
  };

  const startTime = Date.now();
  const res = await fetch(`${baseUrl}/api/guard/sign-and-relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(postBody),
  });

  const result: any = await res.json();
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`[Backend HTTP Response]: ${res.status === 200 ? C.green + "200 OK" : C.red + res.status}${C.reset}`);
  console.log(`[AI Verdict]           : ${result.verdict?.status === "APPROVED" ? C.green + "APPROVED ✅" : C.red + result.verdict?.status}${C.reset}`);
  console.log(`[Risk Score]           : ${C.green}${result.verdict?.risk_score}/100${C.reset}`);
  console.log(`[AI Signature 2-of-2]  : ${result.aiSignature ? result.aiSignature.slice(0, 20) + "..." : "none"}`);

  if (result.relayed && result.txHash) {
    console.log(`\n${C.bold}${C.green}🎉 ON-CHAIN TRANSACTION CONFIRMED! (${elapsedSec}s)${C.reset}`);
    console.log(`   • Tx Hash      : ${C.cyan}${result.txHash}${C.reset}`);
    console.log(`   • Block Number : ${result.blockNumber}`);
    console.log(`   • Explorer Link: ${C.bold}https://testnet.bscscan.com/tx/${result.txHash}${C.reset}`);

    // Cek perubahan state on-chain
    const [newNonce, newBalance] = await Promise.all([
      publicClient.readContract({
        address: checksummedWallet,
        abi: GUARD_WALLET_ABI,
        functionName: "nonce",
      }),
      publicClient.getBalance({ address: checksummedWallet }),
    ]);

    console.log(`\n${C.bold}Perubahan State On-Chain GuardWallet:${C.reset}`);
    console.log(`   • Nonce Sebelumnya : ${currentNonce.toString()} ➔ Nonce Baru : ${C.green}${newNonce.toString()}${C.reset}`);
    console.log(`   • Saldo Sebelumnya : ${formatEther(initialBalance)} tBNB ➔ Saldo Baru: ${C.green}${formatEther(newBalance)} tBNB${C.reset}`);
  } else {
    console.error(`${C.red}Gagal relay on-chain: ${JSON.stringify(result, null, 2)}${C.reset}`);
    process.exit(1);
  }

  /* ========================================================================= */
  /* TAHAP 2: LIVE RELAY DIHALAU (PHISHING DRAINER TIDAK BOLEH TEMBUS KE CHAIN)*/
  /* ========================================================================= */
  console.log(`\n${C.bold}${C.red}────────────────────────────────────────────────────────────────────────────${C.reset}`);
  console.log(`${C.bold}${C.red}▶ LIVE RELAY 2: Percobaan Serangan Phishing Drainer (Harus DITOLAK)${C.reset}`);
  console.log(`${C.bold}${C.red}────────────────────────────────────────────────────────────────────────────${C.reset}`);

  const mockToken = "0x337610d27c682e347c9cd608137943050b300fe4";
  const drainerSpender = "0x000000000000000000000000000000000000dead";
  const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount)"]);
  const exploitCalldata = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [drainerSpender, maxUint256],
  });

  const currentNonce2 = await publicClient.readContract({
    address: checksummedWallet,
    abi: GUARD_WALLET_ABI,
    functionName: "nonce",
  });

  const message2 = {
    to: getAddress(mockToken),
    value: 0n,
    data: exploitCalldata,
    nonce: currentNonce2,
    deadline: BigInt(deadline),
  };

  const userSignature2 = await ownerAccount.signTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: "Transaction",
    message: message2,
  });

  const res2 = await fetch(`${baseUrl}/api/guard/sign-and-relay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletAddress: checksummedWallet,
      to: mockToken,
      value: "0",
      data: exploitCalldata,
      nonce: currentNonce2.toString(),
      deadline,
      userSignature: userSignature2,
      autoRelay: true,
    }),
  });

  const result2: any = await res2.json();
  console.log(`[Backend HTTP Response]: ${res2.status === 403 ? C.red + "403 Forbidden (DIBLOKIR)" : res2.status}${C.reset}`);
  console.log(`[AI Verdict]           : ${result2?.verdict?.status === "REJECTED" ? C.red + "REJECTED ⛔" : result2?.verdict?.status}${C.reset}`);
  console.log(`[Risk Score]           : ${C.red}${result2?.verdict?.risk_score}/100 (KRITIS)${C.reset}`);
  console.log(`[Alasan Blokir]        : "${C.yellow}${result2?.verdict?.reason}${C.reset}"`);
  console.log(`[Relayed Status]       : ${result2?.relayed ? C.red + "TERELAY (GAGAL PROTEKSI)" : C.green + "TIDAK DIBROADCAST (AMAN)"}${C.reset}`);

  if (res2.status === 403 && !result2?.relayed) {
    console.log(`\n${C.bold}${C.green}✔ UJI PROTEKSI LOLOS: Transaksi berbahaya digagalkan SEBELUM masuk ke mempool/chain.${C.reset}`);
  } else {
    console.error(`\n${C.bold}${C.red}✖ UJI PROTEKSI GAGAL!${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.bold}${C.green}════════════════════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}${C.green}✨ SELURUH PENGUJIAN LIVE ON-CHAIN BSC TESTNET BERHASIL 100%! ✨${C.reset}`);
  console.log(`${C.bold}${C.green}════════════════════════════════════════════════════════════════════════════${C.reset}\n`);
}

runLiveRelayTest().catch((err) => {
  console.error("Kesalahan pengujian live relay:", err);
  process.exit(1);
});
