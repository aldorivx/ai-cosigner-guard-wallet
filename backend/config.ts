import { createPublicClient, http, fallback, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";
import { readFileSync, existsSync } from "fs";

/**
 * Konfigurasi lingkungan untuk AI Co-Signer Guard Wallet.
 * Memuat variabel dari .env dan fallback ke .env.example jika belum ada/kosong.
 */
function parseEnvVal(raw: string): string {
  let val = raw.trim();
  if (val.startsWith('"')) {
    const end = val.indexOf('"', 1);
    if (end !== -1) return val.slice(1, end);
  } else if (val.startsWith("'")) {
    const end = val.indexOf("'", 1);
    if (end !== -1) return val.slice(1, end);
  } else {
    const commentIdx = val.indexOf("#");
    if (commentIdx !== -1) {
      val = val.slice(0, commentIdx).trim();
    }
  }
  return val;
}

export function loadEnv() {
  const envCandidates = [".env", "../.env"];
  for (const envPath of envCandidates) {
    if (existsSync(envPath)) {
      try {
        const lines = readFileSync(envPath, "utf-8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = parseEnvVal(trimmed.slice(eqIdx + 1));
            if (val !== "") {
              process.env[key] = val;
            }
          }
        }
        break;
      } catch {}
    }
  }
  const exampleCandidates = [".env.example", "../.env.example"];
  for (const examplePath of exampleCandidates) {
    if (existsSync(examplePath)) {
      try {
        const lines = readFileSync(examplePath, "utf-8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = parseEnvVal(trimmed.slice(eqIdx + 1));
            if ((!process.env[key] || process.env[key] === "") && val !== "") {
              process.env[key] = val;
            }
          }
        }
        break;
      } catch {}
    }
  }
}

// Muat env saat inisialisasi modul
loadEnv();

// Array RPC URLs fallback untuk BNB Smart Chain Testnet (Chain ID 97)
export const RPC_URLS: string[] = [
  process.env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com",
  "https://bsc-testnet.rpc.sentio.xyz",
  "https://bnb-testnet.api.onfinality.io/public",
].filter(Boolean);

let cachedPublicClient: PublicClient | null = null;

/**
 * Mendapatkan instance Viem PublicClient dengan transport fallback multi-RPC untuk BSC Testnet.
 */
export function getPublicClient(): PublicClient {
  if (!cachedPublicClient) {
    cachedPublicClient = createPublicClient({
      chain: bscTestnet,
      transport: fallback(
        RPC_URLS.map((url) => http(url, { timeout: 8000 })),
        { rank: false }
      ),
    });
  }
  return cachedPublicClient;
}

// Getter dinamis untuk memastikan nilai selalu terbarui
export function getAISignerPK(): string {
  loadEnv();
  return process.env.AI_SIGNER_PK || "";
}

export function getGeminiApiKey(): string {
  loadEnv();
  return process.env.GEMINI_API_KEY || "";
}

export function getGuardWalletAddress(): string {
  loadEnv();
  return process.env.GUARD_WALLET_ADDRESS || "";
}

export function getRelayerPK(): string {
  loadEnv();
  return process.env.RELAYER_PK || "";
}

// Ekspor kredensial & environment variables
export const RELAYER_PK: string = process.env.RELAYER_PK || "";
export const AI_SIGNER_PK: string = process.env.AI_SIGNER_PK || "";
export const GEMINI_API_KEY: string = process.env.GEMINI_API_KEY || "";
export const GUARD_WALLET_ADDRESS: string = process.env.GUARD_WALLET_ADDRESS || "";
export const PORT: number = Number(process.env.PORT) || 3000;
