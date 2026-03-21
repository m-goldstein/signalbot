export type ContractWatchlistEntry = {
  symbol: string;
  underlyingSymbol: string;
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
  lane: "suggested" | "fast_lane";
  addedAt: string;
};

export type WatchlistContractHeadline = {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
};

export type WatchlistContractGptResult = {
  contractSymbol: string;
  underlyingSymbol: string;
  pursueDecision: "PURSUE" | "MONITOR" | "AVOID";
  shortTermBias: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
  longTermBias: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
  confidence: number;
  contractJudgment: string;
  thesisSummary: string;
  positiveCatalysts: string[];
  negativeCatalysts: string[];
  insiderTake: string;
  geopoliticalTake: string;
  actionPlan: string;
  rationale: string;
  companyHeadlines: WatchlistContractHeadline[];
  marketHeadlines: WatchlistContractHeadline[];
};

export type WatchlistContractGptResponse = {
  model: string;
  analyzedCount: number;
  results: WatchlistContractGptResult[];
};
