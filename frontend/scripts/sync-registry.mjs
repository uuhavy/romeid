import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getChain, getContracts, getTokens, listChains } from "@rome-protocol/registry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "../src/config/registry.generated.json");

const chains = {};
for (const meta of listChains()) {
  const id = Number(meta.chainId);
  chains[String(id)] = {
    chain: getChain(id),
    contracts: getContracts(id) ?? {},
    tokens: getTokens(id) ?? [],
  };
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), chains }, null, 2) + "\n");
console.log(`[sync-registry] Generated Rome registry snapshot for chains: ${Object.keys(chains).join(", ")}`);
