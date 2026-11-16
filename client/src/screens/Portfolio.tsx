import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
CHAINS,
CIRCLE_ADDRESSES,
addressForChain,
addressUrl,
type ChainCfg,
} from "../lib/chains";
import type { WalletData, WalletRef } from "../lib/data";
import { walletAddresses } from "../lib/data";
import type { LiveBalance } from "../lib/live";
import { ChainName, Sheet, shortAddress } from "../components/ui";
import { ImportTokenSheet } from "./ImportToken";

const BRAND_SYMBOLS = new Set(["DECO", "DM", "USDC", "EURC", "VELA"]);

export function visibleBalances(balances: LiveBalance[], chainKey: string): LiveBalance[] {
  return balances
    .filter((b) => b.chainKey === chainKey && b.kind !== "quarantine")
    .filter((b) => b.kind === "native" || b.kind === "nft" || b.custom || b.balance !== "0" || BRAND_SYMBOLS.has(b.symbol))
    .sort((a, b) => {
      const rank = (x: LiveBalance) => (x.kind === "native" ? 0 : x.kind === "token" ? 1 : 2);
      return rank(a) - rank(b) || a.symbol.localeCompare(b.symbol);
    });
}

export function walletChains(ref: WalletRef, network: "mainnet" | "testnet"): ChainCfg[] {
  if (ref.type === "circle") {
    return CHAINS.filter((c) => c.network === network && CIRCLE_ADDRESSES[c.key]);
  }
  const addresses = walletAddresses(ref);
  return CHAINS.filter((c) => c.network === network && addressForChain(addresses, c));
}

