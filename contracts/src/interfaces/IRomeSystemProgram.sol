// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IRomeSystemProgram
/// @notice Official Rome Protocol SystemProgram precompile interface (0xFF00000000000000000000000000000000000007).
/// @dev Matches `rome-protocol/rome-solidity/contracts/interface.sol` and `rome-protocol/sdk` SYSTEM_ABI.
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
