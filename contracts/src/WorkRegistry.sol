// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {IWorkRegistry} from "./interfaces/IWorkRegistry.sol";

/// @title WorkRegistry
/// @author RomeID
/// @notice Append-only portfolio work record registry for RomeID profiles.
/// @dev Any confirmed wallet linked to a RomeID profile (EVM lane or Solana lane) can add or
///      mark work records as revoked. Records are immutable and never deleted.
contract WorkRegistry is IWorkRegistry, ReentrancyGuard {
    IIdentityRegistry public immutable identityRegistry;

    uint256 private _nextRecordId = 1;
    mapping(uint256 => WorkRecord) private _records;
    mapping(uint256 => uint256[]) private _profileRecordIds;

    constructor(address identityRegistryAddress) {
        if (identityRegistryAddress == address(0)) revert ZeroAddress();
        identityRegistry = IIdentityRegistry(identityRegistryAddress);
    }

    /// @inheritdoc IWorkRegistry
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

    /// @inheritdoc IWorkRegistry
    /// @dev Marks a work record as revoked without deleting historical data (append-only).
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

    /// @inheritdoc IWorkRegistry
    function getWorkRecord(uint256 recordId) external view returns (WorkRecord memory) {
        if (!_recordExists(recordId)) revert WorkRecordNotFound(recordId);
        return _records[recordId];
    }

    /// @inheritdoc IWorkRegistry
    function getProfileWorkRecords(uint256 profileId) external view returns (WorkRecord[] memory) {
        uint256[] storage ids = _profileRecordIds[profileId];
        uint256 len = ids.length;
        WorkRecord[] memory list = new WorkRecord[](len);
        for (uint256 i = 0; i < len; ++i) {
            list[i] = _records[ids[i]];
        }
        return list;
    }

    /// @inheritdoc IWorkRegistry
    function totalWorkRecords() external view returns (uint256) {
        return _nextRecordId - 1;
    }

    function _recordExists(uint256 recordId) internal view returns (bool) {
        return recordId > 0 && recordId < _nextRecordId;
    }
}
