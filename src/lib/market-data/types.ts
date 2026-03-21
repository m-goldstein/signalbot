export type Timeframe = "1Day" | "1Hour" | "15Min" | "5Min";

export type PriceBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount?: number;
  vwap?: number;
};

export type BarsQuery = {
  symbol: string;
  timeframe: Timeframe;
  limit: number;
  start?: string;
  end?: string;
};

export type BarsBatchQuery = {
  symbols: string[];
  timeframe: Timeframe;
  limit: number;
  start?: string;
  end?: string;
};

export type BarsResult = {
  symbol: string;
  timeframe: Timeframe;
  bars: PriceBar[];
  source: "alpaca";
};

export type OptionType = "call" | "put";

export type OptionContractSnapshot = {
  symbol: string;
  underlyingSymbol: string;
  expirationDate: string;
  daysToExpiration: number;
  optionType: OptionType;
  strikePrice: number;
  bid: number;
  ask: number;
  mid: number;
  mark: number;
  last: number;
  dailyVolume: number;
  bidSize: number;
  askSize: number;
  bidAskSpread: number;
  bidAskSpreadPercent: number;
  quoteTimestamp: string | null;
  tradeTimestamp: string | null;
};

export type OptionSnapshotsQuery = {
  underlyingSymbol: string;
  pageSize?: number;
  maxPages?: number;
};

export type OptionSnapshotsResult = {
  underlyingSymbol: string;
  snapshots: OptionContractSnapshot[];
  source: "alpaca";
 };

export interface MarketDataProvider {
  getBars(query: BarsQuery): Promise<BarsResult>;
  getBarsBatch?(query: BarsBatchQuery): Promise<BarsResult[]>;
  getOptionSnapshots(query: OptionSnapshotsQuery): Promise<OptionSnapshotsResult>;
}
