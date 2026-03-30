import { analyzeWatchlistContract } from "@/lib/watchlist/gpt";
import { getQueuedJobs, markJobCompleted, markJobFailed, markJobRunning } from "@/lib/watchlist/store";
import { ContractWatchlistEntry } from "@/lib/watchlist/types";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const MAX_JOBS_PER_INVOCATION = 1;

function parseEntry(value: unknown): ContractWatchlistEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;

  if (typeof item.symbol !== "string" || typeof item.underlyingSymbol !== "string") {
    return null;
  }

  return item as unknown as ContractWatchlistEntry;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown; entriesBySymbol?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((value) => String(value).trim()).filter(Boolean).slice(0, 12)
      : undefined;
    const entryMap = new Map<string, ContractWatchlistEntry>();

    if (body.entriesBySymbol && typeof body.entriesBySymbol === "object") {
      for (const [key, value] of Object.entries(body.entriesBySymbol as Record<string, unknown>)) {
        const entry = parseEntry(value);

        if (entry) {
          entryMap.set(key.toUpperCase(), entry);
        }
      }
    }

    const jobs = await getQueuedJobs(MAX_JOBS_PER_INVOCATION, ids);
    const processed: Array<{ id: string; contractSymbol: string; status: string }> = [];

    for (const job of jobs) {
      const entry = entryMap.get(job.contractSymbol);

      if (!entry) {
        await markJobFailed(job.id, `Missing watchlist entry payload for ${job.contractSymbol}.`);
        processed.push({ id: job.id, contractSymbol: job.contractSymbol, status: "failed" });
        continue;
      }

      await markJobRunning(job.id);

      try {
        const analysis = await analyzeWatchlistContract(entry);
        await markJobCompleted(job.id, analysis.model, analysis.result);
        processed.push({ id: job.id, contractSymbol: job.contractSymbol, status: "completed" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown watchlist analysis failure.";
        await markJobFailed(job.id, message);
        processed.push({ id: job.id, contractSymbol: job.contractSymbol, status: "failed" });
      }
    }

    return NextResponse.json({
      processedCount: processed.length,
      processed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected watchlist worker error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
