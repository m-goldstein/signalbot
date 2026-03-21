import OpenAI from "openai";
import { getOpenAIConfig } from "@/lib/openai/config";
import { fetchGoogleNewsHeadlines } from "@/lib/news/google-news";
import { analyzeOpenInsiderTrades } from "@/lib/openinsider/analysis";
import { fetchOpenInsiderTrades } from "@/lib/openinsider/scraper";
import { buildScreenerDetail } from "@/lib/screener/detail";
import { getTickerMetadata } from "@/lib/universe/service";
import {
  ContractWatchlistEntry,
  WatchlistContractGptResponse,
  WatchlistContractGptResult,
  WatchlistContractHeadline,
} from "@/lib/watchlist/types";

type WatchlistContractContext = {
  entry: ContractWatchlistEntry;
  metadata: {
    symbol: string;
    name: string;
    section: string;
    segment: string;
    tier: string;
    benchmarkLinks: string[];
    tags: string[];
  };
  currentContractState: {
    inCurrentSuggestions: boolean;
    currentLane: "suggested" | "fast_lane" | "not_ranked";
    currentScore: number | null;
    currentStructure: string | null;
    currentThesisFit: string | null;
  };
  screenerSnapshot: ReturnType<typeof pickSnapshotFields>;
  screenerInsights: Array<{
    title: string;
    summary: string;
    bullets: string[];
  }>;
  companyHeadlines: WatchlistContractHeadline[];
  marketHeadlines: WatchlistContractHeadline[];
  insiderContext: {
    available: boolean;
    summary: string;
    topDrivers: string[];
  };
};

function pickSnapshotFields(snapshot: Awaited<ReturnType<typeof buildScreenerDetail>>["snapshot"]) {
  return {
    close: snapshot.close,
    dailyChangePercent: snapshot.dailyChangePercent,
    oneMonthChangePercent: snapshot.oneMonthChangePercent,
    threeMonthChangePercent: snapshot.threeMonthChangePercent,
    sixMonthChangePercent: snapshot.sixMonthChangePercent,
    oneYearChangePercent: snapshot.oneYearChangePercent,
    distanceFrom20Sma: snapshot.distanceFrom20Sma,
    distanceFrom50Sma: snapshot.distanceFrom50Sma,
    distanceFrom200Sma: snapshot.distanceFrom200Sma,
    distanceFrom52WeekHigh: snapshot.distanceFrom52WeekHigh,
    distanceFrom52WeekLow: snapshot.distanceFrom52WeekLow,
    atrPercent: snapshot.atrPercent,
    realizedVol20: snapshot.realizedVol20,
    realizedVol60: snapshot.realizedVol60,
    averageDollarVolume20: snapshot.averageDollarVolume20,
    volumeVs20DayAverage: snapshot.volumeVs20DayAverage,
    directionalConvictionScore: snapshot.directionalConvictionScore,
    premiumBuyingScore: snapshot.premiumBuyingScore,
    breakoutState: snapshot.breakoutState,
    smaStackAligned: snapshot.smaStackAligned,
    closeLocationPercent: snapshot.closeLocationPercent,
    optionsDirectionalBias: snapshot.optionsDirectionalBias,
    optionsStructureBias: snapshot.optionsStructureBias,
    expectedMove5DayPercent: snapshot.expectedMove5DayPercent,
    expectedMove10DayPercent: snapshot.expectedMove10DayPercent,
  };
}

function marketCatalystQuery(entry: ContractWatchlistEntry, metadata: WatchlistContractContext["metadata"]) {
  const terms = new Set<string>([metadata.segment, metadata.section, ...metadata.tags]);

  if (metadata.section === "defense" || metadata.segment === "space") {
    terms.add("defense spending");
    terms.add("war");
    terms.add("military contracts");
    terms.add("geopolitics");
  }

  if (
    metadata.segment === "memory" ||
    metadata.segment === "storage" ||
    metadata.segment === "datacenter" ||
    metadata.segment === "networking" ||
    metadata.segment === "fabless" ||
    metadata.segment === "foundry" ||
    metadata.segment === "equipment"
  ) {
    terms.add("semiconductors");
    terms.add("export controls");
    terms.add("tariffs");
    terms.add("AI datacenter demand");
  }

  if (metadata.segment === "power") {
    terms.add("power demand");
    terms.add("nuclear");
    terms.add("grid");
  }

  if (metadata.segment === "quantum") {
    terms.add("quantum computing");
    terms.add("government funding");
    terms.add("export controls");
  }

  if (metadata.section === "leaders" || metadata.segment === "index") {
    terms.add("Federal Reserve");
    terms.add("rates");
    terms.add("macro");
  }

  const joined = Array.from(terms).filter(Boolean).slice(0, 6).join(" OR ");
  return `(${joined}) (stocks OR markets OR regulation OR demand OR contracts OR sanctions)`;
}

