import { createPublicClient, http, fallback, defineChain, type PublicClient } from "viem";

export const bscTestnet = defineChain({
  id: 97,
  name: "BNB Smart Chain Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "BNB",
    symbol: "tBNB",
  },
  rpcUrls: {
    default: { http: ["https://bsc-testnet-rpc.publicnode.com"] },
  },
  blockExplorers: {
    default: {
      name: "BscScan",
      url: "https://testnet.bscscan.com",
    },
  },
  testnet: true,
});

export const RPC_URLS: string[] = [
  process.env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com",
  "https://bsc-testnet.rpc.sentio.xyz",
  "https://bnb-testnet.api.onfinality.io/public",
].filter(Boolean);

let cachedPublicClient: PublicClient | null = null;

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

export function getAISignerPK(): string {
  return process.env.AI_SIGNER_PK || "";
}

export function getGeminiApiKey(): string {
  return process.env.GEMINI_API_KEY || "";
}

export function getGuardWalletAddress(): string {
  return process.env.GUARD_WALLET_ADDRESS || "";
}

export function getRelayerPK(): string {
  return process.env.RELAYER_PK || "";
}

export const RELAYER_PK = process.env.RELAYER_PK || "";
export const AI_SIGNER_PK = process.env.AI_SIGNER_PK || "";
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const GUARD_WALLET_ADDRESS = process.env.GUARD_WALLET_ADDRESS || "";
export const PORT = Number(process.env.PORT) || 3000;
