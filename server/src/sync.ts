// Background sync engine: reads public chain data for the two known
// public wallets (burner + Circle) and upserts balance snapshots and
// activity rows. Public addresses only — no keys exist on the server.

import type { Ctx } from "@hatch/space-sdk";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";
import {
BURNER,
CIRCLE,
DNFT_VELANA,
EVM_CHAINS,
QUARANTINE_NAMES,
QUARANTINE_SYMBOLS,
type EvmChainCfg,
} from "./chains";

function getDb(ctx: Ctx) {
  return ctx.db<typeof schema>();
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

async function fetchJson(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
}

async function rpcCall(
  rpcs: string[],
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<unknown> {
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

export function formatUnits(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${fracStr ? `.${fracStr}` : ""}`;
}

function hexToBigInt(hex: unknown): bigint {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return 0n;
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}

export const discoveryOk = new Set<string>();

interface BalRow {
  walletKey: string;
  chainKey: string;
  assetKey: string;
  symbol: string;
  kind: "native" | "token" | "nft" | "quarantine";
  contract: string | null;
  balance: string;
  decimals: number;
}

interface ActRow {
  walletKey: string;
  chainKey: string;
  txHash: string;
  direction: "in" | "out" | "self";
  symbol: string;
  amount: string;
  counterparty: string | null;
  ts: number;
  explorerUrl: string;
}

const balKey = (r: BalRow) => `${r.walletKey}|${r.chainKey}|${r.assetKey}`;
const isQuarantineName = (name: string) =>
  QUARANTINE_NAMES.some((q) => name.toLowerCase().includes(q));

// ---------------------------------------------------------------- EVM

async function syncEvmChain(
  chain: EvmChainCfg,
  walletKey: string,
  address: string,
  bals: Map<string, BalRow>,
  acts: ActRow[],
  errors: string[],
): Promise<void> {
  const put = (r: BalRow) => bals.set(balKey(r), r);
  // Native balance
  const balHex = await rpcCall(chain.rpcs, "eth_getBalance", [address, "latest"], chain.timeoutMs);
  put({
    walletKey,
    chainKey: chain.key,
    assetKey: "native",
    symbol: chain.nativeSymbol,
    kind: "native",
    contract: null,
    balance: formatUnits(hexToBigInt(balHex), chain.nativeDecimals),
    decimals: chain.nativeDecimals,
  });
  // Static ERC-20 tokens
  for (const t of chain.tokens) {
    try {
      const data = "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0");
      const res = await rpcCall(
        chain.rpcs,
        "eth_call",
        [{ to: t.contract, data }, "latest"],
        chain.timeoutMs,
      );
      put({
        walletKey,
        chainKey: chain.key,
        assetKey: t.contract.toLowerCase(),
        symbol: t.symbol,
        kind: t.kind,
        contract: t.contract,
        balance: formatUnits(hexToBigInt(res), t.decimals),
        decimals: t.decimals,
      });
    } catch {
      errors.push(`${chain.key}:${t.symbol}`);
    }
  }
  // DNFT #1 ownership on chains without Blockscout discovery (Velana)
  if (chain.key === "velana") {
    try {
      const data = "0x6352211e" + (1n).toString(16).padStart(64, "0");
      const res = await rpcCall(
        chain.rpcs,
        "eth_call",
        [{ to: DNFT_VELANA, data }, "latest"],
        chain.timeoutMs,
      );
      const owner = typeof res === "string" ? "0x" + res.slice(-40) : "";
      if (owner.toLowerCase() === address.toLowerCase()) {
        put({
          walletKey,
          chainKey: chain.key,
          assetKey: `${DNFT_VELANA.toLowerCase()}#1`,
          symbol: "DNFT #1",
          kind: "nft",
          contract: DNFT_VELANA,
          balance: "1",
          decimals: 0,
        });
      }
    } catch {
      /* ownership check is best-effort */
    }
  }
  if (!chain.blockscout) return;
  const bs = chain.blockscout;
  // Token discovery (ERC-20 + ERC-721)
  try {
    const data = (await fetchJson(
      `${bs}/api/v2/addresses/${address}/tokens?type=ERC-20,ERC-721`,
      undefined,
      chain.timeoutMs,
    )) as { items?: unknown[] };
    for (const raw of data.items ?? []) {
      const item = raw as {
        token?: {
          address_hash?: string;
          symbol?: string;
          name?: string;
          decimals?: string | null;
          type?: string;
        };
        value?: string;
        token_id?: string | null;
      };
      const tok = item.token;
      if (!tok?.address_hash || !tok.symbol) continue;
      const contract = tok.address_hash;
      if (chain.key === "arc-testnet" && contract.toLowerCase() === "0x3600000000000000000000000000000000000000") continue;
      if (tok.type === "ERC-721") {
        put({
          walletKey,
          chainKey: chain.key,
          assetKey: contract.toLowerCase(),
          symbol: tok.symbol,
          kind: "nft",
          contract,
          balance: item.value ?? "1",
          decimals: 0,
        });
        continue;
      }
      const decimals = Number(tok.decimals ?? 18);
      const value = (() => {
        try {
          return BigInt(item.value ?? "0");
        } catch {
          return 0n;
        }
      })();
      if (value === 0n) continue;
      const kind = QUARANTINE_SYMBOLS.has(tok.symbol) || isQuarantineName(tok.name ?? "")
        ? "quarantine"
        : "token";
      const row: BalRow = {
        walletKey,
        chainKey: chain.key,
        assetKey: contract.toLowerCase(),
        symbol: tok.symbol,
        kind,
        contract,
        balance: formatUnits(value, decimals),
        decimals,
      };
      // Static rows win (they carry verified decimals).
      if (!bals.has(balKey(row))) put(row);
    }
    discoveryOk.add(`${walletKey}|${chain.key}`);
  } catch {
    errors.push(`${chain.key}:tokens`);
  }
  // Activity
  try {
    const data = (await fetchJson(
      `${bs}/api/v2/addresses/${address}/transactions`,
      undefined,
      chain.timeoutMs,
    )) as { items?: unknown[] };
    for (const raw of data.items ?? []) {
      const tx = raw as {
        hash?: string;
        timestamp?: string;
        value?: string;
        from?: { hash?: string };
        to?: { hash?: string };
        token_transfers?: Array<{
          token?: { symbol?: string; decimals?: string | null };
          total?: { value?: string };
        }>;
      };
      if (!tx.hash) continue;
      const from = (tx.from?.hash ?? "").toLowerCase();
      const to = (tx.to?.hash ?? "").toLowerCase();
      const me = address.toLowerCase();
      const direction: ActRow["direction"] = from === me && to === me ? "self" : from === me ? "out" : "in";
      let symbol = chain.nativeSymbol;
      let amount = formatUnits(hexToBigInt("0x" + BigInt(tx.value ?? "0").toString(16)), chain.nativeDecimals);
      const tt = tx.token_transfers?.[0];
      if ((tx.value ?? "0") === "0" && tt?.token?.symbol && tt.total?.value) {
        symbol = tt.token.symbol;
        amount = formatUnits(BigInt(tt.total.value), Number(tt.token.decimals ?? 18));
      }
      acts.push({
        walletKey,
        chainKey: chain.key,
        txHash: tx.hash,
        direction,
        symbol,
        amount,
        counterparty: direction === "out" ? (tx.to?.hash ?? null) : (tx.from?.hash ?? null),
        ts: tx.timestamp ? Date.parse(tx.timestamp) : Date.now(),
        explorerUrl: `${chain.explorer}/tx/${tx.hash}`,
      });
    }
  } catch {
    errors.push(`${chain.key}:activity`);
  }
}

