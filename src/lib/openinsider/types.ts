export type OpenInsiderTrade = {
  date: string;
  ticker: string;
  insider: string;
  relationship: string;
  transactionType: string;
  shares: number;
  averagePrice: number;
  value: number;
  totalOwned: number;
};

export type OpenInsiderQuery = {
  symbol?: string;
  side?: "all" | "buy" | "sale";
  page?: number;
  count?: number;
};

export type TickerValueSummary = {
  ticker: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  latestTradeDate: string;
  earliestTradeDate: string;
  uniqueInsiderCount: number;
  uniqueRelationshipCount: number;
  activeDayCount: number;
  averageTradeValue: number;
  largestBuyValue: number;
  largestSellValue: number;
  buyToSellValueRatio: number | null;
  buyValueConcentrationPercent: number;
  sellValueConcentrationPercent: number;
  clusterScore: number;
  accumulationScore: number;
  distributionScore: number;
  activityBias: "accumulation" | "distribution" | "mixed";
};

export type InsiderValueSummary = {
  insider: string;
  relationship: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
  tradeCount: number;
  latestTradeDate: string;
  uniqueTickerCount: number;
  averageTradeValue: number;
  activityBias: "accumulation" | "distribution" | "mixed";
};

export type DailyValuePoint = {
  date: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
  tradeCount: number;
  uniqueTickerCount: number;
};

export type RelationshipValueSummary = {
  relationship: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
  tradeCount: number;
  uniqueInsiderCount: number;
  uniqueTickerCount: number;
};

export type TickerResearchSummary = {
  ticker: string;
  activityBias: "accumulation" | "distribution" | "mixed";
  accumulationScore: number;
  distributionScore: number;
  clusterScore: number;
  uniqueInsiderCount: number;
  uniqueRelationshipCount: number;
  activeDayCount: number;
  averageTradeValue: number;
  largestBuyValue: number;
  largestSellValue: number;
  buyToSellValueRatio: number | null;
  dominantRelationships: string[];
  notableInsiders: string[];
  analysisSummary: string;
};

export type OpenInsiderAnalysis = {
  totals: {
    tradeCount: number;
    buyCount: number;
    sellCount: number;
    buyValue: number;
    sellValue: number;
    netValue: number;
    earliestTradeDate: string | null;
    latestTradeDate: string | null;
    uniqueTickerCount: number;
    uniqueInsiderCount: number;
    activeDayCount: number;
    averageTradeValue: number;
    buyToSellValueRatio: number | null;
    largestBuyValue: number;
    largestSellValue: number;
  };
  tickerSummaries: TickerValueSummary[];
  insiderSummaries: InsiderValueSummary[];
  relationshipSummaries: RelationshipValueSummary[];
  tickerResearchSummaries: TickerResearchSummary[];
  dailySeries: DailyValuePoint[];
};

export type OpenInsiderResponse = {
  query: Required<OpenInsiderQuery>;
  trades: OpenInsiderTrade[];
  analysis: OpenInsiderAnalysis;
};

export type OpenInsiderGptResponse = {
  model: string;
  topN: number;
  results: {
    symbol: string;
    direction: "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
    insiderSignal: "ACCUMULATION" | "DISTRIBUTION" | "MIXED" | "INCONCLUSIVE";
    quality: "HIGH" | "MEDIUM" | "LOW";
    confidence: number;
    researchSummary: string;
    keyDrivers: string[];
    riskFlags: string[];
    rationale: string;
  }[];
};
