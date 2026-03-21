import {
  DailyValuePoint,
  InsiderValueSummary,
  OpenInsiderAnalysis,
  OpenInsiderTrade,
  RelationshipValueSummary,
  TickerResearchSummary,
  TickerValueSummary,
} from "@/lib/openinsider/types";

function toDayKey(rawDate: string) {
  return rawDate.slice(0, 10);
}

function normalizeBias(netValue: number, buyCount: number, sellCount: number) {
  if (buyCount > 0 && sellCount === 0 && netValue > 0) {
    return "accumulation" as const;
  }

  if (sellCount > 0 && buyCount === 0 && netValue < 0) {
    return "distribution" as const;
  }

  if (netValue > 0) {
    return "accumulation" as const;
  }

  if (netValue < 0) {
    return "distribution" as const;
  }

  return "mixed" as const;
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}

function percent(part: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return (part / total) * 100;
}

function sortDescendingByAbsNet<T extends { netValue: number }>(items: T[]) {
  return [...items].sort((left, right) => Math.abs(right.netValue) - Math.abs(left.netValue));
}

function describeTickerResearch(summary: TickerResearchSummary) {
  const drivers: string[] = [];

  if (summary.activityBias === "accumulation") {
    drivers.push("net insider activity is skewed toward buying");
  } else if (summary.activityBias === "distribution") {
    drivers.push("net insider activity is skewed toward selling");
  } else {
    drivers.push("buy and sell activity are mixed");
  }

  if (summary.uniqueInsiderCount >= 3) {
    drivers.push(`participation is broad across ${summary.uniqueInsiderCount} insiders`);
  } else if (summary.uniqueInsiderCount === 1) {
    drivers.push("activity is concentrated in a single insider");
  }

  if (summary.clusterScore >= 2) {
    drivers.push("trades are clustered across a short active window");
  }

  if (summary.buyToSellValueRatio !== null) {
    if (summary.buyToSellValueRatio >= 3) {
      drivers.push("buy value materially outweighs sell value");
    } else if (summary.buyToSellValueRatio <= 0.33) {
      drivers.push("sell value materially outweighs buy value");
    }
  }

  if (summary.largestBuyValue > 0 && summary.largestSellValue > 0) {
    drivers.push("both sides of the tape are active and require context");
  }

  return `${summary.ticker}: ${drivers.join("; ")}.`;
}

