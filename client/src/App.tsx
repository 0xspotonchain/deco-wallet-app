import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useWalletData, walletLabel, type WalletRef } from "./lib/data";
import { listWalletMetas, session } from "./lib/vault";
import { Portfolio, ReceiveSheet } from "./screens/Portfolio";
import { SendSheet } from "./screens/Send";
import { SwapScreen } from "./screens/Swap";
import { ActivityScreen } from "./screens/Activity";
import { WalletsScreen } from "./screens/Wallets";
import { timeAgo } from "./components/ui";

type Tab = "wallet" | "swap" | "activity" | "wallets";
type Network = "mainnet" | "testnet";

function useVaultVersion(): number {
  return useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => listWalletMetas().length * 10 + (session.unlocked ? 1 : 0),
    () => 0,
  );
}

export function App() {
  const [network, setNetwork] = useState<Network>("testnet");
  const [tab, setTab] = useState<Tab>("wallet");
  const [walletRef, setWalletRef] = useState<WalletRef>({ type: "burner" });
  const [sheet, setSheet] = useState<"send" | "receive" | null>(null);
  useVaultVersion();
  const metas = listWalletMetas();

  const portfolioQuery = useQuery({
    queryKey: ["portfolio"],
    queryFn: async () => await api.getPortfolio({}),
    refetchInterval: 60000,
  });
  const syncMutation = useMutation({
    mutationFn: async () => await api.syncNow({}),
    onSuccess: () => void portfolioQuery.refetch(),
  });

  // Fall back to the burner if the selected imported wallet was removed.
  const effectiveRef: WalletRef =
    walletRef.type === "imported" && !metas.find((m) => m.id === walletRef.id)
      ? { type: "burner" }
      : walletRef;

  const data = useWalletData(effectiveRef, portfolioQuery.data);

  // Auto-lock timer resets on interaction.
  useEffect(() => {
    const touch = () => session.touch();
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, []);

  const sync = portfolioQuery.data?.sync;
  const tabs: Array<{ key: Tab; label: string; icon: string }> = [
    { key: "wallet", label: "Wallet", icon: "▦" },
    { key: "swap", label: "Swap", icon: "⇄" },
    { key: "activity", label: "Activity", icon: "≣" },
    { key: "wallets", label: "Wallets", icon: "⚿" },
  ];

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 pb-28 pt-4">
      {/* Wallet selector */}
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Select wallet">
        {(
          [
            { ref: { type: "burner" } as WalletRef, label: "Burner" },
            { ref: { type: "circle" } as WalletRef, label: "Circle" },
            ...metas.map((m) => ({ ref: { type: "imported", id: m.id } as WalletRef, label: m.label })),
          ]
        ).map((w) => {
          const active =
            (w.ref.type === effectiveRef.type && w.ref.type !== "imported") ||
            (w.ref.type === "imported" && effectiveRef.type === "imported" && w.ref.id === effectiveRef.id);
          return (
            <button
              key={w.label + (w.ref.type === "imported" ? w.ref.id : "")}
              role="tab"
              aria-selected={active}
              onClick={() => setWalletRef(w.ref)}
              className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold"
              style={{
                background: active ? "var(--accent)" : "var(--surface)",
                color: active ? "#1a1405" : "var(--text)",
                border: "1px solid var(--border)",
              }}
            >
              {w.label}
              {w.ref.type === "circle" && <span className="ml-1 text-xs opacity-70">RO</span>}
            </button>
          );
        })}
      </div>

      {/* Network switch */}
      <div
        className="mt-3 grid grid-cols-2 gap-1 rounded-2xl p-1"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="tablist"
        aria-label="Select network"
      >
        {(["testnet", "mainnet"] as Network[]).map((n) => (
          <button
            key={n}
            role="tab"
            aria-selected={network === n}
            onClick={() => setNetwork(n)}
            className="rounded-xl py-2.5 font-semibold capitalize"
            style={{
              background: network === n ? (n === "testnet" ? "var(--amber)" : "var(--green)") : "transparent",
              color: network === n ? "#14100a" : "var(--dim)",
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-xs" style={{ color: network === "testnet" ? "var(--amber)" : "var(--green)" }}>
        {network === "testnet"
          ? "Testnet — play money, no real funds at risk"
          : "Mainnet — real funds. Every send and swap asks you to confirm."}
      </p>

      {/* Sync status */}
      <div className="mt-3 flex items-center justify-between text-xs" style={{ color: "var(--dim)" }}>
        <span>
          {walletLabel(effectiveRef)} ·{" "}
          {sync?.lastRunAt
            ? `background sync ${timeAgo(sync.lastRunAt)}${sync.status !== "ok" ? " (partial)" : ""}`
            : "background sync pending"}
          {data.liveAt ? ` · live ${timeAgo(data.liveAt)}` : ""}
          {data.loadingLive ? " · refreshing…" : ""}
        </span>
        <button
          onClick={() => {
            syncMutation.mutate();
            data.refresh();
          }}
          disabled={syncMutation.isPending}
          className="shrink-0 rounded-lg px-3 py-1.5 font-medium"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
          aria-label="Sync balances now"
        >
          {syncMutation.isPending ? "Syncing…" : "↻ Sync"}
        </button>
      </div>

      {/* Screens */}
      <main className="mt-4">
        {tab === "wallet" && (
          <Portfolio
            data={data}
            network={network}
            walletRef={effectiveRef}
            onSend={() => setSheet("send")}
            onReceive={() => setSheet("receive")}
          />
        )}
        {tab === "swap" && (
          <SwapScreen
            walletRef={effectiveRef}
            data={data}
            network={network}
            onGoWallets={() => setTab("wallets")}
          />
        )}
        {tab === "activity" && <ActivityScreen data={data} network={network} />}
        {tab === "wallets" && (
          <WalletsScreen
            onSelectImported={(id) => {
              setWalletRef({ type: "imported", id });
              setTab("wallet");
            }}
          />
        )}
      </main>

      {/* Bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-2xl grid-cols-4 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2"
        style={{ background: "rgba(10,10,15,.92)", borderTop: "1px solid var(--border)", backdropFilter: "blur(8px)" }}
        aria-label="Main navigation"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            data-tab={t.key}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className="flex flex-col items-center gap-0.5 rounded-xl py-1.5"
            style={{ color: tab === t.key ? "var(--accent)" : "var(--dim)" }}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            <span className="text-xs font-medium">{t.label}</span>
          </button>
        ))}
      </nav>

      {sheet === "send" && (
        <SendSheet
          walletRef={effectiveRef}
          data={data}
          network={network}
          onClose={() => setSheet(null)}
          onGoWallets={() => {
            setSheet(null);
            setTab("wallets");
          }}
        />
      )}
      {sheet === "receive" && (
        <ReceiveSheet walletRef={effectiveRef} network={network} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
