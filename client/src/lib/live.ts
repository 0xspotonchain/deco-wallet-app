// Live chain reads from the browser: balances + activity for any wallet
// (known or imported), straight from public RPCs and explorer APIs.
// Used on open and on a 60s timer; the server snapshot covers the rest.

import {
addressForChain,
txUrl,
type ChainCfg,
} from "./chains";
import { tronAddressToHex, tronConstantCall, type CustomToken } from "./customTokens";

export interface LiveBalance {
  chainKey: string;
  assetKey: string;
  symbol: string;
  kind: "native" | "token" | "nft" | "quarantine";
  contract: string | null;
  balance: string;
  decimals: number;
  custom?: boolean; // user-imported by contract address (device-local)
}

export interface LiveActivity {
  chainKey: string;
  txHash: string;
  direction: "in" | "out" | "self";
  symbol: string;
  amount: string;
  counterparty: string | null;
  ts: number;
  explorerUrl: string;
}

export function formatUnits(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${fracStr ? `.${fracStr}` : ""}`;
}

export function parseUnits(text: string, decimals: number): bigint {
  const clean = text.trim();
  if (!/^\d*(\.\d*)?$/.test(clean) || clean === "" || clean === ".") throw new Error("Invalid amount");
  const [whole = "0", frac = ""] = clean.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

async function fetchJson(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

export async function rpcCall(rpcs: string[], method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  let lastErr: unknown = null;
  for (const rpc of rpcs) {
    try {
      const data = (await fetchJson(
        rpc,
        { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) },
        timeoutMs,
      )) as { result?: unknown; error?: { message?: string } };
      if (data.error) throw new Error(data.error.message ?? "RPC error");
      return data.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("RPC failed");
}

function hexToBigInt(hex: unknown): bigint {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return 0n;
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}

const QUARANTINE_SYMBOLS = new Set(["BZND"]);
const isQuarantineName = (name: string) => name.toLowerCase().includes("tenergy");

// ------------------------------------------------------------ per-family

async function fetchEvm(chain: ChainCfg, address: string, bals: LiveBalance[], acts: LiveActivity[], custom: CustomToken[]): Promise<void> {
  const balHex = await rpcCall(chain.rpcs, "eth_getBalance", [address, "latest"], chain.timeoutMs);
  bals.push({
    chainKey: chain.key, assetKey: "native", symbol: chain.nativeSymbol, kind: "native",
    contract: null, balance: formatUnits(hexToBigInt(balHex), chain.nativeDecimals), decimals: chain.nativeDecimals,
  });
  const readToken = async (contract: string, symbol: string, decimals: number, isCustom: boolean) => {
    try {
      const data = "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0");
      const res = await rpcCall(chain.rpcs, "eth_call", [{ to: contract, data }, "latest"], chain.timeoutMs);
      bals.push({
        chainKey: chain.key, assetKey: contract.toLowerCase(), symbol, kind: "token",
        contract, balance: formatUnits(hexToBigInt(res), decimals), decimals,
        ...(isCustom ? { custom: true } : {}),
      });
    } catch { /* token read is best-effort */ }
  };
  for (const t of chain.tokens) {
    await readToken(t.contract, t.symbol, t.decimals, false);
  }
  for (const t of custom) {
    if (chain.tokens.some((s) => s.contract.toLowerCase() === t.contract.toLowerCase())) continue;
    await readToken(t.contract, t.symbol, t.decimals, true);
  }
  if (!chain.blockscout) return;
  const bs = chain.blockscout;
  try {
    const data = (await fetchJson(`${bs}/api/v2/addresses/${address}/tokens?type=ERC-20,ERC-721`, undefined, chain.timeoutMs)) as { items?: unknown[] };
    const seen = new Set(bals.filter((b) => b.chainKey === chain.key).map((b) => b.assetKey));
    for (const raw of data.items ?? []) {
      const item = raw as {
        token?: { address_hash?: string; symbol?: string; name?: string; decimals?: string | null; type?: string };
        value?: string; token_id?: string | null;
      };
      const tok = item.token;
      if (!tok?.address_hash || !tok.symbol) continue;
      if (chain.key === "arc-testnet" && tok.address_hash.toLowerCase() === "0x3600000000000000000000000000000000000000") continue;
      if (tok.type === "ERC-721") {
        bals.push({
          chainKey: chain.key, assetKey: tok.address_hash.toLowerCase(),
          symbol: tok.symbol, kind: "nft", contract: tok.address_hash,
          balance: item.value ?? "1", decimals: 0,
        });
        continue;
      }
      let value = 0n;
      try { value = BigInt(item.value ?? "0"); } catch { /* keep 0 */ }
      if (value === 0n || seen.has(tok.address_hash.toLowerCase())) continue;
      const decimals = Number(tok.decimals ?? 18);
      bals.push({
        chainKey: chain.key, assetKey: tok.address_hash.toLowerCase(), symbol: tok.symbol,
        kind: QUARANTINE_SYMBOLS.has(tok.symbol) || isQuarantineName(tok.name ?? "") ? "quarantine" : "token",
        contract: tok.address_hash, balance: formatUnits(value, decimals), decimals,
      });
    }
  } catch { /* discovery is best-effort */ }
  try {
    const data = (await fetchJson(`${bs}/api/v2/addresses/${address}/transactions`, undefined, chain.timeoutMs)) as { items?: unknown[] };
    for (const raw of data.items ?? []) {
      const tx = raw as {
        hash?: string; timestamp?: string; value?: string;
        from?: { hash?: string }; to?: { hash?: string };
        token_transfers?: Array<{ token?: { symbol?: string; decimals?: string | null }; total?: { value?: string } }>;
      };
      if (!tx.hash) continue;
      const from = (tx.from?.hash ?? "").toLowerCase();
      const to = (tx.to?.hash ?? "").toLowerCase();
      const me = address.toLowerCase();
      const direction: LiveActivity["direction"] = from === me && to === me ? "self" : from === me ? "out" : "in";
      let symbol = chain.nativeSymbol;
      let amount = "0";
      try { amount = formatUnits(BigInt(tx.value ?? "0"), chain.nativeDecimals); } catch { /* keep 0 */ }
      const tt = tx.token_transfers?.[0];
      if ((tx.value ?? "0") === "0" && tt?.token?.symbol && tt.total?.value) {
        symbol = tt.token.symbol;
        try { amount = formatUnits(BigInt(tt.total.value), Number(tt.token.decimals ?? 18)); } catch { /* keep */ }
      }
      acts.push({
        chainKey: chain.key, txHash: tx.hash, direction, symbol, amount,
        counterparty: direction === "out" ? (tx.to?.hash ?? null) : (tx.from?.hash ?? null),
        ts: tx.timestamp ? Date.parse(tx.timestamp) : Date.now(),
        explorerUrl: txUrl(chain, tx.hash),
      });
    }
  } catch { /* activity is best-effort */ }
}

async function fetchBtc(chain: ChainCfg, address: string, bals: LiveBalance[], acts: LiveActivity[]): Promise<void> {
  const base = chain.rpcs[0] ?? "";
  const data = (await fetchJson(`${base}/api/address/${address}`, undefined, chain.timeoutMs)) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const stats = data.chain_stats ?? {};
  const sats = BigInt((stats.funded_txo_sum ?? 0) - (stats.spent_txo_sum ?? 0));
  bals.push({
    chainKey: chain.key, assetKey: "native", symbol: "BTC", kind: "native", contract: null,
    balance: formatUnits(sats, 8), decimals: 8,
  });
  try {
    const txs = (await fetchJson(`${base}/api/address/${address}/txs`, undefined, chain.timeoutMs)) as Array<{
      txid?: string; status?: { block_time?: number };
      vin?: Array<{ prevout?: { scriptpubkey_address?: string; value?: number } }>;
      vout?: Array<{ scriptpubkey_address?: string; value?: number }>;
    }>;
    for (const tx of txs.slice(0, 15)) {
      if (!tx.txid) continue;
      let received = 0;
      let sent = 0;
      for (const o of tx.vout ?? []) if (o.scriptpubkey_address === address) received += o.value ?? 0;
      for (const i of tx.vin ?? []) if (i.prevout?.scriptpubkey_address === address) sent += i.prevout.value ?? 0;
      const net = received - sent;
      acts.push({
        chainKey: chain.key, txHash: tx.txid, direction: net > 0 ? "in" : net < 0 ? "out" : "self",
        symbol: "BTC", amount: formatUnits(BigInt(Math.abs(net)), 8), counterparty: null,
        ts: tx.status?.block_time ? tx.status.block_time * 1000 : Date.now(),
        explorerUrl: txUrl(chain, tx.txid),
      });
    }
  } catch { /* best-effort */ }
}

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEB";

// Well-known SPL mints so common tokens show real symbols instead of a
// truncated mint. Anything else is labelled by the user via custom import.
const KNOWN_SPL: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONK",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "USDC", // devnet
};

interface SplAccount {
  account?: {
    data?: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: { amount?: string; uiAmountString?: string; decimals?: number };
        };
      };
    };
  };
}

async function fetchSolana(chain: ChainCfg, address: string, bals: LiveBalance[], acts: LiveActivity[], custom: CustomToken[]): Promise<void> {
  const rpc = chain.rpcs[0] ?? "";
  const bal = (await rpcCall([rpc], "getBalance", [address], chain.timeoutMs)) as { value?: number };
  bals.push({
    chainKey: chain.key, assetKey: "native", symbol: "SOL", kind: "native", contract: null,
    balance: formatUnits(BigInt(bal.value ?? 0), 9), decimals: 9,
  });
  const seenMints = new Set<string>();
  const pushMint = (mint: string, rawAmount: string, decimals: number, symbol: string, isCustom: boolean) => {
    let raw = 0n;
    try { raw = BigInt(rawAmount); } catch { /* keep 0 */ }
    if (seenMints.has(mint)) return;
    seenMints.add(mint);
    bals.push({
      chainKey: chain.key, assetKey: mint, symbol,
      kind: "token", contract: mint, balance: formatUnits(raw, decimals), decimals,
      ...(isCustom ? { custom: true } : {}),
    });
  };
  // Enumerate every token account under both SPL programs (legacy + Token-2022).
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    try {
      const res = (await rpcCall([rpc], "getTokenAccountsByOwner",
        [address, { programId }, { encoding: "jsonParsed" }], chain.timeoutMs)) as { value?: SplAccount[] };
      for (const entry of res.value ?? []) {
        const info = entry.account?.data?.parsed?.info;
        if (!info?.mint || !info.tokenAmount?.amount) continue;
        if (info.tokenAmount.amount === "0") continue;
        const customToken = custom.find((t) => t.contract === info.mint);
        pushMint(
          info.mint,
          info.tokenAmount.amount,
          info.tokenAmount.decimals ?? 0,
          customToken?.symbol ?? KNOWN_SPL[info.mint] ?? `SPL ${info.mint.slice(0, 4)}…${info.mint.slice(-4)}`,
          Boolean(customToken),
        );
      }
    } catch { /* best-effort */ }
  }
  // Custom mints with no balance yet still get a row so the import shows.
  for (const t of custom) {
    if (seenMints.has(t.contract)) continue;
    let raw = "0";
    let decimals = t.decimals;
    for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      try {
        const res = (await rpcCall([rpc], "getTokenAccountsByOwner",
          [address, { mint: t.contract, programId }, { encoding: "jsonParsed" }], chain.timeoutMs)) as { value?: SplAccount[] };
        for (const entry of res.value ?? []) {
          const info = entry.account?.data?.parsed?.info;
          if (info?.tokenAmount?.amount) {
            raw = info.tokenAmount.amount;
            decimals = info.tokenAmount.decimals ?? t.decimals;
          }
        }
        if (raw !== "0") break;
      } catch { /* best-effort */ }
    }
    pushMint(t.contract, raw, decimals, t.symbol, true);
  }
  try {
    const sigs = (await rpcCall([rpc], "getSignaturesForAddress", [address, { limit: 8 }], chain.timeoutMs)) as Array<{ signature?: string; blockTime?: number }>;
    for (const s of sigs) {
      if (!s.signature) continue;
      acts.push({
        chainKey: chain.key, txHash: s.signature, direction: "in", symbol: "SOL", amount: "0",
        counterparty: null, ts: s.blockTime ? s.blockTime * 1000 : Date.now(),
        explorerUrl: txUrl(chain, s.signature),
      });
    }
  } catch { /* best-effort */ }
}

function decodeTronString(hex: string | null): string | null {
  if (!hex) return null;
  try {
    const bytes = new Uint8Array(hex.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
    if (bytes.length >= 64) {
      const len = Number(BigInt("0x" + hex.slice(64, 128)));
      if (len > 0 && len <= 256 && bytes.length >= 64 + len) {
        return new TextDecoder().decode(bytes.slice(64, 64 + len)).replace(/\0+$/, "");
      }
    }
    return new TextDecoder().decode(bytes).replace(/\0+$/, "") || null;
  } catch {
    return null;
  }
}

async function fetchTron(chain: ChainCfg, address: string, bals: LiveBalance[], acts: LiveActivity[], custom: CustomToken[]): Promise<void> {
  const grid = chain.rpcs[0] ?? "";
  const scan = chain.key === "tron-nile" ? "https://nileapi.tronscan.org" : "https://apilist.tronscanapi.com";
  const acct = (await fetchJson(`${grid}/wallet/getaccount`, { method: "POST", body: JSON.stringify({ address, visible: true }) }, chain.timeoutMs)) as {
    balance?: number;
    trc20?: Array<Record<string, string>>;
  };
  bals.push({
    chainKey: chain.key, assetKey: "native", symbol: "TRX", kind: "native", contract: null,
    balance: formatUnits(BigInt(acct.balance ?? 0), 6), decimals: 6,
  });
  // Custom TRC-20 imports: balanceOf via trongrid constant call (both networks).
  const myHex = tronAddressToHex(address);
  for (const t of custom) {
    if (!myHex) break;
    const param = myHex.padStart(64, "0");
    const [balHex, decHex] = await Promise.all([
      tronConstantCall(grid, t.contract, "balanceOf(address)", param, chain.timeoutMs),
      tronConstantCall(grid, t.contract, "decimals()", "", chain.timeoutMs),
    ]);
    if (balHex == null) continue;
    let raw = 0n;
    try { raw = BigInt("0x" + balHex); } catch { /* keep 0 */ }
    let decimals = t.decimals;
    if (decHex) {
      try {
        const d = BigInt("0x" + decHex);
        if (d <= 255n) decimals = Number(d);
      } catch { /* keep stored decimals */ }
    }
    bals.push({
      chainKey: chain.key, assetKey: t.contract, symbol: t.symbol, kind: "token",
      contract: t.contract, balance: formatUnits(raw, decimals), decimals, custom: true,
    });
  }
  if (chain.key === "tron") {
    // Tronscan mainnet API requires a key — use trongrid data instead, and
    // resolve each TRC-20's real symbol/decimals from the contract itself.
    for (const entry of acct.trc20 ?? []) {
      for (const [contract, rawStr] of Object.entries(entry)) {
        let raw = 0n;
        try { raw = BigInt(rawStr); } catch { continue; }
        if (raw === 0n) continue;
        if (custom.some((t) => t.contract === contract)) continue;
        const isUsdt = contract === "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
        let symbol = isUsdt ? "USDT" : `TRC20 ${contract.slice(0, 4)}…${contract.slice(-4)}`;
        let decimals = 6;
        if (!isUsdt) {
          const [symHex, decHex] = await Promise.all([
            tronConstantCall(grid, contract, "symbol()", "", chain.timeoutMs),
            tronConstantCall(grid, contract, "decimals()", "", chain.timeoutMs),
          ]);
          const resolved = decodeTronString(symHex);
          if (resolved) symbol = resolved;
          if (decHex) {
            try {
              const d = BigInt("0x" + decHex);
              if (d <= 255n) decimals = Number(d);
            } catch { /* keep 6 */ }
          }
        }
        bals.push({
          chainKey: chain.key, assetKey: contract,
          symbol,
          kind: QUARANTINE_SYMBOLS.has(symbol) || isQuarantineName(symbol) ? "quarantine" : "token",
          contract, balance: formatUnits(raw, decimals), decimals,
        });
      }
    }
    try {
      const data = (await fetchJson(`${grid}/v1/accounts/${address}/transactions/trc20?limit=20`, undefined, chain.timeoutMs)) as {
        data?: Array<{
          transaction_id?: string; block_timestamp?: number; from?: string; to?: string; value?: string;
          token_info?: { symbol?: string; decimals?: number };
        }>;
      };
      for (const t of data.data ?? []) {
        if (!t.transaction_id) continue;
        let raw = 0n;
        try { raw = BigInt(t.value ?? "0"); } catch { /* keep 0 */ }
        acts.push({
          chainKey: chain.key, txHash: t.transaction_id, direction: t.from === address ? "out" : "in",
          symbol: t.token_info?.symbol ?? "TRC20", amount: formatUnits(raw, t.token_info?.decimals ?? 6),
          counterparty: t.from === address ? (t.to ?? null) : (t.from ?? null),
          ts: t.block_timestamp ?? Date.now(), explorerUrl: txUrl(chain, t.transaction_id),
        });
      }
    } catch { /* best-effort */ }
    return;
  }
  try {
    const data = (await fetchJson(`${scan}/api/account/tokens?address=${address}&start=0&limit=30`, undefined, chain.timeoutMs)) as {
      data?: Array<{ tokenId?: string; tokenName?: string; tokenAbbr?: string; balance?: string; tokenDecimal?: number }>;
    };
    for (const t of data.data ?? []) {
      if (!t.tokenId || t.tokenId === "_") continue;
      if (bals.some((b) => b.chainKey === chain.key && b.assetKey === t.tokenId)) continue; // custom import already read it
      let raw = 0n;
      try { raw = BigInt(t.balance ?? "0"); } catch { /* keep 0 */ }
      if (raw === 0n) continue;
      bals.push({
        chainKey: chain.key, assetKey: t.tokenId, symbol: t.tokenAbbr ?? "?",
        kind: QUARANTINE_SYMBOLS.has(t.tokenAbbr ?? "") || isQuarantineName(t.tokenName ?? "") ? "quarantine" : "token",
        contract: t.tokenId, balance: formatUnits(raw, t.tokenDecimal ?? 6), decimals: t.tokenDecimal ?? 6,
      });
    }
  } catch { /* best-effort */ }
  try {
    const data = (await fetchJson(`${scan}/api/token_trc20/transfers?address=${address}&start=0&limit=10`, undefined, chain.timeoutMs)) as {
      token_transfers?: Array<{
        transaction_id?: string; from_address?: string; to_address?: string; quant?: string; block_ts?: number;
        tokenInfo?: { tokenAbbr?: string; tokenDecimal?: number };
      }>;
    };
    for (const t of data.token_transfers ?? []) {
      if (!t.transaction_id) continue;
      let raw = 0n;
      try { raw = BigInt(t.quant ?? "0"); } catch { /* keep 0 */ }
      acts.push({
        chainKey: chain.key, txHash: t.transaction_id, direction: t.from_address === address ? "out" : "in",
        symbol: t.tokenInfo?.tokenAbbr ?? "TRC20", amount: formatUnits(raw, t.tokenInfo?.tokenDecimal ?? 6),
        counterparty: t.from_address === address ? (t.to_address ?? null) : (t.from_address ?? null),
        ts: t.block_ts ?? Date.now(), explorerUrl: txUrl(chain, t.transaction_id),
      });
    }
  } catch { /* best-effort */ }
}

// ------------------------------------------------------------ entry point

export interface LiveResult {
  balances: LiveBalance[];
  activity: LiveActivity[];
  failures: string[];
  fetchedAt: number;
}

export async function fetchWalletLive(
  addresses: Partial<Record<string, string>>,
  chains: ChainCfg[],
  customTokens: CustomToken[] = [],
): Promise<LiveResult> {
  const balances: LiveBalance[] = [];
  const activity: LiveActivity[] = [];
  const failures: string[] = [];
  const targets = chains
    .map((chain) => ({ chain, address: addressForChain(addresses, chain) }))
    .filter((t): t is { chain: ChainCfg; address: string } => Boolean(t.address));
  const queue = [...targets];
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const custom = customTokens.filter((t) => t.chainKey === next.chain.key);
      try {
        switch (next.chain.family) {
          case "evm":
            await fetchEvm(next.chain, next.address, balances, activity, custom);
            break;
          case "btc":
            await fetchBtc(next.chain, next.address, balances, activity);
            break;
          case "solana":
            await fetchSolana(next.chain, next.address, balances, activity, custom);
            break;
          case "tron":
            await fetchTron(next.chain, next.address, balances, activity, custom);
            break;
        }
      } catch {
        failures.push(next.chain.key);
      }
    }
  });
  await Promise.all(workers);
  activity.sort((a, b) => b.ts - a.ts);
  return { balances, activity, failures, fetchedAt: Date.now() };
}
