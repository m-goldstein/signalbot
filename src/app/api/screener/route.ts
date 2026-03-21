import { hasAlpacaCredentials } from "@/lib/market-data/config";
import { buildScreenerDataset } from "@/lib/screener/service";
import { ScreenerResponse, ScreenerRow, ScreenerSortField } from "@/lib/screener/types";
import { UniverseTier } from "@/lib/universe/types";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_SORTS = new Set<ScreenerSortField>([
  "symbol",
  "dailyChangePercent",
  "oneMonthChangePercent",
  "threeMonthChangePercent",
  "sixMonthChangePercent",
  "oneYearChangePercent",
  "distanceFrom20Sma",
  "distanceFrom50Sma",
  "distanceFrom200Sma",
  "distanceFrom52WeekHigh",
  "distanceFrom52WeekLow",
  "atrPercent",
  "realizedVol20",
  "realizedVol60",
  "averageDollarVolume20",
  "directionalConvictionScore",
  "premiumBuyingScore",
  "volumeVs20DayAverage",
]);

function parseTier(rawTier: string | null): UniverseTier | "all" {
  if (!rawTier || rawTier === "all") {
    return "all";
  }

  if (rawTier === "tier1" || rawTier === "tier2" || rawTier === "tier3") {
    return rawTier;
  }

  throw new Error("tier must be one of all, tier1, tier2, or tier3.");
}

function parseSort(rawSort: string | null): ScreenerSortField {
  const sort = (rawSort ?? "dailyChangePercent") as ScreenerSortField;

  if (!ALLOWED_SORTS.has(sort)) {
    throw new Error("sort is not supported.");
  }

  return sort;
}

function sortRows(rows: ScreenerRow[], field: ScreenerSortField, direction: "asc" | "desc") {
  const sorted = [...rows].sort((left, right) => {
    const leftValue = left[field];
    const rightValue = right[field];

    if (typeof leftValue === "string" && typeof rightValue === "string") {
      return leftValue.localeCompare(rightValue);
    }

    return Number(leftValue) - Number(rightValue);
  });

  return direction === "desc" ? sorted.reverse() : sorted;
}

export async function GET(request: NextRequest) {
  try {
    const tier = parseTier(request.nextUrl.searchParams.get("tier"));
    const sort = parseSort(request.nextUrl.searchParams.get("sort"));
    const direction = request.nextUrl.searchParams.get("direction") === "asc" ? "asc" : "desc";

    if (!hasAlpacaCredentials()) {
      return NextResponse.json(
        {
          error:
            "Alpaca credentials are not configured. Set ALPACA_API_KEY and ALPACA_API_SECRET in your environment.",
        },
        { status: 503 },
      );
    }

    const dataset = await buildScreenerDataset(tier);
    const response: ScreenerResponse = {
      ...dataset.response,
      rows: sortRows(dataset.response.rows, sort, direction),
    };

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected screener error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
