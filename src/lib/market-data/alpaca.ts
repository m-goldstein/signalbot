import {
  BarsQuery,
  BarsResult,
  MarketDataProvider,
  OptionContractSnapshot,
  OptionSnapshotsQuery,
  OptionSnapshotsResult,
  OptionType,
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

type AlpacaOptionSnapshot = {
  latestQuote?: {
    bp?: number;
    bs?: number;
    ap?: number;
    as?: number;
    t?: string;
  };
  latestTrade?: {
    p?: number;
    t?: string;
  };
  dailyBar?: {
    c?: number;
    v?: number;
  };
};

type AlpacaOptionSnapshotsResponse = {
  snapshots?: Record<string, AlpacaOptionSnapshot>;
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

function parseOptionContractSymbol(contractSymbol: string): {
  expirationDate: string;
  optionType: OptionType;
  strikePrice: number;
} | null {
  const match = contractSymbol.match(/^.+?(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);

  if (!match) {
    return null;
  }

  const [, yy, mm, dd, optionCode, rawStrike] = match;
  const year = Number.parseInt(yy, 10) + 2000;
  const month = Number.parseInt(mm, 10);
  const day = Number.parseInt(dd, 10);
  const strikePrice = Number.parseInt(rawStrike, 10) / 1000;

  return {
    expirationDate: `${year.toString().padStart(4, "0")}-${mm}-${dd}`,
    optionType: optionCode === "C" ? "call" : "put",
    strikePrice,
  };
}

function differenceInCalendarDays(start: Date, end: Date) {
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(0, Math.round((endUtc - startUtc) / (1000 * 60 * 60 * 24)));
}

function normalizeOptionSnapshots(
  underlyingSymbol: string,
  snapshots: Record<string, AlpacaOptionSnapshot>,
): OptionContractSnapshot[] {
  const now = new Date();

  return Object.entries(snapshots)
    .map(([symbol, snapshot]) => {
      const parsed = parseOptionContractSymbol(symbol);

      if (!parsed) {
        return null;
      }

      const bid = snapshot.latestQuote?.bp ?? 0;
      const ask = snapshot.latestQuote?.ap ?? 0;
      const last = snapshot.latestTrade?.p ?? snapshot.dailyBar?.c ?? 0;
      const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid > 0 ? bid : ask > 0 ? ask : last;
      const mark = mid > 0 ? mid : last;
      const bidAskSpread = bid > 0 && ask > 0 ? ask - bid : 0;
      const bidAskSpreadPercent = mark > 0 ? (bidAskSpread / mark) * 100 : 0;
      const expirationDate = new Date(`${parsed.expirationDate}T00:00:00Z`);

      return {
        symbol,
        underlyingSymbol,
        expirationDate: parsed.expirationDate,
        daysToExpiration: differenceInCalendarDays(now, expirationDate),
        optionType: parsed.optionType,
        strikePrice: parsed.strikePrice,
        bid,
        ask,
        mid,
        mark,
        last,
        dailyVolume: snapshot.dailyBar?.v ?? 0,
        bidSize: snapshot.latestQuote?.bs ?? 0,
        askSize: snapshot.latestQuote?.as ?? 0,
        bidAskSpread,
        bidAskSpreadPercent,
        quoteTimestamp: snapshot.latestQuote?.t ?? null,
        tradeTimestamp: snapshot.latestTrade?.t ?? null,
      };
    })
    .filter((value): value is OptionContractSnapshot => Boolean(value));
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

  async getOptionSnapshots(query: OptionSnapshotsQuery): Promise<OptionSnapshotsResult> {
    if (!hasAlpacaCredentials()) {
      throw new Error("Alpaca credentials are not configured.");
    }

    const config = getAlpacaConfig();
    const snapshots: OptionContractSnapshot[] = [];
    const underlyingSymbol = query.underlyingSymbol.toUpperCase();
    const pageSize = query.pageSize ?? 250;
    const maxPages = query.maxPages ?? 3;
    let pageToken: string | null = null;

    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(
        `/v1beta1/options/snapshots/${encodeURIComponent(underlyingSymbol)}`,
        config.dataBaseUrl,
      );

      url.searchParams.set("limit", String(pageSize));

      if (pageToken) {
        url.searchParams.set("page_token", pageToken);
      }

      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "APCA-API-KEY-ID": config.apiKey,
          "APCA-API-SECRET-KEY": config.apiSecret,
        },
        cache: "no-store",
      });

      const payload = (await response.json()) as AlpacaOptionSnapshotsResponse;

      if (!response.ok) {
        throw new Error(payload.message || "Failed to fetch option snapshots from Alpaca.");
      }

      snapshots.push(...normalizeOptionSnapshots(underlyingSymbol, payload.snapshots ?? {}));

      if (!payload.next_page_token) {
        break;
      }

      pageToken = payload.next_page_token;
    }

    return {
      underlyingSymbol,
      snapshots,
      source: "alpaca",
    };
  }
}
