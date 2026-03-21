"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./screener-detail-chart.module.css";
import {
  buildAreaPath,
  buildLinePath,
  computeFibonacciLevels,
  createIndexTicks,
  createPriceDomain,
  createTicks,
  createXScale,
  createYScale,
  formatDateTick,
  formatPriceTick,
  formatVolumeTick,
} from "@/lib/chart/engine";
import {
  CONTRACT_WATCHLIST_EVENT,
  ContractWatchlistEntry,
  isContractWatched,
  toggleContractWatchlist,
} from "@/lib/watchlist/contracts";

type ChartPoint = {
  timestamp: string;
  close: number;
  high: number;
  low: number;
  volume: number;
};

type OverlayPoint = {
  timestamp: string;
  value: number | null;
};

type ScreenerDetailChartProps = {
  symbol: string;
  showCharts: boolean;
  bars: ChartPoint[];
  sma20: OverlayPoint[];
  sma50: OverlayPoint[];
  sma200: OverlayPoint[];
  insights: Array<{
    key: string;
    title: string;
    status: "available" | "needs_options_data" | "needs_event_data";
    summary: string;
    bullets: string[];
  }>;
  optionContracts: {
    underlyingSymbol: string;
    count: number;
    suggested: Array<{
      symbol: string;
      optionType: "call" | "put";
      expirationDate: string;
      daysToExpiration: number;
      strikePrice: number;
      bid: number;
      ask: number;
      mark: number;
      breakEven: number;
      dailyVolume: number;
      bidAskSpreadPercent: number;
      score: number;
      thesisFit: "aligned" | "countertrend" | "watch";
      structure: "long_call" | "call_spread" | "long_put" | "put_spread" | "watchlist";
      rationale: string[];
    }>;
    fastLane: Array<{
      symbol: string;
      optionType: "call" | "put";
      expirationDate: string;
      daysToExpiration: number;
      strikePrice: number;
      bid: number;
      ask: number;
      mark: number;
      breakEven: number;
      dailyVolume: number;
      bidAskSpreadPercent: number;
      score: number;
      thesisFit: "aligned" | "countertrend" | "watch";
      structure: "long_call" | "call_spread" | "long_put" | "put_spread" | "watchlist";
      rationale: string[];
    }>;
  };
};

type TimeScale = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "ALL";
type OverlayKey =
  | "close"
  | "ema8"
  | "ema21"
  | "vwap"
  | "sma20"
  | "sma50"
  | "sma200"
  | "bollinger"
  | "donchian"
  | "range"
  | "expectedMove"
  | "fibonacci"
  | "rsi"
  | "macd"
  | "volume"
  | "volumeAverage";

type BandSeries = {
  upper: OverlayPoint[];
  middle: OverlayPoint[];
  lower: OverlayPoint[];
};

type MacdSeries = {
  macd: OverlayPoint[];
  signal: OverlayPoint[];
  histogram: OverlayPoint[];
};

const TIME_SCALES: TimeScale[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y", "ALL"];
const DEFAULT_OVERLAYS: Record<OverlayKey, boolean> = {
  close: true,
  ema8: false,
  ema21: true,
  vwap: false,
  sma20: false,
  sma50: false,
  sma200: true,
  bollinger: false,
  donchian: false,
  range: false,
  expectedMove: false,
  fibonacci: false,
  rsi: false,
  macd: false,
  volume: true,
  volumeAverage: true,
};
const OVERLAY_LABELS: Record<OverlayKey, string> = {
  close: "Close",
  ema8: "EMA 8",
  ema21: "EMA 21",
  vwap: "VWAP",
  sma20: "SMA 20",
  sma50: "SMA 50",
  sma200: "SMA 200",
  bollinger: "Bollinger",
  donchian: "Donchian 20",
  range: "Visible range",
  expectedMove: "Expected move",
  fibonacci: "Fibonacci",
  rsi: "RSI 14",
  macd: "MACD",
  volume: "Volume",
  volumeAverage: "Avg vol 20",
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  if (!values.length) {
    return 0;
  }

  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function trueRange(current: ChartPoint, previousClose: number) {
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previousClose),
    Math.abs(current.low - previousClose),
  );
}

function barsForScale(scale: TimeScale, bars: ChartPoint[]) {
  const map: Record<Exclude<TimeScale, "ALL">, number> = {
    "1D": 1,
    "1W": 5,
    "1M": 21,
    "3M": 63,
    "6M": 126,
    "1Y": 252,
    "5Y": 1260,
  };

  if (scale === "ALL") {
    return bars;
  }

  return bars.slice(-Math.min(map[scale], bars.length));
}

function overlaysForScale(scaleBars: ChartPoint[], overlays: OverlayPoint[]) {
  return overlays.slice(-scaleBars.length);
}

function bandOverlaysForScale(scaleBars: ChartPoint[], overlays: BandSeries) {
  return {
    upper: overlays.upper.slice(-scaleBars.length),
    middle: overlays.middle.slice(-scaleBars.length),
    lower: overlays.lower.slice(-scaleBars.length),
  };
}

function computeBollingerSeries(bars: ChartPoint[], period = 20, deviations = 2): BandSeries {
  return {
    upper: bars.map((bar, index) => {
      if (index + 1 < period) {
        return { timestamp: bar.timestamp, value: null };
      }

      const window = bars.slice(index + 1 - period, index + 1).map((item) => item.close);
      const mean = average(window);
      return { timestamp: bar.timestamp, value: mean + standardDeviation(window) * deviations };
    }),
    middle: bars.map((bar, index) => {
      if (index + 1 < period) {
        return { timestamp: bar.timestamp, value: null };
      }

      const window = bars.slice(index + 1 - period, index + 1).map((item) => item.close);
      return { timestamp: bar.timestamp, value: average(window) };
    }),
    lower: bars.map((bar, index) => {
      if (index + 1 < period) {
        return { timestamp: bar.timestamp, value: null };
      }

      const window = bars.slice(index + 1 - period, index + 1).map((item) => item.close);
      const mean = average(window);
      return { timestamp: bar.timestamp, value: mean - standardDeviation(window) * deviations };
    }),
  };
}

