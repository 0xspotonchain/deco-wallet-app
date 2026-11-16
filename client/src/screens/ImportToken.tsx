import { useMemo, useState, useSyncExternalStore } from "react";
import { chainByKey, type ChainCfg } from "../lib/chains";
import { walletRefKey, type WalletRef } from "../lib/data";
import {
addCustomToken,
customTokenStore,
listCustomTokens,
lookupTokenMeta,
removeCustomToken,
sameContract,
type TokenMeta,
} from "../lib/customTokens";
import { FieldLabel, GhostButton, PrimaryButton, Sheet, inputStyle, shortAddress } from "../components/ui";
import { walletChains } from "./Portfolio";

// Tokens the safety rules quarantine — importing them is refused outright.
const QUARANTINE_SYMBOLS = new Set(["BZND"]);
const isQuarantineName = (name: string) => name.toLowerCase().includes("tenergy");

export function ImportTokenSheet({
  walletRef,
  network,
  onClose,
}: {
  walletRef: WalletRef;
  network: "mainnet" | "testnet";
  onClose: () => void;
}) {
  const scope = walletRefKey(walletRef);
  useSyncExternalStore(
    (fn) => customTokenStore.subscribe(fn),
    () => customTokenStore.version(),
    () => 0,
  );
  const chains = useMemo(
    () => walletChains(walletRef, network).filter((c) => c.family !== "btc"),
    [walletRef, network],
  );
  const [chainKey, setChainKey] = useState("");
  const chain: ChainCfg | undefined = chains.find((c) => c.key === chainKey) ?? chains[0];
  const [ca, setCa] = useState("");
  const [phase, setPhase] = useState<"input" | "looking" | "confirm">("input");
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState("");

  const imported = listCustomTokens(scope);

  if (!chain) {
    return (
      <Sheet title="Import token" onClose={onClose}>
        <p style={{ color: "var(--dim)" }}>This wallet has no {network} chains that support token imports.</p>
      </Sheet>
    );
  }

  const placeholder =
    chain.family === "evm" ? "0x… contract address" : chain.family === "solana" ? "Mint address" : "T… contract address";

  const doLookup = async () => {
    setError("");
    const value = ca.trim();
    if (!value) {
      setError("Paste the token's contract address first.");
      return;
    }
    if (chain.tokens.some((t) => sameContract(chain, t.contract, value))) {
      setError(`${chain.name} already tracks that token by default — no import needed.`);
      return;
    }
    if (imported.some((t) => t.chainKey === chain.key && sameContract(chain, t.contract, value))) {
      setError("That token is already imported for this wallet.");
      return;
    }
    setPhase("looking");
    try {
      const found = await lookupTokenMeta(chain, value);
      if (QUARANTINE_SYMBOLS.has(found.symbol.toUpperCase()) || isQuarantineName(found.name)) {
        setError("That token is quarantined (flagged as an unknown third-party airdrop) — it stays display-only and can't be imported.");
        setPhase("input");
        return;
      }
      setMeta(found);
      setSymbol(found.symbol || value.slice(0, 4) + "…" + value.slice(-4));
      setPhase("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed — check the address and try again.");
      setPhase("input");
    }
  };

  const doAdd = () => {
    if (!meta) return;
    const sym = symbol.trim();
    if (!sym) {
      setError("Give the token a symbol label.");
      return;
    }
    if (QUARANTINE_SYMBOLS.has(sym.toUpperCase()) || isQuarantineName(sym)) {
      setError("That symbol is quarantined and can't be imported.");
      return;
    }
    addCustomToken(scope, {
      chainKey: chain.key,
      contract: ca.trim(),
      symbol: sym,
      name: meta.name || sym,
      decimals: meta.decimals,
      addedAt: Date.now(),
    });
    setCa("");
    setMeta(null);
    setSymbol("");
    setPhase("input");
    setError("");
  };

  return (
    <Sheet title="Import token by contract address" onClose={onClose}>
      <p className="text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
        Paste a token's contract address (CA) on any supported chain — EVM, Solana, or TRON.
        The app reads the token's real symbol and decimals from the chain, then tracks its
        balance for this wallet. Imports are stored on this device only.
      </p>

      <FieldLabel>Chain</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {chains.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setChainKey(c.key);
              setPhase("input");
              setMeta(null);
              setError("");
            }}
            className="rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: chain.key === c.key ? "var(--accent)" : "var(--surface-2)",
              color: chain.key === c.key ? "#1a1405" : "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            {c.name}
          </button>
        ))}
      </div>

      <FieldLabel>{chain.family === "solana" ? "Mint address (CA)" : "Contract address (CA)"}</FieldLabel>
      <input
        value={ca}
        onChange={(e) => {
          setCa(e.target.value);
          setPhase("input");
          setMeta(null);
        }}
        placeholder={placeholder}
        className="mono w-full rounded-xl px-3 py-2.5 text-sm"
        style={inputStyle}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Token contract address"
      />

      {phase === "confirm" && meta && (
        <div className="mt-4 rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt style={{ color: "var(--dim)" }}>Token</dt>
              <dd className="text-right">{meta.name || "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt style={{ color: "var(--dim)" }}>Decimals (on-chain)</dt>
              <dd className="mono">{meta.decimals}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt style={{ color: "var(--dim)" }}>Chain</dt>
              <dd>{chain.name}</dd>
            </div>
          </dl>
          <FieldLabel>Symbol</FieldLabel>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="mono w-full rounded-xl px-3 py-2.5 text-sm"
            style={inputStyle}
            autoComplete="off"
            autoCapitalize="characters"
            aria-label="Token symbol"
          />
          {chain.family === "solana" && (
            <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>
              SPL mints don't carry a symbol on-chain — label it yourself so you recognize it.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm" style={{ color: "var(--red)" }}>{error}</p>
      )}

      <div className="mt-5 space-y-2">
        {phase === "confirm" ? (
          <>
            <PrimaryButton onClick={doAdd}>Add token</PrimaryButton>
            <GhostButton
              onClick={() => {
                setPhase("input");
                setMeta(null);
              }}
            >
              Back
            </GhostButton>
          </>
        ) : (
          <PrimaryButton onClick={() => void doLookup()} disabled={phase === "looking"}>
            {phase === "looking" ? "Reading token from chain…" : "Look up token"}
          </PrimaryButton>
        )}
      </div>

      {imported.length > 0 && (
        <div className="mt-6">
          <FieldLabel>Imported for this wallet</FieldLabel>
          <div className="space-y-2">
            {imported.map((t) => {
              const tChain = chainByKey(t.chainKey);
              return (
                <div
                  key={`${t.chainKey}|${t.contract}`}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t.symbol} <span className="font-normal" style={{ color: "var(--dim)" }}>· {tChain?.name ?? t.chainKey}</span>
                    </p>
                    <p className="mono truncate text-xs" style={{ color: "var(--dim)" }}>
                      {shortAddress(t.contract)} · {t.decimals} decimals
                    </p>
                  </div>
                  <button
                    onClick={() => removeCustomToken(scope, t.chainKey, t.contract)}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium"
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--red)" }}
                    aria-label={`Remove imported token ${t.symbol} on ${tChain?.name ?? t.chainKey}`}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Sheet>
  );
}
