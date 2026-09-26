import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  getGuardWalletAddress,
  getAISignerPK,
  getRelayerPK,
} from "@/lib/server/config";
import { getAISignerAddress } from "@/lib/server/coSigner";

export const dynamic = "force-dynamic";

export async function GET() {
  const guardWalletAddress = getGuardWalletAddress();
  const aiSignerAddress = getAISignerAddress(getAISignerPK());
  const relayerPk = getRelayerPK();
  let relayerAddress = "";
  if (relayerPk) {
    try {
      const formattedPk = (relayerPk.startsWith("0x") ? relayerPk : `0x${relayerPk}`) as Hex;
      relayerAddress = privateKeyToAccount(formattedPk).address;
    } catch {}
  }

  return NextResponse.json({
    chainId: 97,
    chainName: "BNB Smart Chain Testnet",
    rpcUrl: "https://bsc-testnet-rpc.publicnode.com",
    explorerUrl: "https://testnet.bscscan.com",
    guardWalletAddress,
    aiSignerAddress,
    relayerAddress,
    relayerConfigured: Boolean(relayerPk),
    engine: "Viem v2",
  });
}
