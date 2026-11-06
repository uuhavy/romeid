import React from "react";
import Link from "next/link";
import { createPublicClient, http } from "viem";
import { ShieldCheck, Award, Star, Users, Briefcase, ExternalLink, Link2 } from "lucide-react";
import { getServerChainConfig } from "@/lib/serverRegistry";
import {
  ATTESTATION_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
  WORK_REGISTRY_ABI,
  bytes32ToSolanaBase58,
  decodeCommentURI,
  parseProfileMetadata,
  shortenHex,
  type AttestationData,
  type LinkedWalletData,
  type ProfileData,
  type ReputationData,
  type WorkRecordData,
} from "@/lib/contracts";

export const dynamic = "force-dynamic";

export default async function PublicProfilePage({
  params,
}: {
  params: { handle: string };
}) {
  const cfg = getServerChainConfig();
  const rawHandle = decodeURIComponent(params.handle || "").replace(/^@/, "").toLowerCase();

  const idAddr = cfg.contracts.identityRegistry;
  const workAddr = cfg.contracts.workRegistry;
  const attAddr = cfg.contracts.attestationRegistry;

  if (!idAddr) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-[#111520] p-8 text-center space-y-3">
        <h1 className="text-xl font-bold text-white">Contracts Pending Deployment</h1>
        <p className="text-sm text-slate-400">
          Deploy RomeID to {cfg.chainName} via <code>npm run deploy</code> to resolve live public
          profiles.
        </p>
      </div>
    );
  }

  const pub = createPublicClient({ transport: http(cfg.rpcUrl) });

  let profile: ProfileData | null = null;
  let linkedWallets: LinkedWalletData[] = [];
  let workRecords: WorkRecordData[] = [];
  let attestations: AttestationData[] = [];
  let reputation: ReputationData | null = null;

  try {
    profile = (await pub.readContract({
      address: idAddr,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "getProfileByHandle",
      args: [rawHandle],
    })) as ProfileData;

    const [links, recs, atts, rep] = await Promise.all([
      pub.readContract({
        address: idAddr,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "getLinkedWallets",
        args: [profile.id],
      }) as Promise<LinkedWalletData[]>,
      workAddr
        ? (pub.readContract({
            address: workAddr,
            abi: WORK_REGISTRY_ABI,
            functionName: "getProfileWorkRecords",
            args: [profile.id],
          }) as Promise<WorkRecordData[]>)
        : Promise.resolve([]),
      attAddr
        ? (pub.readContract({
            address: attAddr,
            abi: ATTESTATION_REGISTRY_ABI,
            functionName: "getProfileAttestations",
            args: [profile.id],
          }) as Promise<AttestationData[]>)
        : Promise.resolve([]),
      attAddr
        ? (pub.readContract({
            address: attAddr,
            abi: ATTESTATION_REGISTRY_ABI,
            functionName: "getReputation",
            args: [profile.id],
          }) as Promise<ReputationData>)
        : Promise.resolve(null),
    ]);

    linkedWallets = links.filter((w) => Number(w.status) === 2);
    workRecords = recs;
    attestations = atts;
    reputation = rep;
  } catch {
    profile = null;
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-[#111520] p-10 text-center space-y-4">
        <h1 className="text-2xl font-bold text-white">@{rawHandle} Not Found</h1>
        <p className="text-sm text-slate-400">
          This handle has not been registered yet on {cfg.chainName} ({cfg.chainId}).
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950"
        >
          Claim @{rawHandle} Now
        </Link>
      </div>
    );
  }

  const meta = parseProfileMetadata(profile.metadataURI, profile.handle);
  const ownerSol = bytes32ToSolanaBase58(profile.ownerSolanaPubkey);
  const score = Number(reputation?.score ?? 0n);
  const avgStars = (Number(reputation?.averageRatingHundredths ?? 0n) / 100).toFixed(2);

  return (
    <div className="space-y-8">
      {/* Header Hero */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-3xl border border-white/10 bg-[#111520] p-8 space-y-4">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            Verified RomeID · Profile #{profile.id.toString()}
          </div>

          <div>
            <h1 className="text-3xl font-extrabold text-white">
              {meta.displayName}{" "}
              <span className="text-lg font-medium text-amber-400">@{profile.handle}</span>
            </h1>
            <p className="mt-1 text-base text-slate-300">{meta.headline}</p>
          </div>

          {meta.bio && <p className="text-sm text-slate-400 leading-relaxed">{meta.bio}</p>}

          {meta.skills.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {meta.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Reputation Summary */}
        <div className="rounded-3xl border border-amber-500/30 bg-gradient-to-b from-amber-500/10 to-[#111520] p-7 flex flex-col justify-between space-y-5">
          <div>
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-amber-300">
              <span>On-Chain Reputation</span>
              <Award className="h-5 w-5 text-amber-400" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-5xl font-extrabold text-white">{score}</span>
              <span className="text-sm text-slate-400">/ 1000</span>
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400"
                style={{ width: `${Math.min(100, Math.round(score / 10))}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="flex items-center gap-1 text-amber-300">
                <Star className="h-3.5 w-3.5 fill-amber-400" /> Avg Rating
              </div>
              <p className="mt-1 text-base font-bold text-white">{avgStars} / 5.00</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="flex items-center gap-1 text-purple-300">
                <Users className="h-3.5 w-3.5" /> Diversity
              </div>
              <p className="mt-1 text-base font-bold text-white">
                {reputation?.distinctAttesters.toString() ?? "0"} attesters
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmed Linked Wallets */}
      <section className="rounded-2xl border border-white/10 bg-[#111520] p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-purple-400" />
          <h2 className="text-lg font-bold text-white">
            Cryptographically Verified Wallets ({1 + linkedWallets.length})
          </h2>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-1">
            <span className="text-[11px] font-bold text-emerald-300">
              PRIMARY · {ownerSol ? "SOLANA LANE" : "EVM LANE"}
            </span>
            <p className="font-mono text-xs text-white break-all">{profile.owner}</p>
            {ownerSol && (
              <p className="font-mono text-[11px] text-purple-300 break-all">Solana: {ownerSol}</p>
            )}
          </div>

          {linkedWallets.map((w) => {
            const sol = bytes32ToSolanaBase58(w.solanaPubkey);
            return (
              <div
                key={w.wallet}
                className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4 space-y-1"
              >
                <span className="text-[11px] font-bold text-purple-300">
                  CONFIRMED LINK · {sol ? "SOLANA LANE" : "EVM LANE"}
                </span>
                <p className="font-mono text-xs text-white break-all">{w.wallet}</p>
                {sol && (
                  <p className="font-mono text-[11px] text-purple-300 break-all">Solana: {sol}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Work Portfolio + Attestations */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">
              Work Records &amp; Employer Attestations ({workRecords.length})
            </h2>
          </div>
          <Link
            href={`/attest?profileId=${profile.id.toString()}`}
            className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
          >
            Attest as Employer
          </Link>
        </div>

        {workRecords.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#111520] p-6 text-sm text-slate-400">
            No work records published yet.
          </div>
        ) : (
          workRecords.map((rec) => {
            const recAtts = attestations.filter(
              (a) => a.workRecordId === rec.id && !a.revoked
            );
            return (
              <div
                key={rec.id.toString()}
                className={`rounded-2xl border p-6 space-y-4 ${
                  rec.revoked
                    ? "border-red-500/20 bg-red-500/5 opacity-70"
                    : "border-white/10 bg-[#111520]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">
                        Record #{rec.id.toString()}
                      </span>
                      {rec.revoked && (
                        <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300">
                          REVOKED
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 text-lg font-bold text-white">{rec.title}</h3>
                  </div>

                  {!rec.revoked && (
                    <Link
                      href={`/attest?profileId=${profile.id.toString()}&recordId=${rec.id.toString()}`}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
                    >
                      + Attest to Record #{rec.id.toString()}
                    </Link>
                  )}
                </div>

                {rec.description && (
                  <p className="text-sm text-slate-300 leading-relaxed">{rec.description}</p>
                )}

                {rec.evidenceURI && (
                  <a
                    href={rec.evidenceURI}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-amber-300 hover:underline"
                  >
                    Inspect Deliverable Evidence <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}

                {recAtts.length > 0 && (
                  <div className="space-y-2 border-t border-white/10 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Employer Attestations ({recAtts.length})
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {recAtts.map((a) => (
                        <div
                          key={a.id.toString()}
                          className="rounded-xl border border-white/10 bg-black/30 p-3.5 text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-amber-300">
                              {"★".repeat(Number(a.rating))}
                              {"☆".repeat(5 - Number(a.rating))} ({a.rating}/5)
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">
                              {shortenHex(a.attester, 5)}
                            </span>
                          </div>
                          <p className="text-slate-200">{decodeCommentURI(a.commentURI)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
