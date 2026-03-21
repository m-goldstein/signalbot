import { hasOpenAIConfig, getOpenAIConfig } from "@/lib/openai/config";
import { analyzeOpenInsiderTrades } from "@/lib/openinsider/analysis";
import { analyzeTopTickersWithOpenAI } from "@/lib/openinsider/gpt";
import { fetchOpenInsiderTrades } from "@/lib/openinsider/scraper";
import { OpenInsiderGptResponse, OpenInsiderQuery } from "@/lib/openinsider/types";
import { NextRequest, NextResponse } from "next/server";

function parseInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    if (!hasOpenAIConfig()) {
      return NextResponse.json(
        { error: "OpenAI credentials are not configured." },
        { status: 503 },
      );
    }

    const query: OpenInsiderQuery = {
      symbol: request.nextUrl.searchParams.get("symbol") ?? undefined,
      side: (request.nextUrl.searchParams.get("side") as OpenInsiderQuery["side"]) ?? "buy",
      page: parseInteger(request.nextUrl.searchParams.get("page"), 1),
      count: parseInteger(request.nextUrl.searchParams.get("count"), 100),
    };
    const topN = Math.min(10, Math.max(1, parseInteger(request.nextUrl.searchParams.get("topN"), 5)));

    const { trades } = await fetchOpenInsiderTrades(query);
    const analysis = analyzeOpenInsiderTrades(trades);
    const results = await analyzeTopTickersWithOpenAI({
      trades,
      tickerSummaries: analysis.tickerSummaries,
      tickerResearchSummaries: analysis.tickerResearchSummaries,
      limit: topN,
    });

    const response: OpenInsiderGptResponse = {
      model: getOpenAIConfig().model,
      topN,
      results,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected OpenAI analysis error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
