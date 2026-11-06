// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// ============================================================================
// RomeID — Flattened All-in-One Contract Bundle for Remix IDE (Solidity 0.8.28)
// Target Network: Rome Hadrian Testnet (Chain ID: 200010, Gas Token: USDC)
// Compiler Settings: Solidity 0.8.28 | EVM Version: cancun | Optimizer: 200 runs
//
// Deploy Order in Remix ("Deploy & Run Transactions" -> Injected Provider MetaMask):
//   1. IdentityRegistry()                                    -> copy addr1
//   2. WorkRegistry(addr1)                                   -> copy addr2
//   3. AttestationRegistry(addr1, addr2)                     -> copy addr3
// ============================================================================

library StorageSlot {
    struct Uint256Slot {
        uint256 value;
    }

    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }
}

abstract contract ReentrancyGuard {
    using StorageSlot for bytes32;

    bytes32 private constant REENTRANCY_GUARD_STORAGE =
        0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00;

    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    error ReentrancyGuardReentrantCall();

    constructor() {
        REENTRANCY_GUARD_STORAGE.getUint256Slot().value = NOT_ENTERED;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        if (REENTRANCY_GUARD_STORAGE.getUint256Slot().value == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }
        REENTRANCY_GUARD_STORAGE.getUint256Slot().value = ENTERED;
    }

    function _nonReentrantAfter() private {
        REENTRANCY_GUARD_STORAGE.getUint256Slot().value = NOT_ENTERED;
    }
}

/// @title IRomeSystemProgram
/// @notice Official Rome Protocol SystemProgram precompile interface (0xfF00000000000000000000000000000000000007).
interface IRomeSystemProgram {
    struct Seed {
        bytes item;
    }

    function program_id() external view returns (bytes32);
    function rome_evm_program_id() external view returns (bytes32);
    function find_program_address(bytes32 program, Seed[] memory seeds) external pure returns (bytes32, uint8);
    function bytes32_to_base58(bytes32 pubkey) external view returns (bytes memory);
    function base58_to_bytes32(bytes memory base58Str) external view returns (bytes32);
    function operator() external view returns (bytes32);
    function mint_id() external view returns (bytes32);
}

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

/// @title IWorkRegistry
/// @notice Interface for RomeID append-only portfolio work records.
interface IWorkRegistry {
    struct WorkRecord {
        uint256 id;
        uint256 profileId;
        address createdBy;
        string title;
        string description;
        string evidenceURI;
        uint64 startDate;
        uint64 endDate;
        uint64 createdAt;
        bool revoked;
        uint64 revokedAt;
    }

    event WorkRecordAdded(
        uint256 indexed recordId,
        uint256 indexed profileId,
        address indexed createdBy,
        string title,
        string evidenceURI,
        uint64 startDate,
        uint64 endDate
    );
    event WorkRecordRevoked(uint256 indexed recordId, uint256 indexed profileId, address indexed revokedBy);

    error ZeroAddress();
    error InvalidTitle();
    error InvalidDateRange(uint64 startDate, uint64 endDate);
    error WorkRecordNotFound(uint256 recordId);
    error WorkRecordAlreadyRevoked(uint256 recordId);
    error UnauthorizedProfileAction(uint256 profileId, address caller);

    function addWorkRecord(
        uint256 profileId,
        string calldata title,
        string calldata description,
        string calldata evidenceURI,
        uint64 startDate,
        uint64 endDate
    ) external returns (uint256 recordId);

    function revokeWorkRecord(uint256 recordId) external;

    function getWorkRecord(uint256 recordId) external view returns (WorkRecord memory);

    function getProfileWorkRecords(uint256 profileId) external view returns (WorkRecord[] memory);

    function totalWorkRecords() external view returns (uint256);
}

