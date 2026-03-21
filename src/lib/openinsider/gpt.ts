import OpenAI from "openai";
import { getOpenAIConfig } from "@/lib/openai/config";
import {
  OpenInsiderTrade,
  TickerResearchSummary,
  TickerValueSummary,
} from "@/lib/openinsider/types";

export type InsiderGptResult = {
  symbol: string;
  direction: "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
  insiderSignal: "ACCUMULATION" | "DISTRIBUTION" | "MIXED" | "INCONCLUSIVE";
  quality: "HIGH" | "MEDIUM" | "LOW";
  confidence: number;
  researchSummary: string;
  keyDrivers: string[];
  riskFlags: string[];
  rationale: string;
};

type TradePromptRow = {
  date: string;
  ticker: string;
  insider: string;
  relationship: string;
  transactionType: string;
  shares: number;
  averagePrice: number;
  value: number;
  totalOwned: number;
};

function buildPrompt(input: {
  symbol: string;
  summary: TickerValueSummary;
  research: TickerResearchSummary | null;
  trades: TradePromptRow[];
}) {
  return `
You are producing rigorous internal trading research focused on insider activity.
You will be given a ticker-level insider activity briefing for ${input.symbol}.

Your job is to assess the insider tape itself, not to hallucinate missing fundamentals.
Use the provided statistics and raw trade rows to judge:
- whether the tape reflects accumulation, distribution, or mixed behavior
- whether the activity is broad or concentrated
- whether the trade cluster looks meaningful or noisy
- whether executive/C-level activity is more important than director-level activity
- whether buys and sells are one-sided or conflicted
- whether the largest trades dominate the signal
- whether the activity quality is high enough to matter for research follow-up

You may mention missing context such as earnings, valuation, price trend, lockups, option exercises, or planned sales, but do not invent those facts.
If the insider tape is inconclusive, say so.

Always output ONLY valid JSON with:
- "symbol": ticker
- "direction": "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN"
- "insiderSignal": "ACCUMULATION" | "DISTRIBUTION" | "MIXED" | "INCONCLUSIVE"
- "quality": "HIGH" | "MEDIUM" | "LOW"
- "confidence": float between 0 and 1
- "researchSummary": one concise sentence summarizing the tape
- "keyDrivers": array of 2 to 4 short strings
- "riskFlags": array of 1 to 4 short strings
- "rationale": concise explanation <= 220 words

Ticker summary (JSON):
${JSON.stringify(input.summary, null, 2)}

Ticker research summary (JSON):
${JSON.stringify(input.research, null, 2)}

Raw trades (JSON):
${JSON.stringify(input.trades, null, 2)}
`.trim();
}

function normalizeTrades(trades: OpenInsiderTrade[]): TradePromptRow[] {
  return trades.map((trade) => ({
    date: trade.date,
    ticker: trade.ticker,
    insider: trade.insider,
    relationship: trade.relationship,
    transactionType: trade.transactionType,
    shares: trade.shares,
    averagePrice: trade.averagePrice,
    value: trade.value,
    totalOwned: trade.totalOwned,
  }));
}

