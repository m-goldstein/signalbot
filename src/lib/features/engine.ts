import { computePriceStructureFeatures } from "@/lib/features/price-structure";
import { computeTrendFeatures } from "@/lib/features/trend";
import { FeatureSnapshot } from "@/lib/features/types";
import { computeVolatilityFeatures } from "@/lib/features/volatility";
import { PriceBar, Timeframe } from "@/lib/market-data/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function computeFeatureSnapshot(input: {
  symbol: string;
  timeframe: Timeframe;
  bars: PriceBar[];
}): FeatureSnapshot {
  const { symbol, timeframe, bars } = input;

  if (bars.length < 253) {
    throw new Error(`At least 253 daily bars are required for ${symbol} feature computation.`);
  }

  const trend = computeTrendFeatures(bars);
  const priceStructure = computePriceStructureFeatures(bars);
  const volatility = computeVolatilityFeatures(bars);
  const latestBar = bars.at(-1);

  if (!latestBar) {
    throw new Error(`No bars available for ${symbol}.`);
  }

  const trendComposite = clamp(
    (trend.distanceFrom20Sma * 0.25) +
      (trend.distanceFrom50Sma * 0.25) +
      (trend.distanceFrom200Sma * 0.2) +
      (trend.sma200SlopePercent * 6) +
      (trend.smaStackAligned ? 5 : -3),
    -100,
    100,
  );
  const momentumComposite = clamp(
    (trend.oneMonthChangePercent * 0.2) +
      (trend.threeMonthChangePercent * 0.25) +
      (trend.sixMonthChangePercent * 0.25) +
      (trend.oneYearChangePercent * 0.1),
    -100,
    100,
  );
  const bullishBreakoutScore = clamp(
    trendComposite * 0.35 +
      momentumComposite * 0.2 +
      (priceStructure.breakoutState === "breakout" ? 20 : 0) +
      (priceStructure.closeLocationPercent - 50) * 0.35 +
      (volatility.volumeVs20DayAverage - 1) * 10 -
      Math.abs(volatility.rangeCompressionRatio - 1) * 4,
    -100,
    100,
  );
  const bearishBreakdownScore = clamp(
    (-trendComposite * 0.35) +
      (-momentumComposite * 0.2) +
      (priceStructure.breakoutState === "breakdown" ? 20 : 0) +
      (50 - priceStructure.closeLocationPercent) * 0.35 +
      (volatility.volumeVs20DayAverage - 1) * 10 -
      Math.abs(volatility.rangeCompressionRatio - 1) * 4,
    -100,
    100,
  );
  const premiumBuyingScore = clamp(
    55 -
      volatility.realizedVol20 * 0.25 -
      volatility.atrPercent * 2 +
      Math.min(volatility.averageDollarVolume20 / 1_000_000_000, 20) * 1.5 +
      (volatility.volumeVs20DayAverage > 1 ? 5 : 0),
    0,
    100,
  );
  const directionalConvictionScore = clamp(
    Math.max(Math.abs(bullishBreakoutScore), Math.abs(bearishBreakdownScore)),
    0,
    100,
  );
  const optionsDirectionalBias =
    bullishBreakoutScore >= 12 && bullishBreakoutScore > bearishBreakdownScore
      ? "call"
      : bearishBreakdownScore >= 12 && bearishBreakdownScore > bullishBreakoutScore
        ? "put"
        : "neutral";
  const optionsStructureBias =
    optionsDirectionalBias === "call"
      ? premiumBuyingScore >= 55
        ? "long_call"
        : "call_spread"
      : optionsDirectionalBias === "put"
        ? premiumBuyingScore >= 55
          ? "long_put"
          : "put_spread"
        : directionalConvictionScore >= 18
          ? "watchlist"
          : "no_trade";

  return {
    symbol,
    timeframe,
    asOf: latestBar.timestamp,
    barCount: bars.length,
    ...trend,
    ...priceStructure,
    ...volatility,
    expectedMove5DayPercent: volatility.atrPercent * Math.sqrt(5),
    expectedMove10DayPercent: volatility.atrPercent * Math.sqrt(10),
    momentumComposite,
    trendComposite,
    bullishBreakoutScore,
    bearishBreakdownScore,
    premiumBuyingScore,
    directionalConvictionScore,
    optionsDirectionalBias,
    optionsStructureBias,
  };
}
