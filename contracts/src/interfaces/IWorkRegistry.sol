// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

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