function computeDonchianSeries(bars: ChartPoint[], period = 20): BandSeries {
  return {
    upper: bars.map((bar, index) => {
      if (index + 1 < period) {
        return { timestamp: bar.timestamp, value: null };
      }

      const window = bars.slice(index + 1 - period, index + 1);
      return { timestamp: bar.timestamp, value: Math.max(...window.map((item) => item.high)) };
    }),
    middle: bars.map((bar, index) => {
      if (index + 1 < period) {
        return { timestamp: bar.timestamp, value: null };
      }

      const window = bars.slice(index + 1 - period, index + 1);
      return {
        timestamp: bar.timestamp,
        value: (Math.max(...window.map((item) => item.high)) + Math.min(...window.map((item) => item.low))) / 2,
      };
    }),
    lower: bars.map((bar, index) => {
      if (index + 1 < period) {
        return { timestamp: bar.timestamp, value: null };
      }

      const window = bars.slice(index + 1 - period, index + 1);
      return { timestamp: bar.timestamp, value: Math.min(...window.map((item) => item.low)) };
    }),
  };
}

function computeEmaSeries(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  let ema: number | null = null;

  return values.map((value, index) => {
    if (index + 1 < period) {
      return null;
    }

    if (ema === null) {
      ema = average(values.slice(index + 1 - period, index + 1));
      return ema;
    }

    ema = (value - ema) * multiplier + ema;
    return ema;
  });
}

function wrapSeries(bars: ChartPoint[], values: Array<number | null>): OverlayPoint[] {
  return bars.map((bar, index) => ({
    timestamp: bar.timestamp,
    value: values[index] ?? null,
  }));
}

function computeVwapSeries(bars: ChartPoint[]): OverlayPoint[] {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  return bars.map((bar) => {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumulativePriceVolume += typicalPrice * bar.volume;
    cumulativeVolume += bar.volume;

    return {
      timestamp: bar.timestamp,
      value: cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null,
    };
  });
}

function computeAverageVolumeSeries(bars: ChartPoint[], period = 20): OverlayPoint[] {
  return bars.map((bar, index) => {
    if (index + 1 < period) {
      return { timestamp: bar.timestamp, value: null };
    }

    const window = bars.slice(index + 1 - period, index + 1);
    return { timestamp: bar.timestamp, value: average(window.map((item) => item.volume)) };
  });
}

function computeRsiSeries(bars: ChartPoint[], period = 14): OverlayPoint[] {
  const closes = bars.map((bar) => bar.close);
  const gains: number[] = [];
  const losses: number[] = [];

  for (let index = 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }

  let averageGain = 0;
  let averageLoss = 0;

  return bars.map((bar, index) => {
    if (index < period) {
      return { timestamp: bar.timestamp, value: null };
    }

    if (index === period) {
      averageGain = average(gains.slice(0, period));
      averageLoss = average(losses.slice(0, period));
    } else {
      averageGain = (averageGain * (period - 1) + gains[index - 1]) / period;
      averageLoss = (averageLoss * (period - 1) + losses[index - 1]) / period;
    }

    const relativeStrength = averageLoss === 0 ? 100 : averageGain / averageLoss;
    const rsi = averageLoss === 0 ? 100 : 100 - 100 / (1 + relativeStrength);

    return { timestamp: bar.timestamp, value: rsi };
  });
}

function computeMacdSeries(bars: ChartPoint[]): MacdSeries {
  const closes = bars.map((bar) => bar.close);
  const ema12 = computeEmaSeries(closes, 12);
  const ema26 = computeEmaSeries(closes, 26);
  const macdValues = closes.map((_, index) =>
    ema12[index] !== null && ema26[index] !== null ? (ema12[index] as number) - (ema26[index] as number) : null,
  );
  const signalInput = macdValues.map((value) => value ?? 0);
  const signalValues = computeEmaSeries(signalInput, 9);

  return {
    macd: bars.map((bar, index) => ({
      timestamp: bar.timestamp,
      value: macdValues[index],
    })),
    signal: bars.map((bar, index) => ({
      timestamp: bar.timestamp,
      value: macdValues[index] !== null && signalValues[index] !== null ? signalValues[index] : null,
    })),
    histogram: bars.map((bar, index) => ({
      timestamp: bar.timestamp,
      value:
        macdValues[index] !== null && signalValues[index] !== null
          ? (macdValues[index] as number) - (signalValues[index] as number)
          : null,
    })),
  };
}

function computeSliceMetrics(bars: ChartPoint[]) {
  const latest = bars.at(-1);
  const first = bars[0];

  if (!latest || !first) {
    return null;
  }

  const priceChangePercent = first.close === 0 ? 0 : ((latest.close - first.close) / first.close) * 100;
  const high = Math.max(...bars.map((bar) => bar.high));
  const low = Math.min(...bars.map((bar) => bar.low));
  const avgVolume = average(bars.map((bar) => bar.volume));
  const avgDollarVolume = average(bars.map((bar) => bar.close * bar.volume));
  const trSeries = bars.slice(1).map((bar, index) => trueRange(bar, bars[index].close));
  const atr = average(trSeries.slice(-Math.min(14, trSeries.length)));
  const atrPercent = latest.close === 0 ? 0 : (atr / latest.close) * 100;
  const returns = bars
    .slice(1)
    .map((bar, index) => (bars[index].close === 0 ? 0 : (bar.close - bars[index].close) / bars[index].close));
  const realizedVol =
    returns.length === 0
      ? 0
      : Math.sqrt(average(returns.slice(-Math.min(20, returns.length)).map((value) => value ** 2))) *
        Math.sqrt(252) *
        100;
  const range = latest.high - latest.low;
  const closeLocationPercent = range === 0 ? 50 : ((latest.close - latest.low) / range) * 100;

  const directionalScore = Math.max(
    Math.abs(priceChangePercent) * 0.3 + atrPercent * 1.5 + (closeLocationPercent > 60 || closeLocationPercent < 40 ? 8 : 0),
    0,
  );
  const premiumScore = Math.max(0, Math.min(100, 60 - realizedVol * 0.25 - atrPercent * 2));
  const optionsBias = priceChangePercent > 5 ? "call" : priceChangePercent < -5 ? "put" : "neutral";
  const structure =
    optionsBias === "call"
      ? premiumScore >= 55
        ? "long_call"
        : "call_spread"
      : optionsBias === "put"
        ? premiumScore >= 55
          ? "long_put"
          : "put_spread"
        : "watchlist";

  return {
    latestClose: latest.close,
    priceChangePercent,
    high,
    low,
    avgVolume,
    avgDollarVolume,
    atrPercent,
    realizedVol,
    closeLocationPercent,
    directionalScore,
    premiumScore,
    optionsBias,
    structure,
    expectedMove5Upper: latest.close * (1 + (atrPercent * Math.sqrt(5)) / 100),
    expectedMove5Lower: latest.close * (1 - (atrPercent * Math.sqrt(5)) / 100),
    expectedMove10Upper: latest.close * (1 + (atrPercent * Math.sqrt(10)) / 100),
    expectedMove10Lower: latest.close * (1 - (atrPercent * Math.sqrt(10)) / 100),
  };
}

