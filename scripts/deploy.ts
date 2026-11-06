import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChain, getContracts, getTokens } from "@rome-protocol/registry";

interface ArtifactJson {
  abi: unknown[];
  bytecode: string;
}

function loadArtifact(contractName: string): ArtifactJson {
  const artifactPath = resolve(
    process.cwd(),
    "contracts",
    "artifacts",
    "src",
    `${contractName}.sol`,
    `${contractName}.json`
  );
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Missing compiled artifact at ${artifactPath}. Run \`npm run contracts:compile\` first.`
    );
  }
  return JSON.parse(readFileSync(artifactPath, "utf8")) as ArtifactJson;
}

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

function upsertEnvVar(envContent: string, key: string, value: string): string {
  const regex = new RegExp(`^#?\\s*${key}=.*$`, "m");
  if (regex.test(envContent)) {
    return envContent.replace(regex, `${key}=${value}`);
  }
  return `${envContent.replace(/\n*$/, "\n")}${key}=${value}\n`;
}

async function main() {
  const chainId = Number(process.env.CHAIN_ID ?? 200010);
  const chain = getChain(chainId);
  if (!chain) {
    throw new Error(`Chain ${chainId} not found in @rome-protocol/registry`);
  }

  const rpcUrl = process.env.PROXY_URL || chain.rpcUrl;
  const explorerBase = (chain.explorerUrl || "").replace(/\/?$/, "/");
  const solanaExplorerBase = (chain.solana?.explorerUrl || "https://explorer.solana.com").replace(/\/?$/, "");
  const clusterQuery =
    chain.solana?.cluster && chain.solana.cluster !== "mainnet-beta" && chain.solana.cluster !== "mainnet"
      ? `?cluster=${chain.solana.cluster}`
      : "";

  const rawKey = process.env.PRIVATE_KEY || process.env.ROME_EVM_KEY;
  if (!rawKey) {
    throw new Error(
      `Missing deployer key! Set PRIVATE_KEY (or ROME_EVM_KEY) in .env.\n` +
        `Reminder: Gas on ${chain.name} is ${chain.nativeCurrency.symbol}. Fund >= 0.5 ${chain.nativeCurrency.symbol} via:\n` +
        `  rome fund hadrian --from sepolia --amount 1`
    );
  }
  const normalizedKey = (rawKey.trim().startsWith("0x") ? rawKey.trim() : `0x${rawKey.trim()}`) as Hex;
  const account = privateKeyToAccount(normalizedKey);

  const pub = createPublicClient({ transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });

  const balanceWei = await pub.getBalance({ address: account.address });
  const gasPrice = await pub.getGasPrice();
  console.log("==============================================================");
  console.log(`Deploying RomeID to ${chain.name} (chainId ${chain.chainId})`);
  console.log(`RPC URL       : ${rpcUrl}`);
  console.log(`Rome Program  : ${chain.romeEvmProgramId}`);
  console.log(`Deployer      : ${account.address}`);
  console.log(`Gas Balance   : ${formatEther(balanceWei)} ${chain.nativeCurrency.symbol}`);
  console.log(`Registry Meta : ${Object.keys(getContracts(chainId) ?? {}).length} core contracts, ${(getTokens(chainId) ?? []).length} tokens`);
  console.log("==============================================================");

  if (balanceWei === 0n) {
    throw new Error(
      `Deployer ${account.address} has 0 ${chain.nativeCurrency.symbol} gas on ${chain.name}.\n` +
        `Fund >= 0.5 USDC first: rome fund hadrian --from sepolia --amount 1`
    );
  }

  async function deployOne(name: string, args: unknown[] = []) {
    console.log(`\n-> Deploying ${name}...`);
    const artifact = loadArtifact(name);
    const bytecode = (artifact.bytecode.startsWith("0x") ? artifact.bytecode : `0x${artifact.bytecode}`) as Hex;
    // High fixed gas ceiling: Rome charges EXACT gas used (`rome-cli/src/core/actions.ts` pattern)
    const hash = await wallet.deployContract({
      abi: artifact.abi as never,
      bytecode,
      args: args as never,
      chain: null,
      gas: 26_000_000n,
      maxFeePerGas: (gasPrice * 3n) / 2n,
      maxPriorityFeePerGas: 0n,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error(`${name} deploy failed (tx: ${hash}, status: ${receipt.status})`);
    }
    const solanaTxs = await fetchSolanaSettlement(rpcUrl, hash);
    console.log(`   Address          : ${receipt.contractAddress}`);
    console.log(`   EVM Tx           : ${explorerBase}tx/${hash}`);
    if (solanaTxs.length > 0) {
      for (const sig of solanaTxs) {
        console.log(`   Solana Settlement: ${solanaExplorerBase}/tx/${sig}${clusterQuery}`);
      }
    }
    return {
      address: receipt.contractAddress,
      txHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      solanaSettlement: solanaTxs,
    };
  }

  const identity = await deployOne("IdentityRegistry");
  const work = await deployOne("WorkRegistry", [identity.address]);
  const attestation = await deployOne("AttestationRegistry", [identity.address, work.address]);

  const record = {
    chainId: chain.chainId,
    chainName: chain.name,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    contracts: {
      IdentityRegistry: identity,
      WorkRegistry: work,
      AttestationRegistry: attestation,
    },
  };

  mkdirSync(resolve(process.cwd(), "deployments"), { recursive: true });
  const deployFile = resolve(process.cwd(), "deployments", `${chain.chainId}.json`);
  writeFileSync(deployFile, JSON.stringify(record, null, 2) + "\n");

  const frontendDeployDir = resolve(process.cwd(), "frontend", "src", "config");
  mkdirSync(frontendDeployDir, { recursive: true });
  const frontendDeployPath = resolve(frontendDeployDir, "deployments.json");
  let allDeployments: Record<string, unknown> = {};
  if (existsSync(frontendDeployPath)) {
    try {
      allDeployments = JSON.parse(readFileSync(frontendDeployPath, "utf8")) as Record<string, unknown>;
    } catch {
      allDeployments = {};
    }
  }
  allDeployments[String(chain.chainId)] = {
    chainId: chain.chainId,
    chainName: chain.name,
    deployedAt: record.deployedAt,
    IdentityRegistry: identity.address,
    WorkRegistry: work.address,
    AttestationRegistry: attestation.address,
    txHashes: {
      IdentityRegistry: identity.txHash,
      WorkRegistry: work.txHash,
      AttestationRegistry: attestation.txHash,
    },
  };
  writeFileSync(frontendDeployPath, JSON.stringify(allDeployments, null, 2) + "\n");

  // Update root .env if present
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    let envText = readFileSync(envPath, "utf8");
    envText = upsertEnvVar(envText, "IDENTITY_REGISTRY_ADDRESS", identity.address);
    envText = upsertEnvVar(envText, "WORK_REGISTRY_ADDRESS", work.address);
    envText = upsertEnvVar(envText, "ATTESTATION_REGISTRY_ADDRESS", attestation.address);
    writeFileSync(envPath, envText);
  }

  console.log("\n==============================================================");
  console.log("Deployment Complete!");
  console.log(`IdentityRegistry    : ${identity.address}`);
  console.log(`WorkRegistry        : ${work.address}`);
  console.log(`AttestationRegistry : ${attestation.address}`);
  console.log(`Saved deployment    : ${deployFile}`);
  console.log("==============================================================");
}

main().catch((err) => {
  console.error("Deploy error:", err.message || err);
  process.exit(1);
});
