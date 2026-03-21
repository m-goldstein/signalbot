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

const loadRuntimeModule = (moduleName: string) =>
  (0, eval)("require")(moduleName) as unknown;

type DatabaseClients = {
  provider: "sqlite" | "postgres";
  sqlite?: SqliteClient;
  pg?: PostgresClient;
};

let clients: DatabaseClients | null = null;
let initialized = false;

function createSqliteClient() {
  const BetterSqlite3 = loadRuntimeModule("better-sqlite3") as new (filename: string) => SqliteClient;
  const sqlitePath = getSqlitePath();
  const absolutePath = path.isAbsolute(sqlitePath) ? sqlitePath : path.join(process.cwd(), sqlitePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  return new BetterSqlite3(absolutePath);
}

function createPostgresClient() {
  const postgres = (
    loadRuntimeModule("postgres") as
      | { default?: (url: string, options: object) => PostgresClient }
      | ((url: string, options: object) => PostgresClient)
  );
  const factory = typeof postgres === "function" ? postgres : postgres.default;

  if (!factory) {
    throw new Error("Unable to load postgres client.");
  }

  return factory(getDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
  });
}

function getClients(): DatabaseClients {
  if (clients) {
    return clients;
  }

  const provider = getDatabaseProvider();

  clients =
    provider === "postgres"
      ? { provider, pg: createPostgresClient() }
      : { provider, sqlite: createSqliteClient() };

  return clients;
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
    return getClients();
  }

  const current = getClients();

  if (current.provider === "postgres" && current.pg) {
    await initializePostgres(current.pg);
  } else if (current.sqlite) {
    await initializeSqlite(current.sqlite);
  }

  initialized = true;
  return current;
}
