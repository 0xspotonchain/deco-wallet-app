import { CHAINS } from "../lib/chains";
import type { WalletData } from "../lib/data";
import { shortAddress, timeAgo } from "../components/ui";

export function ActivityScreen({
  data,
  network,
}: {
  data: WalletData;
  network: "mainnet" | "testnet";
}) {
  const items = data.activity.filter((a) => {
    const chain = CHAINS.find((c) => c.key === a.chainKey);
    return chain?.network === network;
  });
  if (items.length === 0) {
    return (
      <p className="py-10 text-center" style={{ color: "var(--dim)" }}>
        No {network} activity yet. New transactions appear here after the next sync.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((a) => {
        const chain = CHAINS.find((c) => c.key === a.chainKey);
        const arrow = a.direction === "in" ? "↓" : a.direction === "out" ? "↑" : "⇄";
        const color = a.direction === "in" ? "var(--green)" : a.direction === "out" ? "var(--red)" : "var(--dim)";
        return (
          <a
            key={`${a.chainKey}|${a.txHash}`}
            href={a.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-2xl p-3"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            aria-label={`${a.direction === "in" ? "Received" : a.direction === "out" ? "Sent" : "Self transfer"} ${a.amount} ${a.symbol} on ${chain?.name ?? a.chainKey}, view on explorer`}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base"
              style={{ background: "var(--surface-2)", color, border: "1px solid var(--border)" }}
            >
              {arrow}
            </span>
            <span className="min-w-0 flex-1">
              <span className="mono block truncate text-sm">
                {a.direction === "out" ? "−" : a.direction === "in" ? "+" : ""}
                {a.amount} {a.symbol}
              </span>
              <span className="block truncate text-xs" style={{ color: "var(--dim)" }}>
                {chain?.name ?? a.chainKey}
                {a.counterparty ? ` · ${shortAddress(a.counterparty)}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-xs" style={{ color: "var(--dim)" }}>
              {timeAgo(a.ts)} ↗
            </span>
          </a>
        );
      })}
    </div>
  );
}
