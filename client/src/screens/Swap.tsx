import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
AMM_POOLS,
UNI_V3,
chainByKey,
txUrl,
type AmmPool,
} from "../lib/chains";
import type { WalletData, WalletRef } from "../lib/data";
import { walletRefKey } from "../lib/data";
import { customTokenStore, listCustomTokens } from "../lib/customTokens";
import { formatUnits, parseUnits } from "../lib/live";
import {
ammAmountOut,
ammReserves,
quoteUniV3,
swapAmm,
swapUniV3,
type TokenChoice,
type UniQuote,
} from "../lib/tx";
import { listWalletMetas, session } from "../lib/vault";
import { FieldLabel, GhostButton, PrimaryButton, inputStyle } from "../components/ui";

const SLIPPAGES = [0.5, 1, 3];

function SlippagePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs" style={{ color: "var(--dim)" }}>Slippage</span>
      {SLIPPAGES.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className="rounded-full px-3 py-1 text-sm"
          style={{
            background: value === s ? "var(--accent)" : "var(--surface-2)",
            color: value === s ? "#1a1405" : "var(--text)",
            border: "1px solid var(--border)",
          }}
        >
          {s}%
        </button>
      ))}
    </div>
  );
}

function useSwapWallet(walletRef: WalletRef) {
  const meta = walletRef.type === "imported" ? listWalletMetas().find((w) => w.id === walletRef.id) : undefined;
  const secret = walletRef.type === "imported" ? session.secretFor(walletRef.id) : null;
  return { meta, secret, ready: Boolean(meta && secret && meta.addresses.evm) };
}

