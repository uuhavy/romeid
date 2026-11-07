import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  parseAbi,
  parseEther,
  type Account,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getChain } from "@rome-protocol/registry";
import {
  pubkeyToBytes32,
  relayV1,
  submitRomeTx,
  submitRomeTxV1,
  syntheticAddress,
} from "@rome-protocol/sdk";

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

function makeNodeEip1193(account: Account, rpcUrl: string, chainId: number) {
  const pub = createPublicClient({ transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, transport: http(rpcUrl) });
  const big = (v: unknown) => (v === undefined || v === null ? undefined : BigInt(v as string));
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return [account.address];
        case "eth_chainId":
          return `0x${chainId.toString(16)}`;
        case "eth_sendTransaction": {
          const t = ((params ?? [])[0] ?? {}) as Record<string, unknown>;
          return wallet.sendTransaction({
            chain: null,
            to: t.to as Hex | undefined,
            data: t.data as Hex | undefined,
            value: big(t.value),
            gas: big(t.gas),
            maxFeePerGas: big(t.maxFeePerGas),
            maxPriorityFeePerGas: big(t.maxPriorityFeePerGas),
          });
        }
        default:
          return pub.request({ method: method as never, params: params as never });
      }
    },
  };
}

const IDENTITY_ABI = parseAbi([
  "function createProfile(string handle, string metadataURI) returns (uint256)",
  "function requestLink(uint256 profileId, address otherWalletIdentifier, bytes32 solanaPubkey)",
  "function confirmLink(uint256 profileId)",
  "function resolveProfile(address wallet) view returns (uint256)",
  "function getProfile(uint256 profileId) view returns ((uint256 id, address owner, bytes32 ownerSolanaPubkey, string handle, string metadataURI, uint64 createdAt, uint64 updatedAt))",
]);

const WORK_ABI = parseAbi([
  "function addWorkRecord(uint256 profileId, string title, string description, string evidenceURI, uint64 startDate, uint64 endDate) returns (uint256)",
  "function getProfileWorkRecords(uint256 profileId) view returns ((uint256 id, uint256 profileId, address createdBy, string title, string description, string evidenceURI, uint64 startDate, uint64 endDate, uint64 createdAt, bool revoked, uint64 revokedAt)[])",
]);

const ATTESTATION_ABI = parseAbi([
  "function attest(uint256 profileId, uint256 workRecordId, uint8 rating, string commentURI) returns (uint256)",
  "function getReputation(uint256 profileId) view returns ((uint256 score, uint256 averageRatingHundredths, uint256 activeAttestations, uint256 distinctAttesters))",
]);

