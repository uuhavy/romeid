import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { getChain } from "@rome-protocol/registry";

async function fetchSolanaSettlement(rpcUrl: string, evmTxHash: string): Promise<string[]> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "rome_solanaTxForEvmTx",
        params: [evmTxHash],
      }),
    });
    const json = (await res.json()) as { result?: unknown };
    return Array.isArray(json.result) ? (json.result as string[]) : [];
  } catch {
    return [];
  }
}

async function main() {
  const chainId = Number(process.env.CHAIN_ID ?? 200010);
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Chain ${chainId} not found in @rome-protocol/registry`);

  const rpcUrl = process.env.PROXY_URL || chain.rpcUrl;
  const explorerBase = (chain.explorerUrl || "").replace(/\/?$/, "/");
  const pub = createPublicClient({ transport: http(rpcUrl) });

  const deployFile = resolve(process.cwd(), "deployments", `${chainId}.json`);
  const deployed = existsSync(deployFile) ? JSON.parse(readFileSync(deployFile, "utf8")) : null;

  const identityAddr = (process.env.IDENTITY_REGISTRY_ADDRESS ||
    deployed?.contracts?.IdentityRegistry?.address) as Hex | undefined;
  const workAddr = (process.env.WORK_REGISTRY_ADDRESS ||
    deployed?.contracts?.WorkRegistry?.address) as Hex | undefined;
  const attestationAddr = (process.env.ATTESTATION_REGISTRY_ADDRESS ||
    deployed?.contracts?.AttestationRegistry?.address) as Hex | undefined;

  if (!identityAddr || !workAddr || !attestationAddr) {
    throw new Error(
      `Missing deployed contract addresses for chain ${chainId}. Run \`npm run deploy\` first.`
    );
  }

  console.log(`Verifying RomeID contracts on ${chain.name} (chainId ${chainId})...`);

  for (const [label, addr, txHash] of [
    ["IdentityRegistry", identityAddr, deployed?.contracts?.IdentityRegistry?.txHash],
    ["WorkRegistry", workAddr, deployed?.contracts?.WorkRegistry?.txHash],
    ["AttestationRegistry", attestationAddr, deployed?.contracts?.AttestationRegistry?.txHash],
  ] as const) {
    const code = await pub.getCode({ address: addr });
    const hasCode = Boolean(code && code !== "0x");
    console.log(`\n[${hasCode ? "OK" : "FAIL"}] ${label} @ ${addr}`);
    console.log(`  Explorer : ${explorerBase}address/${addr}`);
    if (!hasCode) {
      throw new Error(`No bytecode found at ${addr} on ${chain.name}`);
    }
    if (txHash) {
      const settlements = await fetchSolanaSettlement(rpcUrl, txHash);
      console.log(`  Deploy Tx: ${explorerBase}tx/${txHash}`);
      console.log(
        `  Solana Tx: ${settlements.length > 0 ? settlements.join(", ") : "(indexed asynchronously)"}`
      );
    }
  }

  // Verify live read calls across all 3 contracts + SystemProgram constant
  const identityAbi = parseAbi([
    "function totalProfiles() view returns (uint256)",
    "function ROME_SYSTEM_PROGRAM() view returns (address)",
  ]);
  const workAbi = parseAbi(["function totalWorkRecords() view returns (uint256)"]);
  const attAbi = parseAbi(["function totalAttestations() view returns (uint256)"]);

  const [profiles, sysPrecompile, records, attestations] = await Promise.all([
    pub.readContract({ address: identityAddr, abi: identityAbi, functionName: "totalProfiles" }),
    pub.readContract({ address: identityAddr, abi: identityAbi, functionName: "ROME_SYSTEM_PROGRAM" }),
    pub.readContract({ address: workAddr, abi: workAbi, functionName: "totalWorkRecords" }),
    pub.readContract({ address: attestationAddr, abi: attAbi, functionName: "totalAttestations" }),
  ]);

  console.log("\nLive On-Chain State Summary:");
  console.log(`  ROME_SYSTEM_PROGRAM : ${sysPrecompile}`);
  console.log(`  totalProfiles       : ${profiles.toString()}`);
  console.log(`  totalWorkRecords    : ${records.toString()}`);
  console.log(`  totalAttestations   : ${attestations.toString()}`);
  console.log("\nAll 3 RomeID contracts verified live on-chain!");
}

main().catch((err) => {
  console.error("Verify failed:", err.message || err);
  process.exit(1);
});
