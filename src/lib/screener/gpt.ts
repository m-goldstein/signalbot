import { FeatureSnapshot } from "@/lib/features/types";
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

function buildPrompt(input: { symbol: string; name: string; segment: string; tier: string; snapshot: FeatureSnapshot }) {
  const { symbol, name, segment, tier, snapshot } = input;

  return `
You are a financial advisor with expertise in equity research, technical analysis, market structure, volatility, and macro context.
You will be given a daily feature snapshot for ticker ${symbol} (${name}).
The company segment is ${segment} and the internal liquidity tier is ${tier}.

Your task is to evaluate the stock's likely near-term direction and judge whether it is a credible options trading candidate.
Do NOT rely solely on one indicator. Instead, holistically consider:
- Trend state across 20, 50, and 200 day moving averages
- One month, three month, six month, and one year performance
- Distance from 52 week high and low
- Breakout or breakdown context versus the 20 day range
- ATR and realized volatility context
- Expected move proxies over 5 and 10 trading days
- Relative volume and dollar liquidity
- Directional conviction and whether the setup looks extended, compressed, trending, or mixed
- Whether premium buying looks sensible or whether vertical spreads are more appropriate
- Call-versus-put bias based on the technical state
- The fact that implied volatility, actual options chain liquidity, spreads, earnings timing, fundamentals, sector flows, and macro data are not provided here

If critical options-market, fundamental, or market data is missing, explicitly acknowledge those gaps and lower confidence accordingly.
Do not invent numbers or sources. Be balanced: strong technical structure with missing IV or chain data should still be presented as conditional.

Always output ONLY valid JSON with the following fields:
- "symbol": the ticker symbol
- "direction": "UP" | "DOWN" | "NEUTRAL" | "UNKNOWN"
- "confidence": a float between 0 and 1
- "optionsAction": "LONG_CALL" | "CALL_SPREAD" | "LONG_PUT" | "PUT_SPREAD" | "WATCHLIST" | "NO_TRADE"
- "optionsJudgment": one short sentence describing the options expression judgment
- "rationale": a concise explanation (<= 170 words)

Daily feature snapshot (JSON):
${JSON.stringify(snapshot, null, 2)}
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

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [
      {
        role: "user",
        content: buildPrompt({
          symbol: row.symbol,
          name: row.name,
          segment: row.segment,
          tier: row.tier,
          snapshot,
        }),
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