// ---------------------------------------------------------------- BTC

async function syncBtc(
  walletKey: string,
  chainKey: string,
  address: string,
  base: string,
  bals: Map<string, BalRow>,
  acts: ActRow[],
): Promise<void> {
  const data = (await fetchJson(`${base}/api/address/${address}`, undefined, 12000)) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const stats = data.chain_stats ?? {};
  const sats = BigInt((stats.funded_txo_sum ?? 0) - (stats.spent_txo_sum ?? 0));
  bals.set(balKey({ walletKey, chainKey, assetKey: "native" } as BalRow), {
    walletKey,
    chainKey,
    assetKey: "native",
    symbol: "BTC",
    kind: "native",
    contract: null,
    balance: formatUnits(sats, 8),
    decimals: 8,
  });
  try {
    const txs = (await fetchJson(`${base}/api/address/${address}/txs`, undefined, 12000)) as Array<{
      txid?: string;
      status?: { block_time?: number; confirmed?: boolean };
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
        walletKey,
        chainKey,
        txHash: tx.txid,
        direction: net > 0 ? "in" : net < 0 ? "out" : "self",
        symbol: "BTC",
        amount: formatUnits(BigInt(Math.abs(net)), 8),
        counterparty: null,
        ts: tx.status?.block_time ? tx.status.block_time * 1000 : Date.now(),
        explorerUrl: `${base}/tx/${tx.txid}`,
      });
    }
  } catch {
    /* activity is best-effort */
  }
}

