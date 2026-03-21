import crypto from "node:crypto";
import { ensureDatabase } from "@/lib/db/client";
import { ContractWatchlistEntry, WatchlistContractGptResult } from "@/lib/watchlist/types";

export type WatchlistAnalysisJobStatus = "queued" | "running" | "completed" | "failed";

export type WatchlistAnalysisJobRecord = {
  id: string;
  requestKey: string;
  contractSymbol: string;
  underlyingSymbol: string;
  status: WatchlistAnalysisJobStatus;
  inputHash: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  model: string | null;
  result: WatchlistContractGptResult | null;
};

function toRecord(row: Record<string, unknown>): WatchlistAnalysisJobRecord {
  return {
    id: String(row.id),
    requestKey: String(row.request_key),
    contractSymbol: String(row.contract_symbol),
    underlyingSymbol: String(row.underlying_symbol),
    status: String(row.status) as WatchlistAnalysisJobStatus,
    inputHash: String(row.input_hash),
    requestedAt: String(row.requested_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    model: row.model ? String(row.model) : null,
    result: row.result_payload ? (JSON.parse(String(row.result_payload)) as WatchlistContractGptResult) : null,
  };
}

function hashEntry(entry: ContractWatchlistEntry) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        symbol: entry.symbol,
        underlyingSymbol: entry.underlyingSymbol,
        expirationDate: entry.expirationDate,
        strikePrice: entry.strikePrice,
        mark: entry.mark,
        score: entry.score,
        structure: entry.structure,
        lane: entry.lane,
      }),
    )
    .digest("hex");
}

function requestKeyForEntry(entry: ContractWatchlistEntry) {
  return `${entry.underlyingSymbol}:${entry.symbol}:${entry.expirationDate}:${entry.strikePrice}`;
}

async function readRowsForContractSymbols(contractSymbols: string[]) {
  const db = await ensureDatabase();

  if (!contractSymbols.length) {
    return [] as Record<string, unknown>[];
  }

  if (db.provider === "postgres" && db.pg) {
    const placeholders = contractSymbols.map((_, index) => `$${index + 1}`).join(", ");
    const rows = await db.pg.unsafe(
      `SELECT * FROM watchlist_analysis_jobs WHERE contract_symbol IN (${placeholders}) ORDER BY requested_at DESC`,
      contractSymbols,
    );
    return rows as Record<string, unknown>[];
  }

  const sqlite = db.sqlite!;
  const placeholders = contractSymbols.map(() => "?").join(", ");
  return sqlite
    .prepare(`SELECT * FROM watchlist_analysis_jobs WHERE contract_symbol IN (${placeholders}) ORDER BY requested_at DESC`)
    .all(...contractSymbols) as Record<string, unknown>[];
}

export async function getLatestJobsForContracts(contractSymbols: string[]) {
  const rows = await readRowsForContractSymbols(contractSymbols);
  const latest = new Map<string, WatchlistAnalysisJobRecord>();

  for (const row of rows) {
    const record = toRecord(row);

    if (!latest.has(record.contractSymbol)) {
      latest.set(record.contractSymbol, record);
    }
  }

  return Array.from(latest.values());
}