function formatMoney(value: number) {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }

  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPrice(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatStructure(value: string) {
  return value.replaceAll("_", " ");
}

function formatLane(value: "suggested" | "fast_lane") {
  return value === "fast_lane" ? "Fast lane" : "Suggested";
}

function differenceInDays(start: string, end: string) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return Math.max(endTime - startTime, 0) / (1000 * 60 * 60 * 24);
}

function formatAxisDateLabel(timestamp: string, spanDays: number) {
  if (spanDays <= 45) {
    return {
      primary: formatDateTick(timestamp, { month: "short", day: "numeric" }),
      secondary: formatDateTick(timestamp, { year: "numeric" }),
    };
  }

  if (spanDays <= 550) {
    return {
      primary: formatDateTick(timestamp, { month: "short", year: "numeric" }),
      secondary: formatDateTick(timestamp, { day: "numeric" }),
    };
  }

  return {
    primary: formatDateTick(timestamp, { month: "short", year: "numeric" }),
    secondary: "",
  };
}

function getTickAnchor(index: number, length: number) {
  if (index === 0) {
    return "start" as const;
  }

  if (index === length - 1) {
    return "end" as const;
  }

  return "middle" as const;
}

function nearestLevel(levels: Array<{ label: string; value: number }>, price: number) {
  return levels.reduce((closest, level) => {
    if (!closest) {
      return level;
    }

    return Math.abs(level.value - price) < Math.abs(closest.value - price) ? level : closest;
  }, null as { label: string; value: number } | null);
}

function formatInsightStatus(status: ScreenerDetailChartProps["insights"][number]["status"]) {
  if (status === "available") {
    return "Computed";
  }

  if (status === "needs_options_data") {
    return "Needs options data";
  }

  return "Needs event data";
}

function latestValue(series: OverlayPoint[]) {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index]?.value;

    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return null;
}

function overlayPath(points: OverlayPoint[], xScale: (index: number) => number, yScale: (value: number) => number) {
  return buildLinePath(
    points.map((point, index) =>
      point.value === null ? null : { x: xScale(index), y: yScale(point.value) },
    ),
  );
}

function overlayAreaPath(
  upper: OverlayPoint[],
  lower: OverlayPoint[],
  xScale: (index: number) => number,
  yScale: (value: number) => number,
) {
  const upperPoints = upper
    .map((point, index) => (point.value === null ? null : { x: xScale(index), y: yScale(point.value) }))
    .filter(Boolean) as Array<{ x: number; y: number }>;
  const lowerPoints = (
    lower
      .map((point, index) => (point.value === null ? null : { x: xScale(index), y: yScale(point.value) }))
      .filter(Boolean) as Array<{ x: number; y: number }>
  ).reverse();

  if (!upperPoints.length || !lowerPoints.length) {
    return "";
  }

  const points = [...upperPoints, ...lowerPoints];
  return `${buildLinePath(points)} Z`;
}