// ---------------------------------------------------------------- Solana

async function syncSolana(
  walletKey: string,
  chainKey: string,
  address: string,
  rpcs: string[],
  explorerSuffix: string,
  bals: Map<string, BalRow>,
  acts: ActRow[],
  errors: string[],
): Promise<void> {
  const bal = (await rpcCall(rpcs, "getBalance", [address], 12000)) as { value?: number };
  bals.set(balKey({ walletKey, chainKey, assetKey: "native" } as BalRow), {
    walletKey,
    chainKey,
    assetKey: "native",
    symbol: "SOL",
    kind: "native",
    contract: null,
    balance: formatUnits(BigInt(bal.value ?? 0), 9),
    decimals: 9,
  });
  try {
    const res = (await rpcCall(
      rpcs,
      "getTokenAccountsByOwner",
      [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }],
      12000,
    )) as {
      value?: Array<{
        account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmountString?: string; decimals?: number } } } } };
      }>;
    };
    for (const entry of res.value ?? []) {
      const info = entry.account?.data?.parsed?.info;
      if (!info?.mint || !info.tokenAmount) continue;
      const amt = info.tokenAmount.uiAmountString ?? "0";
      if (amt === "0") continue;
      bals.set(
        balKey({ walletKey, chainKey, assetKey: info.mint } as BalRow),
        {
          walletKey,
          chainKey,
          assetKey: info.mint,
          symbol: `SPL ${info.mint.slice(0, 4)}…${info.mint.slice(-4)}`,
          kind: "token",
          contract: info.mint,
          balance: amt,
          decimals: info.tokenAmount.decimals ?? 0,
        },
      );
    }
  } catch {
    errors.push(`${chainKey}:spl`);
  }
  try {
    const sigs = (await rpcCall(rpcs, "getSignaturesForAddress", [address, { limit: 8 }], 12000)) as Array<{
      signature?: string;
      blockTime?: number;
    }>;
    for (const s of sigs) {
      if (!s.signature) continue;
      let amount = "0";
      let direction: ActRow["direction"] = "in";
      try {
        const tx = (await rpcCall(
          rpcs,
          "getParsedTransaction",
          [s.signature, { maxSupportedTransactionVersion: 0 }],
          12000,
        )) as {
          meta?: { preBalances?: number[]; postBalances?: number[] };
          transaction?: { message?: { accountKeys?: Array<{ pubkey?: string }> } };
        } | null;
        const keys = tx?.transaction?.message?.accountKeys ?? [];
        const idx = keys.findIndex((k) => k.pubkey === address);
        if (idx >= 0 && tx?.meta?.preBalances && tx?.meta?.postBalances) {
          const delta = BigInt(tx.meta.postBalances[idx] ?? 0) - BigInt(tx.meta.preBalances[idx] ?? 0);
          direction = delta >= 0n ? "in" : "out";
          amount = formatUnits(delta < 0n ? -delta : delta, 9);
        }
      } catch {
        /* keep the row with unknown amount */
      }
      acts.push({
        walletKey,
        chainKey,
        txHash: s.signature,
        direction,
        symbol: "SOL",
        amount,
        counterparty: null,
        ts: s.blockTime ? s.blockTime * 1000 : Date.now(),
        explorerUrl: `https://explorer.solana.com/tx/${s.signature}${explorerSuffix}`,
      });
    }
  } catch {
    errors.push(`${chainKey}:activity`);
  }
}

