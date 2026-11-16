// Actions for the DECO Wallet artifact.
//
// The server is a public-data cache only: it syncs balances and activity
// for the two known public wallets (burner + Circle) from public RPCs and
// explorer APIs. Private keys never reach the server — imported wallets
// are decrypted, signed, and broadcast entirely in the user's browser.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { asc, desc } from "drizzle-orm";
import * as schema from "./schema";
import { runSync } from "./sync";

const balanceRow = z.object({
  chainKey: z.string(),
  assetKey: z.string(),
  symbol: z.string(),
  kind: z.enum(["native", "token", "nft", "quarantine"]),
  contract: z.string().nullable(),
  balance: z.string(),
  decimals: z.number(),
  updatedAt: z.number(),
});

const activityRow = z.object({
  chainKey: z.string(),
  txHash: z.string(),
  direction: z.enum(["in", "out", "self"]),
  symbol: z.string(),
  amount: z.string(),
  counterparty: z.string().nullable(),
  ts: z.number(),
  explorerUrl: z.string(),
});

const portfolioResponse = z.object({
  wallets: z.array(
    z.object({
      key: z.string(),
      balances: z.array(balanceRow),
      activity: z.array(activityRow),
    }),
  ),
  sync: z.object({
    lastRunAt: z.number().nullable(),
    status: z.string(),
    detail: z.string().nullable(),
  }),
});

export const Actions = {
  getPortfolio: defineAction({
    description:
      "Returns the latest background-synced balances and activity for the burner and Circle wallets, plus sync status.",
    request: z.object({}),
    response: portfolioResponse,
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [bals, acts, syncRows] = await Promise.all([
        db.select().from(schema.balanceSnapshots).orderBy(asc(schema.balanceSnapshots.id)),
        db
          .select()
          .from(schema.activityItems)
          .orderBy(desc(schema.activityItems.ts))
          .limit(400),
        db.select().from(schema.syncState),
      ]);
      const byWallet = new Map<string, { balances: typeof bals; activity: typeof acts }>();
      for (const key of ["burner", "circle"]) byWallet.set(key, { balances: [], activity: [] });
      for (const b of bals) byWallet.get(b.walletKey)?.balances.push(b);
      for (const a of acts) byWallet.get(a.walletKey)?.activity.push(a);
      const sync = syncRows[0];
      return {
        wallets: [...byWallet.entries()].map(([key, v]) => ({
          key,
          balances: v.balances.map((b) => ({
            chainKey: b.chainKey,
            assetKey: b.assetKey,
            symbol: b.symbol,
            kind: b.kind,
            contract: b.contract,
            balance: b.balance,
            decimals: b.decimals,
            updatedAt: b.updatedAt,
          })),
          activity: v.activity.map((a) => ({
            chainKey: a.chainKey,
            txHash: a.txHash,
            direction: a.direction,
            symbol: a.symbol,
            amount: a.amount,
            counterparty: a.counterparty,
            ts: a.ts,
            explorerUrl: a.explorerUrl,
          })),
        })),
        sync: {
          lastRunAt: sync?.lastRunAt ?? null,
          status: sync?.status ?? "never",
          detail: sync?.detail ?? null,
        },
      };
    },
  }),

  syncNow: defineAction({
    description:
      "Re-reads every public chain source for the burner and Circle wallets and refreshes the stored balance and activity snapshots.",
    request: z.object({}),
    response: z.object({
      ok: z.number(),
      failed: z.number(),
      detail: z.string(),
    }),
    async handler(ctx) {
      const result = await runSync(ctx);
      ctx.invalidateQueries();
      return result;
    },
  }),
} satisfies ActionsModule;
