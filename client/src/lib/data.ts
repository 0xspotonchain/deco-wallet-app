// Wallet data hook: merges the server's background-synced snapshot with
// live in-browser reads (on open + every 60s). Imported wallets are read
// live only — the server never learns their addresses from the vault.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
BURNER_ADDRESSES,
CHAINS,
CIRCLE_ADDRESSES,
type ChainCfg,
} from "./chains";
import { fetchWalletLive, type LiveActivity, type LiveBalance } from "./live";
import { customTokenStore, listCustomTokens } from "./customTokens";
import { listWalletMetas } from "./vault";
import type { ApiResponse } from "../api";
import type { api } from "../api";

export type WalletRef =
  | { type: "burner" }
  | { type: "circle" }
  | { type: "imported"; id: string };

export function walletRefKey(ref: WalletRef): string {
  return ref.type === "imported" ? `imported:${ref.id}` : ref.type;
}

export function walletLabel(ref: WalletRef): string {
  if (ref.type === "burner") return "Burner";
  if (ref.type === "circle") return "Circle";
  return listWalletMetas().find((w) => w.id === ref.id)?.label ?? "Imported wallet";
}

export function walletAddresses(ref: WalletRef): Partial<Record<string, string>> {
  if (ref.type === "burner") return { ...BURNER_ADDRESSES };
  if (ref.type === "circle") return {}; // handled per-chain below
  return listWalletMetas().find((w) => w.id === ref.id)?.addresses ?? {};
}

type Portfolio = ApiResponse<typeof api, "getPortfolio">;

export interface WalletData {
  balances: LiveBalance[];
  activity: LiveActivity[];
  liveAt: number | null;
  loadingLive: boolean;
  refresh: () => void;
}

export function useWalletData(ref: WalletRef, portfolio: Portfolio | undefined): WalletData {
  const [live, setLive] = useState<{ balances: LiveBalance[]; activity: LiveActivity[]; at: number } | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [customVersion, setCustomVersion] = useState(0);
  const inFlight = useRef(false);
  const refKey = walletRefKey(ref);

  // Re-read live balances whenever this wallet's custom token imports change.
  useEffect(() => customTokenStore.subscribe(() => setCustomVersion(customTokenStore.version())), []);

  const runLive = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoadingLive(true);
    try {
      const customTokens = listCustomTokens(refKey);
      if (ref.type === "circle") {
        const results = await Promise.all(
          Object.entries(CIRCLE_ADDRESSES).map(([chainKey, address]) => {
            const chain = CHAINS.find((c) => c.key === chainKey);
            return chain ? fetchWalletLive({ evm: address }, [chain], customTokens) : Promise.resolve(null);
          }),
        );
        const balances = results.flatMap((r) => r?.balances ?? []);
        const activity = results.flatMap((r) => r?.activity ?? []).sort((a, b) => b.ts - a.ts);
        setLive({ balances, activity, at: Date.now() });
      } else {
        const addresses = walletAddresses(ref);
        if (Object.keys(addresses).length > 0) {
          const result = await fetchWalletLive(addresses, CHAINS, customTokens);
          setLive({ balances: result.balances, activity: result.activity, at: result.fetchedAt });
        }
      }
    } catch {
      /* keep previous data; the snapshot still shows */
    } finally {
      inFlight.current = false;
      setLoadingLive(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey, customVersion]);

  useEffect(() => {
    setLive(null);
    void runLive();
    const t = window.setInterval(() => void runLive(), 60000);
    return () => window.clearInterval(t);
  }, [runLive]);

  const merged = useMemo(() => {
    const balMap = new Map<string, LiveBalance>();
    const actMap = new Map<string, LiveActivity>();
    if (ref.type !== "imported" && portfolio) {
      const snap = portfolio.wallets.find((w) => w.key === ref.type);
      for (const b of snap?.balances ?? []) {
        balMap.set(`${b.chainKey}|${b.assetKey}`, {
          chainKey: b.chainKey, assetKey: b.assetKey, symbol: b.symbol, kind: b.kind,
          contract: b.contract, balance: b.balance, decimals: b.decimals,
        });
      }
      for (const a of snap?.activity ?? []) {
        actMap.set(`${a.chainKey}|${a.txHash}`, a);
      }
    }
    for (const b of live?.balances ?? []) balMap.set(`${b.chainKey}|${b.assetKey}`, b);
    for (const a of live?.activity ?? []) actMap.set(`${a.chainKey}|${a.txHash}`, a);
    const balances = [...balMap.values()];
    const activity = [...actMap.values()].sort((a, b) => b.ts - a.ts).slice(0, 60);
    return { balances, activity };
  }, [portfolio, live, ref]);

  return {
    balances: merged.balances,
    activity: merged.activity,
    liveAt: live?.at ?? null,
    loadingLive,
    refresh: () => void runLive(),
  };
}

export function chainsForNetwork(network: "mainnet" | "testnet"): ChainCfg[] {
  return CHAINS.filter((c) => c.network === network);
}
