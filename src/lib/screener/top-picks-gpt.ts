import { getOpenAIConfig } from "@/lib/openai/config";
import { ScreenerRow } from "@/lib/screener/types";
import OpenAI from "openai";

export type TopPickResult = {
  rank: number;
  symbol: string;
  name: string;
  section: string;
  optionType: "call" | "put";
  structure: "LONG_CALL" | "CALL_SPREAD" | "LONG_PUT" | "PUT_SPREAD";
  targetExpiry: "0-7 days" | "8-21 days" | "22-45 days";
  rationale: string;
  keyRisks: string;
  confidence: number;
};

export type TopPicksSectorReadings = {
  tech: string;
  defense: string;
  market: string;
};

export type TopPicksGptResult = {
  model: string;
  asOf: string;
  macroContext: string;
  sectorReadings: TopPicksSectorReadings;
  picks: TopPickResult[];
};

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function money(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatRow(row: ScreenerRow): string {
  const tier = row.tier === "tier1" ? "T1" : row.tier === "tier2" ? "T2" : "T3";
  const segment = row.segment.replaceAll("_", " ");
  return [
    `${row.symbol} (${row.name}) | ${segment} | ${tier} | $${row.close.toFixed(2)} | Day: ${pct(row.dailyChangePercent)}`,
    `  Momentum:  1M ${pct(row.oneMonthChangePercent)}  3M ${pct(row.threeMonthChangePercent)}  6M ${pct(row.sixMonthChangePercent)}  1Y ${pct(row.oneYearChangePercent)}`,
    `  Trend:     20sma ${pct(row.distanceFrom20Sma)}  50sma ${pct(row.distanceFrom50Sma)}  200sma ${pct(row.distanceFrom200Sma)}  Stack: ${row.smaStackAligned ? "ALIGNED" : "MIXED"}`,
    `  Range:     52wHi ${pct(row.distanceFrom52WeekHigh)}  52wLo ${pct(row.distanceFrom52WeekLow)}  State: ${row.breakoutState}  CloseAt: ${(row.closeLocationPercent * 100).toFixed(0)}th pct`,
    `  Volatility: ATR ${pct(row.atrPercent)}  RV20 ${pct(row.realizedVol20)}  RV60 ${pct(row.realizedVol60)}`,
    `  Liquidity:  ADV20 ${money(row.averageDollarVolume20)}  Vol/Avg ${row.volumeVs20DayAverage.toFixed(2)}x`,
    `  Options:    Conv ${row.directionalConvictionScore.toFixed(1)}/10  Premium ${row.premiumBuyingScore.toFixed(1)}/10  Bias: ${row.optionsDirectionalBias}  Struct: ${row.optionsStructureBias}`,
  ].join("\n");
}

function buildPrompt(input: { rows: ScreenerRow[]; asOf: string }): string {
  const { rows, asOf } = input;
  const techRows = rows.filter((r) => r.section === "tech");
  const defenseRows = rows.filter((r) => r.section === "defense");
  const leaderRows = rows.filter((r) => r.section === "leaders");

  const techBlock = techRows.map(formatRow).join("\n\n");
  const defenseBlock = defenseRows.map(formatRow).join("\n\n");
  const leaderBlock = leaderRows.map(formatRow).join("\n\n");

  return `
You are a senior options trader and quantitative strategist with deep expertise in equity derivatives, technical analysis, macro economics, sector dynamics, and geopolitical risk.

Screener date: ${asOf}
Next trading day target: ${asOf} (or the next open market session)

Your task has two parts:
  1. Synthesize a macro and sector-level view using the screener data below combined with your knowledge of current geopolitical conditions, Federal Reserve policy trajectory, global economic trends, AI/semiconductor cycle dynamics, defense spending trends, and earnings season context.
  2. Identify the 10 BEST options contract opportunities for the next trading day from the universe below.

=== METRIC DEFINITIONS ===
Momentum: 1M/3M/6M/1Y = percent returns over those windows (trailing, daily closes)
Trend: Distance from 20/50/200-day simple moving averages. Stack "ALIGNED" means 20sma > 50sma > 200sma (bullish structure).
Range: Distance below 52-week high (negative = below), distance above 52-week low (positive). breakout/breakdown/inside-range = 20-day range state. CloseAt = today's close location within today's high-low range (100th pct = at high, 0th = at low).
Volatility: ATR% = average true range as pct of price (daily expected move proxy). RV20/RV60 = 20-day and 60-day realized volatility annualized.
Liquidity: ADV20 = 20-day average dollar volume. Vol/Avg = today's volume relative to 20-day average.
Options signals (internal model scores):
  - Conv (Directional Conviction) 0-10: composite score of trend, momentum, and breakout alignment. Higher = stronger directional signal.
  - Premium (Premium Buying Score) 0-10: estimates how favorable ATR/vol structure is for buying premium vs. selling. Higher = more favorable to buy options outright.
  - Bias: directional bias from technical structure (call/put/neutral)
  - Struct: suggested options structure (long_call/call_spread/long_put/put_spread/no_trade/watchlist)

=== IMPORTANT CONSTRAINTS ===
- Actual options chain data is NOT available: no implied volatility, no open interest, no bid/ask spreads, no specific strikes, no earnings dates.
- Liquidity quality: strongly prefer names with ADV20 > $200M for practical options tradability. Names below $50M ADV20 should only appear in exceptional cases.
- Tier 3 speculative names (quantum computing, small-cap space) have low options liquidity — weight accordingly.
- Confidence levels should reflect the missing IV/chain data: cap at 0.85 even for very strong setups.
- Do not fabricate specific strike prices or expiry dates. Use the targetExpiry buckets provided.
- You may and should use your broader knowledge of current macro environment, geopolitical events (tariffs, defense spending, NATO dynamics, AI competition with China, etc.), recent sector earnings, and Fed policy to inform your picks and sector readings.

=== SCREENER DATA ===

--- TECHNOLOGY (${techRows.length} names) ---
${techBlock}

--- DEFENSE & AEROSPACE (${defenseRows.length} names) ---
${defenseBlock}

--- MARKET LEADERS & BENCHMARKS (${leaderRows.length} names) ---
${leaderBlock}

=== SELECTION CRITERIA FOR TOP 10 PICKS ===
Rank picks by expected edge for the NEXT trading day options position, considering:
1. Signal convergence: high conviction score + strong premium score + aligned SMA stack + trending momentum + above-average volume = higher edge
2. Liquidity: adequate dollar volume for realistic options fills
3. Macro/sector tailwinds or headwinds from your broader knowledge
4. Risk/reward proportionality: prefer structures where the technical setup justifies premium outlay
5. Diversification across sectors and structures is desirable but not mandatory if the best setups cluster
6. Both bullish (calls) and bearish (puts) setups are valid; include both if the data supports them

Output ONLY a single JSON object. No markdown, no code fences, no explanatory text outside the JSON.

JSON schema (output exactly this structure):
{
  "macroContext": "<2-4 sentences: current macro regime, Fed/rates backdrop, risk appetite, what it means for near-term options positioning>",
  "sectorReadings": {
    "tech": "<1-3 sentences: semiconductor, AI infra, software/cloud setup — key tailwinds/headwinds, positioning read>",
    "defense": "<1-3 sentences: defense contractor setup — budget dynamics, geopolitical tailwinds, sector momentum read>",
    "market": "<1-3 sentences: broad market/index setup — SPY/QQQ/IWM regime, breadth read, risk-on vs risk-off signal>"
  },
  "picks": [
    {
      "rank": 1,
      "symbol": "<ticker>",
      "name": "<company name>",
      "section": "<tech | defense | leaders>",
      "optionType": "<call | put>",
      "structure": "<LONG_CALL | CALL_SPREAD | LONG_PUT | PUT_SPREAD>",
      "targetExpiry": "<0-7 days | 8-21 days | 22-45 days>",
      "rationale": "<max 200 words: specific technical reasoning citing the metrics, plus macro/sector context, why this setup now>",
      "keyRisks": "<max 80 words: primary risks to thesis — what would invalidate the setup, what to watch>",
      "confidence": <0.0-0.85 float>
    }
  ]
}

The picks array must contain exactly 10 entries, ranked 1 (highest conviction) to 10.
`.trim();
}

function sanitizePick(value: unknown, fallbackRank: number): TopPickResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;

  const symbol = typeof item.symbol === "string" ? item.symbol.toUpperCase().trim() : "";
  if (!symbol) return null;

  const optionType = item.optionType === "call" || item.optionType === "put" ? item.optionType : null;
  if (!optionType) return null;

  const structure =
    item.structure === "LONG_CALL" ||
    item.structure === "CALL_SPREAD" ||
    item.structure === "LONG_PUT" ||
    item.structure === "PUT_SPREAD"
      ? item.structure
      : null;
  if (!structure) return null;

  const validExpiries = ["0-7 days", "8-21 days", "22-45 days"] as const;
  const targetExpiry = validExpiries.includes(item.targetExpiry as (typeof validExpiries)[number])
    ? (item.targetExpiry as (typeof validExpiries)[number])
    : "8-21 days";

  return {
    rank: typeof item.rank === "number" ? item.rank : fallbackRank,
    symbol,
    name: typeof item.name === "string" ? item.name.trim() : symbol,
    section: typeof item.section === "string" ? item.section.trim() : "",
    optionType,
    structure,
    targetExpiry,
    rationale: typeof item.rationale === "string" ? item.rationale.trim() : "",
    keyRisks: typeof item.keyRisks === "string" ? item.keyRisks.trim() : "",
    confidence:
      typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0,
  };
}

