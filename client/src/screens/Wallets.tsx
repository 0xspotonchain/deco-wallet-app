import { useState, useSyncExternalStore } from "react";
import { BURNER_ADDRESSES } from "../lib/chains";
import { addressesForImport } from "../lib/derive";
import {
listWalletMetas,
newWalletId,
session,
vaultExists,
type ImportKind,
type WalletMeta,
} from "../lib/vault";
import { FieldLabel, GhostButton, PrimaryButton, inputStyle, shortAddress } from "../components/ui";

const KIND_OPTIONS: Array<{ kind: ImportKind; label: string; placeholder: string }> = [
  { kind: "seed", label: "Seed phrase", placeholder: "12 words, separated by spaces" },
  { kind: "evmKey", label: "EVM private key", placeholder: "0x… (64 hex characters)" },
  { kind: "solKey", label: "Solana key", placeholder: "Base58 secret key (or JSON array)" },
  { kind: "btcKey", label: "Bitcoin WIF", placeholder: "WIF private key (L… / K… / 5… / c…)" },
  { kind: "tronKey", label: "TRON private key", placeholder: "64 hex characters" },
];

function useUnlocked(): boolean {
  return useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => session.unlocked,
    () => false,
  );
}

export function WalletsScreen({ onSelectImported }: { onSelectImported: (id: string) => void }) {
  const unlocked = useUnlocked();
  const [metas, setMetas] = useState<WalletMeta[]>(() => listWalletMetas());
  const [unlockPw, setUnlockPw] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [showImport, setShowImport] = useState(false);

  // Import form
  const [kind, setKind] = useState<ImportKind>("seed");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [preview, setPreview] = useState<Partial<Record<string, string>> | null>(null);
  const [importError, setImportError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const hasVault = vaultExists();
  const needsNewPassword = !hasVault;
  const burnerImported = metas.some(
    (m) => m.addresses.evm?.toLowerCase() === BURNER_ADDRESSES.evm.toLowerCase(),
  );

  const refreshMetas = () => setMetas(listWalletMetas());

  const doUnlock = async () => {
    setUnlockError("");
    const ok = await session.unlock(unlockPw);
    if (!ok) setUnlockError("Wrong password — try again.");
    setUnlockPw("");
  };

  const validateSecret = () => {
    setImportError("");
    setPreview(null);
    try {
      const addresses = addressesForImport(kind, secret);
      if (Object.keys(addresses).length === 0) throw new Error("Could not derive any address");
      setPreview(addresses);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Invalid key material");
    }
  };

  const doImport = async () => {
    if (!preview) return;
    setImportError("");
    if (needsNewPassword) {
      if (pw.length < 8) {
        setImportError("Vault password must be at least 8 characters.");
        return;
      }
      if (pw !== pw2) {
        setImportError("Passwords don't match.");
        return;
      }
    }
    setBusy(true);
    try {
      const meta: WalletMeta = {
        id: newWalletId(),
        label: label.trim() || KIND_OPTIONS.find((k) => k.kind === kind)?.label || "Wallet",
        kind,
        addresses: preview,
        createdAt: Date.now(),
      };
      const secretToStore = kind === "seed" ? secret.trim().toLowerCase().replace(/\s+/g, " ") : secret.trim();
      await session.addWallet(meta, secretToStore, needsNewPassword ? pw : unlocked ? undefined : pw);
      setSecret("");
      setPw("");
      setPw2("");
      setPreview(null);
      setShowImport(false);
      refreshMetas();
      onSelectImported(meta.id);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async (id: string) => {
    try {
      await session.removeWallet(id);
      refreshMetas();
      setConfirmRemove(null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Remove failed — unlock the vault first");
    }
  };

  return (
    <div className="space-y-4">
      {/* Vault status */}
      <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h3 className="font-semibold">Vault</h3>
        {!hasVault && (
          <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>
            No imported wallets yet. Importing creates an encrypted vault in this browser —
            scrypt + AES-GCM, protected by a password only you know. Keys never leave this device.
          </p>
        )}
        {hasVault && unlocked && (
          <>
            <p className="mt-1 text-sm" style={{ color: "var(--green)" }}>
              Unlocked — signing is available. Auto-locks after 5 minutes idle.
            </p>
            <div className="mt-3">
              <GhostButton onClick={() => session.lock()}>Lock now</GhostButton>
            </div>
          </>
        )}
        {hasVault && !unlocked && (
          <>
            <p className="mt-1 text-sm" style={{ color: "var(--amber)" }}>
              Locked — balances stay visible, signing is off.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="password"
                value={unlockPw}
                onChange={(e) => setUnlockPw(e.target.value)}
                placeholder="Vault password"
                className="w-full rounded-xl px-3 py-2.5"
                style={inputStyle}
                aria-label="Vault password"
                onKeyDown={(e) => e.key === "Enter" && void doUnlock()}
              />
              <button
                onClick={() => void doUnlock()}
                className="shrink-0 rounded-xl px-5 font-semibold"
                style={{ background: "var(--accent)", color: "#1a1405" }}
              >
                Unlock
              </button>
            </div>
            {unlockError && <p className="mt-2 text-sm" style={{ color: "var(--red)" }}>{unlockError}</p>}
          </>
        )}
      </section>

      {/* Known wallets */}
      <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <h3 className="mb-2 font-semibold">Known wallets</h3>
        <div className="py-1.5">
          <p className="text-sm font-medium">Burner {burnerImported && <span style={{ color: "var(--green)" }}>· imported ✓</span>}</p>
          <p className="mono text-xs" style={{ color: "var(--dim)" }}>EVM {shortAddress(BURNER_ADDRESSES.evm)} · BTC · Solana · TRON — multichain, Muse's automation + your phone</p>
        </div>
        <div className="py-1.5">
          <p className="text-sm font-medium">Circle <span style={{ color: "var(--dim)" }}>· read-only</span></p>
          <p className="mono text-xs" style={{ color: "var(--dim)" }}>USDC on Arc only — smart-contract agent wallet, no seed exists</p>
        </div>
      </section>

      {/* Imported wallets */}
      {metas.length > 0 && (
        <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <h3 className="mb-2 font-semibold">Imported on this device</h3>
          {metas.map((m) => (
            <div key={m.id} className="border-t py-3 first:border-t-0" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between gap-2">
                <button className="text-left font-medium" onClick={() => onSelectImported(m.id)} aria-label={`Select wallet ${m.label}`}>
                  {m.label}
                </button>
                {confirmRemove === m.id ? (
                  <span className="flex gap-2">
                    <button
                      className="rounded-lg px-3 py-1 text-sm font-semibold"
                      style={{ background: "var(--red)", color: "#fff" }}
                      onClick={() => void doRemove(m.id)}
                    >
                      Delete keys
                    </button>
                    <button className="rounded-lg px-3 py-1 text-sm" style={{ background: "var(--surface-2)" }} onClick={() => setConfirmRemove(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    className="rounded-lg px-3 py-1 text-sm"
                    style={{ background: "var(--surface-2)", color: "var(--red)" }}
                    onClick={() => setConfirmRemove(m.id)}
                    aria-label={`Remove wallet ${m.label} from this device`}
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="mono mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
                {Object.entries(m.addresses)
                  .map(([slot, addr]) => `${slot}: ${shortAddress(addr ?? "")}`)
                  .join("  ·  ")}
              </p>
            </div>
          ))}
          {importError && confirmRemove && <p className="mt-2 text-sm" style={{ color: "var(--red)" }}>{importError}</p>}
        </section>
      )}

      {/* Import */}
      {!showImport ? (
        <PrimaryButton onClick={() => setShowImport(true)}>Import a wallet</PrimaryButton>
      ) : (
        <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <h3 className="font-semibold">Import wallet</h3>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--amber)" }}>
            Import only from your own backup. Your key is encrypted on this device and never sent
            anywhere — but never type a seed into a device or browser you don't trust, and never
            share it with anyone. Muse will never ask for it in chat.
          </p>

          <FieldLabel>Import by</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {KIND_OPTIONS.map((o) => (
              <button
                key={o.kind}
                onClick={() => {
                  setKind(o.kind);
                  setPreview(null);
                }}
                className="rounded-full px-3 py-1.5 text-sm font-medium"
                style={{
                  background: kind === o.kind ? "var(--accent)" : "var(--surface-2)",
                  color: kind === o.kind ? "#1a1405" : "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>

          <FieldLabel>Label</FieldLabel>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Burner (phone)"
            className="w-full rounded-xl px-3 py-2.5"
            style={inputStyle}
            aria-label="Wallet label"
          />

          <FieldLabel>{KIND_OPTIONS.find((k) => k.kind === kind)?.label}</FieldLabel>
          <textarea
            value={secret}
            onChange={(e) => {
              setSecret(e.target.value);
              setPreview(null);
            }}
            placeholder={KIND_OPTIONS.find((k) => k.kind === kind)?.placeholder}
            className="mono w-full rounded-xl px-3 py-2.5 text-sm"
            style={{ ...inputStyle, minHeight: "5rem" }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Secret key material"
          />

          {!preview && (
            <div className="mt-3">
              <GhostButton onClick={validateSecret} disabled={!secret.trim()}>
                Check & preview addresses
              </GhostButton>
            </div>
          )}

          {preview && (
            <div className="mt-3 rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <p className="mb-1 text-sm font-medium" style={{ color: "var(--green)" }}>
                Addresses derived — verify they match your wallet:
              </p>
              {Object.entries(preview).map(([slot, addr]) => (
                <p key={slot} className="mono break-all py-0.5 text-xs">
                  <span style={{ color: "var(--dim)" }}>{slot}:</span> {addr}
                </p>
              ))}
            </div>
          )}

          {preview && needsNewPassword && (
            <>
              <FieldLabel>Create vault password (min 8 characters)</FieldLabel>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5"
                style={inputStyle}
                aria-label="New vault password"
              />
              <FieldLabel>Repeat password</FieldLabel>
              <input
                type="password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5"
                style={inputStyle}
                aria-label="Repeat vault password"
              />
              <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>
                There is no recovery if you forget this password — the vault can only be re-created by importing again.
              </p>
            </>
          )}
          {preview && hasVault && !unlocked && (
            <>
              <FieldLabel>Vault password (to add this wallet)</FieldLabel>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5"
                style={inputStyle}
                aria-label="Vault password"
              />
            </>
          )}

          {importError && <p className="mt-3 text-sm" style={{ color: "var(--red)" }}>{importError}</p>}

          {preview && (
            <div className="mt-4 space-y-2">
              <PrimaryButton onClick={() => void doImport()} disabled={busy}>
                {busy ? "Encrypting…" : "Encrypt & import"}
              </PrimaryButton>
              <GhostButton
                onClick={() => {
                  setShowImport(false);
                  setSecret("");
                  setPreview(null);
                }}
              >
                Cancel
              </GhostButton>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