// ---------------------------------------------------------------- TRON

const TRON_USDT_MAINNET = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

async function syncTron(
  walletKey: string,
  chainKey: string,
  address: string,
  gridBase: string,
  scanBase: string,
  scanWeb: string,
  bals: Map<string, BalRow>,
  acts: ActRow[],
  errors: string[],
): Promise<void> {
  const acct = (await fetchJson(
    `${gridBase}/wallet/getaccount`,
    { method: "POST", body: JSON.stringify({ address, visible: true }) },
    12000,
  )) as { balance?: number; trc20?: Array<Record<string, string>> };
  bals.set(balKey({ walletKey, chainKey, assetKey: "native" } as BalRow), {
    walletKey,
    chainKey,
    assetKey: "native",
    symbol: "TRX",
    kind: "native",
    contract: null,
    balance: formatUnits(BigInt(acct.balance ?? 0), 6),
    decimals: 6,
  });
  const mainnet = chainKey === "tron";
  if (mainnet) {
    // Tronscan's mainnet API now requires a key (401) — use trongrid's
    // account trc20 array instead. Only the well-known USDT contract is
    // named; anything else is shown generically.
    for (const entry of acct.trc20 ?? []) {
      for (const [contract, rawStr] of Object.entries(entry)) {
        let raw = 0n;
        try {
          raw = BigInt(rawStr);
        } catch {
          continue;
        }
        if (raw === 0n) continue;
        const isUsdt = contract === TRON_USDT_MAINNET;
        bals.set(balKey({ walletKey, chainKey, assetKey: contract } as BalRow), {
          walletKey,
          chainKey,
          assetKey: contract,
          symbol: isUsdt ? "USDT" : `TRC20 ${contract.slice(0, 4)}…${contract.slice(-4)}`,
          kind: "token",
          contract,
          balance: formatUnits(raw, isUsdt ? 6 : 6),
          decimals: 6,
        });
      }
    }
    try {
      const data = (await fetchJson(
        `${gridBase}/v1/accounts/${address}/transactions/trc20?limit=20`,
        undefined,
        12000,
      )) as {
        data?: Array<{
          transaction_id?: string;
          block_timestamp?: number;
          from?: string;
          to?: string;
          value?: string;
          token_info?: { symbol?: string; decimals?: number };
        }>;
      };
      for (const t of data.data ?? []) {
        if (!t.transaction_id) continue;
        let raw = 0n;
        try {
          raw = BigInt(t.value ?? "0");
        } catch {
          /* keep 0 */
        }
        acts.push({
          walletKey,
          chainKey,
          txHash: t.transaction_id,
          direction: t.from === address ? "out" : "in",
          symbol: t.token_info?.symbol ?? "TRC20",
          amount: formatUnits(raw, t.token_info?.decimals ?? 6),
          counterparty: t.from === address ? (t.to ?? null) : (t.from ?? null),
          ts: t.block_timestamp ?? Date.now(),
          explorerUrl: `${scanWeb}/#/transaction/${t.transaction_id}`,
        });
      }
    } catch {
      errors.push(`${chainKey}:activity`);
    }
    return;
  }
  // Nile via Tronscan (works without a key there)
  try {
    const data = (await fetchJson(
      `${scanBase}/api/account/tokens?address=${address}&start=0&limit=30`,
      undefined,
      12000,
    )) as {
      data?: Array<{
        tokenId?: string;
        tokenName?: string;
        tokenAbbr?: string;
        balance?: string;
        tokenDecimal?: number;
      }>;
    };
    for (const t of data.data ?? []) {
      if (!t.tokenId || t.tokenId === "_") continue;
      const raw = (() => {
        try {
          return BigInt(t.balance ?? "0");
        } catch {
          return 0n;
        }
      })();
      if (raw === 0n) continue;
      const kind =
        QUARANTINE_SYMBOLS.has(t.tokenAbbr ?? "") || isQuarantineName(t.tokenName ?? "")
          ? "quarantine"
          : "token";
      bals.set(balKey({ walletKey, chainKey, assetKey: t.tokenId } as BalRow), {
        walletKey,
        chainKey,
        assetKey: t.tokenId,
        symbol: t.tokenAbbr ?? "?",
        kind,
        contract: t.tokenId,
        balance: formatUnits(raw, t.tokenDecimal ?? 6),
        decimals: t.tokenDecimal ?? 6,
      });
    }
  } catch {
    errors.push(`${chainKey}:tokens`);
  }
  try {
    const data = (await fetchJson(
      `${scanBase}/api/token_trc20/transfers?address=${address}&start=0&limit=10`,
      undefined,
      12000,
    )) as {
      token_transfers?: Array<{
        transaction_id?: string;
        from_address?: string;
        to_address?: string;
        quant?: string;
        block_ts?: number;
        tokenInfo?: { tokenAbbr?: string; tokenDecimal?: number };
      }>;
    };
    for (const t of data.token_transfers ?? []) {
      if (!t.transaction_id) continue;
      const raw = (() => {
        try {
          return BigInt(t.quant ?? "0");
        } catch {
          return 0n;
        }
      })();
      acts.push({
        walletKey,
        chainKey,
        txHash: t.transaction_id,
        direction: t.from_address === address ? "out" : "in",
        symbol: t.tokenInfo?.tokenAbbr ?? "TRC20",
        amount: formatUnits(raw, t.tokenInfo?.tokenDecimal ?? 6),
        counterparty: t.from_address === address ? (t.to_address ?? null) : (t.from_address ?? null),
        ts: t.block_ts ?? Date.now(),
        explorerUrl: `${scanWeb}/transaction/${t.transaction_id}`,
      });
    }
  } catch {
    errors.push(`${chainKey}:activity`);
  }
}

