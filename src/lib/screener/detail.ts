import { computeFeatureSnapshot } from "@/lib/features/engine";
import { FeatureSnapshot } from "@/lib/features/types";
import { createMarketDataProvider } from "@/lib/market-data";
import { OptionContractSnapshot, PriceBar } from "@/lib/market-data/types";
import { getTickerMetadata } from "@/lib/universe/service";

const LOOKBACK_DAYS = 3650;
const BAR_LIMIT = 5000;

type DetailBar = {
  timestamp: string;
  close: number;
  high: number;
  low: number;
  volume: number;
};

type DetailInsight = {
  key: string;
  title: string;
  status: "available" | "needs_options_data" | "needs_event_data";
  summary: string;
  bullets: string[];
};

type SuggestedOptionContract = {
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
};

type RankedOptionBuckets = {
  suggested: SuggestedOptionContract[];
  fastLane: SuggestedOptionContract[];
};

function getHistoryStart() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - LOOKBACK_DAYS);
  return date.toISOString();
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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

function computeReturnPercent(bars: PriceBar[], length: number) {
  if (bars.length <= length) {
    return 0;
  }

  const latest = bars.at(-1)?.close ?? 0;
  const previous = bars.at(-(length + 1))?.close ?? 0;

  if (previous === 0) {
    return 0;
  }

  return ((latest - previous) / previous) * 100;
}

function alignBars(left: PriceBar[], right: PriceBar[]) {
  const rightMap = new Map(right.map((bar) => [bar.timestamp.slice(0, 10), bar]));
  return left
    .map((bar, index) => {
      if (index === 0) {
        return null;
      }

      const aligned = rightMap.get(bar.timestamp.slice(0, 10));
      const previousLeft = left[index - 1];
      const previousRight = aligned
        ? rightMap.get(previousLeft.timestamp.slice(0, 10))
        : null;

      if (!aligned || !previousRight || previousLeft.close === 0 || previousRight.close === 0) {
        return null;
      }

      return {
        leftReturn: (bar.close - previousLeft.close) / previousLeft.close,
        rightReturn: (aligned.close - previousRight.close) / previousRight.close,
      };
    })
    .filter((entry): entry is { leftReturn: number; rightReturn: number } => Boolean(entry));
}

function computeRelativeRead(symbolBars: PriceBar[], benchmarkBars: PriceBar[]) {
  const aligned = alignBars(symbolBars.slice(-126), benchmarkBars.slice(-126));
  const upDays = aligned.filter((entry) => entry.rightReturn > 0);
  const downDays = aligned.filter((entry) => entry.rightReturn < 0);

  const upCapture = average(
    upDays.map((entry) => (entry.rightReturn === 0 ? 0 : entry.leftReturn - entry.rightReturn)),
  );
  const downCapture = average(
    downDays.map((entry) => (entry.rightReturn === 0 ? 0 : entry.leftReturn - entry.rightReturn)),
  );

  return {
    oneMonthSpread: computeReturnPercent(symbolBars, 21) - computeReturnPercent(benchmarkBars, 21),
    threeMonthSpread: computeReturnPercent(symbolBars, 63) - computeReturnPercent(benchmarkBars, 63),
    sixMonthSpread: computeReturnPercent(symbolBars, 126) - computeReturnPercent(benchmarkBars, 126),
    upCaptureSpread: upCapture * 100,
    downCaptureSpread: downCapture * 100,
  };
}

function computeWeeklyBars(bars: PriceBar[]) {
  const weeks = new Map<string, PriceBar>();

  for (const bar of bars) {
    const date = new Date(bar.timestamp);
    const weekKey = `${date.getUTCFullYear()}-${Math.ceil((date.getUTCDate() + 6 - date.getUTCDay()) / 7)}`;
    const existing = weeks.get(weekKey);

    if (!existing) {
      weeks.set(weekKey, { ...bar });
      continue;
    }

    existing.high = Math.max(existing.high, bar.high);
    existing.low = Math.min(existing.low, bar.low);
    existing.close = bar.close;
    existing.volume += bar.volume;
  }

  return [...weeks.values()];
}

function computeExpectedMovePercent(snapshot: FeatureSnapshot) {
  return snapshot.expectedMove10DayPercent;
}

