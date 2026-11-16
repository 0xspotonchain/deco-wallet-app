# Data Plan

## Context provenance
- `Bro upgrade our wallet so I can also use it, send receive swap import wallet etc` / `And sync background always` / `Mainnet - testnet all multichain` (verbatim user request; defines the whole scope: full wallet, background sync, both networks, all chains)
- Build brief at `~/workspace/wallet-app/build-brief.md` (handed off by the parent agent; source of every wallet address, chain id, RPC, token contract, AMM pool, and the client-side import security model below)
- `the app must NOT read or copy the VM keystore` / `Keys and seed phrases NEVER leave the device` / `Signing happens locally in the browser; only the signed transaction is broadcast via public RPC` (brief security rules; architecture: server stores ONLY public-address balance/activity snapshots, all key material lives in an encrypted browser vault)
- `Circle wallet — READ-ONLY display (USDC on Arc only)` (brief; Circle rows are display-only, no send/swap UI)
- `If mainnet routing is not feasible in v1, ship testnet swap first and mark mainnet swap as coming next — do not fake it` (brief; mainnet swap = Uniswap V3 on Ethereum/Base where the router probe succeeds, otherwise an honest unavailable state)
- `QUARANTINED, never auto-interact, show in a separate section: BZND ... and tenergy.dev` (brief; quarantined tokens render display-only with no send action)
- Existing read-only `wallet-dashboard` artifact (dark #0a0a0f, gold #f0b13e accent) is the style base per the brief.

## Tested sources
### Public EVM RPCs (balances, gas, eth_call, broadcast)
**Used by**: server `syncNow` action (known wallets) and in-browser live refresh + send/swap signing flows (imported wallets)
**Test command**: `curl -X POST <rpc> -d eth_getBalance/eth_call/eth_chainId` for Sepolia, Arc testnet, Robinhood, LitVM, Velana, Base mainnet, Ethereum mainnet
**Sample output**: Sepolia burner balance `0x8e1bc9be5f311f` (~0.04 ETH); Arc testnet Circle wallet `0x4563918244f400000` (1280 USDC at 18 decimals — Arc native USDC is 18-dec); Base mainnet chainId `0x2105` (8453); Velana chainId `0x76334` (484148); LitVM chainId `0x1159` (4441)
**Processing**: chain/token/RPC table lifted from `~/workspace/wallet-balances/check-balances.py` (verified on-chain 2026-11-16): USDC/EURC contracts for Sepolia, Base Sepolia, Arb Sepolia, OP Sepolia, Arc testnet EURC; browser-like User-Agent header on every call (several RPCs 403 default agents)

### SimpleAMM pools (testnet swap)
**Used by**: client swap screen (quote via getReserves + getAmountOut math, buy/sell signed locally)
**Test command**: `eth_call getReserves() (0x0902f1ac)` on Robinhood pool `0xC72A740883E93E899C02036f96841869A5BdbbDC` and Arc pool `0x3137C615F3f3B1e7C8F75390F8ccb128f4D11A3A`
**Sample output**: both returned two nonzero uint256 reserves (live liquidity on both pools)
**Processing**: ABI from `~/workspace/tokens/contracts/SimpleAMM.sol` — `buy(baseAmountIn, minDecoOut)` payable when quote is native, `sell(decoAmountIn, minBaseOut)` after ERC-20 approve; 0.3% fee constant-product quote computed client-side from reserves; slippage control sets minOut

### Uniswap (mainnet swap)
**Used by**: client swap screen on Ethereum/Base mainnet
**Test command**: `eth_getCode 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` (V2 router) via ethereum-rpc.publicnode.com
**Sample output**: non-empty contract bytecode returned (router deployed)
**Processing**: quote + swap via the deployed Uniswap router for the chain with a minimal ABI; pairs limited to native/WETH vs USDC/USDT; if a chain has no working router path the swap screen says so plainly (per brief, never faked)

### mempool.space API (Bitcoin mainnet + testnet4)
**Used by**: server sync (balances, UTXOs, activity) and client BTC send (UTXO fetch + broadcast via /api/tx)
**Test command**: `curl https://mempool.space/testnet4/api/address/tb1qzk55m8k55e5p835y58qrlesw26z8j3ch4pkvxp`
**Sample output**: `funded_txo_sum: 2000, spent_txo_sum: 0, tx_count: 2` (2,000 sats, matches memory)
**Processing**: balance = funded − spent chain_stats; fee estimate from /api/v1/fees/recommended

### Solana RPC (mainnet + devnet)
**Used by**: server sync + client send (getBalance, getLatestBlockhash, sendTransaction, getSignaturesForAddress)
**Test command**: `curl -X POST https://api.devnet.solana.com -d getBalance(DcvJCguHLqQE52hpDvtoLG2wBNuK82tHCWpsgySRH6rL)`
**Sample output**: `value: 25000000` lamports (0.025 devnet SOL, matches the ZalalenA faucet claim)
**Processing**: lamports → SOL; SPL token balances via getTokenAccountsByOwner in sync

### TRON (trongrid + Tronscan Nile API)
**Used by**: server sync + client TRON send via tronweb
**Test command**: `curl -X POST https://nile.trongrid.io/wallet/getaccount {address: TXPdam3wpEfcEGhmvkcpb5rRyeyTkRT46p, visible: true}`
**Sample output**: `balance: 2000000000` sun (2,000 test TRX, matches memory)
**Processing**: sun → TRX; token list from nileapi.tronscan.org account tokens (source of the quarantined tenergy.dev row and test USDT `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`)

### Blockscout v2 APIs (activity + token discovery)
**Used by**: server sync for per-chain recent transactions and full ERC-20 token lists (incl. Robinhood stock tokens and Circle-wallet BZND) on Sepolia, Base Sepolia, OP Sepolia, Robinhood, LitVM, Arc
**Test command**: `curl https://eth-sepolia.blockscout.com/api/v2/addresses/0xF1d9.../transactions`
**Sample output**: API reachable and schema-valid (rejected only the wrong `page_size` param; correct param is `items_per_page`)
**Processing**: `/api/v2/addresses/{addr}/transactions` and `/tokens`; direction, value, token, timestamp normalized into activity rows with explorer tx links

### Client-side crypto libraries (npm)
**Used by**: in-browser vault + signing only — never on the server
**Test command**: `curl https://registry.npmjs.org/ethers/latest` returned ethers 6.17.0 metadata (registry reachable from the VM)
**Sample output**: same library set the VM wallet itself runs (`~/workspace/multichain-wallet/package.json`: bip39, @scure/bip32, ethers, @solana/web3.js, tronweb) plus @scure/btc-signer (pure-JS BIP84, avoids WASM ecc bundling issues) and qrcode generation
**Processing**: BIP39 seed → EVM m/44'/60'/0'/0/0, BTC m/84'/coin'/0'/0/0, Solana m/44'/501'/0'/0' (SLIP-0010 ed25519), TRON m/44'/195'/0'/0/0; vault = scrypt KDF (pure-JS, mirroring `~/workspace/multichain-wallet/backup/decrypt-offline.html`) + AES-GCM via WebCrypto, ciphertext in localStorage only

### Brand asset
- Gold DC logo: `~/workspace/tokens/deco-logo-512.png` (user's own brand file) copied into `client/src/assets/` at build time and imported — the one image in the app; token/chain marks are typographic monograms, no other imagery needed.

### Multichain expansion + custom token import (edit 2026-11-16, user: "Make sure it's supported for all multichain and it's tokens Bro, and also add custom import token CA")
**Used by**: client `lib/chains.ts` + server `server/src/chains.ts` (mirrored tables), client live reads, Uniswap swap picker
**Test command**: python JSON-RPC probe — `eth_chainId` + `eth_call symbol() (0x95d89b41)` / `decimals() (0x313ce567)` per token contract, `eth_getCode` on Uniswap SwapRouter02 `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` + QuoterV2 `0x61fFE014bA17989E743c5F6cB21bF9697530B21e`
**Sample output**: Arbitrum chainId `0xa4b1` (USDC/USDT/WETH verified, router+quoter code 24497/8273 bytes); Optimism `0xa` (same, router+quoter deployed); Polygon via `https://polygon-bor-rpc.publicnode.com` chainId `0x89` (USDC/USDT/WETH verified, router+quoter deployed; `polygon-rpc.com` returned 401 from the VM so publicnode is primary); BSC `0x38` (USDT/USDC/WBNB verified — note BSC stables are 18 decimals); Avalanche via `https://avalanche-c-chain-rpc.publicnode.com` chainId `0xa86a` (USDC/USDT/WAVAX verified; Uniswap router NOT deployed there → no Uni swap on Avalanche/BSC, honest unavailable); Ethereum DAI/WBTC and Base DAI verified the same way. Blockscout: Optimism works via `https://explorer.optimism.io` (200 on `/api/v2/addresses/.../tokens`); Arbitrum and Polygon Blockscout instances return 403 → `blockscout: null` there (static tokens + custom imports still read via RPC; no auto-discovery/activity on those two chains).
**Processing**: five new mainnet EVM chains (Arbitrum One, Optimism, Polygon, BNB Chain, Avalanche) added to both chain tables, so the background sync covers them for the burner automatically; Uniswap V3 swap extended to Arbitrum/Optimism/Polygon. Solana live reads now enumerate BOTH SPL programs (legacy Token + Token-2022) and label well-known mints (USDC/USDT/JUP/BONK + devnet USDC). TRON mainnet TRC-20 rows now resolve real symbol/decimals from the contract via trongrid `triggerconstantcontract` instead of a truncated label + assumed 6 decimals.
**Custom import token CA**: device-local only (localStorage `deco-wallet.custom-tokens.v1`, scoped per wallet; server never sees them — same posture as the vault). Import flow (`client/src/screens/ImportToken.tsx` + `client/src/lib/customTokens.ts`): pick any non-BTC chain of the selected wallet/network → paste CA → metadata read from the chain itself (ERC-20 `eth_getCode` + `symbol()`/`name()`/`decimals()`; SPL `getParsedAccountInfo` for decimals, symbol user-labelled since mints carry none on-chain; TRC-20 `triggerconstantcontract` symbol/name/decimals) → confirm/edit symbol → saved. Balances are then fetched every live refresh (EVM `balanceOf`, Solana mint-filtered `getTokenAccountsByOwner` on both programs, TRON `balanceOf` constant call) and flow into Portfolio (with a "custom" badge, shown even at zero), Send (via the balances-derived token list), and the Uniswap picker. Quarantined tokens (BZND / tenergy names) are refused at import. Removable from the import sheet's per-wallet list.

## Long-term data behavior
- **Refresh policy**: server `syncNow` action re-reads every public source for the two known wallets (burner + Circle) and upserts snapshot rows; installed as an artifact-owned cron (space_action) running frequently around the clock per the refresh trigger. Client also live-refreshes in-browser on open and every 60s while open, and imported wallets are fetched client-side only (their addresses never go to the server).
- **Growth**: balance snapshots are one row per wallet×chain×asset, upserted in place (no history growth); activity keeps the latest ~25 items per wallet×chain, pruned on each sync.
- **Ordering**: activity newest-first by chain timestamp; assets ordered native first, then DECO/brand tokens, then stables, then others; quarantined tokens always in their own section.
- **Time semantics**: all timestamps stored as chain-reported instants (ms epoch) and rendered viewer-local in GMT+7-labelled copy where the UI states a zone; sync rows carry a `synced_at` instant so the UI can honestly show data age.

## Rejected approaches
- **Tried**: server-side signing / reading the VM keystore from the app
  **Why rejected**: explicitly forbidden by the brief's non-negotiable security model; keys stay in the user's browser vault, the server only ever sees public addresses and signed transactions are broadcast by the client straight to public RPCs.
- **Tried**: pricing the portfolio in USD from an unverified price source
  **Why rejected**: no price feed was probed or requested; showing invented fiat values would violate data honesty. Balances render in native/token units only.
- **Tried**: bitcoinjs-lib + tiny-secp256k1 for BTC signing in the browser bundle
  **Why rejected**: WASM ecc loading is fragile in the bundled iframe client; @scure/btc-signer (pure JS, same scure family as the verified derivation libs) covers BIP84 send construction.
