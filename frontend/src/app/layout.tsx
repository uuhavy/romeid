import type { Metadata } from "next";
import "./globals.css";
import { getServerChainConfig } from "@/lib/serverRegistry";
import { RomeProviders } from "@/context/RomeAppContext";
import { Navbar } from "@/components/Navbar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RomeID — Unified Dual-Lane Identity & Reputation on Rome Protocol",
  description:
    "Link MetaMask and Phantom/Solflare to a single shared on-chain identity inside Solana's runtime, with verifiable work portfolios and portable employer reputation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialConfig = getServerChainConfig();

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#090B10] text-slate-100 antialiased selection:bg-amber-500/30">
        <RomeProviders initialConfig={initialConfig}>
          <div className="relative flex min-h-screen flex-col">
            <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_rgba(245,158,11,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(168,85,247,0.10),_transparent_55%)]" />
            <Navbar />
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
            <footer className="border-t border-white/10 bg-black/30 py-6 text-center text-xs text-slate-400">
              <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
                <span>
                  RomeID — Built on <strong>Rome Protocol</strong> ({initialConfig.chainName} · Chain ID{" "}
                  {initialConfig.chainId})
                </span>
                <span>
                  Rome EVM Program:{" "}
                  <code className="text-slate-300">{initialConfig.romeEvmProgramId}</code>
                </span>
              </div>
            </footer>
          </div>
        </RomeProviders>
      </body>
    </html>
  );
}
