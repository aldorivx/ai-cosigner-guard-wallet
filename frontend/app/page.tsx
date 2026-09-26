"use client";

import React, { useState, useEffect } from "react";
import { parseEther, formatEther, getAddress, isAddress } from "viem";
import { useAccount, useConnect, useDisconnect, useSignTypedData, useWriteContract, useSendTransaction } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import GuardWalletArtifact from "../contracts/GuardWallet.json";
import {
  ShieldCheck,
  ShieldAlert,
  Shield,
  KeyRound,
  ExternalLink,
  Copy,
  Check,
  ArrowRight,
  Sparkles,
  AlertOctagon,
  RefreshCw,
  Cpu,
  Wallet,
  CheckCircle,
  XCircle,
  FileCode2,
  Plus,
  Coins,
  Send,
  Loader2,
  Zap,
  X,
} from "lucide-react";

interface AppInfo {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  explorerUrl: string;
  guardWalletAddress: string;
  aiSignerAddress: string;
  relayerAddress: string;
  relayerConfigured: boolean;
}

interface WalletState {
  address: string;
  balance: string;
  balanceEther: string;
  nonce: number;
  owner: string;
  aiSigner: string;
  explorerUrl: string;
}

interface Verdict {
  status: "APPROVED" | "REJECTED";
  risk_score: number;
  reason: string;
}

function decodeCalldataPreview(data: string) {
  const clean = (data || "").trim().toLowerCase();
  if (!clean || clean === "0x") {
    return {
      type: "native",
      badge: "Native Transfer",
      color: "text-emerald-400 border-emerald-800/40 bg-emerald-950/40",
      description: "Transfer native BNB murni tanpa eksekusi smart contract (Risiko Sangat Rendah).",
      isDangerous: false,
    };
  }
  if (clean.startsWith("0x095ea7b3")) {
    const isUnlimited = clean.endsWith("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    return {
      type: "approve",
      badge: isUnlimited ? "BAHAYA: Unlimited Token Approval" : "Token Approval",
      color: isUnlimited
        ? "text-rose-400 border-rose-800/40 bg-rose-950/50"
        : "text-amber-400 border-amber-800/40 bg-amber-950/40",
      description: isUnlimited
        ? "Memberikan izin penarikan saldo token tanpa batas (MaxUint256) kepada kontrak target. Sangat berisiko eksploitasi drainer!"
        : "Memberikan izin penarikan token ke smart contract pihak ketiga.",
      isDangerous: isUnlimited,
    };
  }
  if (clean.startsWith("0xa9059cbb")) {
    return {
      type: "transfer",
      badge: "ERC-20 Token Transfer",
      color: "text-cyan-400 border-cyan-800/40 bg-cyan-950/40",
      description: "Pemanggilan fungsi transfer token ERC-20 standar.",
      isDangerous: false,
    };
  }
  return {
    type: "custom",
    badge: `Contract Call (${clean.slice(0, 10)})`,
    color: "text-purple-400 border-purple-800/40 bg-purple-950/40",
    description: "Pemanggilan smart contract kustom yang akan dianalisis secara semantik oleh Gemini AI Guard.",
    isDangerous: false,
  };
}

