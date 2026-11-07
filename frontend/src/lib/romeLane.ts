"use client";

import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import { createPublicClient, http, type Hex } from "viem";
import {
  relayV1,
  submitRomeTx,
  submitRomeTxSolanaLane,
  submitRomeTxV1,
  type LaneSigner,
} from "@rome-protocol/sdk";
import type { ChainRuntimeConfig } from "./contracts";

export interface TxOutcome {
  lane: "evm" | "solana";
  evmTxHash?: Hex;
  romeExplorerUrl?: string;
  solanaSignatures: string[];
  solanaExplorerUrls: string[];
  route?: string;
}

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export function makePublicClient(cfg: ChainRuntimeConfig) {
  return createPublicClient({
    transport: http(cfg.rpcUrl),
  });
}

export async function ensureEvmChain(provider: Eip1193Provider, cfg: ChainRuntimeConfig) {
  const hexChainId = `0x${cfg.chainId.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 4902 || String(err).includes("Unrecognized chain")) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexChainId,
            chainName: cfg.chainName,
            nativeCurrency: cfg.nativeCurrency,
            rpcUrls: [cfg.rpcUrl],
            blockExplorerUrls: [cfg.explorerUrl],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function enrichSolanaSettlement(
  cfg: ChainRuntimeConfig,
  evmTxHash: Hex
): Promise<{ solanaSignatures: string[]; solanaExplorerUrls: string[] }> {
  try {
    const res = await fetch(`/api/solana-settlement?hash=${evmTxHash}`, { cache: "no-store" });
    if (!res.ok) return { solanaSignatures: [], solanaExplorerUrls: [] };
    const data = (await res.json()) as {
      solanaSettlement?: string[];
      solanaExplorerUrls?: string[];
    };
    return {
      solanaSignatures: data.solanaSettlement ?? [],
      solanaExplorerUrls: data.solanaExplorerUrls ?? [],
    };
  } catch {
    return { solanaSignatures: [], solanaExplorerUrls: [] };
  }
}

export async function sendEvmLaneTx(params: {
  provider: Eip1193Provider;
  from: Hex;
  to: Hex;
  data?: Hex;
  value?: bigint;
  cfg: ChainRuntimeConfig;
  onStatus?: (msg: string) => void;
}): Promise<TxOutcome> {
  const { provider, from, to, data = "0x", value, cfg, onStatus } = params;
  onStatus?.(`Switching MetaMask to ${cfg.chainName} (${cfg.chainId})...`);
  await ensureEvmChain(provider, cfg);

  onStatus?.("Submitting transaction via @rome-protocol/sdk submitRomeTx...");
  const hash = (await submitRomeTx(provider as never, {
    from,
    to,
    data,
    ...(value !== undefined ? { value } : {}),
  })) as Hex;

  onStatus?.("Waiting for Rome EVM & Solana L1 confirmation...");
  const pub = makePublicClient(cfg);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted on Rome EVM (tx: ${hash})`);
  }

  const settlement = await enrichSolanaSettlement(cfg, hash);
  return {
    lane: "evm",
    evmTxHash: hash,
    romeExplorerUrl: `${cfg.explorerUrl}tx/${hash}`,
    solanaSignatures: settlement.solanaSignatures,
    solanaExplorerUrls: settlement.solanaExplorerUrls,
    route: "evm-eip1559",
  };
}

function findWalletStandardSigner(
  walletName: string | undefined,
  pubkey: PublicKey,
  cluster: string
): LaneSigner | null {
  try {
    const solChain = /^mainnet/.test(cluster)
      ? "solana:mainnet"
      : cluster === "testnet"
        ? "solana:testnet"
        : "solana:devnet";

    const wallets = getWallets().get();
    const b58 = pubkey.toBase58();
    const matched =
      wallets.find(
        (w) =>
          (!walletName || w.name.toLowerCase().includes(walletName.toLowerCase())) &&
          w.accounts.some((a) => new PublicKey(a.publicKey).toBase58() === b58) &&
          "solana:signMessage" in w.features &&
          "solana:signTransaction" in w.features
      ) ||
      wallets.find(
        (w) =>
          w.accounts.some((a) => new PublicKey(a.publicKey).toBase58() === b58) &&
          "solana:signMessage" in w.features &&
          "solana:signTransaction" in w.features
      );

    if (!matched) return null;
    const account = matched.accounts.find((a) => new PublicKey(a.publicKey).toBase58() === b58);
    if (!account) return null;

    const features = matched.features as Record<string, any>;
    return {
      payer: pubkey,
      signAuthHash: async (message: Uint8Array) => {
        const [{ signature, signedMessage }] = await features["solana:signMessage"].signMessage({
          account,
          message,
        });
        if (
          signedMessage &&
          (signedMessage.length !== message.length ||
            signedMessage.some((b: number, i: number) => b !== message[i]))
        ) {
          throw new Error(`${matched.name} altered the Rome authorization message.`);
        }
        return signature as Uint8Array;
      },
      signV1Wire: async (unsignedWire: Uint8Array) => {
        const [{ signedTransaction }] = await features["solana:signTransaction"].signTransaction({
          account,
          transaction: unsignedWire,
          chain: solChain,
        });
        return (signedTransaction as Uint8Array).slice(-64);
      },
    };
  } catch {
    return null;
  }
}

