"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield, Link2, Briefcase, Award, LayoutDashboard, Wallet, LogOut, Sparkles } from "lucide-react";
import { useRomeApp } from "@/context/RomeAppContext";
import { shortenHex } from "@/lib/contracts";

export function Navbar() {
  const pathname = usePathname();
  const {
    config,
    activeLane,
    setActiveLane,
    evmAddress,
    evmConnected,
    connectMetaMask,
    disconnectMetaMask,
    solanaPubkeyBase58,
    solanaSyntheticAddress,
    solanaWalletName,
    solanaConnected,
    connectSolana,
    disconnectSolana,
    myProfile,
  } = useRomeApp();

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/link", label: "Link Wallet", icon: Link2 },
    { href: "/work", label: "Work Records", icon: Briefcase },
    { href: "/attest", label: "Attest", icon: Award },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#090B10]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 text-slate-950 shadow-lg shadow-amber-500/20">
              <Shield className="h-5 w-5 stroke-[2.4]" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-white">RomeID</span>
              <span className="ml-2 hidden rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 sm:inline-block">
                {config.chainName} ({config.chainId})
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
            {myProfile && (
              <Link
                href={`/p/${myProfile.handle}`}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/10 transition"
              >
                <Sparkles className="h-4 w-4" />@{myProfile.handle}
              </Link>
            )}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* EVM Lane Button */}
          {evmConnected && evmAddress ? (
            <div
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                activeLane === "evm"
                  ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
              }`}
              onClick={() => setActiveLane("evm")}
              title="Click to use EVM Lane (MetaMask) as active signer"
            >
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span>EVM: {shortenHex(evmAddress, 4)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  disconnectMetaMask();
                }}
                className="ml-1 text-slate-400 hover:text-red-400"
                title="Disconnect MetaMask"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => connectMetaMask().catch((err) => alert(err.message))}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition"
            >
              <Wallet className="h-3.5 w-3.5" />
              MetaMask
            </button>
          )}

          {/* Solana Lane Button */}
          {solanaConnected && solanaPubkeyBase58 ? (
            <div
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                activeLane === "solana"
                  ? "border-purple-500/60 bg-purple-500/15 text-purple-200"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
              }`}
              onClick={() => setActiveLane("solana")}
              title={`Solana Synthetic EVM Address: ${solanaSyntheticAddress}`}
            >
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              <span>
                {solanaWalletName || "Solana"}: {solanaPubkeyBase58.slice(0, 4)}...
                {solanaPubkeyBase58.slice(-4)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  disconnectSolana();
                }}
                className="ml-1 text-slate-400 hover:text-red-400"
                title="Disconnect Solana Wallet"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={connectSolana}
              className="flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition"
            >
              <Wallet className="h-3.5 w-3.5" />
              Phantom / Solflare
            </button>
          )}
        </div>
      </div>

      {/* Mobile navigation bar */}
      <div className="flex items-center justify-around border-t border-white/5 px-2 py-2 md:hidden">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ${
                active ? "bg-amber-500/15 text-amber-300" : "text-slate-400"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