/// @title IdentityRegistry
/// @author RomeID
/// @notice Unified dual-lane identity registry on Rome Protocol. Links an EVM wallet (MetaMask)
///         and a Solana wallet (Phantom / Solflare / Backpack) to a single shared on-chain profile.
contract IdentityRegistry is IIdentityRegistry, ReentrancyGuard {
    address public constant ROME_SYSTEM_PROGRAM = 0xfF00000000000000000000000000000000000007;

    uint256 private _nextProfileId = 1;

    mapping(uint256 => Profile) private _profiles;
    mapping(bytes32 => uint256) private _handleHashToProfile;
    mapping(address => uint256) private _walletToProfile;
    mapping(bytes32 => uint256) private _solanaPubkeyToProfile;

    mapping(uint256 => address[]) private _linkedWalletAddresses;
    mapping(uint256 => mapping(address => uint256)) private _linkedWalletIndexPlusOne;
    mapping(uint256 => mapping(address => LinkedWallet)) private _links;

    function createProfile(
        string calldata handle,
        string calldata metadataURI
    ) external nonReentrant returns (uint256 profileId) {
        return _createProfile(msg.sender, handle, metadataURI, bytes32(0));
    }

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

    function updateProfileMetadata(uint256 profileId, string calldata metadataURI) external nonReentrant {
        if (!_profileExists(profileId)) revert ProfileNotFound(profileId);
        if (!isProfileController(profileId, msg.sender)) {
            revert NotProfileController(profileId, msg.sender);
        }
        _profiles[profileId].metadataURI = metadataURI;
        _profiles[profileId].updatedAt = uint64(block.timestamp);

        emit ProfileMetadataUpdated(profileId, msg.sender, metadataURI);
    }

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

    function getProfile(uint256 profileId) external view returns (Profile memory) {
        if (!_profileExists(profileId)) revert ProfileNotFound(profileId);
        return _profiles[profileId];
    }

    function getProfileByHandle(string calldata handle) external view returns (Profile memory) {
        string memory normalized = _normalizeAndValidateHandle(handle);
        uint256 profileId = _handleHashToProfile[keccak256(bytes(normalized))];
        if (profileId == 0) revert ProfileNotFound(0);
        return _profiles[profileId];
    }

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

    function resolveProfile(address wallet) external view returns (uint256 profileId) {
        return _walletToProfile[wallet];
    }

    function resolveSolanaProfile(bytes32 solanaPubkey) external view returns (uint256 profileId) {
        if (solanaPubkey == bytes32(0)) return 0;
        uint256 direct = _solanaPubkeyToProfile[solanaPubkey];
        if (direct != 0) return direct;
        return _walletToProfile[deriveSyntheticAddress(solanaPubkey)];
    }

    function isProfileController(uint256 profileId, address wallet) public view returns (bool) {
        if (!_profileExists(profileId) || wallet == address(0)) return false;
        if (_profiles[profileId].owner == wallet) return true;
        return _links[profileId][wallet].status == LinkStatus.Confirmed;
    }

    function profileExists(uint256 profileId) external view returns (bool) {
        return _profileExists(profileId);
    }

    function totalProfiles() external view returns (uint256) {
        return _nextProfileId - 1;
    }

    function deriveSyntheticAddress(bytes32 solanaPubkey) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(solanaPubkey)))));
    }

    function solanaPubkeyToBase58(bytes32 solanaPubkey) external view returns (string memory) {
        (bool ok, bytes memory ret) = ROME_SYSTEM_PROGRAM.staticcall(
            abi.encodeCall(IRomeSystemProgram.bytes32_to_base58, (solanaPubkey))
        );
        if (!ok || ret.length == 0) revert SystemPrecompileUnavailable();
        return string(abi.decode(ret, (bytes)));
    }

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
                out[i] = bytes1(uint8(c) + 32);
            } else if (
                (c >= 0x61 && c <= 0x7A) ||
                (c >= 0x30 && c <= 0x39) ||
                c == 0x5F ||
                c == 0x2D
            ) {
                out[i] = c;
            } else {
                revert InvalidHandle();
            }
        }
        return string(out);
    }
}