export async function submitWatchlistAnalysisJobs(entries: ContractWatchlistEntry[]) {
  const db = await ensureDatabase();
  const submitted: WatchlistAnalysisJobRecord[] = [];

  for (const entry of entries) {
    const requestKey = requestKeyForEntry(entry);
    const inputHash = hashEntry(entry);
    const existing = (await getLatestJobsForContracts([entry.symbol])).find((job) => job.contractSymbol === entry.symbol);

    if (existing && (existing.status === "queued" || existing.status === "running") && existing.inputHash === inputHash) {
      submitted.push(existing);
      continue;
    }

    const record: WatchlistAnalysisJobRecord = {
      id: crypto.randomUUID(),
      requestKey,
      contractSymbol: entry.symbol,
      underlyingSymbol: entry.underlyingSymbol,
      status: "queued",
      inputHash,
      requestedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      model: null,
      result: null,
    };

    if (db.provider === "postgres" && db.pg) {
      await db.pg.unsafe(
        `INSERT INTO watchlist_analysis_jobs
          (id, request_key, contract_symbol, underlying_symbol, status, input_hash, requested_at, started_at, completed_at, error_message, model, result_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          record.id,
          record.requestKey,
          record.contractSymbol,
          record.underlyingSymbol,
          record.status,
          record.inputHash,
          record.requestedAt,
          null,
          null,
          null,
          null,
          null,
        ],
      );
    } else {
      db.sqlite!
        .prepare(
          `INSERT INTO watchlist_analysis_jobs
           (id, request_key, contract_symbol, underlying_symbol, status, input_hash, requested_at, started_at, completed_at, error_message, model, result_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.requestKey,
          record.contractSymbol,
          record.underlyingSymbol,
          record.status,
          record.inputHash,
          record.requestedAt,
          null,
          null,
          null,
          null,
          null,
        );
    }

    submitted.push(record);
  }

  return submitted;
}

export async function getQueuedJobs(limit = 3, ids?: string[]) {
  const db = await ensureDatabase();

  if (db.provider === "postgres" && db.pg) {
    const rows = ids?.length
      ? await db.pg.unsafe(
          `SELECT * FROM watchlist_analysis_jobs WHERE status = 'queued' AND id IN (${ids.map((_, index) => `$${index + 1}`).join(", ")}) ORDER BY requested_at ASC LIMIT ${limit}`,
          ids,
        )
      : await db.pg.unsafe(`SELECT * FROM watchlist_analysis_jobs WHERE status = 'queued' ORDER BY requested_at ASC LIMIT ${limit}`);

    return (rows as Record<string, unknown>[]).map(toRecord);
  }

  const sqlite = db.sqlite!;
  const rows = ids?.length
    ? (sqlite
        .prepare(
          `SELECT * FROM watchlist_analysis_jobs WHERE status = 'queued' AND id IN (${ids.map(() => "?").join(", ")}) ORDER BY requested_at ASC LIMIT ${limit}`,
        )
        .all(...ids) as Record<string, unknown>[])
    : (sqlite
        .prepare(`SELECT * FROM watchlist_analysis_jobs WHERE status = 'queued' ORDER BY requested_at ASC LIMIT ${limit}`)
        .all() as Record<string, unknown>[]);

  return rows.map(toRecord);
}

export async function markJobRunning(id: string) {
  const db = await ensureDatabase();
  const startedAt = new Date().toISOString();

  if (db.provider === "postgres" && db.pg) {
    await db.pg.unsafe(`UPDATE watchlist_analysis_jobs SET status = 'running', started_at = $2, error_message = NULL WHERE id = $1`, [
      id,
      startedAt,
    ]);
  } else {
    db.sqlite!
      .prepare(`UPDATE watchlist_analysis_jobs SET status = 'running', started_at = ?, error_message = NULL WHERE id = ?`)
      .run(startedAt, id);
  }
}

export async function markJobCompleted(id: string, model: string, result: WatchlistContractGptResult) {
  const db = await ensureDatabase();
  const completedAt = new Date().toISOString();
  const payload = JSON.stringify(result);

  if (db.provider === "postgres" && db.pg) {
    await db.pg.unsafe(
      `UPDATE watchlist_analysis_jobs
       SET status = 'completed', completed_at = $2, error_message = NULL, model = $3, result_payload = $4
       WHERE id = $1`,
      [id, completedAt, model, payload],
    );
  } else {
    db.sqlite!
      .prepare(
        `UPDATE watchlist_analysis_jobs
         SET status = 'completed', completed_at = ?, error_message = NULL, model = ?, result_payload = ?
         WHERE id = ?`,
      )
      .run(completedAt, model, payload, id);
  }
}

export async function markJobFailed(id: string, errorMessage: string) {
  const db = await ensureDatabase();
  const completedAt = new Date().toISOString();

  if (db.provider === "postgres" && db.pg) {
    await db.pg.unsafe(
      `UPDATE watchlist_analysis_jobs
       SET status = 'failed', completed_at = $2, error_message = $3
       WHERE id = $1`,
      [id, completedAt, errorMessage.slice(0, 2000)],
    );
  } else {
    db.sqlite!
      .prepare(
        `UPDATE watchlist_analysis_jobs
         SET status = 'failed', completed_at = ?, error_message = ?
         WHERE id = ?`,
      )
      .run(completedAt, errorMessage.slice(0, 2000), id);
  }
}
