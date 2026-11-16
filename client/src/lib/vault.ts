// Browser vault for imported wallets.
//
// Security model (non-negotiable, from the build brief):
// - Secrets (seed phrases / private keys) are encrypted with a password
//   the user sets: scrypt KDF + AES-GCM, ciphertext in localStorage only.
// - Secrets NEVER leave the device: no server call ever carries them.
// - Signing happens locally; only signed transactions are broadcast.
// - Public metadata (labels + addresses) is stored in plaintext so the
//   wallet list renders while locked; it contains no secret material.

import { scrypt } from "@noble/hashes/scrypt.js";
import type { Family } from "./chains";

export type ImportKind = "seed" | "evmKey" | "solKey" | "btcKey" | "tronKey";

export interface WalletMeta {
  id: string;
  label: string;
  kind: ImportKind;
  // Public addresses by slot: evm | btc | btc-testnet | solana | tron
  addresses: Partial<Record<string, string>>;
  createdAt: number;
}

interface VaultFile {
  version: 1;
  kdf: { salt: string; N: number; r: number; p: number; dkLen: number };
  iv: string;
  ciphertext: string;
  wallets: WalletMeta[];
}

const STORAGE_KEY = "deco-wallet-vault-v1";
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, dkLen: 32 };

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const dk = scrypt(new TextEncoder().encode(password), salt, SCRYPT_PARAMS);
  return crypto.subtle.importKey("raw", dk as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptSecrets(
  password: string,
  secrets: Record<string, string>,
  wallets: WalletMeta[],
  existingSalt?: Uint8Array,
): Promise<void> {
  const salt = existingSalt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(secrets));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain as BufferSource);
  const file: VaultFile = {
    version: 1,
    kdf: { salt: b64encode(salt), ...SCRYPT_PARAMS },
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ct)),
    wallets,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
}

export function loadVaultFile(): VaultFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultFile;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function vaultExists(): boolean {
  return loadVaultFile() !== null;
}

export function listWalletMetas(): WalletMeta[] {
  return loadVaultFile()?.wallets ?? [];
}

// ------------------------------------------------------------- session

const AUTO_LOCK_MS = 5 * 60 * 1000;

class VaultSession {
  private secrets: Record<string, string> | null = null;
  private password: string | null = null;
  private timer: number | null = null;
  private listeners = new Set<() => void>();

  get unlocked(): boolean {
    return this.secrets !== null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private armAutoLock() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.lock(), AUTO_LOCK_MS);
  }

  touch() {
    if (this.unlocked) this.armAutoLock();
  }

  async unlock(password: string): Promise<boolean> {
    const file = loadVaultFile();
    if (!file) return false;
    try {
      const salt = b64decode(file.kdf.salt);
      const key = await crypto.subtle.importKey(
        "raw",
        scrypt(new TextEncoder().encode(password), salt, {
          N: file.kdf.N,
          r: file.kdf.r,
          p: file.kdf.p,
          dkLen: file.kdf.dkLen,
        }) as BufferSource,
        "AES-GCM",
        false,
        ["decrypt"],
      );
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64decode(file.iv) as BufferSource },
        key,
        b64decode(file.ciphertext) as BufferSource,
      );
      this.secrets = JSON.parse(new TextDecoder().decode(plain)) as Record<string, string>;
      this.password = password;
      this.armAutoLock();
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  lock() {
    this.secrets = null;
    this.password = null;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    this.emit();
  }

  secretFor(walletId: string): string | null {
    return this.secrets?.[walletId] ?? null;
  }

  /** Add or replace a wallet; requires the vault password (set or existing). */
  async saveWallet(meta: WalletMeta, secret: string, password: string): Promise<void> {
    const file = loadVaultFile();
    if (!file) {
      await encryptSecrets(password, { [meta.id]: secret }, [meta]);
      this.secrets = { [meta.id]: secret };
      this.password = password;
      this.armAutoLock();
      this.emit();
      return;
    }
    // Existing vault: must be unlocked with the same password to re-encrypt.
    if (!this.unlocked || this.password !== password) {
      const ok = await this.unlock(password);
      if (!ok) throw new Error("Wrong vault password");
    }
    const secrets = { ...(this.secrets ?? {}), [meta.id]: secret };
    const wallets = [...file.wallets.filter((w) => w.id !== meta.id), meta];
    await encryptSecrets(password, secrets, wallets, b64decode(file.kdf.salt));
    this.secrets = secrets;
    this.armAutoLock();
    this.emit();
  }

  /** Add a wallet using the session password when already unlocked. */
  async addWallet(meta: WalletMeta, secret: string, password?: string): Promise<void> {
    if (!vaultExists()) {
      if (!password) throw new Error("Set a vault password first");
      return this.saveWallet(meta, secret, password);
    }
    if (this.unlocked && this.password) {
      return this.saveWallet(meta, secret, this.password);
    }
    if (!password) throw new Error("Unlock the vault first");
    return this.saveWallet(meta, secret, password);
  }

  async removeWallet(walletId: string): Promise<void> {
    const file = loadVaultFile();
    if (!file || !this.unlocked || !this.password) throw new Error("Vault is locked");
    const secrets = { ...(this.secrets ?? {}) };
    delete secrets[walletId];
    const wallets = file.wallets.filter((w) => w.id !== walletId);
    if (wallets.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      this.lock();
      return;
    }
    await encryptSecrets(this.password, secrets, wallets, b64decode(file.kdf.salt));
    this.secrets = secrets;
    this.emit();
  }
}

export const session = new VaultSession();

export function familyOfKind(kind: ImportKind): Family | "all" {
  switch (kind) {
    case "seed":
      return "all";
    case "evmKey":
      return "evm";
    case "solKey":
      return "solana";
    case "btcKey":
      return "btc";
    case "tronKey":
      return "tron";
  }
}

export function newWalletId(): string {
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