function sanitizeText(value: string, maxLength = 5000) {
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizeArray(values: string[], itemLimit = 8, itemLength = 260) {
  return values.map((value) => sanitizeText(value, itemLength)).filter(Boolean).slice(0, itemLimit);
}

function buildPrompt(context: WatchlistContractContext) {
  return `
You are a financial advisor who specializes in options trading, event-driven catalysts, market structure, volatility, and risk framing.
You are evaluating whether a specific watchlisted options contract is worth pursuing.

Your job is not to cheerlead. Your job is to judge whether the contract should be pursued, merely monitored, or avoided.

When evaluating the contract, consider all of the following:
- The underlying stock's current technical and volatility state from the screener snapshot
- Whether the contract's expiration, strike, break-even, spread, and volume make sense for the likely move
- Whether the contract still appears aligned with the screener's current options bias and structure bias
- Recent company-specific news and whether it creates positive or negative short-term catalysts
- Recent public insider trading activity and whether it suggests accumulation, distribution, or mixed signaling
- Sector, macro, geopolitical, regulatory, or supply-chain factors that may alter the short-term and long-term setup
- The fact that this packet may not include full options-chain history, full implied-volatility history, exact earnings timing, or all fundamental data

Be explicit about missing data. If the contract looks interesting but incomplete data lowers confidence, say so.
Do not invent facts, catalysts, dates, sources, or numerical values not present in the input.

Always return ONLY valid JSON with the following fields:
- "contractSymbol": string
- "underlyingSymbol": string
- "pursueDecision": "PURSUE" | "MONITOR" | "AVOID"
- "shortTermBias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED"
- "longTermBias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED"
- "confidence": number between 0 and 1
- "contractJudgment": short sentence
- "thesisSummary": concise paragraph
- "positiveCatalysts": array of short strings
- "negativeCatalysts": array of short strings
- "insiderTake": short sentence
- "geopoliticalTake": short sentence
- "actionPlan": concise action recommendation
- "rationale": concise paragraph
- "companyHeadlines": array of objects with "title", "source", "publishedAt", "url"
- "marketHeadlines": array of objects with "title", "source", "publishedAt", "url"

Input packet (JSON):
${JSON.stringify(context, null, 2)}
`.trim();
}

function isBias(value: string) {
  return value === "BULLISH" || value === "BEARISH" || value === "NEUTRAL" || value === "MIXED";
}

function isPursueDecision(value: string) {
  return value === "PURSUE" || value === "MONITOR" || value === "AVOID";
}

function sanitizeHeadline(item: unknown) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const title = sanitizeText(String(candidate.title ?? ""), 240);
  const source = sanitizeText(String(candidate.source ?? ""), 120);
  const publishedAt = sanitizeText(String(candidate.publishedAt ?? ""), 120);
  const url = sanitizeText(String(candidate.url ?? ""), 600);

  if (!title) {
    return null;
  }

  return {
    title,
    source: source || "Unknown",
    publishedAt,
    url,
  };
}

