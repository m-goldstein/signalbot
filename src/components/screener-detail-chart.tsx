"use client";

import { useMemo, useState } from "react";
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
  bars: ChartPoint[];
  sma20: OverlayPoint[];
  sma50: OverlayPoint[];
  sma200: OverlayPoint[];
};

type TimeScale = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "ALL";
type OverlayKey =
  | "close"
  | "sma20"
  | "sma50"
  | "sma200"
  | "range"
  | "expectedMove"
  | "fibonacci"
  | "volume";

const TIME_SCALES: TimeScale[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y", "ALL"];
const DEFAULT_OVERLAYS: Record<OverlayKey, boolean> = {
  close: true,
  sma20: true,
  sma50: true,
  sma200: true,
  range: true,
  expectedMove: true,
  fibonacci: false,
  volume: true,
};
const OVERLAY_LABELS: Record<OverlayKey, string> = {
  close: "Close",
  sma20: "SMA 20",
  sma50: "SMA 50",
  sma200: "SMA 200",
  range: "Visible range",
  expectedMove: "Expected move",
  fibonacci: "Fibonacci",
  volume: "Volume",
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

export function ScreenerDetailChart({
  symbol,
  bars,
  sma20,
  sma50,
  sma200,
}: ScreenerDetailChartProps) {
  const [scale, setScale] = useState<TimeScale>("1Y");
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>(DEFAULT_OVERLAYS);

  const slice = useMemo(() => {
    const visibleBars = barsForScale(scale, bars);
    return {
      bars: visibleBars,
      sma20: overlaysForScale(visibleBars, sma20),
      sma50: overlaysForScale(visibleBars, sma50),
      sma200: overlaysForScale(visibleBars, sma200),
      metrics: computeSliceMetrics(visibleBars),
    };
  }, [bars, scale, sma20, sma50, sma200]);

  const metrics = slice.metrics;

  if (!metrics || !slice.bars.length) {
    return null;
  }

  const width = 1100;
  const priceFrame = {
    width,
    height: 392,
    margins: { top: 28, right: 24, bottom: 78, left: 88 },
  };
  const volumeFrame = {
    width,
    height: 150,
    margins: { top: 18, right: 24, bottom: 76, left: 88 },
  };

  const allValues = [
    ...slice.bars.flatMap((bar) => [bar.high, bar.low]),
    metrics.high,
    metrics.low,
    metrics.expectedMove5Upper,
    metrics.expectedMove5Lower,
    metrics.expectedMove10Upper,
    metrics.expectedMove10Lower,
  ];
  const priceDomain = createPriceDomain(allValues, 0.06);
  const xScale = createXScale(slice.bars.length, priceFrame);
  const priceY = createYScale(priceDomain.min, priceDomain.max, priceFrame);
  const volumeMax = Math.max(...slice.bars.map((bar) => bar.volume), 1);
  const volumeY = createYScale(0, volumeMax, volumeFrame);
  const priceTicks = createTicks(priceDomain.min, priceDomain.max, 6);
  const volumeTicks = createTicks(0, volumeMax, 3);
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

  function overlayPath(points: OverlayPoint[]) {
    return buildLinePath(
      points.map((point, index) =>
        point.value === null ? null : { x: xScale(index), y: priceY(point.value) },
      ),
    );
  }

  const sma20Path = overlayPath(slice.sma20);
  const sma50Path = overlayPath(slice.sma50);
  const sma200Path = overlayPath(slice.sma200);

  const volumeBars = slice.bars.map((bar, index) => {
    const x = xScale(index);
    const y = volumeY(bar.volume);
    const baseline = volumeFrame.height - volumeFrame.margins.bottom;
    return {
      x: x - Math.max(1, 1.5 * (252 / Math.max(slice.bars.length, 1))),
      y,
      width: Math.max(2, 4 * (252 / Math.max(slice.bars.length, 1))),
      height: Math.max(1, baseline - y),
      isDown: index > 0 ? bar.close < slice.bars[index - 1].close : false,
    };
  });

  const referenceLines = [
    { label: "slice high", value: metrics.high, color: "#b91c1c", dash: "6 4" },
    { label: "slice low", value: metrics.low, color: "#b91c1c", dash: "6 4" },
    { label: "5d upper", value: metrics.expectedMove5Upper, color: "#6b7280", dash: "2 3" },
    { label: "5d lower", value: metrics.expectedMove5Lower, color: "#6b7280", dash: "2 3" },
    { label: "10d upper", value: metrics.expectedMove10Upper, color: "#9ca3af", dash: "2 6" },
    { label: "10d lower", value: metrics.expectedMove10Lower, color: "#9ca3af", dash: "2 6" },
  ];

  function toggleOverlay(key: OverlayKey) {
    setOverlays((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <section className={styles.shell}>
      <div className={styles.header}>
        <h3>{symbol} chart</h3>
      </div>

      <div className={styles.detailMetrics}>
        <article><span>Close</span><strong>{metrics.latestClose.toFixed(2)}</strong></article>
        <article><span>Slice return</span><strong>{formatPercent(metrics.priceChangePercent)}</strong></article>
        <article><span>Slice high</span><strong>{metrics.high.toFixed(2)}</strong></article>
        <article><span>Slice low</span><strong>{metrics.low.toFixed(2)}</strong></article>
        <article><span>ATR %</span><strong>{formatPercent(metrics.atrPercent)}</strong></article>
        <article><span>Realized vol</span><strong>{formatPercent(metrics.realizedVol)}</strong></article>
        <article><span>Avg dollar vol</span><strong>{formatMoney(metrics.avgDollarVolume)}</strong></article>
        <article><span>Options bias</span><strong>{metrics.optionsBias}</strong></article>
        <article><span>Structure</span><strong>{metrics.structure}</strong></article>
        <article><span>Nearest fib</span><strong>{nearestFibLevel ? `${nearestFibLevel.label} (${formatPrice(nearestFibLevel.value)})` : "-"}</strong></article>
        <article><span>Fib distance</span><strong>{nearestFibLevel ? formatPercent(fibDistancePercent) : "-"}</strong></article>
        <article><span>Fib context</span><strong>{fibBias}</strong></article>
      </div>

      <div className={styles.legend}>
        {overlays.close ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#111827" }} />close</span> : null}
        {overlays.sma20 ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#2563eb" }} />sma20</span> : null}
        {overlays.sma50 ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#7c3aed" }} />sma50</span> : null}
        {overlays.sma200 ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#059669" }} />sma200</span> : null}
        {overlays.range ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#b91c1c" }} />visible range</span> : null}
        {overlays.expectedMove ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#9ca3af" }} />expected move</span> : null}
        {overlays.fibonacci ? <span className={styles.legendItem}><span className={styles.legendSwatch} style={{ background: "#d97706" }} />fibonacci</span> : null}
      </div>

      <p className={styles.analysis}>
        Fibonacci analysis for the visible {scale === "ALL" ? "full-history" : scale.toLowerCase()} slice:
        {" "}
        {nearestFibLevel
          ? `${symbol} is trading near the ${nearestFibLevel.label} retracement at ${formatPrice(nearestFibLevel.value)}. Current price is ${formatPercent(fibDistancePercent)} from that level, which reads as ${fibBias} within the visible range.`
          : "the visible range is too narrow to produce usable retracement levels."}
      </p>

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

      <svg viewBox={`0 0 ${width} ${priceFrame.height}`} className={styles.chartFrame} style={{ width: "100%", height: "auto" }}>
        {priceTicks.map((tick) => (
          <g key={tick}>
            <line x1={priceFrame.margins.left} x2={width - priceFrame.margins.right} y1={priceY(tick)} y2={priceY(tick)} stroke="#e5e7eb" />
            <text x={priceFrame.margins.left - 12} y={priceY(tick) + 4} textAnchor="end" fontSize="12" fontWeight="500" fill="#374151">
              ${formatPriceTick(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((index) => (
          <g key={index}>
            <line x1={xScale(index)} x2={xScale(index)} y1={priceFrame.margins.top} y2={priceFrame.height - priceFrame.margins.bottom} stroke="#f3f4f6" />
            <text
              x={xScale(index)}
              y={priceFrame.height - 50}
              textAnchor={getTickAnchor(index, slice.bars.length)}
              fontSize="11"
              fill="#374151"
            >
              <tspan x={xScale(index)} dy="0">
                {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).primary}
              </tspan>
              {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).secondary ? (
                <tspan x={xScale(index)} dy="15" fill="#6b7280">
                  {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).secondary}
                </tspan>
              ) : null}
            </text>
          </g>
        ))}
        <line x1={priceFrame.margins.left} x2={priceFrame.margins.left} y1={priceFrame.margins.top} y2={priceFrame.height - priceFrame.margins.bottom} stroke="#9ca3af" />
        <line x1={priceFrame.margins.left} x2={width - priceFrame.margins.right} y1={priceFrame.height - priceFrame.margins.bottom} y2={priceFrame.height - priceFrame.margins.bottom} stroke="#9ca3af" />
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
                  opacity="0.85"
                />
                <text
                  x={width - priceFrame.margins.right - 4}
                  y={priceY(level.value) - 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="#b45309"
                >
                  {level.label}
                </text>
              </g>
            ))
          : null}
        {overlays.close ? <path d={closeAreaPath} fill="rgba(17, 24, 39, 0.08)" /> : null}
        {overlays.close ? <path d={closePath} fill="none" stroke="#111827" strokeWidth="2.2" /> : null}
        {overlays.sma20 ? <path d={sma20Path} fill="none" stroke="#2563eb" strokeWidth="1.8" /> : null}
        {overlays.sma50 ? <path d={sma50Path} fill="none" stroke="#7c3aed" strokeWidth="1.8" /> : null}
        {overlays.sma200 ? <path d={sma200Path} fill="none" stroke="#059669" strokeWidth="1.8" /> : null}
        <text x={12} y={18} fontSize="12" fontWeight="600" fill="#374151">Price</text>
      </svg>

      {overlays.volume ? (
        <svg viewBox={`0 0 ${width} ${volumeFrame.height}`} className={styles.chartFrame} style={{ width: "100%", height: "auto" }}>
          {volumeTicks.map((tick) => (
            <g key={tick}>
              <line x1={volumeFrame.margins.left} x2={width - volumeFrame.margins.right} y1={volumeY(tick)} y2={volumeY(tick)} stroke="#f3f4f6" />
              <text x={volumeFrame.margins.left - 12} y={volumeY(tick) + 4} textAnchor="end" fontSize="12" fontWeight="500" fill="#374151">
                {formatVolumeTick(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((index) => (
            <text
              key={index}
              x={xScale(index)}
              y={volumeFrame.height - 50}
              textAnchor={getTickAnchor(index, slice.bars.length)}
              fontSize="11"
              fill="#374151"
            >
              <tspan x={xScale(index)} dy="0">
                {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).primary}
              </tspan>
              {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).secondary ? (
                <tspan x={xScale(index)} dy="15" fill="#6b7280">
                  {formatAxisDateLabel(slice.bars[index]?.timestamp ?? "", timeSpanDays).secondary}
                </tspan>
              ) : null}
            </text>
          ))}
          <line x1={volumeFrame.margins.left} x2={volumeFrame.margins.left} y1={volumeFrame.margins.top} y2={volumeFrame.height - volumeFrame.margins.bottom} stroke="#9ca3af" />
          <line x1={volumeFrame.margins.left} x2={width - volumeFrame.margins.right} y1={volumeFrame.height - volumeFrame.margins.bottom} y2={volumeFrame.height - volumeFrame.margins.bottom} stroke="#9ca3af" />
          {volumeBars.map((bar) => (
            <rect
              key={`${bar.x}-${bar.y}`}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              fill={bar.isDown ? "#ef4444" : "#94a3b8"}
              opacity="0.8"
            />
          ))}
          <text x={12} y={18} fontSize="12" fontWeight="600" fill="#374151">Volume</text>
          <text x={width / 2} y={volumeFrame.height - 16} fontSize="12" fontWeight="600" textAnchor="middle" fill="#374151">
            Date
          </text>
        </svg>
      ) : null}
    </section>
  );
}
