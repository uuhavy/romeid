import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "solidity-coverage";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Dynamically populate every Rome network from @rome-protocol/registry (ZERO hardcoded chain IDs or RPC URLs)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listChains } = require("@rome-protocol/registry") as {
  listChains: () => Array<{ chainId: number; name: string; rpcUrl: string }>;
};

const rawKey = process.env.PRIVATE_KEY || process.env.ROME_EVM_KEY || "";
const normalizedKey =
  rawKey && /^(0x)?[0-9a-fA-F]{64}$/.test(rawKey.trim())
    ? rawKey.trim().startsWith("0x")
      ? rawKey.trim()
      : `0x${rawKey.trim()}`
    : undefined;

const dynamicRomeNetworks: Record<string, { url: string; chainId: number; accounts: string[] }> = {};
for (const chain of listChains()) {
  const shortSlug = chain.name.toLowerCase().split(/\s+/).pop() || String(chain.chainId);
  dynamicRomeNetworks[shortSlug] = {
    url: process.env.PROXY_URL || chain.rpcUrl,
    chainId: chain.chainId,
    accounts: normalizedKey ? [normalizedKey] : [],
  };
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          evmVersion: "cancun",
          viaIR: true,
          metadata: {
            bytecodeHash: "none",
          },
          optimizer: {
            enabled: true,
            runs: 1,
          },
        },
      },
    ],
    overrides: {
      "src/RomeIDHub.sol": {
        version: "0.8.28",
        settings: {
          evmVersion: "paris",
          viaIR: true,
          metadata: {
            bytecodeHash: "none",
          },
          optimizer: {
            enabled: true,
            runs: 1,
            details: {
              yul: true,
              yulDetails: {
                optimizerSteps: "dhfoDgvulfnTUtnIf:fDnTOcmu",
              },
            },
          },
        },
      },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {},
    ...dynamicRomeNetworks,
  },
};

export default config;
