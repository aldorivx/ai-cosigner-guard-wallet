import { GoogleGenAI, Type } from "@google/genai";
import {
  decodeFunctionData,
  parseAbi,
  maxUint256,
  isAddress,
  zeroAddress,
  type Hex,
} from "viem";
import { GEMINI_API_KEY, getGeminiApiKey } from "../config";

export interface GuardVerdict {
  status: "APPROVED" | "REJECTED";
  risk_score: number;
  reason: string;
}

export interface TransactionPayload {
  to: string;
  value: string | bigint | number;
  data: string;
  nonce?: number | bigint | string;
  deadline?: number | bigint | string;
}

export interface ParsedCalldata {
  functionName: string;
  selector: string;
  params: Record<string, unknown>;
  isKnownSelector: boolean;
  warnings: string[];
  summary: string;
}

/**
 * System Instruction untuk Gemini AI Security Co-Signer.
 * Mendorong analisis dinamis, mendalam, dan membongkar calldata bersarang tanpa formula kaku.
 */
export const GUARDIAN_SYSTEM_INSTRUCTION = `
Anda adalah AI Security Co-Signer Guard Wallet di BNB Smart Chain (Chain ID 97 / BSC).
Tugas Anda adalah menganalisis calldata transaksi Web3 secara kritis dan membongkar upaya manipulasi atau penyamaran transaksi (termasuk pembungkus batch seperti multicall) sebelum memberikan otorisasi tanda tangan EIP-712.

ATURAN ANALISIS DINAMIS (WAJIB DIPATUHI):
1. HINDARI FORMAT KAKU: DILARANG mengulang formula kalimat template umum seperti menuliskan judul kaku "Vektor Serangan:", "Mekanisme Eksploitasi:", dsb.
2. SEBUTKAN PARAMETER KONKRET: Wajib menyebutkan alamat tujuan/operator/spender riil yang tertera pada calldata, nama fungsi asli yang dieksekusi (serta fungsi pembungkusnya seperti multicall jika ada), dan nilai aset/izin kuota yang diminta (misal: MaxUint256 atau tak terbatas).
3. JELASKAN SKENARIO EKSPLOITASI SPESIFIK: Paparkan secara presisi apa yang akan terjadi detik berikutnya setelah transaksi ditandatangani oleh korban (misalnya: penyerang mengeksekusi transferFrom untuk menguras token, memanfaatkan izin operator untuk mencuri seluruh NFT, atau menyamarkan pemanggilan berbahaya di dalam batch multicall agar lolos dari verifikasi dasar).
4. GAYA PENULISAN: Tuliskan alasan ('reason') dalam 2-3 kalimat yang tajam, teknis, edukatif, dan unik sesuai muatan calldata yang sedang diuji.
5. STANDAR KEPUTUSAN:
   - Jika terdapat indikasi drainer, unlimited token approval, full operator NFT, penyamaran calldata di multicall, atau pengalihan ownership: tetapkan status "REJECTED" dengan risk_score 75 - 100.
   - Jika transaksi merupakan transfer normal, interaksi kontrak wajar tanpa eskalasi hak izin: tetapkan status "APPROVED" dengan risk_score 0 - 30.
`;

// ABI Interfaces untuk decoding calldata yang umum
const COMMON_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function setApprovalForAll(address operator, bool approved)",
  "function transferOwnership(address newOwner)",
  "function transfer(address recipient, uint256 amount)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
]);

const MULTICALL_ABI = parseAbi([
  "function multicall(bytes[] data) returns (bytes[])",
  "function multicall(uint256 deadline, bytes[] data) returns (bytes[])",
]);

/**
 * Parser calldata untuk mendeteksi selector, membongkar wrapper multicall (0xac9650d8),
 * dan mengekstrak parameter transaksi umum:
 * - 0xac9650d8 / 0x5ae401dc (multicall): membongkar eksekusi bersarang di dalamnya
 * - 0x095ea7b3 (approve): spender, amount, deteksi [UNLIMITED PERMISSION]
 * - 0x3950935b / 0x39509351 (increaseAllowance): spender, addedValue, deteksi [UNLIMITED PERMISSION]
 * - 0xa22cb465 (setApprovalForAll): operator, approved boolean
 * - 0xd505accf (permit): owner, spender, value, deadline
 * - 0xf2fde38b (transferOwnership): newOwner address
 * - 0xa9059cbb (transfer): recipient, amount
 */