function parseSectorReadings(value: unknown): TopPicksSectorReadings {
  const fallback = { tech: "", defense: "", market: "" };
  if (!value || typeof value !== "object") return fallback;
  const obj = value as Record<string, unknown>;
  return {
    tech: typeof obj.tech === "string" ? obj.tech.trim() : "",
    defense: typeof obj.defense === "string" ? obj.defense.trim() : "",
    market: typeof obj.market === "string" ? obj.market.trim() : "",
  };
}

export async function analyzeTopPicks(input: {
  rows: ScreenerRow[];
  asOf: string;
}): Promise<TopPicksGptResult> {
  const config = getOpenAIConfig();
  const client = new OpenAI({ apiKey: config.apiKey });

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: buildPrompt(input) }],
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from model.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Model returned malformed JSON.");
  }

  const data = parsed as Record<string, unknown>;
  const rawPicks = Array.isArray(data.picks) ? data.picks : [];
  const picks = rawPicks
    .map((item, idx) => sanitizePick(item, idx + 1))
    .filter((pick): pick is TopPickResult => pick !== null)
    .slice(0, 10);

  return {
    model: config.model,
    asOf: input.asOf,
    macroContext: typeof data.macroContext === "string" ? data.macroContext.trim() : "",
    sectorReadings: parseSectorReadings(data.sectorReadings),
    picks,
  };
}
