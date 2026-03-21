import { average, last } from "@/lib/features/math";
import { PriceBar } from "@/lib/market-data/types";

function trueRange(current: PriceBar, previousClose: number) {
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previousClose),
    Math.abs(current.low - previousClose),
  );
}

export function computeVolatilityFeatures(bars: PriceBar[]) {
  if (bars.length < 60) {
    throw new Error("At least 60 daily bars are required to compute volatility features.");
  }

  const latestBar = last(bars);
  const trSeries = bars.slice(1).map((bar, index) => trueRange(bar, bars[index].close));
  const atr14 = average(trSeries.slice(-14));
  const atrPercent = latestBar.close === 0 ? 0 : (atr14 / latestBar.close) * 100;
  const latestVolume = latestBar.volume;
  const volume20Average = average(bars.slice(-20).map((bar) => bar.volume));
  const averageDollarVolume20 = average(
    bars.slice(-20).map((bar) => bar.close * bar.volume),
  );
  const recentRangeAverage = average(
    bars.slice(-5).map((bar) => (bar.high - bar.low) / Math.max(bar.close, 0.000001)),
  );
  const baselineRangeAverage = average(
    bars.slice(-20, -5).map((bar) => (bar.high - bar.low) / Math.max(bar.close, 0.000001)),
  );
  const dailyReturns = bars
    .slice(1)
    .map((bar, index) => (bars[index].close === 0 ? 0 : (bar.close - bars[index].close) / bars[index].close));

  const realizedVol20 =
    Math.sqrt(
      average(dailyReturns.slice(-20).map((value) => value ** 2)),
    ) * Math.sqrt(252) * 100;
  const realizedVol60 =
    Math.sqrt(
      average(dailyReturns.slice(-60).map((value) => value ** 2)),
    ) * Math.sqrt(252) * 100;

  return {
    atr14,
    atrPercent,
    volumeVs20DayAverage: volume20Average === 0 ? 0 : latestVolume / volume20Average,
    rangeCompressionRatio: baselineRangeAverage === 0 ? 0 : recentRangeAverage / baselineRangeAverage,
    averageDollarVolume20,
    realizedVol20,
    realizedVol60,
  };
}
