"use client";

import React, { useState } from "react";
import Link from "next/link";
import { encodeFunctionData } from "viem";
import {
  UserCheck,
  Sparkles,
  Link2,
  Briefcase,
  Award,
  Star,
  Users,
  Trash2,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { useRomeApp } from "@/context/RomeAppContext";
import {
  IDENTITY_REGISTRY_ABI,
  bytes32ToSolanaBase58,
  encodeProfileMetadata,
  parseProfileMetadata,
  shortenHex,
} from "@/lib/contracts";
import { TxStatusBanner } from "@/components/TxStatusBanner";
import type { TxOutcome } from "@/lib/romeLane";

export default function DashboardPage() {
  const {
    config,
    activeLane,
    activeEvmIdentity,
    evmConnected,
    solanaConnected,
    solanaPubkeyBase58,
    solanaPubkeyBytes32,
    connectMetaMask,
    connectSolana,
    myProfileId,
    myProfile,
    myLinkedWallets,
    myWorkRecords,
    myAttestations,
    myReputation,
    loadingProfile,
    executeContractWrite,
  } = useRomeApp();

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [skillsInput, setSkillsInput] = useState("Solidity, Solana CPI, TypeScript");

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txOutcome, setTxOutcome] = useState<TxOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  const idAddr = config.contracts.identityRegistry;

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idAddr) {
      setTxError("IdentityRegistry address is not configured yet. Run `npm run deploy` first.");
      return;
    }
    setTxError(null);
    setTxOutcome(null);

    try {
      const metadataURI = encodeProfileMetadata({
        displayName: displayName.trim() || handle.trim(),
        headline: headline.trim() || "Rome Protocol Builder",
        bio: bio.trim(),
        skills: skillsInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });

      const data =
        activeLane === "solana" && solanaPubkeyBytes32
          ? encodeFunctionData({
              abi: IDENTITY_REGISTRY_ABI,
              functionName: "createProfileWithSolanaKey",
              args: [handle.trim(), metadataURI, solanaPubkeyBytes32],
            })
          : encodeFunctionData({
              abi: IDENTITY_REGISTRY_ABI,
              functionName: "createProfile",
              args: [handle.trim(), metadataURI],
            });

      const outcome = await executeContractWrite({
        to: idAddr,
        data,
        onStatus: setStatusMsg,
      });
      setTxOutcome(outcome);
    } catch (err) {
      setTxError((err as Error).message || String(err));
    } finally {
      setStatusMsg(null);
    }
  };

  const handleUnlink = async (walletAddr: `0x${string}`) => {
    if (!idAddr || myProfileId === 0n) return;
    setTxError(null);
    setTxOutcome(null);
    try {
      const data = encodeFunctionData({
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "unlinkWallet",
        args: [myProfileId, walletAddr],
      });
      const outcome = await executeContractWrite({
        to: idAddr,
        data,
        onStatus: setStatusMsg,
      });
      setTxOutcome(outcome);
    } catch (err) {
      setTxError((err as Error).message || String(err));
    } finally {
      setStatusMsg(null);
    }
  };

  if (!evmConnected && !solanaConnected) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-[#111520] p-8 text-center space-y-5">
        <UserCheck className="mx-auto h-12 w-12 text-amber-400" />
        <h1 className="text-2xl font-bold text-white">Connect Either Wallet Lane</h1>
        <p className="text-sm text-slate-400">
          Connect MetaMask (EVM lane) or Phantom / Solflare (Solana lane) to view or create your
          unified RomeID profile.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={() => connectMetaMask().catch((e) => alert(e.message))}
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
          >
            Connect MetaMask
          </button>
          <button
            onClick={connectSolana}
            className="rounded-xl bg-purple-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-purple-400"
          >
            Connect Phantom / Solflare
          </button>
        </div>
      </div>
    );
  }

  const parsedMeta = myProfile ? parseProfileMetadata(myProfile.metadataURI, myProfile.handle) : null;
  const ownerSolB58 = myProfile ? bytes32ToSolanaBase58(myProfile.ownerSolanaPubkey) : null;
  const repScore = Number(myReputation?.score ?? 0n);
  const avgRating = (Number(myReputation?.averageRatingHundredths ?? 0n) / 100).toFixed(2);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">My RomeID Dashboard</h1>
          <p className="text-sm text-slate-400">
            Active Signer ({activeLane === "evm" ? "MetaMask EVM Lane" : "Solana Lane"}):{" "}
            <code className="text-amber-300">{activeEvmIdentity}</code>
            {activeLane === "solana" && solanaPubkeyBase58 && (
              <span className="ml-2 text-purple-300">({shortenHex(solanaPubkeyBase58, 5)})</span>
            )}
          </p>
        </div>

        {myProfile && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/p/${myProfile.handle}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied Share URL" : "Share Public Profile"}
            </button>
            <Link
              href={`/p/${myProfile.handle}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
            >
              Public Page <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
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

      {loadingProfile ? (
        <div className="rounded-2xl border border-white/10 bg-[#111520] p-8 text-center text-sm text-slate-400">
          Loading profile from Rome shared state...
        </div>
      ) : !myProfile ? (
        <div className="grid gap-8 lg:grid-cols-5">
          <form
            onSubmit={handleCreateProfile}
            className="lg:col-span-3 rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-400" />
              <h2 className="text-lg font-bold text-white">Create Your RomeID Profile</h2>
            </div>
            <p className="text-xs text-slate-400">
              Mint your unique handle on {config.chainName} from your currently active{" "}
              <strong>{activeLane === "evm" ? "MetaMask" : "Solana"}</strong> wallet, or link this
              wallet to an existing profile via the{" "}
              <Link href="/link" className="text-amber-300 underline">
                Link Wallet Wizard
              </Link>
              .
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Unique Handle (3–32 chars, a-z, 0-9, _, -)
              </label>
              <input
                required
                minLength={3}
                maxLength={32}
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="e.g. caesar_dev"
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-300">Display Name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Julius Caesar"
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300">Role / Headline</label>
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Cross-VM Smart Contract Engineer"
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">Bio</label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Building atomic EVM + Solana dApps on Rome Protocol..."
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Skills (comma-separated)
              </label>
              <input
                value={skillsInput}
                onChange={(e) => setSkillsInput(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={Boolean(statusMsg)}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 text-sm font-bold text-slate-950 hover:opacity-95 disabled:opacity-50 transition"
            >
              Create RomeID Profile ({activeLane === "evm" ? "EVM Lane" : "Solana Lane"})
            </button>
          </form>

          <div className="lg:col-span-2 rounded-2xl border border-purple-500/25 bg-purple-500/5 p-6 space-y-4">
            <h3 className="text-base font-bold text-white">Already Created a Profile on Your Other Wallet?</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              If you created a RomeID with MetaMask and just switched to Phantom/Solflare (or vice
              versa), head over to the <strong>Link Wallet Wizard</strong> to complete the 2-step
              confirmation so both wallets resolve to the exact same profile!
            </p>
            <Link
              href="/link"
              className="inline-flex items-center gap-2 rounded-xl bg-purple-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-400"
            >
              <Link2 className="h-4 w-4" /> Open 2-Step Link Wizard
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Profile Overview + Reputation Score */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                    Profile #{myProfile.id.toString()}
                  </span>
                  <h2 className="mt-2 text-2xl font-extrabold text-white">
                    {parsedMeta?.displayName}{" "}
                    <span className="text-base font-medium text-amber-400">@{myProfile.handle}</span>
                  </h2>
                  <p className="text-sm font-medium text-slate-300">{parsedMeta?.headline}</p>
                </div>

                <div className="flex gap-2">
                  <Link
                    href="/link"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3.5 py-2 text-xs font-semibold text-purple-200 hover:bg-purple-500/25"
                  >
                    <Link2 className="h-3.5 w-3.5" /> Link Wallet
                  </Link>
                  <Link
                    href="/work"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
                  >
                    <Briefcase className="h-3.5 w-3.5" /> Add Work
                  </Link>
                </div>
              </div>

              {parsedMeta?.bio && (
                <p className="text-sm text-slate-400 leading-relaxed">{parsedMeta.bio}</p>
              )}

              {parsedMeta && parsedMeta.skills.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {parsedMeta.skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-center">
                <div>
                  <p className="text-xl font-bold text-white">{1 + myLinkedWallets.filter((w) => Number(w.status) === 2).length}</p>
                  <p className="text-xs text-slate-400">Confirmed Wallets</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-white">
                    {myWorkRecords.filter((r) => !r.revoked).length}
                  </p>
                  <p className="text-xs text-slate-400">Active Work Records</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-white">
                    {myAttestations.filter((a) => !a.revoked).length}
                  </p>
                  <p className="text-xs text-slate-400">Employer Attestations</p>
                </div>
              </div>
            </div>

            {/* Portable Reputation Card */}
            <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/10 to-[#111520] p-6 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                    Portable Reputation Score
                  </span>
                  <Award className="h-5 w-5 text-amber-400" />
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold text-white">{repScore}</span>
                  <span className="text-sm text-slate-400">/ 1000</span>
                </div>
                <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-black/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all"
                    style={{ width: `${Math.min(100, Math.round(repScore / 10))}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center gap-1 text-amber-300">
                    <Star className="h-3.5 w-3.5 fill-amber-400" />
                    <span>Avg Rating</span>
                  </div>
                  <p className="mt-1 text-base font-bold text-white">{avgRating} / 5.00</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex items-center gap-1 text-purple-300">
                    <Users className="h-3.5 w-3.5" />
                    <span>Attesters</span>
                  </div>
                  <p className="mt-1 text-base font-bold text-white">
                    {myReputation?.distinctAttesters.toString() ?? "0"} unique
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Linked Wallets Section */}
          <div className="rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Unified Linked Wallets</h3>
                <p className="text-xs text-slate-400">
                  Every confirmed wallet below can sign transactions for @{myProfile.handle} over
                  one shared state.
                </p>
              </div>
              <Link
                href="/link"
                className="rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/15"
              >
                + Link Another Wallet
              </Link>
            </div>

            <div className="space-y-3">
              {/* Primary Owner */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                      PRIMARY OWNER
                    </span>
                    <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-slate-300">
                      {ownerSolB58 ? "Solana Synthetic" : "EVM Wallet"}
                    </span>
                  </div>
                  <p className="font-mono text-xs sm:text-sm text-white break-all">{myProfile.owner}</p>
                  {ownerSolB58 && (
                    <p className="font-mono text-xs text-purple-300 break-all">
                      Solana Pubkey: {ownerSolB58}
                    </p>
                  )}
                </div>
              </div>

              {/* Linked Wallets */}
              {myLinkedWallets.map((w) => {
                const solB58 = bytes32ToSolanaBase58(w.solanaPubkey);
                const confirmed = Number(w.status) === 2;
                return (
                  <div
                    key={w.wallet}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                            confirmed
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-amber-500/20 text-amber-300"
                          }`}
                        >
                          {confirmed ? "CONFIRMED" : "PENDING WALLET B CONFIRMATION"}
                        </span>
                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-slate-300">
                          {solB58 ? "Solana Lane" : "EVM Lane"}
                        </span>
                      </div>
                      <p className="font-mono text-xs sm:text-sm text-white break-all">{w.wallet}</p>
                      {solB58 && (
                        <p className="font-mono text-xs text-purple-300 break-all">
                          Solana Pubkey: {solB58}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {!confirmed && (
                        <Link
                          href="/link"
                          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                        >
                          Confirm in Wizard
                        </Link>
                      )}
                      <button
                        onClick={() => handleUnlink(w.wallet)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {confirmed ? "Unlink" : "Cancel"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
