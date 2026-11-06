declare module "@rome-protocol/registry" {
  export interface RomeChainMetadata {
    chainId: number;
    name: string;
    slug?: string;
    network?: string;
    status?: string;
    rpcUrl: string;
    explorerUrl: string;
    romeEvmProgramId: string;
    nativeCurrency: {
      name: string;
      symbol: string;
      decimals: number;
    };
    solana?: {
      cluster?: string;
      explorerUrl?: string;
      rpc?: string;
    };
    [key: string]: unknown;
  }

  export interface RomeTokenMetadata {
    symbol?: string;
    name?: string;
    decimals?: number;
    address?: string;
    kind?: string;
    mintId?: string;
    [key: string]: unknown;
  }

  export function listChains(): RomeChainMetadata[];
  export function getChain(chainId: number): RomeChainMetadata | null;
  export function getTokens(chainId: number): RomeTokenMetadata[] | null;
  export function getContracts(chainId: number): Record<string, unknown> | null;
  export function getOracle(chainId: number): Record<string, unknown> | null;
  export function getBridge(chainId: number): Record<string, unknown> | null;
  export function getAlts(chainId: number): Record<string, unknown> | null;
  export function getPrograms(network: "mainnet" | "devnet"): Record<string, string>;
  export function getLstMints(): Record<string, unknown>;
}
