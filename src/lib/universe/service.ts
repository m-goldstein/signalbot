import { CORE_TECH_UNIVERSE } from "@/lib/universe/core-tech";
import { UniverseTicker, UniverseTier } from "@/lib/universe/types";

export function getUniverse(): UniverseTicker[] {
  return [...CORE_TECH_UNIVERSE];
}

export function getUniverseByTier(tier: UniverseTier): UniverseTicker[] {
  return CORE_TECH_UNIVERSE.filter((ticker) => ticker.tier === tier);
}

export function getUniverseSymbols(tier?: UniverseTier): string[] {
  return (tier ? getUniverseByTier(tier) : CORE_TECH_UNIVERSE).map(({ symbol }) => symbol);
}

export function getTickerMetadata(symbol: string): UniverseTicker | undefined {
  return CORE_TECH_UNIVERSE.find((ticker) => ticker.symbol === symbol.toUpperCase());
}