function sanitizeResult(entry: ContractWatchlistEntry, value: unknown): WatchlistContractGptResult {
  if (!value || typeof value !== "object") {
    return {
      contractSymbol: entry.symbol,
      underlyingSymbol: entry.underlyingSymbol,
      pursueDecision: "MONITOR",
      shortTermBias: "MIXED",
      longTermBias: "MIXED",
      confidence: 0,
      contractJudgment: "Unable to parse model output.",
      thesisSummary: "The model response could not be parsed.",
      positiveCatalysts: [],
      negativeCatalysts: [],
      insiderTake: "Insider context could not be synthesized.",
      geopoliticalTake: "Geopolitical context could not be synthesized.",
      actionPlan: "Re-run the analysis after refreshing the watchlist context.",
      rationale: "Failed to parse model output.",
      companyHeadlines: [],
      marketHeadlines: [],
    };
  }

  const candidate = value as Record<string, unknown>;
  const pursueDecision = sanitizeText(String(candidate.pursueDecision ?? ""), 16).toUpperCase();
  const shortTermBias = sanitizeText(String(candidate.shortTermBias ?? ""), 16).toUpperCase();
  const longTermBias = sanitizeText(String(candidate.longTermBias ?? ""), 16).toUpperCase();
  const confidenceRaw = typeof candidate.confidence === "number" ? candidate.confidence : Number(candidate.confidence ?? 0);
  const companyHeadlines = Array.isArray(candidate.companyHeadlines)
    ? candidate.companyHeadlines.map(sanitizeHeadline).filter((item): item is WatchlistContractHeadline => Boolean(item)).slice(0, 6)
    : [];
  const marketHeadlines = Array.isArray(candidate.marketHeadlines)
    ? candidate.marketHeadlines.map(sanitizeHeadline).filter((item): item is WatchlistContractHeadline => Boolean(item)).slice(0, 6)
    : [];

  return {
    contractSymbol: sanitizeText(String(candidate.contractSymbol ?? entry.symbol), 40).toUpperCase() || entry.symbol,
    underlyingSymbol: sanitizeText(String(candidate.underlyingSymbol ?? entry.underlyingSymbol), 16).toUpperCase() || entry.underlyingSymbol,
    pursueDecision: isPursueDecision(pursueDecision) ? (pursueDecision as WatchlistContractGptResult["pursueDecision"]) : "MONITOR",
    shortTermBias: isBias(shortTermBias) ? (shortTermBias as WatchlistContractGptResult["shortTermBias"]) : "MIXED",
    longTermBias: isBias(longTermBias) ? (longTermBias as WatchlistContractGptResult["longTermBias"]) : "MIXED",
    confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0,
    contractJudgment: sanitizeText(String(candidate.contractJudgment ?? ""), 260) || "No contract judgment returned.",
    thesisSummary: sanitizeText(String(candidate.thesisSummary ?? ""), 1800) || "No thesis summary returned.",
    positiveCatalysts: sanitizeArray(Array.isArray(candidate.positiveCatalysts) ? candidate.positiveCatalysts.map(String) : []),
    negativeCatalysts: sanitizeArray(Array.isArray(candidate.negativeCatalysts) ? candidate.negativeCatalysts.map(String) : []),
    insiderTake: sanitizeText(String(candidate.insiderTake ?? ""), 700) || "No insider take returned.",
    geopoliticalTake: sanitizeText(String(candidate.geopoliticalTake ?? ""), 700) || "No geopolitical take returned.",
    actionPlan: sanitizeText(String(candidate.actionPlan ?? ""), 900) || "No action plan returned.",
    rationale: sanitizeText(String(candidate.rationale ?? ""), 1800) || "No rationale returned.",
    companyHeadlines,
    marketHeadlines,
  };
}

