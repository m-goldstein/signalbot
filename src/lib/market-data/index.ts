import { AlpacaMarketDataProvider } from "@/lib/market-data/alpaca";
import { MarketDataProvider } from "@/lib/market-data/types";

export function createMarketDataProvider(): MarketDataProvider {
  return new AlpacaMarketDataProvider();
}
