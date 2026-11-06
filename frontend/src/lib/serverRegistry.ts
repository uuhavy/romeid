import type { Hex } from "viem";
import deploymentsJson from "@/config/deployments.json";
import registrySnapshot from "@/config/registry.generated.json";
import type { ChainRuntimeConfig } from "./contracts";

const DEFAULT_HADRIAN_CHAIN_ID = 200010;

interface SavedDeployment {
  IdentityRegistry?: string;
  WorkRegistry?: string;
  AttestationRegistry?: string;
}

interface RawChainMeta {
  chainId: number;
  name: string;
  network?: string;
  status?: string;
  rpcUrl: string;
  explorerUrl: string;
  romeEvmProgramId: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  solana?: { cluster?: string; explorerUrl?: string; rpc?: string };
}

interface RawTokenMeta {
  address?: string;
  kind?: string;
  mintId?: string;
}

interface SnapshotEntry {
  chain?: RawChainMeta | null;
  contracts?: Record<string, unknown>;
  tokens?: RawTokenMeta[];
}

const nativeImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<{
  getChain: (id: number) => RawChainMeta | null;
  getContracts: (id: number) => Record<string, unknown> | null;
  getTokens: (id: number) => RawTokenMeta[] | null;
}>;

export async function getServerChainConfig(): Promise<ChainRuntimeConfig> {
  const chainId = Number(
    process.env.NEXT_PUBLIC_CHAIN_ID || process.env.CHAIN_ID || DEFAULT_HADRIAN_CHAIN_ID
  );

  let chain: RawChainMeta | null = null;
  let registryContracts: Record<string, unknown> = {};
  let tokens: RawTokenMeta[] = [];

  // 1. Try live ESM @rome-protocol/registry at runtime first
  try {
    const reg = await nativeImport("@rome-protocol/registry");
    const liveChain = reg.getChain(chainId);
    if (liveChain) {
      chain = liveChain;
      registryContracts = (reg.getContracts(chainId) ?? {}) as Record<string, unknown>;
      tokens = (reg.getTokens(chainId) ?? []) as RawTokenMeta[];
    }
  } catch {
    // Serverless environment without traced ESM JSON files; use prebuild snapshot below
  }

  // 2. Fallback to build-time snapshot generated directly from @rome-protocol/registry
  if (!chain) {
    const chainsMap = (
      registrySnapshot as unknown as { chains?: Record<string, SnapshotEntry> }
    ).chains;
    const snap = chainsMap?.[String(chainId)];
    if (snap?.chain) {
      chain = snap.chain;
      registryContracts = snap.contracts ?? {};
      tokens = snap.tokens ?? [];
    }
  }

  if (!chain) {
    throw new Error(`Chain ${chainId} not found in @rome-protocol/registry`);
  }

  const gasToken = tokens.find((t) => t.kind === "gas");
  const wusdc = tokens.find((t) => t.kind === "spl_wrapper" && t.mintId === gasToken?.mintId);

  const deploymentsMap = deploymentsJson as Record<string, SavedDeployment>;
  const saved = deploymentsMap[String(chainId)] ?? {};

  const identityRegistry = (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS ||
    process.env.IDENTITY_REGISTRY_ADDRESS ||
    saved.IdentityRegistry ||
    null) as Hex | null;

  const workRegistry = (process.env.NEXT_PUBLIC_WORK_REGISTRY_ADDRESS ||
    process.env.WORK_REGISTRY_ADDRESS ||
    saved.WorkRegistry ||
    null) as Hex | null;

  const attestationRegistry = (process.env.NEXT_PUBLIC_ATTESTATION_REGISTRY_ADDRESS ||
    process.env.ATTESTATION_REGISTRY_ADDRESS ||
    saved.AttestationRegistry ||
    null) as Hex | null;

  return {
    chainId: chain.chainId,
    chainName: chain.name,
    network: chain.network ?? "devnet",
    status: chain.status ?? "live",
    rpcUrl: process.env.NEXT_PUBLIC_PROXY_URL || process.env.PROXY_URL || chain.rpcUrl,
    explorerUrl: (chain.explorerUrl || "").replace(/\/?$/, "/"),
    romeEvmProgramId: chain.romeEvmProgramId,
    nativeCurrency: chain.nativeCurrency,
    solana: {
      cluster: chain.solana?.cluster ?? "devnet",
      explorerUrl: (chain.solana?.explorerUrl || "https://explorer.solana.com").replace(/\/?$/, ""),
      rpc:
        process.env.NEXT_PUBLIC_SOLANA_RPC ||
        process.env.SOLANA_RPC ||
        chain.solana?.rpc ||
        "https://api.devnet.solana.com",
    },
    registryContractsCount: Object.keys(registryContracts).length,
    wusdcAddress: wusdc?.address ?? null,
    contracts: {
      identityRegistry,
      workRegistry,
      attestationRegistry,
    },
  };
}
