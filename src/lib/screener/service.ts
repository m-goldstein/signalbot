import { computeFeatureSnapshot } from "@/lib/features/engine";
import { createMarketDataProvider } from "@/lib/market-data";
import { FeatureSnapshot } from "@/lib/features/types";
import { ScreenerResponse, ScreenerRow } from "@/lib/screener/types";
import { getUniverse, getUniverseByTier } from "@/lib/universe/service";
import { UniverseTier } from "@/lib/universe/types";

const CONCURRENCY = 4;
const RETRY_CONCURRENCY = 1;
const DEFAULT_LOOKBACK_DAYS = 730;
const BAR_LIMIT = 1000;
const MIN_REQUIRED_BARS = 220;

export function getDefaultHistoryStart() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
  return date.toISOString();
}

export function getDefaultHistoryStartInput() {
  return getDefaultHistoryStart().slice(0, 10);
}

export function getTodayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

async function mapWithConcurrency<T, U>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];

  for (let index = 0; index < values.length; index += limit) {
    const chunk = values.slice(index, index + limit);
    const chunkResults = await Promise.all(chunk.map(mapper));
    results.push(...chunkResults);
  }

  return results;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function buildTickerSnapshot(input: {
  provider: ReturnType<typeof createMarketDataProvider>;
  ticker: ReturnType<typeof getUniverse>[number];
  start: string;
}) {
  const { provider, ticker, start } = input;
  const result = await provider.getBars({
    symbol: ticker.symbol,
    timeframe: "1Day",
    limit: BAR_LIMIT,
    start,
  });

  if (result.bars.length < MIN_REQUIRED_BARS) {
    throw new Error(`Insufficient bars returned for ${ticker.symbol}: ${result.bars.length}.`);
  }

  const snapshot = computeFeatureSnapshot({
    symbol: ticker.symbol,
    timeframe: "1Day",
    bars: result.bars,
  });

  const row: ScreenerRow = {
    symbol: ticker.symbol,
    name: ticker.name,
    tier: ticker.tier,
    section: ticker.section,
    segment: ticker.segment,
    timeframe: "1Day",
    asOf: snapshot.asOf,
    close: snapshot.close,
    dailyChangePercent: snapshot.dailyChangePercent,
    oneMonthChangePercent: snapshot.oneMonthChangePercent,
    threeMonthChangePercent: snapshot.threeMonthChangePercent,
    sixMonthChangePercent: snapshot.sixMonthChangePercent,
    oneYearChangePercent: snapshot.oneYearChangePercent,
    distanceFrom20Sma: snapshot.distanceFrom20Sma,
    distanceFrom50Sma: snapshot.distanceFrom50Sma,
    distanceFrom200Sma: snapshot.distanceFrom200Sma,
    distanceFrom52WeekHigh: snapshot.distanceFrom52WeekHigh,
    distanceFrom52WeekLow: snapshot.distanceFrom52WeekLow,
    atrPercent: snapshot.atrPercent,
    realizedVol20: snapshot.realizedVol20,
    realizedVol60: snapshot.realizedVol60,
    averageDollarVolume20: snapshot.averageDollarVolume20,
    volumeVs20DayAverage: snapshot.volumeVs20DayAverage,
    directionalConvictionScore: snapshot.directionalConvictionScore,
    premiumBuyingScore: snapshot.premiumBuyingScore,
    breakoutState: snapshot.breakoutState,
    smaStackAligned: snapshot.smaStackAligned,
    closeLocationPercent: snapshot.closeLocationPercent,
    optionsDirectionalBias: snapshot.optionsDirectionalBias,
    optionsStructureBias: snapshot.optionsStructureBias,
  };

  return { row, snapshot };
}

async function buildTickerSnapshotWithRetry(input: {
  provider: ReturnType<typeof createMarketDataProvider>;
  ticker: ReturnType<typeof getUniverse>[number];
  start: string;
  attempts: number;
}) {
  const { attempts } = input;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await buildTickerSnapshot(input);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unexpected screener symbol fetch error.");

      if (attempt < attempts) {
        await sleep(250 * attempt);
      }
    }
  }

  throw lastError ?? new Error("Screener symbol fetch failed.");
}

export async function buildScreenerDataset(
  tier: UniverseTier | "all",
  historyStart: string = getDefaultHistoryStart(),
): Promise<{
  response: ScreenerResponse;
  snapshots: FeatureSnapshot[];
}> {
  const universe = tier === "all" ? getUniverse() : getUniverseByTier(tier);
  const provider = createMarketDataProvider();
  const start = historyStart;
  const firstPass = await mapWithConcurrency(universe, CONCURRENCY, async (ticker) => {
    try {
      return await buildTickerSnapshotWithRetry({
        provider,
        ticker,
        start,
        attempts: 2,
      });
    } catch {
      return { ticker, failed: true as const };
    }
  });
  const dataset = firstPass.filter(
    (entry): entry is { row: ScreenerRow; snapshot: FeatureSnapshot } =>
      Boolean(entry) && !("failed" in entry),
  );
  const failedTickers = firstPass
    .filter((entry): entry is { ticker: ReturnType<typeof getUniverse>[number]; failed: true } => Boolean(entry) && "failed" in entry)
    .map((entry) => entry.ticker);

  if (failedTickers.length) {
    const retryPass = await mapWithConcurrency(failedTickers, RETRY_CONCURRENCY, async (ticker) => {
      try {
        return await buildTickerSnapshotWithRetry({
          provider,
          ticker,
          start,
          attempts: 3,
        });
      } catch {
        return null;
      }
    });

    dataset.push(
      ...retryPass.filter((entry): entry is { row: ScreenerRow; snapshot: FeatureSnapshot } => Boolean(entry)),
    );
  }

  return {
    response: {
      source: "alpaca",
      timeframe: "1Day",
      tier,
      rowCount: dataset.length,
      rows: dataset.map((entry) => entry.row),
      historyStart: start,
    },
    snapshots: dataset.map((entry) => entry.snapshot),
  };
}
