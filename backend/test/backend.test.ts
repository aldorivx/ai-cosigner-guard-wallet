import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  encodeFunctionData,
  parseAbi,
  parseEther,
  maxUint256,
  getAddress,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Server } from "http";
import app from "../server";
import { parseCalldata, parseCalldataInfo, validateTransaction } from "../services/aiGuard";
import {
  signTransactionByAI,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  BSC_TESTNET_CHAIN_ID,
  EIP712_TYPES,
} from "../services/coSigner";

describe("Backend AI Co-Signer Module", () => {
  const dummyWalletAddress = "0x1234567890123456789012345678901234567890";
  const dummyAiPk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const dummyAiAccount = privateKeyToAccount(dummyAiPk as Hex);
  const dummyAiSignerAddress = dummyAiAccount.address;

  let server: Server;
  let baseUrl: string;

  beforeAll((done) => {
    process.env.AI_SIGNER_PK = dummyAiPk;
    process.env.GUARD_WALLET_ADDRESS = dummyWalletAddress;

    server = app.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      done();
    });
  });

  afterAll((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  const ERC20_ABI = parseAbi([
    "function approve(address spender, uint256 amount)",
    "function transfer(address recipient, uint256 amount)",
  ]);
  const ERC721_ABI = parseAbi([
    "function setApprovalForAll(address operator, bool approved)",
  ]);

  describe("1. Calldata Parser & Guardrails", () => {
    it("harus mendeteksi ERC-20 approve normal", () => {
      const spender = "0x2222222222222222222222222222222222222222";
      const normalAmount = parseEther("100");
      const calldata = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, normalAmount],
      });

      const parsed = parseCalldata(calldata);
      expect(parsed.functionName).toBe("approve");
      expect(parsed.selector).toBe("0x095ea7b3");
      expect(parsed.warnings.includes("UNLIMITED_ALLOWANCE_DETECTED")).toBe(false);
    });

    it("harus mendeteksi dan menandai UNLIMITED_ALLOWANCE_DETECTED pada approve MaxUint256", () => {
      const spender = "0x2222222222222222222222222222222222222222";
      const calldata = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, maxUint256],
      });

      const parsed = parseCalldata(calldata);
      expect(parsed.functionName).toBe("approve");
      expect(parsed.warnings).toContain("UNLIMITED_ALLOWANCE_DETECTED");
      expect(parsed.params.permissionLabel).toBe("[UNLIMITED PERMISSION]");
      expect(parsed.summary).toContain("[UNLIMITED PERMISSION]");
    });

    it("harus langsung me-REJECT transaksi dengan unlimited allowance via guardrail dan memberikan analisis ancaman komprehensif", async () => {
      const spender = "0x2222222222222222222222222222222222222222";
      const calldata = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, maxUint256],
      });

      const verdict = await validateTransaction({
        to: dummyWalletAddress,
        value: "0",
        data: calldata,
      });

      expect(verdict.status).toBe("REJECTED");
      expect(verdict.risk_score).toBe(100);
      expect(verdict.reason).toContain("approve");
      expect(verdict.reason).toContain(spender);
      expect(verdict.reason).toContain("transferFrom");
    });

    it("harus mendeteksi ERC-20 increaseAllowance dengan [UNLIMITED PERMISSION]", () => {
      const ABI = parseAbi(["function increaseAllowance(address spender, uint256 addedValue)"]);
      const spender = "0x2222222222222222222222222222222222222222";
      const calldata = encodeFunctionData({
        abi: ABI,
        functionName: "increaseAllowance",
        args: [spender, maxUint256],
      });

      const parsed = parseCalldataInfo(calldata);
      expect(parsed.functionName).toBe("increaseAllowance");
      expect(parsed.warnings).toContain("UNLIMITED_ALLOWANCE_DETECTED");
      expect(parsed.params.permissionLabel).toBe("[UNLIMITED PERMISSION]");
      expect(parsed.params.spender).toBe(spender);
    });

    it("harus mendeteksi ERC-721 setApprovalForAll", () => {
      const operator = "0x3333333333333333333333333333333333333333";
      const calldata = encodeFunctionData({
        abi: ERC721_ABI,
        functionName: "setApprovalForAll",
        args: [operator, true],
      });

      const parsed = parseCalldata(calldata);
      expect(parsed.functionName).toBe("setApprovalForAll");
      expect(parsed.selector).toBe("0xa22cb465");
      expect(parsed.warnings).toContain("FULL_OPERATOR_APPROVAL_GRANTED");
      expect(parsed.params.permissionLabel).toBe("[FULL OPERATOR PERMISSION]");
    });

    it("harus mendeteksi transferOwnership", () => {
      const ABI = parseAbi(["function transferOwnership(address newOwner)"]);
      const newOwner = "0x6666666666666666666666666666666666666666";
      const calldata = encodeFunctionData({
        abi: ABI,
        functionName: "transferOwnership",
        args: [newOwner],
      });

      const parsed = parseCalldataInfo(calldata);
      expect(parsed.functionName).toBe("transferOwnership");
      expect(parsed.selector).toBe("0xf2fde38b");
      expect(parsed.warnings).toContain("TRANSFER_OWNERSHIP_DETECTED");
      expect(parsed.params.permissionLabel).toBe("[ADMINISTRATIVE OWNERSHIP TRANSFER]");
    });

    it("harus mendeteksi multicall (0xac9650d8) yang membungkus approve berbahaya", () => {
      const MULTICALL_ABI = parseAbi(["function multicall(bytes[] data) returns (bytes[])"]);
      const spender = "0x000000000000000000000000000000000000dead";
      const approveCall = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, maxUint256],
      });
      const calldata = encodeFunctionData({
        abi: MULTICALL_ABI,
        functionName: "multicall",
        args: [[approveCall]],
      });

      const parsed = parseCalldataInfo(calldata);
      expect(parsed.functionName).toBe("multicall");
      expect(parsed.selector).toBe("0xac9650d8");
      expect(parsed.warnings).toContain("MULTICALL_WRAPPER_DETECTED");
      expect(parsed.warnings).toContain("UNLIMITED_ALLOWANCE_DETECTED");
      expect(parsed.summary).toContain("MULTICALL WRAPPER DETECTED");
      expect(parsed.summary).toContain("approve");
    });

    it("harus mendeteksi ERC-20 transfer", () => {
      const recipient = "0x4444444444444444444444444444444444444444";
      const calldata = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [recipient, parseEther("5")],
      });

      const parsed = parseCalldata(calldata);
      expect(parsed.functionName).toBe("transfer");
      expect(parsed.selector).toBe("0xa9059cbb");
    });
  });

  describe("2. EIP-712 Co-Signer", () => {
    it("harus menandatangani data EIP-712 dan dapat di-recover ke alamat AI Signer", async () => {
      const tx = {
        to: "0x5555555555555555555555555555555555555555",
        value: parseEther("1").toString(),
        data: "0x",
        nonce: "0",
        deadline: "1890000000",
      };

      const signature = await signTransactionByAI(tx, dummyWalletAddress, dummyAiPk);
      expect(signature).toBeDefined();
      expect(signature.startsWith("0x")).toBe(true);

      const domain = {
        name: EIP712_DOMAIN_NAME,
        version: EIP712_DOMAIN_VERSION,
        chainId: BSC_TESTNET_CHAIN_ID,
        verifyingContract: getAddress(dummyWalletAddress),
      } as const;

      const message = {
        to: getAddress(tx.to),
        value: BigInt(tx.value),
        data: (tx.data.startsWith("0x") ? tx.data : `0x${tx.data}`) as Hex,
        nonce: BigInt(tx.nonce),
        deadline: BigInt(tx.deadline),
      };

      const recovered = await recoverTypedDataAddress({
        domain,
        types: EIP712_TYPES,
        primaryType: "Transaction",
        message,
        signature: signature as Hex,
      });

      expect(recovered.toLowerCase()).toBe(dummyAiSignerAddress.toLowerCase());
    });
  });

  describe("3. Express Server Endpoint: POST /api/guard/sign-and-relay", () => {
    it("harus merespons GET /health dengan status OK", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.status).toBe("OK");
      expect(json.engine).toBe("Viem v2");
    });

    it("harus menolak transaksi jika ada unlimited allowance", async () => {
      const calldata = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: ["0x7777777777777777777777777777777777777777", maxUint256],
      });

      const res = await fetch(`${baseUrl}/api/guard/sign-and-relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "0x8888888888888888888888888888888888888888",
          value: "0",
          data: calldata,
          nonce: 0,
          walletAddress: dummyWalletAddress,
        }),
      });

      expect(res.status).toBe(403);
      const json = (await res.json()) as any;
      expect(json.success).toBe(false);
      expect(json.verdict.status).toBe("REJECTED");
      expect(json.verdict.risk_score).toBe(100);
    });

    it("harus menyetujui transaksi normal dan mengembalikan aiSignature", async () => {
      const res = await fetch(`${baseUrl}/api/guard/sign-and-relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "0x9999999999999999999999999999999999999999",
          value: parseEther("0.1").toString(),
          data: "0x",
          nonce: 0,
          walletAddress: dummyWalletAddress,
          autoRelay: false,
        }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.verdict.status).toBe("APPROVED");
      expect(json.aiSignature).toBeDefined();
      expect(json.aiSignature.startsWith("0x")).toBe(true);
      expect(json.relayed).toBe(false);
    });
  });
});
