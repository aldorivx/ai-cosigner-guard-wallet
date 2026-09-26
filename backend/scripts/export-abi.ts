import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { getGuardWalletAddress } from "../config";

/**
 * Script untuk mengekspor ABI dari hasil kompilasi Foundry ke backend dan frontend
 * agar ABI dan konfigurasi alamat kontrak selalu tersinkronisasi.
 */
function exportAbi() {
  const possiblePaths = [
    resolve(process.cwd(), "contracts/out/GuardWallet.sol/GuardWallet.json"),
    resolve(process.cwd(), "../contracts/out/GuardWallet.sol/GuardWallet.json"),
    resolve(__dirname, "../../contracts/out/GuardWallet.sol/GuardWallet.json"),
  ];

  let artifactPath = "";
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      artifactPath = p;
      break;
    }
  }

  if (!artifactPath) {
    console.error("❌ Error: Tidak dapat menemukan file artifact 'contracts/out/GuardWallet.sol/GuardWallet.json'. Pastikan telah menjalankan 'forge build' di direktori contracts.");
    process.exit(1);
  }

  console.log(`[Export ABI] Membaca artifact dari: ${artifactPath}`);
  const artifactContent = JSON.parse(readFileSync(artifactPath, "utf-8"));
  const abi = artifactContent.abi;

  const deployedAddress = getGuardWalletAddress() || "";

  const payload = {
    contractName: "GuardWallet",
    address: deployedAddress,
    chainId: 97,
    exportedAt: new Date().toISOString(),
    abi,
  };

  // 1. Ekspor ke backend/abi/GuardWallet.json
  const backendAbiDir = resolve(__dirname, "../abi");
  mkdirSync(backendAbiDir, { recursive: true });
  const backendDest = resolve(backendAbiDir, "GuardWallet.json");
  writeFileSync(backendDest, JSON.stringify(payload, null, 2));
  console.log(`[Export ABI] ✅ Sukses ekspor ke Backend: ${backendDest}`);

  // 2. Ekspor ke frontend/contracts/GuardWallet.json (jika direktori frontend ada)
  const frontendDir = resolve(__dirname, "../../frontend/contracts");
  try {
    mkdirSync(frontendDir, { recursive: true });
    const frontendDest = resolve(frontendDir, "GuardWallet.json");
    writeFileSync(frontendDest, JSON.stringify(payload, null, 2));
    console.log(`[Export ABI] ✅ Sukses ekspor ke Frontend: ${frontendDest}`);
  } catch (err) {
    console.warn(`[Export ABI] Catatan: Frontend directory belum dibuat (${(err as Error).message})`);
  }
}

exportAbi();
