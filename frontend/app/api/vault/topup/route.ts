import { NextResponse } from "next/server";
import {
  getAddress,
  isAddress,
  formatEther,
  parseEther,
  createWalletClient,
  fallback,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  RELAYER_PK,
  GUARD_WALLET_ADDRESS,
  RPC_URLS,
  bscTestnet,
  getPublicClient,
  getGuardWalletAddress,
  getRelayerPK,
} from "@/lib/server/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { amount = "0.001", walletAddress: reqWalletAddress } = body;
    const relayerPk = getRelayerPK() || RELAYER_PK;
    if (!relayerPk) {
      return NextResponse.json(
        { success: false, error: "RELAYER_PK belum dikonfigurasi di server." },
        { status: 500 }
      );
    }

    const walletAddress = reqWalletAddress || getGuardWalletAddress() || GUARD_WALLET_ADDRESS;
    if (!walletAddress || !isAddress(walletAddress)) {
      return NextResponse.json(
        { success: false, error: "Alamat vault target tidak valid." },
        { status: 400 }
      );
    }

    const publicClient = getPublicClient();
    const formattedPk = (relayerPk.startsWith("0x") ? relayerPk : `0x${relayerPk}`) as Hex;
    const relayerAccount = privateKeyToAccount(formattedPk);

    const relayerBalance = await publicClient.getBalance({ address: relayerAccount.address });
    const topUpWei = parseEther(amount.toString());

    if (relayerBalance < topUpWei) {
      return NextResponse.json(
        {
          success: false,
          error: `Saldo relayer (${formatEther(relayerBalance)} tBNB) tidak mencukupi untuk mendanai ${amount} tBNB. Harap gunakan faucet manual atau transfer dari wallet pribadi.`,
        },
        { status: 400 }
      );
    }

    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: bscTestnet,
      transport: fallback(
        RPC_URLS.map((url) => http(url, { timeout: 8000 })),
        { rank: false }
      ),
    });

    console.log(`[Next.js API] Mengirim top-up ${amount} tBNB ke vault ${walletAddress}...`);
    const txHash = await walletClient.sendTransaction({
      to: getAddress(walletAddress),
      value: topUpWei,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Next.js API] Top-up sukses di block ${receipt.blockNumber} (tx: ${txHash})`);

    return NextResponse.json({
      success: true,
      txHash,
      blockNumber: Number(receipt.blockNumber),
      amount: amount.toString(),
      walletAddress,
      message: `Berhasil top up ${amount} tBNB ke GuardWallet!`,
    });
  } catch (error: any) {
    console.error("[Next.js API] Gagal melakukan top-up vault:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
