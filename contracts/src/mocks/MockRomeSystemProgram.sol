// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockRomeSystemProgram
/// @notice Test mock etched at 0xFF00000000000000000000000000000000000007 during local Hardhat unit tests
///         to simulate Rome EVM's SystemProgram base58 conversion precompile.
contract MockRomeSystemProgram {
    mapping(bytes32 => bytes) private _toB58;
    mapping(bytes32 => bytes32) private _fromB58Hash;

    function registerMapping(bytes32 pubkey, string calldata base58Str) external {
        _toB58[pubkey] = bytes(base58Str);
        _fromB58Hash[keccak256(bytes(base58Str))] = pubkey;
    }

    function bytes32_to_base58(bytes32 pubkey) external view returns (bytes memory) {
        return _toB58[pubkey];
    }

    function base58_to_bytes32(bytes memory base58Str) external view returns (bytes32) {
        return _fromB58Hash[keccak256(base58Str)];
    }
}
