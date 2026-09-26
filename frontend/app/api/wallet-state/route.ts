import { NextResponse } from "next/server";
import { getAddress, isAddress, formatEther, zeroAddress } from "viem";
import { getPublicClient, getGuardWalletAddress } from "@/lib/server/config";
import GuardWalletArtifact from "@/contracts/GuardWallet.json";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const walletAddress = getGuardWalletAddress();
    if (!walletAddress || !isAddress(walletAddress)) {
      return NextResponse.json(
        { success: false, error: "GUARD_WALLET_ADDRESS belum dikonfigurasi." },
        { status: 400 }
      );
    }

    const publicClient = getPublicClient();
    const checksummedAddress = getAddress(walletAddress);

    const [balance, nonce, owner, aiSigner] = await Promise.all([
      publicClient.getBalance({ address: checksummedAddress }),
      publicClient
        .readContract({
          address: checksummedAddress,
          abi: GuardWalletArtifact.abi as any,
          functionName: "nonce",
        })
        .catch(() => 0n),
      publicClient
        .readContract({
          address: checksummedAddress,
          abi: GuardWalletArtifact.abi as any,
          functionName: "owner",
        })
        .catch(() => zeroAddress),
      publicClient
        .readContract({
          address: checksummedAddress,
          abi: GuardWalletArtifact.abi as any,
          functionName: "aiSigner",
        })
        .catch(() => zeroAddress),
    ]);

    return NextResponse.json({
      success: true,
      address: walletAddress,
      balance: balance.toString(),
      balanceEther: formatEther(balance),
      nonce: Number(nonce),
      owner,
      aiSigner,
      explorerUrl: `https://testnet.bscscan.com/address/${walletAddress}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
