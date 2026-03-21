import {
  BarsQuery,
  BarsResult,
  MarketDataProvider,
  PriceBar,
} from "@/lib/market-data/types";
import { getAlpacaConfig, hasAlpacaCredentials } from "@/lib/market-data/config";

type AlpacaBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
};

type AlpacaBarsResponse = {
  bars?: AlpacaBar[];
  symbol?: string;
  next_page_token?: string | null;
  message?: string;
};

function normalizeBars(bars: AlpacaBar[]): PriceBar[] {
  return bars.map((bar) => ({
    timestamp: bar.t,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    tradeCount: bar.n,
    vwap: bar.vw,
  }));
}

export class AlpacaMarketDataProvider implements MarketDataProvider {
  async getBars(query: BarsQuery): Promise<BarsResult> {
    if (!hasAlpacaCredentials()) {
      throw new Error("Alpaca credentials are not configured.");
    }

    const config = getAlpacaConfig();
    const url = new URL(
      `/v2/stocks/${encodeURIComponent(query.symbol.toUpperCase())}/bars`,
      config.dataBaseUrl,
    );

    url.searchParams.set("timeframe", query.timeframe);
    url.searchParams.set("limit", String(query.limit));

    if (query.start) {
      url.searchParams.set("start", query.start);
    }

    if (query.end) {
      url.searchParams.set("end", query.end);
    }

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "APCA-API-KEY-ID": config.apiKey,
        "APCA-API-SECRET-KEY": config.apiSecret,
      },
      cache: "no-store",
    });

    const payload = (await response.json()) as AlpacaBarsResponse;

    if (!response.ok) {
      throw new Error(payload.message || "Failed to fetch bars from Alpaca.");
    }

    return {
      symbol: query.symbol.toUpperCase(),
      timeframe: query.timeframe,
      bars: normalizeBars(payload.bars ?? []),
      source: "alpaca",
    };
  }
}
