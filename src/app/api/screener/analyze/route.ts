import { hasOpenAIConfig } from "@/lib/openai/config";
import { submitScreenerAnalysisJobs } from "@/lib/screener/store";
import { ScreenerAnalysisEntry } from "@/lib/screener/types";
import { UniverseTier } from "@/lib/universe/types";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function sanitizeText(value: unknown, maxLength = 80) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function parseTier(value: unknown): UniverseTier | null {
  const tier = sanitizeText(value, 16);
  return tier === "tier1" || tier === "tier2" || tier === "tier3" ? tier : null;
}

function parseEntry(value: unknown): ScreenerAnalysisEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const symbol = sanitizeText(item.symbol, 16).toUpperCase();
  const name = sanitizeText(item.name, 120);
  const segment = sanitizeText(item.segment, 40);
  const tier = parseTier(item.tier);

  if (!symbol || !name || !segment || !tier) {
    return null;
  }

  return {
    symbol,
    name,
    segment,
    tier,
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!hasOpenAIConfig()) {
      return NextResponse.json({ error: "OpenAI credentials are not configured." }, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as { entries?: unknown };
    const rawEntries: unknown[] = Array.isArray(body.entries) ? body.entries : [];
    const entries = rawEntries.map(parseEntry).filter((entry): entry is ScreenerAnalysisEntry => Boolean(entry));

    if (!entries.length) {
      return NextResponse.json({ error: "No valid screener rows were provided." }, { status: 400 });
    }

    const uniqueEntries = Array.from(new Map(entries.map((entry) => [entry.symbol, entry])).values()).slice(0, 20);
    const jobs = await submitScreenerAnalysisJobs(uniqueEntries);

    return NextResponse.json({
      queuedCount: jobs.filter((job) => job.status === "queued").length,
      jobs: jobs.map((job) => ({
        id: job.id,
        symbol: job.symbol,
        status: job.status,
        requestedAt: job.requestedAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected screener analysis submission error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
