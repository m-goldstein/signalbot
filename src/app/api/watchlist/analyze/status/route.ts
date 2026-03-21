import { getLatestJobsForContracts } from "@/lib/watchlist/store";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const contracts = (request.nextUrl.searchParams.get("contracts") ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    const jobs = await getLatestJobsForContracts(contracts);

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        contractSymbol: job.contractSymbol,
        underlyingSymbol: job.underlyingSymbol,
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
    const message = error instanceof Error ? error.message : "Unexpected watchlist status error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
