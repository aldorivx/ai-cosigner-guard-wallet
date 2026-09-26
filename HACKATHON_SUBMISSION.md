# 🛡️ AI Co-Signer Guard Wallet
> **Autonomous 2-of-2 Multi-Sig Smart Contract Wallet dengan Synchronous Pre-Execution AI Security Guardrails di BNB Smart Chain (Chain ID 97)**

---

## 📌 1. Informasi Proyek (Project Metadata)

| Parameter | Keterangan / Tautan |
| :--- | :--- |
| **Nama Proyek** | **AI Co-Signer Guard Wallet** |
| **Kategori Track** | AI x Web3 / Smart Contract Security / Infrastructure & Tooling |
| **Live Web dApp (Vercel)** | [https://frontend-beige-seven-88.vercel.app](https://frontend-beige-seven-88.vercel.app) |
| **GitHub Repository** | [https://github.com/aldorivx/ai-cosigner-guard-wallet](https://github.com/aldorivx/ai-cosigner-guard-wallet) |
| **Jaringan Blockchain** | BNB Smart Chain Testnet (`Chain ID: 97`) |
| **Alamat Smart Contract** | [`0x7e98f1fD70Ffe550A6ee616dB0925fb7e5522C8a`](https://testnet.bscscan.com/address/0x7e98f1fD70Ffe550A6ee616dB0925fb7e5522C8a) |
| **Tx Hash Deployment Kontrak** | [`0x4a69acb6696e6280799e3f2e5ba5ca8b07d8c89ad5650bda5eba4bcc2702751d`](https://testnet.bscscan.com/tx/0x4a69acb6696e6280799e3f2e5ba5ca8b07d8c89ad5650bda5eba4bcc2702751d) |
| **Alamat Pemilik (Owner Key 1)** | `0x6543e13fC2F5b68655D537a2A637d31Fe98b42c0` |
| **Alamat AI Signer (Key 2)** | `0x4f1153deeA6a184913b214b50cC32c7fBc009A03` |
| **Bukti Tx Relay On-Chain** | [`0x86c766cfcd793af2392c0951f25f7649060f4be19ce68f2389c0dbdcc0d0bf83`](https://testnet.bscscan.com/tx/0x86c766cfcd793af2392c0951f25f7649060f4be19ce68f2389c0dbdcc0d0bf83) |
| **Lisensi** | MIT License |

---

## 🎯 2. Ringkasan Eksekutif (Executive Summary)

Setiap tahunnya, pengguna Web3 kehilangan lebih dari **$1 Miliar** akibat serangan **phishing wallet drainers**, **blind approval exploits** (`approve(spender, MaxUint256)`), dan **manipulasi calldata terselubung** (seperti batch `multicall`). Dompet EOA konvensional tidak memiliki mekanisme proteksi pra-eksekusi, sementara dompet multisig tradisional (seperti Gnosis Safe) bergantung pada ko-signer manusia yang tidak praktis untuk kebutuhan transaksi ritel dan interaksi DeFi harian.

**AI Co-Signer Guard Wallet** menghadirkan solusi arsitektur hibrida: dompet smart contract **2-of-2 Multi-Sig** di BNB Smart Chain yang diproteksi secara real-time oleh **Autonomous AI Security Agent**. Setiap transaksi membutuhkan dua tanda tangan kriptografi **EIP-712**:
1. **Signature 1-of-2:** Pemilik Akun / User (Owner).
2. **Signature 2-of-2:** AI Security Co-Signer (hanya diterbitkan jika lolos inspeksi keamanan otomatis).

Jika terdeteksi serangan phishing drainer, permintaan kuota token tanpa batas, atau calldata berbahaya, **AI menolak membubuhkan tanda tangan (HTTP 403 Forbidden)**. Serangan digagalkan secara instan di lapisan pra-mempool dengan **0 gas terbuang dan 0 saldo terkuras**.

---

## 🛑 3. Problem Statement: Celah Keamanan Fatal Web3

1. **Sindrom Blind Signing:**
   Pengguna Web3 disodori string heksadesimal mentah (*raw calldata*) di MetaMask/browser wallet yang tidak dapat dipahami manusia awam, sehingga rentan menandatangani skenario pengurasan aset.
2. **Eksploitasi Unlimited Token Allowance:**
   Situs phishing memanipulasi persetujuan token tak terbatas (`approve(spender, 2^256 - 1)`). Begitu ditandatangani, peretas dapat memanggil `transferFrom()` kapan saja untuk menguras seluruh token BEP-20 pengguna.
3. **Penyamaran Calldata Multicall Bersarang:**
   Serangan canggih membungkus fungsi berbahaya di dalam router batch `multicall(bytes[])` (`0xac9650d8` / `0x5ae401dc`) agar lolos dari deteksi inspeksi dasar dompet konvensional.
4. **Kelemahan Solusi Saat Ini:**
   - **EOA (MetaMask / Trust Wallet):** Pasif, tidak memiliki rem keamanan pra-eksekusi.
   - **Gnosis Safe:** Lambat karena membutuhkan tanda tangan manual manusia.
   - **Simulasi Browser Extension:** Rentan di-bypass skrip frontend dan sering diabaikan karena *alert fatigue*.
   - **ERC-4337 Bundlers:** Memiliki ketergantungan infrastruktur pihak ketiga, latensi tinggi, potensi sensor, dan markup biaya gas.

---

## 💡 4. Solusi Inovatif (The Solution)

```text
                                  +---------------------------------------------+
                                  |            Web3 User / DApp UI              |
                                  +---------------------------------------------+
                                                         |
                                       1. Sign EIP-712 Typed Data (1-of-2)
                                                         v
                                  +---------------------------------------------+
                                  |     AI Guardrail Engine (Gemini + AST)      |
                                  |       Unpacks Multicall & Checks Exploits   |
                                  +---------------------------------------------+
                                        /                                 \
                [Phishing Drainer / Malicious] /                                   \ [Safe & Legitimate]
                                      /                                     \
                                     v                                       v
                 +-----------------------+               +--------------------------------------+
                 |   REJECT TRANSACTION  |               |  Sign EIP-712 with AI Signer (2-of-2)|
                 |  (HTTP 403 Forbidden) |               +--------------------------------------+
                 |  NO GAS, NO BROADCAST |                                  |
                 +-----------------------+                                  | 2. Auto-Relay
                                                                            v
                                                         +--------------------------------------+
                                                         |         Gas-Sponsoring Relayer       |
                                                         +--------------------------------------+
                                                                            |
                                                         3. execute(...) on BSC Testnet
                                                                            v
                                                         +======================================+
                                                         |       GuardWallet.sol (On-Chain)     |
                                                         |   - EIP-712 Dual Recovery Validation |
                                                         |   - Sequential Nonce & Deadline Check|
                                                         |   - Reentrancy & CEI Guard           |
                                                         +======================================+
```

### Keunggulan Desain:
- **Kriptografis 2-of-2 Murni:** Smart contract di BSC secara mutlak menolak transaksi jika signature AI Co-Signer tidak ada, dipalsukan, atau tidak cocok dengan parameter digest EIP-712.
- **Pertahanan Berlapis (Defense-in-Depth):**
  1. *Layer 1 (Deterministic Hard Guardrails):* Parser calldata membongkar multicall bersarang dan langsung memblokir `MaxUint256`, `setApprovalForAll`, zero-address recipient, atau selector mencurigakan.
  2. *Layer 2 (Gemini AI Reasoning Engine):* Model Google Gemini Flash menganalisis semantik kontrak target, saldo vault, dan parameter input untuk menghasilkan skor risiko (0–100) serta penjelasan rasional yang mudah dipahami.
- **Zero Third-Party Bundler Dependency:** Menggunakan recovery ECDSA native EVM via EIP-712. Bebas ketergantungan bundler ERC-4337, lebih hemat gas, dan transparan.
- **Sponsored Gas Relayer:** Transaksi yang telah disetujui AI dapat langsung disiarkan ke blockchain oleh Relayer, mempermudah pengguna tanpa perlu repot menyiapkan gas di akun pribadi.

---

## 🏗️ 5. Arsitektur Teknis & Tech Stack

```text
├── contracts/                        # Smart Contracts Module (Foundry)
│   ├── src/GuardWallet.sol           # Kontrak 2-of-2 EIP-712 Multi-Sig Guard
│   ├── script/DeployGuardWallet.s.sol# Skrip deployment otomatis BSC Testnet
│   └── test/GuardWallet.t.sol        # 17 Unit test lengkap (100% pass)
│
├── backend/                          # Standalone AI Co-Signer Service
│   ├── services/aiGuard.ts           # Mesin keamanan Gemini AI + parser calldata
│   ├── services/coSigner.ts          # EIP-712 typed data signer
│   └── server.ts                     # REST API service & relayer engine
│
├── frontend/                         # Web3 Dashboard (Next.js 14 App Router)
│   ├── app/page.tsx                  # Interactive security dashboard & simulator
│   ├── app/api/*                     # Native Next.js Serverless Route Handlers
│   ├── lib/server/*                  # Serverless AI Guard & Co-Signer module
│   └── lib/wagmi.ts                  # Integrasi Wagmi v2 & Viem BSC Testnet
```

### Teknologi yang Digunakan:
- **Blockchain Platform:** BNB Smart Chain Testnet (Chain ID `97`).
- **Smart Contract Language:** Solidity `0.8.24` dengan OpenZeppelin Contracts v5 (`EIP712`, `ECDSA`).
- **Testing & Deployment Framework:** Foundry (`forge`, `cast`).
- **AI Engine:** Google Gemini Flash via `@google/genai` SDK.
- **Web3 Libraries:** Viem v2 & Wagmi v2.
- **Frontend & Cloud Runtime:** Next.js 14 (App Router), Tailwind CSS, Lucide React, dideploy secara global di **Vercel Serverless Functions**.

---

## 📊 6. Matriks Perbandingan Kompetitif

| Fitur / Parameter | Dompet EOA Biasa (MetaMask) | Multi-Sig Standar (Gnosis Safe) | Ekstensi Browser Simulasi | **AI Co-Signer Guard Wallet** |
| :--- | :---: | :---: | :---: | :---: |
| **Proteksi Pra-Eksekusi On-Chain** | ❌ Tidak Ada | ⚠️ Manual Manusia | ❌ Hanya di Browser | ✅ **Otonom & Kriptografis (2-of-2)** |
| **Kecepatan Konfirmasi Transaksi** | Instant (tanpa filter) | Sangat Lambat (jam/hari) | Instant (bisa di-bypass) | ⚡ **Instan (Sub-Detik via AI)** |
| **Penahanan Phishing Drainer** | ❌ Rentan | ⚠️ Tergantung manusia | ⚠️ Sering diabaikan | 🛡️ **Blokir Mutlak (HTTP 403)** |
| **Inspeksi Multicall Bersarang** | ❌ Blind Signing | ❌ Blind Signing | ⚠️ Terbatas | 🔍 **Unpack & Deteksi Mendalam** |
| **Ketergantungan Bundler 4337** | Tidak | Tidak | Tidak | 🚀 **Nol (Native EVM EIP-712)** |
| **Biaya Gas Saat Serangan Terjadi**| Hangus / Aset Hilang| Hangus jika dieksekusi | Hangus | 💰 **Nol Gas Terbuang** |

---

## 🧪 7. Pengujian & Bukti Verifikasi On-Chain

Proyek telah melalui verifikasi ketat di setiap lapisannya:

### 1. Smart Contract Unit Tests (Foundry)
- **17 Test Cases (100% Pass Rate)** mencakup:
  - Normal BNB transfer execution
  - Validasi ketat tanda tangan ganda 2-of-2 (User + AI)
  - Penolakan tanda tangan palsu, tertukar (*swapped signatures*), atau korup
  - Pencegahan serangan Reentrancy & Cross-Transaction Replay (sequential nonce)
  - Validasi kadaluarsa transaksi (*deadline expiration*)
  - Eksekusi Checks-Effects-Interactions (CEI)

### 2. Backend & Guardrail Unit Tests (Bun)
- **9 Test Cases (0 Failures)** memvalidasi parsing calldata ERC-20/ERC-721/ERC-2612, pembongkaran multicall router, fallback heuristik offline, dan REST API.

### 3. Live Deployment & Transaksi On-Chain Terverifikasi (BSC Testnet)
- **Smart Contract:** [`0x7e98f1fD70Ffe550A6ee616dB0925fb7e5522C8a`](https://testnet.bscscan.com/address/0x7e98f1fD70Ffe550A6ee616dB0925fb7e5522C8a)
- **Deployment Transaction:** [`0x4a69acb6696e6280799e3f2e5ba5ca8b07d8c89ad5650bda5eba4bcc2702751d`](https://testnet.bscscan.com/tx/0x4a69acb6696e6280799e3f2e5ba5ca8b07d8c89ad5650bda5eba4bcc2702751d)
- **Live Multi-Sig Relay Execution:** [`0x86c766cfcd793af2392c0951f25f7649060f4be19ce68f2389c0dbdcc0d0bf83`](https://testnet.bscscan.com/tx/0x86c766cfcd793af2392c0951f25f7649060f4be19ce68f2389c0dbdcc0d0bf83)

---

## 🖥️ 8. Fitur Dasbor Web Interaktif (Live Demo)

Pengguna dan dewan juri dapat menguji sistem secara langsung di:
👉 **[https://frontend-beige-seven-88.vercel.app](https://frontend-beige-seven-88.vercel.app)**

Fitur Dasbor:
1. **Live On-Chain Telemetry:** Memantau saldo vault GuardWallet secara real-time, nonce on-chain, status relayer, dan public key node AI Co-Signer.
2. **Skenario Pengujian Interaktif (1-Click Staged Scenarios):**
   - 🟢 **Normal Transfer (Happy Path):** Menguji transfer BNB sah; AI memverifikasi keamanan dan menandatangani dalam hitungan milidetik.
   - ⛔ **Drainer Attack Simulator:** Mensimulasikan eksploitasi persetujuan token tanpa batas (`MaxUint256`); AI langsung memblokir dan menampilkan analisis ancaman.
   - ⚙️ **Custom Calldata Inspector:** Menguji calldata kontrak pintar kustom secara bebas.
3. **AI Security Inspector & Reasoning Gauge:** Menampilkan skor risiko interaktif (0–100), badge status, penjelasan risiko dalam bahasa manusia (*human-readable security reasoning*), dan inspeksi dual ECDSA signature.
4. **Metode Penandatanganan Fleksibel:** Mendukung 1-Click Simulation Signer maupun integrasi browser wallet nyata (MetaMask).

---

## 🗺️ 9. Rencana Pengembangan (Roadmap)

- [x] **Fase 1 (Hackathon MVP):**
  - Implementasi smart contract 2-of-2 EIP-712 GuardWallet.sol di BSC Testnet.
  - Integrasi mesin evaluasi Google Gemini AI & parser calldata/multicall.
  - Dasbor Next.js interaktif & deployment serverless Vercel.
- [ ] **Fase 2 (Mainnet Readiness & Custom Policies):**
  - Deployment ke BNB Smart Chain Mainnet.
  - Pengaturan kebijakan pengeluaran kustom (*user-defined spending limits*, e.g., auto-approve < 0.1 BNB, strict AI audit > 0.1 BNB).
  - Integrasi database reputasi on-chain anti-scam (PhishFort, Chainabuse API).
- [ ] **Fase 3 (SDK & Ecosystem Adoption):**
  - Rilis `@ai-cosigner/sdk` untuk integrasi instan ke dApp Web3 lainnya di ekosistem BNB Chain.
  - Dukungan modul Account Abstraction (ERC-4337 / ERC-7579 modular smart account validator).

---

## 👥 10. Pengembang (Team) & Pitch Summary

- **Developer:** [aldorivx](https://github.com/aldorivx)
- **Tujuan:** Menghadirkan benteng pertahanan AI otonom pertama di BNB Smart Chain yang menjamin keamanan aset pengguna ritel tanpa mengorbankan kecepatan maupun pengalaman pengguna (*UX*).
