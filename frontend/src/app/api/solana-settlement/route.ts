import { NextRequest, NextResponse } from "next/server";
import { getServerChainConfig } from "@/lib/serverRegistry";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return NextResponse.json({ error: "Invalid transaction hash" }, { status: 400 });
  }

  try {
    const cfg = await getServerChainConfig();
    const rpcCall = async (method: string, params: unknown[]) => {
      const res = await fetch(cfg.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        cache: "no-store",
      });
      const json = (await res.json()) as { result?: unknown };
      return json.result;
    };

    const [receipt, solanaTxsRaw] = await Promise.all([
      rpcCall("eth_getTransactionReceipt", [hash]).catch(() => null),
      rpcCall("rome_solanaTxForEvmTx", [hash]).catch(() => []),
    ]);

    const solanaSettlement = Array.isArray(solanaTxsRaw) ? (solanaTxsRaw as string[]) : [];
    const clusterSuffix =
      cfg.solana.cluster && cfg.solana.cluster !== "mainnet" && cfg.solana.cluster !== "mainnet-beta"
        ? `?cluster=${cfg.solana.cluster}`
        : "";

    return NextResponse.json({
      chainId: cfg.chainId,
      hash,
      romeExplorerUrl: `${cfg.explorerUrl}tx/${hash}`,
      receipt,
      solanaSettlement,
      solanaExplorerUrls: solanaSettlement.map(
        (sig) => `${cfg.solana.explorerUrl}/tx/${sig}${clusterSuffix}`
      ),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Failed to query Solana settlement" },
      { status: 500 }
    );
  }
}
