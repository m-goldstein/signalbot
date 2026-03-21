import { computeFeatureSnapshot } from "@/lib/features/engine";
import { createMarketDataProvider } from "@/lib/market-data";
import { FeatureSnapshot } from "@/lib/features/types";
import { ScreenerResponse, ScreenerRow } from "@/lib/screener/types";
import { getUniverse, getUniverseByTier } from "@/lib/universe/service";
import { UniverseTier } from "@/lib/universe/types";

const CONCURRENCY = 2;
const RETRY_CONCURRENCY = 1;
const DEFAULT_LOOKBACK_DAYS = 400;
const BAR_LIMIT = 320;
const MIN_REQUIRED_BARS = 253;
const BATCH_SIZE = 3;
const DATASET_CACHE_TTL_MS = 60 * 1000;

const screenerDatasetCache = new Map<
  string,
  {
    storedAt: number;
    response: ScreenerResponse;
    snapshots: FeatureSnapshot[];
  }
>();

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

function buildRowFromSnapshot(
  ticker: ReturnType<typeof getUniverse>[number],
  snapshot: FeatureSnapshot,
): ScreenerRow {
  return {
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
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function buildTickerSnapshotsBatchWithRetry(input: {
  provider: ReturnType<typeof createMarketDataProvider>;
  tickers: ReturnType<typeof getUniverse>;
  start: string;
  attempts: number;
}) {
  const { provider, tickers, start, attempts } = input;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const results = await provider.getBarsBatch?.({
        symbols: tickers.map((ticker) => ticker.symbol),
        timeframe: "1Day",
        limit: BAR_LIMIT,
        start,
      });

      if (!results) {
        throw new Error("Batched bars are not supported by the configured provider.");
      }

      const resultMap = new Map(results.map((result) => [result.symbol, result]));

      return tickers.map((ticker) => {
        const result = resultMap.get(ticker.symbol);

        if (!result || result.bars.length < MIN_REQUIRED_BARS) {
          return { ticker, failed: true as const };
        }

        const snapshot = computeFeatureSnapshot({
          symbol: ticker.symbol,
          timeframe: "1Day",
          bars: result.bars,
        });

        return {
          row: buildRowFromSnapshot(ticker, snapshot),
          snapshot,
        };
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unexpected batched screener fetch error.");

      if (attempt < attempts) {
        await sleep(500 * attempt);
      }
    }
  }

  return tickers.map((ticker) => ({ ticker, failed: true as const, error: lastError }));
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
  const cacheKey = JSON.stringify({ tier, historyStart });
  const cached = screenerDatasetCache.get(cacheKey);

  if (cached && Date.now() - cached.storedAt < DATASET_CACHE_TTL_MS) {
    return {
      response: cached.response,
      snapshots: cached.snapshots,
    };
  }

  const universe = tier === "all" ? getUniverse() : getUniverseByTier(tier);
  const provider = createMarketDataProvider();
  const start = historyStart;
  const supportsBatchBars = typeof provider.getBarsBatch === "function";
  const firstPass = supportsBatchBars
    ? (
        await mapWithConcurrency(chunk(universe, BATCH_SIZE), CONCURRENCY, async (tickers) =>
          buildTickerSnapshotsBatchWithRetry({
            provider,
            tickers,
            start,
            attempts: 2,
          }),
        )
      ).flat()
    : await mapWithConcurrency(universe, CONCURRENCY, async (ticker) => {
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
    const retryPass = supportsBatchBars
      ? (
          await mapWithConcurrency(chunk(failedTickers, BATCH_SIZE), RETRY_CONCURRENCY, async (tickers) =>
            buildTickerSnapshotsBatchWithRetry({
              provider,
              tickers,
              start,
              attempts: 3,
            }),
          )
        )
          .flat()
          .filter((entry): entry is { row: ScreenerRow; snapshot: FeatureSnapshot } => Boolean(entry) && !("failed" in entry))
      : (
          await mapWithConcurrency(failedTickers, RETRY_CONCURRENCY, async (ticker) => {
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
          })
        ).filter((entry): entry is { row: ScreenerRow; snapshot: FeatureSnapshot } => Boolean(entry));

    dataset.push(...retryPass);
  }

  const response: ScreenerResponse = {
    source: "alpaca",
    timeframe: "1Day",
    tier,
    rowCount: dataset.length,
    rows: dataset.map((entry) => entry.row),
    historyStart: start,
  };
  const snapshots = dataset.map((entry) => entry.snapshot);

  screenerDatasetCache.set(cacheKey, {
    storedAt: Date.now(),
    response,
    snapshots,
  });

  return {
    response,
    snapshots,
  };
}