export function ScreenerDetailChart({
  symbol,
  showCharts,
  bars,
  sma20,
  sma50,
  sma200,
  insights,
  optionContracts,
}: ScreenerDetailChartProps) {
  const [scale, setScale] = useState<TimeScale>("1Y");
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>(DEFAULT_OVERLAYS);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);

  useEffect(() => {
    function refresh() {
      const symbols = [
        ...new Set(
          [...optionContracts.suggested, ...optionContracts.fastLane]
            .filter((contract) => isContractWatched(contract.symbol))
            .map((contract) => contract.symbol),
        ),
      ];

      setWatchlistSymbols(symbols);
    }

    refresh();
    window.addEventListener(CONTRACT_WATCHLIST_EVENT, refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener(CONTRACT_WATCHLIST_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [optionContracts.fastLane, optionContracts.suggested]);

  const studies = useMemo(() => {
    const closes = bars.map((bar) => bar.close);

    return {
      ema8: wrapSeries(bars, computeEmaSeries(closes, 8)),
      ema21: wrapSeries(bars, computeEmaSeries(closes, 21)),
      vwap: computeVwapSeries(bars),
      bollinger: computeBollingerSeries(bars),
      donchian: computeDonchianSeries(bars),
      rsi: computeRsiSeries(bars),
      macd: computeMacdSeries(bars),
      volumeAverage: computeAverageVolumeSeries(bars),
    };
  }, [bars]);

  const slice = useMemo(() => {
    const visibleBars = barsForScale(scale, bars);

    return {
      bars: visibleBars,
      sma20: overlaysForScale(visibleBars, sma20),
      sma50: overlaysForScale(visibleBars, sma50),
      sma200: overlaysForScale(visibleBars, sma200),
      ema8: overlaysForScale(visibleBars, studies.ema8),
      ema21: overlaysForScale(visibleBars, studies.ema21),
      vwap: overlaysForScale(visibleBars, studies.vwap),
      bollinger: bandOverlaysForScale(visibleBars, studies.bollinger),
      donchian: bandOverlaysForScale(visibleBars, studies.donchian),
      rsi: overlaysForScale(visibleBars, studies.rsi),
      macd: {
        macd: overlaysForScale(visibleBars, studies.macd.macd),
        signal: overlaysForScale(visibleBars, studies.macd.signal),
        histogram: overlaysForScale(visibleBars, studies.macd.histogram),
      },
      volumeAverage: overlaysForScale(visibleBars, studies.volumeAverage),
      metrics: computeSliceMetrics(visibleBars),
    };
  }, [bars, scale, sma20, sma50, sma200, studies]);

  const metrics = slice.metrics;

  if (!metrics || !slice.bars.length) {
    return null;
  }

  const width = 1140;
  const priceFrame = {
    width,
    height: 432,
    margins: { top: 30, right: 92, bottom: 30, left: 92 },
  };
  const rsiFrame = {
    width,
    height: 132,
    margins: { top: 18, right: 92, bottom: 20, left: 92 },
  };
  const macdFrame = {
    width,
    height: 156,
    margins: { top: 18, right: 92, bottom: 20, left: 92 },
  };
  const volumeFrame = {
    width,
    height: 170,
    margins: { top: 18, right: 92, bottom: 76, left: 92 },
  };

  const priceOverlayValues = [
    ...slice.bars.flatMap((bar) => [bar.high, bar.low]),
    ...slice.ema8.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.ema21.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.vwap.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.sma20.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.sma50.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.sma200.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.bollinger.upper.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.bollinger.lower.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.donchian.upper.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.donchian.lower.flatMap((point) => (point.value === null ? [] : [point.value])),
    metrics.high,
    metrics.low,
    metrics.expectedMove5Upper,
    metrics.expectedMove5Lower,
    metrics.expectedMove10Upper,
    metrics.expectedMove10Lower,
  ];

  const priceDomain = createPriceDomain(priceOverlayValues, 0.08);
  const xScale = createXScale(slice.bars.length, priceFrame);
  const priceY = createYScale(priceDomain.min, priceDomain.max, priceFrame);
  const priceTicks = createTicks(priceDomain.min, priceDomain.max, 6);

  const rsiValues = slice.rsi.flatMap((point) => (point.value === null ? [] : [point.value]));
  const rsiDomain = createPriceDomain(rsiValues.length ? rsiValues : [0, 100], 0.08);
  const rsiY = createYScale(Math.max(0, rsiDomain.min), Math.min(100, rsiDomain.max), rsiFrame);
  const rsiTicks = [70, 50, 30];

  const macdValues = [
    ...slice.macd.macd.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.macd.signal.flatMap((point) => (point.value === null ? [] : [point.value])),
    ...slice.macd.histogram.flatMap((point) => (point.value === null ? [] : [point.value])),
    0,
  ];
  const macdDomain = createPriceDomain(macdValues.length ? macdValues : [0], 0.18);
  const macdY = createYScale(macdDomain.min, macdDomain.max, macdFrame);
  const macdTicks = createTicks(macdDomain.min, macdDomain.max, 5);

  const volumeMax = Math.max(...slice.bars.map((bar) => bar.volume), 1);
  const volumeDomain = createPriceDomain([0, volumeMax, latestValue(slice.volumeAverage) ?? 0], 0.08);
  const volumeY = createYScale(0, volumeDomain.max, volumeFrame);
  const volumeTicks = createTicks(0, volumeDomain.max, 3);
  const xTicks = createIndexTicks(slice.bars.length, 7);

  const timeSpanDays = differenceInDays(slice.bars[0].timestamp, slice.bars.at(-1)?.timestamp ?? slice.bars[0].timestamp);
  const fibonacciLevels = computeFibonacciLevels(metrics.low, metrics.high);
  const nearestFibLevel = nearestLevel(fibonacciLevels, metrics.latestClose);
  const fibMidpoint = metrics.low + (metrics.high - metrics.low) * 0.5;
  const fib618 = metrics.low + (metrics.high - metrics.low) * 0.618;
  const fib382 = metrics.low + (metrics.high - metrics.low) * 0.382;
  const fibBias =
    metrics.priceChangePercent >= 0
      ? metrics.latestClose >= fib618
        ? "bullish continuation"
        : metrics.latestClose >= fibMidpoint
          ? "moderate bullish retracement"
          : "deep bullish retracement"
      : metrics.latestClose <= fib382
        ? "bearish continuation"
        : metrics.latestClose <= fibMidpoint
          ? "moderate bearish retracement"
          : "deep bearish retracement";
  const fibDistancePercent =
    nearestFibLevel && metrics.latestClose !== 0
      ? ((metrics.latestClose - nearestFibLevel.value) / metrics.latestClose) * 100
      : 0;

  const closePoints = slice.bars.map((bar, index) => ({
    x: xScale(index),
    y: priceY(bar.close),
  }));
  const closePath = buildLinePath(closePoints);
  const closeAreaPath = buildAreaPath(closePoints, priceFrame.height - priceFrame.margins.bottom);
  const ema8Path = overlayPath(slice.ema8, xScale, priceY);
  const ema21Path = overlayPath(slice.ema21, xScale, priceY);
  const vwapPath = overlayPath(slice.vwap, xScale, priceY);
  const sma20Path = overlayPath(slice.sma20, xScale, priceY);
  const sma50Path = overlayPath(slice.sma50, xScale, priceY);
  const sma200Path = overlayPath(slice.sma200, xScale, priceY);
  const bollingerAreaPath = overlayAreaPath(slice.bollinger.upper, slice.bollinger.lower, xScale, priceY);
  const bollingerUpperPath = overlayPath(slice.bollinger.upper, xScale, priceY);
  const bollingerMiddlePath = overlayPath(slice.bollinger.middle, xScale, priceY);
  const bollingerLowerPath = overlayPath(slice.bollinger.lower, xScale, priceY);
  const donchianUpperPath = overlayPath(slice.donchian.upper, xScale, priceY);
  const donchianLowerPath = overlayPath(slice.donchian.lower, xScale, priceY);
  const rsiPath = overlayPath(slice.rsi, xScale, rsiY);
  const macdPath = overlayPath(slice.macd.macd, xScale, macdY);
  const signalPath = overlayPath(slice.macd.signal, xScale, macdY);
  const avgVolumePath = overlayPath(slice.volumeAverage, xScale, volumeY);

  const volumeBars = slice.bars.map((bar, index) => {
    const x = xScale(index);
    const y = volumeY(bar.volume);
    const baseline = volumeFrame.height - volumeFrame.margins.bottom;
    const widthScale = Math.max(3, 10 - slice.bars.length / 30);

    return {
      x: x - widthScale / 2,
      y,
      width: widthScale,
      height: Math.max(1, baseline - y),
      isDown: index > 0 ? bar.close < slice.bars[index - 1].close : false,
    };
  });

  const referenceLines = [
    { label: "slice high", value: metrics.high, color: "#dc2626", dash: "7 4" },
    { label: "slice low", value: metrics.low, color: "#dc2626", dash: "7 4" },
    { label: "5d upper", value: metrics.expectedMove5Upper, color: "#2563eb", dash: "3 3" },
    { label: "5d lower", value: metrics.expectedMove5Lower, color: "#2563eb", dash: "3 3" },
    { label: "10d upper", value: metrics.expectedMove10Upper, color: "#6b7280", dash: "2 6" },
    { label: "10d lower", value: metrics.expectedMove10Lower, color: "#6b7280", dash: "2 6" },
  ];

  const latestClose = metrics.latestClose;
  const latestEma8 = latestValue(slice.ema8);
  const latestEma21 = latestValue(slice.ema21);
  const latestVwap = latestValue(slice.vwap);
  const latestRsi = latestValue(slice.rsi);
  const latestMacd = latestValue(slice.macd.macd);
  const latestSignal = latestValue(slice.macd.signal);
  const latestHistogram = latestValue(slice.macd.histogram);
  const latestAvgVolume = latestValue(slice.volumeAverage);
  const latestBollingerUpper = latestValue(slice.bollinger.upper);
  const latestBollingerLower = latestValue(slice.bollinger.lower);
  const latestDonchianUpper = latestValue(slice.donchian.upper);
  const latestDonchianLower = latestValue(slice.donchian.lower);
  const closeVsAvgVolume = latestAvgVolume && latestAvgVolume > 0 ? slice.bars.at(-1)!.volume / latestAvgVolume : null;
  const bandWidthPercent =
    latestBollingerUpper !== null && latestBollingerLower !== null && latestClose !== 0
      ? ((latestBollingerUpper - latestBollingerLower) / latestClose) * 100
      : null;

  const traderCards = [
    {
      label: "Trend stack",
      value:
        latestEma8 !== null && latestEma21 !== null && latestClose > latestEma8 && latestEma8 > latestEma21
          ? "Bullish"
          : latestEma8 !== null && latestEma21 !== null && latestClose < latestEma8 && latestEma8 < latestEma21
            ? "Bearish"
            : "Mixed",
      note:
        latestEma8 !== null && latestEma21 !== null
          ? `${formatPrice(latestClose)} vs EMA8 ${formatPrice(latestEma8)} and EMA21 ${formatPrice(latestEma21)}`
          : "Not enough bars for short-term trend stack",
    },
    {
      label: "Momentum",
      value:
        latestRsi === null
          ? "Pending"
          : latestRsi >= 70
            ? "Extended"
            : latestRsi <= 30
              ? "Oversold"
              : latestRsi >= 55
                ? "Positive"
                : latestRsi <= 45
                  ? "Negative"
                  : "Balanced",
      note: latestRsi === null ? "RSI needs more bars" : `RSI 14 at ${latestRsi.toFixed(1)} with MACD histogram ${latestHistogram?.toFixed(2) ?? "-"}`,
    },
    {
      label: "Participation",
      value:
        closeVsAvgVolume === null
          ? "Pending"
          : closeVsAvgVolume >= 1.5
            ? "Strong"
            : closeVsAvgVolume >= 1
              ? "Normal"
              : "Light",
      note:
        closeVsAvgVolume === null
          ? "Average volume unavailable"
          : `Today at ${(closeVsAvgVolume * 100).toFixed(0)}% of 20-day average volume`,
    },
    {
      label: "Options framing",
      value:
        metrics.premiumScore >= 55
          ? "Long premium"
          : metrics.premiumScore >= 35
            ? "Defined risk"
            : "Careful",
      note: `${metrics.optionsBias} bias with ${formatStructure(metrics.structure)} preference and premium score ${metrics.premiumScore.toFixed(0)}`,
    },
  ];

  const studyAnalysis = [
    {
      title: "Trend alignment",
      text:
        latestEma8 !== null && latestEma21 !== null && latestVwap !== null
          ? `${symbol} is trading ${latestClose >= latestVwap ? "above" : "below"} visible-slice VWAP, with the short trend stack ${latestClose > latestEma8 && latestEma8 > latestEma21 ? "cleanly aligned higher" : latestClose < latestEma8 && latestEma8 < latestEma21 ? "leaning lower" : "still mixed"}. This is the quickest read on whether short-dated calls or puts are working with or against current tape.`
          : "Visible-slice VWAP or EMA stack needs more data before a short-term trend read is reliable.",
    },
    {
      title: "Volatility posture",
      text:
        latestBollingerUpper !== null && latestBollingerLower !== null && bandWidthPercent !== null
          ? `The Bollinger envelope is ${bandWidthPercent.toFixed(2)}% wide around spot. ${latestClose >= latestBollingerUpper ? "Price is pressing the upper band, which supports breakout continuation only if participation holds." : latestClose <= latestBollingerLower ? "Price is pressing the lower band, which favors downside continuation only if support does not reclaim." : "Price is inside the band, which points to consolidation rather than immediate expansion."}`
          : "The volatility envelope is not available yet for this slice.",
    },
    {
      title: "Breakout pressure",
      text:
        latestDonchianUpper !== null && latestDonchianLower !== null
          ? `Price is ${formatPercent(((latestClose - latestDonchianUpper) / latestClose) * 100)} from the 20-bar breakout ceiling and ${formatPercent(((latestClose - latestDonchianLower) / latestClose) * 100)} from the 20-bar floor. This is useful for deciding whether an aggressive weekly contract has enough path to get moving.`
          : "Donchian breakout levels need more bars before they become useful.",
    },
    {
      title: "Momentum confirmation",
      text:
        latestRsi !== null && latestMacd !== null && latestSignal !== null
          ? `RSI is ${latestRsi.toFixed(1)} and MACD is ${latestMacd >= latestSignal ? "above" : "below"} signal. ${latestHistogram !== null && latestHistogram > 0 ? "Momentum is accelerating." : latestHistogram !== null && latestHistogram < 0 ? "Momentum is fading." : "Momentum is flat."} This matters for deciding between a straight long option and a spread.`
          : "Momentum oscillators are still warming up for this visible window.",
    },
  ];

  function toggleOverlay(key: OverlayKey) {
    setOverlays((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function toggleWatchlist(
    contract: ScreenerDetailChartProps["optionContracts"]["suggested"][number],
    lane: "suggested" | "fast_lane",
  ) {
    const entry: ContractWatchlistEntry = {
      ...contract,
      underlyingSymbol: optionContracts.underlyingSymbol,
      lane,
      addedAt: new Date().toISOString(),
    };
    const isNowWatched = toggleContractWatchlist(entry);
    setWatchlistSymbols((current) => {
      const withoutSymbol = current.filter((symbolValue) => symbolValue !== contract.symbol);
      return isNowWatched ? [contract.symbol, ...withoutSymbol] : withoutSymbol;
    });
  }

  function renderContractCards(
    contracts: ScreenerDetailChartProps["optionContracts"]["suggested"],
    lane: "suggested" | "fast_lane",
  ) {
    if (!contracts.length) {
      return (
        <div className={styles.emptyContracts}>
          {lane === "fast_lane"
            ? "No fast-lane contracts cleared the short-dated alignment and tradability filters."
            : "No plausible contracts were found under the current scoring rules. That usually means the chain was too wide, too inactive, too short-dated, or too far from the technical target."}
        </div>
      );
    }

    return (
      <div className={styles.contractGrid}>
        {contracts.map((contract) => {
          const watched = watchlistSymbols.includes(contract.symbol);

          return (
            <article key={`${lane}-${contract.symbol}`} className={styles.contractCard}>
              <div className={styles.contractHeader}>
                <div>
                  <h4>{contract.symbol}</h4>
                  <p>
                    {contract.optionType} | strike {formatPrice(contract.strikePrice)} | exp {contract.expirationDate}
                  </p>
                </div>
                <div className={styles.contractHeaderActions}>
                  <span className={styles.contractScore}>Score {contract.score.toFixed(1)}</span>
                  <button
                    type="button"
                    className={watched ? styles.watchButtonActive : styles.watchButton}
                    onClick={() => toggleWatchlist(contract, lane)}
                    aria-label={`${watched ? "Remove" : "Add"} ${contract.symbol} ${formatLane(lane)} contract ${watched ? "from" : "to"} watchlist`}
                  >
                    {watched ? "★" : "☆"}
                  </button>
                </div>
              </div>

              <div className={styles.contractMetrics}>
                <div><span>Fit</span><strong>{contract.thesisFit}</strong></div>
                <div><span>Structure</span><strong>{formatStructure(contract.structure)}</strong></div>
                <div><span>DTE</span><strong>{contract.daysToExpiration}</strong></div>
                <div><span>Mark</span><strong>{formatPrice(contract.mark)}</strong></div>
                <div><span>Bid / ask</span><strong>{formatPrice(contract.bid)} / {formatPrice(contract.ask)}</strong></div>
                <div><span>Break-even</span><strong>{formatPrice(contract.breakEven)}</strong></div>
                <div><span>Daily volume</span><strong>{contract.dailyVolume}</strong></div>
                <div><span>Spread %</span><strong>{formatPercent(contract.bidAskSpreadPercent)}</strong></div>
              </div>

              <ul className={styles.contractList}>
                {contract.rationale.map((item) => (
                  <li key={`${contract.symbol}-${item}`}>{item}</li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <section className={styles.shell}>
      {showCharts ? (
        <>
          <div className={styles.header}>
            <div>
              <h3>{symbol} chart</h3>
              <p className={styles.subheader}>
                Clean price structure, momentum context, volatility posture, and options framing from the currently visible history slice.
              </p>
            </div>
          </div>

          <div className={styles.detailMetrics}>
            {traderCards.map((card) => (
              <article key={card.label} className={styles.metricCard}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <p>{card.note}</p>
              </article>
            ))}
            <article className={styles.metricCard}>
              <span>Visible range</span>
              <strong>{formatPrice(metrics.low)} to {formatPrice(metrics.high)}</strong>
              <p>{formatPercent(metrics.priceChangePercent)} return with ATR {formatPercent(metrics.atrPercent)}</p>
            </article>
            <article className={styles.metricCard}>
              <span>Liquidity</span>
              <strong>{formatMoney(metrics.avgDollarVolume)}</strong>
              <p>Average dollar volume across the visible slice</p>
            </article>
          </div>

          <div className={styles.controlPanel}>
            <div className={styles.scaleTabs}>
              {TIME_SCALES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScale(value)}
                  className={value === scale ? styles.scaleTabActive : styles.scaleTab}
                >
                  {value === "ALL" ? "All time" : value}
                </button>
              ))}
            </div>

            <div className={styles.controls}>
              {Object.entries(OVERLAY_LABELS).map(([key, label]) => {
                const overlayKey = key as OverlayKey;

                return (
                  <label key={overlayKey} className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={overlays[overlayKey]}
                      onChange={() => toggleOverlay(overlayKey)}
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className={styles.legend}>
            {overlays.close ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#0f172a" }} />close</span> : null}
            {overlays.ema8 ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#059669" }} />ema 8</span> : null}
            {overlays.ema21 ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#16a34a" }} />ema 21</span> : null}
            {overlays.vwap ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#7c3aed" }} />vwap</span> : null}
            {overlays.bollinger ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#93c5fd" }} />bollinger</span> : null}
            {overlays.donchian ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#fb923c" }} />donchian</span> : null}
            {overlays.rsi ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#2563eb" }} />rsi</span> : null}
            {overlays.macd ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#dc2626" }} />macd</span> : null}
          </div>

          <div className={styles.chartStack}>
            <svg viewBox={`0 0 ${width} ${priceFrame.height}`} className={styles.chartFrame} style={{ width: "100%", height: "auto" }}>
              <defs>
                <linearGradient id={`${symbol}-price-fill`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0.01" />
                </linearGradient>
                <linearGradient id={`${symbol}-bollinger-fill`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.04" />
                </linearGradient>
              </defs>

              <rect x="0" y="0" width={width} height={priceFrame.height} fill="#ffffff" rx="18" />

              {priceTicks.map((tick) => (
                <g key={tick}>
                  <line x1={priceFrame.margins.left} x2={width - priceFrame.margins.right} y1={priceY(tick)} y2={priceY(tick)} stroke="#e2e8f0" />
                  <text x={priceFrame.margins.left - 14} y={priceY(tick) + 4} textAnchor="end" fontSize="12" fontWeight="600" fill="#475569">
                    ${formatPriceTick(tick)}
                  </text>
                </g>
              ))}

              {xTicks.map((index, tickIndex) => (
                <g key={index}>
                  <line x1={xScale(index)} x2={xScale(index)} y1={priceFrame.margins.top} y2={priceFrame.height - priceFrame.margins.bottom} stroke="#f1f5f9" />
                  <text
                    x={xScale(index)}
                    y={priceFrame.height - 14}
                    textAnchor={getTickAnchor(tickIndex, xTicks.length)}
                    fontSize="11"
                    fill="#475569"
                    fontWeight="600"
                  >
                    <tspan x={xScale(index)} dy="0">
                      {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).primary}
                    </tspan>
                    {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).secondary ? (
                      <tspan x={xScale(index)} dy="14" fill="#94a3b8">
                        {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).secondary}
                      </tspan>
                    ) : null}
                  </text>
                </g>
              ))}

              <text x={24} y={24} fontSize="13" fontWeight="700" fill="#0f172a">Price</text>

              {overlays.range
                ? referenceLines.slice(0, 2).map((line) => (
                    <line
                      key={line.label}
                      x1={priceFrame.margins.left}
                      x2={width - priceFrame.margins.right}
                      y1={priceY(line.value)}
                      y2={priceY(line.value)}
                      stroke={line.color}
                      strokeDasharray={line.dash}
                      opacity="0.7"
                    />
                  ))
                : null}

              {overlays.expectedMove
                ? referenceLines.slice(2).map((line) => (
                    <line
                      key={line.label}
                      x1={priceFrame.margins.left}
                      x2={width - priceFrame.margins.right}
                      y1={priceY(line.value)}
                      y2={priceY(line.value)}
                      stroke={line.color}
                      strokeDasharray={line.dash}
                      opacity="0.65"
                    />
                  ))
                : null}

              {overlays.fibonacci
                ? fibonacciLevels.map((level) => (
                    <g key={level.label}>
                      <line
                        x1={priceFrame.margins.left}
                        x2={width - priceFrame.margins.right}
                        y1={priceY(level.value)}
                        y2={priceY(level.value)}
                        stroke="#d97706"
                        strokeDasharray="4 4"
                        opacity="0.75"
                      />
                      <text
                        x={width - priceFrame.margins.right + 8}
                        y={priceY(level.value) + 4}
                        textAnchor="start"
                        fontSize="11"
                        fill="#b45309"
                        fontWeight="600"
                      >
                        {level.label}
                      </text>
                    </g>
                  ))
                : null}

              {overlays.bollinger && bollingerAreaPath ? <path d={bollingerAreaPath} fill={`url(#${symbol}-bollinger-fill)`} /> : null}
              {overlays.bollinger ? <path d={bollingerUpperPath} fill="none" stroke="#93c5fd" strokeWidth="1.5" strokeDasharray="5 4" /> : null}
              {overlays.bollinger ? <path d={bollingerMiddlePath} fill="none" stroke="#60a5fa" strokeWidth="1.3" opacity="0.8" /> : null}
              {overlays.bollinger ? <path d={bollingerLowerPath} fill="none" stroke="#93c5fd" strokeWidth="1.5" strokeDasharray="5 4" /> : null}

              {overlays.donchian ? <path d={donchianUpperPath} fill="none" stroke="#f97316" strokeWidth="1.4" strokeDasharray="7 4" /> : null}
              {overlays.donchian ? <path d={donchianLowerPath} fill="none" stroke="#fb923c" strokeWidth="1.4" strokeDasharray="7 4" /> : null}

              {overlays.close ? <path d={closeAreaPath} fill={`url(#${symbol}-price-fill)`} /> : null}
              {overlays.close ? <path d={closePath} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
              {overlays.ema8 ? <path d={ema8Path} fill="none" stroke="#059669" strokeWidth="1.9" strokeLinecap="round" /> : null}
              {overlays.ema21 ? <path d={ema21Path} fill="none" stroke="#16a34a" strokeWidth="1.9" strokeLinecap="round" /> : null}
              {overlays.vwap ? <path d={vwapPath} fill="none" stroke="#7c3aed" strokeWidth="1.9" strokeLinecap="round" /> : null}
              {overlays.sma20 ? <path d={sma20Path} fill="none" stroke="#2563eb" strokeWidth="1.7" strokeLinecap="round" /> : null}
              {overlays.sma50 ? <path d={sma50Path} fill="none" stroke="#0ea5e9" strokeWidth="1.7" strokeLinecap="round" /> : null}
              {overlays.sma200 ? <path d={sma200Path} fill="none" stroke="#111827" strokeWidth="1.7" strokeDasharray="9 5" strokeLinecap="round" /> : null}

              <circle cx={closePoints.at(-1)?.x ?? 0} cy={closePoints.at(-1)?.y ?? 0} r="4.5" fill="#0f172a" />
            </svg>

            {overlays.rsi ? (
              <svg viewBox={`0 0 ${width} ${rsiFrame.height}`} className={styles.chartFrame} style={{ width: "100%", height: "auto" }}>
                <rect x="0" y="0" width={width} height={rsiFrame.height} fill="#ffffff" rx="18" />
                <text x={rsiFrame.margins.left} y={22} fontSize="13" fontWeight="700" fill="#0f172a">RSI 14</text>
                {rsiTicks.map((tick) => (
                  <g key={tick}>
                    <line x1={rsiFrame.margins.left} x2={width - rsiFrame.margins.right} y1={rsiY(tick)} y2={rsiY(tick)} stroke={tick === 50 ? "#cbd5e1" : "#e2e8f0"} strokeDasharray={tick === 50 ? "0" : "6 4"} />
                    <text x={rsiFrame.margins.left - 14} y={rsiY(tick) + 4} textAnchor="end" fontSize="12" fontWeight="600" fill="#475569">
                      {tick}
                    </text>
                  </g>
                ))}
                <path d={rsiPath} fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            ) : null}

            {overlays.macd ? (
              <svg viewBox={`0 0 ${width} ${macdFrame.height}`} className={styles.chartFrame} style={{ width: "100%", height: "auto" }}>
                <rect x="0" y="0" width={width} height={macdFrame.height} fill="#ffffff" rx="18" />
                <text x={macdFrame.margins.left} y={22} fontSize="13" fontWeight="700" fill="#0f172a">MACD</text>
                {macdTicks.map((tick) => (
                  <g key={tick}>
                    <line x1={macdFrame.margins.left} x2={width - macdFrame.margins.right} y1={macdY(tick)} y2={macdY(tick)} stroke="#e2e8f0" />
                    <text x={macdFrame.margins.left - 14} y={macdY(tick) + 4} textAnchor="end" fontSize="12" fontWeight="600" fill="#475569">
                      {tick.toFixed(Math.abs(tick) < 1 ? 2 : 1)}
                    </text>
                  </g>
                ))}
                {slice.macd.histogram.map((point, index) => {
                  if (point.value === null) {
                    return null;
                  }

                  const zeroY = macdY(0);
                  const y = macdY(point.value);
                  return (
                    <rect
                      key={`${point.timestamp}-hist`}
                      x={xScale(index) - 3}
                      y={Math.min(y, zeroY)}
                      width={6}
                      height={Math.max(Math.abs(y - zeroY), 1)}
                      fill={point.value >= 0 ? "#22c55e" : "#ef4444"}
                      opacity="0.75"
                    />
                  );
                })}
                <path d={macdPath} fill="none" stroke="#111827" strokeWidth="2.1" strokeLinecap="round" />
                <path d={signalPath} fill="none" stroke="#dc2626" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : null}

            {overlays.volume ? (
              <svg viewBox={`0 0 ${width} ${volumeFrame.height}`} className={styles.chartFrame} style={{ width: "100%", height: "auto" }}>
                <rect x="0" y="0" width={width} height={volumeFrame.height} fill="#ffffff" rx="18" />
                <text x={volumeFrame.margins.left} y={22} fontSize="13" fontWeight="700" fill="#0f172a">Volume</text>
                {volumeTicks.map((tick) => (
                  <g key={tick}>
                    <line x1={volumeFrame.margins.left} x2={width - volumeFrame.margins.right} y1={volumeY(tick)} y2={volumeY(tick)} stroke="#f1f5f9" />
                    <text x={volumeFrame.margins.left - 14} y={volumeY(tick) + 4} textAnchor="end" fontSize="12" fontWeight="600" fill="#475569">
                      {formatVolumeTick(tick)}
                    </text>
                  </g>
                ))}

                {volumeBars.map((bar) => (
                  <rect
                    key={`${bar.x}-${bar.y}`}
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                    fill={bar.isDown ? "#f97316" : "#94a3b8"}
                    opacity="0.9"
                    rx="2"
                  />
                ))}

                {overlays.volumeAverage ? <path d={avgVolumePath} fill="none" stroke="#7c3aed" strokeWidth="1.9" strokeLinecap="round" /> : null}

                {xTicks.map((index, tickIndex) => (
                  <text
                    key={index}
                    x={xScale(index)}
                    y={volumeFrame.height - 18}
                    textAnchor={getTickAnchor(tickIndex, xTicks.length)}
                    fontSize="11"
                    fill="#475569"
                    fontWeight="600"
                  >
                    <tspan x={xScale(index)} dy="0">
                      {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).primary}
                    </tspan>
                    {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).secondary ? (
                      <tspan x={xScale(index)} dy="14" fill="#94a3b8">
                        {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).secondary}
                      </tspan>
                    ) : null}
                  </text>
                ))}
              </svg>
            ) : null}
          </div>

          <div className={styles.studyAnalysisGrid}>
            {studyAnalysis.map((item) => (
              <article key={item.title} className={styles.studyCard}>
                <span>{item.title}</span>
                <p>{item.text}</p>
              </article>
            ))}
          </div>

          <p className={styles.analysis}>
            Fibonacci analysis for the visible {scale === "ALL" ? "full-history" : scale.toLowerCase()} slice:
            {" "}
            {nearestFibLevel
              ? `${symbol} is trading near the ${nearestFibLevel.label} retracement at ${formatPrice(nearestFibLevel.value)}. Current price is ${formatPercent(fibDistancePercent)} from that level, which reads as ${fibBias} within the visible range.`
              : "the visible range is too narrow to produce usable retracement levels."}
          </p>
        </>
      ) : (
        <div className={styles.graphHidden}>
          Graphs are hidden for this entry. Enable them from the row toggle or the global screener control.
        </div>
      )}

      <section className={styles.contractSection}>
        <div className={styles.insightHeader}>
          <h3>Suggested option contracts</h3>
          <p>
            Ranked from the live Alpaca chain using setup alignment, break-even plausibility, days to expiration,
            spread quality, and activity. {optionContracts.count ? `${optionContracts.count} contracts were scanned.` : "No contracts were returned from the chain feed."}
          </p>
        </div>
        {renderContractCards(optionContracts.suggested, "suggested")}
      </section>

      <section className={styles.contractSection}>
        <div className={styles.insightHeader}>
          <h3>Fast lane contracts</h3>
          <p>
            Short-dated contracts ranked for immediate setups, including same-day and end-of-week expirations when
            the directional alignment, timing window, and quote quality are strong enough.
          </p>
        </div>
        {renderContractCards(optionContracts.fastLane, "fast_lane")}
      </section>

      <section className={styles.insightSection}>
        <div className={styles.insightHeader}>
          <h3>{symbol} setup analysis</h3>
          <p>Relative performance, setup quality, timing, and options-oriented reads derived from the current historical slice and long-horizon feature set.</p>
        </div>
        <div className={styles.insightGrid}>
          {insights.map((insight) => (
            <article key={insight.key} className={styles.insightCard}>
              <div className={styles.insightCardHeader}>
                <h4>{insight.title}</h4>
                <span
                  className={
                    insight.status === "available"
                      ? styles.statusAvailable
                      : insight.status === "needs_options_data"
                        ? styles.statusNeedsOptions
                        : styles.statusNeedsEvent
                  }
                >
                  {formatInsightStatus(insight.status)}
                </span>
              </div>
              <p className={styles.insightSummary}>{insight.summary}</p>
              <ul className={styles.insightList}>
                {insight.bullets.map((bullet) => (
                  <li key={`${insight.key}-${bullet}`}>{bullet}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
