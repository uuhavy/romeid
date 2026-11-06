import { NextResponse } from "next/server";
import { getServerChainConfig } from "@/lib/serverRegistry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getServerChainConfig();
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Failed to load Rome registry config" },
      { status: 500 }
    );
  }
}