export function parseCalldataInfo(data: string): ParsedCalldata {
  if (!data || data === "0x" || data === "") {
    return {
      functionName: "nativeTransfer",
      selector: "0x",
      params: {},
      isKnownSelector: true,
      warnings: [],
      summary: "Fungsi: Native BNB Transfer (0x)",
    };
  }

  const cleanData = data.startsWith("0x") ? data : `0x${data}`;
  const selector = cleanData.slice(0, 10).toLowerCase();
  const warnings: string[] = [];

  // 1. Selector multicall: 0xac9650d8 dan 0x5ae401dc (Membongkar eksekusi tersembunyi / bersarang)
  if (selector === "0xac9650d8" || selector === "0x5ae401dc") {
    let subCalls: string[] = [];

    try {
      const decoded = decodeFunctionData({
        abi: MULTICALL_ABI,
        data: cleanData as Hex,
      });
      if (decoded.functionName === "multicall" && decoded.args) {
        if (Array.isArray(decoded.args[0])) {
          subCalls = decoded.args[0] as string[];
        } else if (Array.isArray(decoded.args[1])) {
          subCalls = decoded.args[1] as string[];
        }
      }
    } catch {
      // Fallback byte scan jika encoding non-standar
    }

    const knownEmbeddedSelectors = [
      { sel: "095ea7b3", name: "approve" },
      { sel: "a22cb465", name: "setApprovalForAll" },
      { sel: "d505accf", name: "permit" },
      { sel: "39509351", name: "increaseAllowance" },
      { sel: "3950935b", name: "increaseAllowance" },
      { sel: "f2fde38b", name: "transferOwnership" },
      { sel: "a9059cbb", name: "transfer" },
    ];

    const nestedCalls: ParsedCalldata[] = [];

    if (subCalls.length > 0) {
      for (const call of subCalls) {
        nestedCalls.push(parseCalldataInfo(call));
      }
    } else {
      for (const item of knownEmbeddedSelectors) {
        const idx = cleanData.indexOf(item.sel, 10);
        if (idx !== -1) {
          const sliceHex = `0x${cleanData.slice(idx)}`;
          nestedCalls.push(parseCalldataInfo(sliceHex));
        }
      }
    }

    let wrapperLabel = "";
    const dangerousNested = nestedCalls.find(
      (c) =>
        c.warnings.includes("UNLIMITED_ALLOWANCE_DETECTED") ||
        c.warnings.includes("FULL_OPERATOR_APPROVAL_GRANTED") ||
        c.warnings.includes("TRANSFER_OWNERSHIP_DETECTED") ||
        c.functionName === "approve" ||
        c.functionName === "setApprovalForAll" ||
        c.functionName === "permit"
    );

    if (dangerousNested) {
      warnings.push("MULTICALL_WRAPPER_DETECTED");
      if (dangerousNested.warnings.length > 0) {
        warnings.push(...dangerousNested.warnings);
      }

      const targetSpender =
        (dangerousNested.params.spender as string) ||
        (dangerousNested.params.operator as string) ||
        (dangerousNested.params.newOwner as string) ||
        "target tidak dikenal";

      const valAmount =
        (dangerousNested.params.amount as string) ||
        (dangerousNested.params.addedValue as string) ||
        (dangerousNested.params.value as string) ||
        (dangerousNested.params.isUnlimited ? "MaxUint256" : "berisiko");

      wrapperLabel = `MULTICALL WRAPPER DETECTED: Membungkus eksekusi berbahaya ${dangerousNested.functionName} ke target ${targetSpender} dengan nilai ${dangerousNested.params.isUnlimited ? "MaxUint256 [UNLIMITED PERMISSION]" : valAmount}`;
    }

    return {
      functionName: "multicall",
      selector,
      params: {
        totalCalls: nestedCalls.length,
        nestedCalls: nestedCalls.map((n) => ({
          functionName: n.functionName,
          selector: n.selector,
          params: n.params,
          warnings: n.warnings,
          summary: n.summary,
        })),
        dangerousNestedCall: dangerousNested
          ? {
              functionName: dangerousNested.functionName,
              selector: dangerousNested.selector,
              params: dangerousNested.params,
            }
          : null,
        multicallWrapperLabel: wrapperLabel || undefined,
      },
      isKnownSelector: true,
      warnings: Array.from(new Set(warnings)),
      summary: wrapperLabel || `Fungsi: multicall | Berisi ${nestedCalls.length} sub-calls`,
    };
  }

  // 2. Selector ERC-20 approve: 0x095ea7b3
  if (selector === "0x095ea7b3") {
    try {
      const decoded = decodeFunctionData({
        abi: COMMON_ABI,
        data: cleanData as Hex,
      });
      if (decoded.functionName === "approve" && decoded.args) {
        const [spender, amount] = decoded.args as [string, bigint];

        // Deteksi Unlimited Allowance: MaxUint256 atau mendekati 2^256-1
        const isUnlimited =
          amount >= maxUint256 - 1000n ||
          cleanData.toLowerCase().includes("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

        if (isUnlimited) {
          warnings.push("UNLIMITED_ALLOWANCE_DETECTED");
        }

        const permissionLabel = isUnlimited ? "[UNLIMITED PERMISSION]" : "[LIMITED PERMISSION]";

        return {
          functionName: "approve",
          selector,
          params: {
            spender,
            amount: amount.toString(),
            isUnlimited,
            permissionLabel,
          },
          isKnownSelector: true,
          warnings,
          summary: `Fungsi: approve | Spender: ${spender} | Nilai: ${amount.toString()} ${permissionLabel}`,
        };
      }
    } catch {
      warnings.push("FAILED_TO_DECODE_APPROVE");
    }
  }

  // 3. Selector increaseAllowance: 0x3950935b atau 0x39509351
  if (selector === "0x3950935b" || selector === "0x39509351") {
    try {
      let spender = "";
      let addedValue = 0n;

      try {
        const decoded = decodeFunctionData({
          abi: COMMON_ABI,
          data: cleanData as Hex,
        });
        if (decoded.functionName === "increaseAllowance" && decoded.args) {
          [spender, addedValue] = decoded.args as [string, bigint];
        }
      } catch {
        if (cleanData.length >= 138) {
          spender = `0x${cleanData.slice(34, 74)}`;
          addedValue = BigInt(`0x${cleanData.slice(74, 138)}`);
        }
      }

      if (spender) {
        const isUnlimited =
          addedValue >= maxUint256 - 1000n ||
          cleanData.toLowerCase().includes("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

        if (isUnlimited) {
          warnings.push("UNLIMITED_ALLOWANCE_DETECTED");
        }

        const permissionLabel = isUnlimited ? "[UNLIMITED PERMISSION]" : "[LIMITED PERMISSION]";

        return {
          functionName: "increaseAllowance",
          selector,
          params: {
            spender,
            addedValue: addedValue.toString(),
            isUnlimited,
            permissionLabel,
          },
          isKnownSelector: true,
          warnings,
          summary: `Fungsi: increaseAllowance | Spender: ${spender} | Nilai Tambahan: ${addedValue.toString()} ${permissionLabel}`,
        };
      }
    } catch {
      warnings.push("FAILED_TO_DECODE_INCREASE_ALLOWANCE");
    }
  }

  // 4. Selector ERC-721 setApprovalForAll: 0xa22cb465
  if (selector === "0xa22cb465") {
    try {
      const decoded = decodeFunctionData({
        abi: COMMON_ABI,
        data: cleanData as Hex,
      });
      if (decoded.functionName === "setApprovalForAll" && decoded.args) {
        const [operator, approved] = decoded.args as [string, boolean];

        if (approved) {
          warnings.push("FULL_OPERATOR_APPROVAL_GRANTED");
        }

        const permissionLabel = approved ? "[FULL OPERATOR PERMISSION]" : "[REVOKE OPERATOR PERMISSION]";

        return {
          functionName: "setApprovalForAll",
          selector,
          params: {
            operator,
            approved,
            permissionLabel,
          },
          isKnownSelector: true,
          warnings,
          summary: `Fungsi: setApprovalForAll | Operator: ${operator} | Status: ${approved ? "Disetujui [FULL OPERATOR PERMISSION]" : "Dicabut"}`,
        };
      }
    } catch {
      warnings.push("FAILED_TO_DECODE_SET_APPROVAL_FOR_ALL");
    }
  }

  // 5. Selector permit ERC-2612: 0xd505accf
  if (selector === "0xd505accf") {
    try {
      const decoded = decodeFunctionData({
        abi: COMMON_ABI,
        data: cleanData as Hex,
      });
      if (decoded.functionName === "permit" && decoded.args) {
        const [owner, spender, value, deadline] = decoded.args as [string, string, bigint, bigint];
        const isUnlimited =
          value >= maxUint256 - 1000n ||
          cleanData.toLowerCase().includes("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

        if (isUnlimited) {
          warnings.push("UNLIMITED_ALLOWANCE_DETECTED");
        }

        const permissionLabel = isUnlimited ? "[UNLIMITED PERMISSION]" : "[LIMITED PERMISSION]";

        return {
          functionName: "permit",
          selector,
          params: {
            owner,
            spender,
            value: value.toString(),
            deadline: deadline.toString(),
            isUnlimited,
            permissionLabel,
          },
          isKnownSelector: true,
          warnings,
          summary: `Fungsi: permit | Spender: ${spender} | Nilai: ${value.toString()} ${permissionLabel}`,
        };
      }
    } catch {
      warnings.push("FAILED_TO_DECODE_PERMIT");
    }
  }

  // 6. Selector transferOwnership: 0xf2fde38b
  if (selector === "0xf2fde38b") {
    try {
      const decoded = decodeFunctionData({
        abi: COMMON_ABI,
        data: cleanData as Hex,
      });
      if (decoded.functionName === "transferOwnership" && decoded.args) {
        const [newOwner] = decoded.args as [string];

        warnings.push("TRANSFER_OWNERSHIP_DETECTED");

        return {
          functionName: "transferOwnership",
          selector,
          params: {
            newOwner,
            permissionLabel: "[ADMINISTRATIVE OWNERSHIP TRANSFER]",
          },
          isKnownSelector: true,
          warnings,
          summary: `Fungsi: transferOwnership | Pemilik Baru: ${newOwner} [ADMINISTRATIVE OWNERSHIP TRANSFER]`,
        };
      }
    } catch {
      warnings.push("FAILED_TO_DECODE_TRANSFER_OWNERSHIP");
    }
  }

  // 7. Selector transfer (ERC-20): 0xa9059cbb
  if (selector === "0xa9059cbb") {
    try {
      const decoded = decodeFunctionData({
        abi: COMMON_ABI,
        data: cleanData as Hex,
      });
      if (decoded.functionName === "transfer" && decoded.args) {
        const [recipient, amount] = decoded.args as [string, bigint];

        return {
          functionName: "transfer",
          selector,
          params: {
            recipient,
            amount: amount.toString(),
          },
          isKnownSelector: true,
          warnings,
          summary: `Fungsi: transfer | Penerima: ${recipient} | Nilai: ${amount.toString()}`,
        };
      }
    } catch {
      warnings.push("FAILED_TO_DECODE_TRANSFER");
    }
  }

  // Fallback selector scanner untuk mendeteksi selector tersembunyi di sembarang calldata
  const embeddedKnown = [
    { sel: "095ea7b3", name: "approve" },
    { sel: "a22cb465", name: "setApprovalForAll" },
    { sel: "d505accf", name: "permit" },
    { sel: "39509351", name: "increaseAllowance" },
    { sel: "3950935b", name: "increaseAllowance" },
    { sel: "f2fde38b", name: "transferOwnership" },
  ];

  for (const item of embeddedKnown) {
    const idx = cleanData.indexOf(item.sel, 10);
    if (idx !== -1) {
      warnings.push("MULTICALL_WRAPPER_DETECTED");
      const embedded = parseCalldataInfo(`0x${cleanData.slice(idx)}`);
      if (embedded.warnings.length > 0) warnings.push(...embedded.warnings);

      const targetSpender = (embedded.params.spender as string) || (embedded.params.operator as string) || "target tidak dikenal";
      const valAmount = (embedded.params.amount as string) || (embedded.params.isUnlimited ? "MaxUint256" : "berisiko");
      const wrapperLabel = `MULTICALL WRAPPER DETECTED: Membungkus eksekusi berbahaya ${embedded.functionName} ke target ${targetSpender} dengan nilai ${embedded.params.isUnlimited ? "MaxUint256 [UNLIMITED PERMISSION]" : valAmount}`;

      return {
        functionName: `wrapped_${embedded.functionName}`,
        selector,
        params: {
          wrapperSelector: selector,
          embeddedFunction: embedded.functionName,
          embeddedParams: embedded.params,
          multicallWrapperLabel: wrapperLabel,
        },
        isKnownSelector: true,
        warnings: Array.from(new Set(warnings)),
        summary: wrapperLabel,
      };
    }
  }

  return {
    functionName: "unknown",
    selector,
    params: { rawData: cleanData },
    isKnownSelector: false,
    warnings: ["UNKNOWN_FUNCTION_SELECTOR"],
    summary: `Fungsi: unknown (Selector: ${selector})`,
  };
}

// Alias untuk menjaga kompatibilitas fungsi yang sudah ada
export const parseCalldata = parseCalldataInfo;

/**
 * Validasi keamanan transaksi menggunakan Gemini 3.6 Flash via SDK @google/genai.
 * Menerapkan Structured Outputs dan deteksi dinamis terhadap eksploitasi calldata bersarang.
 */
export async function validateTransaction(tx: TransactionPayload): Promise<GuardVerdict> {
  const parsed = parseCalldataInfo(tx.data);

  // Guardrail 1: Deteksi pembungkus multicall yang menyamarkan eksekusi berbahaya
  if (parsed.warnings.includes("MULTICALL_WRAPPER_DETECTED")) {
    const dangerous = (parsed.params.dangerousNestedCall as any) || (parsed.params.embeddedParams ? { functionName: parsed.params.embeddedFunction, params: parsed.params.embeddedParams } : null);
    const spender = dangerous?.params?.spender || dangerous?.params?.operator || (parsed.params.spender as string) || "kontrak tidak dikenal";
    const nestedFn = dangerous?.functionName || "eksekusi berbahaya";

    return {
      status: "REJECTED",
      risk_score: 100,
      reason: `Transaksi ini terdeteksi menggunakan pembungkus multicall (selector: ${parsed.selector}) untuk menyamarkan pemanggilan fungsi '${nestedFn}' ke target spender ${spender} pada kontrak ${tx.to}. Jika ditandatangani, penyerang dapat mengeksekusi transferFrom() atau penarikan aset sewaktu-waktu untuk menguras token korban tanpa memicu verifikasi transaksi tunggal. Penyamaran calldata bersarang di dalam multicall adalah taktik phishing drainer berbahaya yang otomatis diblokir oleh AI Guard.`,
    };
  }

  // Guardrail 2: Tolak seketika jika terdeteksi unlimited allowance langsung (0xffffff...)
  if (parsed.warnings.includes("UNLIMITED_ALLOWANCE_DETECTED")) {
    const spender = (parsed.params.spender as string) || "kontrak tidak dikenal";
    const funcName = parsed.functionName || "approve";
    return {
      status: "REJECTED",
      risk_score: 100,
      reason: `Transaksi memanggil fungsi '${funcName}' pada token ${tx.to} yang memberikan izin allowance tak terbatas (MaxUint256) kepada spender ${spender}. Begitu transaksi ini dikonfirmasi di blockchain, kontrak pihak ketiga tersebut dapat memanggil transferFrom() sewaktu-waktu dan menyedot seluruh saldo token BEP-20 pengguna tanpa perlu izin tambahan. Permintaan kuota tak terbatas ini terindikasi kuat sebagai skenario phishing drainer.`,
    };
  }

  // Guardrail 3: Validasi alamat tujuan dasar (tidak boleh zero address)
  if (!tx.to || tx.to.toLowerCase() === zeroAddress.toLowerCase() || !isAddress(tx.to)) {
    return {
      status: "REJECTED",
      risk_score: 95,
      reason: `Transaksi mengarah ke Zero Address (${zeroAddress}) atau format alamat tidak valid pada jaringan BNB Smart Chain. Mengirimkan saldo atau memanggil calldata ke alamat kosong akan membakar aset secara permanen dan membuang gas fee jaringan tanpa kemungkinan pemulihan. AI Guard menolak transaksi ini untuk mencegah hilangnya dana pengguna.`,
    };
  }

  const apiKey = GEMINI_API_KEY || getGeminiApiKey();

  // Jika GEMINI_API_KEY tidak dikonfigurasi (misalnya di local test offline), berikan evaluasi guardrail fallback
  if (!apiKey) {
    console.warn("[AIGuard] GEMINI_API_KEY tidak ditemukan. Menggunakan evaluasi guardrail fallback.");
    if (parsed.warnings.includes("FULL_OPERATOR_APPROVAL_GRANTED")) {
      const operator = (parsed.params.operator as string) || "tidak dikenal";
      return {
        status: "REJECTED",
        risk_score: 95,
        reason: `Transaksi memberikan izin operator penuh (setApprovalForAll) kepada ${operator} atas seluruh koleksi NFT pada kontrak ${tx.to}. Setelah transaksi ini aktif, operator tersebut memiliki wewenang penuh untuk memindahtangankan, menjual, atau melikuidasi semua token NFT milik pengguna tanpa konfirmasi per item. Pemberian wewenang operator tanpa batas waktu ini berisiko tinggi menguras seluruh portofolio NFT pengguna.`,
      };
    }
    if (parsed.warnings.includes("TRANSFER_OWNERSHIP_DETECTED")) {
      const newOwner = (parsed.params.newOwner as string) || "tidak dikenal";
      return {
        status: "REJECTED",
        risk_score: 98,
        reason: `Transaksi memicu fungsi transferOwnership untuk menyerahkan hak kepemilikan dan kendali administratif kontrak ${tx.to} kepada ${newOwner}. Detik berikutnya setelah transaksi ini diproses di mempool, pemilik asli akan kehilangan seluruh hak kendali istimewa, akses tata kelola, dan perbendaharaan kontrak. Eksekusi ini diblokir untuk mencegah pengambilalihan kontrak (hostile contract takeover).`,
      };
    }
    return {
      status: "APPROVED",
      risk_score: 10,
      reason: "Evaluasi Guardrail: Transaksi normal terverifikasi aman. Parameter transaksi sesuai standar transfer/interaksi wajar tanpa indikasi eskalasi izin berlebih atau vektor eksploitasi.",
    };
  }

  // Inisialisasi GoogleGenAI SDK
  const ai = new GoogleGenAI({ apiKey });

  // Schema terstruktur wajib
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      status: {
        type: Type.STRING,
        enum: ["APPROVED", "REJECTED"],
        description: "Status keputusan keamanan transaksi: APPROVED atau REJECTED",
      },
      risk_score: {
        type: Type.NUMBER,
        description: "Skor risiko dari 0 (sangat aman) hingga 100 (eksploitasi/bahaya kritis)",
      },
      reason: {
        type: Type.STRING,
        description: "Analisis teknis dinamis menjabarkan fungsi asli/pembungkus, alamat spender, nilai izin, dan skenario eksploitasi spesifik dalam 2-3 kalimat tajam.",
      },
    },
    required: ["status", "risk_score", "reason"],
  };

  const prompt = `
Lakukan analisis audit keamanan pra-eksekusi terhadap transaksi Web3 berikut di BNB Smart Chain (Chain ID 97):

[INFORMASI TRANSAKSI]
- Kontrak Target / Penerima: ${tx.to}
- Nilai Native (BNB): ${tx.value ? tx.value.toString() : "0"} wei
- Fungsi Terdeteksi: ${parsed.functionName} (Selector: ${parsed.selector})
- Ringkasan Calldata: ${parsed.summary}
- Parameter Terekstraksi:
${JSON.stringify(parsed.params, null, 2)}
- Indikasi Peringatan Parser:
${JSON.stringify(parsed.warnings)}
- Raw Calldata: ${tx.data || "0x"}

[PEDOMAN EVALUASI KEAMANAN]:
1. HINDARI FORMULA TEMPLATE KAKU: Jangan menggunakan awalan kaku seperti "Vektor Serangan:" atau "Mekanisme Eksploitasi:".
2. SEBUTKAN PARAMETER KONKRET: Sebutkan alamat target/spender (${tx.to}), nama fungsi (termasuk pembungkus multicall jika ada), dan nilai izin/aset secara eksplisit.
3. JELASKAN SKENARIO EKSPLOITASI: Apa yang terjadi detik berikutnya setelah transaksi ini ditandatangani oleh pengguna?
4. TULISKAN DALAM 2-3 KALIMAT TAJAM DAN SPESIFIK.
`;

  try {
    const modelName = process.env.GEMINI_MODEL || "gemini-3.6-flash";
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction: GUARDIAN_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.1,
      },
    });

    const rawText = response.text || "";
    // Logging wajib debugging output model
    console.log("[AI Raw Output]:", rawText);

    const cleanedText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    if (!cleanedText) {
      throw new Error("Respon kosong dari model Gemini.");
    }

    let verdict: GuardVerdict;
    try {
      verdict = JSON.parse(cleanedText) as GuardVerdict;
      if (!verdict.status || typeof verdict.risk_score !== "number" || !verdict.reason) {
        throw new Error("Format JSON tidak memuat field wajib: status, risk_score, reason");
      }
    } catch (parseErr) {
      console.warn("[AIGuard] Gagal parse JSON hasil sanitasi:", (parseErr as Error).message);
      const isRejected = parsed.warnings.length > 0;
      verdict = {
        status: isRejected ? "REJECTED" : "APPROVED",
        risk_score: isRejected ? 85 : 15,
        reason: isRejected
          ? `Transaksi pada kontrak ${tx.to} memicu peringatan keamanan (${parsed.warnings.join(", ")}) pada fungsi '${parsed.functionName}'. Pola calldata ini berpotensi mengeksekusi pengalihan hak akses token atau aset NFT tanpa otorisasi transparan. AI Guard memblokir transaksi ini demi mencegah kerugian aset pengguna.`
          : "Evaluasi Guardrail: Transaksi normal terverifikasi aman tanpa indikasi eskalasi izin berlebih atau pola eksploitasi.",
      };
    }

    return verdict;
  } catch (error) {
    console.error("[AIGuard] Kesalahan saat memanggil Gemini API:", error);
    // Fail-safe guardrail komprehensif jika AI API offline/rate-limited
    if (parsed.warnings.includes("MULTICALL_WRAPPER_DETECTED")) {
      const dangerous = (parsed.params.dangerousNestedCall as any) || (parsed.params.embeddedParams ? { functionName: parsed.params.embeddedFunction, params: parsed.params.embeddedParams } : null);
      const spender = dangerous?.params?.spender || dangerous?.params?.operator || "kontrak tidak dikenal";
      const nestedFn = dangerous?.functionName || "eksekusi berbahaya";
      return {
        status: "REJECTED",
        risk_score: 100,
        reason: `Transaksi ini terdeteksi menggunakan pembungkus multicall (selector: ${parsed.selector}) untuk menyamarkan pemanggilan fungsi '${nestedFn}' ke target spender ${spender} pada kontrak ${tx.to}. Jika ditandatangani, penyerang dapat mengeksekusi transferFrom() untuk menguras token korban tanpa memicu peringatan transaksi tunggal. Penyamaran calldata bersarang di dalam multicall adalah taktik phishing drainer berbahaya yang otomatis diblokir oleh AI Guard.`,
      };
    }
    if (parsed.warnings.includes("FULL_OPERATOR_APPROVAL_GRANTED")) {
      const operator = (parsed.params.operator as string) || "tidak dikenal";
      return {
        status: "REJECTED",
        risk_score: 95,
        reason: `Transaksi memberikan izin operator penuh (setApprovalForAll) kepada ${operator} atas seluruh koleksi NFT pada kontrak ${tx.to}. Setelah transaksi ini aktif, operator tersebut memiliki wewenang penuh untuk memindahtangankan, menjual, atau melikuidasi semua token NFT milik pengguna tanpa konfirmasi per item. Pemberian wewenang operator tanpa batas waktu ini berisiko tinggi menguras seluruh portofolio NFT pengguna.`,
      };
    }
    if (parsed.warnings.includes("TRANSFER_OWNERSHIP_DETECTED")) {
      const newOwner = (parsed.params.newOwner as string) || "tidak dikenal";
      return {
        status: "REJECTED",
        risk_score: 98,
        reason: `Transaksi memicu fungsi transferOwnership untuk menyerahkan hak kepemilikan dan kendali administratif kontrak ${tx.to} kepada ${newOwner}. Detik berikutnya setelah transaksi ini diproses di mempool, pemilik asli akan kehilangan seluruh hak kendali istimewa, akses tata kelola, dan perbendaharaan kontrak. Eksekusi ini diblokir untuk mencegah pengambilalihan kontrak (hostile contract takeover).`,
      };
    }
    if (parsed.warnings.length > 0) {
      return {
        status: "REJECTED",
        risk_score: 85,
        reason: `Transaksi pada target ${tx.to} memicu anomali calldata (${parsed.warnings.join(", ")}) pada fungsi '${parsed.functionName}'. Parameter transaksi mengindikasikan upaya eskalasi hak izin atau manipulasi eksekusi tanpa konfirmasi yang memadai. AI Guard memblokir transaksi ini untuk melindungi saldo token BEP-20 dan aset digital pengguna.`,
      };
    }
    return {
      status: "APPROVED",
      risk_score: 20,
      reason: "Evaluasi Fail-Safe: Transaksi transfer native dasar tanpa parameter berbahaya terverifikasi aman untuk dieksekusi.",
    };
  }
}
