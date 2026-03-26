import OpenAI from "openai";
import { getOpenAIConfig } from "@/lib/openai/config";
import { fetchGoogleNewsHeadlines } from "@/lib/news/google-news";
import { analyzeOpenInsiderTrades } from "@/lib/openinsider/analysis";
import { fetchOpenInsiderTrades } from "@/lib/openinsider/scraper";
import { buildScreenerDetail } from "@/lib/screener/detail";
import { getTickerMetadata } from "@/lib/universe/service";
import {
  AnalysisCitationSource,
  AnalysisUnverifiedContext,
  AnalysisVerifiedFinding,
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
  sourceCatalog: AnalysisCitationSource[];
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

function buildSourceCatalog(companyHeadlines: WatchlistContractHeadline[], marketHeadlines: WatchlistContractHeadline[]) {
  return [...companyHeadlines, ...marketHeadlines].slice(0, 12).map((headline, index) => ({
    id: index + 1,
    title: sanitizeText(headline.title, 240),
    source: sanitizeText(headline.source, 120) || "Unknown",
    publishedAt: sanitizeText(headline.publishedAt, 120),
    url: sanitizeText(headline.url, 600),
    scope: index < companyHeadlines.length ? "company" : "market",
  }));
}

function buildPrompt(context: WatchlistContractContext) {
  return `
You are a financial analyst evaluating a real-money options decision.
You are evaluating whether a specific watchlisted options contract is worth pursuing.

Your job is not to cheerlead. Your job is to judge whether the contract should be pursued, merely monitored, or avoided.

Use only the packet below.
- Treat packet facts and numbered sources as the only citable evidence.
- Do not invent facts, catalysts, dates, sources, numerical values, earnings timing, implied volatility, IV term structure, or option-chain history that are not explicitly present in the packet.
- If you recall potentially relevant background knowledge that is not explicitly supported by the packet, you may mention it only in "unverifiedModelContext". Never present it as a citation.
- If a catalyst date, earnings date, or event timing is not explicitly supported by the packet, treat it as unknown and emit a warning.
- Prefer MONITOR or AVOID when missing IV, event timing, or liquidity context materially limits confidence.

When evaluating the contract, consider all of the following packet inputs:
- The underlying stock's current technical and volatility state from the screener snapshot
- Whether the contract's expiration, strike, break-even, spread, and volume make sense for the likely move
- Whether the contract still appears aligned with the screener's current options bias and structure bias
- Explicit numbered source items from the packet, if any, for recent news
- Recent public insider trading activity from the packet
- The fact that this packet may not include full options-chain history, full implied-volatility history, exact earnings timing, or all fundamental data

Citation rules:
- Use citation numbers only in "verifiedFindings", and only for source IDs from the packet's sourceCatalog.
- Do not cite "general knowledge", recollection, or synthesis from memory.
- Internal packet fields like spread, strike, daysToExpiration, and screener metrics may inform your analysis without citation numbers.

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
- "warnings": array of warning codes or short warning strings; include explicit unknowns such as UNKNOWN_EARNINGS_DATE, UNKNOWN_IV_TERM_STRUCTURE, NO_VERIFIED_CATALYST_SOURCE, or INCOMPLETE_OPTIONS_LIQUIDITY when applicable
- "verifiedFindings": array of objects with:
  - "claim": short source-backed claim
  - "citations": array of sourceCatalog IDs supporting that claim
- "unverifiedModelContext": array of objects with:
  - "claim": short statement derived from model recollection or synthesis not explicitly source-backed in the packet
  - "confidence": "LOW" | "MEDIUM" | "HIGH"
  - "reason": short explanation of why it is unverified
- "sources": array of the sourceCatalog entries actually relied on, each with "id", "title", "source", "publishedAt", "url", "scope"
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

function sanitizeVerifiedFinding(item: unknown): AnalysisVerifiedFinding | null {
  if (!item || typeof item !== "object") {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const claim = sanitizeText(String(candidate.claim ?? ""), 320);
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
  const claim = sanitizeText(String(candidate.claim ?? ""), 320);
  const confidence = sanitizeText(String(candidate.confidence ?? ""), 16).toUpperCase();
  const reason = sanitizeText(String(candidate.reason ?? ""), 240);

  if (!claim || !reason || (confidence !== "LOW" && confidence !== "MEDIUM" && confidence !== "HIGH")) {
    return null;
  }

  return {
    claim,
    confidence: confidence as AnalysisUnverifiedContext["confidence"],
    reason,
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
      warnings: ["MODEL_OUTPUT_PARSE_FAILURE"],
      verifiedFindings: [],
      unverifiedModelContext: [],
      sources: [],
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
  const warnings = sanitizeArray(Array.isArray(candidate.warnings) ? candidate.warnings.map(String) : [], 12, 120);
  const verifiedFindings = Array.isArray(candidate.verifiedFindings)
    ? candidate.verifiedFindings
        .map(sanitizeVerifiedFinding)
        .filter((item): item is AnalysisVerifiedFinding => Boolean(item))
        .slice(0, 8)
    : [];
  const unverifiedModelContext = Array.isArray(candidate.unverifiedModelContext)
    ? candidate.unverifiedModelContext
        .map(sanitizeUnverifiedContext)
        .filter((item): item is AnalysisUnverifiedContext => Boolean(item))
        .slice(0, 8)
    : [];
  const sources = Array.isArray(candidate.sources)
    ? candidate.sources
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const source = item as Record<string, unknown>;
          const id = Number(source.id);
          const title = sanitizeText(String(source.title ?? ""), 240);

          if (!Number.isInteger(id) || id <= 0 || !title) {
            return null;
          }

          return {
            id,
            title,
            source: sanitizeText(String(source.source ?? ""), 120) || "Unknown",
            publishedAt: sanitizeText(String(source.publishedAt ?? ""), 120),
            url: sanitizeText(String(source.url ?? ""), 600),
            scope: sanitizeText(String(source.scope ?? ""), 32),
          };
        })
        .filter((item): item is AnalysisCitationSource => Boolean(item))
        .slice(0, 12)
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
    warnings,
    verifiedFindings,
    unverifiedModelContext,
    sources,
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
  const sourceCatalog = buildSourceCatalog(companyHeadlines, marketHeadlines);

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
    sourceCatalog,
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
            warnings: { type: "array", items: { type: "string" } },
            verifiedFindings: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  claim: { type: "string" },
                  citations: { type: "array", items: { type: "integer" } },
                },
                required: ["claim", "citations"],
              },
            },
            unverifiedModelContext: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  claim: { type: "string" },
                  confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
                  reason: { type: "string" },
                },
                required: ["claim", "confidence", "reason"],
              },
            },
            sources: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "integer" },
                  title: { type: "string" },
                  source: { type: "string" },
                  publishedAt: { type: "string" },
                  url: { type: "string" },
                  scope: { type: "string" },
                },
                required: ["id", "title", "source", "publishedAt", "url", "scope"],
              },
            },
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
            "warnings",
            "verifiedFindings",
            "unverifiedModelContext",
            "sources",
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
