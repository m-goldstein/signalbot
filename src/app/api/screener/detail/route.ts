import { hasAlpacaCredentials } from "@/lib/market-data/config";
import { buildScreenerDetail } from "@/lib/screener/detail";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    if (!hasAlpacaCredentials()) {
      return NextResponse.json(
        { error: "Alpaca credentials are not configured. Set ALPACA_API_KEY and ALPACA_API_SECRET in your environment." },
        { status: 503 },
      );
    }

    const symbol = request.nextUrl.searchParams.get("symbol")?.trim().toUpperCase();

    if (!symbol) {
      return NextResponse.json({ error: "symbol is required." }, { status: 400 });
    }

    const detail = await buildScreenerDetail(symbol);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected screener detail error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
