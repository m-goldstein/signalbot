import { analyzeOpenInsiderTrades } from "@/lib/openinsider/analysis";
import { fetchOpenInsiderTrades } from "@/lib/openinsider/scraper";
import { OpenInsiderQuery, OpenInsiderResponse } from "@/lib/openinsider/types";
import { NextRequest, NextResponse } from "next/server";

function parseInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const query: OpenInsiderQuery = {
      symbol: request.nextUrl.searchParams.get("symbol") ?? undefined,
      side: (request.nextUrl.searchParams.get("side") as OpenInsiderQuery["side"]) ?? "buy",
      page: parseInteger(request.nextUrl.searchParams.get("page"), 1),
      count: parseInteger(request.nextUrl.searchParams.get("count"), 100),
    };

    const { query: normalizedQuery, trades } = await fetchOpenInsiderTrades(query);
    const analysis = analyzeOpenInsiderTrades(trades);
    const response: OpenInsiderResponse = {
      query: normalizedQuery,
      trades,
      analysis,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected OpenInsider error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
