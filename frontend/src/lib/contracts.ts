import { parseAbi, bytesToHex, hexToBytes, keccak256, type Hex } from "viem";
import bs58 from "bs58";

export interface ChainRuntimeConfig {
  chainId: number;
  chainName: string;
  network: string;
  status: string;
  rpcUrl: string;
  explorerUrl: string;
  romeEvmProgramId: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  solana: {
    cluster: string;
    explorerUrl: string;
    rpc: string;
  };
  registryContractsCount: number;
  wusdcAddress: string | null;
  contracts: {
    identityRegistry: Hex | null;
    workRegistry: Hex | null;
    attestationRegistry: Hex | null;
  };
}

export interface ProfileMetadata {
  displayName: string;
  headline: string;
  bio: string;
  avatarUrl?: string;
  website?: string;
  skills: string[];
}

export interface ProfileData {
  id: bigint;
  owner: Hex;
  ownerSolanaPubkey: Hex;
  handle: string;
  metadataURI: string;
  createdAt: bigint;
  updatedAt: bigint;
}

export interface LinkedWalletData {
  wallet: Hex;
  solanaPubkey: Hex;
  status: number; // 0 = None, 1 = Pending, 2 = Confirmed
  requestedBy: Hex;
  requestedAt: bigint;
  confirmedAt: bigint;
}

export interface WorkRecordData {
  id: bigint;
  profileId: bigint;
  createdBy: Hex;
  title: string;
  description: string;
  evidenceURI: string;
  startDate: bigint;
  endDate: bigint;
  createdAt: bigint;
  revoked: boolean;
  revokedAt: bigint;
}

export interface AttestationData {
  id: bigint;
  profileId: bigint;
  workRecordId: bigint;
  attester: Hex;
  rating: number;
  commentURI: string;
  createdAt: bigint;
  revoked: boolean;
  revokedAt: bigint;
}

export interface ReputationData {
  score: bigint;
  averageRatingHundredths: bigint;
  activeAttestations: bigint;
  distinctAttesters: bigint;
}

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const IDENTITY_REGISTRY_ABI = parseAbi([
  "function createProfile(string handle, string metadataURI) returns (uint256)",
  "function createProfileWithSolanaKey(string handle, string metadataURI, bytes32 solanaPubkey) returns (uint256)",
  "function updateProfileMetadata(uint256 profileId, string metadataURI)",
  "function requestLink(uint256 profileId, address otherWalletIdentifier, bytes32 solanaPubkey)",
  "function confirmLink(uint256 profileId)",
  "function unlinkWallet(uint256 profileId, address wallet)",
  "function getProfile(uint256 profileId) view returns ((uint256 id, address owner, bytes32 ownerSolanaPubkey, string handle, string metadataURI, uint64 createdAt, uint64 updatedAt))",
  "function getProfileByHandle(string handle) view returns ((uint256 id, address owner, bytes32 ownerSolanaPubkey, string handle, string metadataURI, uint64 createdAt, uint64 updatedAt))",
  "function getLinkedWallets(uint256 profileId) view returns ((address wallet, bytes32 solanaPubkey, uint8 status, address requestedBy, uint64 requestedAt, uint64 confirmedAt)[])",
  "function resolveProfile(address wallet) view returns (uint256)",
  "function resolveSolanaProfile(bytes32 solanaPubkey) view returns (uint256)",
  "function isProfileController(uint256 profileId, address wallet) view returns (bool)",
  "function deriveSyntheticAddress(bytes32 solanaPubkey) pure returns (address)",
  "function totalProfiles() view returns (uint256)",
]);

export const WORK_REGISTRY_ABI = parseAbi([
  "function addWorkRecord(uint256 profileId, string title, string description, string evidenceURI, uint64 startDate, uint64 endDate) returns (uint256)",
  "function revokeWorkRecord(uint256 recordId)",
  "function getWorkRecord(uint256 recordId) view returns ((uint256 id, uint256 profileId, address createdBy, string title, string description, string evidenceURI, uint64 startDate, uint64 endDate, uint64 createdAt, bool revoked, uint64 revokedAt))",
  "function getProfileWorkRecords(uint256 profileId) view returns ((uint256 id, uint256 profileId, address createdBy, string title, string description, string evidenceURI, uint64 startDate, uint64 endDate, uint64 createdAt, bool revoked, uint64 revokedAt)[])",
  "function totalWorkRecords() view returns (uint256)",
]);

