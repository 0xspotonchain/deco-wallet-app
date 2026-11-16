// Key derivation + address validation, all local to the browser.
// Derivation paths match the VM multichain wallet exactly (verified
// against test vectors there): EVM m/44'/60'/0'/0/0, BTC SegWit
// m/84'/coin'/0'/0/0, Solana m/44'/501'/0'/0' (Phantom), TRON m/44'/195'/0'/0/0.

import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as btc from "@scure/btc-signer";
import { base58, base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { derivePath as edDerivePath } from "ed25519-hd-key";
import { Keypair } from "@solana/web3.js";
import { Wallet as EthersWallet } from "ethers";
import { TronWeb } from "tronweb";
import type { ImportKind } from "./vault";

const b58check = base58check(sha256);

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unhex(text: string): Uint8Array {
  const clean = text.startsWith("0x") ? text.slice(2) : text;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export interface DerivedAddresses {
  [key: string]: string;
  evm: string;
  btc: string;
  "btc-testnet": string;
  solana: string;
  tron: string;
}

function tronAddressFromPrivateKey(pkHex: string): string {
  const tw = new TronWeb({ fullHost: "https://api.trongrid.io" });
  return tw.address.fromPrivateKey(pkHex) as string;
}

export function deriveFromSeed(mnemonic: string): DerivedAddresses {
  const words = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(words, wordlist)) throw new Error("Invalid seed phrase — check the words and try again");
  const seed = mnemonicToSeedSync(words);
  const master = HDKey.fromMasterSeed(seed);

  const evmNode = master.derive("m/44'/60'/0'/0/0");
  if (!evmNode.privateKey) throw new Error("Derivation failed (EVM)");
  const evm = new EthersWallet(hex(evmNode.privateKey)).address;

  const btcMain = master.derive("m/84'/0'/0'/0/0");
  const btcTest = master.derive("m/84'/1'/0'/0/0");
  if (!btcMain.publicKey || !btcTest.publicKey) throw new Error("Derivation failed (BTC)");
  const btcAddr = btc.p2wpkh(btcMain.publicKey, btc.NETWORK).address;
  const btcTestAddr = btc.p2wpkh(btcTest.publicKey, btc.TEST_NETWORK).address;
  if (!btcAddr || !btcTestAddr) throw new Error("Derivation failed (BTC address)");

  const sol = edDerivePath("m/44'/501'/0'/0'", hex(seed));
  const solana = Keypair.fromSeed(sol.key).publicKey.toBase58();

  const tronNode = master.derive("m/44'/195'/0'/0/0");
  if (!tronNode.privateKey) throw new Error("Derivation failed (TRON)");
  const tron = tronAddressFromPrivateKey(hex(tronNode.privateKey));

  return { evm, btc: btcAddr, "btc-testnet": btcTestAddr, solana, tron };
}

// ------------------------------------------------------------ key access

export function evmPrivateKey(secret: string, kind: ImportKind): string {
  if (kind === "seed") {
    const seed = mnemonicToSeedSync(secret.trim().toLowerCase().replace(/\s+/g, " "));
    const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
    if (!node.privateKey) throw new Error("Derivation failed");
    return "0x" + hex(node.privateKey);
  }
  const clean = secret.trim();
  return clean.startsWith("0x") ? clean : "0x" + clean;
}

export function tronPrivateKey(secret: string, kind: ImportKind): string {
  if (kind === "seed") {
    const seed = mnemonicToSeedSync(secret.trim().toLowerCase().replace(/\s+/g, " "));
    const node = HDKey.fromMasterSeed(seed).derive("m/44'/195'/0'/0/0");
    if (!node.privateKey) throw new Error("Derivation failed");
    return hex(node.privateKey);
  }
  return secret.trim().replace(/^0x/, "");
}

export function solanaKeypair(secret: string, kind: ImportKind): Keypair {
  if (kind === "seed") {
    const seed = mnemonicToSeedSync(secret.trim().toLowerCase().replace(/\s+/g, " "));
    const derived = edDerivePath("m/44'/501'/0'/0'", hex(seed));
    return Keypair.fromSeed(derived.key);
  }
  const clean = secret.trim();
  if (clean.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(clean) as number[]));
  }
  const bytes = base58.decode(clean);
  return bytes.length === 64 ? Keypair.fromSecretKey(bytes) : Keypair.fromSeed(bytes);
}

export interface BtcKeys {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  testnet: boolean;
}

export function btcKeys(secret: string, kind: ImportKind, testnet: boolean): BtcKeys {
  if (kind === "seed") {
    const seed = mnemonicToSeedSync(secret.trim().toLowerCase().replace(/\s+/g, " "));
    const node = HDKey.fromMasterSeed(seed).derive(`m/84'/${testnet ? 1 : 0}'/0'/0/0`);
    if (!node.privateKey || !node.publicKey) throw new Error("Derivation failed");
    return { privateKey: node.privateKey, publicKey: node.publicKey, testnet };
  }
  // WIF: version byte + 32-byte key (+ optional 0x01 compressed flag)
  const payload = b58check.decode(secret.trim());
  const version = payload[0];
  const isTestnet = version === 0xef;
  const key = payload.slice(1, 33);
  const publicKey = secp256k1.getPublicKey(key, true);
  return { privateKey: key, publicKey, testnet: isTestnet };
}

export function btcAddressFromKeys(keys: BtcKeys): string {
  const addr = btc.p2wpkh(keys.publicKey, keys.testnet ? btc.TEST_NETWORK : btc.NETWORK).address;
  if (!addr) throw new Error("Could not derive BTC address");
  return addr;
}

// ------------------------------------------------------------ validation

export function validateAddress(family: string, address: string, testnet: boolean): boolean {
  const a = address.trim();
  if (!a) return false;
  try {
    switch (family) {
      case "evm":
        return /^0x[0-9a-fA-F]{40}$/.test(a);
      case "btc": {
        const decoded = btc.Address(testnet ? btc.TEST_NETWORK : btc.NETWORK).decode(a);
        return decoded != null;
      }
      case "solana": {
        const bytes = base58.decode(a);
        return bytes.length === 32;
      }
      case "tron": {
        if (!a.startsWith("T") || a.length !== 34) return false;
        const payload = b58check.decode(a);
        return payload.length === 21 && payload[0] === 0x41;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export function addressesForImport(
  kind: ImportKind,
  secret: string,
): Partial<Record<string, string>> {
  switch (kind) {
    case "seed":
      return deriveFromSeed(secret);
    case "evmKey": {
      const pk = evmPrivateKey(secret, kind);
      return { evm: new EthersWallet(pk).address };
    }
    case "solKey": {
      const kp = solanaKeypair(secret, kind);
      return { solana: kp.publicKey.toBase58() };
    }
    case "btcKey": {
      const main = btcKeys(secret, kind, false);
      const test = btcKeys(secret, kind, true);
      // WIF encodes one network; expose the matching one.
      return main.testnet
        ? { "btc-testnet": btcAddressFromKeys(test) }
        : { btc: btcAddressFromKeys(main) };
    }
    case "tronKey": {
      const pk = tronPrivateKey(secret, kind);
      return { tron: tronAddressFromPrivateKey(pk) };
    }
  }
}

export { unhex, hex };
