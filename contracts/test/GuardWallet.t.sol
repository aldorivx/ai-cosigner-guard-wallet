// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GuardWallet} from "../src/GuardWallet.sol";

contract MockTarget {
    uint256 public value;
    event ValueUpdated(uint256 newValue, address caller);

    function setValue(uint256 _value) external payable {
        value = _value;
        emit ValueUpdated(_value, msg.sender);
    }

    function revertWithReason() external pure {
        revert("MockTarget: execution reverted");
    }

    function revertWithoutReason() external pure {
        revert();
    }

    receive() external payable {}
}

contract ReentrantTarget {
    GuardWallet public wallet;
    address public target;
    bytes public userSig;
    bytes public aiSig;
    uint256 public deadline;

    constructor(GuardWallet _wallet) {
        wallet = _wallet;
    }

    function setParams(address _target, uint256 _deadline, bytes calldata _userSig, bytes calldata _aiSig) external {
        target = _target;
        deadline = _deadline;
        userSig = _userSig;
        aiSig = _aiSig;
    }

    fallback() external payable {
        // Attempt reentrancy using the same nonce/signatures
        if (address(wallet).balance >= 0.1 ether) {
            wallet.execute(target, 0.1 ether, "", 0, deadline, userSig, aiSig);
        }
    }

    receive() external payable {
        if (address(wallet).balance >= 0.1 ether) {
            wallet.execute(target, 0.1 ether, "", 0, deadline, userSig, aiSig);
        }
    }
}

