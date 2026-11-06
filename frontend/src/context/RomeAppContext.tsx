"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, injected, useAccount, useConnect, useDisconnect } from "wagmi";
import { defineChain, type Hex } from "viem";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { pubkeyToBytes32, syntheticAddress } from "@rome-protocol/sdk";
import "@solana/wallet-adapter-react-ui/styles.css";

import {
  ATTESTATION_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
  WORK_REGISTRY_ABI,
  type AttestationData,
  type ChainRuntimeConfig,
  type LinkedWalletData,
  type ProfileData,
  type ReputationData,
  type WorkRecordData,
} from "@/lib/contracts";
import {
  makePublicClient,
  sendEvmLaneTx,
  sendSolanaLaneTx,
  type Eip1193Provider,
  type TxOutcome,
} from "@/lib/romeLane";

export type ActiveLane = "evm" | "solana";

interface RomeContextValue {
  config: ChainRuntimeConfig;
  activeLane: ActiveLane;
  setActiveLane: (lane: ActiveLane) => void;

  // EVM wallet state
  evmAddress: Hex | null;
  evmConnected: boolean;
  connectMetaMask: () => Promise<void>;
  disconnectMetaMask: () => void;

  // Solana wallet state
  solanaPubkeyBase58: string | null;
  solanaPubkeyBytes32: Hex | null;
  solanaSyntheticAddress: Hex | null;
  solanaWalletName: string | null;
  solanaConnected: boolean;
  connectSolana: () => void;
  disconnectSolana: () => Promise<void>;

  // Active signer resolution
  activeEvmIdentity: Hex | null;

  // Resolved RomeID profile for active wallet
  myProfileId: bigint;
  myProfile: ProfileData | null;
  myLinkedWallets: LinkedWalletData[];
  myWorkRecords: WorkRecordData[];
  myAttestations: AttestationData[];
  myReputation: ReputationData | null;
  loadingProfile: boolean;
  refreshProfile: () => Promise<void>;

  // Unified dual-lane contract execution
  executeContractWrite: (params: {
    to: Hex;
    data: Hex;
    forceLane?: ActiveLane;
    onStatus?: (msg: string) => void;
  }) => Promise<TxOutcome>;

  // Browser-side contract override (for 1-click MetaMask deploy or Remix address paste)
  saveRuntimeContracts: (contracts: {
    identityRegistry: Hex;
    workRegistry: Hex;
    attestationRegistry: Hex;
  }) => void;
}

const RomeAppContext = createContext<RomeContextValue | null>(null);

