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

export type BarsResult = {
  symbol: string;
  timeframe: Timeframe;
  bars: PriceBar[];
  source: "alpaca";
};

export interface MarketDataProvider {
  getBars(query: BarsQuery): Promise<BarsResult>;
}
