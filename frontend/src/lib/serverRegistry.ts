import { getChain, getContracts, getTokens } from "@rome-protocol/registry";
import type { Hex } from "viem";
import deploymentsJson from "@/config/deployments.json";
import type { ChainRuntimeConfig } from "./contracts";

const DEFAULT_HADRIAN_CHAIN_ID = 200010;

interface SavedDeployment {
  IdentityRegistry?: string;
  WorkRegistry?: string;
  AttestationRegistry?: string;
}

export function getServerChainConfig(): ChainRuntimeConfig {
  const chainId = Number(
    process.env.NEXT_PUBLIC_CHAIN_ID || process.env.CHAIN_ID || DEFAULT_HADRIAN_CHAIN_ID
  );
  const chain = getChain(chainId) as {
    chainId: number;
    name: string;
    network?: string;
    status?: string;
    rpcUrl: string;
    explorerUrl: string;
    romeEvmProgramId: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    solana?: { cluster?: string; explorerUrl?: string; rpc?: string };
  } | null;

  if (!chain) {
    throw new Error(`Chain ${chainId} not found in @rome-protocol/registry`);
  }

  const registryContracts = (getContracts(chainId) ?? {}) as Record<string, unknown>;
  const tokens = (getTokens(chainId) ?? []) as Array<{
    address?: string;
    kind?: string;
    mintId?: string;
  }>;
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
