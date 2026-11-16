# DECO Wallet

A full multichain wallet app — send, receive, swap, and import wallets — mainnet + testnet, with background sync. Built for [deco](https://0xspotonchain.github.io/deco/) and live as a Muse Space app.

> **This is the source of the DECO Wallet app.** It is a code repo, not a deployment — see [Running it](#running-it) for how the pieces fit together.

**v2 (2026-11-16):** 5 new mainnet EVM chains (Arbitrum One, Optimism, Polygon, BNB Chain, Avalanche) with verified USDC/USDT/wrapped-native tokens; Uniswap V3 swapping extended to Arbitrum/Optimism/Polygon; Solana Token-2022 support + token labels; TRON TRC-20 real metadata; custom token import by contract address (CA) on the Wallet tab.

## What it does

- **Balances + activity** for the burner wallet and the Circle wallet, across 18 EVM chains (Ethereum, Sepolia, Hoodi, Base, Base Sepolia, Arbitrum One, Arbitrum Sepolia, Optimism, Optimism Sepolia, Polygon, BNB Chain, Avalanche, Arc testnet + mainnet, Robinhood Chain testnet, LitVM, Velana, Polygon Amoy) plus Bitcoin (mainnet + testnet4), Solana (mainnet + devnet), and TRON (mainnet + Nile testnet).
- **Import** by 12-word BIP39 seed phrase or per-chain private key. Derived addresses: EVM `m/44'/60'/0'/0/0`, BTC SegWit `m/84'/coin'/0'/0/0`, Solana `m/44'/501'/0'/0'`, TRON `m/44'/195'/0'/0/0`.
- **Send** on every chain family, with fee estimate + review screen. Mainnet sends and swaps require an explicit in-app real-funds confirmation.
- **Receive** via QR code + copyable address per chain.
- **Swap**: testnet via our own SimpleAMM DECO pools (Arc, Robinhood, LitVM, Velana) + the Robinhood Uniswap v4 pool; mainnet EVM via Uniswap V3 on Ethereum, Base, Arbitrum, Optimism, and Polygon, with live quotes + slippage control. (Uniswap V3 is not deployed at the canonical addresses on BNB Chain or Avalanche, so those chains honestly have no in-app Uni swap.)
- **Background sync every 15 minutes** (server) + live refresh on open and every 60s (client). The server only reads public RPCs/explorers and stores public-address balance/activity snapshots.
- **Tokens**: DECO, DM, DNFT, and the Robinhood stock tokens, plus verified majors per chain (USDC/USDT/wrapped native on the new mainnet chains; DAI + WBTC on Ethereum, DAI on Base). Solana reads both SPL programs (legacy Token + Token-2022) and labels well-known mints (USDC, USDT, JUP, BONK). TRON TRC-20 rows resolve real symbol/decimals from the contract. Unknown/spam tokens (BZND, tenergy.dev) are quarantined — display only, no send action.
- **Custom token import by contract address (CA)** — on the Wallet tab, paste any token's contract address (EVM ERC-20, Solana SPL mint, or TRON TRC-20) and the app reads its metadata straight from the chain (symbol, name, decimals) and tracks its balance on every refresh. Imported tokens show with a "custom" badge, flow into Send and the Uniswap picker, and can be removed from the import sheet. Storage is device-only (browser localStorage, per wallet) — the server never sees them. Quarantined tokens are refused at import.
- **Circle wallet is read-only display** (USDC on Arc only). The app never reads the VM keystore.

## Security model

- **Keys never leave the device.** Imported seeds/private keys are encrypted in the browser with a user-set password (scrypt KDF + AES-GCM) and stored in browser localStorage/IndexedDB only. They are never sent to any server, never logged, and never stored in the app database.
- **Signing happens locally** in the browser. Only the signed transaction is broadcast via public RPC.
- **The server stores public data only** — balance snapshots and activity rows for public addresses. It holds no key material of any kind.
- **Custom token imports are device-local only** — stored in browser localStorage, scoped per wallet; the server never sees them, same posture as the vault.
- **Lock screen + auto-lock.** The seed is shown once at import with a warning, then hidden.
- **No secrets in this repo.** No API keys, no credentials, no private keys, no keystore material. All chain data comes from public RPCs and explorer APIs.

## Layout

```
client/                 React 19 + TypeScript client (Tailwind)
  src/
    screens/            Portfolio, Send, Swap, Activity, Wallets, ImportToken
    lib/
      vault.ts          Encrypted browser vault (scrypt + AES-GCM)
      derive.ts         BIP39 / per-chain key derivation + signing helpers
      tx.ts             Transaction building + broadcast
      chains.ts         Chain / token / RPC / explorer table
      live.ts           Live client-side balance + activity reads
      data.ts           Client data layer
      customTokens.ts   Custom token imports (device-local, per wallet)
    components/         Shared UI
    assets/             DECO logo
server/                 Server actions (TypeScript, Bun)
  src/
    actions.ts          Declared actions (syncNow, reads)
    sync.ts             Background sync — public RPC reads only
    chains.ts           Server-side chain/token table
    schema.ts           Drizzle schema
drizzle/                SQL migrations (balance snapshots + activity)
space.json              Muse Space runtime config (slug: deco-wallet)
DATA-PLAN.md            Build-time data plan: every source, test, and decision
```

## Running it

This app was built as a **Muse Space** (fullstack web artifact) and runs on the Muse Spaces runtime:

- The **client** is a standard React + TypeScript app — `bun install` then `bun run build:client` produces the bundle (see `client/build.mjs`).
- The **server** uses `@hatch/space-sdk`, which is a Muse-runtime package resolved from the local runtime (`file:/opt/hatch/skills/spaces/ts-runtime/dist/space-sdk.tgz` in `package.json`). Outside the Muse VM that dependency does not resolve, so the server layer as-is only runs inside Muse. The client code, the chain/token tables, the vault, and the derivation/signing code are all standard and portable.
- The background sync is a managed cron (`space-deco-wallet-sync`, every 15 min) installed by the runtime.

Typecheck: `bun run typecheck`. Build: `bun run build`.

## Wallets shown by default

- **Burner (multichain)** — EVM `0xF1d949ed9B0b62508203AB0B91Bf01E73309Ad31`, BTC `bc1q9473rsxyha0pl8w2sjcawy6ulyumpr4xch7822`, Solana `DcvJCguHLqQE52hpDvtoLG2wBNuK82tHCWpsgySRH6rL`, TRON `TXPdam3wpEfcEGhmvkcpb5rRyeyTkRT46p`
- **Circle (Arc, read-only)** — testnet `0xc7d81269debced5e62069a4d42950965853aa300`, mainnet `0xe7ad575b529ba58ad811fe02df67aaa44dc42f44`

## Related

- Website: https://0xspotonchain.github.io/deco/
- Burner-wallet tooling (npm package): https://github.com/0xspotonchain/deco-wallet
- Tokens (DECO, DM, DNFT): https://github.com/0xspotonchain/deco-tokens
- Sniper + volume bots: https://github.com/0xspotonchain/deco-sniper

## Credits

Built with [Muse](https://muse.ai). DECO logo by deco.

DYOR — don't trust, verify. Not your keys, not your coins.