export function Portfolio({
  data,
  network,
  walletRef,
  onSend,
  onReceive,
}: {
  data: WalletData;
  network: "mainnet" | "testnet";
  walletRef: WalletRef;
  onSend: () => void;
  onReceive: () => void;
}) {
  const chains = walletChains(walletRef, network);
  const quarantine = data.balances.filter((b) => b.kind === "quarantine" && b.balance !== "0");
  const canTransact = walletRef.type === "imported";
  const [showImport, setShowImport] = useState(false);

  return (
    <div>
      <div className="mb-5 grid grid-cols-3 gap-2">
        <button
          onClick={onSend}
          className="rounded-xl py-3 font-semibold"
          style={{ background: "var(--accent)", color: "#1a1405" }}
        >
          ↑ Send
        </button>
        <button
          onClick={onReceive}
          className="rounded-xl py-3 font-semibold"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >
          ↓ Receive
        </button>
        <a
          href="#swap"
          onClick={(e) => {
            e.preventDefault();
            document.querySelector<HTMLButtonElement>("[data-tab='swap']")?.click();
          }}
          className="flex items-center justify-center rounded-xl py-3 font-semibold"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >
          ⇄ Swap
        </a>
      </div>

      <button
        onClick={() => setShowImport(true)}
        className="mb-5 w-full rounded-xl py-2.5 text-sm font-medium"
        style={{ background: "var(--surface)", border: "1px dashed var(--border)", color: "var(--text)" }}
      >
        ＋ Import token by contract address (CA)
      </button>
      {showImport && (
        <ImportTokenSheet walletRef={walletRef} network={network} onClose={() => setShowImport(false)} />
      )}

      {walletRef.type === "circle" && (
        <p className="mb-4 rounded-xl p-3 text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--dim)" }}>
          Circle is a smart-contract agent wallet — balances only. Muse's automation operates it; there is no seed to import.
        </p>
      )}
      {walletRef.type === "burner" && (
        <p className="mb-4 rounded-xl p-3 text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--dim)" }}>
          View-only here. To send or swap with the burner, import its seed from your own backup in the Wallets tab — the app never reads the VM keystore.
        </p>
      )}
      {canTransact && (
        <p className="mb-4 text-sm" style={{ color: "var(--dim)" }}>
          Imported wallet — sending and swapping sign locally on this device.
        </p>
      )}

      {chains.length === 0 && (
        <p className="py-10 text-center" style={{ color: "var(--dim)" }}>
          This wallet has no {network} chains.
        </p>
      )}

      <div className="space-y-3">
        {chains.map((chain) => {
          const rows = visibleBalances(data.balances, chain.key);
          const address = walletRef.type === "circle"
            ? CIRCLE_ADDRESSES[chain.key]
            : addressForChain(walletAddresses(walletRef), chain);
          return (
            <section key={chain.key} className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="mb-2 flex items-center justify-between">
                <ChainName chain={chain} />
                {address && (
                  <a
                    href={addressUrl(chain, address)}
                    target="_blank"
                    rel="noreferrer"
                    className="mono text-xs"
                    style={{ color: "var(--dim)" }}
                    aria-label={`View ${chain.name} address on explorer`}
                  >
                    {shortAddress(address)} ↗
                  </a>
                )}
              </div>
              {rows.length === 0 && (
                <p className="py-1 text-sm" style={{ color: "var(--dim)" }}>
                  {data.loadingLive ? "Loading…" : "No balance"}
                </p>
              )}
              {rows.map((b) => (
                <div key={b.assetKey} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{
                        background: b.symbol === "DECO" || b.symbol === "DM" ? "var(--accent)" : "var(--surface-2)",
                        color: b.symbol === "DECO" || b.symbol === "DM" ? "#1a1405" : "var(--dim)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {b.kind === "nft" ? "NFT" : b.symbol.slice(0, 4)}
                    </span>
                    <span className="text-sm">{b.symbol}</span>
                    {b.custom && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{ background: "rgba(240,177,62,.15)", color: "var(--accent)" }}
                      >
                        custom
                      </span>
                    )}
                  </span>
                  <span className="mono text-[15px]">{b.balance}</span>
                </div>
              ))}
            </section>
          );
        })}
      </div>

      {quarantine.length > 0 && (
        <section className="mt-5 rounded-2xl p-4" style={{ background: "rgba(216,74,74,.06)", border: "1px solid rgba(216,74,74,.35)" }}>
          <h3 className="mb-1 text-sm font-semibold" style={{ color: "var(--red)" }}>
            Quarantined — unknown tokens
          </h3>
          <p className="mb-2 text-xs" style={{ color: "var(--dim)" }}>
            Airdropped by third parties. Display only — never interact with these.
          </p>
          {quarantine.map((b) => {
            const chain = CHAINS.find((c) => c.key === b.chainKey);
            return (
              <div key={`${b.chainKey}|${b.assetKey}`} className="flex items-baseline justify-between py-1">
                <span className="text-sm">
                  {b.symbol} <span style={{ color: "var(--dim)" }}>· {chain?.name ?? b.chainKey}</span>
                </span>
                <span className="mono text-sm">{b.balance}</span>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------ Receive

export function ReceiveSheet({
  walletRef,
  network,
  onClose,
}: {
  walletRef: WalletRef;
  network: "mainnet" | "testnet";
  onClose: () => void;
}) {
  const chains = useMemo(() => walletChains(walletRef, network), [walletRef, network]);
  const [chainKey, setChainKey] = useState<string>(chains[0]?.key ?? "");
  const chain = chains.find((c) => c.key === chainKey) ?? chains[0];
  const address = chain
    ? walletRef.type === "circle"
      ? CIRCLE_ADDRESSES[chain.key]
      : addressForChain(walletAddresses(walletRef), chain)
    : undefined;
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!address) return;
    QRCode.toDataURL(address, { width: 480, margin: 2, color: { dark: "#0a0a0f", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [address]);

  useEffect(() => {
    if (chains.length && !chains.find((c) => c.key === chainKey)) setChainKey(chains[0]?.key ?? "");
  }, [chains, chainKey]);

  return (
    <Sheet title="Receive" onClose={onClose}>
      <div className="mb-4 flex flex-wrap gap-2">
        {chains.map((c) => (
          <button
            key={c.key}
            onClick={() => setChainKey(c.key)}
            className="rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: chain?.key === c.key ? "var(--accent)" : "var(--surface-2)",
              color: chain?.key === c.key ? "#1a1405" : "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      {chain && address ? (
        <div className="flex flex-col items-center">
          {qr && <img src={qr} alt={`QR code for your ${chain.name} address`} className="w-56 rounded-xl" />}
          <p className="mono mt-4 break-all text-center text-sm">{address}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>
            {chain.name} · {chain.nativeSymbol} network — only send {chain.name} assets to this address
          </p>
          <button
            className="mt-4 w-full rounded-xl py-3 font-semibold"
            style={{ background: "var(--accent)", color: "#1a1405" }}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              } catch { /* clipboard unavailable */ }
            }}
          >
            {copied ? "Copied ✓" : "Copy address"}
          </button>
          <a
            href={addressUrl(chain, address)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 text-sm underline"
            style={{ color: "var(--dim)" }}
          >
            View on explorer ↗
          </a>
        </div>
      ) : (
        <p style={{ color: "var(--dim)" }}>No address on this network.</p>
      )}
    </Sheet>
  );
}
