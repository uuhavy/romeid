// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {IWorkRegistry} from "./interfaces/IWorkRegistry.sol";

/// @title AttestationRegistry
/// @author RomeID
/// @notice Employer attestation and portable on-chain reputation engine for RomeID profiles.
/// @dev Employers can connect from either the EVM lane (MetaMask) or Solana lane (Phantom/Solflare)
///      to attest to verified work records. Computes a bounded 0-1000 reputation score in O(1) gas.
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

    /// @dev Enforces one active attestation per attester per work record.
    mapping(uint256 => mapping(address => uint256)) private _activeAttestationByRecordAndAttester;

    /// @dev Tracks active attestation count per (profileId, attester) to maintain exact distinctAttesters in O(1).
    mapping(uint256 => mapping(address => uint256)) private _attesterActiveCountForProfile;
    mapping(uint256 => ReputationAggregate) private _aggregates;

    constructor(address identityRegistryAddress, address workRegistryAddress) {
        if (identityRegistryAddress == address(0) || workRegistryAddress == address(0)) {
            revert ZeroAddress();
        }
        identityRegistry = IIdentityRegistry(identityRegistryAddress);
        workRegistry = IWorkRegistry(workRegistryAddress);
    }

    /// @notice Submit an employer attestation (rating 1-5) for a specific work record.
    /// @dev Prevents self-attestation from any wallet linked to `profileId` and enforces at most
    ///      one active attestation per `(workRecordId, msg.sender)`.
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

    /// @notice Revoke a previously submitted attestation. Callable ONLY by the original attester.
    /// @dev Immediately updates the profile's O(1) reputation aggregate and clears the per-record lock.
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

    /// @notice Computes the portable on-chain Reputation Score (0 - 1000 scale) for `profileId`.
    /// @dev Reputation Formula (0 - 1000 integer points, O(1) gas):
    ///      If `activeAttestations == 0`, returns `(0, 0, 0, 0)`.
    ///      Otherwise:
    ///        1. Quality Component (max 700 pts, 70% weight):
    ///             `qualityPts = (ratingSum * 140) / activeAttestations`
    ///             (1.0 avg -> 140 pts, 5.0 avg -> 700 pts)
    ///        2. Volume Component (max 200 pts, 20% weight):
    ///             `volumePts = min(activeAttestations * 20, 200)`
    ///             (+20 pts per active attestation, saturating at 10 attestations)
    ///        3. Attester Diversity Bonus (max 100 pts, 10% weight):
    ///             `diversityPts = min(distinctAttesters * 20, 100)`
    ///             (+20 pts per unique active attester, saturating at 5 distinct attesters)
    ///        `score = qualityPts + volumePts + diversityPts` (bounded in [180, 1000] when activeCount >= 1).
    ///      Note: Revoking a work record blocks *new* attestations on that record, while existing
    ///      employer attestations remain counted unless revoked by the original attester via
    ///      `revokeAttestation`, preventing profile owners from selectively hiding low ratings.
    /// @param profileId The RomeID profile identifier.
    /// @return summary Struct containing `score` (0-1000), `averageRatingHundredths` (100-500),
    ///                 `activeAttestations`, and `distinctAttesters`.
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

    /// @notice Fetch a single attestation by ID.
    function getAttestation(uint256 attestationId) external view returns (Attestation memory) {
        if (!_attestationExists(attestationId)) revert AttestationNotFound(attestationId);
        return _attestations[attestationId];
    }

    /// @notice Fetch all attestations (active and revoked) associated with a profile.
    function getProfileAttestations(uint256 profileId) external view returns (Attestation[] memory) {
        uint256[] storage ids = _profileAttestationIds[profileId];
        uint256 len = ids.length;
        Attestation[] memory list = new Attestation[](len);
        for (uint256 i = 0; i < len; ++i) {
            list[i] = _attestations[ids[i]];
        }
        return list;
    }

    /// @notice Fetch all attestations (active and revoked) for a specific work record.
    function getWorkRecordAttestations(uint256 workRecordId) external view returns (Attestation[] memory) {
        uint256[] storage ids = _recordAttestationIds[workRecordId];
        uint256 len = ids.length;
        Attestation[] memory list = new Attestation[](len);
        for (uint256 i = 0; i < len; ++i) {
            list[i] = _attestations[ids[i]];
        }
        return list;
    }

    /// @notice Returns the active attestation ID for `(workRecordId, attester)`, or 0 if none.
    function getActiveAttestationId(uint256 workRecordId, address attester) external view returns (uint256) {
        return _activeAttestationByRecordAndAttester[workRecordId][attester];
    }

    /// @notice Returns the total number of attestations ever created.
    function totalAttestations() external view returns (uint256) {
        return _nextAttestationId - 1;
    }

    function _attestationExists(uint256 attestationId) internal view returns (bool) {
        return attestationId > 0 && attestationId < _nextAttestationId;
    }
}
