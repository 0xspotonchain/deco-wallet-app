// Client chain configuration: every chain the wallet can show, receive
// on, send from, or swap on. Mirrors the verified table in
// ~/workspace/wallet-balances/check-balances.py plus send/swap extras.

export type Family = "evm" | "btc" | "solana" | "tron";
export type Network = "mainnet" | "testnet";

export interface TokenCfg {
  symbol: string;
  contract: string;
  decimals: number;
}

export interface ChainCfg {
  key: string;
  name: string;
  network: Network;
  family: Family;
  chainId?: number;
  rpcs: string[];
  nativeSymbol: string;
  nativeDecimals: number;
  explorer: string;
  blockscout: string | null;
  tokens: TokenCfg[];
  timeoutMs: number;
}

export const DECO_TESTNET = "0x5f1dF574015C9D044b4C9Ef658cD55aFcC13D783";

export const CHAINS: ChainCfg[] = [
  {
    key: "ethereum", name: "Ethereum", network: "mainnet", family: "evm", chainId: 1,
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://eth.blockscout.com", blockscout: "https://eth.blockscout.com",
    tokens: [
      { symbol: "USDC", contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "USDT", contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { symbol: "DAI", contract: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 },
      { symbol: "WBTC", contract: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
      { symbol: "WETH", contract: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "base", name: "Base", network: "mainnet", family: "evm", chainId: 8453,
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://basescan.org", blockscout: null,
    tokens: [
      { symbol: "USDC", contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { symbol: "USDT", contract: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
      { symbol: "DAI", contract: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
      { symbol: "WETH", contract: "0x4200000000000000000000000000000000000006", decimals: 18 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "arbitrum", name: "Arbitrum One", network: "mainnet", family: "evm", chainId: 42161,
    rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://arbiscan.io", blockscout: null, // its Blockscout instance 403s from here
    tokens: [
      { symbol: "USDC", contract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      { symbol: "USDT", contract: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
      { symbol: "WETH", contract: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "optimism", name: "Optimism", network: "mainnet", family: "evm", chainId: 10,
    rpcs: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://explorer.optimism.io", blockscout: "https://explorer.optimism.io",
    tokens: [
      { symbol: "USDC", contract: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
      { symbol: "USDT", contract: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
      { symbol: "WETH", contract: "0x4200000000000000000000000000000000000006", decimals: 18 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "polygon", name: "Polygon", network: "mainnet", family: "evm", chainId: 137,
    rpcs: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
    nativeSymbol: "POL", nativeDecimals: 18,
    explorer: "https://polygonscan.com", blockscout: null, // its Blockscout instance 403s from here
    tokens: [
      { symbol: "USDC", contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
      { symbol: "USDT", contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
      { symbol: "WETH", contract: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "bsc", name: "BNB Chain", network: "mainnet", family: "evm", chainId: 56,
    rpcs: ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com"],
    nativeSymbol: "BNB", nativeDecimals: 18,
    explorer: "https://bscscan.com", blockscout: null,
    tokens: [
      { symbol: "USDT", contract: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { symbol: "USDC", contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
      { symbol: "WBNB", contract: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "avalanche", name: "Avalanche", network: "mainnet", family: "evm", chainId: 43114,
    rpcs: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc"],
    nativeSymbol: "AVAX", nativeDecimals: 18,
    explorer: "https://snowtrace.io", blockscout: null,
    tokens: [
      { symbol: "USDC", contract: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
      { symbol: "USDT", contract: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
      { symbol: "WAVAX", contract: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "arc-mainnet", name: "Arc", network: "mainnet", family: "evm", chainId: 5042,
    rpcs: ["https://rpc.mainnet.arc.io"],
    nativeSymbol: "USDC", nativeDecimals: 18,
    explorer: "https://explorer.arc.io", blockscout: null,
    tokens: [],
    timeoutMs: 12000,
  },
  {
    key: "bitcoin", name: "Bitcoin", network: "mainnet", family: "btc",
    rpcs: ["https://mempool.space"],
    nativeSymbol: "BTC", nativeDecimals: 8,
    explorer: "https://mempool.space", blockscout: null,
    tokens: [], timeoutMs: 12000,
  },
  {
    key: "solana", name: "Solana", network: "mainnet", family: "solana",
    rpcs: ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"],
    nativeSymbol: "SOL", nativeDecimals: 9,
    explorer: "https://explorer.solana.com", blockscout: null,
    tokens: [], timeoutMs: 12000,
  },
  {
    key: "tron", name: "TRON", network: "mainnet", family: "tron",
    rpcs: ["https://api.trongrid.io"],
    nativeSymbol: "TRX", nativeDecimals: 6,
    explorer: "https://tronscan.org", blockscout: null,
    tokens: [], timeoutMs: 12000,
  },
  {
    key: "sepolia", name: "Sepolia", network: "testnet", family: "evm", chainId: 11155111,
    rpcs: ["https://ethereum-sepolia.publicnode.com", "https://rpc.sepolia.ethpandaops.io"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://eth-sepolia.blockscout.com", blockscout: "https://eth-sepolia.blockscout.com",
    tokens: [
      { symbol: "USDC", contract: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", decimals: 6 },
      { symbol: "EURC", contract: "0x08210f9170f89ab7658f0b5e3ff39b0e03c594d4", decimals: 6 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "hoodi", name: "Hoodi", network: "testnet", family: "evm", chainId: 560048,
    rpcs: ["https://rpc.hoodi.ethpandaops.io"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://hoodi.etherscan.io", blockscout: null,
    tokens: [], timeoutMs: 15000,
  },
  {
    key: "base-sepolia", name: "Base Sepolia", network: "testnet", family: "evm", chainId: 84532,
    rpcs: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://base-sepolia.blockscout.com", blockscout: "https://base-sepolia.blockscout.com",
    tokens: [
      { symbol: "USDC", contract: "0x036cbd53842c5426634e7929541ec2318f3dcf7e", decimals: 6 },
      { symbol: "EURC", contract: "0x808456652fdb597867f38412077a9182bf77359f", decimals: 6 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "arb-sepolia", name: "Arbitrum Sepolia", network: "testnet", family: "evm", chainId: 421614,
    rpcs: ["https://sepolia-rollup.arbitrum.io/rpc", "https://arbitrum-sepolia-rpc.publicnode.com"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://sepolia.arbiscan.io", blockscout: null,
    tokens: [
      { symbol: "USDC", contract: "0x75faf114eafb1BDBe2F0316DF893fd58ce46AA4d", decimals: 6 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "op-sepolia", name: "OP Sepolia", network: "testnet", family: "evm", chainId: 11155420,
    rpcs: ["https://sepolia.optimism.io", "https://optimism-sepolia.drpc.org"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://optimism-sepolia.blockscout.com", blockscout: "https://optimism-sepolia.blockscout.com",
    tokens: [
      { symbol: "USDC", contract: "0x5fd84259d66cd46123540766be93dfe6d43130d7", decimals: 6 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "arc-testnet", name: "Arc Testnet", network: "testnet", family: "evm", chainId: 5042002,
    rpcs: ["https://rpc.testnet.arc.io"],
    nativeSymbol: "USDC", nativeDecimals: 18,
    explorer: "https://explorer.testnet.arc.io", blockscout: "https://explorer.testnet.arc.io",
    tokens: [
      { symbol: "EURC", contract: "0x89b50855aa3be2f677cd6303cec089b5f319d72a", decimals: 6 },
      { symbol: "DECO", contract: DECO_TESTNET, decimals: 18 },
      { symbol: "DM", contract: "0x104a92386b4a7ddbfb35214b72ddbb8ed0134438", decimals: 18 },
    ],
    timeoutMs: 12000,
  },
  {
    key: "robinhood", name: "Robinhood Testnet", network: "testnet", family: "evm", chainId: 46630,
    rpcs: ["https://rpc.testnet.chain.robinhood.com/rpc", "https://robinhood-sepolia-rpc.publicnode.com"],
    nativeSymbol: "ETH", nativeDecimals: 18,
    explorer: "https://explorer.testnet.chain.robinhood.com", blockscout: "https://explorer.testnet.chain.robinhood.com",
    tokens: [{ symbol: "DECO", contract: DECO_TESTNET, decimals: 18 }],
    timeoutMs: 12000,
  },
  {
    key: "litvm", name: "LitVM Testnet", network: "testnet", family: "evm", chainId: 4441,
    rpcs: ["https://rpc.testnet.liteforge.zeeve.net/"],
    nativeSymbol: "zkLTC", nativeDecimals: 18,
    explorer: "https://explorer.testnet.liteforge.zeeve.net", blockscout: "https://explorer.testnet.liteforge.zeeve.net",
    tokens: [{ symbol: "DECO", contract: DECO_TESTNET, decimals: 18 }],
    timeoutMs: 12000,
  },
  {
    key: "velana", name: "Velana Testnet", network: "testnet", family: "evm", chainId: 484148,
    rpcs: ["https://velanachain.com/rpc"],
    nativeSymbol: "VELA", nativeDecimals: 18,
    explorer: "https://velanachain.com/explorer", blockscout: null,
    tokens: [{ symbol: "DECO", contract: "0xDf8A3BaAFffc5de3938bff1158584E841531BcbF", decimals: 18 }],
    timeoutMs: 30000,
  },
  {
    key: "amoy", name: "Polygon Amoy", network: "testnet", family: "evm", chainId: 80002,
    rpcs: ["https://polygon-amoy.drpc.org", "https://polygon-amoy-bor-rpc.publicnode.com"],
    nativeSymbol: "POL", nativeDecimals: 18,
    explorer: "https://amoy.polygonscan.com", blockscout: null,
    tokens: [], timeoutMs: 12000,
  },
  {
    key: "bitcoin-testnet4", name: "Bitcoin Testnet4", network: "testnet", family: "btc",
    rpcs: ["https://mempool.space/testnet4"],
    nativeSymbol: "BTC", nativeDecimals: 8,
    explorer: "https://mempool.space/testnet4", blockscout: null,
    tokens: [], timeoutMs: 12000,
  },
  {
    key: "solana-devnet", name: "Solana Devnet", network: "testnet", family: "solana",
    rpcs: ["https://api.devnet.solana.com"],
    nativeSymbol: "SOL", nativeDecimals: 9,
    explorer: "https://explorer.solana.com", blockscout: null,
    tokens: [], timeoutMs: 12000,
  },
  {
    key: "tron-nile", name: "TRON Nile", network: "testnet", family: "tron",
    rpcs: ["https://nile.trongrid.io"],
    nativeSymbol: "TRX", nativeDecimals: 6,
    explorer: "https://nile.tronscan.org", blockscout: null,
    tokens: [], timeoutMs: 12000,
  },
];

export const chainByKey = (key: string): ChainCfg | undefined => CHAINS.find((c) => c.key === key);

export function txUrl(chain: ChainCfg, hash: string): string {
  switch (chain.family) {
    case "evm":
      return chain.key === "velana" ? `${chain.explorer}/#/tx/${hash}` : `${chain.explorer}/tx/${hash}`;
    case "btc":
      return `${chain.explorer}/tx/${hash}`;
    case "solana":
      return `${chain.explorer}/tx/${hash}${chain.network === "testnet" ? "?cluster=devnet" : ""}`;
    case "tron":
      return chain.key === "tron" ? `${chain.explorer}/#/transaction/${hash}` : `${chain.explorer}/transaction/${hash}`;
  }
}

export function addressUrl(chain: ChainCfg, address: string): string {
  switch (chain.family) {
    case "evm":
      return chain.key === "velana" ? `${chain.explorer}/#/address/${address}` : `${chain.explorer}/address/${address}`;
    case "btc":
      return `${chain.explorer}/address/${address}`;
    case "solana":
      return `${chain.explorer}/address/${address}${chain.network === "testnet" ? "?cluster=devnet" : ""}`;
    case "tron":
      return chain.key === "tron" ? `${chain.explorer}/#/address/${address}` : `${chain.explorer}/address/${address}`;
  }
}

// The two known wallets. Burner is view-only until deco imports its seed
// in the app; Circle is a smart-contract agent wallet, read-only forever.
export const BURNER_ADDRESSES = {
  evm: "0xF1d949ed9B0b62508203AB0B91Bf01E73309Ad31",
  btc: "bc1q9473rsxyha0pl8w2sjcawy6ulyumpr4xch7822",
  "btc-testnet": "tb1qzk55m8k55e5p835y58qrlesw26z8j3ch4pkvxp",
  solana: "DcvJCguHLqQE52hpDvtoLG2wBNuK82tHCWpsgySRH6rL",
  tron: "TXPdam3wpEfcEGhmvkcpb5rRyeyTkRT46p",
} as const;

export const CIRCLE_ADDRESSES: Record<string, string> = {
  "arc-testnet": "0xc7d81269debced5e62069a4d42950965853aa300",
  "arc-mainnet": "0xe7ad575b529ba58ad811fe02df67aaa44dc42f44",
};

/** Which address of a wallet serves a given chain (undefined = not on that chain). */
export function addressForChain(
  addresses: Partial<Record<string, string>>,
  chain: ChainCfg,
): string | undefined {
  if (chain.family === "evm") return addresses.evm;
  if (chain.family === "btc") return chain.network === "mainnet" ? addresses.btc : addresses["btc-testnet"];
  if (chain.family === "solana") return addresses.solana;
  return addresses.tron;
}

// ------------------------------------------------------------ swap config

export interface AmmPool {
  chainKey: string;
  pool: string;
  deco: string;
  quoteSymbol: string; // base asset symbol
  quoteContract: string | null; // null = native base
  quoteDecimals: number;
}

export const AMM_POOLS: AmmPool[] = [
  {
    chainKey: "arc-testnet",
    pool: "0x3137C615F3f3B1e7C8F75390F8ccb128f4D11A3A",
    deco: DECO_TESTNET,
    quoteSymbol: "USDC",
    quoteContract: "0x3600000000000000000000000000000000000000", // USDC ERC-20 view on Arc, 6 dec
    quoteDecimals: 6,
  },
  {
    chainKey: "robinhood",
    pool: "0xC72A740883E93E899C02036f96841869A5BdbbDC",
    deco: DECO_TESTNET,
    quoteSymbol: "ETH",
    quoteContract: null,
    quoteDecimals: 18,
  },
  {
    chainKey: "litvm",
    pool: "0x3137C615F3f3B1e7C8F75390F8ccb128f4D11A3A",
    deco: DECO_TESTNET,
    quoteSymbol: "zkLTC",
    quoteContract: null,
    quoteDecimals: 18,
  },
  {
    chainKey: "velana",
    pool: "0xa81056EF621c952B5Fc033D7db159a0Da4ED5163",
    deco: "0xDf8A3BaAFffc5de3938bff1158584E841531BcbF",
    quoteSymbol: "VELA",
    quoteContract: null,
    quoteDecimals: 18,
  },
];

// Uniswap V3 per chain (SwapRouter02 + QuoterV2); probed with eth_getCode
// on 2026-11-16 — deployed on Ethereum, Base, Arbitrum, Optimism, Polygon;
// NOT deployed at these addresses on BNB Chain or Avalanche, so those
// chains honestly have no Uniswap swap here.
export const UNI_V3: Record<string, { router: string; quoter: string }> = {
  ethereum: {
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
  base: {
    router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  },
  arbitrum: {
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
  optimism: {
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
  polygon: {
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  },
};
