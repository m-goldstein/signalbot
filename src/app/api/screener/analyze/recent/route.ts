import { getRecentCompletedScreenerJobs } from "@/lib/screener/store";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

export async function GET(request: NextRequest) {
  try {
    const days = parsePositiveInt(request.nextUrl.searchParams.get("days"), 3, 14);
    const limit = parsePositiveInt(request.nextUrl.searchParams.get("limit"), 50, 100);
    const modelPrefix = (request.nextUrl.searchParams.get("modelPrefix") ?? "gpt-5.4").trim() || "gpt-5.4";
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const jobs = await getRecentCompletedScreenerJobs({ since, modelPrefix, limit });

    return NextResponse.json({
      days,
      count: jobs.length,
      jobs: jobs.map((job) => ({
        id: job.id,
        symbol: job.symbol,
        rowName: job.rowName,
        segment: job.segment,
        tier: job.tier,
        status: job.status,
        requestedAt: job.requestedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errorMessage: job.errorMessage,
        model: job.model,
        result: job.result,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected recent screener analysis error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
