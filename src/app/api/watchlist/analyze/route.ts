import { hasOpenAIConfig } from "@/lib/openai/config";
import { submitWatchlistAnalysisJobs } from "@/lib/watchlist/store";
import { ContractWatchlistEntry } from "@/lib/watchlist/types";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function sanitizeText(value: unknown, maxLength = 80) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizeNumber(value: unknown, min = 0, max = 1_000_000_000) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(min, Math.min(max, parsed));
}

function isOptionType(value: string) {
  return value === "call" || value === "put";
}

function isThesisFit(value: string) {
  return value === "aligned" || value === "countertrend" || value === "watch";
}

function isStructure(value: string) {
  return value === "long_call" || value === "call_spread" || value === "long_put" || value === "put_spread" || value === "watchlist";
}

function isLane(value: string) {
  return value === "suggested" || value === "fast_lane";
}

function parseEntry(value: unknown): ContractWatchlistEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const symbol = sanitizeText(item.symbol, 48).toUpperCase();
  const underlyingSymbol = sanitizeText(item.underlyingSymbol, 16).toUpperCase();
  const optionType = sanitizeText(item.optionType, 8).toLowerCase();
  const expirationDate = sanitizeText(item.expirationDate, 16);
  const thesisFit = sanitizeText(item.thesisFit, 16).toLowerCase();
  const structure = sanitizeText(item.structure, 24).toLowerCase();
  const lane = sanitizeText(item.lane, 16).toLowerCase();

  const daysToExpiration = sanitizeNumber(item.daysToExpiration, 0, 730);
  const strikePrice = sanitizeNumber(item.strikePrice, 0, 100_000);
  const bid = sanitizeNumber(item.bid, 0, 100_000);
  const ask = sanitizeNumber(item.ask, 0, 100_000);
  const mark = sanitizeNumber(item.mark, 0, 100_000);
  const breakEven = sanitizeNumber(item.breakEven, 0, 100_000);
  const dailyVolume = sanitizeNumber(item.dailyVolume, 0, 100_000_000);
  const bidAskSpreadPercent = sanitizeNumber(item.bidAskSpreadPercent, 0, 10_000);
  const score = sanitizeNumber(item.score, 0, 10_000);
  const addedAt = sanitizeText(item.addedAt, 40);

  if (
    !symbol ||
    !underlyingSymbol ||
    !isOptionType(optionType) ||
    !expirationDate ||
    daysToExpiration === null ||
    strikePrice === null ||
    bid === null ||
    ask === null ||
    mark === null ||
    breakEven === null ||
    dailyVolume === null ||
    bidAskSpreadPercent === null ||
    score === null ||
    !isThesisFit(thesisFit) ||
    !isStructure(structure) ||
    !isLane(lane)
  ) {
    return null;
  }

  return {
    symbol,
    underlyingSymbol,
    optionType,
    expirationDate,
    daysToExpiration,
    strikePrice,
    bid,
    ask,
    mark,
    breakEven,
    dailyVolume,
    bidAskSpreadPercent,
    score,
    thesisFit,
    structure,
    lane,
    addedAt,
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!hasOpenAIConfig()) {
      return NextResponse.json({ error: "OpenAI credentials are not configured." }, { status: 503 });
    }

    const body = (await request.json()) as { entries?: unknown };
    const rawEntries: unknown[] = Array.isArray(body?.entries) ? body.entries : [];
    const entries = rawEntries.map(parseEntry).filter((entry): entry is ContractWatchlistEntry => Boolean(entry));

    if (!entries.length) {
      return NextResponse.json({ error: "No valid watchlist contracts were provided." }, { status: 400 });
    }

    const uniqueEntries = Array.from(new Map(entries.map((entry) => [entry.symbol, entry])).values()).slice(0, 12);
    const jobs = await submitWatchlistAnalysisJobs(uniqueEntries);

    return NextResponse.json({
      queuedCount: jobs.filter((job) => job.status === "queued").length,
      jobs: jobs.map((job) => ({
        id: job.id,
        contractSymbol: job.contractSymbol,
        underlyingSymbol: job.underlyingSymbol,
        status: job.status,
        requestedAt: job.requestedAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected watchlist analysis submission error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
