import { last, percentDistance } from "@/lib/features/math";
import { PriceBar } from "@/lib/market-data/types";

export function computePriceStructureFeatures(bars: PriceBar[]) {
  if (bars.length < 253) {
    throw new Error("At least 253 daily bars are required to compute price-structure features.");
  }

  const latestBar = last(bars);
  const priorBar = bars.at(-2) ?? latestBar;
  const prior20 = bars.slice(-21, -1);
  const prior252 = bars.slice(-253, -1);
  const twentyDayHigh = Math.max(...prior20.map((bar) => bar.high));
  const twentyDayLow = Math.min(...prior20.map((bar) => bar.low));
  const fiftyTwoWeekHigh = Math.max(...prior252.map((bar) => bar.high));
  const fiftyTwoWeekLow = Math.min(...prior252.map((bar) => bar.low));
  const range = latestBar.high - latestBar.low;

  return {
    latestOpen: latestBar.open,
    latestHigh: latestBar.high,
    latestLow: latestBar.low,
    dailyChangePercent: percentDistance(latestBar.close, priorBar.close),
    twentyDayHigh,
    twentyDayLow,
    fiftyTwoWeekHigh,
    fiftyTwoWeekLow,
    distanceFrom52WeekHigh: percentDistance(latestBar.close, fiftyTwoWeekHigh),
    distanceFrom52WeekLow: percentDistance(latestBar.close, fiftyTwoWeekLow),
    closeLocationPercent:
      range === 0 ? 50 : ((latestBar.close - latestBar.low) / range) * 100,
    breakoutState:
      latestBar.close > twentyDayHigh
        ? "breakout"
        : latestBar.close < twentyDayLow
          ? "breakdown"
          : "inside-range",
  } as const;
}