// ---------------------------------------------------------------- run

export async function runSync(ctx: Ctx): Promise<{ ok: number; failed: number; detail: string }> {
  const db = getDb(ctx);
  const bals = new Map<string, BalRow>();
  const acts: ActRow[] = [];
  const errors: string[] = [];
  let ok = 0;
  let failed = 0;
  const guard = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
      ok++;
    } catch {
      failed++;
      errors.push(label);
    }
  };

  // Burner: every EVM chain
  for (const chain of EVM_CHAINS) {
    await guard(`burner:${chain.key}`, () =>
      syncEvmChain(chain, "burner", BURNER.evm, bals, acts, errors),
    );
  }
  // Circle: Arc testnet + Arc mainnet only
  for (const [key, address] of [
    ["arc-testnet", CIRCLE.testnet],
    ["arc-mainnet", CIRCLE.mainnet],
  ] as const) {
    const chain = EVM_CHAINS.find((c) => c.key === key);
    if (!chain) continue;
    await guard(`circle:${key}`, () => syncEvmChain(chain, "circle", address, bals, acts, errors));
  }
  await guard("burner:bitcoin", () =>
    syncBtc("burner", "bitcoin", BURNER.btc, "https://mempool.space", bals, acts),
  );
  await guard("burner:bitcoin-testnet4", () =>
    syncBtc("burner", "bitcoin-testnet4", BURNER.btcTestnet4, "https://mempool.space/testnet4", bals, acts),
  );
  await guard("burner:solana", () =>
    syncSolana("burner", "solana", BURNER.sol, ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"], "", bals, acts, errors),
  );
  await guard("burner:solana-devnet", () =>
    syncSolana("burner", "solana-devnet", BURNER.sol, ["https://api.devnet.solana.com"], "?cluster=devnet", bals, acts, errors),
  );
  await guard("burner:tron", () =>
    syncTron("burner", "tron", BURNER.tron, "https://api.trongrid.io", "https://apilist.tronscanapi.com", "https://tronscan.org", bals, acts, errors),
  );
  await guard("burner:tron-nile", () =>
    syncTron("burner", "tron-nile", BURNER.tron, "https://nile.trongrid.io", "https://nileapi.tronscan.org", "https://nile.tronscan.org", bals, acts, errors),
  );

  const now = Date.now();
  const statements: BatchItem<"sqlite">[] = [];
  for (const r of bals.values()) {
    statements.push(
      db
        .insert(schema.balanceSnapshots)
        .values({
          walletKey: r.walletKey,
          chainKey: r.chainKey,
          assetKey: r.assetKey,
          symbol: r.symbol,
          kind: r.kind,
          contract: r.contract,
          balance: r.balance,
          decimals: r.decimals,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.balanceSnapshots.walletKey,
            schema.balanceSnapshots.chainKey,
            schema.balanceSnapshots.assetKey,
          ],
          set: {
            symbol: r.symbol,
            kind: r.kind,
            contract: r.contract,
            balance: r.balance,
            decimals: r.decimals,
            updatedAt: now,
          },
        }),
    );
  }
  for (const a of acts) {
    statements.push(
      db
        .insert(schema.activityItems)
        .values({
          walletKey: a.walletKey,
          chainKey: a.chainKey,
          txHash: a.txHash,
          direction: a.direction,
          symbol: a.symbol,
          amount: a.amount,
          counterparty: a.counterparty,
          ts: a.ts,
          explorerUrl: a.explorerUrl,
        })
        .onConflictDoNothing(),
    );
  }
  const detail = errors.length ? `partial: ${errors.slice(0, 12).join(", ")}` : "all sources ok";
  statements.push(
    db
      .insert(schema.syncState)
      .values({ id: 1, lastRunAt: now, status: failed === 0 ? "ok" : "partial", detail })
      .onConflictDoUpdate({
        target: schema.syncState.id,
        set: { lastRunAt: now, status: failed === 0 ? "ok" : "partial", detail },
      }),
  );
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);

  // Prune stale discovered rows: when Blockscout discovery succeeded for a
  // wallet+chain, any non-native row not refreshed this run no longer exists.
  for (const pair of discoveryOk) {
    const [walletKey = "", chainKey = ""] = pair.split("|");
    await db
      .delete(schema.balanceSnapshots)
      .where(
        and(
          eq(schema.balanceSnapshots.walletKey, walletKey),
          eq(schema.balanceSnapshots.chainKey, chainKey),
          lt(schema.balanceSnapshots.updatedAt, now),
        ),
      );
  }
  discoveryOk.clear();

  // Prune activity to the newest 25 per wallet+chain.
  const pairs = new Set(acts.map((a) => `${a.walletKey}|${a.chainKey}`));
  for (const pair of pairs) {
    const [walletKey = "", chainKey = ""] = pair.split("|");
    const rows = await db
      .select({ id: schema.activityItems.id })
      .from(schema.activityItems)
      .where(
        and(
          eq(schema.activityItems.walletKey, walletKey),
          eq(schema.activityItems.chainKey, chainKey),
        ),
      )
      .orderBy(desc(schema.activityItems.ts));
    const extra = rows.slice(25).map((r) => r.id);
    if (extra.length) {
      await db.delete(schema.activityItems).where(inArray(schema.activityItems.id, extra));
    }
  }

  return { ok, failed, detail };
}
