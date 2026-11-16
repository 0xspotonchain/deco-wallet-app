DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_key TEXT NOT NULL,
  chain_key TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  kind TEXT NOT NULL,
  contract TEXT,
  balance TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (wallet_key, chain_key, asset_key)
);
--> statement-breakpoint
CREATE TABLE activity_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_key TEXT NOT NULL,
  chain_key TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  direction TEXT NOT NULL,
  symbol TEXT NOT NULL,
  amount TEXT NOT NULL,
  counterparty TEXT,
  ts INTEGER NOT NULL,
  explorer_url TEXT NOT NULL,
  UNIQUE (wallet_key, chain_key, tx_hash)
);
--> statement-breakpoint
CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY,
  last_run_at INTEGER,
  status TEXT NOT NULL DEFAULT 'never',
  detail TEXT
);