/// @title WorkRegistry
/// @author RomeID
/// @notice Append-only portfolio work record registry for RomeID profiles.
contract WorkRegistry is IWorkRegistry, ReentrancyGuard {
    IIdentityRegistry public immutable identityRegistry;

    uint256 private _nextRecordId = 1;
    mapping(uint256 => WorkRecord) private _records;
    mapping(uint256 => uint256[]) private _profileRecordIds;

    constructor(address identityRegistryAddress) {
        if (identityRegistryAddress == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(identityRegistryAddress);
    }

    function addWorkRecord(
        uint256 profileId,
        string calldata title,
        string calldata description,
        string calldata evidenceURI,
        uint64 startDate,
        uint64 endDate
    ) external nonReentrant returns (uint256 recordId) {
        if (!identityRegistry.isProfileController(profileId, msg.sender)) {
            revert UnauthorizedProfileAction(profileId, msg.sender);
        }

        uint256 titleLen = bytes(title).length;
        if (titleLen == 0 || titleLen > 160) revert InvalidTitle();
        if (endDate != 0 && endDate < startDate) {
            revert InvalidDateRange(startDate, endDate);
        }

        recordId = _nextRecordId++;
        _records[recordId] = WorkRecord({
            id: recordId,
            profileId: profileId,
            createdBy: msg.sender,
            title: title,
            description: description,
            evidenceURI: evidenceURI,
            startDate: startDate,
            endDate: endDate,
            createdAt: uint64(block.timestamp),
            revoked: false,
            revokedAt: 0
        });

        _profileRecordIds[profileId].push(recordId);

        emit WorkRecordAdded(recordId, profileId, msg.sender, title, evidenceURI, startDate, endDate);
    }

    function revokeWorkRecord(uint256 recordId) external nonReentrant {
        if (!_recordExists(recordId)) revert WorkRecordNotFound(recordId);
        WorkRecord storage rec = _records[recordId];
        if (!identityRegistry.isProfileController(rec.profileId, msg.sender)) {
            revert UnauthorizedProfileAction(rec.profileId, msg.sender);
        }
        if (rec.revoked) revert WorkRecordAlreadyRevoked(recordId);

        rec.revoked = true;
        rec.revokedAt = uint64(block.timestamp);

        emit WorkRecordRevoked(recordId, rec.profileId, msg.sender);
    }

    function getWorkRecord(uint256 recordId) external view returns (WorkRecord memory) {
        if (!_recordExists(recordId)) revert WorkRecordNotFound(recordId);
        return _records[recordId];
    }

    function getProfileWorkRecords(uint256 profileId) external view returns (WorkRecord[] memory) {
        uint256[] storage ids = _profileRecordIds[profileId];
        uint256 len = ids.length;
        WorkRecord[] memory list = new WorkRecord[](len);
        for (uint256 i = 0; i < len; ++i) {
            list[i] = _records[ids[i]];
        }
        return list;
    }

    function totalWorkRecords() external view returns (uint256) {
        return _nextRecordId - 1;
    }

    function _recordExists(uint256 recordId) internal view returns (bool) {
        return recordId > 0 && recordId < _nextRecordId;
    }
}

/// @title AttestationRegistry
/// @author RomeID
/// @notice Employer attestation and portable on-chain reputation engine for RomeID profiles.
contract AttestationRegistry is ReentrancyGuard {
    struct Attestation {
        uint256 id;
        uint256 profileId;
        uint256 workRecordId;
        address attester;
        uint8 rating;
        string commentURI;
        uint64 createdAt;
        bool revoked;
        uint64 revokedAt;
    }

    struct ReputationSummary {
        uint256 score;
        uint256 averageRatingHundredths;
        uint256 activeAttestations;
        uint256 distinctAttesters;
    }

    struct ReputationAggregate {
        uint256 activeCount;
        uint256 ratingSum;
        uint256 distinctAttesters;
    }

    event AttestationCreated(
        uint256 indexed attestationId,
        uint256 indexed profileId,
        uint256 indexed workRecordId,
        address attester,
        uint8 rating,
        string commentURI
    );
    event AttestationRevoked(
        uint256 indexed attestationId,
        uint256 indexed profileId,
        uint256 indexed workRecordId,
        address attester
    );

    error ZeroAddress();
    error InvalidRating(uint8 rating);
    error ProfileNotFound(uint256 profileId);
    error WorkRecordMismatch(uint256 expectedProfileId, uint256 actualProfileId);
    error CannotAttestRevokedWorkRecord(uint256 workRecordId);
    error SelfAttestationForbidden(uint256 profileId, address caller);
    error DuplicateAttestation(uint256 workRecordId, address attester);
    error AttestationNotFound(uint256 attestationId);
    error NotOriginalAttester(uint256 attestationId, address caller);
    error AttestationAlreadyRevoked(uint256 attestationId);

    IIdentityRegistry public immutable identityRegistry;
    IWorkRegistry public immutable workRegistry;

    uint256 private _nextAttestationId = 1;
    mapping(uint256 => Attestation) private _attestations;
    mapping(uint256 => uint256[]) private _profileAttestationIds;
    mapping(uint256 => uint256[]) private _recordAttestationIds;
    mapping(uint256 => mapping(address => uint256)) private _activeAttestationByRecordAndAttester;
    mapping(uint256 => mapping(address => uint256)) private _attesterActiveCountForProfile;
    mapping(uint256 => ReputationAggregate) private _aggregates;

    constructor(address identityRegistryAddress, address workRegistryAddress) {
        if (identityRegistryAddress == address(0) || workRegistryAddress == address(0)) {
            revert ZeroAddress();
        }
        identityRegistry = IIdentityRegistry(identityRegistryAddress);
        workRegistry = IWorkRegistry(workRegistryAddress);
    }

    function attest(
        uint256 profileId,
        uint256 workRecordId,
        uint8 rating,
        string calldata commentURI
    ) external nonReentrant returns (uint256 attestationId) {
        if (rating < 1 || rating > 5) revert InvalidRating(rating);
        if (!identityRegistry.profileExists(profileId)) revert ProfileNotFound(profileId);
        if (identityRegistry.isProfileController(profileId, msg.sender)) {
            revert SelfAttestationForbidden(profileId, msg.sender);
        }

        IWorkRegistry.WorkRecord memory rec = workRegistry.getWorkRecord(workRecordId);
        if (rec.profileId != profileId) {
            revert WorkRecordMismatch(profileId, rec.profileId);
        }
        if (rec.revoked) {
            revert CannotAttestRevokedWorkRecord(workRecordId);
        }

        if (_activeAttestationByRecordAndAttester[workRecordId][msg.sender] != 0) {
            revert DuplicateAttestation(workRecordId, msg.sender);
        }

        attestationId = _nextAttestationId++;
        _attestations[attestationId] = Attestation({
            id: attestationId,
            profileId: profileId,
            workRecordId: workRecordId,
            attester: msg.sender,
            rating: rating,
            commentURI: commentURI,
            createdAt: uint64(block.timestamp),
            revoked: false,
            revokedAt: 0
        });

        _activeAttestationByRecordAndAttester[workRecordId][msg.sender] = attestationId;
        _profileAttestationIds[profileId].push(attestationId);
        _recordAttestationIds[workRecordId].push(attestationId);

        ReputationAggregate storage agg = _aggregates[profileId];
        agg.activeCount += 1;
        agg.ratingSum += rating;
        if (_attesterActiveCountForProfile[profileId][msg.sender] == 0) {
            agg.distinctAttesters += 1;
        }
        _attesterActiveCountForProfile[profileId][msg.sender] += 1;

        emit AttestationCreated(attestationId, profileId, workRecordId, msg.sender, rating, commentURI);
    }

    function revokeAttestation(uint256 attestationId) external nonReentrant {
        if (!_attestationExists(attestationId)) revert AttestationNotFound(attestationId);
        Attestation storage att = _attestations[attestationId];
        if (att.attester != msg.sender) revert NotOriginalAttester(attestationId, msg.sender);
        if (att.revoked) revert AttestationAlreadyRevoked(attestationId);

        att.revoked = true;
        att.revokedAt = uint64(block.timestamp);
        delete _activeAttestationByRecordAndAttester[att.workRecordId][msg.sender];

        ReputationAggregate storage agg = _aggregates[att.profileId];
        agg.activeCount -= 1;
        agg.ratingSum -= att.rating;

        uint256 remainingForAttester = _attesterActiveCountForProfile[att.profileId][msg.sender] - 1;
        _attesterActiveCountForProfile[att.profileId][msg.sender] = remainingForAttester;
        if (remainingForAttester == 0) {
            agg.distinctAttesters -= 1;
        }

        emit AttestationRevoked(attestationId, att.profileId, att.workRecordId, msg.sender);
    }

    function getReputation(uint256 profileId) external view returns (ReputationSummary memory summary) {
        if (!identityRegistry.profileExists(profileId)) revert ProfileNotFound(profileId);

        ReputationAggregate memory agg = _aggregates[profileId];
        if (agg.activeCount == 0) {
            return ReputationSummary({
                score: 0,
                averageRatingHundredths: 0,
                activeAttestations: 0,
                distinctAttesters: 0
            });
        }

        uint256 qualityPts = (agg.ratingSum * 140) / agg.activeCount;
        uint256 volumePts = agg.activeCount * 20;
        if (volumePts > 200) volumePts = 200;

        uint256 diversityPts = agg.distinctAttesters * 20;
        if (diversityPts > 100) diversityPts = 100;

        summary = ReputationSummary({
            score: qualityPts + volumePts + diversityPts,
            averageRatingHundredths: (agg.ratingSum * 100) / agg.activeCount,
            activeAttestations: agg.activeCount,
            distinctAttesters: agg.distinctAttesters
        });
    }

    function getAttestation(uint256 attestationId) external view returns (Attestation memory) {
        if (!_attestationExists(attestationId)) revert AttestationNotFound(attestationId);
        return _attestations[attestationId];
    }

    function getProfileAttestations(uint256 profileId) external view returns (Attestation[] memory) {
        uint256[] storage ids = _profileAttestationIds[profileId];
        uint256 len = ids.length;
        Attestation[] memory list = new Attestation[](len);
        for (uint256 i = 0; i < len; ++i) {
            list[i] = _attestations[ids[i]];
        }
        return list;
    }

    function getWorkRecordAttestations(uint256 workRecordId) external view returns (Attestation[] memory) {
        uint256[] storage ids = _recordAttestationIds[workRecordId];
        uint256 len = ids.length;
        Attestation[] memory list = new Attestation[](len);
        for (uint256 i = 0; i < len; ++i) {
            list[i] = _attestations[ids[i]];
        }
        return list;
    }

    function getActiveAttestationId(uint256 workRecordId, address attester) external view returns (uint256) {
        return _activeAttestationByRecordAndAttester[workRecordId][attester];
    }

    function totalAttestations() external view returns (uint256) {
        return _nextAttestationId - 1;
    }

    function _attestationExists(uint256 attestationId) internal view returns (bool) {
        return attestationId > 0 && attestationId < _nextAttestationId;
    }
}
