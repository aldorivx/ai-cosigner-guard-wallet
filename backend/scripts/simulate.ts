import type { Server } from "http";
import {
  getAddress,
  parseEther,
  maxUint256,
  encodeFunctionData,
  parseAbi,
  isAddress,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import app from "../server";
import { PORT, AI_SIGNER_PK, GUARD_WALLET_ADDRESS } from "../config";
import {
  getAISignerAddress,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  BSC_TESTNET_CHAIN_ID,
  EIP712_TYPES,
} from "../services/coSigner";

// Warna ANSI untuk visualisasi log terminal
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

/**
 * Memastikan backend aktif: terhubung ke server yang sudah berjalan atau menjalankan internal instance.
 */
async function ensureServerRunning(): Promise<{ baseUrl: string; serverInstance: Server | null }> {
  const targetPort = PORT || 3000;
  const url = `http://localhost:${targetPort}`;

  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      console.log(`${C.cyan}[Koneksi] Terhubung ke backend aktif di: ${url}${C.reset}\n`);
      return { baseUrl: url, serverInstance: null };
    }
  } catch {
    // Server belum berjalan di port tersebut, jalankan internal server
  }

  return new Promise((resolve) => {
    const server = app.listen(targetPort, () => {
      console.log(`${C.cyan}[Inisialisasi] Backend service otomatis dijalankan pada ${url}...${C.reset}\n`);
      resolve({ baseUrl: url, serverInstance: server });
    });
  });
}

