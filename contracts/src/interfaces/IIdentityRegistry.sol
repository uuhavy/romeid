// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IIdentityRegistry
/// @notice Interface for RomeID unified dual-lane on-chain identity profiles.
interface IIdentityRegistry {
    enum LinkStatus {
        None,
        Pending,
        Confirmed
    }

    struct Profile {
        uint256 id;
        address owner;
        bytes32 ownerSolanaPubkey;
        string handle;
        string metadataURI;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct LinkedWallet {
        address wallet;
        bytes32 solanaPubkey;
        LinkStatus status;
        address requestedBy;
        uint64 requestedAt;
        uint64 confirmedAt;
    }

    event ProfileCreated(
        uint256 indexed profileId,
        address indexed owner,
        string handle,
        string metadataURI,
        bytes32 solanaPubkey
    );
    event ProfileMetadataUpdated(uint256 indexed profileId, address indexed updatedBy, string metadataURI);
    event LinkRequested(
        uint256 indexed profileId,
        address indexed requestedBy,
        address indexed targetWallet,
        bytes32 solanaPubkey
    );
    event LinkConfirmed(uint256 indexed profileId, address indexed wallet, bytes32 solanaPubkey);
    event WalletUnlinked(uint256 indexed profileId, address indexed wallet, address indexed unlinkedBy);

    error InvalidHandle();
    error HandleAlreadyTaken(string handle);
    error WalletAlreadyHasProfile(address wallet, uint256 existingProfileId);
    error ProfileNotFound(uint256 profileId);
    error NotProfileController(uint256 profileId, address caller);
    error InvalidTargetWallet();
    error SyntheticMismatch(address expectedSynthetic, address providedAddress);
    error LinkAlreadyExists(uint256 profileId, address wallet);
    error NoPendingLink(uint256 profileId, address caller);
    error CannotUnlinkPrimaryOwner();
    error NotAuthorizedToUnlink(uint256 profileId, address wallet, address caller);
    error LinkNotFound(uint256 profileId, address wallet);
    error SystemPrecompileUnavailable();

    function createProfile(string calldata handle, string calldata metadataURI) external returns (uint256 profileId);

    function createProfileWithSolanaKey(
        string calldata handle,
        string calldata metadataURI,
        bytes32 solanaPubkey
    ) external returns (uint256 profileId);

    function updateProfileMetadata(uint256 profileId, string calldata metadataURI) external;

    function requestLink(uint256 profileId, address otherWalletIdentifier, bytes32 solanaPubkey) external;

    function confirmLink(uint256 profileId) external;

    function unlinkWallet(uint256 profileId, address wallet) external;

    function getProfile(uint256 profileId) external view returns (Profile memory);

    function getProfileByHandle(string calldata handle) external view returns (Profile memory);

    function getLinkedWallets(uint256 profileId) external view returns (LinkedWallet[] memory);

    function resolveProfile(address wallet) external view returns (uint256 profileId);

    function isProfileController(uint256 profileId, address wallet) external view returns (bool);

    function profileExists(uint256 profileId) external view returns (bool);

    function deriveSyntheticAddress(bytes32 solanaPubkey) external pure returns (address);
}
