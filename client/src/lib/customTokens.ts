// Custom token imports: tokens the user adds by contract address (CA).
//
// Stored on this device only (localStorage), scoped per wallet — the
// server never sees them, same as the vault. Metadata (symbol, name,
// decimals) is read from the chain itself at import time: ERC-20
// symbol()/name()/decimals() via eth_call, SPL mint info via
// getParsedAccountInfo, TRC-20 via trongrid triggerconstantcontract.
// Balances for custom tokens are fetched by lib/live.ts alongside the
// built-in token lists, and they flow into Portfolio, Send, and Swap.

import { PublicKey } from "@solana/web3.js";
import { rpcCall } from "./live";
import type { ChainCfg } from "./chains";

export interface CustomToken {
  chainKey: string;
  contract: string; // EVM 0x address, Solana mint, or TRON base58 contract
  symbol: string;
  name: string;
  decimals: number;
  addedAt: number;
}

const STORAGE_KEY = "deco-wallet.custom-tokens.v1";
type Store = Record<string, CustomToken[]>; // wallet scope -> tokens

const listeners = new Set<() => void>();
let version = 0;

export const customTokenStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  version(): number {
    return version;
  },
};

function bump(): void {
  version++;
  for (const fn of listeners) fn();
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable — imports just won't persist */
  }
  bump();
}

/** Address comparison: EVM is case-insensitive, base58 families are not. */
export function sameContract(chain: ChainCfg, a: string, b: string): boolean {
  return chain.family === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function listCustomTokens(scope: string): CustomToken[] {
  return readStore()[scope] ?? [];
}

export function addCustomToken(scope: string, token: CustomToken): void {
  const store = readStore();
  const list = store[scope] ?? [];
  if (list.some((t) => t.chainKey === token.chainKey && t.contract.toLowerCase() === token.contract.toLowerCase())) return;
  store[scope] = [...list, token];
  writeStore(store);
}

export function removeCustomToken(scope: string, chainKey: string, contract: string): void {
  const store = readStore();
  const list = store[scope] ?? [];
  store[scope] = list.filter(
    (t) => !(t.chainKey === chainKey && t.contract.toLowerCase() === contract.toLowerCase()),
  );
  writeStore(store);
}

// ------------------------------------------------------------ metadata lookup

export interface TokenMeta {
  symbol: string;
  name: string;
  decimals: number;
}

function decodeAbiString(result: unknown): string | null {
  if (typeof result !== "string" || !result.startsWith("0x") || result.length <= 2) return null;
  const hex = result.slice(2);
  try {
    const bytes = new Uint8Array(hex.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
    // Dynamic string: offset(32) + length(32) + data
    if (bytes.length >= 64) {
      const len = Number(BigInt("0x" + hex.slice(64, 128)));
      if (len > 0 && len <= 256 && bytes.length >= 64 + len) {
        return new TextDecoder().decode(bytes.slice(64, 64 + len)).replace(/\0+$/, "");
      }
    }
    // bytes32 fixed string
    return new TextDecoder().decode(bytes).replace(/\0+$/, "") || null;
  } catch {
    return null;
  }
}

function decodeAbiUint(result: unknown): number | null {
  if (typeof result !== "string" || !result.startsWith("0x") || result.length <= 2) return null;
  try {
    const v = BigInt(result);
    return v <= 255n ? Number(v) : null;
  } catch {
    return null;
  }
}

async function lookupEvm(chain: ChainCfg, contract: string): Promise<TokenMeta> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) {
    throw new Error("That doesn't look like an EVM contract address (0x + 40 hex characters).");
  }
  const code = await rpcCall(chain.rpcs, "eth_getCode", [contract, "latest"], chain.timeoutMs);
  if (typeof code !== "string" || code === "0x") {
    throw new Error(`No contract found at that address on ${chain.name}. Check the address and chain.`);
  }
  const call = (data: string) => rpcCall(chain.rpcs, "eth_call", [{ to: contract, data }, "latest"], chain.timeoutMs);
  const [symRes, decRes, nameRes] = await Promise.all([
    call("0x95d89b41").catch(() => null), // symbol()
    call("0x313ce567").catch(() => null), // decimals()
    call("0x06fdde03").catch(() => null), // name()
  ]);
  const symbol = decodeAbiString(symRes);
  const decimals = decodeAbiUint(decRes);
  if (!symbol || decimals === null) {
    throw new Error("That contract doesn't answer like an ERC-20 token (symbol/decimals unreadable).");
  }
  return { symbol, name: decodeAbiString(nameRes) ?? symbol, decimals };
}

