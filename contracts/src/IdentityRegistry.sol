// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {IRomeSystemProgram} from "./interfaces/IRomeSystemProgram.sol";

/// @title IdentityRegistry
/// @author RomeID
/// @notice Unified dual-lane identity registry on Rome Protocol. Links an EVM wallet (MetaMask)
///         and a Solana wallet (Phantom / Solflare / Backpack) to a single shared on-chain profile.
/// @dev On Rome EVM, a Solana wallet signing via the Solana lane (`submitRomeTxV1` / `submitRomeTxSolanaLane`)
///      executes with `msg.sender == address(uint160(uint256(keccak256(abi.encodePacked(solanaPubkey)))))`.
///      Two-step wallet linking (`requestLink` -> `confirmLink`) cryptographically proves control of
///      BOTH wallets from their respective lanes with zero trusted intermediaries.
contract IdentityRegistry is IIdentityRegistry, ReentrancyGuard {
    /// @notice Official Rome Protocol SystemProgram precompile address.
    address public constant ROME_SYSTEM_PROGRAM = 0xfF00000000000000000000000000000000000007;

    uint256 private _nextProfileId = 1;

    mapping(uint256 => Profile) private _profiles;
    mapping(bytes32 => uint256) private _handleHashToProfile;
    mapping(address => uint256) private _walletToProfile;
    mapping(bytes32 => uint256) private _solanaPubkeyToProfile;

    mapping(uint256 => address[]) private _linkedWalletAddresses;
    mapping(uint256 => mapping(address => uint256)) private _linkedWalletIndexPlusOne;
    mapping(uint256 => mapping(address => LinkedWallet)) private _links;

    /// @inheritdoc IIdentityRegistry
    function createProfile(
        string calldata handle,
        string calldata metadataURI
    ) external nonReentrant returns (uint256 profileId) {
        return _createProfile(msg.sender, handle, metadataURI, bytes32(0));
    }

    /// @inheritdoc IIdentityRegistry
    function createProfileWithSolanaKey(
        string calldata handle,
        string calldata metadataURI,
        bytes32 solanaPubkey
    ) external nonReentrant returns (uint256 profileId) {
        if (solanaPubkey == bytes32(0)) revert InvalidTargetWallet();
        address expectedSynthetic = deriveSyntheticAddress(solanaPubkey);
        if (expectedSynthetic != msg.sender) {
            revert SyntheticMismatch(expectedSynthetic, msg.sender);
        }
        return _createProfile(msg.sender, handle, metadataURI, solanaPubkey);
    }

    /// @inheritdoc IIdentityRegistry
    function updateProfileMetadata(uint256 profileId, string calldata metadataURI) external nonReentrant {
        if (!_profileExists(profileId)) revert ProfileNotFound(profileId);
        if (!isProfileController(profileId, msg.sender)) {
            revert NotProfileController(profileId, msg.sender);
        }
        _profiles[profileId].metadataURI = metadataURI;
        _profiles[profileId].updatedAt = uint64(block.timestamp);

        emit ProfileMetadataUpdated(profileId, msg.sender, metadataURI);
    }

    /// @inheritdoc IIdentityRegistry
    /// @dev Step 1 of trustless 2-step linking. Callable by the profile owner or any confirmed linked wallet.
    ///      If `otherWalletIdentifier` is `address(0)` and `solanaPubkey != bytes32(0)`, the target EVM
    ///      address is automatically derived via `deriveSyntheticAddress(solanaPubkey)`.
    function requestLink(
        uint256 profileId,
        address otherWalletIdentifier,
        bytes32 solanaPubkey
    ) external nonReentrant {
        if (!_profileExists(profileId)) revert ProfileNotFound(profileId);
        if (!isProfileController(profileId, msg.sender)) {
            revert NotProfileController(profileId, msg.sender);
        }

        address targetWallet = otherWalletIdentifier;
        if (targetWallet == address(0) && solanaPubkey != bytes32(0)) {
            targetWallet = deriveSyntheticAddress(solanaPubkey);
        }
        if (targetWallet == address(0) || targetWallet == msg.sender || targetWallet == _profiles[profileId].owner) {
            revert InvalidTargetWallet();
        }

        uint256 existingOwnerProfile = _walletToProfile[targetWallet];
        if (existingOwnerProfile != 0) {
            revert WalletAlreadyHasProfile(targetWallet, existingOwnerProfile);
        }
        if (solanaPubkey != bytes32(0)) {
            uint256 existingSolProfile = _solanaPubkeyToProfile[solanaPubkey];
            if (existingSolProfile != 0) {
                revert WalletAlreadyHasProfile(targetWallet, existingSolProfile);
            }
        }

        LinkedWallet storage current = _links[profileId][targetWallet];
        if (current.status != LinkStatus.None) {
            revert LinkAlreadyExists(profileId, targetWallet);
        }

        _links[profileId][targetWallet] = LinkedWallet({
            wallet: targetWallet,
            solanaPubkey: solanaPubkey,
            status: LinkStatus.Pending,
            requestedBy: msg.sender,
            requestedAt: uint64(block.timestamp),
            confirmedAt: 0
        });

        _linkedWalletAddresses[profileId].push(targetWallet);
        _linkedWalletIndexPlusOne[profileId][targetWallet] = _linkedWalletAddresses[profileId].length;

        emit LinkRequested(profileId, msg.sender, targetWallet, solanaPubkey);
    }

    /// @inheritdoc IIdentityRegistry
    /// @dev Step 2 of trustless 2-step linking. Must be signed by `targetWallet` from its own lane
    ///      (MetaMask on EVM lane via `submitRomeTx`, or Phantom/Solflare on Solana lane via `submitRomeTxV1`).
    function confirmLink(uint256 profileId) external nonReentrant {
        if (!_profileExists(profileId)) revert ProfileNotFound(profileId);

        LinkedWallet storage link = _links[profileId][msg.sender];
        if (link.status != LinkStatus.Pending) {
            revert NoPendingLink(profileId, msg.sender);
        }

        uint256 existingProfile = _walletToProfile[msg.sender];
        if (existingProfile != 0) {
            revert WalletAlreadyHasProfile(msg.sender, existingProfile);
        }
        if (link.solanaPubkey != bytes32(0)) {
            uint256 existingSolProfile = _solanaPubkeyToProfile[link.solanaPubkey];
            if (existingSolProfile != 0) {
                revert WalletAlreadyHasProfile(msg.sender, existingSolProfile);
            }
            _solanaPubkeyToProfile[link.solanaPubkey] = profileId;
        }

        link.status = LinkStatus.Confirmed;
        link.confirmedAt = uint64(block.timestamp);
        _walletToProfile[msg.sender] = profileId;
        _profiles[profileId].updatedAt = uint64(block.timestamp);

        emit LinkConfirmed(profileId, msg.sender, link.solanaPubkey);
    }

    /// @inheritdoc IIdentityRegistry
    /// @dev Supports unlinking (or cancelling a pending link) by EITHER side:
    ///      any confirmed profile controller OR `wallet` itself.
    function unlinkWallet(uint256 profileId, address wallet) external nonReentrant {
        if (!_profileExists(profileId)) revert ProfileNotFound(profileId);
        if (wallet == _profiles[profileId].owner) revert CannotUnlinkPrimaryOwner();

        LinkedWallet memory link = _links[profileId][wallet];
        if (link.status == LinkStatus.None) {
            revert LinkNotFound(profileId, wallet);
        }

        bool callerIsTarget = (msg.sender == wallet);
        bool callerIsController = isProfileController(profileId, msg.sender);
        if (!callerIsTarget && !callerIsController) {
            revert NotAuthorizedToUnlink(profileId, wallet, msg.sender);
        }

        if (link.status == LinkStatus.Confirmed) {
            delete _walletToProfile[wallet];
            if (link.solanaPubkey != bytes32(0)) {
                delete _solanaPubkeyToProfile[link.solanaPubkey];
            }
        }

        _removeLinkedWalletAddress(profileId, wallet);
        delete _links[profileId][wallet];
        _profiles[profileId].updatedAt = uint64(block.timestamp);

        emit WalletUnlinked(profileId, wallet, msg.sender);
    }

    /// @inheritdoc IIdentityRegistry
    function getProfile(uint256 profileId) external view returns (Profile memory) {
        if (!_profileExists(profileId)) revert ProfileNotFound(profileId);
        return _profiles[profileId];
    }

    /// @inheritdoc IIdentityRegistry
    function getProfileByHandle(string calldata handle) external view returns (Profile memory) {
        string memory normalized = _normalizeAndValidateHandle(handle);
        uint256 profileId = _handleHashToProfile[keccak256(bytes(normalized))];
        if (profileId == 0) revert ProfileNotFound(0);
        return _profiles[profileId];
    }

    /// @inheritdoc IIdentityRegistry
    function getLinkedWallets(uint256 profileId) external view returns (LinkedWallet[] memory) {
        if (!_profileExists(profileId)) revert ProfileNotFound(profileId);
        address[] storage addrs = _linkedWalletAddresses[profileId];
        uint256 len = addrs.length;
        LinkedWallet[] memory list = new LinkedWallet[](len);
        for (uint256 i = 0; i < len; ++i) {
            list[i] = _links[profileId][addrs[i]];
        }
        return list;
    }

    /// @inheritdoc IIdentityRegistry
    function resolveProfile(address wallet) external view returns (uint256 profileId) {
        return _walletToProfile[wallet];
    }

    /// @notice Resolves a 32-byte Solana public key to its RomeID profile ID (either via explicit pubkey record or synthetic address).
    function resolveSolanaProfile(bytes32 solanaPubkey) external view returns (uint256 profileId) {
        if (solanaPubkey == bytes32(0)) return 0;
        uint256 direct = _solanaPubkeyToProfile[solanaPubkey];
        if (direct != 0) return direct;
        return _walletToProfile[deriveSyntheticAddress(solanaPubkey)];
    }

    /// @inheritdoc IIdentityRegistry
    function isProfileController(uint256 profileId, address wallet) public view returns (bool) {
        if (!_profileExists(profileId) || wallet == address(0)) return false;
        if (_profiles[profileId].owner == wallet) return true;
        return _links[profileId][wallet].status == LinkStatus.Confirmed;
    }

    /// @inheritdoc IIdentityRegistry
    function profileExists(uint256 profileId) external view returns (bool) {
        return _profileExists(profileId);
    }

    /// @notice Returns the total number of profiles created.
    function totalProfiles() external view returns (uint256) {
        return _nextProfileId - 1;
    }

    /// @inheritdoc IIdentityRegistry
    /// @dev Verified Rome Protocol Solana-lane derivation: `keccak256(solanaPubkey)[12:]`.
    ///      Matches `rome-protocol/sdk` `syntheticAddress(pubkey)` and `do_tx_unsigned::derive_sender`.
    function deriveSyntheticAddress(bytes32 solanaPubkey) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(solanaPubkey)))));
    }

    /// @notice Converts a 32-byte Solana pubkey to a base58 string using Rome's SystemProgram precompile (0xFF...07).
    /// @dev Reverts with `SystemPrecompileUnavailable` if invoked on a non-Rome EVM without the precompile.
    function solanaPubkeyToBase58(bytes32 solanaPubkey) external view returns (string memory) {
        (bool ok, bytes memory ret) = ROME_SYSTEM_PROGRAM.staticcall(
            abi.encodeCall(IRomeSystemProgram.bytes32_to_base58, (solanaPubkey))
        );
        if (!ok || ret.length == 0) revert SystemPrecompileUnavailable();
        return string(abi.decode(ret, (bytes)));
    }

    /// @notice Converts a base58 Solana pubkey string to `bytes32` using Rome's SystemProgram precompile (0xFF...07).
    /// @dev Reverts with `SystemPrecompileUnavailable` if invoked on a non-Rome EVM without the precompile.
    function base58ToSolanaPubkey(string calldata base58Pubkey) external view returns (bytes32) {
        (bool ok, bytes memory ret) = ROME_SYSTEM_PROGRAM.staticcall(
            abi.encodeCall(IRomeSystemProgram.base58_to_bytes32, (bytes(base58Pubkey)))
        );
        if (!ok || ret.length == 0) revert SystemPrecompileUnavailable();
        return abi.decode(ret, (bytes32));
    }

    function _createProfile(
        address owner,
        string calldata handle,
        string calldata metadataURI,
        bytes32 solanaPubkey
    ) internal returns (uint256 profileId) {
        uint256 existing = _walletToProfile[owner];
        if (existing != 0) revert WalletAlreadyHasProfile(owner, existing);

        if (solanaPubkey != bytes32(0)) {
            uint256 existingSol = _solanaPubkeyToProfile[solanaPubkey];
            if (existingSol != 0) revert WalletAlreadyHasProfile(owner, existingSol);
        }

        string memory normalizedHandle = _normalizeAndValidateHandle(handle);
        bytes32 handleHash = keccak256(bytes(normalizedHandle));
        if (_handleHashToProfile[handleHash] != 0) {
            revert HandleAlreadyTaken(normalizedHandle);
        }

        profileId = _nextProfileId++;
        uint64 nowTs = uint64(block.timestamp);

        _profiles[profileId] = Profile({
            id: profileId,
            owner: owner,
            ownerSolanaPubkey: solanaPubkey,
            handle: normalizedHandle,
            metadataURI: metadataURI,
            createdAt: nowTs,
            updatedAt: nowTs
        });

        _handleHashToProfile[handleHash] = profileId;
        _walletToProfile[owner] = profileId;
        if (solanaPubkey != bytes32(0)) {
            _solanaPubkeyToProfile[solanaPubkey] = profileId;
        }

        emit ProfileCreated(profileId, owner, normalizedHandle, metadataURI, solanaPubkey);
    }

    function _removeLinkedWalletAddress(uint256 profileId, address wallet) internal {
        uint256 indexPlusOne = _linkedWalletIndexPlusOne[profileId][wallet];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        address[] storage arr = _linkedWalletAddresses[profileId];
        uint256 lastIndex = arr.length - 1;

        if (index != lastIndex) {
            address moved = arr[lastIndex];
            arr[index] = moved;
            _linkedWalletIndexPlusOne[profileId][moved] = index + 1;
        }

        arr.pop();
        delete _linkedWalletIndexPlusOne[profileId][wallet];
    }

    function _profileExists(uint256 profileId) internal view returns (bool) {
        return profileId > 0 && profileId < _nextProfileId;
    }

    function _normalizeAndValidateHandle(string calldata raw) internal pure returns (string memory) {
        bytes memory b = bytes(raw);
        uint256 len = b.length;
        if (len < 3 || len > 32) revert InvalidHandle();

        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; ++i) {
            bytes1 c = b[i];
            if (c >= 0x41 && c <= 0x5A) {
                // Convert 'A'-'Z' to 'a'-'z'
                out[i] = bytes1(uint8(c) + 32);
            } else if (
                (c >= 0x61 && c <= 0x7A) || // a-z
                (c >= 0x30 && c <= 0x39) || // 0-9
                c == 0x5F || // _
                c == 0x2D // -
            ) {
                out[i] = c;
            } else {
                revert InvalidHandle();
            }
        }
        return string(out);
    }
}