export const ATTESTATION_REGISTRY_ABI = parseAbi([
  "function attest(uint256 profileId, uint256 workRecordId, uint8 rating, string commentURI) returns (uint256)",
  "function revokeAttestation(uint256 attestationId)",
  "function getReputation(uint256 profileId) view returns ((uint256 score, uint256 averageRatingHundredths, uint256 activeAttestations, uint256 distinctAttesters))",
  "function getAttestation(uint256 attestationId) view returns ((uint256 id, uint256 profileId, uint256 workRecordId, address attester, uint8 rating, string commentURI, uint64 createdAt, bool revoked, uint64 revokedAt))",
  "function getProfileAttestations(uint256 profileId) view returns ((uint256 id, uint256 profileId, uint256 workRecordId, address attester, uint8 rating, string commentURI, uint64 createdAt, bool revoked, uint64 revokedAt)[])",
  "function getWorkRecordAttestations(uint256 workRecordId) view returns ((uint256 id, uint256 profileId, uint256 workRecordId, address attester, uint8 rating, string commentURI, uint64 createdAt, bool revoked, uint64 revokedAt)[])",
  "function getActiveAttestationId(uint256 workRecordId, address attester) view returns (uint256)",
  "function totalAttestations() view returns (uint256)",
]);

export function encodeProfileMetadata(meta: ProfileMetadata): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify(meta))}`;
}

export function parseProfileMetadata(uri: string, fallbackHandle = "builder"): ProfileMetadata {
  if (!uri) {
    return {
      displayName: fallbackHandle,
      headline: "Rome Protocol Builder",
      bio: "",
      skills: [],
    };
  }
  try {
    if (uri.startsWith("data:application/json,")) {
      const parsed = JSON.parse(decodeURIComponent(uri.slice("data:application/json,".length)));
      return {
        displayName: parsed.displayName || fallbackHandle,
        headline: parsed.headline || parsed.role || "Rome Protocol Builder",
        bio: parsed.bio || "",
        avatarUrl: parsed.avatarUrl,
        website: parsed.website,
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      };
    }
    if (uri.trim().startsWith("{")) {
      const parsed = JSON.parse(uri);
      return {
        displayName: parsed.displayName || fallbackHandle,
        headline: parsed.headline || parsed.role || "Rome Protocol Builder",
        bio: parsed.bio || "",
        avatarUrl: parsed.avatarUrl,
        website: parsed.website,
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      };
    }
  } catch {
    // Fall back to raw URI representation
  }
  return {
    displayName: fallbackHandle,
    headline: "Verified RomeID Profile",
    bio: uri,
    skills: [],
  };
}

export function decodeCommentURI(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("data:text/plain,")) {
    try {
      return decodeURIComponent(uri.slice("data:text/plain,".length));
    } catch {
      return uri.slice("data:text/plain,".length);
    }
  }
  return uri;
}

export function encodeCommentURI(comment: string): string {
  const trimmed = comment.trim();
  if (/^(https?:\/\/|ipfs:\/\/)/i.test(trimmed)) return trimmed;
  return `data:text/plain,${encodeURIComponent(trimmed)}`;
}

export function bytes32ToSolanaBase58(b32: Hex): string | null {
  if (!b32 || b32 === ZERO_BYTES32) return null;
  try {
    return bs58.encode(hexToBytes(b32));
  } catch {
    return null;
  }
}

export function solanaBase58ToBytes32(base58Str: string): Hex {
  const decoded = bs58.decode(base58Str.trim());
  if (decoded.length !== 32) {
    throw new Error("Invalid Solana public key (expected 32 bytes in base58).");
  }
  return bytesToHex(decoded);
}

export function computeSyntheticAddressFromBytes32(b32: Hex): Hex {
  return `0x${keccak256(b32).slice(-40)}` as Hex;
}

export function shortenHex(val: string, chars = 6): string {
  if (!val || val.length <= chars * 2 + 2) return val;
  return `${val.slice(0, chars + 2)}...${val.slice(-chars)}`;
}