contract GuardWalletTest is Test {
    GuardWallet public wallet;
    MockTarget public mockTarget;

    uint256 internal userPk;
    address internal user;

    uint256 internal aiSignerPk;
    address internal aiSigner;

    uint256 internal attackerPk;
    address internal attacker;

    address internal relayer;

    function setUp() public {
        // Setup signers with deterministic keys
        userPk = 0xA11CE;
        user = vm.addr(userPk);

        aiSignerPk = 0xB0B;
        aiSigner = vm.addr(aiSignerPk);

        attackerPk = 0xBAD;
        attacker = vm.addr(attackerPk);

        relayer = makeAddr("relayer");

        // Deploy GuardWallet and MockTarget
        wallet = new GuardWallet(user, aiSigner);
        mockTarget = new MockTarget();

        // Fund wallet and relayer
        vm.deal(address(wallet), 10 ether);
        vm.deal(relayer, 1 ether);
    }

    // Helper: generate signature using GuardWallet's EIP-712 typed data hash
    function _signTransaction(
        uint256 pk,
        address target,
        uint256 value,
        bytes memory data,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 digest = wallet.getTransactionHash(target, value, data, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /* ========================================================================= */
    /* 1. Skenario: Sukses eksekusi saat kedua tanda tangan valid                */
    /* ========================================================================= */

    function test_Execute_Success_ContractCall() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 888);
        uint256 value = 0;
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), value, data, nonce, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), value, data, nonce, deadline);

        vm.prank(relayer);
        bytes memory returnData = wallet.execute(address(mockTarget), value, data, nonce, deadline, userSig, aiSig);

        // Verification
        assertEq(mockTarget.value(), 888);
        assertEq(wallet.nonce(), 1);
        assertEq(returnData.length, 0);
    }

    function test_Execute_Success_NativeTransfer() public {
        address recipient = makeAddr("recipient");
        bytes memory data = "";
        uint256 transferAmount = 2 ether;
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 30 minutes;

        bytes memory userSig = _signTransaction(userPk, recipient, transferAmount, data, nonce, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, recipient, transferAmount, data, nonce, deadline);

        uint256 walletBalanceBefore = address(wallet).balance;
        uint256 recipientBalanceBefore = recipient.balance;

        vm.prank(relayer);
        wallet.execute(recipient, transferAmount, data, nonce, deadline, userSig, aiSig);

        assertEq(recipient.balance, recipientBalanceBefore + transferAmount);
        assertEq(address(wallet).balance, walletBalanceBefore - transferAmount);
        assertEq(wallet.nonce(), 1);
    }

    function test_Execute_Success_OverloadedWithoutNonce() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 999);
        uint256 value = 0;
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), value, data, 0, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), value, data, 0, deadline);

        vm.prank(relayer);
        wallet.execute(address(mockTarget), value, data, deadline, userSig, aiSig);

        assertEq(mockTarget.value(), 999);
        assertEq(wallet.nonce(), 1);
    }

    /* ========================================================================= */
    /* 2. Skenario: Gagal jika tanda tangan AI salah atau dipalsukan             */
    /* ========================================================================= */

    function test_RevertIf_AISignatureForged() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 100);
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), 0, data, nonce, deadline);
        // AI signature forged by attacker
        bytes memory forgedAiSig = _signTransaction(attackerPk, address(mockTarget), 0, data, nonce, deadline);

        vm.prank(relayer);
        vm.expectRevert(GuardWallet.InvalidAISignature.selector);
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, userSig, forgedAiSig);

        // State remains unchanged
        assertEq(mockTarget.value(), 0);
        assertEq(wallet.nonce(), 0);
    }

    function test_RevertIf_AISignatureCorrupted() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 100);
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), 0, data, nonce, deadline);
        bytes memory corruptedAiSig = hex"123456";

        vm.prank(relayer);
        vm.expectRevert(GuardWallet.InvalidAISignature.selector);
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, userSig, corruptedAiSig);

        assertEq(wallet.nonce(), 0);
    }

    /* ========================================================================= */
    /* 3. Skenario: Gagal jika tanda tangan user salah                           */
    /* ========================================================================= */

    function test_RevertIf_UserSignatureForged() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 200);
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 1 hours;

        // User signature forged by attacker
        bytes memory forgedUserSig = _signTransaction(attackerPk, address(mockTarget), 0, data, nonce, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), 0, data, nonce, deadline);

        vm.prank(relayer);
        vm.expectRevert(GuardWallet.InvalidUserSignature.selector);
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, forgedUserSig, aiSig);

        assertEq(mockTarget.value(), 0);
        assertEq(wallet.nonce(), 0);
    }

    function test_RevertIf_UserSignatureCorrupted() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 200);
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory corruptedUserSig = hex"abcdef";
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), 0, data, nonce, deadline);

        vm.prank(relayer);
        vm.expectRevert(GuardWallet.InvalidUserSignature.selector);
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, corruptedUserSig, aiSig);

        assertEq(wallet.nonce(), 0);
    }

    function test_RevertIf_SignaturesSwapped() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 200);
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), 0, data, nonce, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), 0, data, nonce, deadline);

        // Swapping user and AI signatures
        vm.prank(relayer);
        vm.expectRevert(GuardWallet.InvalidUserSignature.selector);
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, aiSig, userSig);
    }

    /* ========================================================================= */
    /* 4. Skenario: Gagal jika transaksi kadaluarsa (deadline terlampaui)       */
    /* ========================================================================= */

    function test_RevertIf_DeadlineExpired() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 300);
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), 0, data, nonce, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), 0, data, nonce, deadline);

        // Fast forward beyond deadline
        vm.warp(deadline + 1);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(GuardWallet.TransactionExpired.selector, deadline, deadline + 1));
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, userSig, aiSig);

        assertEq(mockTarget.value(), 0);
        assertEq(wallet.nonce(), 0);
    }

    /* ========================================================================= */
    /* 5. Skenario: Gagal jika terjadi replay attack (nonce lama digunakan lagi)  */
    /* ========================================================================= */

    function test_RevertIf_ReplayAttack_ExplicitNonce() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 400);
        uint256 nonce = wallet.nonce(); // 0
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), 0, data, nonce, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), 0, data, nonce, deadline);

        // First execution succeeds
        vm.prank(relayer);
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, userSig, aiSig);
        assertEq(wallet.nonce(), 1);
        assertEq(mockTarget.value(), 400);

        // Replay attempt with old nonce (0) while current nonce is 1
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(GuardWallet.InvalidNonce.selector, 0, 1));
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, userSig, aiSig);

        // Nonce remains 1
        assertEq(wallet.nonce(), 1);
    }

    function test_RevertIf_ReplayAttack_OverloadedCall() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.setValue.selector, 500);
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), 0, data, 0, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), 0, data, 0, deadline);

        // First execution succeeds
        vm.prank(relayer);
        wallet.execute(address(mockTarget), 0, data, deadline, userSig, aiSig);
        assertEq(wallet.nonce(), 1);

        // Replay attempt with identical parameters:
        // Contract will check against nonce = 1, digest changes, userSig recovery fails
        vm.prank(relayer);
        vm.expectRevert(GuardWallet.InvalidUserSignature.selector);
        wallet.execute(address(mockTarget), 0, data, deadline, userSig, aiSig);

        assertEq(wallet.nonce(), 1);
    }

    /* ========================================================================= */
    /* 6. Skenario: Gagal jika target eksekusi mengembalikan revert              */
    /* ========================================================================= */

    function test_RevertIf_TargetRevertsWithReason() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.revertWithReason.selector);
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), 0, data, nonce, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), 0, data, nonce, deadline);

        vm.prank(relayer);
        // Expect exact bubbled revert from target
        vm.expectRevert("MockTarget: execution reverted");
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, userSig, aiSig);
    }

    function test_RevertIf_TargetRevertsWithoutReason() public {
        bytes memory data = abi.encodeWithSelector(MockTarget.revertWithoutReason.selector);
        uint256 nonce = wallet.nonce();
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory userSig = _signTransaction(userPk, address(mockTarget), 0, data, nonce, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(mockTarget), 0, data, nonce, deadline);

        vm.prank(relayer);
        vm.expectRevert(GuardWallet.ExecutionFailed.selector);
        wallet.execute(address(mockTarget), 0, data, nonce, deadline, userSig, aiSig);
    }

    /* ========================================================================= */
    /* 7. Skenario Tambahan: Validasi Konstruktor, Receive, Reentrancy          */
    /* ========================================================================= */

    function test_RevertIf_ConstructorZeroAddress() public {
        vm.expectRevert(GuardWallet.ZeroAddressNotAllowed.selector);
        new GuardWallet(address(0), aiSigner);

        vm.expectRevert(GuardWallet.ZeroAddressNotAllowed.selector);
        new GuardWallet(user, address(0));
    }

    function test_RevertIf_ConstructorSameSigner() public {
        vm.expectRevert(GuardWallet.SameSignerNotAllowed.selector);
        new GuardWallet(user, user);
    }

    function test_ReceiveBNB() public {
        uint256 initialBalance = address(wallet).balance;
        (bool sent,) = address(wallet).call{value: 1 ether}("");
        assertTrue(sent);
        assertEq(address(wallet).balance, initialBalance + 1 ether);
    }

    function test_RevertIf_ReentrancyAttempted() public {
        ReentrantTarget reentrant = new ReentrantTarget(wallet);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = 0;

        bytes memory userSig = _signTransaction(userPk, address(reentrant), 0.1 ether, "", nonce, deadline);
        bytes memory aiSig = _signTransaction(aiSignerPk, address(reentrant), 0.1 ether, "", nonce, deadline);

        reentrant.setParams(address(reentrant), deadline, userSig, aiSig);

        vm.prank(relayer);
        // During the call, reentrant calls execute with nonce = 0, which fails InvalidNonce(0, 1)
        // bubbling up the revert
        vm.expectRevert(abi.encodeWithSelector(GuardWallet.InvalidNonce.selector, 0, 1));
        wallet.execute(address(reentrant), 0.1 ether, "", nonce, deadline, userSig, aiSig);
    }
}