async function main() {
  const chainId = Number(process.env.CHAIN_ID ?? 200010);
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Chain ${chainId} not found in @rome-protocol/registry`);

  const rpcUrl = process.env.PROXY_URL || chain.rpcUrl;
  const solanaRpc = process.env.SOLANA_RPC || chain.solana?.rpc || "https://api.devnet.solana.com";
  const explorerBase = (chain.explorerUrl || "").replace(/\/?$/, "/");
  const solanaExplorerBase = (chain.solana?.explorerUrl || "https://explorer.solana.com").replace(/\/?$/, "");
  const clusterQuery =
    chain.solana?.cluster && chain.solana.cluster !== "mainnet-beta" && chain.solana.cluster !== "mainnet"
      ? `?cluster=${chain.solana.cluster}`
      : "";

  const deployFile = resolve(process.cwd(), "deployments", `${chainId}.json`);
  const deployed = existsSync(deployFile) ? JSON.parse(readFileSync(deployFile, "utf8")) : null;

  const identityAddr = (process.env.IDENTITY_REGISTRY_ADDRESS ||
    deployed?.contracts?.IdentityRegistry?.address) as Hex;
  const workAddr = (process.env.WORK_REGISTRY_ADDRESS ||
    deployed?.contracts?.WorkRegistry?.address) as Hex;
  const attestationAddr = (process.env.ATTESTATION_REGISTRY_ADDRESS ||
    deployed?.contracts?.AttestationRegistry?.address) as Hex;

  if (!identityAddr || !workAddr || !attestationAddr) {
    throw new Error("Missing deployed contract addresses. Run `npm run deploy` first.");
  }

  const rawEvmKey = process.env.PRIVATE_KEY || process.env.ROME_EVM_KEY;
  if (!rawEvmKey) throw new Error("Set PRIVATE_KEY or ROME_EVM_KEY in .env");
  const evmAccount = privateKeyToAccount(
    (rawEvmKey.startsWith("0x") ? rawEvmKey : `0x${rawEvmKey}`) as Hex
  );
  const evmProvider = makeNodeEip1193(evmAccount, rpcUrl, chainId);
  const pub = createPublicClient({ transport: http(rpcUrl) });
  const gasPrice = await pub.getGasPrice();

  const e2eSummary: Record<string, unknown> = {};

  console.log(`Seeding E2E RomeID demo flow on ${chain.name} (${chainId})...`);
  console.log(`EVM Wallet Balance: ${formatEther(await pub.getBalance({ address: evmAccount.address }))} ${chain.nativeCurrency.symbol}`);

  // 1. Create or resolve EVM profile
  let profileId = (await pub.readContract({
    address: identityAddr,
    abi: IDENTITY_ABI,
    functionName: "resolveProfile",
    args: [evmAccount.address],
  })) as bigint;

  if (profileId === 0n) {
    const handle = "romeid_pioneer";
    const meta = '{"displayName":"Marcus Aurelius","role":"Cross-VM Builder","skills":["Solidity","Solana"]}';
    console.log(`\n1. Creating profile @${handle} from EVM lane (${evmAccount.address})...`);
    const tx1 = await submitRomeTx(evmProvider, {
      from: evmAccount.address,
      to: identityAddr,
      data: encodeFunctionData({
        abi: IDENTITY_ABI,
        functionName: "createProfile",
        args: [handle, meta],
      }),
    });
    await pub.waitForTransactionReceipt({ hash: tx1 });
    const sol1 = await fetchSolanaSettlement(rpcUrl, tx1);
    console.log(`   Confirmed EVM Tx : ${explorerBase}tx/${tx1}`);
    if (sol1[0]) console.log(`   Solana Settlement: ${solanaExplorerBase}/tx/${sol1[0]}${clusterQuery}`);
    e2eSummary.createProfileTx = tx1;
    e2eSummary.createProfileSolanaSig = sol1[0] ?? null;

    profileId = (await pub.readContract({
      address: identityAddr,
      abi: IDENTITY_ABI,
      functionName: "resolveProfile",
      args: [evmAccount.address],
    })) as bigint;
  } else {
    console.log(`\n1. Existing profile #${profileId} found for ${evmAccount.address}`);
  }

  // 2 & 3. Solana-lane link + confirm if ROME_SOLANA_KEY is configured
  const rawSolKey = process.env.ROME_SOLANA_KEY;
  if (rawSolKey && rawSolKey.trim().startsWith("[")) {
    const solKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(rawSolKey)));
    const solSynthetic = syntheticAddress(solKeypair.publicKey);
    const solBytes32 = pubkeyToBytes32(solKeypair.publicKey);
    const existingSolProfile = (await pub.readContract({
      address: identityAddr,
      abi: IDENTITY_ABI,
      functionName: "resolveProfile",
      args: [solSynthetic],
    })) as bigint;

    if (existingSolProfile === 0n) {
      console.log(
        `\n2. Requesting link to Solana wallet ${solKeypair.publicKey.toBase58()} (synthetic ${solSynthetic})...`
      );
      const txLink = await submitRomeTx(evmProvider, {
        from: evmAccount.address,
        to: identityAddr,
        data: encodeFunctionData({
          abi: IDENTITY_ABI,
          functionName: "requestLink",
          args: [profileId, "0x0000000000000000000000000000000000000000", solBytes32],
        }),
      });
      await pub.waitForTransactionReceipt({ hash: txLink });
      const solLink = await fetchSolanaSettlement(rpcUrl, txLink);
      console.log(`   LinkRequested EVM: ${explorerBase}tx/${txLink}`);
      if (solLink[0]) console.log(`   Solana Settlement: ${solanaExplorerBase}/tx/${solLink[0]}${clusterQuery}`);
      e2eSummary.requestLinkTx = txLink;

      const confirmCall = {
        to: identityAddr,
        data: encodeFunctionData({
          abi: IDENTITY_ABI,
          functionName: "confirmLink",
          args: [profileId],
        }),
      };

      const estConfirm = await pub.estimateGas({
        account: solSynthetic,
        to: confirmCall.to,
        data: confirmCall.data,
      });
      const neededSolWei = (estConfirm * 155n * gasPrice) / 100n + parseEther("0.015");
      const solGasBal = await pub.getBalance({ address: solSynthetic });
      if (solGasBal < neededSolWei) {
        const topUpAmt = neededSolWei - solGasBal;
        console.log(
          `   Topping up ${formatEther(topUpAmt)} USDC Hadrian gas to Solana synthetic ${solSynthetic}...`
        );
        const topUpTx = await submitRomeTx(evmProvider, {
          from: evmAccount.address,
          to: solSynthetic,
          value: topUpAmt,
          data: "0x",
        });
        await pub.waitForTransactionReceipt({ hash: topUpTx });
        console.log(`   Gas topped up    : ${explorerBase}tx/${topUpTx}`);
      }

      console.log(`\n3. Confirming link from Solana lane (${solKeypair.publicKey.toBase58()})...`);
      const connection = new Connection(solanaRpc, "confirmed");
      const v1Deps = {
        connection,
        proxyUrl: rpcUrl,
        chainId,
        programId: chain.romeEvmProgramId,
        signer: solKeypair,
      };
      let solLamports = 0;
      try {
        solLamports = await connection.getBalance(solKeypair.publicKey);
      } catch {
        solLamports = 0;
      }
      const conf =
        solLamports >= 10_000
          ? await submitRomeTxV1(v1Deps, confirmCall)
          : await relayV1(v1Deps, confirmCall);
      if (conf.receipt?.status !== "0x1") {
        throw new Error(`confirmLink via Solana lane failed: ${conf.hash}`);
      }
      const solConfSigs = await fetchSolanaSettlement(rpcUrl, conf.hash);
      console.log(
        `   LinkConfirmed (${conf.route})! EVM Tx: ${explorerBase}tx/${conf.hash}`
      );
      if (solConfSigs[0]) {
        console.log(`   Solana Settlement: ${solanaExplorerBase}/tx/${solConfSigs[0]}${clusterQuery}`);
      }
      e2eSummary.confirmLinkSolanaLaneTx = conf.hash;
      e2eSummary.confirmLinkSolanaSig = solConfSigs[0] ?? null;
      e2eSummary.solanaWallet = solKeypair.publicKey.toBase58();
      e2eSummary.solanaSyntheticAddress = solSynthetic;
    } else {
      console.log(`\n2-3. Solana wallet already linked to profile #${existingSolProfile}`);
    }
  } else {
    console.log(`\n2-3. Skipping headless Solana-lane confirm (set ROME_SOLANA_KEY in .env to run headless Solana confirm).`);
  }

  // 4. Add a work record
  console.log(`\n4. Adding portfolio Work Record on profile #${profileId}...`);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const txWork = await submitRomeTx(evmProvider, {
    from: evmAccount.address,
    to: workAddr,
    data: encodeFunctionData({
      abi: WORK_ABI,
      functionName: "addWorkRecord",
      args: [
        profileId,
        "Rome Dual-Lane Identity Hub",
        "Unified EVM & Solana identity + reputation on Rome.",
        "https://github.com/uuhavy/romeid",
        nowSec - 86400n * 14n,
        nowSec,
      ],
    }),
  });
  await pub.waitForTransactionReceipt({ hash: txWork });
  const solWork = await fetchSolanaSettlement(rpcUrl, txWork);
  console.log(`   WorkRecordAdded  : ${explorerBase}tx/${txWork}`);
  if (solWork[0]) console.log(`   Solana Settlement: ${solanaExplorerBase}/tx/${solWork[0]}${clusterQuery}`);
  e2eSummary.addWorkRecordTx = txWork;
  e2eSummary.addWorkRecordSolanaSig = solWork[0] ?? null;

  const records = (await pub.readContract({
    address: workAddr,
    abi: WORK_ABI,
    functionName: "getProfileWorkRecords",
    args: [profileId],
  })) as ReadonlyArray<{ id: bigint }>;
  const latestRecordId = records[records.length - 1].id;

  // 5. Employer attestation if ATTESTER_EVM_KEY is set
  const rawAttesterKey = process.env.ATTESTER_EVM_KEY;
  if (rawAttesterKey && /^(0x)?[0-9a-fA-F]{64}$/.test(rawAttesterKey.trim())) {
    const attAccount = privateKeyToAccount(
      (rawAttesterKey.trim().startsWith("0x") ? rawAttesterKey.trim() : `0x${rawAttesterKey.trim()}`) as Hex
    );
    const attData = encodeFunctionData({
      abi: ATTESTATION_ABI,
      functionName: "attest",
      args: [
        profileId,
        latestRecordId,
        5,
        "data:text/plain,Verified 5/5 Rome builder!",
      ],
    });
    const estAtt = await pub.estimateGas({
      account: attAccount.address,
      to: attestationAddr,
      data: attData,
    });
    const neededAttWei = (estAtt * 155n * gasPrice) / 100n + parseEther("0.015");
    const attGasBal = await pub.getBalance({ address: attAccount.address });
    if (attGasBal < neededAttWei) {
      const topUpAmt = neededAttWei - attGasBal;
      console.log(`   Topping up ${formatEther(topUpAmt)} USDC Hadrian gas to Attester ${attAccount.address}...`);
      const topUpAttTx = await submitRomeTx(evmProvider, {
        from: evmAccount.address,
        to: attAccount.address,
        value: topUpAmt,
        data: "0x",
      });
      await pub.waitForTransactionReceipt({ hash: topUpAttTx });
      console.log(`   Attester topped  : ${explorerBase}tx/${topUpAttTx}`);
    }
    const attProvider = makeNodeEip1193(attAccount, rpcUrl, chainId);
    console.log(`\n5. Submitting 5-star employer attestation from ${attAccount.address}...`);
    const txAtt = await submitRomeTx(attProvider, {
      from: attAccount.address,
      to: attestationAddr,
      data: attData,
    });
    await pub.waitForTransactionReceipt({ hash: txAtt });
    const solAtt = await fetchSolanaSettlement(rpcUrl, txAtt);
    console.log(`   AttestationCreated: ${explorerBase}tx/${txAtt}`);
    if (solAtt[0]) console.log(`   Solana Settlement : ${solanaExplorerBase}/tx/${solAtt[0]}${clusterQuery}`);
    e2eSummary.attestTx = txAtt;
    e2eSummary.attestSolanaSig = solAtt[0] ?? null;
  } else {
    console.log(`\n5. Set ATTESTER_EVM_KEY in .env (or use /attest in UI) to submit employer attestation.`);
  }

  // 6. Read Profile & Reputation
  const prof = (await pub.readContract({
    address: identityAddr,
    abi: IDENTITY_ABI,
    functionName: "getProfile",
    args: [profileId],
  })) as { handle: string };
  const rep = (await pub.readContract({
    address: attestationAddr,
    abi: ATTESTATION_ABI,
    functionName: "getReputation",
    args: [profileId],
  })) as {
    score: bigint;
    averageRatingHundredths: bigint;
    activeAttestations: bigint;
    distinctAttesters: bigint;
  };

  const finalBal = await pub.getBalance({ address: evmAccount.address });
  console.log(`\n6. On-Chain Reputation for Profile #${profileId} (@${prof.handle}):`);
  console.log(`   Score               : ${rep.score.toString()} / 1000`);
  console.log(`   Average Rating      : ${(Number(rep.averageRatingHundredths) / 100).toFixed(2)} / 5.00`);
  console.log(`   Active Attestations : ${rep.activeAttestations.toString()}`);
  console.log(`   Distinct Attesters  : ${rep.distinctAttesters.toString()}`);
  console.log(`   Remaining Gas Bal   : ${formatEther(finalBal)} ${chain.nativeCurrency.symbol}`);

  if (deployed) {
    deployed.e2eVerification = {
      profileId: profileId.toString(),
      handle: prof.handle,
      reputationScore: rep.score.toString(),
      ...e2eSummary,
    };
    writeFileSync(deployFile, JSON.stringify(deployed, null, 2) + "\n");
  }
}

main().catch((err) => {
  console.error("Seed error:", err.message || err);
  process.exit(1);
});
