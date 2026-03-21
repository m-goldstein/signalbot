import { getLatestJobsForSymbols } from "@/lib/screener/store";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const symbols = (request.nextUrl.searchParams.get("symbols") ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    const jobs = await getLatestJobsForSymbols(symbols);

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        symbol: job.symbol,
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
    const message = error instanceof Error ? error.message : "Unexpected screener status error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
