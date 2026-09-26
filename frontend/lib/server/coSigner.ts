import {
  getAddress,
  hashTypedData,
  zeroAddress,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AI_SIGNER_PK, GUARD_WALLET_ADDRESS, getAISignerPK, getGuardWalletAddress } from "./config";

export interface TransactionData {
  to: string;
  value: string | bigint | number;
  data: string;
  nonce: string | bigint | number;
  deadline: string | bigint | number;
}

export const EIP712_DOMAIN_NAME = "GuardWallet";
export const EIP712_DOMAIN_VERSION = "1";
export const BSC_TESTNET_CHAIN_ID = 97;

export const EIP712_TYPES = {
  Transaction: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * Menandatangani payload transaksi menggunakan private key AI Signer secara EIP-712 via Viem.
 * @param tx Data transaksi yang akan ditandatangani
 * @param walletAddress Alamat kontrak GuardWallet (verifyingContract)
 * @param privateKey Private key AI Signer (default: dynamic env)
 * @returns 65-byte EIP-712 ECDSA signature dalam format hex string
 */
export async function signTransactionByAI(
  tx: TransactionData,
  walletAddress?: string,
  privateKey?: string
): Promise<string> {
  const rawPk = privateKey || getAISignerPK() || process.env.AI_SIGNER_PK || AI_SIGNER_PK;
  const targetWallet =
    walletAddress || getGuardWalletAddress() || process.env.GUARD_WALLET_ADDRESS || GUARD_WALLET_ADDRESS;

  if (!rawPk) {
    throw new Error("AI_SIGNER_PK belum dikonfigurasi.");
  }
  if (!targetWallet || targetWallet === zeroAddress) {
    throw new Error("Alamat GuardWallet (verifyingContract) tidak valid atau kosong.");
  }

  const pk = (rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`) as Hex;
  const account = privateKeyToAccount(pk);

  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: BSC_TESTNET_CHAIN_ID,
    verifyingContract: getAddress(targetWallet),
  };

  const message = {
    to: getAddress(tx.to),
    value: BigInt(tx.value.toString()),
    data: (tx.data ? (tx.data.startsWith("0x") ? tx.data : `0x${tx.data}`) : "0x") as Hex,
    nonce: BigInt(tx.nonce.toString()),
    deadline: BigInt(tx.deadline.toString()),
  };

  const signature = await account.signTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: "Transaction",
    message,
  });

  return signature;
}

/**
 * Menghitung digest hash EIP-712 typed data (identik dengan getTransactionHash di smart contract).
 */
export function getTransactionTypedHash(
  tx: TransactionData,
  walletAddress?: string
): string {
  const targetWallet =
    walletAddress || getGuardWalletAddress() || process.env.GUARD_WALLET_ADDRESS || GUARD_WALLET_ADDRESS;
  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: BSC_TESTNET_CHAIN_ID,
    verifyingContract: getAddress(targetWallet),
  };

  const message = {
    to: getAddress(tx.to),
    value: BigInt(tx.value.toString()),
    data: (tx.data ? (tx.data.startsWith("0x") ? tx.data : `0x${tx.data}`) : "0x") as Hex,
    nonce: BigInt(tx.nonce.toString()),
    deadline: BigInt(tx.deadline.toString()),
  };

  return hashTypedData({
    domain,
    types: EIP712_TYPES,
    primaryType: "Transaction",
    message,
  });
}

/**
 * Mendapatkan alamat signer dari AI Signer PK
 */
export function getAISignerAddress(privateKey?: string): string {
  const rawPk = privateKey || getAISignerPK() || process.env.AI_SIGNER_PK || AI_SIGNER_PK;
  if (!rawPk) return zeroAddress;
  try {
    const pk = (rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`) as Hex;
    return privateKeyToAccount(pk).address;
  } catch {
    return zeroAddress;
  }
}
