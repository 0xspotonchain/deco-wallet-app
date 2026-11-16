import type { ReactNode } from "react";
import type { ChainCfg } from "../lib/chains";

export function ChainName({ chain }: { chain: ChainCfg }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-medium">{chain.name}</span>
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
        style={{
          background: chain.network === "mainnet" ? "rgba(63,174,138,.15)" : "rgba(224,138,46,.15)",
          color: chain.network === "mainnet" ? "var(--green)" : "var(--amber)",
        }}
      >
        {chain.network}
      </span>
    </span>
  );
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl p-5 pb-8 sm:rounded-2xl"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="rounded-lg px-3 text-xl leading-none"
            style={{ background: "var(--surface-2)", color: "var(--dim)" }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl px-4 py-3 font-semibold disabled:opacity-40"
      style={{
        background: danger ? "var(--red)" : "var(--accent)",
        color: danger ? "#fff" : "#1a1405",
      }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl px-4 py-3 font-medium disabled:opacity-40"
      style={{ background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)" }}
    >
      {children}
    </button>
  );
}

export const inputStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
};

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--dim)" }}>
      {children}
    </div>
  );
}

export function shortAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