function sanitizeResult(symbol: string, value: unknown): InsiderGptResult {
  if (!value || typeof value !== "object") {
    return {
      symbol,
      direction: "UNKNOWN",
      insiderSignal: "INCONCLUSIVE",
      quality: "LOW",
      confidence: 0,
      researchSummary: "Failed to parse model response.",
      keyDrivers: ["Model output was not parseable."],
      riskFlags: ["Model output was not parseable."],
      rationale: "Failed to parse model response.",
    };
  }

  const candidate = value as Partial<InsiderGptResult>;
  const direction =
    candidate.direction === "UP" ||
    candidate.direction === "DOWN" ||
    candidate.direction === "NEUTRAL" ||
    candidate.direction === "UNKNOWN"
      ? candidate.direction
      : "UNKNOWN";
  const insiderSignal =
    candidate.insiderSignal === "ACCUMULATION" ||
    candidate.insiderSignal === "DISTRIBUTION" ||
    candidate.insiderSignal === "MIXED" ||
    candidate.insiderSignal === "INCONCLUSIVE"
      ? candidate.insiderSignal
      : "INCONCLUSIVE";
  const quality =
    candidate.quality === "HIGH" || candidate.quality === "MEDIUM" || candidate.quality === "LOW"
      ? candidate.quality
      : "LOW";

  return {
    symbol: String(candidate.symbol || symbol).toUpperCase(),
    direction,
    insiderSignal,
    quality,
    confidence: typeof candidate.confidence === "number" ? Math.max(0, Math.min(1, candidate.confidence)) : 0,
    researchSummary:
      typeof candidate.researchSummary === "string" && candidate.researchSummary.trim()
        ? candidate.researchSummary.trim()
        : "No research summary returned.",
    keyDrivers:
      Array.isArray(candidate.keyDrivers) && candidate.keyDrivers.every((item) => typeof item === "string")
        ? candidate.keyDrivers.slice(0, 4)
        : ["No key drivers returned."],
    riskFlags:
      Array.isArray(candidate.riskFlags) && candidate.riskFlags.every((item) => typeof item === "string")
        ? candidate.riskFlags.slice(0, 4)
        : ["No risk flags returned."],
    rationale:
      typeof candidate.rationale === "string" && candidate.rationale.trim()
        ? candidate.rationale.trim()
        : "No rationale returned.",
  };
}

export async function analyzeTickerWithOpenAI(
  symbol: string,
  trades: OpenInsiderTrade[],
  summary: TickerValueSummary,
  research: TickerResearchSummary | null,
) {
  const config = getOpenAIConfig();
  const client = new OpenAI({ apiKey: config.apiKey });
  const prompt = buildPrompt({
    symbol,
    summary,
    research,
    trades: normalizeTrades(trades),
  });

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "insider_trade_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            symbol: { type: "string" },
            direction: { type: "string", enum: ["UP", "DOWN", "NEUTRAL", "UNKNOWN"] },
            insiderSignal: { type: "string", enum: ["ACCUMULATION", "DISTRIBUTION", "MIXED", "INCONCLUSIVE"] },
            quality: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            confidence: { type: "number" },
            researchSummary: { type: "string" },
            keyDrivers: { type: "array", items: { type: "string" } },
            riskFlags: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
          },
          required: [
            "symbol",
            "direction",
            "insiderSignal",
            "quality",
            "confidence",
            "researchSummary",
            "keyDrivers",
            "riskFlags",
            "rationale",
          ],
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    return sanitizeResult(symbol, null);
  }

  try {
    return sanitizeResult(symbol, JSON.parse(content));
  } catch {
    return sanitizeResult(symbol, null);
  }
}

export async function analyzeTopTickersWithOpenAI(input: {
  trades: OpenInsiderTrade[];
  tickerSummaries: TickerValueSummary[];
  tickerResearchSummaries: TickerResearchSummary[];
  limit: number;
}) {
  const topSymbols = input.tickerSummaries.slice(0, input.limit).map((entry) => entry.ticker);
  const summaryMap = new Map(input.tickerSummaries.map((entry) => [entry.ticker, entry]));
  const researchMap = new Map(input.tickerResearchSummaries.map((entry) => [entry.ticker, entry]));
  const results: InsiderGptResult[] = [];

  for (const symbol of topSymbols) {
    const symbolTrades = input.trades.filter((trade) => trade.ticker === symbol);
    const summary = summaryMap.get(symbol);

    if (!symbolTrades.length || !summary) {
      results.push({
        symbol,
        direction: "UNKNOWN",
        insiderSignal: "INCONCLUSIVE",
        quality: "LOW",
        confidence: 0,
        researchSummary: "No trades found for this symbol in the current query.",
        keyDrivers: ["No trades found for this symbol in the current query."],
        riskFlags: ["No current-query trade data was available."],
        rationale: "No trades found for this symbol in the current query.",
      });
      continue;
    }

    const result = await analyzeTickerWithOpenAI(
      symbol,
      symbolTrades,
      summary,
      researchMap.get(symbol) ?? null,
    );
    results.push(result);
  }

  return results;
}
