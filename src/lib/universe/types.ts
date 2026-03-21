export type UniverseTier = "tier1" | "tier2" | "tier3";
export type UniverseSection = "tech" | "leaders";

export type UniverseSegment =
  | "fabless"
  | "equipment"
  | "memory"
  | "networking"
  | "foundry"
  | "eda"
  | "adjacent"
  | "storage"
  | "datacenter"
  | "space"
  | "quantum"
  | "power"
  | "software"
  | "platform"
  | "index";

export type UniverseTicker = {
  symbol: string;
  name: string;
  tier: UniverseTier;
  section: UniverseSection;
  segment: UniverseSegment;
  benchmarkLinks: string[];
  tags: string[];
};