export async function sendSolanaLaneTx(params: {
  pubkey: PublicKey;
  walletName?: string;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  to: Hex;
  data: Hex;
  cfg: ChainRuntimeConfig;
  onStatus?: (msg: string) => void;
}): Promise<TxOutcome> {
  const { pubkey, walletName, signTransaction, to, data, cfg, onStatus } = params;
  const connection = new Connection(cfg.solana.rpc, "confirmed");
  const clusterSuffix =
    cfg.solana.cluster && cfg.solana.cluster !== "mainnet" && cfg.solana.cluster !== "mainnet-beta"
      ? `?cluster=${cfg.solana.cluster}`
      : "";

  const wsSigner = findWalletStandardSigner(walletName, pubkey, cfg.solana.cluster);

  // Path A: Canonical v1 Solana lane (`submitRomeTxV1` or `relayV1` when wallet has 0 devnet SOL / rejects v1 wire)
  if (wsSigner) {
    const v1Deps = {
      connection,
      proxyUrl: cfg.rpcUrl,
      chainId: cfg.chainId,
      programId: cfg.romeEvmProgramId,
      signer: wsSigner,
    };

    let solLamports = 0;
    try {
      solLamports = await connection.getBalance(pubkey);
    } catch {
      solLamports = 0;
    }

    try {
      onStatus?.(
        solLamports >= 10_000
          ? "Signing Rome authorization & Solana v1 transaction..."
          : "Signing Rome Ed25519 authorization (proxy relay — 0 SOL needed)..."
      );
      const res =
        solLamports >= 10_000
          ? await submitRomeTxV1(v1Deps, { to, data })
          : await relayV1(v1Deps, { to, data });
      if (res.receipt?.status !== "0x1") {
        throw new Error(`Solana-lane call reverted or timed out (${res.hash})`);
      }

      const extra = await enrichSolanaSettlement(cfg, res.hash);
      const sigs =
        "signature" in res && res.signature
          ? Array.from(new Set([res.signature, ...extra.solanaSignatures]))
          : extra.solanaSignatures;

      return {
        lane: "solana",
        evmTxHash: res.hash,
        romeExplorerUrl: `${cfg.explorerUrl}tx/${res.hash}`,
        solanaSignatures: sigs,
        solanaExplorerUrls: sigs.map((s) => `${cfg.solana.explorerUrl}/tx/${s}${clusterSuffix}`),
        route: `solana-v1-${res.route}`,
      };
    } catch (v1Err) {
      const msg = String((v1Err as Error)?.message ?? v1Err).toLowerCase();
      if (msg.includes("user rejected") || msg.includes("cancelled") || msg.includes("canceled")) {
        throw v1Err;
      }
      // If atomic v1 wire signing failed (e.g. Phantom on devnet), try relayV1 before legacy DoTxUnsigned
      if (solLamports >= 10_000) {
        try {
          onStatus?.("Retrying via Rome v1 Ed25519 relay...");
          const relayRes = await relayV1(v1Deps, { to, data });
          if (relayRes.receipt?.status === "0x1") {
            const extra = await enrichSolanaSettlement(cfg, relayRes.hash);
            return {
              lane: "solana",
              evmTxHash: relayRes.hash,
              romeExplorerUrl: `${cfg.explorerUrl}tx/${relayRes.hash}`,
              solanaSignatures: extra.solanaSignatures,
              solanaExplorerUrls: extra.solanaSignatures.map(
                (s) => `${cfg.solana.explorerUrl}/tx/${s}${clusterSuffix}`
              ),
              route: `solana-v1-${relayRes.route}`,
            };
          }
        } catch {
          // Fall through to legacy DoTxUnsigned
        }
      }
      if (!signTransaction) throw v1Err;
      onStatus?.(
        "Falling back to legacy DoTxUnsigned Solana lane..."
      );
    }
  }

  // Path B: Legacy Solana lane (`submitRomeTxSolanaLane`) — compatible with Phantom on devnet!
  if (!signTransaction) {
    throw new Error("Connected Solana wallet does not expose signTransaction.");
  }

  onStatus?.("Assembling & signing DoTxUnsigned Solana transaction...");
  const legacyRes = await submitRomeTxSolanaLane(
    {
      connection,
      proxyUrl: cfg.rpcUrl,
      programId: cfg.romeEvmProgramId,
      chainId: cfg.chainId,
      payer: pubkey,
      signTransaction,
    },
    {
      to,
      data,
      autoProvision: false,
    }
  );

  return {
    lane: "solana",
    solanaSignatures: [legacyRes.signature],
    solanaExplorerUrls: [`${cfg.solana.explorerUrl}/tx/${legacyRes.signature}${clusterSuffix}`],
    route: "solana-legacy-dotx",
  };
}
