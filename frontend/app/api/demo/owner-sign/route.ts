import { NextResponse } from "next/server";
import { getAddress, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getRelayerPK,
  getGuardWalletAddress,
} from "@/lib/server/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { to, value = "0", data = "0x", nonce, deadline, walletAddress: reqWalletAddress } = body;
    const relayerPk = getRelayerPK();
    if (!relayerPk) {
      return NextResponse.json(
        { success: false, error: "RELAYER_PK tidak ditemukan di server." },
        { status: 400 }
      );
    }
    const walletAddress = reqWalletAddress || getGuardWalletAddress();
    if (!walletAddress || !isAddress(walletAddress)) {
      return NextResponse.json(
        { success: false, error: "Alamat wallet tidak valid." },
        { status: 400 }
      );
    }

    const formattedPk = (relayerPk.startsWith("0x") ? relayerPk : `0x${relayerPk}`) as Hex;
    const ownerAccount = privateKeyToAccount(formattedPk);

    const domain = {
      name: "GuardWallet",
      version: "1",
      chainId: 97,
      verifyingContract: getAddress(walletAddress),
    } as const;

    const types = {
      Transaction: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    } as const;

    const signature = await ownerAccount.signTypedData({
      domain,
      types,
      primaryType: "Transaction",
      message: {
        to: getAddress(to),
        value: BigInt(value.toString()),
        data: (data && data.startsWith("0x") ? data : `0x${data || ""}`) as Hex,
        nonce: BigInt(nonce.toString()),
        deadline: BigInt(deadline.toString()),
      },
    });

    return NextResponse.json({ success: true, ownerAddress: ownerAccount.address, signature });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
