import { analyzeScreenerSnapshot } from "@/lib/screener/gpt";
import { getQueuedScreenerJobs, markScreenerJobCompleted, markScreenerJobFailed, markScreenerJobRunning } from "@/lib/screener/store";
import { ScreenerAnalysisEntry } from "@/lib/screener/types";
import { buildScreenerDataset, getDefaultHistoryStart } from "@/lib/screener/service";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function parseEntry(value: unknown): ScreenerAnalysisEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;

  if (typeof item.symbol !== "string" || typeof item.name !== "string" || typeof item.segment !== "string" || typeof item.tier !== "string") {
    return null;
  }

  return item as ScreenerAnalysisEntry;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown; entriesBySymbol?: unknown; historyStart?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((value) => String(value).trim()).filter(Boolean).slice(0, 20)
      : undefined;
    const historyStart =
      typeof body.historyStart === "string" && body.historyStart.trim()
        ? new Date(`${body.historyStart.trim()}T00:00:00.000Z`).toISOString()
        : getDefaultHistoryStart();
    const entryMap = new Map<string, ScreenerAnalysisEntry>();

    if (body.entriesBySymbol && typeof body.entriesBySymbol === "object") {
      for (const [key, value] of Object.entries(body.entriesBySymbol as Record<string, unknown>)) {
        const entry = parseEntry(value);

        if (entry) {
          entryMap.set(key.toUpperCase(), entry);
        }
      }
    }

    const jobs = await getQueuedScreenerJobs(4, ids);
    const processed: Array<{ id: string; symbol: string; status: string }> = [];
    const dataset = jobs.length ? await buildScreenerDataset("all", historyStart) : null;
    const snapshotMap = new Map(dataset?.snapshots.map((snapshot) => [snapshot.symbol, snapshot]) ?? []);

    for (const job of jobs) {
      const entry = entryMap.get(job.symbol);

      if (!entry) {
        await markScreenerJobFailed(job.id, `Missing screener entry payload for ${job.symbol}.`);
        processed.push({ id: job.id, symbol: job.symbol, status: "failed" });
        continue;
      }

      await markScreenerJobRunning(job.id);

      try {
        const analysis = await analyzeScreenerSnapshot({
          row: entry,
          snapshot: snapshotMap.get(job.symbol) ?? null,
        });
        await markScreenerJobCompleted(job.id, analysis.model, analysis.result);
        processed.push({ id: job.id, symbol: job.symbol, status: "completed" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown screener analysis failure.";
        await markScreenerJobFailed(job.id, message);
        processed.push({ id: job.id, symbol: job.symbol, status: "failed" });
      }
    }

    return NextResponse.json({
      processedCount: processed.length,
      processed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected screener worker error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
