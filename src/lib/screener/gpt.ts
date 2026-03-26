import { FeatureSnapshot } from "@/lib/features/types";
import { createMarketDataProvider } from "@/lib/market-data";
import { OptionContractSnapshot } from "@/lib/market-data/types";
import { getOpenAIConfig } from "@/lib/openai/config";
import { ScreenerAnalysisEntry } from "@/lib/screener/types";
import OpenAI from "openai";

export type ScreenerGptResult = {
  symbol: string;
  direction: "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN";
  confidence: number;
  optionsAction: "LONG_CALL" | "CALL_SPREAD" | "LONG_PUT" | "PUT_SPREAD" | "WATCHLIST" | "NO_TRADE";
  optionsJudgment: string;
  rationale: string;
};

type ScreenerPromptPacket = {
  symbol: string;
  name: string;
  segment: string;
  tier: string;
  snapshot: FeatureSnapshot;
  optionsMarketContext: {
    quoteDataAvailable: boolean;
    warnings: string[];
    liquiditySummary: {
      totalContracts: number;
      quotedContracts: number;
      contractsWithVolume: number;
      medianBidAskSpreadPercent: number | null;
      tightSpreadSharePercent: number | null;
      medianDailyVolume: number | null;
    } | null;
    alignedContracts: Array<{
      symbol: string;
      optionType: "call" | "put";
      expirationDate: string;
      daysToExpiration: number;
      strikePrice: number;
      bid: number;
      ask: number;
      mark: number;
      dailyVolume: number;
      bidSize: number;
      askSize: number;
      bidAskSpreadPercent: number;
    }>;
  };
};

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function median(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function buildOptionsMarketContext(snapshot: FeatureSnapshot, contracts: OptionContractSnapshot[]): ScreenerPromptPacket["optionsMarketContext"] {
  const warnings = [
    "WARNING: Implied volatility data is not present in this packet. Do not claim IV level, IV rank, or IV percentile.",
    "WARNING: IV skew and term structure data are not present in this packet. Do not claim front-month versus back-month IV relationships.",
    "WARNING: Earnings timing is not present in this packet. Do not claim whether earnings are near, far, before expiration, or after expiration.",
  ];

  if (!contracts.length) {
    warnings.push(
      "WARNING: No live option quote snapshot was retrieved for this symbol. Spread and liquidity checks could not be performed.",
    );

    return {
      quoteDataAvailable: false,
      warnings,
      liquiditySummary: null,
      alignedContracts: [],
    };
  }

  const quotedContracts = contracts.filter((contract) => contract.ask > 0 && contract.bid >= 0);
  const contractsWithVolume = contracts.filter((contract) => contract.dailyVolume > 0);
  const spreadPercents = quotedContracts
    .map((contract) => contract.bidAskSpreadPercent)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const dailyVolumes = contracts.map((contract) => contract.dailyVolume).filter((value) => Number.isFinite(value) && value >= 0);
  const preferredOptionType =
    snapshot.optionsDirectionalBias === "call" || snapshot.optionsDirectionalBias === "put"
      ? snapshot.optionsDirectionalBias
      : null;

  const alignedContracts = quotedContracts
    .filter((contract) => contract.daysToExpiration >= 7 && contract.daysToExpiration <= 60)
    .sort((left, right) => {
      const leftTypePenalty = preferredOptionType && left.optionType !== preferredOptionType ? 1 : 0;
      const rightTypePenalty = preferredOptionType && right.optionType !== preferredOptionType ? 1 : 0;

      if (leftTypePenalty !== rightTypePenalty) {
        return leftTypePenalty - rightTypePenalty;
      }

      if (left.bidAskSpreadPercent !== right.bidAskSpreadPercent) {
        return left.bidAskSpreadPercent - right.bidAskSpreadPercent;
      }

      if (left.dailyVolume !== right.dailyVolume) {
        return right.dailyVolume - left.dailyVolume;
      }

      const leftMoneyness = Math.abs(left.strikePrice - snapshot.close);
      const rightMoneyness = Math.abs(right.strikePrice - snapshot.close);

      if (leftMoneyness !== rightMoneyness) {
        return leftMoneyness - rightMoneyness;
      }

      return left.daysToExpiration - right.daysToExpiration;
    })
    .slice(0, 8)
    .map((contract) => ({
      symbol: contract.symbol,
      optionType: contract.optionType,
      expirationDate: contract.expirationDate,
      daysToExpiration: contract.daysToExpiration,
      strikePrice: round(contract.strikePrice, 2),
      bid: round(contract.bid, 2),
      ask: round(contract.ask, 2),
      mark: round(contract.mark, 2),
      dailyVolume: contract.dailyVolume,
      bidSize: contract.bidSize,
      askSize: contract.askSize,
      bidAskSpreadPercent: round(contract.bidAskSpreadPercent, 2),
    }));

  if (!alignedContracts.length) {
    warnings.push(
      "WARNING: Live option quotes were retrieved, but none passed the 7-60 DTE quoted-contract filter for the prompt packet.",
    );
  }

  return {
    quoteDataAvailable: true,
    warnings,
    liquiditySummary: {
      totalContracts: contracts.length,
      quotedContracts: quotedContracts.length,
      contractsWithVolume: contractsWithVolume.length,
      medianBidAskSpreadPercent: spreadPercents.length ? round(median(spreadPercents) ?? 0, 2) : null,
      tightSpreadSharePercent: spreadPercents.length
        ? round((spreadPercents.filter((value) => value <= 5).length / spreadPercents.length) * 100, 1)
        : null,
      medianDailyVolume: dailyVolumes.length ? round(median(dailyVolumes) ?? 0, 0) : null,
    },
    alignedContracts,
  };
}

function buildPrompt(packet: ScreenerPromptPacket) {
  const { symbol, name, segment, tier } = packet;

  return `
You are a financial analyst evaluating a real-money trading decision.
You will be given a daily feature snapshot for ticker ${symbol} (${name}).
The company segment is ${segment} and the internal liquidity tier is ${tier}.

Your task is to evaluate the stock's likely near-term direction and judge whether it is a credible options trading candidate without inventing any missing market facts.

Use ONLY the facts in the packet below.
- Treat absent data as unknown, not as bullish or bearish evidence.
- Do not use unstated world knowledge, assumed catalysts, assumed macro context, or assumed upcoming events.
- Do not infer implied volatility, IV term structure, IV skew, earnings timing, open interest, or fundamentals unless those facts are explicitly present in the packet.
- If the packet lacks a critical input, say so plainly and lower confidence.
- If spread/liquidity data looks weak or incomplete, reflect that in optionsAction and optionsJudgment.
- Prefer WATCHLIST or NO_TRADE over a directional options recommendation when key options-market inputs are missing or materially incomplete.

When evaluating, consider:
- Trend state across 20, 50, and 200 day moving averages
- One month, three month, six month, and one year performance
- Distance from 52 week high and low
- Breakout or breakdown context versus the 20 day range
- ATR, realized volatility, and expected-move proxies over 5 and 10 trading days
- Relative volume and dollar liquidity in the underlying
- Directional conviction and whether the setup looks extended, compressed, trending, or mixed
- The actual option quote fields in the packet, if present: bid, ask, mark, bid/ask spread percent, daily volume, bid size, ask size, expiration, strike, and days to expiration

Truthfulness requirements:
- Never claim an earnings date, IV level, IV percentile, IV term structure shape, skew, or liquidity condition unless it is explicitly supported by packet fields.
- Never make up numbers, dates, sources, or contract characteristics.
- If warnings are present in the packet, honor them explicitly.
- If there is not enough evidence for a confident options view, choose WATCHLIST or NO_TRADE.

Always output ONLY valid JSON with the following fields:
- "symbol": the ticker symbol
- "direction": "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN"
- "confidence": a float between 0 and 1
- "optionsAction": "LONG_CALL" | "CALL_SPREAD" | "LONG_PUT" | "PUT_SPREAD" | "WATCHLIST" | "NO_TRADE"
- "optionsJudgment": one short sentence describing the options expression judgment; if a critical data gap or liquidity problem exists, start with "WARNING:"
- "rationale": a concise explanation (<= 170 words) that names the most important supporting evidence and the biggest missing-data limitation

Analysis packet (JSON):
${JSON.stringify(packet, null, 2)}
`.trim();
}

function sanitizeResult(symbol: string, value: unknown): ScreenerGptResult {
  if (!value || typeof value !== "object") {
    return {
      symbol,
      direction: "UNKNOWN",
      confidence: 0,
      optionsAction: "NO_TRADE",
      optionsJudgment: "Unable to parse model output.",
      rationale: "Failed to parse model response.",
    };
  }

  const candidate = value as Partial<ScreenerGptResult>;
  const direction =
    candidate.direction === "UP" ||
    candidate.direction === "DOWN" ||
    candidate.direction === "NEUTRAL" ||
    candidate.direction === "UNKNOWN"
      ? candidate.direction
      : "UNKNOWN";

  const optionsAction =
    candidate.optionsAction === "LONG_CALL" ||
    candidate.optionsAction === "CALL_SPREAD" ||
    candidate.optionsAction === "LONG_PUT" ||
    candidate.optionsAction === "PUT_SPREAD" ||
    candidate.optionsAction === "WATCHLIST" ||
    candidate.optionsAction === "NO_TRADE"
      ? candidate.optionsAction
      : "NO_TRADE";

  return {
    symbol: String(candidate.symbol || symbol).toUpperCase(),
    direction,
    confidence: typeof candidate.confidence === "number" ? Math.max(0, Math.min(1, candidate.confidence)) : 0,
    optionsAction,
    optionsJudgment:
      typeof candidate.optionsJudgment === "string" && candidate.optionsJudgment.trim()
        ? candidate.optionsJudgment.trim()
        : "No options judgment returned.",
    rationale:
      typeof candidate.rationale === "string" && candidate.rationale.trim()
        ? candidate.rationale.trim()
        : "No rationale returned.",
  };
}

export async function analyzeScreenerSnapshot(input: {
  row: ScreenerAnalysisEntry;
  snapshot: FeatureSnapshot | null;
}) {
  const config = getOpenAIConfig();
  const client = new OpenAI({ apiKey: config.apiKey });
  const marketDataProvider = createMarketDataProvider();
  const { row, snapshot } = input;

  if (!snapshot) {
    return {
      model: config.model,
      result: {
        symbol: row.symbol,
        direction: "UNKNOWN",
        confidence: 0,
        optionsAction: "NO_TRADE",
        optionsJudgment: "No screener snapshot was available for this symbol.",
        rationale: "No screener snapshot was available for this symbol.",
      } satisfies ScreenerGptResult,
    };
  }

  let optionContracts: OptionContractSnapshot[] = [];

  try {
    const optionSnapshotResult = await marketDataProvider.getOptionSnapshots({
      underlyingSymbol: row.symbol,
      pageSize: 250,
      maxPages: 2,
    });
    optionContracts = optionSnapshotResult.snapshots;
  } catch {
    optionContracts = [];
  }

  const promptPacket: ScreenerPromptPacket = {
    symbol: row.symbol,
    name: row.name,
    segment: row.segment,
    tier: row.tier,
    snapshot,
    optionsMarketContext: buildOptionsMarketContext(snapshot, optionContracts),
  };

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [
      {
        role: "user",
        content: buildPrompt(promptPacket),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "screener_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            symbol: { type: "string" },
            direction: {
              type: "string",
              enum: ["UP", "DOWN", "NEUTRAL", "UNKNOWN"],
            },
            confidence: { type: "number" },
            optionsAction: {
              type: "string",
              enum: ["LONG_CALL", "CALL_SPREAD", "LONG_PUT", "PUT_SPREAD", "WATCHLIST", "NO_TRADE"],
            },
            optionsJudgment: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["symbol", "direction", "confidence", "optionsAction", "optionsJudgment", "rationale"],
        },
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  let result = sanitizeResult(row.symbol, null);

  if (content) {
    try {
      result = sanitizeResult(row.symbol, JSON.parse(content));
    } catch {
      result = sanitizeResult(row.symbol, null);
    }
  }

  return {
    model: config.model,
    result,
  };
}

export async function analyzeScreenerSnapshots(input: {
  rows: ScreenerAnalysisEntry[];
  snapshots: FeatureSnapshot[];
}) {
  const snapshotMap = new Map(input.snapshots.map((snapshot) => [snapshot.symbol, snapshot]));
  const results: ScreenerGptResult[] = [];
  let model = getOpenAIConfig().model;

  for (const row of input.rows) {
    const analysis = await analyzeScreenerSnapshot({
      row,
      snapshot: snapshotMap.get(row.symbol) ?? null,
    });
    model = analysis.model;
    results.push(analysis.result);
  }

  return {
    model,
    results,
  };
}
