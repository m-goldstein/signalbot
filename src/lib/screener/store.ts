import crypto from "node:crypto";
import { ensureDatabase } from "@/lib/db/client";
import { ScreenerAnalysisEntry, ScreenerAnalysisJobRecord, ScreenerAnalysisJobStatus, ScreenerGptResponse } from "@/lib/screener/types";

const STALE_RUNNING_JOB_TIMEOUT_MS = 2 * 60 * 1000;

function toRecord(row: Record<string, unknown>): ScreenerAnalysisJobRecord {
  return {
    id: String(row.id),
    requestKey: String(row.request_key),
    symbol: String(row.symbol),
    rowName: String(row.row_name ?? ""),
    segment: String(row.segment ?? ""),
    tier: String(row.tier ?? "tier1") as ScreenerAnalysisJobRecord["tier"],
    status: String(row.status) as ScreenerAnalysisJobStatus,
    inputHash: String(row.input_hash),
    requestedAt: String(row.requested_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    model: row.model ? String(row.model) : null,
    result: parseResultPayload(row.result_payload),
  };
}

function parseResultPayload(value: unknown): ScreenerGptResponse["results"][number] | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(String(value)) as ScreenerGptResponse["results"][number];
  } catch {
    return null;
  }
}

function hashEntry(entry: ScreenerAnalysisEntry) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        symbol: entry.symbol,
        name: entry.name,
        segment: entry.segment,
        tier: entry.tier,
      }),
    )
    .digest("hex");
}

function requestKeyForEntry(entry: ScreenerAnalysisEntry) {
  return `${entry.symbol}:${entry.segment}:${entry.tier}`;
}

async function readRowsForSymbols(symbols: string[]) {
  const db = await ensureDatabase();

  if (!symbols.length) {
    return [] as Record<string, unknown>[];
  }

  if (db.provider === "postgres" && db.pg) {
    const placeholders = symbols.map((_, index) => `$${index + 1}`).join(", ");
    const rows = await db.pg.unsafe(
      `SELECT * FROM screener_analysis_jobs WHERE symbol IN (${placeholders}) ORDER BY requested_at DESC`,
      symbols,
    );
    return rows as Record<string, unknown>[];
  }

  const sqlite = db.sqlite!;
  const placeholders = symbols.map(() => "?").join(", ");
  return sqlite
    .prepare(`SELECT * FROM screener_analysis_jobs WHERE symbol IN (${placeholders}) ORDER BY requested_at DESC`)
    .all(...symbols) as Record<string, unknown>[];
}

export async function getLatestJobsForSymbols(symbols: string[]) {
  const rows = await readRowsForSymbols(symbols);
  const latest = new Map<string, ScreenerAnalysisJobRecord>();

  for (const row of rows) {
    const record = toRecord(row);

    if (!latest.has(record.symbol)) {
      latest.set(record.symbol, record);
    }
  }

  return Array.from(latest.values());
}

