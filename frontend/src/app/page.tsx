"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  Wallet,
  Link2,
  Briefcase,
  Award,
  ArrowRight,
  Search,
  ExternalLink,
  Cpu,
} from "lucide-react";
import { useRomeApp } from "@/context/RomeAppContext";
import { shortenHex } from "@/lib/contracts";

export default function LandingPage() {
  const router = useRouter();
  const {
    config,
    evmAddress,
    evmConnected,
    connectMetaMask,
    solanaPubkeyBase58,
    solanaSyntheticAddress,
    solanaConnected,
    connectSolana,
    myProfile,
  } = useRomeApp();

  const [lookupHandle, setLookupHandle] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = lookupHandle.trim().replace(/^@/, "").toLowerCase();
    if (cleaned) {
      router.push(`/p/${cleaned}`);
    }
  };

  return (
    <div className="space-y-12 pb-10">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#121726] via-[#0D111C] to-[#161124] p-8 sm:p-12 shadow-2xl">
        <div className="max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-xs font-medium text-amber-300">
            <Cpu className="h-3.5 w-3.5" />
            <span>Powered by Rome EVM Inside Solana · Atomic Shared State</span>
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl leading-tight">
            One On-Chain Identity.{" "}
            <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-purple-400 bg-clip-text text-transparent">
              MetaMask &amp; Phantom, Unified.
            </span>
          </h1>

          <p className="text-base text-slate-300 sm:text-lg leading-relaxed">
            <strong>RomeID</strong> links your Ethereum wallet and your Solana wallet to a single
            profile over Rome&apos;s shared state. Build an append-only work portfolio, collect
            cryptographically signed employer attestations from either wallet lane, and carry a
            portable reputation score across ecosystems.
          </p>

          {/* Dual-Lane Connect CTA */}
          <div className="grid gap-4 pt-2 sm:grid-cols-2">
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                  EVM Lane · submitRomeTx
                </span>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    evmConnected ? "bg-emerald-400" : "bg-slate-600"
                  }`}
                />
              </div>
              {evmConnected && evmAddress ? (
                <div className="mt-3 space-y-2">
                  <p className="font-mono text-sm text-white">{shortenHex(evmAddress, 8)}</p>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:underline"
                  >
                    Open Dashboard <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ) : (
                <button
                  onClick={() => connectMetaMask().catch((err) => alert(err.message))}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 transition"
                >
                  <Wallet className="h-4 w-4" />
                  Connect MetaMask
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-purple-500/30 bg-purple-500/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-purple-300">
                  Solana Lane · submitRomeTxV1
                </span>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    solanaConnected ? "bg-emerald-400" : "bg-slate-600"
                  }`}
                />
              </div>
              {solanaConnected && solanaPubkeyBase58 ? (
                <div className="mt-3 space-y-1">
                  <p className="font-mono text-sm text-white">
                    {solanaPubkeyBase58.slice(0, 8)}...{solanaPubkeyBase58.slice(-8)}
                  </p>
                  <p className="font-mono text-[11px] text-purple-300">
                    Synthetic EVM: {shortenHex(solanaSyntheticAddress || "", 6)}
                  </p>
                </div>
              ) : (
                <button
                  onClick={connectSolana}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-purple-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-purple-400 transition"
                >
                  <Wallet className="h-4 w-4" />
                  Connect Phantom / Solflare
                </button>
              )}
            </div>
          </div>

          {myProfile && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              <span>
                Signed in as <strong>@{myProfile.handle}</strong> (Profile #{myProfile.id.toString()})
              </span>
              <Link
                href="/dashboard"
                className="ml-auto rounded-lg bg-emerald-500 px-3 py-1 text-xs font-bold text-slate-950 hover:bg-emerald-400"
              >
                Go to Dashboard
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* Public Handle Lookup */}
      <section className="rounded-2xl border border-white/10 bg-[#111520] p-6">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={lookupHandle}
              onChange={(e) => setLookupHandle(e.target.value)}
              placeholder="Search any public RomeID handle (e.g. alice or rome_builder)..."
              className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-5 py-2.5 text-sm font-semibold text-amber-300 hover:bg-amber-500/25 transition"
          >
            View Public Profile <ArrowRight className="h-4 w-4" />
          </button>
        </form>
      </section>

      {/* Feature Pillars */}
      <section className="grid gap-6 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
            <Link2 className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-bold text-white">2-Step Trustless Wallet Linking</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Wallet A calls <code className="text-slate-200">requestLink</code>; Wallet B confirms
            from its own lane via <code className="text-slate-200">confirmLink</code>. Proves
            cryptographic custody of both keys with zero oracle or relayer trust.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/15 text-purple-400">
            <Briefcase className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-bold text-white">Append-Only Work Portfolio</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Record contributions, audits, grants, and engineering deliverables from either wallet.
            Entries are permanent on Solana L1 and can only be marked revoked, never erased.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <Award className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-bold text-white">Portable Reputation Score (0–1000)</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            Employers attest 1–5 stars from MetaMask or Phantom. On-chain O(1) scoring blends
            rating quality (70%), attestation volume (20%), and attester diversity (10%).
          </p>
        </div>
      </section>

      {/* Live Runtime Registry Facts */}
      <section className="rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-white">
              Live Chain Facts (via <code className="text-amber-300">@rome-protocol/registry</code>)
            </h2>
            <p className="text-xs text-slate-400">
              Resolved dynamically at runtime — zero hardcoded chain IDs, RPCs, or contract addresses.
            </p>
          </div>
          <a
            href={config.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 hover:underline"
          >
            Open Rome Explorer <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-white/5 bg-black/30 p-3">
            <span className="text-slate-400">Network / Gas Token</span>
            <p className="mt-1 font-mono font-semibold text-white">
              {config.chainName} ({config.chainId}) · {config.nativeCurrency.symbol}
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/30 p-3">
            <span className="text-slate-400">IdentityRegistry</span>
            <p className="mt-1 font-mono text-white truncate">
              {config.contracts.identityRegistry || "Pending Hadrian Deploy"}
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/30 p-3">
            <span className="text-slate-400">WorkRegistry / AttestationRegistry</span>
            <p className="mt-1 font-mono text-white truncate">
              {config.contracts.workRegistry
                ? `${shortenHex(config.contracts.workRegistry, 4)} · ${shortenHex(
                    config.contracts.attestationRegistry || "",
                    4
                  )}`
                : "Pending Hadrian Deploy"}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