async function runSimulation() {
  console.log(`\n${C.bold}${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║             🛡️  AI CO-SIGNER GUARD WALLET - DEMO SIMULATION 🛡️             ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}║         2-of-2 Multi-Sig Pre-Execution Check di BNB Smart Chain            ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  // Konfigurasi signer key AI untuk demo
  const fallbackAiPk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const aiPk = process.env.AI_SIGNER_PK || AI_SIGNER_PK || fallbackAiPk;
  process.env.AI_SIGNER_PK = aiPk;

  // Pastikan parameter walletAddress menggunakan dummy checksum address yang valid
  const walletAddress =
    process.env.GUARD_WALLET_ADDRESS && isAddress(process.env.GUARD_WALLET_ADDRESS)
      ? getAddress(process.env.GUARD_WALLET_ADDRESS)
      : privateKeyToAccount(generatePrivateKey()).address;
  process.env.GUARD_WALLET_ADDRESS = walletAddress;

  const { baseUrl, serverInstance } = await ensureServerRunning();

  // 1. Setup Mock User
  const mockUserPrivateKey = generatePrivateKey();
  const mockUser = privateKeyToAccount(mockUserPrivateKey);

  console.log(`${C.bold}1. Entitas Lingkungan Simulasi:${C.reset}`);
  console.log(`   - ${C.yellow}User Address (Inisiator)${C.reset}  : ${mockUser.address}`);
  console.log(`   - ${C.yellow}Guard Wallet (Contract)${C.reset}  : ${walletAddress}`);
  console.log(`   - ${C.yellow}AI Co-Signer Signer${C.reset}       : ${getAISignerAddress(aiPk)}`);
  console.log(`   - ${C.yellow}Target Chain ID${C.reset}           : ${BSC_TESTNET_CHAIN_ID} (BSC Testnet)\n`);

  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: BSC_TESTNET_CHAIN_ID,
    verifyingContract: getAddress(walletAddress),
  } as const;

  let scenario1Passed = false;
  let scenario2Passed = false;
  let scenario3Passed = false;

  /* ========================================================================= */
  /* SKENARIO 1: Happy Path - Transaksi Normal (Transfer BNB)                  */
  /* ========================================================================= */
  console.log(`${C.bold}${C.green}────────────────────────────────────────────────────────────────────────────${C.reset}`);
  console.log(`${C.bold}${C.green}▶ SKENARIO 1: Happy Path - Transaksi Transfer Normal (BNB Native)${C.reset}`);
  console.log(`${C.bold}${C.green}────────────────────────────────────────────────────────────────────────────${C.reset}`);

  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const transferValueBigInt = parseEther("0.01");
  const transferValueStr = transferValueBigInt.toString();
  const nonce1 = "0";
  const deadline1 = (Math.floor(Date.now() / 1000) + 3600).toString(); // +1 jam

  console.log(`[User] Menyusun payload transaksi normal:`);
  console.log(`   • Penerima : ${recipient}`);
  console.log(`   • Nilai    : 0.01 BNB (${transferValueStr} wei)`);
  console.log(`   • Calldata : 0x (Transfer Native)`);
  console.log(`   • Nonce    : ${nonce1}`);
  console.log(`   • Deadline : ${deadline1}`);

  const message1 = {
    to: getAddress(recipient),
    value: transferValueBigInt,
    data: "0x" as Hex,
    nonce: BigInt(nonce1),
    deadline: BigInt(deadline1),
  };

  // User menandatangani EIP-712 Typed Data
  const userSignature1 = await mockUser.signTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: "Transaction",
    message: message1,
  });
  console.log(`[User] Signature 1-of-2 EIP-712 dihasilkan: ${userSignature1.slice(0, 22)}...${userSignature1.slice(-10)}`);

  console.log(`\n[Client] Mengirim permintaan co-sign ke AI Guard Backend...`);
  let response1: Response | null = null;
  let result1: any = null;

  try {
    response1 = await fetch(`${baseUrl}/api/guard/sign-and-relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: walletAddress.toString(),
        to: recipient.toString(),
        value: transferValueStr,
        data: "0x",
        nonce: nonce1,
        deadline: deadline1,
        userSignature: userSignature1.toString(),
        autoRelay: false,
      }),
    });
    result1 = await response1.json();
  } catch (err) {
    console.error(`${C.red}[Error Network]: ${(err as Error).message}${C.reset}`);
  }

  const status1 = response1 ? response1.status : 0;
  console.log(`[Backend Response Status]: ${status1 === 200 ? C.green + "200 OK" : C.red + status1}${C.reset}`);

  if (status1 !== 200) {
    console.error(`${C.red}[Detail Galat Lengkap]: ${JSON.stringify(result1, null, 2)}${C.reset}`);
  } else {
    console.log(`[AI Guard Verdict]       : ${result1.verdict?.status === "APPROVED" ? C.green + "APPROVED ✅" : C.red + result1.verdict?.status}${C.reset}`);
    console.log(`[Risk Score]             : ${C.green}${result1.verdict?.risk_score}/100 (Aman)${C.reset}`);
    console.log(`[Reason]                 : "${result1.verdict?.reason}"`);
    console.log(`[AI Co-Signature 2-of-2] : ${C.cyan}${result1.aiSignature?.slice(0, 26)}...${result1.aiSignature?.slice(-10)}${C.reset}`);
  }

  if (status1 === 200 && result1?.verdict?.status === "APPROVED" && result1?.aiSignature) {
    scenario1Passed = true;
    console.log(`\n${C.bold}${C.green}✔ STATUS SKENARIO 1: LOLOS (Transaksi sah dan berhasil mendapatkan tanda tangan AI)${C.reset}\n`);
  } else {
    console.log(`\n${C.bold}${C.red}✖ STATUS SKENARIO 1: GAGAL${C.reset}\n`);
  }

  /* ========================================================================= */
  /* SKENARIO 2: Attack Path - Phishing Drainer (Unlimited Approval)           */
  /* ========================================================================= */
  console.log(`${C.bold}${C.red}────────────────────────────────────────────────────────────────────────────${C.reset}`);
  console.log(`${C.bold}${C.red}▶ SKENARIO 2: Attack Path - Phishing Drainer / Unlimited ERC-20 Allowance${C.reset}`);
  console.log(`${C.bold}${C.red}────────────────────────────────────────────────────────────────────────────${C.reset}`);

  const mockToken = getAddress("0x337610d27c682e347c9cd608137943050b300fe4"); // USDT di BSC Testnet
  const maliciousSpender = getAddress("0x000000000000000000000000000000000000dead"); // Kontrak phishing / drainer
  const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount)"]);
  const exploitCalldata = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [maliciousSpender, maxUint256],
  });
  const nonce2 = "1";
  const deadline2 = (Math.floor(Date.now() / 1000) + 3600).toString();

  console.log(`[Serangan] Pengguna tanpa sadar terpancing situs phishing yang meminta approval unlimited:`);
  console.log(`   • Target Token    : ${mockToken}`);
  console.log(`   • Spender Phishing: ${maliciousSpender}`);
  console.log(`   • Nilai Approval  : 2^256 - 1 (MaxUint256 - Unlimited Allowance)`);
  console.log(`   • Calldata Phish  : ${exploitCalldata}`);

  const message2 = {
    to: getAddress(mockToken),
    value: 0n,
    data: exploitCalldata,
    nonce: BigInt(nonce2),
    deadline: BigInt(deadline2),
  };

  const userSignature2 = await mockUser.signTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: "Transaction",
    message: message2,
  });
  console.log(`[User] Signature 1-of-2 EIP-712 terbubuhkan tanpa sengaja.`);

  console.log(`\n[Client] Mengirim permintaan verifikasi ke AI Guard Backend...`);
  let response2: Response | null = null;
  let result2: any = null;

  try {
    response2 = await fetch(`${baseUrl}/api/guard/sign-and-relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: walletAddress.toString(),
        to: mockToken.toString(),
        value: "0",
        data: exploitCalldata.toString(),
        nonce: nonce2,
        deadline: deadline2,
        userSignature: userSignature2.toString(),
        autoRelay: false,
      }),
    });
    result2 = await response2.json();
  } catch (err) {
    console.error(`${C.red}[Error Network]: ${(err as Error).message}${C.reset}`);
  }

  const status2 = response2 ? response2.status : 0;
  console.log(`[Backend Response Status]: ${status2 === 403 ? C.red + "403 Forbidden (DIBLOKIR)" : status2}${C.reset}`);

  if (status2 !== 403) {
    console.error(`${C.red}[Detail Galat Response]: ${JSON.stringify(result2, null, 2)}${C.reset}`);
  } else {
    console.log(`[AI Guard Verdict]       : ${result2?.verdict?.status === "REJECTED" ? C.red + "REJECTED ⛔" : result2?.verdict?.status}${C.reset}`);
    console.log(`[Risk Score]             : ${C.red}${result2?.verdict?.risk_score}/100 (KRITIS / SERANGAN TERDETEKSI)${C.reset}\n`);
    console.log(`${C.bold}📋 ANALISIS ANCAMAN KEAMANAN MENDALAM (COMPREHENSIVE THREAT REASON):${C.reset}`);
    console.log(`${C.yellow}────────────────────────────────────────────────────────────────────────────${C.reset}`);
    console.log(`${C.white}${result2?.verdict?.reason}${C.reset}`);
    console.log(`${C.yellow}────────────────────────────────────────────────────────────────────────────${C.reset}`);
  }

  if (status2 === 403 && result2?.verdict?.status === "REJECTED" && result2?.verdict?.risk_score >= 80) {
    scenario2Passed = true;
    console.log(`\n${C.bold}${C.green}✔ STATUS SKENARIO 2: LOLOS (Serangan phishing drainer berhasil ditangkal seketika!)${C.reset}\n`);
  } else {
    console.log(`\n${C.bold}${C.red}✖ STATUS SKENARIO 2: GAGAL (Serangan tidak terblokir sesuai spesifikasi)${C.reset}\n`);
  }

  /* ========================================================================= */
  /* SKENARIO 3: Attack Path - Obfuscated Multicall Drainer Wrapper (0xac9650d8)*/
  /* ========================================================================= */
  console.log(`${C.bold}${C.red}────────────────────────────────────────────────────────────────────────────${C.reset}`);
  console.log(`${C.bold}${C.red}▶ SKENARIO 3: Attack Path - Obfuscated Multicall Drainer Wrapper (0xac9650d8)${C.reset}`);
  console.log(`${C.bold}${C.red}────────────────────────────────────────────────────────────────────────────${C.reset}`);

  const MULTICALL_ABI = parseAbi(["function multicall(bytes[] data) returns (bytes[])"]);
  const multicallPayload = encodeFunctionData({
    abi: MULTICALL_ABI,
    functionName: "multicall",
    args: [[exploitCalldata]],
  });
  const nonce3 = "2";
  const deadline3 = (Math.floor(Date.now() / 1000) + 3600).toString();

  console.log(`[Serangan Canggih] Penyerang membungkus pemanggilan approve berbahaya di dalam batch multicall:`);
  console.log(`   • Target Router/Token : ${mockToken}`);
  console.log(`   • Selector Utama      : 0xac9650d8 (multicall batch wrapper)`);
  console.log(`   • Fungsi Tersembunyi  : approve(spender: ${maliciousSpender}, MaxUint256)`);
  console.log(`   • Calldata Batch      : ${multicallPayload.slice(0, 66)}...`);

  const message3 = {
    to: getAddress(mockToken),
    value: 0n,
    data: multicallPayload,
    nonce: BigInt(nonce3),
    deadline: BigInt(deadline3),
  };

  const userSignature3 = await mockUser.signTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: "Transaction",
    message: message3,
  });

  console.log(`\n[Client] Mengirim calldata multicall ke AI Guard Backend...`);
  let response3: Response | null = null;
  let result3: any = null;

  try {
    response3 = await fetch(`${baseUrl}/api/guard/sign-and-relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: walletAddress.toString(),
        to: mockToken.toString(),
        value: "0",
        data: multicallPayload.toString(),
        nonce: nonce3,
        deadline: deadline3,
        userSignature: userSignature3.toString(),
        autoRelay: false,
      }),
    });
    result3 = await response3.json();
  } catch (err) {
    console.error(`${C.red}[Error Network]: ${(err as Error).message}${C.reset}`);
  }

  const status3 = response3 ? response3.status : 0;
  console.log(`[Backend Response Status]: ${status3 === 403 ? C.red + "403 Forbidden (DIBLOKIR)" : status3}${C.reset}`);

  if (status3 !== 403) {
    console.error(`${C.red}[Detail Galat Response]: ${JSON.stringify(result3, null, 2)}${C.reset}`);
  } else {
    console.log(`[AI Guard Verdict]       : ${result3?.verdict?.status === "REJECTED" ? C.red + "REJECTED ⛔" : result3?.verdict?.status}${C.reset}`);
    console.log(`[Risk Score]             : ${C.red}${result3?.verdict?.risk_score}/100 (KRITIS / PEMBUNGKUS MULTICALL TERDETEKSI)${C.reset}\n`);
    console.log(`${C.bold}📋 ANALISIS ANCAMAN KEAMANAN (MULTICALL WRAPPER UNPACKED):${C.reset}`);
    console.log(`${C.yellow}────────────────────────────────────────────────────────────────────────────${C.reset}`);
    console.log(`${C.white}${result3?.verdict?.reason}${C.reset}`);
    console.log(`${C.yellow}────────────────────────────────────────────────────────────────────────────${C.reset}`);
  }

  const reasonStr = (result3?.verdict?.reason || "").toLowerCase();
  if (
    status3 === 403 &&
    result3?.verdict?.status === "REJECTED" &&
    result3?.verdict?.risk_score >= 80 &&
    (reasonStr.includes("multicall") || reasonStr.includes("approve"))
  ) {
    scenario3Passed = true;
    console.log(`\n${C.bold}${C.green}✔ STATUS SKENARIO 3: LOLOS (Eksekusi berbahaya di dalam pembungkus multicall terbongkar dan ditangkal!)${C.reset}\n`);
  } else {
    console.log(`\n${C.bold}${C.red}✖ STATUS SKENARIO 3: GAGAL${C.reset}\n`);
  }

  /* ========================================================================= */
  /* RINGKASAN AKHIR DEMO                                                      */
  /* ========================================================================= */
  console.log(`${C.bold}${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║                    HASIL AKHIR SIMULASI AI CO-SIGNER                       ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╠════════════════════════════════════════════════════════════════════════════╣${C.reset}`);
  console.log(`║ Skenario 1 (Transaksi Transfer Normal) : ${scenario1Passed ? C.green + "LOLOS (Approved)  " : C.red + "GAGAL           "}${C.cyan}║${C.reset}`);
  console.log(`║ Skenario 2 (Direct Unlimited Approval) : ${scenario2Passed ? C.green + "TERBLOKIR (Secure)" : C.red + "GAGAL           "}${C.cyan}║${C.reset}`);
  console.log(`║ Skenario 3 (Multicall Wrapped Drainer) : ${scenario3Passed ? C.green + "TERBLOKIR (Secure)" : C.red + "GAGAL           "}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}\n`);

  if (serverInstance) {
    serverInstance.close();
  }

  if (scenario1Passed && scenario2Passed && scenario3Passed) {
    console.log(`${C.bold}${C.green}🎉 SELURUH SKENARIO SIMULASI (TERMASUK MULTICALL) SELESAI DENGAN SUKSES!${C.reset}\n`);
    process.exit(0);
  } else {
    console.error(`${C.bold}${C.red}⚠️ Terdapat skenario yang tidak memenuhi ekspektasi.${C.reset}\n`);
    process.exit(1);
  }
}

// Jalankan simulasi
runSimulation().catch((err) => {
  console.error("Kesalahan fatal simulasi:", err);
  process.exit(1);
});
