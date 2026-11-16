// Transaction execution: sends and swaps for imported wallets.
// Everything is signed locally in the browser; only the signed
// transaction is broadcast to a public RPC / API. Nothing here ever
// transmits a key or seed anywhere.

import {
Contract,
JsonRpcProvider,
Wallet as EthersWallet,
type TransactionRequest,
} from "ethers";
import * as btc from "@scure/btc-signer";
import {
Connection,
PublicKey,
SystemProgram,
Transaction as SolTransaction,
} from "@solana/web3.js";
import {
createAssociatedTokenAccountInstruction,
createTransferInstruction,
getAssociatedTokenAddress,
} from "@solana/spl-token";
import { TronWeb } from "tronweb";
import {
AMM_POOLS,
UNI_V3,
type AmmPool,
type ChainCfg,
} from "./chains";
import { btcKeys, evmPrivateKey, solanaKeypair, tronPrivateKey } from "./derive";
import { formatUnits, parseUnits } from "./live";
import type { ImportKind } from "./vault";

export interface TokenChoice {
  symbol: string;
  contract: string | null; // null = native asset
  decimals: number;
}

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

function evmProvider(chain: ChainCfg): JsonRpcProvider {
  return new JsonRpcProvider(chain.rpcs[0], chain.chainId, { staticNetwork: true });
}

function evmWallet(chain: ChainCfg, secret: string, kind: ImportKind): EthersWallet {
  return new EthersWallet(evmPrivateKey(secret, kind), evmProvider(chain));
}

// ------------------------------------------------------------ EVM send

export async function estimateEvmFee(
  chain: ChainCfg,
  from: string,
  to: string,
  amountRaw: bigint,
  token: TokenChoice,
): Promise<string> {
  const provider = evmProvider(chain);
  let tx: TransactionRequest;
  if (!token.contract) {
    tx = { from, to, value: amountRaw };
  } else {
    const iface = new Contract(token.contract, ERC20_ABI, provider).interface;
    tx = { from, to: token.contract, data: iface.encodeFunctionData("transfer", [to, amountRaw]) };
  }
  const [gasLimit, feeData] = await Promise.all([provider.estimateGas(tx), provider.getFeeData()]);
  const price = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
  const fee = gasLimit * price;
  return `${formatUnits(fee, chain.nativeDecimals)} ${chain.nativeSymbol}`;
}

export async function sendEvm(
  chain: ChainCfg,
  secret: string,
  kind: ImportKind,
  to: string,
  amountRaw: bigint,
  token: TokenChoice,
): Promise<string> {
  const wallet = evmWallet(chain, secret, kind);
  if (!token.contract) {
    const tx = await wallet.sendTransaction({ to, value: amountRaw });
    return tx.hash;
  }
  const contract = new Contract(token.contract, ERC20_ABI, wallet);
  const tx = (await contract.getFunction("transfer")(to, amountRaw)) as { hash: string };
  return tx.hash;
}

// ------------------------------------------------------------ BTC send

interface Utxo { txid: string; vout: number; value: number }

async function btcFeeRate(base: string): Promise<number> {
  try {
    const res = await fetch(`${base}/api/v1/fees/recommended`, { signal: AbortSignal.timeout(10000) });
    const data = (await res.json()) as { halfHourFee?: number };
    return Math.max(1, data.halfHourFee ?? 2);
  } catch {
    return 2;
  }
}

export async function estimateBtcFee(
  chain: ChainCfg,
  address: string,
  amountSats: bigint,
): Promise<string> {
  const base = chain.rpcs[0] ?? "";
  const [utxos, rate] = await Promise.all([
    (await fetch(`${base}/api/address/${address}/utxos`, { signal: AbortSignal.timeout(12000) })).json() as Promise<Utxo[]>,
    btcFeeRate(base),
  ]);
  let total = 0n;
  let inputs = 0;
  for (const u of utxos) {
    total += BigInt(u.value);
    inputs++;
    if (total >= amountSats) break;
  }
  const vbytes = 10 + inputs * 68 + 2 * 31;
  return `${formatUnits(BigInt(Math.ceil(vbytes * rate)), 8)} BTC`;
}

