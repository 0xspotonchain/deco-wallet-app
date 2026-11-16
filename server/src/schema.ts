// Drizzle schema for the DECO Wallet space.
//
// The server stores ONLY public data: balance snapshots and activity for
// the two known public wallets (burner + Circle), refreshed by the
// background sync. Private keys and seed phrases never touch this
// database — imported wallets live encrypted in the user's browser.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const balanceSnapshots = sqliteTable("balance_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  walletKey: text("wallet_key").notNull(), // 'burner' | 'circle'
  chainKey: text("chain_key").notNull(),
  assetKey: text("asset_key").notNull(), // 'native' or contract/mint/token id
  symbol: text("symbol").notNull(),
  kind: text("kind", {
    enum: ["native", "token", "nft", "quarantine"],
  }).notNull(),
  contract: text("contract"),
  balance: text("balance").notNull(), // human decimal string, e.g. "0.05"
  decimals: integer("decimals").notNull(),
  updatedAt: integer("updated_at").notNull(), // ms epoch
});

export const activityItems = sqliteTable("activity_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  walletKey: text("wallet_key").notNull(),
  chainKey: text("chain_key").notNull(),
  txHash: text("tx_hash").notNull(),
  direction: text("direction", { enum: ["in", "out", "self"] }).notNull(),
  symbol: text("symbol").notNull(),
  amount: text("amount").notNull(), // human decimal string, signed by direction in UI
  counterparty: text("counterparty"),
  ts: integer("ts").notNull(), // ms epoch
  explorerUrl: text("explorer_url").notNull(),
});

export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey(),
  lastRunAt: integer("last_run_at"),
  status: text("status").notNull().default("never"),
  detail: text("detail"),
});
