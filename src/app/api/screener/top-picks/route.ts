import { hasOpenAIConfig } from "@/lib/openai/config";
import { analyzeTopPicks } from "@/lib/screener/top-picks-gpt";
import { ScreenerRow } from "@/lib/screener/types";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isValidSection(value: unknown): value is "tech" | "leaders" | "defense" {
  return value === "tech" || value === "leaders" || value === "defense";
}

function parseRow(value: unknown): ScreenerRow | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;

  if (
    typeof item.symbol !== "string" ||
    typeof item.name !== "string" ||
    typeof item.close !== "number" ||
    !isValidSection(item.section)
  ) {
    return null;
  }

  return item as unknown as ScreenerRow;
}

export async function POST(request: NextRequest) {
  try {
    if (!hasOpenAIConfig()) {
      return NextResponse.json(
        { error: "OpenAI credentials are not configured." },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      rows?: unknown;
      asOf?: unknown;
    };

    const rawRows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
    const rows = rawRows
      .map(parseRow)
      .filter((row): row is ScreenerRow => row !== null);

    if (!rows.length) {
      return NextResponse.json(
        { error: "No valid screener rows provided." },
        { status: 400 },
      );
    }

    const asOf =
      typeof body.asOf === "string" && body.asOf.trim()
        ? body.asOf.trim().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    const result = await analyzeTopPicks({ rows, asOf });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected top picks analysis error.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
