"use client";

import React, { useEffect, useState } from "react";
import { Rocket, CheckCircle2, ExternalLink, Copy, Save, AlertTriangle, Loader2 } from "lucide-react";
import { encodeDeployData, isAddress, type Hex } from "viem";
import bytecodes from "@/config/bytecodes.json";
import { useRomeApp } from "@/context/RomeAppContext";
import { ensureEvmChain, makePublicClient, type Eip1193Provider } from "@/lib/romeLane";

export default function DeployPage() {
  const { config, evmAddress, evmConnected, connectMetaMask, saveRuntimeContracts, refreshProfile } =
    useRomeApp();

  const [idAddr, setIdAddr] = useState<string>(config.contracts.identityRegistry ?? "");
  const [workAddr, setWorkAddr] = useState<string>(config.contracts.workRegistry ?? "");
  const [attAddr, setAttAddr] = useState<string>(config.contracts.attestationRegistry ?? "");

  const [deploying, setDeploying] = useState(false);
  const [stepMsg, setStepMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [txHashes, setTxHashes] = useState<{ id?: string; work?: string; att?: string }>({});

  useEffect(() => {
    if (config.contracts.identityRegistry && !idAddr) setIdAddr(config.contracts.identityRegistry);
    if (config.contracts.workRegistry && !workAddr) setWorkAddr(config.contracts.workRegistry);
    if (config.contracts.attestationRegistry && !attAddr)
      setAttAddr(config.contracts.attestationRegistry);
  }, [config.contracts, idAddr, workAddr, attAddr]);

  async function deploySingleContract(
    provider: Eip1193Provider,
    from: Hex,
    deployData: Hex,
    label: string
  ): Promise<{ address: Hex; txHash: Hex }> {
    setStepMsg(`Deploying ${label} — confirm in MetaMask...`);
    const pub = makePublicClient(config);
    const gasPrice = await pub.getGasPrice();
    const maxFeeHex = `0x${(((gasPrice * 12n) / 10n) || 1n).toString(16)}`;
    let gasLimit = 120_000_000n;
    try {
      const est = await pub.estimateGas({ account: from, data: deployData });
      const padded = (est * 13n) / 10n;
      if (padded > 0n) gasLimit = padded;
    } catch {
      // Fallback ceiling (Rome charges only exact gas used)
    }
    const gasHex = `0x${gasLimit.toString(16)}`;

    const txHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          data: deployData,
          gas: gasHex,
          maxFeePerGas: maxFeeHex,
          maxPriorityFeePerGas: "0x0",
        },
      ],
    })) as Hex;

    setStepMsg(`Waiting for ${label} confirmation on ${config.chainName}...`);
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error(`${label} deployment failed (tx: ${txHash})`);
    }
    return { address: receipt.contractAddress as Hex, txHash };
  }

  async function handleOneClickDeploy() {
    setErrorMsg(null);
    setSavedNotice(false);
    setDeploying(true);
    try {
      if (!evmConnected || !evmAddress) {
        await connectMetaMask();
      }
      const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
      if (!eth) throw new Error("MetaMask browser extension not detected.");

      await ensureEvmChain(eth, config);
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const sender = (accounts[0] ?? evmAddress) as Hex;
      if (!sender) throw new Error("No MetaMask account connected.");

      // 1. IdentityRegistry
      const idData = bytecodes.IdentityRegistry as Hex;
      const deployedId = await deploySingleContract(eth, sender, idData, "1/3 IdentityRegistry");
      setIdAddr(deployedId.address);
      setTxHashes((prev) => ({ ...prev, id: deployedId.txHash }));

      // 2. WorkRegistry(identityRegistry)
      const workData = encodeDeployData({
        abi: [
          {
            type: "constructor",
            inputs: [{ name: "identityRegistryAddress", type: "address" }],
            stateMutability: "nonpayable",
          },
        ] as const,
        bytecode: bytecodes.WorkRegistry as Hex,
        args: [deployedId.address],
      });
      const deployedWork = await deploySingleContract(eth, sender, workData, "2/3 WorkRegistry");
      setWorkAddr(deployedWork.address);
      setTxHashes((prev) => ({ ...prev, work: deployedWork.txHash }));

      // 3. AttestationRegistry(identityRegistry, workRegistry)
      const attData = encodeDeployData({
        abi: [
          {
            type: "constructor",
            inputs: [
              { name: "identityRegistryAddress", type: "address" },
              { name: "workRegistryAddress", type: "address" },
            ],
            stateMutability: "nonpayable",
          },
        ] as const,
        bytecode: bytecodes.AttestationRegistry as Hex,
        args: [deployedId.address, deployedWork.address],
      });
      const deployedAtt = await deploySingleContract(
        eth,
        sender,
        attData,
        "3/3 AttestationRegistry"
      );
      setAttAddr(deployedAtt.address);
      setTxHashes((prev) => ({ ...prev, att: deployedAtt.txHash }));

      saveRuntimeContracts({
        identityRegistry: deployedId.address,
        workRegistry: deployedWork.address,
        attestationRegistry: deployedAtt.address,
      });
      await refreshProfile();
      setStepMsg("All 3 RomeID contracts deployed & activated!");
      setSavedNotice(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDeploying(false);
    }
  }

  function handleSaveManual(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!isAddress(idAddr) || !isAddress(workAddr) || !isAddress(attAddr)) {
      setErrorMsg("Please enter valid 0x-prefixed EVM contract addresses for all 3 registries.");
      return;
    }
    saveRuntimeContracts({
      identityRegistry: idAddr as Hex,
      workRegistry: workAddr as Hex,
      attestationRegistry: attAddr as Hex,
    });
    setSavedNotice(true);
    refreshProfile();
  }

  const explorerBase = config.explorerUrl.replace(/\/?$/, "/");

  const jsonSnippet = JSON.stringify(
    {
      [String(config.chainId)]: {
        IdentityRegistry: idAddr || "0x...",
        WorkRegistry: workAddr || "0x...",
        AttestationRegistry: attAddr || "0x...",
      },
    },
    null,
    2
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300 mb-3">
          <Rocket className="h-3.5 w-3.5" />
          Browser Contract Deployer ({config.chainName} — Chain {config.chainId})
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Deploy or Connect RomeID Smart Contracts
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Deploy all 3 Solidity 0.8.28 registries directly from MetaMask (no private key needed), or
          paste addresses deployed via Remix / CLI. Gas on {config.chainName} is{" "}
          <span className="font-semibold text-amber-300">{config.nativeCurrency.symbol}</span>{" "}
          (recommended &ge; 0.5 {config.nativeCurrency.symbol}).
        </p>
      </div>

      {/* 1-Click MetaMask Deploy Card */}
      <div className="mb-8 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-slate-900/80 to-slate-900 p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold text-white">
              1-Click Deploy via MetaMask ({config.chainName})
            </h2>
            <p className="mt-1 text-xs text-slate-300">
              Sequentially deploys <code className="text-amber-300">IdentityRegistry</code> &rarr;{" "}
              <code className="text-amber-300">WorkRegistry</code> &rarr;{" "}
              <code className="text-amber-300">AttestationRegistry</code> and activates them across
              this dApp immediately.
            </p>
          </div>
          <button
            onClick={handleOneClickDeploy}
            disabled={deploying}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 hover:brightness-110 disabled:opacity-50 transition"
          >
            {deploying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4" />
                Deploy 3 Contracts with MetaMask
              </>
            )}
          </button>
        </div>

        {stepMsg && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-xs text-amber-200">
            {stepMsg}
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {isAddress(idAddr) && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
            <p className="text-xs font-semibold text-emerald-300">
              Rome Arena Step 3 (&ldquo;Built on testnet&rdquo;) — Link to paste after testing both wallets:
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="text-xs text-white break-all">
                {explorerBase}address/{idAddr}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(`${explorerBase}address/${idAddr}`)}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
              >
                <Copy className="h-3.5 w-3.5" /> Copy Arena Link
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Active / Manual Contract Addresses Form */}
      <form
        onSubmit={handleSaveManual}
        className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">
            Active Registry Addresses (Chain {config.chainId})
          </h2>
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Active in dApp
            </span>
          )}
        </div>

        {[
          {
            label: "1. IdentityRegistry Address",
            val: idAddr,
            setVal: setIdAddr,
            tx: txHashes.id,
          },
          {
            label: "2. WorkRegistry Address",
            val: workAddr,
            setVal: setWorkAddr,
            tx: txHashes.work,
          },
          {
            label: "3. AttestationRegistry Address",
            val: attAddr,
            setVal: setAttAddr,
            tx: txHashes.att,
          },
        ].map(({ label, val, setVal, tx }) => (
          <div key={label}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300">{label}</label>
              <div className="flex items-center gap-3 text-xs">
                {isAddress(val) && (
                  <a
                    href={`${explorerBase}address/${val}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-amber-300 hover:underline"
                  >
                    Explorer <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {tx && (
                  <a
                    href={`${explorerBase}tx/${tx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-300 hover:underline"
                  >
                    Deploy Tx <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
            <input
              type="text"
              value={val}
              onChange={(e) => setVal(e.target.value.trim())}
              placeholder="0x..."
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 font-mono text-sm text-white placeholder-slate-600 focus:border-amber-500/60 focus:outline-none"
            />
          </div>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 transition"
          >
            <Save className="h-4 w-4" />
            Activate These Contract Addresses
          </button>

          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(jsonSnippet)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs text-slate-300 hover:bg-white/10 transition"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy deployments.json
          </button>
        </div>
      </form>
    </div>
  );
}
