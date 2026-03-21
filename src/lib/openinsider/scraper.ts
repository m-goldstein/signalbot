import { load } from "cheerio";
import { OpenInsiderQuery, OpenInsiderTrade } from "@/lib/openinsider/types";

const BASE_URL = "http://openinsider.com/screener";

enum ColumnIndex {
  Datetime = 1,
  Ticker = 3,
  Insider = 4,
  Relationship = 5,
  TransactionType = 6,
  Price = 7,
  Shares = 8,
  TotalOwned = 9,
  Value = 11,
}

function safeInt(value: string) {
  const parsed = Number.parseInt(value.replace(/[$,%\s,]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeFloat(value: string) {
  const parsed = Number.parseFloat(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQuery(query: OpenInsiderQuery): Required<OpenInsiderQuery> {
  return {
    symbol: query.symbol?.trim().toUpperCase() || "",
    side: query.side ?? "buy",
    page: query.page ?? 1,
    count: query.count ?? 100,
  };
}

function isSale(transactionType: string) {
  return /sale|sell/i.test(transactionType);
}

function parseTrades(html: string): OpenInsiderTrade[] {
  const $ = load(html);
  const table = $("table.tinytable").first().length
    ? $("table.tinytable").first()
    : $("#insider").first();
  const rows = table.find("tbody tr");

  if (!rows.length) {
    throw new Error("OpenInsider trade table was not found in the response.");
  }

  const trades: OpenInsiderTrade[] = [];

  rows.each((_, row) => {
    const columns = $(row).find("td");

    if (columns.length < 12) {
      return;
    }

    const transactionType = $(columns[ColumnIndex.TransactionType]).text().trim();
    const value = safeFloat($(columns[ColumnIndex.Value]).text().trim());

    trades.push({
      date: $(columns[ColumnIndex.Datetime]).text().trim(),
      ticker: $(columns[ColumnIndex.Ticker]).text().trim().toUpperCase(),
      insider: $(columns[ColumnIndex.Insider]).text().trim(),
      relationship: $(columns[ColumnIndex.Relationship]).text().trim(),
      transactionType,
      shares: safeInt($(columns[ColumnIndex.Shares]).text().trim()),
      averagePrice: safeFloat($(columns[ColumnIndex.Price]).text().trim()),
      value: isSale(transactionType) ? -Math.abs(value) : Math.abs(value),
      totalOwned: safeInt($(columns[ColumnIndex.TotalOwned]).text().trim()),
    });
  });

  return trades;
}

export async function fetchOpenInsiderTrades(query: OpenInsiderQuery = {}) {
  const normalized = normalizeQuery(query);
  const url = new URL(BASE_URL);

  url.searchParams.set("s", normalized.symbol);
  url.searchParams.set("o", normalized.side === "buy" ? "1" : normalized.side === "sale" ? "0" : "");
  url.searchParams.set("cnt", String(normalized.count));
  url.searchParams.set("page", String(normalized.page));
  url.searchParams.set("sortcol", "0");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; signalbot/1.0)",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`OpenInsider request failed with status ${response.status}.`);
  }

  const html = await response.text();
  const trades = parseTrades(html);

  const filteredTrades =
    normalized.side === "buy"
      ? trades.filter((trade) => trade.value >= 0)
      : normalized.side === "sale"
        ? trades.filter((trade) => trade.value < 0)
        : trades;

  return {
    query: normalized,
    trades: filteredTrades,
  };
}
