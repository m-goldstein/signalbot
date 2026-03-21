export type DatabaseProvider = "sqlite" | "postgres";

export function getDatabaseProvider(): DatabaseProvider {
  const provider = process.env.DATABASE_PROVIDER?.trim().toLowerCase();

  if (provider === "postgres") {
    return "postgres";
  }

  return "sqlite";
}

export function getSqlitePath() {
  return process.env.SQLITE_PATH?.trim() || "./data/wolfdesk.db";
}

export function getDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();

  if (!value) {
    throw new Error("DATABASE_URL is required when DATABASE_PROVIDER=postgres.");
  }

  return value;
}
