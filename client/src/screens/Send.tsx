import { useMemo, useState } from "react";
import { addressForChain, type ChainCfg } from "../lib/chains";
import type { WalletData, WalletRef } from "../lib/data";
import { walletAddresses } from "../lib/data";
import { parseUnits } from "../lib/live";
import {
estimateBtcFee,
estimateEvmFee,
sendBtc,
sendEvm,
sendSolana,
sendTron,
type TokenChoice,
} from "../lib/tx";
import { validateAddress } from "../lib/derive";
import { listWalletMetas, session } from "../lib/vault";
import { FieldLabel, GhostButton, PrimaryButton, Sheet, inputStyle } from "../components/ui";
import { txUrl } from "../lib/chains";
import { walletChains } from "./Portfolio";

type Step = "form" | "review" | "sending" | "done" | "error";

export function SendSheet({
  walletRef,
  data,
  network,
  onClose,
  onGoWallets,
}: {
  walletRef: WalletRef;
  data: WalletData;
  network: "mainnet" | "testnet";
  onClose: () => void;
  onGoWallets: () => void;
}) {
  const chains = useMemo(
    () => (walletRef.type === "imported" ? walletChains(walletRef, network) : []),
    [walletRef, network],
  );
  const [chainKey, setChainKey] = useState("");
  const chain: ChainCfg | undefined = chains.find((c) => c.key === chainKey) ?? chains[0];
  const [tokenKey, setTokenKey] = useState("native");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [feeText, setFeeText] = useState<string>("");
  const [feeLoading, setFeeLoading] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [mainnetAck, setMainnetAck] = useState(false);

  const meta = walletRef.type === "imported" ? listWalletMetas().find((w) => w.id === walletRef.id) : undefined;
  const unlocked = session.unlocked && walletRef.type === "imported" && session.secretFor(walletRef.id) != null;

  const tokens: TokenChoice[] = useMemo(() => {
    if (!chain) return [];
    const list: TokenChoice[] = [{ symbol: chain.nativeSymbol, contract: null, decimals: chain.nativeDecimals }];
    const seen = new Set<string>();
    for (const t of chain.tokens) {
      list.push({ symbol: t.symbol, contract: t.contract, decimals: t.decimals });
      seen.add(t.contract.toLowerCase());
    }
    for (const b of data.balances) {
      if (b.chainKey !== chain.key || b.kind !== "token" || !b.contract) continue;
      if (seen.has(b.contract.toLowerCase())) continue;
      seen.add(b.contract.toLowerCase());
      list.push({ symbol: b.symbol, contract: b.contract, decimals: b.decimals });
    }
    return list;
  }, [chain, data.balances]);

  const token: TokenChoice = tokens.find((t) => (t.contract ?? "native") === tokenKey) ?? tokens[0] ?? {
    symbol: chain?.nativeSymbol ?? "",
    contract: null,
    decimals: chain?.nativeDecimals ?? 18,
  };
  const balanceRow = chain
    ? data.balances.find(
        (b) => b.chainKey === chain.key && (token.contract ? b.contract?.toLowerCase() === token.contract.toLowerCase() : b.kind === "native"),
      )
    : undefined;

  if (walletRef.type !== "imported") {
    return (
      <Sheet title="Send" onClose={onClose}>
        <p className="text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          This wallet is view-only in the app. Sending needs the wallet imported on this device —
          keys are encrypted in your browser and never leave it. Import from your own backup in the
          Wallets tab. (The app never reads Muse's VM keystore.)
        </p>
        <div className="mt-4">
          <PrimaryButton onClick={onGoWallets}>Go to Wallets</PrimaryButton>
        </div>
      </Sheet>
    );
  }
  if (!unlocked) {
    return (
      <Sheet title="Send" onClose={onClose}>
        <p className="text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          The vault is locked. Unlock it in the Wallets tab to sign transactions on this device.
        </p>
        <div className="mt-4">
          <PrimaryButton onClick={onGoWallets}>Unlock in Wallets</PrimaryButton>
        </div>
      </Sheet>
    );
  }
  if (!chain || !meta) {
    return (
      <Sheet title="Send" onClose={onClose}>
        <p style={{ color: "var(--dim)" }}>This wallet has no {network} chains to send from.</p>
      </Sheet>
    );
  }

  const from = addressForChain(walletAddresses(walletRef), chain) ?? "";

  const goReview = async () => {
    setError("");
    if (!validateAddress(chain.family, to, chain.network === "testnet")) {
      setError(`That doesn't look like a valid ${chain.name} address.`);
      return;
    }
    let raw: bigint;
    try {
      raw = parseUnits(amount, token.decimals);
    } catch {
      setError("Enter a valid amount.");
      return;
    }
    if (raw <= 0n) {
      setError("Amount must be more than zero.");
      return;
    }
    setStep("review");
    setFeeLoading(true);
    try {
      if (chain.family === "evm") setFeeText(await estimateEvmFee(chain, from, to.trim(), raw, token));
      else if (chain.family === "btc") setFeeText(await estimateBtcFee(chain, from, raw));
      else if (chain.family === "solana") setFeeText("≈0.000005 SOL");
      else setFeeText(token.contract ? "Energy fee — typically 13–30 TRX without staked energy" : "≈0–1.1 TRX (bandwidth may cover it)");
    } catch {
      setFeeText("Couldn't estimate — the network will charge its standard fee");
    } finally {
      setFeeLoading(false);
    }
  };

  const confirmSend = async () => {
    const secret = walletRef.type === "imported" ? session.secretFor(walletRef.id) : null;
    if (!secret || !meta) return;
    setStep("sending");
    setError("");
    try {
      const raw = parseUnits(amount, token.decimals);
      let hash: string;
      switch (chain.family) {
        case "evm":
          hash = await sendEvm(chain, secret, meta.kind, to.trim(), raw, token);
          break;
        case "btc":
          hash = await sendBtc(chain, secret, meta.kind, to.trim(), raw);
          break;
        case "solana":
          hash = await sendSolana(chain, secret, meta.kind, to.trim(), raw, token);
          break;
        case "tron":
          hash = await sendTron(chain, secret, meta.kind, to.trim(), raw, token);
          break;
      }
      setTxHash(hash);
      setStep("done");
      data.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
      setStep("error");
    }
  };

  return (
    <Sheet title={`Send · ${chain.name}`} onClose={onClose}>
      {step === "form" && (
        <div>
          <FieldLabel>Network</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {chains.map((c) => (
              <button
                key={c.key}
                onClick={() => {
                  setChainKey(c.key);
                  setTokenKey("native");
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

          <FieldLabel>Asset</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {tokens.map((t) => {
              const key = t.contract ?? "native";
              return (
                <button
                  key={key}
                  onClick={() => setTokenKey(key)}
                  className="rounded-full px-3 py-1.5 text-sm font-medium"
                  style={{
                    background: tokenKey === key ? "var(--accent)" : "var(--surface-2)",
                    color: tokenKey === key ? "#1a1405" : "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {t.symbol}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>
            Balance: <span className="mono">{balanceRow?.balance ?? "0"} {token.symbol}</span>
          </p>

          <FieldLabel>Recipient address</FieldLabel>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={chain.family === "evm" ? "0x…" : chain.family === "tron" ? "T…" : "Address"}
            className="mono w-full rounded-xl px-3 py-2.5 text-sm"
            style={inputStyle}
            autoComplete="off"
            aria-label="Recipient address"
          />

          <FieldLabel>Amount</FieldLabel>
          <div className="flex gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              inputMode="decimal"
              className="mono w-full rounded-xl px-3 py-2.5 text-sm"
              style={inputStyle}
              aria-label={`Amount in ${token.symbol}`}
            />
            <button
              className="shrink-0 rounded-xl px-4 font-medium"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
              onClick={() => balanceRow && setAmount(balanceRow.balance)}
            >
              Max
            </button>
          </div>

          {error && (
            <p className="mt-3 text-sm" style={{ color: "var(--red)" }}>{error}</p>
          )}
          <div className="mt-5">
            <PrimaryButton onClick={() => void goReview()}>Review send</PrimaryButton>
          </div>
        </div>
      )}

      {step === "review" && (
        <div>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt style={{ color: "var(--dim)" }}>Amount</dt>
              <dd className="mono font-semibold">{amount} {token.symbol}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt style={{ color: "var(--dim)" }}>Network</dt>
              <dd>{chain.name} ({chain.network})</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt style={{ color: "var(--dim)" }}>To</dt>
              <dd className="mono break-all text-right text-xs">{to.trim()}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt style={{ color: "var(--dim)" }}>From</dt>
              <dd className="mono break-all text-right text-xs">{from}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt style={{ color: "var(--dim)" }}>Estimated fee</dt>
              <dd className="mono">{feeLoading ? "Estimating…" : feeText}</dd>
            </div>
          </dl>
          {chain.network === "mainnet" && (
            <label className="mt-5 flex items-start gap-3 rounded-xl p-3" style={{ background: "rgba(216,74,74,.08)", border: "1px solid rgba(216,74,74,.4)" }}>
              <input
                type="checkbox"
                checked={mainnetAck}
                onChange={(e) => setMainnetAck(e.target.checked)}
                className="mt-1 h-5 w-5 shrink-0"
                aria-label="Confirm this is a mainnet transaction with real funds"
              />
              <span className="text-sm">
                This is a <strong>mainnet</strong> transaction with real funds. It cannot be undone.
                I checked the address and amount.
              </span>
            </label>
          )}
          <div className="mt-5 space-y-2">
            <PrimaryButton
              onClick={() => void confirmSend()}
              disabled={chain.network === "mainnet" && !mainnetAck}
              danger={chain.network === "mainnet"}
            >
              {chain.network === "mainnet" ? "Confirm mainnet send" : "Confirm send"}
            </PrimaryButton>
            <GhostButton onClick={() => setStep("form")}>Back</GhostButton>
          </div>
        </div>
      )}

      {step === "sending" && (
        <p className="py-8 text-center" style={{ color: "var(--dim)" }}>
          Signing on this device and broadcasting…
        </p>
      )}

      {step === "done" && (
        <div className="text-center">
          <p className="text-3xl">✓</p>
          <p className="mt-2 font-semibold">Sent</p>
          <p className="mono mt-2 break-all text-xs" style={{ color: "var(--dim)" }}>{txHash}</p>
          <a href={txUrl(chain, txHash)} target="_blank" rel="noreferrer" className="mt-3 inline-block underline" style={{ color: "var(--accent)" }}>
            View on explorer ↗
          </a>
          <div className="mt-5">
            <PrimaryButton onClick={onClose}>Done</PrimaryButton>
          </div>
        </div>
      )}

      {step === "error" && (
        <div>
          <p className="font-semibold" style={{ color: "var(--red)" }}>Transaction failed</p>
          <p className="mono mt-2 break-words text-xs" style={{ color: "var(--dim)" }}>{error}</p>
          <div className="mt-5 space-y-2">
            <PrimaryButton onClick={() => setStep("form")}>Back to form</PrimaryButton>
            <GhostButton onClick={onClose}>Close</GhostButton>
          </div>
        </div>
      )}
    </Sheet>
  );
}
