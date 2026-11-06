"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { encodeFunctionData } from "viem";
import { Award, Star, Search, ExternalLink, RotateCcw } from "lucide-react";
import { useRomeApp } from "@/context/RomeAppContext";
import {
  ATTESTATION_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
  WORK_REGISTRY_ABI,
  decodeCommentURI,
  encodeCommentURI,
  shortenHex,
  type AttestationData,
  type ProfileData,
  type WorkRecordData,
} from "@/lib/contracts";
import { makePublicClient, type TxOutcome } from "@/lib/romeLane";
import { TxStatusBanner } from "@/components/TxStatusBanner";

function AttestContent() {
  const searchParams = useSearchParams();
  const {
    config,
    activeLane,
    activeEvmIdentity,
    evmConnected,
    solanaConnected,
    connectMetaMask,
    connectSolana,
    executeContractWrite,
  } = useRomeApp();

  const [lookupInput, setLookupInput] = useState(
    searchParams.get("handle") || searchParams.get("profileId") || ""
  );
  const [selectedRecordId, setSelectedRecordId] = useState(searchParams.get("recordId") || "");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const [targetProfile, setTargetProfile] = useState<ProfileData | null>(null);
  const [records, setRecords] = useState<WorkRecordData[]>([]);
  const [attestations, setAttestations] = useState<AttestationData[]>([]);
  const [loadingTarget, setLoadingTarget] = useState(false);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txOutcome, setTxOutcome] = useState<TxOutcome | null>(null);

  const idAddr = config.contracts.identityRegistry;
  const workAddr = config.contracts.workRegistry;
  const attAddr = config.contracts.attestationRegistry;

  const loadTarget = useCallback(
    async (query: string) => {
      if (!idAddr || !workAddr || !attAddr || !query.trim()) return;
      setLoadingTarget(true);
      setTxError(null);
      try {
        const pub = makePublicClient(config);
        const cleaned = query.trim().replace(/^@/, "");
        let profile: ProfileData;

        if (/^\d+$/.test(cleaned)) {
          profile = (await pub.readContract({
            address: idAddr,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "getProfile",
            args: [BigInt(cleaned)],
          })) as ProfileData;
        } else {
          profile = (await pub.readContract({
            address: idAddr,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: "getProfileByHandle",
            args: [cleaned],
          })) as ProfileData;
        }

        const [recs, atts] = await Promise.all([
          pub.readContract({
            address: workAddr,
            abi: WORK_REGISTRY_ABI,
            functionName: "getProfileWorkRecords",
            args: [profile.id],
          }) as Promise<WorkRecordData[]>,
          pub.readContract({
            address: attAddr,
            abi: ATTESTATION_REGISTRY_ABI,
            functionName: "getProfileAttestations",
            args: [profile.id],
          }) as Promise<AttestationData[]>,
        ]);

        setTargetProfile(profile);
        setRecords(recs);
        setAttestations(atts);

        const activeRecs = recs.filter((r) => !r.revoked);
        if (!selectedRecordId && activeRecs.length > 0) {
          setSelectedRecordId(activeRecs[0].id.toString());
        }
      } catch (err) {
        setTargetProfile(null);
        setRecords([]);
        setAttestations([]);
        setTxError(`Could not find profile "${query}": ${(err as Error).message}`);
      } finally {
        setLoadingTarget(false);
      }
    },
    [idAddr, workAddr, attAddr, config, selectedRecordId]
  );

  useEffect(() => {
    const initial = searchParams.get("profileId") || searchParams.get("handle");
    if (initial) {
      loadTarget(initial);
    }
  }, [searchParams, loadTarget]);

  const handleSubmitAttestation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attAddr || !targetProfile || !selectedRecordId) return;
    setTxError(null);
    setTxOutcome(null);
    try {
      const data = encodeFunctionData({
        abi: ATTESTATION_REGISTRY_ABI,
        functionName: "attest",
        args: [
          targetProfile.id,
          BigInt(selectedRecordId),
          rating,
          encodeCommentURI(comment || `Verified ${rating}/5 work delivery.`),
        ],
      });
      const outcome = await executeContractWrite({
        to: attAddr,
        data,
        onStatus: setStatusMsg,
      });
      setTxOutcome(outcome);
      setComment("");
      await loadTarget(targetProfile.id.toString());
    } catch (err) {
      setTxError((err as Error).message || String(err));
    } finally {
      setStatusMsg(null);
    }
  };

  const handleRevokeAttestation = async (attestationId: bigint) => {
    if (!attAddr || !targetProfile) return;
    setTxError(null);
    setTxOutcome(null);
    try {
      const data = encodeFunctionData({
        abi: ATTESTATION_REGISTRY_ABI,
        functionName: "revokeAttestation",
        args: [attestationId],
      });
      const outcome = await executeContractWrite({
        to: attAddr,
        data,
        onStatus: setStatusMsg,
      });
      setTxOutcome(outcome);
      await loadTarget(targetProfile.id.toString());
    } catch (err) {
      setTxError((err as Error).message || String(err));
    } finally {
      setStatusMsg(null);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Employer Work Attestation Portal</h1>
        <p className="mt-1 text-sm text-slate-400">
          Connect any MetaMask or Phantom/Solflare wallet to verify a contributor&apos;s work
          record on-chain and boost their portable RomeID reputation.
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

      {/* Search Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadTarget(lookupInput);
        }}
        className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#111520] p-5 sm:flex-row"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <input
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder="Enter handle (e.g. caesar_dev) or numeric Profile ID (e.g. 1)..."
            className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-4 text-sm text-white focus:border-amber-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loadingTarget}
          className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
        >
          {loadingTarget ? "Loading..." : "Load Candidate"}
        </button>
      </form>

      {targetProfile && (
        <div className="grid gap-8 lg:grid-cols-5">
          {/* Attestation Form */}
          <form
            onSubmit={handleSubmitAttestation}
            className="lg:col-span-3 rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-5 self-start"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-amber-300">
                  Candidate Profile #{targetProfile.id.toString()}
                </span>
                <h2 className="text-xl font-bold text-white">
                  Attest to{" "}
                  <Link href={`/p/${targetProfile.handle}`} className="text-amber-400 hover:underline">
                    @{targetProfile.handle}
                  </Link>
                </h2>
              </div>
              <Award className="h-6 w-6 text-amber-400" />
            </div>

            {!evmConnected && !solanaConnected && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <span>Connect your employer wallet first:</span>
                <button
                  type="button"
                  onClick={() => connectMetaMask().catch((e) => alert(e.message))}
                  className="rounded-lg bg-amber-500 px-2.5 py-1 font-bold text-slate-950"
                >
                  MetaMask
                </button>
                <button
                  type="button"
                  onClick={connectSolana}
                  className="rounded-lg bg-purple-500 px-2.5 py-1 font-bold text-white"
                >
                  Phantom / Solflare
                </button>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Select Active Work Record
              </label>
              <select
                required
                value={selectedRecordId}
                onChange={(e) => setSelectedRecordId(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/50 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              >
                <option value="">-- Choose a Work Record --</option>
                {records
                  .filter((r) => !r.revoked)
                  .map((r) => (
                    <option key={r.id.toString()} value={r.id.toString()}>
                      #{r.id.toString()} — {r.title}
                    </option>
                  ))}
              </select>
            </div>

            {selectedRecordId &&
              (() => {
                const rec = records.find((r) => r.id.toString() === selectedRecordId);
                if (!rec) return null;
                return (
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3.5 text-xs space-y-1.5">
                    <p className="font-semibold text-white">{rec.title}</p>
                    <p className="text-slate-400">{rec.description}</p>
                    {rec.evidenceURI && (
                      <a
                        href={rec.evidenceURI}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-amber-300 hover:underline"
                      >
                        Inspect Deliverable Evidence <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                );
              })()}

            <div>
              <label className="block text-xs font-semibold text-slate-300">Rating (1 – 5 Stars)</label>
              <div className="mt-2 flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className={`flex items-center gap-1 rounded-xl border px-3.5 py-2 text-sm font-bold transition ${
                      rating >= n
                        ? "border-amber-500 bg-amber-500/20 text-amber-300"
                        : "border-white/10 bg-black/30 text-slate-500"
                    }`}
                  >
                    <Star className={`h-4 w-4 ${rating >= n ? "fill-amber-400 text-amber-400" : ""}`} />
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Employer Review / Comment (or IPFS/HTTPS URI)
              </label>
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Delivered audited cross-VM contracts ahead of schedule..."
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={(!evmConnected && !solanaConnected) || !selectedRecordId || Boolean(statusMsg)}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 text-sm font-bold text-slate-950 hover:opacity-95 disabled:opacity-50"
            >
              Sign On-Chain Attestation ({activeLane === "evm" ? "EVM Lane" : "Solana Lane"})
            </button>
          </form>

          {/* Existing Attestations List */}
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-lg font-bold text-white">
              Attestations on @{targetProfile.handle} ({attestations.length})
            </h3>
            {attestations.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#111520] p-6 text-xs text-slate-400">
                No attestations yet — be the first employer to attest!
              </div>
            ) : (
              [...attestations].reverse().map((att) => {
                const isMine =
                  activeEvmIdentity &&
                  activeEvmIdentity.toLowerCase() === att.attester.toLowerCase();

                return (
                  <div
                    key={att.id.toString()}
                    className={`rounded-2xl border p-4 space-y-2 text-xs ${
                      att.revoked
                        ? "border-red-500/20 bg-red-500/5 opacity-70"
                        : "border-white/10 bg-[#111520]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-amber-300">
                        {"★".repeat(Number(att.rating))}
                        {"☆".repeat(5 - Number(att.rating))} ({att.rating}/5)
                      </span>
                      <span className="text-slate-400">Record #{att.workRecordId.toString()}</span>
                    </div>
                    <p className="text-slate-200">{decodeCommentURI(att.commentURI)}</p>
                    <div className="flex items-center justify-between border-t border-white/10 pt-2 text-[11px] text-slate-400">
                      <span>Attester: {shortenHex(att.attester, 5)}</span>
                      {att.revoked ? (
                        <span className="font-bold text-red-300">REVOKED</span>
                      ) : (
                        isMine && (
                          <button
                            onClick={() => handleRevokeAttestation(att.id)}
                            className="inline-flex items-center gap-1 text-red-300 hover:underline"
                          >
                            <RotateCcw className="h-3 w-3" /> Revoke Mine
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AttestPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-2xl border border-white/10 bg-[#111520] p-8 text-center text-sm text-slate-400">
          Loading Attestation Portal...
        </div>
      }
    >
      <AttestContent />
    </Suspense>
  );
}