export default function DashboardPage() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [walletState, setWalletState] = useState<WalletState | null>(null);
  const [activeScenario, setActiveScenario] = useState<"safe" | "drainer" | "custom">("safe");
  const [copied, setCopied] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [autoRelay, setAutoRelay] = useState(true);
  const [demoSigner, setDemoSigner] = useState(true);

  // Wagmi hooks for wallet connection and on-chain interaction
  const { address: connectedAccount, isConnected } = useAccount();
  const { connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  // Top Up Modal & Action State
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("0.005");
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [topUpTxHash, setTopUpTxHash] = useState<string | null>(null);
  const [topUpSuccessMsg, setTopUpSuccessMsg] = useState<string | null>(null);
  const [topUpError, setTopUpError] = useState<string | null>(null);

  // Form Fields
  const [toAddress, setToAddress] = useState("");
  const [transferValue, setTransferValue] = useState("0.0005");
  const [calldata, setCalldata] = useState("0x");

  const calldataInfo = decodeCalldataPreview(calldata);

  // Inspection Results
  const [gateState, setGateState] = useState<"idle" | "evaluating" | "passed" | "blocked">("idle");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [userSignature, setUserSignature] = useState<string | null>(null);
  const [aiSignature, setAiSignature] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchAppInfo();
    fetchWalletState();
    const interval = setInterval(fetchWalletState, 12000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeScenario === "safe") {
      setToAddress(appInfo?.relayerAddress || "0x6543e13fC2F5b68655D537a2A637d31Fe98b42c0");
      setTransferValue("0.0005");
      setCalldata("0x");
    } else if (activeScenario === "drainer") {
      setToAddress("0x337610d27c682e347c9cd608137943050b300fe4"); // USDT BSC Testnet
      setTransferValue("0");
      // approve(0x000000000000000000000000000000000000dead, MaxUint256)
      setCalldata("0x095ea7b3000000000000000000000000000000000000000000000000000000000000deadffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    }
  }, [activeScenario, appInfo]);

  async function fetchAppInfo() {
    try {
      const res = await fetch("/api/info");
      if (res.ok) {
        const text = await res.text();
        try {
          setAppInfo(JSON.parse(text));
        } catch {}
      }
    } catch (e) {
      console.error("Info error:", e);
    }
  }

  async function fetchWalletState() {
    try {
      const res = await fetch("/api/wallet-state");
      if (res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          if (data.success) setWalletState(data);
        } catch {}
      }
    } catch (e) {
      console.error("Wallet state error:", e);
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleConnectMetaMask() {
    connect({ connector: injected() });
  }

  function handleDisconnect() {
    disconnect();
  }

  async function handleSendFromConnectedWallet() {
    if (!connectedAccount || !walletState?.address) return;
    setIsTopUpLoading(true);
    setTopUpError(null);
    setTopUpSuccessMsg(null);
    setTopUpTxHash(null);

    try {
      const hash = await sendTransactionAsync({
        to: getAddress(walletState.address),
        value: parseEther(topUpAmount || "0.005"),
      });
      setTopUpTxHash(hash);
      setTopUpSuccessMsg(`Berhasil mengirim ${topUpAmount} tBNB dari wallet terhubung!`);
      await fetchWalletState();
    } catch (err: any) {
      setTopUpError(err?.shortMessage || err?.message || "Gagal mengirim transaksi top-up.");
    } finally {
      setIsTopUpLoading(false);
    }
  }

  async function handleDemoRelayerTopUp(amount: string = "0.001") {
    setIsTopUpLoading(true);
    setTopUpError(null);
    setTopUpSuccessMsg(null);
    setTopUpTxHash(null);

    try {
      const res = await fetch("/api/vault/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          walletAddress: walletState?.address,
        }),
      });
      let data: any = {};
      try {
        const text = await res.text();
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned error (${res.status} ${res.statusText})`);
      }
      if (!data.success) {
        throw new Error(data.error || "Gagal melakukan top-up vault.");
      }
      setTopUpTxHash(data.txHash);
      setTopUpSuccessMsg(data.message || `Berhasil top up ${amount} tBNB dari Relayer!`);
      await fetchWalletState();
    } catch (err: any) {
      setTopUpError(err?.message || "Gagal top-up relayer.");
    } finally {
      setIsTopUpLoading(false);
    }
  }

  async function handleExecute() {
    setEvaluating(true);
    setGateState("evaluating");
    setErrorMessage(null);
    setTxHash(null);
    setBlockNumber(null);
    setVerdict(null);
    setUserSignature(null);
    setAiSignature(null);

    try {
      const valueWei = parseEther(transferValue || "0").toString();
      const currentNonce = walletState?.nonce ?? 0;
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const walletAddress = walletState?.address || appInfo?.guardWalletAddress || "";

      // Validasi saldo vault jika mengirim native BNB
      if (walletState && BigInt(valueWei) > BigInt(0) && BigInt(valueWei) > BigInt(walletState.balance || "0")) {
        throw new Error(
          `Saldo vault GuardWallet (${walletState.balanceEther} tBNB) tidak mencukupi untuk transfer ${transferValue} tBNB. Harap lakukan top-up saldo vault terlebih dahulu.`
        );
      }

      let signature = "";

      // Step 1: User ECDSA Signature (Key 1)
      if (demoSigner || !connectedAccount) {
        const signRes = await fetch("/api/demo/owner-sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress,
            to: toAddress,
            value: valueWei,
            data: calldata,
            nonce: currentNonce,
            deadline,
          }),
        });
        let signData: any = {};
        try {
          const signText = await signRes.text();
          signData = JSON.parse(signText);
        } catch {
          throw new Error(`Owner sign error: (${signRes.status} ${signRes.statusText})`);
        }
        if (!signData.success) throw new Error(signData.error || "Failed to obtain owner signature.");
        signature = signData.signature;
      } else {
        const targetAddress = isAddress(toAddress) ? getAddress(toAddress) : getAddress("0x0000000000000000000000000000000000000000");
        const verifyingContract = isAddress(walletAddress) ? getAddress(walletAddress) : getAddress("0x0000000000000000000000000000000000000000");

        signature = await signTypedDataAsync({
          domain: {
            name: "GuardWallet",
            version: "1",
            chainId: 97,
            verifyingContract,
          },
          types: {
            Transaction: [
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          primaryType: "Transaction",
          message: {
            to: targetAddress,
            value: BigInt(valueWei),
            data: (calldata || "0x") as `0x${string}`,
            nonce: BigInt(currentNonce),
            deadline: BigInt(deadline),
          },
        });
      }

      setUserSignature(signature);

      // Step 2: AI Co-Signer Gate (Key 2) & Broadcast
      const postRes = await fetch("/api/guard/sign-and-relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          to: toAddress,
          value: valueWei,
          data: calldata,
          nonce: currentNonce,
          deadline,
          userSignature: signature,
          autoRelay,
        }),
      });

      let resData: any = {};
      try {
        const postText = await postRes.text();
        resData = JSON.parse(postText);
      } catch {
        throw new Error(`AI Co-Signer error: (${postRes.status} ${postRes.statusText})`);
      }

      if (resData.verdict) {
        setVerdict(resData.verdict);
      }

      if (resData.success && resData.verdict?.status === "APPROVED") {
        setGateState("passed");
        setAiSignature(resData.aiSignature);
        if (resData.relayed && resData.txHash) {
          setTxHash(resData.txHash);
          setLastBlockNumber(resData.blockNumber);
          await fetchWalletState();
        } else if (!autoRelay && isConnected && resData.aiSignature) {
          // Direct execution mode via user's connected wallet using Wagmi useWriteContract!
          const txHashDirect = await writeContractAsync({
            address: getAddress(walletAddress),
            abi: GuardWalletArtifact.abi as any,
            functionName: "execute",
            args: [
              getAddress(toAddress),
              BigInt(valueWei),
              (calldata || "0x") as `0x${string}`,
              BigInt(currentNonce),
              BigInt(deadline),
              signature as `0x${string}`,
              resData.aiSignature as `0x${string}`,
            ],
          });
          setTxHash(txHashDirect);
          await fetchWalletState();
        }
      } else {
        setGateState("blocked");
        if (resData.error || resData.message) {
          setErrorMessage(resData.error || resData.message);
        }
      }
    } catch (err: any) {
      console.error("Audit error:", err);
      setGateState("blocked");
      setErrorMessage(err.message || "An unexpected error occurred during evaluation.");
    } finally {
      setEvaluating(false);
    }
  }

  function setLastBlockNumber(num: number) {
    setBlockNumber(num);
  }

  const riskScore = verdict?.risk_score ?? (gateState === "evaluating" ? 50 : 0);

  return (
    <div className="min-h-screen bg-vault-base text-slate-100 flex flex-col font-sans">
      {/* Top Telemetry Bar */}
      <header className="border-b border-vault-border bg-vault-surface/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-vault-card border border-vault-border flex items-center justify-center text-bnb-gold shadow-sm">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm tracking-tight text-white">AI Co-Signer Guard</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                  2-of-2 multisig
                </span>
              </div>
              <div className="text-[11px] text-slate-400">Pre-execution security barrier on BNB Smart Chain</div>
            </div>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            <div className="hidden sm:flex items-center space-x-2 px-2.5 py-1 rounded-md bg-vault-card border border-vault-border font-mono text-slate-300">
              <span className="w-2 h-2 rounded-full bg-bnb-gold animate-pulse"></span>
              <span>BSC Testnet (97)</span>
            </div>

            {isConnected ? (
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 rounded-md bg-vault-card hover:bg-vault-cardHover border border-emerald-800/40 text-emerald-400 transition flex items-center gap-1.5 font-medium"
                title="Click to disconnect"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>{`${connectedAccount?.slice(0, 6)}...${connectedAccount?.slice(-4)}`}</span>
              </button>
            ) : (
              <button
                onClick={handleConnectMetaMask}
                disabled={isConnecting}
                className="px-3 py-1.5 rounded-md bg-vault-card hover:bg-vault-cardHover border border-vault-border text-slate-200 transition flex items-center gap-1.5 font-medium"
              >
                <Wallet className="w-3.5 h-3.5 text-slate-400" />
                <span>{isConnecting ? "Connecting..." : "Connect MetaMask"}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Console */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* On-Chain Vault Ledger */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-vault-surface border border-vault-border flex flex-col justify-between">
            <span className="text-[11px] text-slate-400 font-medium">GuardWallet Contract</span>
            <div className="flex items-center justify-between mt-1">
              <a
                href={walletState?.explorerUrl || `https://testnet.bscscan.com/address/${walletState?.address}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-emerald-400 hover:underline truncate mr-2 font-medium"
              >
                {walletState?.address
                  ? `${walletState.address.slice(0, 8)}...${walletState.address.slice(-6)}`
                  : "Syncing..."}
              </a>
              <button
                onClick={() => handleCopy(walletState?.address || "")}
                className="text-slate-400 hover:text-white p-0.5"
                title="Copy Address"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="mt-2 text-[11px] text-slate-500 font-mono truncate">
              Owner: {walletState?.owner ? `${walletState.owner.slice(0, 6)}...${walletState.owner.slice(-4)}` : "..."}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-vault-surface border border-vault-border flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Vault Balance</span>
              <button
                onClick={() => setIsTopUpOpen(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-bnb-gold/15 hover:bg-bnb-gold/25 border border-bnb-gold/30 text-[11px] font-semibold text-bnb-gold transition-colors shadow-sm"
                title="Top Up tBNB ke Vault"
              >
                <Plus className="w-3 h-3" />
                <span>Top Up</span>
              </button>
            </div>
            <div className="flex items-baseline space-x-1.5 mt-1">
              <span className="text-xl font-bold font-mono text-white">
                {walletState?.balanceEther ? parseFloat(walletState.balanceEther).toFixed(4) : "0.0000"}
              </span>
              <span className="text-xs font-semibold text-bnb-gold">tBNB</span>
            </div>
            <div className="mt-2 text-[11px] text-slate-500 flex items-center justify-between font-mono">
              <span>Nonce: {walletState?.nonce ?? 0}</span>
              <button
                onClick={fetchWalletState}
                className="text-slate-400 hover:text-white flex items-center gap-1 font-sans text-[11px]"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-vault-surface border border-vault-border flex flex-col justify-between">
            <span className="text-[11px] text-slate-400 font-medium">AI Co-Signer Signer</span>
            <div className="flex items-center space-x-1.5 mt-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="text-xs font-mono text-slate-200 truncate">
                {appInfo?.aiSignerAddress
                  ? `${appInfo.aiSignerAddress.slice(0, 8)}...${appInfo.aiSignerAddress.slice(-6)}`
                  : "Listening"}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">Autonomous EIP-712 signer</div>
          </div>

          <div className="p-3.5 rounded-xl bg-vault-surface border border-vault-border flex flex-col justify-between">
            <span className="text-[11px] text-slate-400 font-medium">Decentralized Execution</span>
            <div className="text-xs font-medium text-slate-200 mt-1">Native ECDSA recovery</div>
            <div className="mt-2 text-[11px] text-emerald-400/90 font-mono">Zero ERC-4337 bundler dependency</div>
          </div>
        </section>

        {/* The Dual-Gate Arena */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Transaction Builder & Intent Preview (6 cols) */}
          <section className="lg:col-span-6 space-y-4">
            <div className="p-5 rounded-2xl bg-vault-surface border border-vault-border space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-vault-border">
                <h2 className="text-sm font-semibold text-white">Staged Transaction</h2>
                <div className="inline-flex rounded-lg bg-vault-base p-1 border border-vault-border text-xs">
                  <button
                    onClick={() => setActiveScenario("safe")}
                    className={`px-3 py-1 rounded-md transition font-medium ${
                      activeScenario === "safe"
                        ? "bg-emerald-600/90 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Safe Transfer
                  </button>
                  <button
                    onClick={() => setActiveScenario("drainer")}
                    className={`px-3 py-1 rounded-md transition font-medium ${
                      activeScenario === "drainer"
                        ? "bg-rose-600/90 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Drainer Attack
                  </button>
                  <button
                    onClick={() => setActiveScenario("custom")}
                    className={`px-3 py-1 rounded-md transition font-medium ${
                      activeScenario === "custom"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Custom
                  </button>
                </div>
              </div>

              {/* Quick Preset Selector for Custom Scenario */}
              {activeScenario === "custom" && (
                <div className="pt-2 border-t border-vault-border/60 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-medium mr-1">Preset Juri:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setToAddress(connectedAccount || appInfo?.relayerAddress || "");
                      setTransferValue("0.0001");
                      setCalldata("0x");
                    }}
                    className="px-2.5 py-1 rounded-lg bg-vault-base hover:bg-vault-card border border-vault-border text-[11px] text-slate-300 hover:text-white transition flex items-center gap-1 font-medium"
                    title="Kirim 0.0001 tBNB ke dompet juri yang terhubung"
                  >
                    <span>👤 Kirim ke Wallet Juri</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setToAddress("0x337610d27c682e347c9cd608137943050b300fe4");
                      setTransferValue("0");
                      setCalldata("0x095ea7b3000000000000000000000000000000000000000000000000000000000000deadffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-950/30 hover:bg-rose-950/50 border border-rose-800/40 text-[11px] text-rose-300 hover:text-rose-100 transition flex items-center gap-1 font-medium"
                    title="Simulasi serangan phishing token approval MaxUint256"
                  >
                    <span>🎁 Fake Airdrop Approval</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setToAddress(appInfo?.relayerAddress || "0x6543e13fC2F5b68655D537a2A637d31Fe98b42c0");
                      setTransferValue("0");
                      setCalldata("0x");
                    }}
                    className="px-2.5 py-1 rounded-lg bg-vault-base hover:bg-vault-card border border-vault-border text-[11px] text-slate-300 hover:text-white transition flex items-center gap-1 font-medium"
                    title="Uji transaksi 0 tBNB tanpa memindahkan saldo"
                  >
                    <span>⚡ Zero-Value Ping</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setToAddress("");
                      setTransferValue("0");
                      setCalldata("0x");
                    }}
                    className="px-2.5 py-1 rounded-lg bg-vault-base hover:bg-vault-card border border-vault-border text-[11px] text-slate-400 hover:text-white transition flex items-center gap-1"
                    title="Bersihkan seluruh isian form"
                  >
                    <span>🧹 Reset</span>
                  </button>
                </div>
              )}

              {/* Decoded Human-Readable Interpretation */}
              <div
                className={`p-3.5 rounded-xl border text-xs leading-relaxed space-y-1.5 transition ${
                  activeScenario === "drainer" || (activeScenario === "custom" && calldataInfo.isDangerous)
                    ? "bg-threat-crimsonBg border-threat-crimsonBorder text-rose-200"
                    : activeScenario === "custom" && calldataInfo.type === "custom"
                    ? "bg-purple-950/20 border-purple-800/40 text-purple-200"
                    : "bg-guardian-emeraldBg border-guardian-emeraldBorder text-emerald-200"
                }`}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  {activeScenario === "drainer" || (activeScenario === "custom" && calldataInfo.isDangerous) ? (
                    <>
                      <AlertOctagon className="w-4 h-4 text-rose-400" />
                      <span>
                        {activeScenario === "drainer"
                          ? "Simulated Exploit: Phishing Drainer Allowance"
                          : "Peringatan Eksploitasi: Terdeteksi Unlimited Allowance"}
                      </span>
                    </>
                  ) : activeScenario === "custom" && calldataInfo.type === "custom" ? (
                    <>
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span>Custom Smart Contract Call: Real-Time AI Semantic Audit</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span>
                        {activeScenario === "custom"
                          ? "Operasi Sah: Transfer Native BNB"
                          : "Legitimate Operation: Standard tBNB Transfer"}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-slate-300">
                  {activeScenario === "drainer"
                    ? "This call grants spender 0x000...dead permanent permission to withdraw 115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457,584,007,913,129,639,935 tokens (MaxUint256) without further notice."
                    : activeScenario === "custom"
                    ? calldataInfo.description
                    : "Transfers 0.0005 tBNB from the GuardWallet vault to the recipient. No smart contract approvals or dangerous permissions requested."}
                </p>
              </div>

              {/* Form Controls */}
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Target Contract / Recipient (to)</label>
                  <input
                    type="text"
                    value={toAddress}
                    onChange={(e) => setToAddress(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-vault-base border border-vault-border font-mono text-xs text-slate-100 focus:outline-none focus:border-slate-500"
                    placeholder="0x..."
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Native Value (tBNB)</label>
                  <input
                    type="text"
                    value={transferValue}
                    onChange={(e) => setTransferValue(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-vault-base border border-vault-border font-mono text-xs text-slate-100 focus:outline-none focus:border-slate-500"
                    placeholder="0.0"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium flex justify-between">
                    <span>Calldata Payload (data)</span>
                    <span className="font-mono text-slate-500">
                      {calldata === "0x" ? "0x (Native)" : `${calldata.slice(0, 10)}...${calldata.slice(-8)}`}
                    </span>
                  </label>
                  <textarea
                    rows={2}
                    value={calldata}
                    onChange={(e) => setCalldata(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-vault-base border border-vault-border font-mono text-[11px] text-slate-200 focus:outline-none focus:border-slate-500"
                  />
                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className="text-slate-400 font-medium">Tipe Panggilan Terdeteksi:</span>
                    <span className={`px-2 py-0.5 rounded-md font-mono text-[10px] border ${calldataInfo.color}`}>
                      {calldataInfo.badge}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between text-[11px] text-slate-400 border-t border-vault-border">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoRelay}
                      onChange={(e) => setAutoRelay(e.target.checked)}
                      className="rounded bg-vault-base border-vault-border text-emerald-500 focus:ring-0"
                    />
                    <span>Auto-relay to BSC Testnet (Gasless)</span>
                  </label>

                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={demoSigner}
                      onChange={(e) => setDemoSigner(e.target.checked)}
                      className="rounded bg-vault-base border-vault-border text-emerald-500 focus:ring-0"
                    />
                    <span>Use 1-Click Demo Signer</span>
                  </label>
                </div>

                <button
                  onClick={handleExecute}
                  disabled={evaluating}
                  className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2 ${
                    activeScenario === "drainer"
                      ? "bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-900/30"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30"
                  } ${evaluating ? "opacity-60 cursor-wait" : ""}`}
                >
                  <Cpu className="w-4 h-4" />
                  <span>
                    {evaluating
                      ? "Running AI Guardrail Inspection..."
                      : activeScenario === "drainer"
                      ? "Test Attack Interception"
                      : "Sign & Evaluate with AI Guard"}
                  </span>
                </button>
              </div>
            </div>
          </section>

          {/* Right: The 2-of-2 Cryptographic Gate (6 cols) */}
          <section className="lg:col-span-6 space-y-4">
            <div className="p-5 rounded-2xl bg-vault-surface border border-vault-border space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-vault-border">
                <h2 className="text-sm font-semibold text-white">2-of-2 Cryptographic Gate</h2>
                <span className="text-[11px] font-mono text-slate-500">
                  {gateState === "evaluating"
                    ? "Evaluating..."
                    : gateState === "passed"
                    ? "Gate Cleared"
                    : gateState === "blocked"
                    ? "Gate Locked"
                    : "Standby"}
                </span>
              </div>

              {/* Physical Representation of the 2 Required Keys */}
              <div className="grid grid-cols-2 gap-3">
                {/* Key 1: User ECDSA Signature */}
                <div
                  className={`p-3.5 rounded-xl border flex flex-col justify-between transition ${
                    userSignature
                      ? "bg-vault-card border-emerald-500/40 text-slate-100"
                      : "bg-vault-card border-vault-border text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Key 1: User Signature</span>
                    <KeyRound
                      className={`w-4 h-4 ${userSignature ? "text-emerald-400" : "text-slate-600"}`}
                    />
                  </div>
                  <div className="mt-3">
                    <span
                      className={`text-[11px] font-mono font-medium ${
                        userSignature ? "text-emerald-400" : "text-slate-500"
                      }`}
                    >
                      {userSignature ? "Signed (1-of-2 valid)" : "Awaiting signature"}
                    </span>
                    <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                      {userSignature || "Owner private key"}
                    </div>
                  </div>
                </div>

                {/* Key 2: AI Co-Signer Signature */}
                <div
                  className={`p-3.5 rounded-xl border flex flex-col justify-between transition ${
                    gateState === "passed" && aiSignature
                      ? "bg-vault-card border-emerald-500/40 text-slate-100"
                      : gateState === "blocked"
                      ? "bg-rose-950/40 border-rose-500/50 text-rose-200"
                      : "bg-vault-card border-vault-border text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Key 2: AI Co-Signer</span>
                    <Shield
                      className={`w-4 h-4 ${
                        gateState === "passed"
                          ? "text-emerald-400"
                          : gateState === "blocked"
                          ? "text-rose-400"
                          : "text-slate-600"
                      }`}
                    />
                  </div>
                  <div className="mt-3">
                    <span
                      className={`text-[11px] font-mono font-medium ${
                        gateState === "passed"
                          ? "text-emerald-400"
                          : gateState === "blocked"
                          ? "text-rose-400"
                          : "text-slate-500"
                      }`}
                    >
                      {gateState === "passed"
                        ? "Co-signed (2-of-2 cleared)"
                        : gateState === "blocked"
                        ? "Signature Refused (Locked)"
                        : "Gated by AI Audit"}
                    </span>
                    <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                      {aiSignature || (gateState === "blocked" ? "Pre-execution block" : "Gemini 2.5 Flash Guardrail")}
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk Gauge Bar */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Risk Assessment Score</span>
                  <span
                    className={`font-mono font-bold ${
                      riskScore >= 70
                        ? "text-rose-400"
                        : riskScore >= 40
                        ? "text-yellow-400"
                        : "text-emerald-400"
                    }`}
                  >
                    {riskScore} / 100
                  </span>
                </div>
                <div className="w-full bg-vault-base rounded-full h-2 overflow-hidden border border-vault-border">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      riskScore >= 70
                        ? "bg-rose-500"
                        : riskScore >= 40
                        ? "bg-yellow-500"
                        : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, riskScore))}%` }}
                  ></div>
                </div>
              </div>

              {/* AI Reasoning Readout */}
              <div className="space-y-1">
                <span className="text-xs text-slate-400 font-medium">Security Reasoning</span>
                <div className="p-3 rounded-xl bg-vault-base border border-vault-border text-xs text-slate-300 leading-relaxed font-sans min-h-[64px]">
                  {verdict?.reason ? (
                    <span className="text-slate-200">{verdict.reason}</span>
                  ) : errorMessage ? (
                    <span className="text-rose-300 font-medium">{errorMessage}</span>
                  ) : (
                    <span className="text-slate-500">
                      Select a staged scenario on the left and click Evaluate to initiate automated calldata audit.
                    </span>
                  )}
                </div>
              </div>

              {/* On-Chain Confirmation Result */}
              {txHash && (
                <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-emerald-300 font-medium">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span>Transaction Executed on BSC Testnet</span>
                    </span>
                    {blockNumber && <span className="font-mono text-emerald-400">Block #{blockNumber}</span>}
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] text-slate-300">
                    <span className="truncate mr-2">Tx: {txHash}</span>
                    <a
                      href={`https://testnet.bscscan.com/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 hover:underline flex items-center gap-1 flex-shrink-0 font-sans text-xs"
                    >
                      <span>BscScan</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Modal Top Up tBNB Vault */}
        {isTopUpOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
            <div className="w-full max-w-lg bg-vault-surface border border-vault-border rounded-2xl p-6 shadow-2xl space-y-5">
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-vault-border pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-bnb-gold/10 border border-bnb-gold/20 text-bnb-gold">
                    <Coins className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Top Up Saldo GuardWallet</h3>
                    <p className="text-xs text-slate-400">Danai vault kontrak multi-sig untuk mengeksekusi transaksi</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsTopUpOpen(false);
                    setTopUpSuccessMsg(null);
                    setTopUpError(null);
                    setTopUpTxHash(null);
                  }}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition"
                  title="Tutup"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Vault Info Badge */}
              <div className="p-3.5 rounded-xl bg-vault-base border border-vault-border space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Alamat GuardWallet (Vault Contract):</span>
                  <span className="font-mono text-emerald-400 font-semibold">
                    Saldo: {walletState?.balanceEther ? parseFloat(walletState.balanceEther).toFixed(4) : "0.0000"} tBNB
                  </span>
                </div>
                <div className="flex items-center justify-between bg-vault-surface/90 px-3 py-2 rounded-lg border border-vault-border font-mono text-xs text-slate-200">
                  <span className="truncate mr-2 font-medium">{walletState?.address || "Memuat alamat..."}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(walletState?.address || "")}
                    className="flex items-center gap-1 text-[11px] text-bnb-gold hover:text-yellow-300 font-sans font-semibold shrink-0"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? "Tersalin!" : "Salin"}</span>
                  </button>
                </div>
              </div>

              {/* Success / Error Messages */}
              {topUpSuccessMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-xs text-emerald-300 space-y-1.5 animate-fadeIn">
                  <div className="flex items-center gap-2 font-semibold text-emerald-300">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{topUpSuccessMsg}</span>
                  </div>
                  {topUpTxHash && (
                    <div className="pl-6">
                      <a
                        href={`https://testnet.bscscan.com/tx/${topUpTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-cyan-400 hover:underline font-mono text-[11px]"
                      >
                        <span>Lihat di BscScan ↗ ({topUpTxHash.slice(0, 10)}...{topUpTxHash.slice(-6)})</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {topUpError && (
                <div className="p-3.5 rounded-xl bg-rose-950/50 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2.5 animate-fadeIn">
                  <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{topUpError}</span>
                </div>
              )}

              {/* Method 1: Connected Web3 Wallet */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Wallet className="w-4 h-4 text-bnb-gold" />
                    <span>Metode 1: Transfer dari Web3 Wallet</span>
                  </label>
                  {isConnected ? (
                    <span className="text-[11px] text-emerald-400 font-mono">
                      Terhubung: {connectedAccount?.slice(0, 6)}...{connectedAccount?.slice(-4)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleConnectMetaMask}
                      className="text-[11px] text-bnb-gold hover:underline font-semibold"
                    >
                      Hubungkan MetaMask ↗
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {["0.001", "0.005", "0.01", "0.05"].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setTopUpAmount(preset)}
                        className={`flex-1 py-1 rounded-lg text-xs font-mono transition border ${
                          topUpAmount === preset
                            ? "bg-bnb-gold text-black font-bold border-bnb-gold"
                            : "bg-vault-base text-slate-300 border-vault-border hover:border-slate-500"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={topUpAmount}
                        onChange={(e) => setTopUpAmount(e.target.value)}
                        placeholder="0.005"
                        className="w-full px-3 py-2 pr-12 rounded-xl bg-vault-base border border-vault-border text-white text-xs font-mono focus:outline-none focus:border-bnb-gold"
                      />
                      <span className="absolute right-3 top-2 text-xs font-semibold text-slate-400">tBNB</span>
                    </div>
                    <button
                      type="button"
                      disabled={!isConnected || isTopUpLoading || !topUpAmount}
                      onClick={handleSendFromConnectedWallet}
                      className="px-4 py-2 rounded-xl bg-bnb-gold hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold text-xs whitespace-nowrap flex items-center gap-1.5 transition shadow-sm"
                    >
                      {isTopUpLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      <span>Kirim ke Vault</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="border-t border-vault-border pt-3 space-y-2.5">
                {/* Method 2: 1-Click Relayer Top Up */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-vault-base/60 border border-vault-border">
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Metode 2: Demo Relayer Instant Top-Up</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Kirim otomatis dari relayer server lokal untuk kemudahan pengujian juri
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isTopUpLoading}
                    onClick={() => handleDemoRelayerTopUp("0.001")}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold whitespace-nowrap transition disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                  >
                    {isTopUpLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    <span>+0.001 tBNB</span>
                  </button>
                </div>

                {/* Method 3: Official Faucet */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-vault-base/60 border border-vault-border">
                  <div>
                    <div className="text-xs font-semibold text-white flex items-center gap-1">
                      <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Metode 3: Faucet Resmi BNB Smart Chain</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Klaim hingga 0.3 tBNB gratis langsung dari faucet resmi BNB Chain
                    </p>
                  </div>
                  <a
                    href="https://www.bnbchain.org/en/testnet-faucet"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => handleCopy(walletState?.address || "")}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-semibold whitespace-nowrap transition flex items-center gap-1 shrink-0"
                  >
                    <span>Buka Faucet</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