function classifyRegime(snapshot: FeatureSnapshot) {
  if (
    snapshot.smaStackAligned &&
    snapshot.oneMonthChangePercent > 0 &&
    snapshot.threeMonthChangePercent > 0 &&
    snapshot.breakoutState === "breakout"
  ) {
    return "trend continuation";
  }

  if (
    Math.abs(snapshot.distanceFrom20Sma) < 2.5 &&
    snapshot.breakoutState === "inside-range" &&
    snapshot.realizedVol20 < snapshot.realizedVol60
  ) {
    return "range mean reversion";
  }

  return "volatility expansion";
}

function nearestResistance(snapshot: FeatureSnapshot) {
  return snapshot.close * (1 + Math.max(0.01, Math.abs(snapshot.distanceFrom52WeekHigh) / 100));
}

function nearestSupport(snapshot: FeatureSnapshot) {
  return snapshot.close * (1 - Math.max(0.01, Math.abs(snapshot.distanceFrom52WeekLow) / 100));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function targetPriceForBias(snapshot: FeatureSnapshot, bias: "call" | "put") {
  return bias === "call" ? nearestResistance(snapshot) : nearestSupport(snapshot);
}

function daysToTarget(snapshot: FeatureSnapshot, bias: "call" | "put") {
  const atrDollars = snapshot.close * (snapshot.atrPercent / 100);
  const target = targetPriceForBias(snapshot, bias);
  return atrDollars === 0 ? 0 : Math.abs(target - snapshot.close) / atrDollars;
}

function contractBreakEven(contract: OptionContractSnapshot) {
  return contract.optionType === "call"
    ? contract.strikePrice + contract.mark
    : contract.strikePrice - contract.mark;
}

function structureForContract(
  snapshot: FeatureSnapshot,
  contract: OptionContractSnapshot,
): SuggestedOptionContract["structure"] {
  if (contract.optionType === "call") {
    return snapshot.premiumBuyingScore >= 60 ? "long_call" : "call_spread";
  }

  return snapshot.premiumBuyingScore >= 60 ? "long_put" : "put_spread";
}

function scoreOptionContract(
  contract: OptionContractSnapshot,
  snapshot: FeatureSnapshot,
): SuggestedOptionContract | null {
  if (contract.daysToExpiration < 7 || contract.daysToExpiration > 90) {
    return null;
  }

  if (contract.mark < 0.1 || contract.ask <= 0) {
    return null;
  }

  if (contract.bidAskSpreadPercent > 80) {
    return null;
  }

  const expectedBias =
    snapshot.optionsDirectionalBias === "neutral" ? contract.optionType : snapshot.optionsDirectionalBias;
  const thesisFit =
    contract.optionType === expectedBias
      ? "aligned"
      : snapshot.optionsDirectionalBias === "neutral"
        ? "watch"
        : "countertrend";
  const target = targetPriceForBias(snapshot, contract.optionType);
  const targetDistancePercent =
    snapshot.close === 0 ? 0 : (Math.abs(target - snapshot.close) / snapshot.close) * 100;
  const breakEven = contractBreakEven(contract);
  const breakEvenDistancePercent =
    snapshot.close === 0 ? 0 : (Math.abs(breakEven - snapshot.close) / snapshot.close) * 100;
  const timeNeed = Math.max(7, Math.ceil(daysToTarget(snapshot, contract.optionType) + 5));
  const dteScore = 24 - Math.min(Math.abs(contract.daysToExpiration - timeNeed), 24);
  const spreadScore = 25 - Math.min(contract.bidAskSpreadPercent / 2, 25);
  const volumeScore = Math.min(20, Math.log10(contract.dailyVolume + 1) * 7);
  const moneynessPercent =
    snapshot.close === 0 ? 0 : ((contract.strikePrice - snapshot.close) / snapshot.close) * 100;
  const moneynessScore =
    contract.optionType === "call"
      ? 18 - Math.min(Math.abs(moneynessPercent - 1.5), 18)
      : 18 - Math.min(Math.abs(moneynessPercent + 1.5), 18);
  const breakEvenFitsTarget =
    contract.optionType === "call" ? target >= breakEven : target <= breakEven;
  const breakEvenScore = breakEvenFitsTarget ? 20 : Math.max(0, 14 - Math.abs(targetDistancePercent - breakEvenDistancePercent) * 2);
  const premiumAsPercentOfSpot = snapshot.close === 0 ? 0 : (contract.mark / snapshot.close) * 100;
  const premiumScore = 12 - Math.min(Math.abs(premiumAsPercentOfSpot - 2.5) * 2, 12);
  const alignmentScore =
    thesisFit === "aligned" ? 24 : thesisFit === "watch" ? 8 : -30;
  const totalScore = round(
    clamp(
      alignmentScore + dteScore + spreadScore + volumeScore + moneynessScore + breakEvenScore + premiumScore,
      0,
      100,
    ),
    1,
  );
  const rationale = [
    `${contract.optionType === "call" ? "Call" : "Put"} is ${thesisFit} with the current setup bias.`,
    `${contract.daysToExpiration} DTE versus an ATR-based time need of about ${timeNeed} days.`,
    `Break-even ${round(breakEven)} versus technical target ${round(target)}.`,
    `Spread ${round(contract.bidAskSpreadPercent, 1)}% with daily volume ${contract.dailyVolume}.`,
  ];

  return {
    symbol: contract.symbol,
    optionType: contract.optionType,
    expirationDate: contract.expirationDate,
    daysToExpiration: contract.daysToExpiration,
    strikePrice: round(contract.strikePrice),
    bid: round(contract.bid),
    ask: round(contract.ask),
    mark: round(contract.mark),
    breakEven: round(breakEven),
    dailyVolume: contract.dailyVolume,
    bidAskSpreadPercent: round(contract.bidAskSpreadPercent, 1),
    score: totalScore,
    thesisFit,
    structure: structureForContract(snapshot, contract),
    rationale,
  };
}

function buildSuggestedContracts(
  contracts: OptionContractSnapshot[],
  snapshot: FeatureSnapshot,
): RankedOptionBuckets {
  const scored = contracts
    .map((contract) => scoreOptionContract(contract, snapshot))
    .filter((value): value is SuggestedOptionContract => Boolean(value))
    .sort((left, right) => right.score - left.score);

  const aligned = scored.filter((contract) => contract.thesisFit === "aligned").slice(0, 5);
  const fastLane = scored
    .filter((contract) => {
      if (contract.thesisFit !== "aligned") {
        return false;
      }

      if (contract.daysToExpiration > 7) {
        return false;
      }

      if (contract.bidAskSpreadPercent > 45) {
        return false;
      }

      return contract.dailyVolume >= 10 || contract.daysToExpiration <= 1;
    })
    .map((contract) => {
      const urgencyBonus =
        contract.daysToExpiration === 0 ? 12 : contract.daysToExpiration <= 2 ? 8 : 4;
      const liquidityBonus = Math.min(10, Math.log10(contract.dailyVolume + 1) * 4);

      return {
        ...contract,
        score: round(clamp(contract.score + urgencyBonus + liquidityBonus, 0, 100), 1),
        rationale: [
          "Short-dated contract classified as fast lane because the setup is aligned and the expiration window is immediate.",
          ...contract.rationale,
        ],
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  if (aligned.length >= 4) {
    return {
      suggested: aligned,
      fastLane,
    };
  }

  const watched = scored.filter((contract) => contract.thesisFit !== "countertrend").slice(0, 5);
  return {
    suggested: watched,
    fastLane,
  };
}

function buildInsights(input: {
  symbol: string;
  snapshot: FeatureSnapshot;
  bars: PriceBar[];
  benchmarkSnapshots: Array<{ symbol: string; read: ReturnType<typeof computeRelativeRead> }>;
  relevantSectorSymbol: string | null;
}) {
  const { symbol, snapshot, bars, benchmarkSnapshots, relevantSectorSymbol } = input;
  const dailyAtrDollars = snapshot.close * (snapshot.atrPercent / 100);
  const weeklyBars = computeWeeklyBars(bars);
  const weeklyReturn = computeReturnPercent(weeklyBars, 8);
  const regime = classifyRegime(snapshot);
  const bullish = snapshot.optionsDirectionalBias === "call";
  const target = bullish ? nearestResistance(snapshot) : nearestSupport(snapshot);
  const stop = bullish ? snapshot.close * 0.97 : snapshot.close * 1.03;
  const targetDistancePercent =
    snapshot.close === 0 ? 0 : (Math.abs(target - snapshot.close) / snapshot.close) * 100;
  const stopDistancePercent =
    snapshot.close === 0 ? 0 : (Math.abs(stop - snapshot.close) / snapshot.close) * 100;
  const daysToTarget = dailyAtrDollars === 0 ? 0 : Math.abs(target - snapshot.close) / dailyAtrDollars;
  const daysToTwoAtr = dailyAtrDollars === 0 ? 0 : (2 * dailyAtrDollars) / dailyAtrDollars;
  const expectedMove10 = computeExpectedMovePercent(snapshot);
  const relevantSector = benchmarkSnapshots.find((entry) => entry.symbol === relevantSectorSymbol) ?? null;
  const spyRead = benchmarkSnapshots.find((entry) => entry.symbol === "SPY")?.read ?? null;
  const qqqRead = benchmarkSnapshots.find((entry) => entry.symbol === "QQQ")?.read ?? null;

  const insights: DetailInsight[] = [
    {
      key: "relative-strength",
      title: "Relative strength and weakness",
      status: "available",
      summary: `${symbol} is being measured against SPY, QQQ${relevantSector ? `, and ${relevantSector.symbol}` : ""} to determine whether it is actually leading or lagging its benchmarks.`,
      bullets: [
        spyRead
          ? `Vs SPY: 1M ${spyRead.oneMonthSpread >= 0 ? "+" : ""}${spyRead.oneMonthSpread.toFixed(2)}%, 3M ${spyRead.threeMonthSpread >= 0 ? "+" : ""}${spyRead.threeMonthSpread.toFixed(2)}%, 6M ${spyRead.sixMonthSpread >= 0 ? "+" : ""}${spyRead.sixMonthSpread.toFixed(2)}%.`
          : "SPY comparison is unavailable.",
        qqqRead
          ? `Vs QQQ: 1M ${qqqRead.oneMonthSpread >= 0 ? "+" : ""}${qqqRead.oneMonthSpread.toFixed(2)}%, up-day outperformance ${qqqRead.upCaptureSpread >= 0 ? "+" : ""}${qqqRead.upCaptureSpread.toFixed(2)}%, down-day resilience ${qqqRead.downCaptureSpread >= 0 ? "+" : ""}${qqqRead.downCaptureSpread.toFixed(2)}%.`
          : "QQQ comparison is unavailable.",
        relevantSector
          ? `Vs ${relevantSector.symbol}: 1M ${relevantSector.read.oneMonthSpread >= 0 ? "+" : ""}${relevantSector.read.oneMonthSpread.toFixed(2)}%, 3M ${relevantSector.read.threeMonthSpread >= 0 ? "+" : ""}${relevantSector.read.threeMonthSpread.toFixed(2)}%.`
          : "No sector ETF comparison was available for this symbol.",
      ],
    },
    {
      key: "event-aware",
      title: "Event-aware setup ranking",
      status: "needs_event_data",
      summary: "Event-aware ranking needs an earnings calendar, major company catalysts, and macro/Fed schedule data. Those feeds are not in this app yet.",
      bullets: [
        "Needed inputs: earnings date, product events, major macro releases, and FOMC schedule.",
        "Without event timing, premium can look cheap while still being exposed to headline or implied-volatility risk.",
      ],
    },
    {
      key: "term-structure",
      title: "Term structure and IV rank",
      status: "needs_options_data",
      summary: "Option-chain implied volatility and term structure are not currently ingested, so this module cannot yet compare near-dated IV to back-month IV or calculate IV rank.",
      bullets: [
        `Realized volatility context is available: RV20 ${snapshot.realizedVol20.toFixed(2)}% vs RV60 ${snapshot.realizedVol60.toFixed(2)}%.`,
        "Needed inputs: IV rank/percentile, IV by expiration, and realized-versus-implied spread.",
      ],
    },
    {
      key: "expected-move-vs-target",
      title: "Expected move versus target distance",
      status: "available",
      summary: "This compares the current 10-day expected move proxy to the distance between spot and the nearest technical target.",
      bullets: [
        `10-day expected move proxy: ${expectedMove10.toFixed(2)}%.`,
        `Nearest ${bullish ? "upside" : "downside"} target distance: ${targetDistancePercent.toFixed(2)}%.`,
        targetDistancePercent <= expectedMove10
          ? "The target sits inside the expected move envelope, which usually argues for more selective structure choice."
          : "The target sits beyond the current expected move envelope, which requires a stronger directional thesis or more time.",
      ],
    },
    {
      key: "chain-liquidity",
      title: "Chain liquidity quality filters",
      status: "needs_options_data",
      summary: "Option-chain liquidity checks cannot be performed yet because open interest, options volume, and bid/ask widths are not in the current data model.",
      bullets: [
        "Needed inputs: OI by strike, contract volume, and bid/ask spreads.",
        "This should gate tradeability before any contract is considered actionable.",
      ],
    },
    {
      key: "regime",
      title: "Regime classification",
      status: "available",
      summary: `The current daily setup is classified as ${regime}.`,
      bullets: [
        `Daily trend stack is ${snapshot.smaStackAligned ? "aligned" : "mixed"} with breakout state ${snapshot.breakoutState}.`,
        `1M ${snapshot.oneMonthChangePercent >= 0 ? "+" : ""}${snapshot.oneMonthChangePercent.toFixed(2)}%, 3M ${snapshot.threeMonthChangePercent >= 0 ? "+" : ""}${snapshot.threeMonthChangePercent.toFixed(2)}%, ATR ${snapshot.atrPercent.toFixed(2)}%.`,
      ],
    },
    {
      key: "spot-to-strike",
      title: "Spot-to-strike path analysis",
      status: "available",
      summary: "This estimates what directional movement is realistically available before expiration using ATR and recent persistence.",
      bullets: [
        `Bias is ${snapshot.optionsDirectionalBias}; preferred structure is ${snapshot.optionsStructureBias}.`,
        `A ${bullish ? "call" : "put"} thesis would need roughly ${targetDistancePercent.toFixed(2)}% movement to reach the nearest technical target.`,
        `At current ATR, that move implies about ${daysToTarget.toFixed(1)} trading days of travel if momentum remains intact.`,
      ],
    },
    {
      key: "time-to-target",
      title: "Time-to-target scoring",
      status: "available",
      summary: "This compares ATR-based travel time to common swing windows so trades are not structured with too little time.",
      bullets: [
        `Estimated trading days to target: ${daysToTarget.toFixed(1)}.`,
        `One ATR move is roughly 1 trading day; two ATR moves are roughly ${daysToTwoAtr.toFixed(1)} trading days.`,
        daysToTarget > 10
          ? "The target likely needs more than a short-dated swing window."
          : "The target is reachable within a typical short swing window if trend quality holds.",
      ],
    },
    {
      key: "volume-quality",
      title: "Volume and participation quality",
      status: "available",
      summary: "This checks whether the move is supported by enough participation to trust the setup.",
      bullets: [
        `Volume vs 20-day average: ${snapshot.volumeVs20DayAverage.toFixed(2)}x.`,
        `20-day average dollar volume: $${(snapshot.averageDollarVolume20 / 1_000_000).toFixed(2)}M.`,
        `Close location in day range: ${snapshot.closeLocationPercent.toFixed(2)}%.`,
      ],
    },
    {
      key: "multi-timeframe",
      title: "Multi-timeframe alignment",
      status: "available",
      summary: "Daily and weekly context are compared to see whether the swing is aligned or fighting a higher timeframe.",
      bullets: [
        `Daily trend stack is ${snapshot.smaStackAligned ? "aligned" : "mixed"}.`,
        `Weekly 8-period return is ${weeklyReturn >= 0 ? "+" : ""}${weeklyReturn.toFixed(2)}%.`,
        weeklyReturn > 0 && snapshot.oneMonthChangePercent > 0
          ? "Daily and weekly momentum are broadly aligned."
          : "Daily and weekly momentum are not fully aligned.",
      ],
    },
    {
      key: "reward-to-decay",
      title: "Reward-to-decay analysis",
      status: "available",
      summary: "This uses the technical target distance, expected move proxy, and premium score to judge whether long premium has enough edge.",
      bullets: [
        `Premium score: ${snapshot.premiumBuyingScore.toFixed(1)}.`,
        `Target distance ${targetDistancePercent.toFixed(2)}% versus stop distance ${stopDistancePercent.toFixed(2)}%.`,
        snapshot.premiumBuyingScore >= 60 && targetDistancePercent > stopDistancePercent
          ? "The setup is more compatible with long premium than with defensive spread-only positioning."
          : "The setup likely needs spreads, more time, or a better entry to offset decay and volatility risk.",
      ],
    },
    {
      key: "entry-quality",
      title: "Entry quality around support and resistance",
      status: "available",
      summary: "This checks whether the current spot is being bought into resistance or sold into support.",
      bullets: [
        `Distance from 20 SMA: ${snapshot.distanceFrom20Sma >= 0 ? "+" : ""}${snapshot.distanceFrom20Sma.toFixed(2)}%.`,
        `Distance from 52-week high: ${snapshot.distanceFrom52WeekHigh.toFixed(2)}%; distance from 52-week low: ${snapshot.distanceFrom52WeekLow.toFixed(2)}%.`,
        bullish
          ? snapshot.distanceFrom52WeekHigh > -3
            ? "Calls are being considered near resistance; waiting for clean breakout confirmation may improve entry quality."
            : "Current price is not immediately pinned against major resistance."
          : snapshot.distanceFrom52WeekLow < 3
            ? "Puts are being considered near support; waiting for breakdown confirmation may improve entry quality."
            : "Current price is not immediately pinned against major support.",
      ],
    },
  ];

  return insights;
}

export async function buildScreenerDetail(symbol: string) {
  const metadata = getTickerMetadata(symbol);

  if (!metadata) {
    throw new Error(`Unknown screener symbol: ${symbol}`);
  }

  const provider = createMarketDataProvider();
  const start = getHistoryStart();
  const benchmarkSymbols = Array.from(new Set(["SPY", "QQQ", ...metadata.benchmarkLinks]));
  const relevantSectorSymbol =
    metadata.benchmarkLinks.find((value) => value !== "SPY" && value !== "QQQ") ??
    metadata.benchmarkLinks[0] ??
    null;

  const [result, optionSnapshotsResult, ...benchmarkResults] = await Promise.all([
    provider.getBars({
      symbol,
      timeframe: "1Day",
      limit: BAR_LIMIT,
      start,
    }),
    provider
      .getOptionSnapshots({
        underlyingSymbol: symbol,
        pageSize: 250,
        maxPages: 3,
      })
      .catch(() => ({
        underlyingSymbol: symbol,
        snapshots: [],
        source: "alpaca" as const,
      })),
    ...benchmarkSymbols
      .filter((benchmark) => benchmark !== symbol)
      .map((benchmark) =>
        provider.getBars({
          symbol: benchmark,
          timeframe: "1Day",
          limit: BAR_LIMIT,
          start,
        }),
      ),
  ]);

  const snapshot = computeFeatureSnapshot({
    symbol,
    timeframe: "1Day",
    bars: result.bars,
  });
  const chartBars = result.bars;

  const benchmarkComparisons = benchmarkSymbols
    .filter((benchmark) => benchmark !== symbol)
    .map((benchmark, index) => {
      const benchmarkBars = benchmarkResults[index]?.bars ?? [];

      if (!benchmarkBars.length) {
        return null;
      }

      return {
        symbol: benchmark,
        read: computeRelativeRead(chartBars, benchmarkBars),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        symbol: string;
        read: ReturnType<typeof computeRelativeRead>;
      } => Boolean(entry),
    );

  const insights = buildInsights({
    symbol,
    snapshot,
    bars: chartBars,
    benchmarkSnapshots: benchmarkComparisons,
    relevantSectorSymbol,
  });
  const rankedContracts = buildSuggestedContracts(optionSnapshotsResult.snapshots, snapshot);

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
    benchmarkComparisons,
    insights,
    optionContracts: {
      underlyingSymbol: symbol,
      count: optionSnapshotsResult.snapshots.length,
      suggested: rankedContracts.suggested,
      fastLane: rankedContracts.fastLane,
    },
  };
}
