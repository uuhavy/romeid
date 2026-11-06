"use client";

import React, { useEffect, useState } from "react";
import { encodeFunctionData, isAddress, type Hex } from "viem";
import { Link2, ArrowRight, CheckCircle2, Clock, ShieldAlert, Wallet } from "lucide-react";
import { useRomeApp } from "@/context/RomeAppContext";
import {
  IDENTITY_REGISTRY_ABI,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  bytes32ToSolanaBase58,
  computeSyntheticAddressFromBytes32,
  shortenHex,
  solanaBase58ToBytes32,
  type LinkedWalletData,
  type ProfileData,
} from "@/lib/contracts";
import { makePublicClient, type TxOutcome } from "@/lib/romeLane";
import { TxStatusBanner } from "@/components/TxStatusBanner";

export default function LinkWalletWizardPage() {
  const {
    config,
    evmAddress,
    evmConnected,
    connectMetaMask,
    solanaPubkeyBase58,
    solanaPubkeyBytes32,
    solanaSyntheticAddress,
    solanaConnected,
    connectSolana,
    myProfileId,
    myProfile,
    myLinkedWallets,
    executeContractWrite,
    refreshProfile,
  } = useRomeApp();

  const [targetType, setTargetType] = useState<"solana" | "evm">("solana");
  const [solanaInput, setSolanaInput] = useState("");
  const [evmInput, setEvmInput] = useState("");
  const [confirmProfileIdInput, setConfirmProfileIdInput] = useState("");

  // Also detect if EITHER connected wallet owns a profile so the wizard always shows the full picture
  const [detectedProfile, setDetectedProfile] = useState<ProfileData | null>(null);
  const [detectedLinks, setDetectedLinks] = useState<LinkedWalletData[]>([]);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txOutcome, setTxOutcome] = useState<TxOutcome | null>(null);

  const idAddr = config.contracts.identityRegistry;

  // Auto-fill connected other-lane wallet for convenience
  useEffect(() => {
    if (solanaPubkeyBase58 && !solanaInput) {
      setSolanaInput(solanaPubkeyBase58);
    }
  }, [solanaPubkeyBase58, solanaInput]);

  useEffect(() => {
    if (evmAddress && !evmInput) {
      setEvmInput(evmAddress);
    }
  }, [evmAddress, evmInput]);

  useEffect(() => {
    async function detectAcrossBothConnectedWallets() {
      if (!idAddr) return;
      if (myProfile && myProfileId > 0n) {
        setDetectedProfile(myProfile);
        setDetectedLinks(myLinkedWallets);
        setConfirmProfileIdInput(myProfileId.toString());
        return;
      }
      const pub = makePublicClient(config);
      for (const candidate of [evmAddress, solanaSyntheticAddress]) {
        if (!candidate) continue;
        try {
          const pid = (await pub.readContract({
            address: idAddr,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "resolveProfile",
            args: [candidate],
          })) as bigint;
          if (pid > 0n) {
            const [p, links] = await Promise.all([
              pub.readContract({
                address: idAddr,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: "getProfile",
                args: [pid],
              }) as Promise<ProfileData>,
              pub.readContract({
                address: idAddr,
                abi: IDENTITY_REGISTRY_ABI,
                functionName: "getLinkedWallets",
                args: [pid],
              }) as Promise<LinkedWalletData[]>,
            ]);
            setDetectedProfile(p);
            setDetectedLinks(links);
            setConfirmProfileIdInput(pid.toString());
            return;
          }
        } catch {
          // ignore
        }
      }
    }
    detectAcrossBothConnectedWallets();
  }, [idAddr, config, myProfile, myProfileId, myLinkedWallets, evmAddress, solanaSyntheticAddress]);

  const handleStep1RequestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idAddr || !detectedProfile) {
      setTxError("Create a RomeID profile on Dashboard first before requesting a wallet link.");
      return;
    }
    setTxError(null);
    setTxOutcome(null);

    try {
      // Determine which connected wallet controls `detectedProfile`
      const ownerLower = detectedProfile.owner.toLowerCase();
      const evmControls =
        evmAddress &&
        (evmAddress.toLowerCase() === ownerLower ||
          detectedLinks.some(
            (w) => Number(w.status) === 2 && w.wallet.toLowerCase() === evmAddress.toLowerCase()
          ));

      const forceLane = evmControls ? "evm" : "solana";

      let otherWallet: Hex = ZERO_ADDRESS;
      let solBytes32: Hex = ZERO_BYTES32;

      if (targetType === "solana") {
        solBytes32 =
          solanaPubkeyBase58 && solanaInput.trim() === solanaPubkeyBase58 && solanaPubkeyBytes32
            ? solanaPubkeyBytes32
            : solanaBase58ToBytes32(solanaInput);
        otherWallet = computeSyntheticAddressFromBytes32(solBytes32);
      } else {
        if (!isAddress(evmInput.trim())) {
          throw new Error("Invalid EVM wallet address (expected 0x...).");
        }
        otherWallet = evmInput.trim() as Hex;
      }

      const data = encodeFunctionData({
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "requestLink",
        args: [detectedProfile.id, otherWallet, solBytes32],
      });

      const outcome = await executeContractWrite({
        to: idAddr,
        data,
        forceLane,
        onStatus: setStatusMsg,
      });
      setTxOutcome(outcome);
      await refreshProfile();
    } catch (err) {
      setTxError((err as Error).message || String(err));
    } finally {
      setStatusMsg(null);
    }
  };

  const handleStep2ConfirmLink = async (profileIdToConfirm: bigint, confirmFromLane: "evm" | "solana") => {
    if (!idAddr) return;
    setTxError(null);
    setTxOutcome(null);
    try {
      const data = encodeFunctionData({
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "confirmLink",
        args: [profileIdToConfirm],
      });
      const outcome = await executeContractWrite({
        to: idAddr,
        data,
        forceLane: confirmFromLane,
        onStatus: setStatusMsg,
      });
      setTxOutcome(outcome);
      await refreshProfile();
    } catch (err) {
      setTxError((err as Error).message || String(err));
    } finally {
      setStatusMsg(null);
    }
  };

  let previewSynthetic: string | null = null;
  if (targetType === "solana" && solanaInput.trim()) {
    try {
      const b32 = solanaBase58ToBytes32(solanaInput.trim());
      previewSynthetic = computeSyntheticAddressFromBytes32(b32);
    } catch {
      previewSynthetic = null;
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">2-Step Wallet Linking Wizard</h1>
        <p className="mt-1 text-sm text-slate-400">
          Cryptographically bind your MetaMask wallet and your Phantom / Solflare wallet to one
          shared RomeID profile — zero trusted relayers.
        </p>
      </div>

      <TxStatusBanner
        statusMessage={statusMsg}
        error={txError}
        outcome={txOutcome}
        onClear={() => {
          setTxError(null);
          setTxOutcome(null);
        }}
      />

      {/* Wallet Connection Bar */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-amber-500/30 bg-[#111520] p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-amber-300">EVM Lane (MetaMask)</p>
            <p className="mt-1 font-mono text-xs text-white">
              {evmConnected && evmAddress ? shortenHex(evmAddress, 8) : "Not connected"}
            </p>
          </div>
          {!evmConnected && (
            <button
              onClick={() => connectMetaMask().catch((e) => alert(e.message))}
              className="rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950"
            >
              Connect MetaMask
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-purple-500/30 bg-[#111520] p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-purple-300">Solana Lane (Phantom / Solflare)</p>
            <p className="mt-1 font-mono text-xs text-white">
              {solanaConnected && solanaPubkeyBase58
                ? `${solanaPubkeyBase58.slice(0, 8)}...${solanaPubkeyBase58.slice(-6)}`
                : "Not connected"}
            </p>
            {solanaSyntheticAddress && (
              <p className="font-mono text-[11px] text-slate-400">
                Synthetic: {shortenHex(solanaSyntheticAddress, 6)}
              </p>
            )}
          </div>
          {!solanaConnected && (
            <button
              onClick={connectSolana}
              className="rounded-xl bg-purple-500 px-3.5 py-2 text-xs font-bold text-white"
            >
              Connect Solana
            </button>
          )}
        </div>
      </div>

      {/* Note on Devnet Solana Wallets */}
      <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 px-4 py-3 text-xs text-purple-200">
        <strong>Rome Dual-Lane Tip:</strong> On Hadrian testnet, <strong>Solflare</strong> signs
        Rome&apos;s Solana v1 transactions (<code className="text-white">submitRomeTxV1</code>)
        natively, while <strong>Phantom</strong> automatically uses our{" "}
        <code className="text-white">DoTxUnsigned</code> legacy fallback — both derive the exact
        same synthetic address <code className="text-white">keccak256(pubkey)[12:]</code>! Ensure
        your Solana wallet holds ~0.02 devnet SOL for account rent/fees.
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* STEP 1 */}
        <form
          onSubmit={handleStep1RequestLink}
          className="rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-5"
        >
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300">
              STEP 1 · WALLET A SIGNS
            </span>
            {detectedProfile && (
              <span className="text-xs text-emerald-300 font-medium">
                Profile @{detectedProfile.handle} (#{detectedProfile.id.toString()})
              </span>
            )}
          </div>

          <h2 className="text-lg font-bold text-white">Request Link from Profile Controller</h2>
          <p className="text-xs text-slate-400">
            Sign <code className="text-slate-200">requestLink(profileId, targetWallet, solanaPubkey)</code>{" "}
            using the wallet that currently owns @{detectedProfile?.handle || "your-profile"}.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTargetType("solana")}
              className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition ${
                targetType === "solana"
                  ? "border-purple-500 bg-purple-500/20 text-purple-200"
                  : "border-white/10 bg-black/30 text-slate-400"
              }`}
            >
              Link a Solana Wallet
            </button>
            <button
              type="button"
              onClick={() => setTargetType("evm")}
              className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition ${
                targetType === "evm"
                  ? "border-amber-500 bg-amber-500/20 text-amber-200"
                  : "border-white/10 bg-black/30 text-slate-400"
              }`}
            >
              Link an EVM Wallet
            </button>
          </div>

          {targetType === "solana" ? (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300">
                Target Solana Public Key (base58)
              </label>
              <input
                required
                value={solanaInput}
                onChange={(e) => setSolanaInput(e.target.value)}
                placeholder="Paste Phantom / Solflare base58 address..."
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 font-mono text-xs text-white focus:border-purple-500 focus:outline-none"
              />
              {solanaPubkeyBase58 && solanaInput !== solanaPubkeyBase58 && (
                <button
                  type="button"
                  onClick={() => setSolanaInput(solanaPubkeyBase58)}
                  className="text-xs text-purple-300 hover:underline"
                >
                  Use connected Solana wallet ({solanaPubkeyBase58.slice(0, 6)}...)
                </button>
              )}
              {previewSynthetic && (
                <div className="rounded-lg border border-white/10 bg-black/30 p-2.5 text-[11px] text-slate-300">
                  Derived Rome Synthetic EVM Address:{" "}
                  <code className="text-purple-300 break-all">{previewSynthetic}</code>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300">
                Target EVM Wallet Address (0x...)
              </label>
              <input
                required
                value={evmInput}
                onChange={(e) => setEvmInput(e.target.value)}
                placeholder="0x..."
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={!detectedProfile || Boolean(statusMsg)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
          >
            Sign Step 1: requestLink <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        {/* STEP 2 */}
        <div className="rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-5">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-purple-500/15 px-3 py-1 text-xs font-bold text-purple-300">
              STEP 2 · WALLET B CONFIRMS
            </span>
            <Link2 className="h-4 w-4 text-purple-400" />
          </div>

          <h2 className="text-lg font-bold text-white">Confirm Link from Target Wallet&apos;s Lane</h2>
          <p className="text-xs text-slate-400">
            Wallet B must sign <code className="text-slate-200">confirmLink(profileId)</code> from
            its own lane so Rome&apos;s runtime verifies <code className="text-slate-200">msg.sender</code>{" "}
            matches the requested target wallet.
          </p>

          {/* Pending Requests List */}
          {detectedProfile && detectedLinks.length > 0 ? (
            <div className="space-y-3">
              {detectedLinks.map((link) => {
                const isPending = Number(link.status) === 1;
                const solB58 = bytes32ToSolanaBase58(link.solanaPubkey);
                const matchesConnectedSol =
                  solanaSyntheticAddress &&
                  solanaSyntheticAddress.toLowerCase() === link.wallet.toLowerCase();
                const matchesConnectedEvm =
                  evmAddress && evmAddress.toLowerCase() === link.wallet.toLowerCase();

                return (
                  <div
                    key={link.wallet}
                    className={`rounded-xl border p-4 space-y-2.5 ${
                      isPending
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-emerald-500/30 bg-emerald-500/5"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                        {isPending ? (
                          <>
                            <Clock className="h-3.5 w-3.5 text-amber-400" />
                            <span className="text-amber-300">Waiting for Wallet B Signature</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            <span className="text-emerald-300">Confirmed &amp; Active</span>
                          </>
                        )}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {solB58 ? "Solana Lane" : "EVM Lane"}
                      </span>
                    </div>

                    <p className="font-mono text-xs text-white break-all">{link.wallet}</p>
                    {solB58 && (
                      <p className="font-mono text-[11px] text-purple-300 break-all">
                        Solana: {solB58}
                      </p>
                    )}

                    {isPending && (
                      <div className="pt-1">
                        {solB58 ? (
                          matchesConnectedSol ? (
                            <button
                              onClick={() => handleStep2ConfirmLink(detectedProfile.id, "solana")}
                              disabled={Boolean(statusMsg)}
                              className="w-full rounded-xl bg-purple-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-400"
                            >
                              Sign Step 2 with Connected Solana Wallet (confirmLink)
                            </button>
                          ) : (
                            <button
                              onClick={connectSolana}
                              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-4 py-2 text-xs font-semibold text-purple-200"
                            >
                              <Wallet className="h-3.5 w-3.5" /> Connect Solana Wallet ({solB58.slice(0, 6)}...) to Confirm
                            </button>
                          )
                        ) : matchesConnectedEvm ? (
                          <button
                            onClick={() => handleStep2ConfirmLink(detectedProfile.id, "evm")}
                            disabled={Boolean(statusMsg)}
                            className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                          >
                            Sign Step 2 with Connected MetaMask (confirmLink)
                          </button>
                        ) : (
                          <p className="text-xs text-amber-300">
                            Switch MetaMask to {shortenHex(link.wallet, 6)} to confirm.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  Confirming from a separate browser session? Enter the Profile ID that requested
                  your wallet:
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={confirmProfileIdInput}
                  onChange={(e) => setConfirmProfileIdInput(e.target.value)}
                  placeholder="Profile ID (e.g. 1)"
                  className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white"
                />
                <button
                  type="button"
                  disabled={!confirmProfileIdInput || Boolean(statusMsg)}
                  onClick={() =>
                    handleStep2ConfirmLink(
                      BigInt(confirmProfileIdInput),
                      solanaConnected && !evmConnected ? "solana" : "evm"
                    )
                  }
                  className="rounded-xl bg-purple-500 px-4 py-2 text-xs font-bold text-white hover:bg-purple-400 disabled:opacity-50"
                >
                  Confirm Link
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