function LockedNote({ onGoWallets }: { onGoWallets: () => void }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <p className="text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
        Swapping signs transactions locally, so it needs an imported EVM wallet with the vault
        unlocked. Import a seed or EVM private key in the Wallets tab — keys never leave this device.
      </p>
      <div className="mt-4">
        <PrimaryButton onClick={onGoWallets}>Go to Wallets</PrimaryButton>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ testnet AMM

function AmmSwap({ walletRef, data }: { walletRef: WalletRef; data: WalletData }) {
  const { meta, secret } = useSwapWallet(walletRef);
  const [poolKey, setPoolKey] = useState(AMM_POOLS[0]?.chainKey ?? "");
  const pool: AmmPool = AMM_POOLS.find((p) => p.chainKey === poolKey) ?? (AMM_POOLS[0] as AmmPool);
  const chain = chainByKey(pool.chainKey);
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [reserves, setReserves] = useState<{ deco: bigint; base: bigint } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneHash, setDoneHash] = useState("");

  useEffect(() => {
    setReserves(null);
    if (!chain) return;
    let cancelled = false;
    ammReserves(chain, pool)
      .then((r) => !cancelled && setReserves(r))
      .catch(() => !cancelled && setError("Couldn't load pool reserves"));
    return () => {
      cancelled = true;
    };
  }, [chain, pool]);

  const inSymbol = direction === "buy" ? pool.quoteSymbol : "DECO";
  const inDecimals = direction === "buy" ? pool.quoteDecimals : 18;
  const outSymbol = direction === "buy" ? "DECO" : pool.quoteSymbol;
  const outDecimals = direction === "buy" ? 18 : pool.quoteDecimals;

  let amountInRaw = 0n;
  try {
    amountInRaw = amount ? parseUnits(amount, inDecimals) : 0n;
  } catch {
    amountInRaw = 0n;
  }
  const amountOut = reserves
    ? direction === "buy"
      ? ammAmountOut(amountInRaw, reserves.base, reserves.deco)
      : ammAmountOut(amountInRaw, reserves.deco, reserves.base)
    : 0n;

  const balanceRow = data.balances.find(
    (b) =>
      b.chainKey === pool.chainKey &&
      (direction === "buy"
        ? pool.quoteContract
          ? b.contract?.toLowerCase() === pool.quoteContract.toLowerCase()
          : b.kind === "native"
        : b.contract?.toLowerCase() === pool.deco.toLowerCase()),
  );

  const execute = async () => {
    if (!chain || !meta || !secret) return;
    setBusy(true);
    setError("");
    setStatus(direction === "sell" || pool.quoteContract ? "Approving token, then swapping…" : "Swapping…");
    try {
      const hash = await swapAmm(chain, pool, secret, meta.kind, direction, amountInRaw, slippage);
      setDoneHash(hash);
      setStatus("");
      data.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swap failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  if (!chain) return null;
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <FieldLabel>Pool — your SimpleAMM contracts</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {AMM_POOLS.map((p) => (
          <button
            key={p.chainKey}
            onClick={() => setPoolKey(p.chainKey)}
            className="rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: pool.chainKey === p.chainKey ? "var(--accent)" : "var(--surface-2)",
              color: pool.chainKey === p.chainKey ? "#1a1405" : "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            {chainByKey(p.chainKey)?.name.replace(" Testnet", "")} · DECO/{p.quoteSymbol}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => setDirection("buy")}
          className="rounded-xl py-2.5 font-semibold"
          style={{
            background: direction === "buy" ? "var(--accent)" : "var(--surface-2)",
            color: direction === "buy" ? "#1a1405" : "var(--text)",
            border: "1px solid var(--border)",
          }}
        >
          Buy DECO
        </button>
        <button
          onClick={() => setDirection("sell")}
          className="rounded-xl py-2.5 font-semibold"
          style={{
            background: direction === "sell" ? "var(--accent)" : "var(--surface-2)",
            color: direction === "sell" ? "#1a1405" : "var(--text)",
            border: "1px solid var(--border)",
          }}
        >
          Sell DECO
        </button>
      </div>

      <FieldLabel>You pay — {inSymbol}</FieldLabel>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.0"
        inputMode="decimal"
        className="mono w-full rounded-xl px-3 py-2.5"
        style={inputStyle}
        aria-label={`Amount of ${inSymbol} to swap`}
      />
      <p className="mt-1.5 text-xs" style={{ color: "var(--dim)" }}>
        Balance: <span className="mono">{balanceRow?.balance ?? "0"} {inSymbol}</span>
        {reserves && (
          <>
            {" · "}Pool: <span className="mono">{formatUnits(reserves.deco, 18)} DECO / {formatUnits(reserves.base, pool.quoteDecimals)} {pool.quoteSymbol}</span>
          </>
        )}
      </p>

      <FieldLabel>You receive (estimated) — {outSymbol}</FieldLabel>
      <p className="mono text-xl">{amountInRaw > 0n ? formatUnits(amountOut, outDecimals) : "0"}</p>
      <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>
        Constant-product quote with the pool's 0.3% fee, read live from the contract.
      </p>

      <div className="mt-4">
        <SlippagePicker value={slippage} onChange={setSlippage} />
      </div>

      {status && <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>{status}</p>}
      {error && <p className="mt-3 break-words text-sm" style={{ color: "var(--red)" }}>{error}</p>}
      {doneHash && chain && (
        <p className="mt-3 text-sm">
          Swap submitted ✓{" "}
          <a href={txUrl(chain, doneHash)} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
            View transaction ↗
          </a>
        </p>
      )}
      <div className="mt-4">
        <PrimaryButton onClick={() => void execute()} disabled={busy || amountInRaw <= 0n || !reserves}>
          {busy ? "Working…" : `Swap ${inSymbol} → ${outSymbol}`}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ mainnet Uniswap

function UniSwap({ walletRef, data }: { walletRef: WalletRef; data: WalletData }) {
  const { meta, secret } = useSwapWallet(walletRef);
  const chainKeys = Object.keys(UNI_V3);
  const [chainKey, setChainKey] = useState(chainKeys[0] ?? "ethereum");
  const chain = chainByKey(chainKey);
  const customVersion = useSyncExternalStore(
    (fn) => customTokenStore.subscribe(fn),
    () => customTokenStore.version(),
    () => 0,
  );
  const tokenOptions: TokenChoice[] = useMemo(() => {
    if (!chain) return [];
    const list: TokenChoice[] = [
      { symbol: chain.nativeSymbol, contract: null, decimals: chain.nativeDecimals },
      ...chain.tokens.map((t) => ({ symbol: t.symbol, contract: t.contract, decimals: t.decimals })),
    ];
    const seen = new Set(list.map((t) => (t.contract ?? "native").toLowerCase()));
    for (const t of listCustomTokens(walletRefKey(walletRef))) {
      if (t.chainKey !== chain.key || seen.has(t.contract.toLowerCase())) continue;
      seen.add(t.contract.toLowerCase());
      list.push({ symbol: t.symbol, contract: t.contract, decimals: t.decimals });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, customVersion]);
  const [inKey, setInKey] = useState("native");
  const [outKey, setOutKey] = useState("");
  const tokenIn = tokenOptions.find((t) => (t.contract ?? "native") === inKey) ?? (tokenOptions[0] as TokenChoice);
  const tokenOut =
    tokenOptions.find((t) => (t.contract ?? "native") === outKey) ??
    tokenOptions.find((t) => t.symbol === "USDC") ??
    (tokenOptions[1] as TokenChoice);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [quote, setQuote] = useState<UniQuote | null>(null);
  const [quoteState, setQuoteState] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneHash, setDoneHash] = useState("");
  const [mainnetAck, setMainnetAck] = useState(false);

  let amountInRaw = 0n;
  try {
    amountInRaw = amount ? parseUnits(amount, tokenIn.decimals) : 0n;
  } catch {
    amountInRaw = 0n;
  }

  useEffect(() => {
    setQuote(null);
    if (!chain || amountInRaw <= 0n) {
      setQuoteState("");
      return;
    }
    setQuoteState("Fetching quote…");
    const t = window.setTimeout(() => {
      quoteUniV3(chain, tokenIn, tokenOut, amountInRaw)
        .then((q) => {
          setQuote(q);
          setQuoteState(q ? "" : "No Uniswap route found for this pair/amount");
        })
        .catch(() => setQuoteState("Quote failed — RPC or pool unavailable"));
    }, 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey, inKey, outKey, amount]);

  const execute = async () => {
    if (!chain || !meta || !secret || !quote) return;
    setBusy(true);
    setError("");
    setStatus("Approving (if needed) and swapping via Uniswap V3…");
    try {
      const hash = await swapUniV3(chain, secret, meta.kind, tokenIn, tokenOut, amountInRaw, quote, slippage);
      setDoneHash(hash);
      setStatus("");
      data.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swap failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  if (!chain) return null;
  const picker = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    ariaLabel: string,
  ) => (
    <div className="flex flex-wrap gap-2">
      {tokenOptions.map((t) => {
        const key = t.contract ?? "native";
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-label={`${ariaLabel} ${t.symbol}`}
            className="rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: value === key ? "var(--accent)" : "var(--surface-2)",
              color: value === key ? "#1a1405" : "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            {t.symbol}
          </button>
        );
      })}
      <span className="sr-only">{label}</span>
    </div>
  );

  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <FieldLabel>Chain — Uniswap V3</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {chainKeys.map((k) => (
          <button
            key={k}
            onClick={() => setChainKey(k)}
            className="rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: chainKey === k ? "var(--accent)" : "var(--surface-2)",
              color: chainKey === k ? "#1a1405" : "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            {chainByKey(k)?.name}
          </button>
        ))}
      </div>

      <FieldLabel>You pay</FieldLabel>
      {picker("pay", inKey, setInKey, "Pay with")}
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.0"
        inputMode="decimal"
        className="mono mt-2 w-full rounded-xl px-3 py-2.5"
        style={inputStyle}
        aria-label={`Amount of ${tokenIn.symbol} to swap`}
      />

      <FieldLabel>You receive</FieldLabel>
      {picker("receive", outKey || (tokenOut.contract ?? "native"), setOutKey, "Receive")}
      <p className="mono mt-2 text-xl">
        {quote ? formatUnits(quote.amountOut, tokenOut.decimals) : "0"}
        <span className="ml-2 text-sm" style={{ color: "var(--dim)" }}>{tokenOut.symbol}</span>
      </p>
      {quoteState && <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>{quoteState}</p>}
      {quote && (
        <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>
          Uniswap V3 pool fee tier: {quote.fee / 10000}%
        </p>
      )}

      <div className="mt-4">
        <SlippagePicker value={slippage} onChange={setSlippage} />
      </div>

      <label className="mt-4 flex items-start gap-3 rounded-xl p-3" style={{ background: "rgba(216,74,74,.08)", border: "1px solid rgba(216,74,74,.4)" }}>
        <input
          type="checkbox"
          checked={mainnetAck}
          onChange={(e) => setMainnetAck(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
          aria-label="Confirm this mainnet swap uses real funds"
        />
        <span className="text-sm">Mainnet swap with real funds. I checked the pair, amount, and quote.</span>
      </label>

      {status && <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>{status}</p>}
      {error && <p className="mt-3 break-words text-sm" style={{ color: "var(--red)" }}>{error}</p>}
      {doneHash && (
        <p className="mt-3 text-sm">
          Swap submitted ✓{" "}
          <a href={txUrl(chain, doneHash)} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--accent)" }}>
            View transaction ↗
          </a>
        </p>
      )}
      <div className="mt-4">
        <PrimaryButton onClick={() => void execute()} disabled={busy || !quote || !mainnetAck} danger>
          {busy ? "Working…" : `Swap ${tokenIn.symbol} → ${tokenOut.symbol}`}
        </PrimaryButton>
      </div>
      <div className="mt-2">
        <GhostButton onClick={() => data.refresh()}>Refresh balances</GhostButton>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ screen

export function SwapScreen({
  walletRef,
  data,
  network,
  onGoWallets,
}: {
  walletRef: WalletRef;
  data: WalletData;
  network: "mainnet" | "testnet";
  onGoWallets: () => void;
}) {
  const { ready } = useSwapWallet(walletRef);
  if (!ready) return <LockedNote onGoWallets={onGoWallets} />;
  return network === "testnet" ? (
    <AmmSwap walletRef={walletRef} data={data} />
  ) : (
    <UniSwap walletRef={walletRef} data={data} />
  );
}
