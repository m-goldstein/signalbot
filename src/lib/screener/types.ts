import { BreakoutState } from "@/lib/features/types";
import { Timeframe } from "@/lib/market-data/types";
import { UniverseSection, UniverseSegment, UniverseTier } from "@/lib/universe/types";

export type ScreenerSortField =
  | "symbol"
  | "dailyChangePercent"
  | "oneMonthChangePercent"
  | "threeMonthChangePercent"
  | "sixMonthChangePercent"
  | "oneYearChangePercent"
  | "distanceFrom20Sma"
  | "distanceFrom50Sma"
  | "distanceFrom200Sma"
  | "distanceFrom52WeekHigh"
  | "distanceFrom52WeekLow"
  | "atrPercent"
  | "realizedVol20"
  | "realizedVol60"
  | "averageDollarVolume20"
  | "directionalConvictionScore"
  | "premiumBuyingScore"
  | "volumeVs20DayAverage";

export type ScreenerRow = {
  symbol: string;
  name: string;
  tier: UniverseTier;
  section: UniverseSection;
  segment: UniverseSegment;
  timeframe: Timeframe;
  asOf: string;
  close: number;
  dailyChangePercent: number;
  oneMonthChangePercent: number;
  threeMonthChangePercent: number;
  sixMonthChangePercent: number;
  oneYearChangePercent: number;
  distanceFrom20Sma: number;
  distanceFrom50Sma: number;
  distanceFrom200Sma: number;
  distanceFrom52WeekHigh: number;
  distanceFrom52WeekLow: number;
  atrPercent: number;
  realizedVol20: number;
  realizedVol60: number;
  averageDollarVolume20: number;
  volumeVs20DayAverage: number;
  directionalConvictionScore: number;
  premiumBuyingScore: number;
  breakoutState: BreakoutState;
  smaStackAligned: boolean;
  closeLocationPercent: number;
  optionsDirectionalBias: "call" | "put" | "neutral";
  optionsStructureBias: "long_call" | "call_spread" | "long_put" | "put_spread" | "no_trade" | "watchlist";
};

export type ScreenerResponse = {
  source: "alpaca";
  timeframe: Timeframe;
  tier: UniverseTier | "all";
  historyStart: string;
  rowCount: number;
  rows: ScreenerRow[];
};

export type ScreenerGptResponse = {
  model: string;
  topN: number;
  results: {
    symbol: string;
    direction: "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
    confidence: number;
    optionsAction: "LONG_CALL" | "CALL_SPREAD" | "LONG_PUT" | "PUT_SPREAD" | "WATCHLIST" | "NO_TRADE";
    optionsJudgment: string;
    rationale: string;
  }[];
};

export type ScreenerAnalysisEntry = {
  symbol: string;
  name: string;
  segment: string;
  tier: UniverseTier;
};

export type ScreenerAnalysisJobStatus = "queued" | "running" | "completed" | "failed";

export type ScreenerAnalysisJobRecord = {
  id: string;
  requestKey: string;
  symbol: string;
  rowName: string;
  segment: string;
  tier: UniverseTier;
  status: ScreenerAnalysisJobStatus;
  inputHash: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  model: string | null;
  result: ScreenerGptResponse["results"][number] | null;
};
