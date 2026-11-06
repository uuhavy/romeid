"use client";

import React from "react";
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink } from "lucide-react";
import type { TxOutcome } from "@/lib/romeLane";
import { shortenHex } from "@/lib/contracts";

export function TxStatusBanner({
  statusMessage,
  error,
  outcome,
  onClear,
}: {
  statusMessage?: string | null;
  error?: string | null;
  outcome?: TxOutcome | null;
  onClear?: () => void;
}) {
  if (!statusMessage && !error && !outcome) return null;

  return (
    <div className="mb-6 space-y-3">
      {statusMessage && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <Loader2 className="h-5 w-5 animate-spin text-amber-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-300">Transaction Failed</p>
              <p className="mt-1 text-xs text-red-200/90 break-all">{error}</p>
            </div>
          </div>
          {onClear && (
            <button onClick={onClear} className="text-xs text-red-300 hover:underline shrink-0">
              Dismiss
            </button>
          )}
        </div>
      )}

      {outcome && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold text-emerald-300">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>
                Settled Atomically on Rome ({outcome.lane === "evm" ? "EVM Lane" : "Solana Lane"})
              </span>
            </div>
            {onClear && (
              <button onClick={onClear} className="text-xs text-emerald-300 hover:underline">
                Close
              </button>
            )}
          </div>

          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            {outcome.evmTxHash && outcome.romeExplorerUrl && (
              <a
                href={outcome.romeExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-amber-300 hover:border-amber-500/40 transition"
              >
                <span>Rome Explorer: {shortenHex(outcome.evmTxHash, 6)}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}

            {outcome.solanaSignatures.length > 0 ? (
              outcome.solanaSignatures.map((sig, idx) => (
                <a
                  key={sig}
                  href={outcome.solanaExplorerUrls[idx] || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-purple-300 hover:border-purple-500/40 transition"
                >
                  <span>
                    Solana L1 Settlement: {sig.slice(0, 8)}...{sig.slice(-6)}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ))
            ) : (
              <div className="flex items-center rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-slate-400">
                Solana settlement indexed via rome_solanaTxForEvmTx
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
