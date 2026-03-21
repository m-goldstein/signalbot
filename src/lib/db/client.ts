import fs from "node:fs";
import path from "node:path";
import { getDatabaseProvider, getDatabaseUrl, getSqlitePath } from "@/lib/db/config";

type SqliteClient = {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => unknown;
  };
};
type PostgresClient = {
  unsafe: (query: string, params?: readonly unknown[]) => Promise<unknown>;
};

type DatabaseClients = {
  provider: "sqlite" | "postgres";
  sqlite?: SqliteClient;
  pg?: PostgresClient;
};

let clients: DatabaseClients | null = null;
let clientsPromise: Promise<DatabaseClients> | null = null;
let initialized = false;

async function createSqliteClient() {
  const module = (await import("better-sqlite3")) as {
    default: new (filename: string) => SqliteClient;
  };
  const BetterSqlite3 = module.default;
  const sqlitePath = getSqlitePath();
  const absolutePath = path.isAbsolute(sqlitePath) ? sqlitePath : path.join(process.cwd(), sqlitePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  return new BetterSqlite3(absolutePath);
}

async function createPostgresClient() {
  const module = (await import("postgres")) as {
    default: (url: string, options: object) => PostgresClient;
  };

  return module.default(getDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  });
}

async function getClients(): Promise<DatabaseClients> {
  if (clients) {
    return clients;
  }

  if (clientsPromise) {
    return clientsPromise;
  }

  clientsPromise = (async () => {
    const provider = getDatabaseProvider();
    const resolved =
      provider === "postgres"
        ? { provider, pg: await createPostgresClient() }
        : { provider, sqlite: await createSqliteClient() };

    clients = resolved;
    return resolved;
  })();

  return clientsPromise;
}

async function initializeSqlite(sqlite: SqliteClient) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS watchlist_analysis_jobs (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL,
      contract_symbol TEXT NOT NULL,
      underlying_symbol TEXT NOT NULL,
      status TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      model TEXT,
      result_payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_jobs_contract_requested
      ON watchlist_analysis_jobs (contract_symbol, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_watchlist_jobs_status_requested
      ON watchlist_analysis_jobs (status, requested_at ASC);
  `);
}

async function initializePostgres(pg: PostgresClient) {
  await pg.unsafe(`
    CREATE TABLE IF NOT EXISTS watchlist_analysis_jobs (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL,
      contract_symbol TEXT NOT NULL,
      underlying_symbol TEXT NOT NULL,
      status TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      model TEXT,
      result_payload TEXT
    );
  `);
  await pg.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_watchlist_jobs_contract_requested
    ON watchlist_analysis_jobs (contract_symbol, requested_at DESC);
  `);
  await pg.unsafe(`
    CREATE INDEX IF NOT EXISTS idx_watchlist_jobs_status_requested
    ON watchlist_analysis_jobs (status, requested_at ASC);
  `);
}

export async function ensureDatabase() {
  if (initialized) {
    return await getClients();
  }

  const current = await getClients();

  if (current.provider === "postgres" && current.pg) {
    await initializePostgres(current.pg);
  } else if (current.sqlite) {
    await initializeSqlite(current.sqlite);
  }

  initialized = true;
  return current;
}