export async function submitScreenerAnalysisJobs(entries: ScreenerAnalysisEntry[]) {
  const db = await ensureDatabase();
  const submitted: ScreenerAnalysisJobRecord[] = [];

  for (const entry of entries) {
    const requestKey = requestKeyForEntry(entry);
    const inputHash = hashEntry(entry);
    const existing = (await getLatestJobsForSymbols([entry.symbol])).find((job) => job.symbol === entry.symbol);

    if (existing && (existing.status === "queued" || existing.status === "running") && existing.inputHash === inputHash) {
      submitted.push(existing);
      continue;
    }

    const record: ScreenerAnalysisJobRecord = {
      id: crypto.randomUUID(),
      requestKey,
      symbol: entry.symbol,
      rowName: entry.name,
      segment: entry.segment,
      tier: entry.tier,
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
        `INSERT INTO screener_analysis_jobs
          (id, request_key, symbol, row_name, segment, tier, input_hash, status, requested_at, started_at, completed_at, error_message, model, result_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          record.id,
          requestKey,
          entry.symbol,
          entry.name,
          entry.segment,
          entry.tier,
          inputHash,
          record.status,
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
          `INSERT INTO screener_analysis_jobs
           (id, request_key, symbol, row_name, segment, tier, input_hash, status, requested_at, started_at, completed_at, error_message, model, result_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          requestKey,
          entry.symbol,
          entry.name,
          entry.segment,
          entry.tier,
          inputHash,
          record.status,
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

export async function getRecentCompletedScreenerJobs(options?: {
  since?: string;
  modelPrefix?: string;
  limit?: number;
}) {
  const db = await ensureDatabase();
  const since = options?.since ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const modelPrefix = options?.modelPrefix?.trim() ?? "gpt-5.4";
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));

  if (db.provider === "postgres" && db.pg) {
    const rows = await db.pg.unsafe(
      `SELECT *
       FROM screener_analysis_jobs
       WHERE status = 'completed'
         AND completed_at IS NOT NULL
         AND completed_at >= $1
         AND model IS NOT NULL
         AND model LIKE $2
       ORDER BY completed_at DESC
       LIMIT ${limit}`,
      [since, `${modelPrefix}%`],
    );

    return (rows as Record<string, unknown>[]).map(toRecord);
  }

  const sqlite = db.sqlite!;
  const rows = sqlite
    .prepare(
      `SELECT *
       FROM screener_analysis_jobs
       WHERE status = 'completed'
         AND completed_at IS NOT NULL
         AND completed_at >= ?
         AND model IS NOT NULL
         AND model LIKE ?
       ORDER BY completed_at DESC
       LIMIT ${limit}`,
    )
    .all(since, `${modelPrefix}%`) as Record<string, unknown>[];

  return rows.map(toRecord);
}

export async function getQueuedScreenerJobs(limit = 4, ids?: string[]) {
  await requeueStaleRunningJobs(ids);
  const db = await ensureDatabase();

  if (db.provider === "postgres" && db.pg) {
    const rows = ids?.length
      ? await db.pg.unsafe(
          `SELECT * FROM screener_analysis_jobs WHERE status = 'queued' AND id IN (${ids.map((_, index) => `$${index + 1}`).join(", ")}) ORDER BY requested_at ASC LIMIT ${limit}`,
          ids,
        )
      : await db.pg.unsafe(`SELECT * FROM screener_analysis_jobs WHERE status = 'queued' ORDER BY requested_at ASC LIMIT ${limit}`);

    return (rows as Record<string, unknown>[]).map(toRecord);
  }

  const sqlite = db.sqlite!;
  const rows = ids?.length
    ? (sqlite
        .prepare(
          `SELECT * FROM screener_analysis_jobs WHERE status = 'queued' AND id IN (${ids.map(() => "?").join(", ")}) ORDER BY requested_at ASC LIMIT ${limit}`,
        )
        .all(...ids) as Record<string, unknown>[])
    : (sqlite
        .prepare(`SELECT * FROM screener_analysis_jobs WHERE status = 'queued' ORDER BY requested_at ASC LIMIT ${limit}`)
        .all() as Record<string, unknown>[]);

  return rows.map(toRecord);
}

async function requeueStaleRunningJobs(ids?: string[]) {
  const db = await ensureDatabase();
  const cutoff = new Date(Date.now() - STALE_RUNNING_JOB_TIMEOUT_MS).toISOString();

  if (db.provider === "postgres" && db.pg) {
    if (ids?.length) {
      const placeholders = ids.map((_, index) => `$${index + 2}`).join(", ");
      await db.pg.unsafe(
        `UPDATE screener_analysis_jobs
         SET status = 'queued', started_at = NULL, completed_at = NULL, error_message = NULL
         WHERE status = 'running' AND started_at IS NOT NULL AND started_at < $1 AND id IN (${placeholders})`,
        [cutoff, ...ids],
      );
      return;
    }

    await db.pg.unsafe(
      `UPDATE screener_analysis_jobs
       SET status = 'queued', started_at = NULL, completed_at = NULL, error_message = NULL
       WHERE status = 'running' AND started_at IS NOT NULL AND started_at < $1`,
      [cutoff],
    );
    return;
  }

  const sqlite = db.sqlite!;

  if (ids?.length) {
    sqlite
      .prepare(
        `UPDATE screener_analysis_jobs
         SET status = 'queued', started_at = NULL, completed_at = NULL, error_message = NULL
         WHERE status = 'running' AND started_at IS NOT NULL AND started_at < ? AND id IN (${ids.map(() => "?").join(", ")})`,
      )
      .run(cutoff, ...ids);
    return;
  }

  sqlite
    .prepare(
      `UPDATE screener_analysis_jobs
       SET status = 'queued', started_at = NULL, completed_at = NULL, error_message = NULL
       WHERE status = 'running' AND started_at IS NOT NULL AND started_at < ?`,
    )
    .run(cutoff);
}

export async function markScreenerJobRunning(id: string) {
  const db = await ensureDatabase();
  const startedAt = new Date().toISOString();

  if (db.provider === "postgres" && db.pg) {
    await db.pg.unsafe(`UPDATE screener_analysis_jobs SET status = 'running', started_at = $2, error_message = NULL WHERE id = $1`, [
      id,
      startedAt,
    ]);
  } else {
    db.sqlite!
      .prepare(`UPDATE screener_analysis_jobs SET status = 'running', started_at = ?, error_message = NULL WHERE id = ?`)
      .run(startedAt, id);
  }
}

export async function markScreenerJobCompleted(id: string, model: string, result: ScreenerGptResponse["results"][number]) {
  const db = await ensureDatabase();
  const completedAt = new Date().toISOString();
  const payload = JSON.stringify(result);

  if (db.provider === "postgres" && db.pg) {
    await db.pg.unsafe(
      `UPDATE screener_analysis_jobs
       SET status = 'completed', completed_at = $2, error_message = NULL, model = $3, result_payload = $4
       WHERE id = $1`,
      [id, completedAt, model, payload],
    );
  } else {
    db.sqlite!
      .prepare(
        `UPDATE screener_analysis_jobs
         SET status = 'completed', completed_at = ?, error_message = NULL, model = ?, result_payload = ?
         WHERE id = ?`,
      )
      .run(completedAt, model, payload, id);
  }
}

export async function markScreenerJobFailed(id: string, errorMessage: string) {
  const db = await ensureDatabase();
  const completedAt = new Date().toISOString();

  if (db.provider === "postgres" && db.pg) {
    await db.pg.unsafe(
      `UPDATE screener_analysis_jobs
       SET status = 'failed', completed_at = $2, error_message = $3
       WHERE id = $1`,
      [id, completedAt, errorMessage.slice(0, 2000)],
    );
  } else {
    db.sqlite!
      .prepare(
        `UPDATE screener_analysis_jobs
         SET status = 'failed', completed_at = ?, error_message = ?
         WHERE id = ?`,
      )
      .run(completedAt, errorMessage.slice(0, 2000), id);
  }
}
