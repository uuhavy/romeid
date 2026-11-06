"use client";

import React, { useState } from "react";
import Link from "next/link";
import { encodeFunctionData } from "viem";
import { Briefcase, PlusCircle, Ban, ExternalLink, Share2, Check } from "lucide-react";
import { useRomeApp } from "@/context/RomeAppContext";
import { WORK_REGISTRY_ABI, shortenHex } from "@/lib/contracts";
import { TxStatusBanner } from "@/components/TxStatusBanner";
import type { TxOutcome } from "@/lib/romeLane";

export default function WorkRecordsPage() {
  const {
    config,
    activeLane,
    myProfileId,
    myProfile,
    myWorkRecords,
    executeContractWrite,
  } = useRomeApp();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [evidenceURI, setEvidenceURI] = useState("");
  const [startDate, setStartDate] = useState("2026-06-01");
  const [endDate, setEndDate] = useState("");
  const [isOngoing, setIsOngoing] = useState(true);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txOutcome, setTxOutcome] = useState<TxOutcome | null>(null);
  const [copiedRecordId, setCopiedRecordId] = useState<string | null>(null);

  const workAddr = config.contracts.workRegistry;

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workAddr || myProfileId === 0n) return;

    setTxError(null);
    setTxOutcome(null);
    try {
      const startSec = BigInt(Math.floor(new Date(startDate).getTime() / 1000));
      const endSec =
        isOngoing || !endDate ? 0n : BigInt(Math.floor(new Date(endDate).getTime() / 1000));

      const data = encodeFunctionData({
        abi: WORK_REGISTRY_ABI,
        functionName: "addWorkRecord",
        args: [
          myProfileId,
          title.trim(),
          description.trim(),
          evidenceURI.trim(),
          startSec,
          endSec,
        ],
      });

      const outcome = await executeContractWrite({
        to: workAddr,
        data,
        onStatus: setStatusMsg,
      });
      setTxOutcome(outcome);
      setTitle("");
      setDescription("");
      setEvidenceURI("");
    } catch (err) {
      setTxError((err as Error).message || String(err));
    } finally {
      setStatusMsg(null);
    }
  };

  const handleRevoke = async (recordId: bigint) => {
    if (!workAddr) return;
    setTxError(null);
    setTxOutcome(null);
    try {
      const data = encodeFunctionData({
        abi: WORK_REGISTRY_ABI,
        functionName: "revokeWorkRecord",
        args: [recordId],
      });
      const outcome = await executeContractWrite({
        to: workAddr,
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

  if (!myProfile || myProfileId === 0n) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-[#111520] p-8 text-center space-y-4">
        <Briefcase className="mx-auto h-12 w-12 text-amber-400" />
        <h1 className="text-2xl font-bold text-white">RomeID Profile Required</h1>
        <p className="text-sm text-slate-400">
          Create your RomeID profile on Dashboard (or confirm your linked wallet) to add portfolio
          work records.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950"
        >
          Go to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Append-Only Work Portfolio</h1>
        <p className="mt-1 text-sm text-slate-400">
          Add verifiable deliverables for <strong>@{myProfile.handle}</strong> from either MetaMask
          or Phantom/Solflare. Share any record&apos;s attest link with an employer to earn
          reputation.
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

      <div className="grid gap-8 lg:grid-cols-5">
        {/* Add Record Form */}
        <form
          onSubmit={handleAddRecord}
          className="lg:col-span-2 rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-4 self-start"
        >
          <div className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">Add Work Entry</h2>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300">Role / Project Title</label>
            <input
              required
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Core Protocol Engineer — Rome DEX Router"
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300">Deliverables &amp; Impact</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you shipped, metrics, or audit scope..."
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300">
              Evidence URI (GitHub PR, Commit, Deployment, IPFS)
            </label>
            <input
              value={evidenceURI}
              onChange={(e) => setEvidenceURI(e.target.value)}
              placeholder="https://github.com/..."
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300">Start Date</label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300">End Date</label>
              <input
                type="date"
                disabled={isOngoing}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white disabled:opacity-40"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={isOngoing}
              onChange={(e) => setIsOngoing(e.target.checked)}
              className="rounded border-white/20 bg-black"
            />
            Ongoing / Present position
          </label>

          <button
            type="submit"
            disabled={Boolean(statusMsg)}
            className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
          >
            Publish On-Chain ({activeLane === "evm" ? "EVM Lane" : "Solana Lane"})
          </button>
        </form>

        {/* Records Timeline */}
        <div className="lg:col-span-3 space-y-4">
          <h2 className="text-lg font-bold text-white">
            Recorded Portfolio Entries ({myWorkRecords.length})
          </h2>

          {myWorkRecords.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#111520] p-8 text-center text-sm text-slate-400">
              No work records added yet. Add your first contribution on the left!
            </div>
          ) : (
            [...myWorkRecords].reverse().map((rec) => {
              const recKey = rec.id.toString();
              const shareUrl =
                typeof window !== "undefined"
                  ? `${window.location.origin}/attest?profileId=${myProfileId.toString()}&recordId=${recKey}`
                  : `/attest?profileId=${myProfileId.toString()}&recordId=${recKey}`;

              return (
                <div
                  key={recKey}
                  className={`rounded-2xl border p-5 space-y-3 ${
                    rec.revoked
                      ? "border-red-500/25 bg-red-500/5 opacity-75"
                      : "border-white/10 bg-[#111520]"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                          Record #{recKey}
                        </span>
                        {rec.revoked ? (
                          <span className="rounded-md bg-red-500/20 px-2 py-0.5 text-[11px] font-bold text-red-300">
                            REVOKED (APPEND-ONLY)
                          </span>
                        ) : (
                          <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1.5 text-base font-bold text-white">{rec.title}</h3>
                    </div>

                    <span className="text-xs text-slate-400">
                      {new Date(Number(rec.startDate) * 1000).toLocaleDateString()} —{" "}
                      {rec.endDate === 0n
                        ? "Present"
                        : new Date(Number(rec.endDate) * 1000).toLocaleDateString()}
                    </span>
                  </div>

                  {rec.description && (
                    <p className="text-sm text-slate-300 leading-relaxed">{rec.description}</p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-slate-400">
                        Signed by: <code className="text-slate-200">{shortenHex(rec.createdBy, 4)}</code>
                      </span>
                      {rec.evidenceURI && (
                        <a
                          href={rec.evidenceURI}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-amber-300 hover:underline"
                        >
                          Evidence <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>

                    {!rec.revoked && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(shareUrl);
                            setCopiedRecordId(recKey);
                            setTimeout(() => setCopiedRecordId(null), 2000);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 font-semibold text-amber-300 hover:bg-amber-500/20"
                        >
                          {copiedRecordId === recKey ? (
                            <>
                              <Check className="h-3.5 w-3.5" /> Copied Link
                            </>
                          ) : (
                            <>
                              <Share2 className="h-3.5 w-3.5" /> Employer Attest Link
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleRevoke(rec.id)}
                          disabled={Boolean(statusMsg)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 font-semibold text-red-300 hover:bg-red-500/20"
                        >
                          <Ban className="h-3.5 w-3.5" /> Revoke
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