function RomeInnerProvider({
  config: serverConfig,
  children,
}: {
  config: ChainRuntimeConfig;
  children: React.ReactNode;
}) {
  const [runtimeContracts, setRuntimeContracts] = useState<{
    identityRegistry: Hex | null;
    workRegistry: Hex | null;
    attestationRegistry: Hex | null;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`romeid_contracts_${serverConfig.chainId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          identityRegistry?: Hex;
          workRegistry?: Hex;
          attestationRegistry?: Hex;
        };
        if (parsed.identityRegistry && parsed.workRegistry && parsed.attestationRegistry) {
          setRuntimeContracts({
            identityRegistry: parsed.identityRegistry,
            workRegistry: parsed.workRegistry,
            attestationRegistry: parsed.attestationRegistry,
          });
        }
      }
    } catch {
      // Ignore storage read errors
    }
  }, [serverConfig.chainId]);

  const config = useMemo<ChainRuntimeConfig>(() => {
    if (!runtimeContracts) return serverConfig;
    return {
      ...serverConfig,
      contracts: {
        identityRegistry: serverConfig.contracts.identityRegistry ?? runtimeContracts.identityRegistry,
        workRegistry: serverConfig.contracts.workRegistry ?? runtimeContracts.workRegistry,
        attestationRegistry:
          serverConfig.contracts.attestationRegistry ?? runtimeContracts.attestationRegistry,
      },
    };
  }, [serverConfig, runtimeContracts]);

  const saveRuntimeContracts = useCallback(
    (next: { identityRegistry: Hex; workRegistry: Hex; attestationRegistry: Hex }) => {
      setRuntimeContracts(next);
      try {
        window.localStorage.setItem(`romeid_contracts_${serverConfig.chainId}`, JSON.stringify(next));
      } catch {
        // Ignore storage write errors
      }
    },
    [serverConfig.chainId]
  );

  const { address, isConnected: evmConnected, connector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const {
    publicKey: solPublicKey,
    connected: solanaConnected,
    wallet: solWallet,
    disconnect: solDisconnect,
    signTransaction,
  } = useWallet();
  const { setVisible: setSolanaModalVisible } = useWalletModal();

  const [activeLane, setActiveLane] = useState<ActiveLane>("evm");

  const evmAddress = (address as Hex | undefined) ?? null;

  const solanaPubkeyBase58 = useMemo(
    () => (solPublicKey ? solPublicKey.toBase58() : null),
    [solPublicKey]
  );
  const solanaPubkeyBytes32 = useMemo(
    () => (solPublicKey ? (pubkeyToBytes32(solPublicKey) as Hex) : null),
    [solPublicKey]
  );
  const solanaSyntheticAddress = useMemo(
    () => (solPublicKey ? (syntheticAddress(solPublicKey) as Hex) : null),
    [solPublicKey]
  );

  // Automatically pick connected lane when only one wallet is connected
  useEffect(() => {
    if (evmConnected && !solanaConnected) {
      setActiveLane("evm");
    } else if (solanaConnected && !evmConnected) {
      setActiveLane("solana");
    }
  }, [evmConnected, solanaConnected]);

  const activeEvmIdentity: Hex | null = useMemo(() => {
    if (activeLane === "evm" && evmAddress) return evmAddress;
    if (activeLane === "solana" && solanaSyntheticAddress) return solanaSyntheticAddress;
    return evmAddress ?? solanaSyntheticAddress ?? null;
  }, [activeLane, evmAddress, solanaSyntheticAddress]);

  const [myProfileId, setMyProfileId] = useState<bigint>(0n);
  const [myProfile, setMyProfile] = useState<ProfileData | null>(null);
  const [myLinkedWallets, setMyLinkedWallets] = useState<LinkedWalletData[]>([]);
  const [myWorkRecords, setMyWorkRecords] = useState<WorkRecordData[]>([]);
  const [myAttestations, setMyAttestations] = useState<AttestationData[]>([]);
  const [myReputation, setMyReputation] = useState<ReputationData | null>(null);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(false);

  const refreshProfile = useCallback(async () => {
    const idAddr = config.contracts.identityRegistry;
    const workAddr = config.contracts.workRegistry;
    const attAddr = config.contracts.attestationRegistry;

    if (!idAddr || !activeEvmIdentity) {
      setMyProfileId(0n);
      setMyProfile(null);
      setMyLinkedWallets([]);
      setMyWorkRecords([]);
      setMyAttestations([]);
      setMyReputation(null);
      return;
    }

    setLoadingProfile(true);
    try {
      const pub = makePublicClient(config);
      let resolvedId = (await pub.readContract({
        address: idAddr,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "resolveProfile",
        args: [activeEvmIdentity],
      })) as bigint;

      // Fallback: if both wallets are connected and the active lane has a pending link on the other wallet's profile, keep active wallet's own resolved profile (0n if not yet confirmed)
      if (resolvedId === 0n && evmAddress && activeEvmIdentity !== evmAddress) {
        // Keep 0n so Link Wizard knows this wallet hasn't confirmed yet, unless user switches lane
      }

      setMyProfileId(resolvedId);

      if (resolvedId === 0n) {
        setMyProfile(null);
        setMyLinkedWallets([]);
        setMyWorkRecords([]);
        setMyAttestations([]);
        setMyReputation(null);
        return;
      }

      const [profile, linked, records, attestations, rep] = await Promise.all([
        pub.readContract({
          address: idAddr,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "getProfile",
          args: [resolvedId],
        }) as Promise<ProfileData>,
        pub.readContract({
          address: idAddr,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "getLinkedWallets",
          args: [resolvedId],
        }) as Promise<LinkedWalletData[]>,
        workAddr
          ? (pub.readContract({
              address: workAddr,
              abi: WORK_REGISTRY_ABI,
              functionName: "getProfileWorkRecords",
              args: [resolvedId],
            }) as Promise<WorkRecordData[]>)
          : Promise.resolve([]),
        attAddr
          ? (pub.readContract({
              address: attAddr,
              abi: ATTESTATION_REGISTRY_ABI,
              functionName: "getProfileAttestations",
              args: [resolvedId],
            }) as Promise<AttestationData[]>)
          : Promise.resolve([]),
        attAddr
          ? (pub.readContract({
              address: attAddr,
              abi: ATTESTATION_REGISTRY_ABI,
              functionName: "getReputation",
              args: [resolvedId],
            }) as Promise<ReputationData>)
          : Promise.resolve(null),
      ]);

      setMyProfile(profile);
      setMyLinkedWallets(linked);
      setMyWorkRecords(records);
      setMyAttestations(attestations);
      setMyReputation(rep);
    } catch (err) {
      console.error("Failed to load RomeID profile:", err);
    } finally {
      setLoadingProfile(false);
    }
  }, [config, activeEvmIdentity, evmAddress]);

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const connectMetaMask = useCallback(async () => {
    const target = connectors[0];
    if (!target) {
      throw new Error("No EVM wallet extension detected. Please install MetaMask.");
    }
    await connectAsync({ connector: target });
    setActiveLane("evm");
  }, [connectAsync, connectors]);

  const disconnectMetaMask = useCallback(() => {
    disconnect();
  }, [disconnect]);

  const connectSolana = useCallback(() => {
    setSolanaModalVisible(true);
    setActiveLane("solana");
  }, [setSolanaModalVisible]);

  const disconnectSolana = useCallback(async () => {
    await solDisconnect();
  }, [solDisconnect]);

  const executeContractWrite = useCallback(
    async ({
      to,
      data,
      forceLane,
      onStatus,
    }: {
      to: Hex;
      data: Hex;
      forceLane?: ActiveLane;
      onStatus?: (msg: string) => void;
    }): Promise<TxOutcome> => {
      const lane = forceLane ?? activeLane;

      if (lane === "evm") {
        if (!evmAddress) {
          throw new Error("Please connect MetaMask first to sign on the EVM lane.");
        }
        const provider = connector
          ? ((await connector.getProvider()) as Eip1193Provider)
          : ((window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null);
        if (!provider) {
          throw new Error("MetaMask EIP-1193 provider unavailable.");
        }
        const outcome = await sendEvmLaneTx({
          provider,
          from: evmAddress,
          to,
          data,
          cfg: config,
          onStatus,
        });
        await refreshProfile();
        return outcome;
      }

      if (!solPublicKey) {
        throw new Error("Please connect a Solana wallet (Solflare / Phantom / Backpack) first.");
      }

      const outcome = await sendSolanaLaneTx({
        pubkey: solPublicKey,
        walletName: solWallet?.adapter?.name,
        signTransaction: signTransaction ?? undefined,
        to,
        data,
        cfg: config,
        onStatus,
      });
      await refreshProfile();
      return outcome;
    },
    [activeLane, evmAddress, connector, config, refreshProfile, solPublicKey, solWallet, signTransaction]
  );

  const value: RomeContextValue = {
    config,
    activeLane,
    setActiveLane,
    evmAddress,
    evmConnected,
    connectMetaMask,
    disconnectMetaMask,
    solanaPubkeyBase58,
    solanaPubkeyBytes32,
    solanaSyntheticAddress,
    solanaWalletName: solWallet?.adapter?.name ?? null,
    solanaConnected,
    connectSolana,
    disconnectSolana,
    activeEvmIdentity,
    myProfileId,
    myProfile,
    myLinkedWallets,
    myWorkRecords,
    myAttestations,
    myReputation,
    loadingProfile,
    refreshProfile,
    executeContractWrite,
    saveRuntimeContracts,
  };

  return <RomeAppContext.Provider value={value}>{children}</RomeAppContext.Provider>;
}

export function RomeProviders({
  initialConfig,
  children,
}: {
  initialConfig: ChainRuntimeConfig;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());

  const wagmiConfig = useMemo(() => {
    const romeChain = defineChain({
      id: initialConfig.chainId,
      name: initialConfig.chainName,
      nativeCurrency: initialConfig.nativeCurrency,
      rpcUrls: {
        default: { http: [initialConfig.rpcUrl] },
      },
      blockExplorers: {
        default: { name: "Rome Explorer", url: initialConfig.explorerUrl },
      },
    });

    return createConfig({
      chains: [romeChain],
      connectors: [injected()],
      transports: {
        [romeChain.id]: http(initialConfig.rpcUrl),
      },
      ssr: true,
    });
  }, [initialConfig]);

  const solanaWallets = useMemo(
    () => [new SolflareWalletAdapter(), new PhantomWalletAdapter()],
    []
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider endpoint={initialConfig.solana.rpc}>
          <WalletProvider wallets={solanaWallets} autoConnect>
            <WalletModalProvider>
              <RomeInnerProvider config={initialConfig}>{children}</RomeInnerProvider>
            </WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useRomeApp() {
  const ctx = useContext(RomeAppContext);
  if (!ctx) throw new Error("useRomeApp must be used inside RomeProviders");
  return ctx;
}
