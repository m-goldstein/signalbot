import { hasOpenAIConfig } from "@/lib/openai/config";
import { buildScreenerDataset } from "@/lib/screener/service";
import { analyzeScreenerSnapshots } from "@/lib/screener/gpt";
import { ScreenerGptResponse } from "@/lib/screener/types";
import { UniverseTier } from "@/lib/universe/types";
import { NextRequest, NextResponse } from "next/server";

function parseTier(rawTier: string | null): UniverseTier | "all" {
  if (!rawTier || rawTier === "all") {
    return "all";
  }

  if (rawTier === "tier1" || rawTier === "tier2" || rawTier === "tier3") {
    return rawTier;
  }

  throw new Error("tier must be one of all, tier1, tier2, or tier3.");
}

function parseInteger(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    if (!hasOpenAIConfig()) {
      return NextResponse.json({ error: "OpenAI credentials are not configured." }, { status: 503 });
    }

    const tier = parseTier(request.nextUrl.searchParams.get("tier"));
    const topN = Math.min(10, Math.max(1, parseInteger(request.nextUrl.searchParams.get("topN"), 5)));
    const sort = request.nextUrl.searchParams.get("sort") ?? "dailyChangePercent";
    const direction = request.nextUrl.searchParams.get("direction") === "asc" ? "asc" : "desc";
    const symbols = (request.nextUrl.searchParams.get("symbols") ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    const symbolSet = new Set(symbols);

    const dataset = await buildScreenerDataset(tier);
    const sortedRows = [...dataset.response.rows].sort((left, right) => {
      const leftValue = left[sort as keyof typeof left];
      const rightValue = right[sort as keyof typeof right];

      if (typeof leftValue === "string" && typeof rightValue === "string") {
        return leftValue.localeCompare(rightValue);
      }

      return Number(leftValue) - Number(rightValue);
    });

    if (direction === "desc") {
      sortedRows.reverse();
    }

    const rowsForAnalysis = symbols.length
      ? sortedRows.filter((row) => symbolSet.has(row.symbol))
      : sortedRows.slice(0, topN);

    if (!rowsForAnalysis.length) {
      return NextResponse.json({ error: "No screener rows matched the requested analysis set." }, { status: 400 });
    }

    const analysis = await analyzeScreenerSnapshots({
      rows: rowsForAnalysis.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        segment: row.segment,
        tier: row.tier,
      })),
      snapshots: dataset.snapshots,
    });

    const response: ScreenerGptResponse = {
      model: analysis.model,
      topN: rowsForAnalysis.length,
      results: analysis.results,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected screener analysis error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
