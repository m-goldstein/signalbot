import { computeFeatureSnapshot } from "@/lib/features/engine";
import { createMarketDataProvider } from "@/lib/market-data";
import { PriceBar } from "@/lib/market-data/types";
import { getTickerMetadata } from "@/lib/universe/service";

const LOOKBACK_DAYS = 3650;
const BAR_LIMIT = 5000;

function getHistoryStart() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - LOOKBACK_DAYS);
  return date.toISOString();
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeSmaSeries(bars: PriceBar[], period: number) {
  return bars.map((bar, index) => {
    if (index + 1 < period) {
      return { timestamp: bar.timestamp, value: null as number | null };
    }

    const window = bars.slice(index + 1 - period, index + 1).map((item) => item.close);
    return { timestamp: bar.timestamp, value: average(window) };
  });
}

export async function buildScreenerDetail(symbol: string) {
  const metadata = getTickerMetadata(symbol);

  if (!metadata) {
    throw new Error(`Unknown screener symbol: ${symbol}`);
  }

  const provider = createMarketDataProvider();
  const result = await provider.getBars({
    symbol,
    timeframe: "1Day",
    limit: BAR_LIMIT,
    start: getHistoryStart(),
  });
  const snapshot = computeFeatureSnapshot({
    symbol,
    timeframe: "1Day",
    bars: result.bars,
  });
  const chartBars = result.bars;

  return {
    symbol: metadata.symbol,
    name: metadata.name,
    segment: metadata.segment,
    tier: metadata.tier,
    snapshot,
    series: {
      bars: chartBars.map((bar) => ({
        timestamp: bar.timestamp,
        close: bar.close,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
      })),
      sma20: computeSmaSeries(chartBars, 20),
      sma50: computeSmaSeries(chartBars, 50),
      sma200: computeSmaSeries(chartBars, 200),
    },
    references: {
      fullHistoryHigh: Math.max(...chartBars.map((bar) => bar.high)),
      fullHistoryLow: Math.min(...chartBars.map((bar) => bar.low)),
    },
  };
}