export async function sendBtc(
  chain: ChainCfg,
  secret: string,
  kind: ImportKind,
  to: string,
  amountSats: bigint,
): Promise<string> {
  const testnet = chain.network === "testnet";
  const network = testnet ? btc.TEST_NETWORK : btc.NETWORK;
  const keys = btcKeys(secret, kind, testnet);
  const base = chain.rpcs[0] ?? "";
  const myAddr = btc.p2wpkh(keys.publicKey, network);
  const utxos = (await (await fetch(`${base}/api/address/${myAddr.address}/utxos`, {
    signal: AbortSignal.timeout(12000),
  })).json()) as Utxo[];
  const rate = await btcFeeRate(base);
  // Coin selection with a fee feedback loop (P2WPKH ~68 vB in, ~31 vB out).
  let selected: Utxo[] = [];
  let total = 0n;
  let fee = 0n;
  for (const u of [...utxos].sort((a, b) => b.value - a.value)) {
    selected.push(u);
    total += BigInt(u.value);
    const vbytes = 10 + selected.length * 68 + 2 * 31;
    fee = BigInt(Math.ceil(vbytes * rate));
    if (total >= amountSats + fee) break;
  }
  if (total < amountSats + fee) throw new Error("Insufficient BTC balance for amount + fee");
  const change = total - amountSats - fee;
  const tx = new btc.Transaction();
  for (const u of selected) {
    tx.addInput({
      txid: u.txid,
      index: u.vout,
      witnessUtxo: { script: myAddr.script, amount: BigInt(u.value) },
    });
  }
  tx.addOutputAddress(to, amountSats, network);
  if (change >= 546n) {
    tx.addOutputAddress(myAddr.address ?? "", change, network);
  }
  tx.sign(keys.privateKey);
  tx.finalize();
  const res = await fetch(`${base}/api/tx`, {
    method: "POST",
    body: tx.hex,
    headers: { "Content-Type": "text/plain" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Broadcast failed: ${await res.text()}`);
  return (await res.text()).trim();
}

// ------------------------------------------------------------ Solana send

export async function sendSolana(
  chain: ChainCfg,
  secret: string,
  kind: ImportKind,
  to: string,
  amountRaw: bigint,
  token: TokenChoice,
): Promise<string> {
  const connection = new Connection(chain.rpcs[0] ?? "", "confirmed");
  const kp = solanaKeypair(secret, kind);
  const dest = new PublicKey(to);
  const tx = new SolTransaction();
  if (!token.contract) {
    tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: dest, lamports: amountRaw }));
  } else {
    const mint = new PublicKey(token.contract);
    const source = await getAssociatedTokenAddress(mint, kp.publicKey);
    const destAta = await getAssociatedTokenAddress(mint, dest);
    const destInfo = await connection.getAccountInfo(destAta);
    if (!destInfo) {
      tx.add(createAssociatedTokenAccountInstruction(kp.publicKey, destAta, dest, mint));
    }
    tx.add(createTransferInstruction(source, destAta, kp.publicKey, amountRaw));
  }
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = kp.publicKey;
  tx.sign(kp);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  return sig;
}

// ------------------------------------------------------------ TRON send

function tronWeb(chain: ChainCfg, secret: string, kind: ImportKind): InstanceType<typeof TronWeb> {
  const tw = new TronWeb({ fullHost: chain.rpcs[0] ?? "" });
  tw.setPrivateKey(tronPrivateKey(secret, kind));
  return tw;
}

export async function sendTron(
  chain: ChainCfg,
  secret: string,
  kind: ImportKind,
  to: string,
  amountRaw: bigint,
  token: TokenChoice,
): Promise<string> {
  const tw = tronWeb(chain, secret, kind);
  if (!token.contract) {
    const result = (await tw.trx.sendTransaction(to, Number(amountRaw))) as {
      result?: boolean;
      txid?: string;
      transaction?: { txID?: string };
    };
    const txid = result.txid ?? result.transaction?.txID;
    if (!result.result || !txid) throw new Error("TRON transfer was rejected by the network");
    return txid;
  }
  const contract = await tw.contract().at(token.contract);
  const txid = (await contract.transfer(to, amountRaw.toString()).send()) as string;
  return txid;
}

// ------------------------------------------------------------ AMM swap (testnet)

const AMM_ABI = [
  "function getReserves() view returns (uint256 decoReserve, uint256 baseReserve)",
  "function buy(uint256 baseAmountIn, uint256 minDecoOut) payable",
  "function sell(uint256 decoAmountIn, uint256 minBaseOut)",
];

export function ammAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const withFee = amountIn * 997n;
  return (withFee * reserveOut) / (reserveIn * 1000n + withFee);
}

export async function ammReserves(chain: ChainCfg, pool: AmmPool): Promise<{ deco: bigint; base: bigint }> {
  const provider = evmProvider(chain);
  const contract = new Contract(pool.pool, AMM_ABI, provider);
  const [deco, base] = (await contract.getFunction("getReserves")()) as unknown as [bigint, bigint];
  return { deco, base };
}

async function ensureAllowance(
  wallet: EthersWallet,
  tokenContract: string,
  spender: string,
  amount: bigint,
): Promise<void> {
  const token = new Contract(tokenContract, ERC20_ABI, wallet);
  const current = (await token.getFunction("allowance")(wallet.address, spender)) as bigint;
  if (current < amount) {
    const tx = (await token.getFunction("approve")(spender, amount)) as { wait: () => Promise<unknown> };
    await tx.wait();
  }
}

export async function swapAmm(
  chain: ChainCfg,
  pool: AmmPool,
  secret: string,
  kind: ImportKind,
  direction: "buy" | "sell", // buy: base -> DECO, sell: DECO -> base
  amountInRaw: bigint,
  slippagePct: number,
): Promise<string> {
  const wallet = evmWallet(chain, secret, kind);
  const contract = new Contract(pool.pool, AMM_ABI, wallet);
  const reserves = await ammReserves(chain, pool);
  const expected = direction === "buy"
    ? ammAmountOut(amountInRaw, reserves.base, reserves.deco)
    : ammAmountOut(amountInRaw, reserves.deco, reserves.base);
  if (expected <= 0n) throw new Error("Pool returned a zero quote — try a smaller amount");
  const minOut = (expected * BigInt(Math.round((100 - slippagePct) * 100))) / 10000n;
  if (direction === "buy") {
    if (pool.quoteContract) {
      await ensureAllowance(wallet, pool.quoteContract, pool.pool, amountInRaw);
      const tx = (await contract.getFunction("buy")(amountInRaw, minOut)) as { hash: string };
      return tx.hash;
    }
    const tx = (await contract.getFunction("buy")(amountInRaw, minOut, { value: amountInRaw })) as { hash: string };
    return tx.hash;
  }
  await ensureAllowance(wallet, pool.deco, pool.pool, amountInRaw);
  const tx = (await contract.getFunction("sell")(amountInRaw, minOut)) as { hash: string };
  return tx.hash;
}

// ------------------------------------------------------------ Uniswap V3 (mainnet)

const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];
const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
];

export interface UniQuote {
  amountOut: bigint;
  fee: number;
}

export async function quoteUniV3(
  chain: ChainCfg,
  tokenIn: TokenChoice,
  tokenOut: TokenChoice,
  amountInRaw: bigint,
): Promise<UniQuote | null> {
  const cfg = UNI_V3[chain.key];
  if (!cfg) return null;
  const weth = chain.tokens.find((t) => t.symbol === "WETH");
  if (!weth) return null;
  const inAddr = tokenIn.contract ?? weth.contract;
  const outAddr = tokenOut.contract ?? weth.contract;
  if (inAddr.toLowerCase() === outAddr.toLowerCase()) return null;
  const provider = evmProvider(chain);
  const quoter = new Contract(cfg.quoter, QUOTER_ABI, provider);
  let best: UniQuote | null = null;
  for (const fee of [500, 3000, 10000]) {
    try {
      const res = (await quoter.getFunction("quoteExactInputSingle").staticCall({
        tokenIn: inAddr, tokenOut: outAddr, amountIn: amountInRaw, fee, sqrtPriceLimitX96: 0,
      })) as unknown as [bigint, bigint, number, bigint];
      if (res[0] > 0n && (!best || res[0] > best.amountOut)) best = { amountOut: res[0], fee };
    } catch { /* tier has no pool */ }
  }
  return best;
}

export async function swapUniV3(
  chain: ChainCfg,
  secret: string,
  kind: ImportKind,
  tokenIn: TokenChoice,
  tokenOut: TokenChoice,
  amountInRaw: bigint,
  quote: UniQuote,
  slippagePct: number,
): Promise<string> {
  const cfg = UNI_V3[chain.key];
  if (!cfg) throw new Error("Uniswap is not available on this chain");
  const weth = chain.tokens.find((t) => t.symbol === "WETH");
  if (!weth) throw new Error("WETH not configured for this chain");
  const wallet = evmWallet(chain, secret, kind);
  const router = new Contract(cfg.router, ROUTER_ABI, wallet);
  const inAddr = tokenIn.contract ?? weth.contract;
  const outAddr = tokenOut.contract ?? weth.contract;
  const minOut = (quote.amountOut * BigInt(Math.round((100 - slippagePct) * 100))) / 10000n;
  const nativeIn = tokenIn.contract === null;
  const nativeOut = tokenOut.contract === null;
  if (!nativeIn && tokenIn.contract) {
    await ensureAllowance(wallet, tokenIn.contract, cfg.router, amountInRaw);
  }
  const params = {
    tokenIn: inAddr,
    tokenOut: outAddr,
    fee: quote.fee,
    recipient: nativeOut ? cfg.router : wallet.address,
    amountIn: amountInRaw,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0,
  };
  const deadline = Math.floor(Date.now() / 1000) + 1200;
  if (nativeOut) {
    const swapData = router.interface.encodeFunctionData("exactInputSingle", [params]);
    const unwrapData = router.interface.encodeFunctionData("unwrapWETH9", [minOut, wallet.address]);
    const tx = (await router.getFunction("multicall")(deadline, [swapData, unwrapData], {
      value: nativeIn ? amountInRaw : 0n,
    })) as { hash: string };
    return tx.hash;
  }
  const tx = (await router.getFunction("exactInputSingle")(params, { value: nativeIn ? amountInRaw : 0n })) as { hash: string };
  return tx.hash;
}

export { AMM_POOLS, parseUnits };
