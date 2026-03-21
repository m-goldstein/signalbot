"use client";

import { OpenInsiderGptResponse } from "@/lib/openinsider/types";
import { ScreenerGptResponse } from "@/lib/screener/types";
import { WatchlistContractGptResponse } from "@/lib/watchlist/types";
import { getActiveTradingDayKey } from "@/lib/client/market-session";

type CacheEnvelope<T> = {
  dayKey: string;
  queryKey: string;
  savedAt: string;
  payload: T;
};

function sanitizeText(value: unknown, maxLength = 4000) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizeNumber(value: unknown, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(min, Math.min(max, parsed));
}

function sanitizeStringArray(value: unknown, itemLimit = 12, itemLength = 280) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => sanitizeText(item, itemLength))
    .filter(Boolean)
    .slice(0, itemLimit);
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function createAnalysisQueryKey(parts: Array<string | number | boolean | null | undefined>) {
  return parts
    .map((part) => sanitizeText(String(part ?? ""), 200))
    .join("|");
}

function readEnvelope<T>(storageKey: string) {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

function writeEnvelope<T>(storageKey: string, queryKey: string, payload: T) {
  if (!canUseStorage()) {
    return;
  }

  const envelope: CacheEnvelope<T> = {
    dayKey: getActiveTradingDayKey(),
    queryKey,
    savedAt: new Date().toISOString(),
    payload,
  };

  window.localStorage.setItem(storageKey, JSON.stringify(envelope));
}

function isDirection(value: string) {
  return value === "UP" || value === "DOWN" || value === "NEUTRAL" || value === "UNKNOWN";
}

function isOptionsAction(value: string) {
  return (
    value === "LONG_CALL" ||
    value === "CALL_SPREAD" ||
    value === "LONG_PUT" ||
    value === "PUT_SPREAD" ||
    value === "WATCHLIST" ||
    value === "NO_TRADE"
  );
}

function isInsiderSignal(value: string) {
  return value === "ACCUMULATION" || value === "DISTRIBUTION" || value === "MIXED" || value === "INCONCLUSIVE";
}

function isQuality(value: string) {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW";
}

function isWatchlistDecision(value: string) {
  return value === "PURSUE" || value === "MONITOR" || value === "AVOID";
}

function isWatchlistBias(value: string) {
  return value === "BULLISH" || value === "BEARISH" || value === "NEUTRAL" || value === "MIXED";
}

export function sanitizeScreenerGptResponse(value: unknown): ScreenerGptResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { model?: unknown; topN?: unknown; results?: unknown };

  if (!Array.isArray(candidate.results)) {
    return null;
  }

  const results = candidate.results
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const item = entry as Record<string, unknown>;
      const symbol = sanitizeText(item.symbol, 16).toUpperCase();
      const direction = sanitizeText(item.direction, 16).toUpperCase();
      const optionsAction = sanitizeText(item.optionsAction, 24).toUpperCase();
      const confidence = sanitizeNumber(item.confidence, 0, 100);
      const optionsJudgment = sanitizeText(item.optionsJudgment, 1200);
      const rationale = sanitizeText(item.rationale, 2400);

      if (!symbol || !isDirection(direction) || !isOptionsAction(optionsAction) || confidence === null) {
        return null;
      }

      return {
        symbol,
        direction,
        confidence,
        optionsAction,
        optionsJudgment,
        rationale,
      } as ScreenerGptResponse["results"][number];
    })
    .filter((entry): entry is ScreenerGptResponse["results"][number] => Boolean(entry));

  if (!results.length) {
    return null;
  }

  const topN = sanitizeNumber(candidate.topN, 1, 100);

  return {
    model: sanitizeText(candidate.model, 120) || "unknown",
    topN: topN ?? results.length,
    results,
  };
}

export function sanitizeOpenInsiderGptResponse(value: unknown): OpenInsiderGptResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { model?: unknown; topN?: unknown; results?: unknown };

  if (!Array.isArray(candidate.results)) {
    return null;
  }

  const results = candidate.results
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const item = entry as Record<string, unknown>;
      const symbol = sanitizeText(item.symbol, 16).toUpperCase();
      const direction = sanitizeText(item.direction, 16).toUpperCase();
      const insiderSignal = sanitizeText(item.insiderSignal, 24).toUpperCase();
      const quality = sanitizeText(item.quality, 16).toUpperCase();
      const confidence = sanitizeNumber(item.confidence, 0, 100);

      if (!symbol || !isDirection(direction) || !isInsiderSignal(insiderSignal) || !isQuality(quality) || confidence === null) {
        return null;
      }

      return {
        symbol,
        direction,
        insiderSignal,
        quality,
        confidence,
        researchSummary: sanitizeText(item.researchSummary, 1600),
        keyDrivers: sanitizeStringArray(item.keyDrivers),
        riskFlags: sanitizeStringArray(item.riskFlags),
        rationale: sanitizeText(item.rationale, 2400),
      } as OpenInsiderGptResponse["results"][number];
    })
    .filter((entry): entry is OpenInsiderGptResponse["results"][number] => Boolean(entry));

  if (!results.length) {
    return null;
  }

  const topN = sanitizeNumber(candidate.topN, 1, 100);

  return {
    model: sanitizeText(candidate.model, 120) || "unknown",
    topN: topN ?? results.length,
    results,
  };
}

