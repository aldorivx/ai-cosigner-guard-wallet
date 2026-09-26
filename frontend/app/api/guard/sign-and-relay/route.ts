import { NextResponse } from "next/server";
import {
  getAddress,
  isAddress,
  formatEther,
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
import { validateTransaction, type TransactionPayload } from "@/lib/server/aiGuard";
import { signTransactionByAI } from "@/lib/server/coSigner";
import GuardWalletArtifact from "@/contracts/GuardWallet.json";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      to,
      value = "0",
      data = "0x",
      nonce,
      deadline,
      walletAddress: reqWalletAddress,
      userSignature,
      autoRelay = false,
    } = body;

    const walletAddress = reqWalletAddress || getGuardWalletAddress() || GUARD_WALLET_ADDRESS;

    // 1. Validasi parameter input dasar
    if (!to || !isAddress(to)) {
      return NextResponse.json(
        {
          success: false,
          error: "Parameter 'to' wajib diisi dengan alamat yang valid.",
        },
        { status: 400 }
      );
    }

    if (!walletAddress || !isAddress(walletAddress)) {
      return NextResponse.json(
        {
          success: false,
          error: "Parameter 'walletAddress' wajib diisi atau diset via GUARD_WALLET_ADDRESS.",
        },
        { status: 400 }
      );
    }

    if (nonce === undefined || nonce === null) {
      return NextResponse.json(
        {
          success: false,
          error: "Parameter 'nonce' wajib disertakan.",
        },
        { status: 400 }
      );
    }

    const calculatedDeadline = deadline
      ? BigInt(deadline)
      : BigInt(Math.floor(Date.now() / 1000) + 3600); // default 1 jam dari sekarang

    const txPayload: TransactionPayload = {
      to,
      value: value.toString(),
      data: data || "0x",
      nonce: nonce.toString(),
      deadline: calculatedDeadline.toString(),
    };

    console.log(`[Next.js API] Menerima permintaan verifikasi transaksi ke: ${to}`);

    // 2. Evaluasi keamanan via aiGuard
    const verdict = await validateTransaction(txPayload);
    console.log(`[Next.js API] Hasil AI Guard: ${verdict.status} (Skor Risiko: ${verdict.risk_score})`);

    // Jika transaksi ditolak oleh AI Guard, kembalikan status 403 Forbidden
    if (verdict.status === "REJECTED") {
      return NextResponse.json(
        {
          success: false,
          verdict,
          message: "Transaksi ditolak oleh AI Guard Co-Signer karena potensi risiko keamanan.",
        },
        { status: 403 }
      );
    }

    // 3. Jika APPROVED, buat signature EIP-712 dari AI Co-Signer
    const aiSignature = await signTransactionByAI(
      {
        to,
        value: txPayload.value,
        data: txPayload.data,
        nonce: txPayload.nonce!,
        deadline: calculatedDeadline.toString(),
      },
      walletAddress
    );

    console.log(`[Next.js API] Sukses menandatangani transaksi EIP-712 oleh AI Signer.`);

    // 4. (Opsional) Relay ke blockchain jika autoRelay diaktifkan
    if (autoRelay) {
      if (!userSignature) {
        return NextResponse.json(
          {
            success: false,
            verdict,
            aiSignature,
            error: "autoRelay aktif namun 'userSignature' belum disertakan.",
          },
          { status: 400 }
        );
      }

      const relayerPk = getRelayerPK() || RELAYER_PK;
      if (!relayerPk) {
        return NextResponse.json(
          {
            success: false,
            verdict,
            aiSignature,
            error: "RELAYER_PK belum dikonfigurasi pada server untuk melakukan broadcast transaksi.",
          },
          { status: 500 }
        );
      }

      console.log(`[Next.js API] Memulai relay transaksi ke BSC Testnet via Viem...`);
      const publicClient = getPublicClient();
      const formattedPk = (relayerPk.startsWith("0x") ? relayerPk : `0x${relayerPk}`) as Hex;
      const relayerAccount = privateKeyToAccount(formattedPk);

      const walletClient = createWalletClient({
        account: relayerAccount,
        chain: bscTestnet,
        transport: fallback(
          RPC_URLS.map((url) => http(url, { timeout: 8000 })),
          { rank: false }
        ),
      });

      // Pre-flight check: cek saldo vault jika ada pengiriman value native BNB
      const valueToSend = BigInt(txPayload.value.toString());
      if (valueToSend > 0n) {
        const vaultBalance = await publicClient.getBalance({
          address: getAddress(walletAddress),
        });
        if (vaultBalance < valueToSend) {
          return NextResponse.json(
            {
              success: false,
              verdict,
              aiSignature,
              error: `Saldo vault GuardWallet (${formatEther(vaultBalance)} tBNB) tidak mencukupi untuk transfer ${formatEther(valueToSend)} tBNB. Harap lakukan top-up tBNB ke GuardWallet.`,
            },
            { status: 400 }
          );
        }
      }

      const txHash = await walletClient.writeContract({
        address: getAddress(walletAddress),
        abi: GuardWalletArtifact.abi as any,
        functionName: "execute",
        args: [
          getAddress(to),
          BigInt(txPayload.value.toString()),
          (txPayload.data.startsWith("0x") ? txPayload.data : `0x${txPayload.data}`) as Hex,
          BigInt(txPayload.nonce!.toString()),
          calculatedDeadline,
          (userSignature.startsWith("0x") ? userSignature : `0x${userSignature}`) as Hex,
          (aiSignature.startsWith("0x") ? aiSignature : `0x${aiSignature}`) as Hex,
        ],
      });

      console.log(`[Next.js API] Transaksi di-broadcast dengan hash: ${txHash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      return NextResponse.json({
        success: true,
        verdict,
        aiSignature,
        relayed: true,
        txHash,
        blockNumber: Number(receipt.blockNumber),
      });
    }

    // Response standar jika tanpa autoRelay
    return NextResponse.json({
      success: true,
      verdict,
      aiSignature,
      relayed: false,
      deadline: calculatedDeadline.toString(),
    });
  } catch (error: any) {
    console.error("[Next.js API] Kesalahan internal server:", error);
    let errorMsg = error?.message || "Internal server error";
    if (error?.data === "0xacfdb444" || errorMsg.includes("0xacfdb444") || errorMsg.includes("ExecutionFailed")) {
      errorMsg = "Eksekusi transaksi gagal di smart contract (ExecutionFailed). Saldo vault tidak mencukupi atau kontrak target mengalami revert.";
    } else if (errorMsg.includes("InvalidNonce") || error?.data?.startsWith("0x0e5d1e8c")) {
      errorMsg = "Nonce transaksi tidak valid atau sudah digunakan (InvalidNonce). Harap refresh saldo dan coba kembali.";
    }
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
