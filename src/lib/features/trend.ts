import { PriceBar } from "@/lib/market-data/types";
import { average, last, percentDistance } from "@/lib/features/math";

function getCloses(bars: PriceBar[]) {
  return bars.map((bar) => bar.close);
}

function getSma(values: number[], period: number): number {
  return average(values.slice(-period));
}

function getPeriodReturn(closes: number[], lookback: number) {
  const reference = closes.at(-(lookback + 1));
  const latest = last(closes);

  if (reference === undefined || reference === 0) {
    return 0;
  }

  return percentDistance(latest, reference);
}

export function computeTrendFeatures(bars: PriceBar[]) {
  if (bars.length < 253) {
    throw new Error("At least 253 daily bars are required to compute trend features.");
  }

  const closes = getCloses(bars);
  const latestClose = last(closes);
  const sma20 = getSma(closes, 20);
  const sma50 = getSma(closes, 50);
  const sma200 = getSma(closes, 200);
  const previousSma200 = average(closes.slice(-201, -1));

  return {
    close: latestClose,
    priorClose: closes.at(-2) ?? latestClose,
    oneMonthChangePercent: getPeriodReturn(closes, 21),
    threeMonthChangePercent: getPeriodReturn(closes, 63),
    sixMonthChangePercent: getPeriodReturn(closes, 126),
    oneYearChangePercent: getPeriodReturn(closes, 252),
    sma20,
    sma50,
    sma200,
    distanceFrom20Sma: percentDistance(latestClose, sma20),
    distanceFrom50Sma: percentDistance(latestClose, sma50),
    distanceFrom200Sma: percentDistance(latestClose, sma200),
    isAbove20: latestClose > sma20,
    isAbove50: latestClose > sma50,
    isAbove200: latestClose > sma200,
    smaStackAligned: sma20 > sma50 && sma50 > sma200,
    sma200SlopePercent: percentDistance(sma200, previousSma200),
  };
}