export function sanitizeWatchlistContractGptResponse(value: unknown): WatchlistContractGptResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { model?: unknown; analyzedCount?: unknown; results?: unknown };

  if (!Array.isArray(candidate.results)) {
    return null;
  }

  const results = candidate.results
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const item = entry as Record<string, unknown>;
      const contractSymbol = sanitizeText(item.contractSymbol, 48).toUpperCase();
      const underlyingSymbol = sanitizeText(item.underlyingSymbol, 16).toUpperCase();
      const pursueDecision = sanitizeText(item.pursueDecision, 16).toUpperCase();
      const shortTermBias = sanitizeText(item.shortTermBias, 16).toUpperCase();
      const longTermBias = sanitizeText(item.longTermBias, 16).toUpperCase();
      const confidence = sanitizeNumber(item.confidence, 0, 1);

      if (
        !contractSymbol ||
        !underlyingSymbol ||
        !isWatchlistDecision(pursueDecision) ||
        !isWatchlistBias(shortTermBias) ||
        !isWatchlistBias(longTermBias) ||
        confidence === null
      ) {
        return null;
      }

      const sanitizeHeadlines = (value: unknown) =>
        Array.isArray(value)
          ? value
              .map((headline) => {
                if (!headline || typeof headline !== "object") {
                  return null;
                }

                const candidateHeadline = headline as Record<string, unknown>;
                const title = sanitizeText(candidateHeadline.title, 240);

                if (!title) {
                  return null;
                }

                return {
                  title,
                  source: sanitizeText(candidateHeadline.source, 120) || "Unknown",
                  publishedAt: sanitizeText(candidateHeadline.publishedAt, 120),
                  url: sanitizeText(candidateHeadline.url, 600),
                };
              })
              .filter(Boolean)
              .slice(0, 6)
          : [];

      return {
        contractSymbol,
        underlyingSymbol,
        pursueDecision,
        shortTermBias,
        longTermBias,
        confidence,
        contractJudgment: sanitizeText(item.contractJudgment, 600),
        thesisSummary: sanitizeText(item.thesisSummary, 2400),
        positiveCatalysts: sanitizeStringArray(item.positiveCatalysts),
        negativeCatalysts: sanitizeStringArray(item.negativeCatalysts),
        insiderTake: sanitizeText(item.insiderTake, 1200),
        geopoliticalTake: sanitizeText(item.geopoliticalTake, 1200),
        actionPlan: sanitizeText(item.actionPlan, 1400),
        rationale: sanitizeText(item.rationale, 2400),
        companyHeadlines: sanitizeHeadlines(item.companyHeadlines),
        marketHeadlines: sanitizeHeadlines(item.marketHeadlines),
      } as WatchlistContractGptResponse["results"][number];
    })
    .filter((entry): entry is WatchlistContractGptResponse["results"][number] => Boolean(entry));

  if (!results.length) {
    return null;
  }

  const analyzedCount = sanitizeNumber(candidate.analyzedCount, 1, 100);

  return {
    model: sanitizeText(candidate.model, 120) || "unknown",
    analyzedCount: analyzedCount ?? results.length,
    results,
  };
}

export function readCachedScreenerAnalysis(storageKey: string, queryKey: string) {
  const envelope = readEnvelope<ScreenerGptResponse>(storageKey);

  if (!envelope || envelope.dayKey !== getActiveTradingDayKey() || envelope.queryKey !== queryKey) {
    return null;
  }

  return sanitizeScreenerGptResponse(envelope.payload);
}

export function writeCachedScreenerAnalysis(storageKey: string, queryKey: string, payload: ScreenerGptResponse) {
  const sanitized = sanitizeScreenerGptResponse(payload);

  if (!sanitized) {
    return;
  }

  writeEnvelope(storageKey, queryKey, sanitized);
}

export function readCachedOpenInsiderAnalysis(storageKey: string, queryKey: string) {
  const envelope = readEnvelope<OpenInsiderGptResponse>(storageKey);

  if (!envelope || envelope.dayKey !== getActiveTradingDayKey() || envelope.queryKey !== queryKey) {
    return null;
  }

  return sanitizeOpenInsiderGptResponse(envelope.payload);
}

export function writeCachedOpenInsiderAnalysis(storageKey: string, queryKey: string, payload: OpenInsiderGptResponse) {
  const sanitized = sanitizeOpenInsiderGptResponse(payload);

  if (!sanitized) {
    return;
  }

  writeEnvelope(storageKey, queryKey, sanitized);
}

export function readCachedWatchlistContractAnalysis(storageKey: string, queryKey: string) {
  const envelope = readEnvelope<WatchlistContractGptResponse>(storageKey);

  if (!envelope || envelope.dayKey !== getActiveTradingDayKey() || envelope.queryKey !== queryKey) {
    return null;
  }

  return sanitizeWatchlistContractGptResponse(envelope.payload);
}

export function writeCachedWatchlistContractAnalysis(
  storageKey: string,
  queryKey: string,
  payload: WatchlistContractGptResponse,
) {
  const sanitized = sanitizeWatchlistContractGptResponse(payload);

  if (!sanitized) {
    return;
  }

  writeEnvelope(storageKey, queryKey, sanitized);
}
