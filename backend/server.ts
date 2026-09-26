import express, { type Request, type Response } from "express";
import cors from "cors";
import {
  getAddress,
  isAddress,
  formatEther,
  parseEther,
  zeroAddress,
  createWalletClient,
  fallback,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import {
  PORT,
  RELAYER_PK,
  AI_SIGNER_PK,
  GUARD_WALLET_ADDRESS,
  RPC_URLS,
  getPublicClient,
  getGuardWalletAddress,
  getRelayerPK,
  getAISignerPK,
} from "./config";
import { validateTransaction, type TransactionPayload } from "./services/aiGuard";
import guardWalletArtifact from "./abi/GuardWallet.json";
import { signTransactionByAI, getAISignerAddress } from "./services/coSigner";

const app = express();

app.use(cors());
app.use(express.json());

// Fallback ABI jika file artifact belum ter-generate
const DEFAULT_ABI = parseAbi([
  "function execute(address to, uint256 value, bytes calldata data, uint256 _nonce, uint256 deadline, bytes calldata userSignature, bytes calldata aiSignature) external payable returns (bytes memory)",
  "function nonce() external view returns (uint256)",
  "function owner() external view returns (address)",
  "function aiSigner() external view returns (address)",
]);

const GUARD_WALLET_ABI = (guardWalletArtifact?.abi || DEFAULT_ABI) as any;

/**
 * Endpoint Utama: POST /api/guard/sign-and-relay
 * Alur:
 * 1. Menerima payload transaksi dari user
 * 2. Memvalidasi risiko transaksi via AI Guard (Gemini 2.5 Flash + Guardrails)
 * 3. Jika APPROVED, menandatangani typed data EIP-712 dengan AI Signer PK
 * 4. (Opsional) Me-relay transaksi langsung ke blockchain via Relayer jika autoRelay=true
 */
app.post("/api/guard/sign-and-relay", async (req: Request, res: Response) => {
  try {
    const {
      to,
      value = "0",
      data = "0x",
      nonce,
      deadline,
      walletAddress: reqWalletAddress,
      userSignature,
      autoRelay = false,
    } = req.body;

    const walletAddress = reqWalletAddress || getGuardWalletAddress() || GUARD_WALLET_ADDRESS;

    // 1. Validasi parameter input dasar
    if (!to || !isAddress(to)) {
      return res.status(400).json({
        success: false,
        error: "Parameter 'to' wajib diisi dengan alamat yang valid.",
      });
    }

    if (!walletAddress || !isAddress(walletAddress)) {
      return res.status(400).json({
        success: false,
        error: "Parameter 'walletAddress' wajib diisi atau diset via GUARD_WALLET_ADDRESS.",
      });
    }

    if (nonce === undefined || nonce === null) {
      return res.status(400).json({
        success: false,
        error: "Parameter 'nonce' wajib disertakan.",
      });
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

    console.log(`[Server] Menerima permintaan verifikasi transaksi ke: ${to}`);

    // 2. Evaluasi keamanan via aiGuard
    const verdict = await validateTransaction(txPayload);
    console.log(`[Server] Hasil AI Guard: ${verdict.status} (Skor Risiko: ${verdict.risk_score})`);

    // Jika transaksi ditolak oleh AI Guard, kembalikan status 403 Forbidden
    if (verdict.status === "REJECTED") {
      return res.status(403).json({
        success: false,
        verdict,
        message: "Transaksi ditolak oleh AI Guard Co-Signer karena potensi risiko keamanan.",
      });
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

    console.log(`[Server] Sukses menandatangani transaksi EIP-712 oleh AI Signer.`);

    // 4. (Opsional) Relay ke blockchain jika autoRelay diaktifkan
    if (autoRelay) {
      if (!userSignature) {
        return res.status(400).json({
          success: false,
          verdict,
          aiSignature,
          error: "autoRelay aktif namun 'userSignature' belum disertakan.",
        });
      }

      const relayerPk = getRelayerPK() || RELAYER_PK;
      if (!relayerPk) {
        return res.status(500).json({
          success: false,
          verdict,
          aiSignature,
          error: "RELAYER_PK belum dikonfigurasi pada server untuk melakukan broadcast transaksi.",
        });
      }

      console.log(`[Server] Memulai relay transaksi ke BSC Testnet via Viem...`);
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
          return res.status(400).json({
            success: false,
            verdict,
            aiSignature,
            error: `Saldo vault GuardWallet (${formatEther(vaultBalance)} tBNB) tidak mencukupi untuk transfer ${formatEther(valueToSend)} tBNB. Harap lakukan top-up tBNB ke GuardWallet.`,
          });
        }
      }

      const txHash = await walletClient.writeContract({
        address: getAddress(walletAddress),
        abi: GUARD_WALLET_ABI,
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

      console.log(`[Server] Transaksi di-broadcast dengan hash: ${txHash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      return res.status(200).json({
        success: true,
        verdict,
        aiSignature,
        relayed: true,
        txHash,
        blockNumber: Number(receipt.blockNumber),
      });
    }

    // Response standar jika tanpa autoRelay
    return res.status(200).json({
      success: true,
      verdict,
      aiSignature,
      relayed: false,
      deadline: calculatedDeadline.toString(),
    });
  } catch (error: any) {
    console.error("[Server] Kesalahan internal server:", error);
    let errorMsg = error?.message || "Internal server error";
    if (error?.data === "0xacfdb444" || errorMsg.includes("0xacfdb444") || errorMsg.includes("ExecutionFailed")) {
      errorMsg = "Eksekusi transaksi gagal di smart contract (ExecutionFailed). Saldo vault tidak mencukupi atau kontrak target mengalami revert.";
    } else if (errorMsg.includes("InvalidNonce") || error?.data?.startsWith("0x0e5d1e8c")) {
      errorMsg = "Nonce transaksi tidak valid atau sudah digunakan (InvalidNonce). Harap refresh saldo dan coba kembali.";
    }
    return res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

// Root service status endpoint
app.get("/", (_req: Request, res: Response) => {
  res.json({
    service: "AI Co-Signer Guardian Backend API",
    status: "running",
    engine: "Viem v2",
    chainId: 97,
    network: "BNB Smart Chain Testnet",
    frontendUrl: "http://localhost:3001",
    endpoints: {
      verifyAndRelay: "POST /api/guard/sign-and-relay",
      walletState: "GET /api/wallet-state",
      topUp: "POST /api/vault/topup",
      info: "GET /api/info",
      health: "GET /health",
    },
  });
});

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "OK",
    engine: "Viem v2",
    aiSignerAddress: getAISignerAddress(getAISignerPK()),
    guardWalletConfigured: Boolean(getGuardWalletAddress()),
  });
});

// Info configuration endpoint
app.get("/api/info", (_req: Request, res: Response) => {
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

  res.json({
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
});

// Real-time On-Chain Wallet State
app.get("/api/wallet-state", async (_req: Request, res: Response) => {
  try {
    const walletAddress = getGuardWalletAddress();
    if (!walletAddress || !isAddress(walletAddress)) {
      return res.status(400).json({ success: false, error: "GUARD_WALLET_ADDRESS belum dikonfigurasi." });
    }

    const publicClient = getPublicClient();
    const checksummedAddress = getAddress(walletAddress);

    const [balance, nonce, owner, aiSigner] = await Promise.all([
      publicClient.getBalance({ address: checksummedAddress }),
      publicClient
        .readContract({
          address: checksummedAddress,
          abi: GUARD_WALLET_ABI,
          functionName: "nonce",
        })
        .catch(() => 0n),
      publicClient
        .readContract({
          address: checksummedAddress,
          abi: GUARD_WALLET_ABI,
          functionName: "owner",
        })
        .catch(() => zeroAddress),
      publicClient
        .readContract({
          address: checksummedAddress,
          abi: GUARD_WALLET_ABI,
          functionName: "aiSigner",
        })
        .catch(() => zeroAddress),
    ]);

    return res.json({
      success: true,
      address: walletAddress,
      balance: balance.toString(),
      balanceEther: formatEther(balance),
      nonce: Number(nonce),
      owner,
      aiSigner,
      explorerUrl: `https://testnet.bscscan.com/address/${walletAddress}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Helper endpoint to top up vault tBNB for testing/demo purposes
app.post("/api/vault/topup", async (req: Request, res: Response) => {
  try {
    const { amount = "0.001", walletAddress: reqWalletAddress } = req.body;
    const relayerPk = getRelayerPK() || RELAYER_PK;
    if (!relayerPk) {
      return res.status(500).json({ success: false, error: "RELAYER_PK belum dikonfigurasi di server." });
    }

    const walletAddress = reqWalletAddress || getGuardWalletAddress() || GUARD_WALLET_ADDRESS;
    if (!walletAddress || !isAddress(walletAddress)) {
      return res.status(400).json({ success: false, error: "Alamat vault target tidak valid." });
    }

    const publicClient = getPublicClient();
    const formattedPk = (relayerPk.startsWith("0x") ? relayerPk : `0x${relayerPk}`) as Hex;
    const relayerAccount = privateKeyToAccount(formattedPk);

    const relayerBalance = await publicClient.getBalance({ address: relayerAccount.address });
    const topUpWei = parseEther(amount.toString());

    if (relayerBalance < topUpWei) {
      return res.status(400).json({
        success: false,
        error: `Saldo relayer (${formatEther(relayerBalance)} tBNB) tidak mencukupi untuk mendanai ${amount} tBNB. Harap gunakan faucet manual atau transfer dari wallet pribadi.`,
      });
    }

    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: bscTestnet,
      transport: fallback(
        RPC_URLS.map((url) => http(url, { timeout: 8000 })),
        { rank: false }
      ),
    });

    console.log(`[Server] Mengirim top-up ${amount} tBNB ke vault ${walletAddress}...`);
    const txHash = await walletClient.sendTransaction({
      to: getAddress(walletAddress),
      value: topUpWei,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Server] Top-up sukses di block ${receipt.blockNumber} (tx: ${txHash})`);

    return res.json({
      success: true,
      txHash,
      blockNumber: Number(receipt.blockNumber),
      amount: amount.toString(),
      walletAddress,
      message: `Berhasil top up ${amount} tBNB ke GuardWallet!`,
    });
  } catch (error) {
    console.error("[Server] Gagal melakukan top-up vault:", error);
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Helper for Demo Mode: Owner EIP-712 Sign
app.post("/api/demo/owner-sign", async (req: Request, res: Response) => {
  try {
    const { to, value = "0", data = "0x", nonce, deadline, walletAddress: reqWalletAddress } = req.body;
    const relayerPk = getRelayerPK();
    if (!relayerPk) {
      return res.status(400).json({ success: false, error: "RELAYER_PK tidak ditemukan di server." });
    }
    const walletAddress = reqWalletAddress || getGuardWalletAddress();
    if (!walletAddress || !isAddress(walletAddress)) {
      return res.status(400).json({ success: false, error: "Alamat wallet tidak valid." });
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

    return res.json({ success: true, ownerAddress: ownerAccount.address, signature });
  } catch (error) {
    return res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Jalankan server jika dieksekusi langsung
if (import.meta.main || process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`AI Co-Signer Backend Service (Viem engine) aktif di port ${PORT}`);
    console.log(`Alamat AI Signer: ${getAISignerAddress(getAISignerPK())}`);
  });
}

export default app;
