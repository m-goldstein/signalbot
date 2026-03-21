import { createMarketDataProvider } from "@/lib/market-data";
import { hasAlpacaCredentials } from "@/lib/market-data/config";
import { Timeframe } from "@/lib/market-data/types";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_TIMEFRAMES = new Set<Timeframe>(["1Day", "1Hour", "15Min", "5Min"]);

function parseLimit(rawLimit: string | null) {
  const parsed = Number(rawLimit ?? "100");

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    return null;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();
  const timeframe = request.nextUrl.searchParams.get("timeframe") as Timeframe | null;
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const start = request.nextUrl.searchParams.get("start") ?? undefined;
  const end = request.nextUrl.searchParams.get("end") ?? undefined;

  if (!symbol) {
    return NextResponse.json({ error: "A symbol query parameter is required." }, { status: 400 });
  }

  if (!timeframe || !ALLOWED_TIMEFRAMES.has(timeframe)) {
    return NextResponse.json(
      { error: "timeframe must be one of 1Day, 1Hour, 15Min, or 5Min." },
      { status: 400 },
    );
  }

  if (limit === null) {
    return NextResponse.json({ error: "limit must be an integer between 1 and 500." }, { status: 400 });
  }

  if (!hasAlpacaCredentials()) {
    return NextResponse.json(
      {
        error:
          "Alpaca credentials are not configured. Set ALPACA_API_KEY and ALPACA_API_SECRET in your environment.",
      },
      { status: 503 },
    );
  }

  try {
    const provider = createMarketDataProvider();
    const result = await provider.getBars({ symbol, timeframe, limit, start, end });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected market data error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