export function analyzeOpenInsiderTrades(trades: OpenInsiderTrade[]): OpenInsiderAnalysis {
  const tickerMap = new Map<
    string,
    TickerValueSummary & {
      insiderSet: Set<string>;
      relationshipSet: Set<string>;
      activeDays: Set<string>;
      relationshipCounts: Map<string, number>;
      insiderNetMap: Map<string, number>;
    }
  >();
  const insiderMap = new Map<
    string,
    InsiderValueSummary & {
      tickerSet: Set<string>;
    }
  >();
  const relationshipMap = new Map<
    string,
    RelationshipValueSummary & {
      insiderSet: Set<string>;
      tickerSet: Set<string>;
    }
  >();
  const dailyMap = new Map<
    string,
    DailyValuePoint & {
      tickerSet: Set<string>;
    }
  >();

  const uniqueTickers = new Set<string>();
  const uniqueInsiders = new Set<string>();

  let buyCount = 0;
  let sellCount = 0;
  let buyValue = 0;
  let sellValue = 0;
  let largestBuyValue = 0;
  let largestSellValue = 0;

  for (const trade of trades) {
    uniqueTickers.add(trade.ticker);
    uniqueInsiders.add(trade.insider);

    const dayKey = toDayKey(trade.date);
    const insiderKey = `${trade.insider}__${trade.relationship}`;

    const tickerEntry = tickerMap.get(trade.ticker) ?? {
      ticker: trade.ticker,
      buyValue: 0,
      sellValue: 0,
      netValue: 0,
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      latestTradeDate: trade.date,
      earliestTradeDate: trade.date,
      uniqueInsiderCount: 0,
      uniqueRelationshipCount: 0,
      activeDayCount: 0,
      averageTradeValue: 0,
      largestBuyValue: 0,
      largestSellValue: 0,
      buyToSellValueRatio: null,
      buyValueConcentrationPercent: 0,
      sellValueConcentrationPercent: 0,
      clusterScore: 0,
      accumulationScore: 0,
      distributionScore: 0,
      activityBias: "mixed" as const,
      insiderSet: new Set<string>(),
      relationshipSet: new Set<string>(),
      activeDays: new Set<string>(),
      relationshipCounts: new Map<string, number>(),
      insiderNetMap: new Map<string, number>(),
    };

    const insiderEntry = insiderMap.get(insiderKey) ?? {
      insider: trade.insider,
      relationship: trade.relationship,
      buyValue: 0,
      sellValue: 0,
      netValue: 0,
      tradeCount: 0,
      latestTradeDate: trade.date,
      uniqueTickerCount: 0,
      averageTradeValue: 0,
      activityBias: "mixed" as const,
      tickerSet: new Set<string>(),
    };

    const relationshipEntry = relationshipMap.get(trade.relationship) ?? {
      relationship: trade.relationship,
      buyValue: 0,
      sellValue: 0,
      netValue: 0,
      tradeCount: 0,
      uniqueInsiderCount: 0,
      uniqueTickerCount: 0,
      insiderSet: new Set<string>(),
      tickerSet: new Set<string>(),
    };

    const dailyEntry = dailyMap.get(dayKey) ?? {
      date: dayKey,
      buyValue: 0,
      sellValue: 0,
      netValue: 0,
      tradeCount: 0,
      uniqueTickerCount: 0,
      tickerSet: new Set<string>(),
    };

    tickerEntry.tradeCount += 1;
    tickerEntry.activeDays.add(dayKey);
    tickerEntry.insiderSet.add(trade.insider);
    tickerEntry.relationshipSet.add(trade.relationship);
    tickerEntry.relationshipCounts.set(
      trade.relationship,
      (tickerEntry.relationshipCounts.get(trade.relationship) ?? 0) + 1,
    );

    insiderEntry.tradeCount += 1;
    insiderEntry.tickerSet.add(trade.ticker);

    relationshipEntry.tradeCount += 1;
    relationshipEntry.insiderSet.add(trade.insider);
    relationshipEntry.tickerSet.add(trade.ticker);

    dailyEntry.tradeCount += 1;
    dailyEntry.tickerSet.add(trade.ticker);

    if (trade.value >= 0) {
      tickerEntry.buyValue += trade.value;
      tickerEntry.buyCount += 1;
      tickerEntry.largestBuyValue = Math.max(tickerEntry.largestBuyValue, trade.value);
      insiderEntry.buyValue += trade.value;
      relationshipEntry.buyValue += trade.value;
      dailyEntry.buyValue += trade.value;
      buyCount += 1;
      buyValue += trade.value;
      largestBuyValue = Math.max(largestBuyValue, trade.value);
    } else {
      const absValue = Math.abs(trade.value);
      tickerEntry.sellValue += absValue;
      tickerEntry.sellCount += 1;
      tickerEntry.largestSellValue = Math.max(tickerEntry.largestSellValue, absValue);
      insiderEntry.sellValue += absValue;
      relationshipEntry.sellValue += absValue;
      dailyEntry.sellValue += absValue;
      sellCount += 1;
      sellValue += absValue;
      largestSellValue = Math.max(largestSellValue, absValue);
    }

    tickerEntry.netValue = tickerEntry.buyValue - tickerEntry.sellValue;
    tickerEntry.latestTradeDate = trade.date > tickerEntry.latestTradeDate ? trade.date : tickerEntry.latestTradeDate;
    tickerEntry.earliestTradeDate = trade.date < tickerEntry.earliestTradeDate ? trade.date : tickerEntry.earliestTradeDate;
    tickerEntry.insiderNetMap.set(
      trade.insider,
      (tickerEntry.insiderNetMap.get(trade.insider) ?? 0) + trade.value,
    );

    insiderEntry.netValue = insiderEntry.buyValue - insiderEntry.sellValue;
    insiderEntry.latestTradeDate = trade.date > insiderEntry.latestTradeDate ? trade.date : insiderEntry.latestTradeDate;
    insiderEntry.activityBias = normalizeBias(insiderEntry.netValue, insiderEntry.buyValue > 0 ? 1 : 0, insiderEntry.sellValue > 0 ? 1 : 0);

    relationshipEntry.netValue = relationshipEntry.buyValue - relationshipEntry.sellValue;
    dailyEntry.netValue = dailyEntry.buyValue - dailyEntry.sellValue;

    tickerMap.set(trade.ticker, tickerEntry);
    insiderMap.set(insiderKey, insiderEntry);
    relationshipMap.set(trade.relationship, relationshipEntry);
    dailyMap.set(dayKey, dailyEntry);
  }

  const tickerSummaries = sortDescendingByAbsNet(
    [...tickerMap.values()].map((entry) => {
      const uniqueInsiderCount = entry.insiderSet.size;
      const uniqueRelationshipCount = entry.relationshipSet.size;
      const activeDayCount = entry.activeDays.size;
      const averageTradeValue = entry.tradeCount ? (entry.buyValue + entry.sellValue) / entry.tradeCount : 0;
      const buyToSellValueRatio = ratio(entry.buyValue, entry.sellValue);
      const buyValueConcentrationPercent = percent(entry.largestBuyValue, entry.buyValue);
      const sellValueConcentrationPercent = percent(entry.largestSellValue, entry.sellValue);
      const clusterScore = activeDayCount ? entry.tradeCount / activeDayCount : 0;
      const breadthFactor = Math.min(1, uniqueInsiderCount / 4);
      const accumulationScore = (entry.buyValue / Math.max(entry.buyValue + entry.sellValue, 1)) * 60 + breadthFactor * 25 + Math.min(clusterScore, 3) * 5;
      const distributionScore = (entry.sellValue / Math.max(entry.buyValue + entry.sellValue, 1)) * 60 + breadthFactor * 25 + Math.min(clusterScore, 3) * 5;

      return {
        ...entry,
        uniqueInsiderCount,
        uniqueRelationshipCount,
        activeDayCount,
        averageTradeValue,
        buyToSellValueRatio,
        buyValueConcentrationPercent,
        sellValueConcentrationPercent,
        clusterScore,
        accumulationScore,
        distributionScore,
        activityBias: normalizeBias(entry.netValue, entry.buyCount, entry.sellCount),
      };
    }),
  );

  const insiderSummaries = sortDescendingByAbsNet(
    [...insiderMap.values()].map((entry) => ({
      ...entry,
      uniqueTickerCount: entry.tickerSet.size,
      averageTradeValue: entry.tradeCount ? (entry.buyValue + entry.sellValue) / entry.tradeCount : 0,
    })),
  );

  const relationshipSummaries = sortDescendingByAbsNet(
    [...relationshipMap.values()].map((entry) => ({
      relationship: entry.relationship,
      buyValue: entry.buyValue,
      sellValue: entry.sellValue,
      netValue: entry.netValue,
      tradeCount: entry.tradeCount,
      uniqueInsiderCount: entry.insiderSet.size,
      uniqueTickerCount: entry.tickerSet.size,
    })),
  );

  const dailySeries = [...dailyMap.values()]
    .map((entry) => ({
      date: entry.date,
      buyValue: entry.buyValue,
      sellValue: entry.sellValue,
      netValue: entry.netValue,
      tradeCount: entry.tradeCount,
      uniqueTickerCount: entry.tickerSet.size,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const tickerResearchSummaries: TickerResearchSummary[] = tickerSummaries.map((entry) => {
    const tickerEntry = tickerMap.get(entry.ticker);
    const dominantRelationships = tickerEntry
      ? [...tickerEntry.relationshipCounts.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 3)
          .map(([relationship]) => relationship)
      : [];
    const notableInsiders = tickerEntry
      ? [...tickerEntry.insiderNetMap.entries()]
          .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
          .slice(0, 3)
          .map(([insider]) => insider)
      : [];

    const summary: TickerResearchSummary = {
      ticker: entry.ticker,
      activityBias: entry.activityBias,
      accumulationScore: entry.accumulationScore,
      distributionScore: entry.distributionScore,
      clusterScore: entry.clusterScore,
      uniqueInsiderCount: entry.uniqueInsiderCount,
      uniqueRelationshipCount: entry.uniqueRelationshipCount,
      activeDayCount: entry.activeDayCount,
      averageTradeValue: entry.averageTradeValue,
      largestBuyValue: entry.largestBuyValue,
      largestSellValue: entry.largestSellValue,
      buyToSellValueRatio: entry.buyToSellValueRatio,
      dominantRelationships,
      notableInsiders,
      analysisSummary: "",
    };

    summary.analysisSummary = describeTickerResearch(summary);
    return summary;
  });

  const sortedByDate = [...trades].sort((left, right) => left.date.localeCompare(right.date));

  return {
    totals: {
      tradeCount: trades.length,
      buyCount,
      sellCount,
      buyValue,
      sellValue,
      netValue: buyValue - sellValue,
      earliestTradeDate: sortedByDate[0]?.date ?? null,
      latestTradeDate: sortedByDate.at(-1)?.date ?? null,
      uniqueTickerCount: uniqueTickers.size,
      uniqueInsiderCount: uniqueInsiders.size,
      activeDayCount: dailySeries.length,
      averageTradeValue: trades.length ? (buyValue + sellValue) / trades.length : 0,
      buyToSellValueRatio: ratio(buyValue, sellValue),
      largestBuyValue,
      largestSellValue,
    },
    tickerSummaries,
    insiderSummaries,
    relationshipSummaries,
    tickerResearchSummaries,
    dailySeries,
  };
}
