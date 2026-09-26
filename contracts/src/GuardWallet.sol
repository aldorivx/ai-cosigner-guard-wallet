// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title GuardWallet
 * @notice Smart contract wallet 2-of-2 multi-sig on BNB Smart Chain Testnet.
 * Transaksi hanya dapat dieksekusi jika memuat 2 signature ECDSA valid (User dan AI Signer)
 * yang diverifikasi on-chain via EIP-712 Typed Data signing.
 */
contract GuardWallet is EIP712 {
    /* ========================================================================= */
    /* Errors                                                                    */
    /* ========================================================================= */

    error ZeroAddressNotAllowed();
    error SameSignerNotAllowed();
    error TransactionExpired(uint256 deadline, uint256 currentTimestamp);
    error InvalidNonce(uint256 providedNonce, uint256 currentNonce);
    error InvalidUserSignature();
    error InvalidAISignature();
    error ExecutionFailed();

    /* ========================================================================= */
    /* Events                                                                    */
    /* ========================================================================= */

    event TransactionExecuted(address indexed to, uint256 value, bytes data, uint256 nonce);

    /* ========================================================================= */
    /* Constants & Immutables                                                    */
    /* ========================================================================= */

    // TypeHash untuk struct Transaction sesuai standar EIP-712
    bytes32 public constant TRANSACTION_TYPEHASH =
        keccak256("Transaction(address to,uint256 value,bytes data,uint256 nonce,uint256 deadline)");

    address public immutable owner;
    address public immutable aiSigner;

    /* ========================================================================= */
    /* State Variables                                                           */
    /* ========================================================================= */

    uint256 public nonce;

    /* ========================================================================= */
    /* Constructor                                                               */
    /* ========================================================================= */

    /**
     * @notice Inisialisasi GuardWallet dengan domain EIP-712 "GuardWallet" versi "1".
     * @param _owner Alamat dompet User/Owner
     * @param _aiSigner Alamat signer agen AI Co-Signer
     */
    constructor(address _owner, address _aiSigner) EIP712("GuardWallet", "1") {
        if (_owner == address(0) || _aiSigner == address(0)) {
            revert ZeroAddressNotAllowed();
        }
        if (_owner == _aiSigner) {
            revert SameSignerNotAllowed();
        }

        owner = _owner;
        aiSigner = _aiSigner;
    }

    /* ========================================================================= */
    /* View Functions                                                            */
    /* ========================================================================= */

    /**
     * @notice Menghitung EIP-712 typed data digest untuk transaksi tertentu.
     * @param to Alamat kontrak/akun tujuan eksekusi
     * @param value Jumlah native coin (BNB) yang dikirim
     * @param data Payload calldata yang dieksekusi pada target
     * @param _nonce Nonce transaksi saat ini
     * @param deadline Batas waktu kedaluwarsa transaksi (timestamp)
     * @return Digest EIP-712 32-byte yang harus ditandatangani oleh User dan AI Signer
     */
    function getTransactionHash(address to, uint256 value, bytes memory data, uint256 _nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash =
            keccak256(abi.encode(TRANSACTION_TYPEHASH, to, value, keccak256(data), _nonce, deadline));
        return _hashTypedDataV4(structHash);
    }

    /* ========================================================================= */
    /* Execution Functions                                                       */
    /* ========================================================================= */

    /**
     * @notice Mengeksekusi transaksi dengan verifikasi 2-of-2 tanda tangan EIP-712 dan explicit nonce.
     * @param to Alamat tujuan transaksi
     * @param value Jumlah BNB yang ditransfer
     * @param data Calldata eksekusi target
     * @param _nonce Nonce transaksi yang diharapkan
     * @param deadline Timestamp kedaluwarsa transaksi
     * @param userSignature Signature ECDSA dari User
     * @param aiSignature Signature ECDSA dari AI Signer
     * @return returnData Hasil return dari eksekusi call pada target
     */
    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        uint256 _nonce,
        uint256 deadline,
        bytes calldata userSignature,
        bytes calldata aiSignature
    ) public payable returns (bytes memory returnData) {
        // 1. Validasi batas waktu (deadline)
        if (block.timestamp > deadline) {
            revert TransactionExpired(deadline, block.timestamp);
        }

        // 2. Validasi pencegahan replay attack (nonce)
        if (_nonce != nonce) {
            revert InvalidNonce(_nonce, nonce);
        }

        // 3. Checks-Effects-Interactions (CEI): Update state sebelum interaksi eksternal
        nonce++;

        // 4. Verifikasi kedua tanda tangan
        _verifySignatures(getTransactionHash(to, value, data, _nonce, deadline), userSignature, aiSignature);

        // 5. Eksekusi transaksi ke target
        bool success;
        (success, returnData) = to.call{value: value}(data);

        if (!success) {
            // Bubble up revert reason jika tersedia
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 0x20), mload(returnData))
                }
            } else {
                revert ExecutionFailed();
            }
        }

        emit TransactionExecuted(to, value, data, _nonce);
    }

    /**
     * @notice Overload fungsi execute yang menggunakan nonce internal saat ini secara otomatis.
     * @param to Alamat tujuan transaksi
     * @param value Jumlah BNB yang ditransfer
     * @param data Calldata eksekusi target
     * @param deadline Timestamp kedaluwarsa transaksi
     * @param userSignature Signature ECDSA dari User
     * @param aiSignature Signature ECDSA dari AI Signer
     * @return returnData Hasil return dari eksekusi call pada target
     */
    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        uint256 deadline,
        bytes calldata userSignature,
        bytes calldata aiSignature
    ) external payable returns (bytes memory returnData) {
        return execute(to, value, data, nonce, deadline, userSignature, aiSignature);
    }

    /* ========================================================================= */
    /* Internal Helpers                                                          */
    /* ========================================================================= */

    /**
     * @dev Memvalidasi tanda tangan User dan AI Signer terhadap digest EIP-712.
     */
    function _verifySignatures(bytes32 digest, bytes calldata userSignature, bytes calldata aiSignature)
        internal
        view
    {
        (address recoveredUser, ECDSA.RecoverError errUser,) = ECDSA.tryRecover(digest, userSignature);
        if (errUser != ECDSA.RecoverError.NoError || recoveredUser != owner) {
            revert InvalidUserSignature();
        }

        (address recoveredAI, ECDSA.RecoverError errAI,) = ECDSA.tryRecover(digest, aiSignature);
        if (errAI != ECDSA.RecoverError.NoError || recoveredAI != aiSigner) {
            revert InvalidAISignature();
        }
    }

    /* ========================================================================= */
    /* Receive & Fallback                                                        */
    /* ========================================================================= */

    /// @notice Memungkinkan kontrak menerima transfer BNB native
    receive() external payable {}

    /// @notice Fallback function untuk menerima transfer atau call tanpa data
    fallback() external payable {}
}