async function buildContext(entry: ContractWatchlistEntry): Promise<WatchlistContractContext> {
  const metadata = getTickerMetadata(entry.underlyingSymbol);

  if (!metadata) {
    throw new Error(`Unknown watchlist underlying: ${entry.underlyingSymbol}`);
  }

  const detail = await buildScreenerDetail(entry.underlyingSymbol);
  const allCurrentContracts = [...detail.optionContracts.suggested, ...detail.optionContracts.fastLane];
  const currentContract = allCurrentContracts.find((contract) => contract.symbol === entry.symbol) ?? null;

  const [companyHeadlines, marketHeadlines, insiderResult] = await Promise.all([
    fetchGoogleNewsHeadlines(`"${metadata.symbol}" OR "${metadata.name}"`, 6).catch(() => []),
    fetchGoogleNewsHeadlines(marketCatalystQuery(entry, {
      symbol: metadata.symbol,
      name: metadata.name,
      section: metadata.section,
      segment: metadata.segment,
      tier: metadata.tier,
      benchmarkLinks: metadata.benchmarkLinks,
      tags: metadata.tags,
    }), 6).catch(() => []),
    fetchOpenInsiderTrades({
      symbol: metadata.symbol,
      side: "all",
      count: 50,
    }).catch(() => null),
  ]);

  const insiderAnalysis = insiderResult ? analyzeOpenInsiderTrades(insiderResult.trades) : null;
  const tickerResearch = insiderAnalysis?.tickerResearchSummaries.find((item) => item.ticker === metadata.symbol) ?? null;

  return {
    entry,
    metadata: {
      symbol: metadata.symbol,
      name: metadata.name,
      section: metadata.section,
      segment: metadata.segment,
      tier: metadata.tier,
      benchmarkLinks: metadata.benchmarkLinks,
      tags: metadata.tags,
    },
    currentContractState: {
      inCurrentSuggestions: Boolean(currentContract),
      currentLane: currentContract
        ? detail.optionContracts.fastLane.some((contract) => contract.symbol === currentContract.symbol)
          ? "fast_lane"
          : "suggested"
        : "not_ranked",
      currentScore: currentContract?.score ?? null,
      currentStructure: currentContract?.structure ?? null,
      currentThesisFit: currentContract?.thesisFit ?? null,
    },
    screenerSnapshot: pickSnapshotFields(detail.snapshot),
    screenerInsights: detail.insights.map((insight) => ({
      title: insight.title,
      summary: insight.summary,
      bullets: insight.bullets.slice(0, 4),
    })),
    companyHeadlines,
    marketHeadlines,
    insiderContext: tickerResearch
      ? {
          available: true,
          summary: tickerResearch.analysisSummary,
          topDrivers: [
            `Bias: ${tickerResearch.activityBias}`,
            `Accumulation score: ${tickerResearch.accumulationScore.toFixed(1)}`,
            `Distribution score: ${tickerResearch.distributionScore.toFixed(1)}`,
            `Cluster score: ${tickerResearch.clusterScore.toFixed(1)}`,
            `Notable insiders: ${tickerResearch.notableInsiders.join(", ") || "none"}`,
          ],
        }
      : {
          available: false,
          summary: "No recent OpenInsider context was available for this symbol.",
          topDrivers: [],
        },
  };
}

export async function analyzeWatchlistContract(
  entry: ContractWatchlistEntry,
): Promise<{ model: string; result: WatchlistContractGptResult }> {
  const config = getOpenAIConfig();
  const client = new OpenAI({ apiKey: config.apiKey });
  const context = await buildContext(entry);
  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [
      {
        role: "user",
        content: buildPrompt(context),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "watchlist_contract_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            contractSymbol: { type: "string" },
            underlyingSymbol: { type: "string" },
            pursueDecision: { type: "string", enum: ["PURSUE", "MONITOR", "AVOID"] },
            shortTermBias: { type: "string", enum: ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"] },
            longTermBias: { type: "string", enum: ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"] },
            confidence: { type: "number" },
            contractJudgment: { type: "string" },
            thesisSummary: { type: "string" },
            positiveCatalysts: { type: "array", items: { type: "string" } },
            negativeCatalysts: { type: "array", items: { type: "string" } },
            insiderTake: { type: "string" },
            geopoliticalTake: { type: "string" },
            actionPlan: { type: "string" },
            rationale: { type: "string" },
            companyHeadlines: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  source: { type: "string" },
                  publishedAt: { type: "string" },
                  url: { type: "string" },
                },
                required: ["title", "source", "publishedAt", "url"],
              },
            },
            marketHeadlines: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  source: { type: "string" },
                  publishedAt: { type: "string" },
                  url: { type: "string" },
                },
                required: ["title", "source", "publishedAt", "url"],
              },
            },
          },
          required: [
            "contractSymbol",
            "underlyingSymbol",
            "pursueDecision",
            "shortTermBias",
            "longTermBias",
            "confidence",
            "contractJudgment",
            "thesisSummary",
            "positiveCatalysts",
            "negativeCatalysts",
            "insiderTake",
            "geopoliticalTake",
            "actionPlan",
            "rationale",
            "companyHeadlines",
            "marketHeadlines",
          ],
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  let result = sanitizeResult(entry, null);

  if (content) {
    try {
      result = sanitizeResult(entry, JSON.parse(content));
    } catch {
      result = sanitizeResult(entry, null);
    }
  }

  return {
    model: config.model,
    result,
  };
}

export async function analyzeWatchlistContracts(entries: ContractWatchlistEntry[]): Promise<WatchlistContractGptResponse> {
  const config = getOpenAIConfig();
  const results: WatchlistContractGptResult[] = [];

  for (const entry of entries) {
    const analysis = await analyzeWatchlistContract(entry);
    results.push(analysis.result);
  }

  return {
    model: config.model,
    analyzedCount: results.length,
    results,
  };
}