async function lookupSolana(chain: ChainCfg, mint: string): Promise<TokenMeta> {
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(mint);
  } catch {
    throw new Error("That doesn't look like a valid Solana mint address.");
  }
  const res = (await rpcCall(chain.rpcs, "getParsedAccountInfo", [pubkey.toBase58()], chain.timeoutMs)) as {
    value?: { data?: { parsed?: { info?: { decimals?: number; supply?: string }; type?: string } } } | null;
  };
  const info = res.value?.data?.parsed?.info;
  if (!info || typeof info.decimals !== "number") {
    throw new Error(`No SPL mint found at that address on ${chain.name}. Check the mint address.`);
  }
  // SPL mints carry no on-chain symbol — the user labels it in the form.
  return { symbol: "", name: "", decimals: info.decimals };
}

// Base58 (Bitcoin alphabet) decode — enough to validate TRON addresses
// and convert them to the hex form trongrid expects.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(text: string): Uint8Array | null {
  const bytes: number[] = [];
  for (const ch of text) {
    const idx = B58.indexOf(ch);
    if (idx < 0) return null;
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      const v = (bytes[i] ?? 0) * 58 + carry;
      bytes[i] = v & 0xff;
      carry = v >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i] ?? 0;
  return out;
}

/** TRON base58check address -> 20-byte hex (no 0x41 prefix), or null. */
export function tronAddressToHex(address: string): string | null {
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return null;
  return [...raw.slice(1, 21)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function tronConstantCall(
  gridBase: string,
  contract: string,
  selector: string,
  parameter: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const res = await fetch(`${gridBase}/wallet/triggerconstantcontract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner_address: contract,
        contract_address: contract,
        function_selector: selector,
        parameter,
        visible: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { constant_result?: string[] };
    return data.constant_result?.[0] ?? null;
  } catch {
    return null;
  }
}

async function lookupTron(chain: ChainCfg, contract: string): Promise<TokenMeta> {
  if (!tronAddressToHex(contract)) {
    throw new Error("That doesn't look like a valid TRON address (base58, starts with T).");
  }
  const grid = chain.rpcs[0] ?? "";
  const [symHex, decHex, nameHex] = await Promise.all([
    tronConstantCall(grid, contract, "symbol()", "", chain.timeoutMs),
    tronConstantCall(grid, contract, "decimals()", "", chain.timeoutMs),
    tronConstantCall(grid, contract, "name()", "", chain.timeoutMs),
  ]);
  const symbol = symHex ? decodeAbiString("0x" + symHex) : null;
  const decimals = decHex ? decodeAbiUint("0x" + decHex) : null;
  if (!symbol || decimals === null) {
    throw new Error("That contract doesn't answer like a TRC-20 token (symbol/decimals unreadable).");
  }
  return { symbol, name: nameHex ? (decodeAbiString("0x" + nameHex) ?? symbol) : symbol, decimals };
}

export async function lookupTokenMeta(chain: ChainCfg, contract: string): Promise<TokenMeta> {
  const ca = contract.trim();
  switch (chain.family) {
    case "evm":
      return lookupEvm(chain, ca);
    case "solana":
      return lookupSolana(chain, ca);
    case "tron":
      return lookupTron(chain, ca);
    case "btc":
      throw new Error("Bitcoin has no tokens to import.");
  }
}
