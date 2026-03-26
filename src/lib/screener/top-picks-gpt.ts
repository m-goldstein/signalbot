import { getOpenAIConfig } from "@/lib/openai/config";
import { fetchGoogleNewsHeadlines } from "@/lib/news/google-news";
import { ScreenerRow } from "@/lib/screener/types";
import { AnalysisCitationSource, AnalysisUnverifiedContext, AnalysisVerifiedFinding } from "@/lib/watchlist/types";
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
  warnings: string[];
  verifiedFindings: AnalysisVerifiedFinding[];
  unverifiedModelContext: AnalysisUnverifiedContext[];
  sources: AnalysisCitationSource[];
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

function sanitizeSourceCatalog(headlines: Awaited<ReturnType<typeof fetchGoogleNewsHeadlines>>, scope: string, startId: number) {
  return headlines.map((headline, index) => ({
    id: startId + index,
    title: headline.title,
    source: headline.source,
    publishedAt: headline.publishedAt,
    url: headline.url,
    scope,
  }));
}

function sanitizeVerifiedFinding(item: unknown): AnalysisVerifiedFinding | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const claim = typeof candidate.claim === "string" ? candidate.claim.trim() : "";
  const citations = Array.isArray(candidate.citations)
    ? candidate.citations
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
        .slice(0, 6)
    : [];

  if (!claim || !citations.length) {
    return null;
  }

  return { claim, citations };
}

function sanitizeUnverifiedContext(item: unknown): AnalysisUnverifiedContext | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const claim = typeof candidate.claim === "string" ? candidate.claim.trim() : "";
  const confidence = typeof candidate.confidence === "string" ? candidate.confidence.trim().toUpperCase() : "";
  const reason = typeof candidate.reason === "string" ? candidate.reason.trim() : "";

  if (!claim || !reason || (confidence !== "LOW" && confidence !== "MEDIUM" && confidence !== "HIGH")) {
    return null;
  }

  return {
    claim,
    confidence: confidence as AnalysisUnverifiedContext["confidence"],
    reason,
  };
}

function buildPrompt(input: { rows: ScreenerRow[]; asOf: string; sources: AnalysisCitationSource[] }): string {
  const { rows, asOf, sources } = input;
  const techRows = rows.filter((r) => r.section === "tech");
  const defenseRows = rows.filter((r) => r.section === "defense");
  const leaderRows = rows.filter((r) => r.section === "leaders");

  const techBlock = techRows.map(formatRow).join("\n\n");
  const defenseBlock = defenseRows.map(formatRow).join("\n\n");
  const leaderBlock = leaderRows.map(formatRow).join("\n\n");

  return `
You are a financial analyst preparing a real-money candidate list for further options review.

Screener date: ${asOf}
Next trading day target: ${asOf} (or the next open market session)

Your task has two parts:
  1. Synthesize a macro and sector-level view using only the screener data and numbered source packet below.
  2. Identify the 10 best underlying setups for near-term options review from the universe below, while acknowledging that full options-chain validation is incomplete.

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
- Use numbered citations only for claims supported by the provided source packet.
- If you recall potentially relevant macro, geopolitical, sector, or policy context that is not explicitly supported by the packet, place it only in "unverifiedModelContext". Never treat it as cited fact.
- If no explicit source supports a catalyst date, earnings timing, policy event, or event-driven claim, emit a warning and treat it as unknown.

=== SOURCE PACKET ===
${JSON.stringify(sources, null, 2)}

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
3. Macro/sector tailwinds or headwinds from the numbered source packet, plus clearly labeled unverified model context when necessary
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
  "warnings": ["<warning strings such as UNKNOWN_EARNINGS_DATE or NO_VERIFIED_MACRO_SOURCE>"],
  "verifiedFindings": [
    {
      "claim": "<short source-backed claim>",
      "citations": [1]
    }
  ],
  "unverifiedModelContext": [
    {
      "claim": "<short recollection or synthesis not explicitly source-backed in packet>",
      "confidence": "<LOW | MEDIUM | HIGH>",
      "reason": "<why it is unverified>"
    }
  ],
  "sources": [
    {
      "id": 1,
      "title": "<source title>",
      "source": "<publisher>",
      "publishedAt": "<date string>",
      "url": "<url>",
      "scope": "<tech | defense | market>"
    }
  ],
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
  const [techSourcesRaw, defenseSourcesRaw, marketSourcesRaw] = await Promise.all([
    fetchGoogleNewsHeadlines("(semiconductors OR AI infrastructure OR cloud software) (stocks OR demand OR regulation)", 3).catch(() => []),
    fetchGoogleNewsHeadlines("(defense contractors OR aerospace OR military contracts) (stocks OR budget OR geopolitics)", 3).catch(() => []),
    fetchGoogleNewsHeadlines("(Federal Reserve OR Treasury yields OR stock market breadth OR Nasdaq) (markets OR rates)", 3).catch(() => []),
  ]);
  const sources = [
    ...sanitizeSourceCatalog(techSourcesRaw, "tech", 1),
    ...sanitizeSourceCatalog(defenseSourcesRaw, "defense", techSourcesRaw.length + 1),
    ...sanitizeSourceCatalog(
      marketSourcesRaw,
      "market",
      techSourcesRaw.length + defenseSourcesRaw.length + 1,
    ),
  ];

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: buildPrompt({ ...input, sources }) }],
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
    warnings: Array.isArray(data.warnings) ? data.warnings.map((item) => String(item).trim()).filter(Boolean).slice(0, 12) : [],
    verifiedFindings: Array.isArray(data.verifiedFindings)
      ? data.verifiedFindings
          .map(sanitizeVerifiedFinding)
          .filter((item): item is AnalysisVerifiedFinding => item !== null)
          .slice(0, 10)
      : [],
    unverifiedModelContext: Array.isArray(data.unverifiedModelContext)
      ? data.unverifiedModelContext
          .map(sanitizeUnverifiedContext)
          .filter((item): item is AnalysisUnverifiedContext => item !== null)
          .slice(0, 10)
      : [],
    sources: Array.isArray(data.sources)
      ? data.sources
          .map((item) => {
            if (!item || typeof item !== "object") {
              return null;
            }

            const source = item as Record<string, unknown>;
            const id = Number(source.id);
            const title = typeof source.title === "string" ? source.title.trim() : "";

            if (!Number.isInteger(id) || id <= 0 || !title) {
              return null;
            }

            return {
              id,
              title,
              source: typeof source.source === "string" ? source.source.trim() : "Unknown",
              publishedAt: typeof source.publishedAt === "string" ? source.publishedAt.trim() : "",
              url: typeof source.url === "string" ? source.url.trim() : "",
              scope: typeof source.scope === "string" ? source.scope.trim() : "",
            };
          })
          .filter((item): item is AnalysisCitationSource => item !== null)
          .slice(0, 12)
      : [],
    picks,
  };
}
