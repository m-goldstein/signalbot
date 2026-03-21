import { load } from "cheerio";
import { WatchlistContractHeadline } from "@/lib/watchlist/types";

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitTitleAndSource(value: string) {
  const cleaned = cleanText(value);
  const parts = cleaned.split(" - ");

  if (parts.length < 2) {
    return {
      title: cleaned,
      source: "Unknown",
    };
  }

  return {
    title: parts.slice(0, -1).join(" - "),
    source: parts.at(-1) ?? "Unknown",
  };
}

export async function fetchGoogleNewsHeadlines(query: string, limit = 6): Promise<WatchlistContractHeadline[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; wolfdesk/1.0)",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Google News request failed with status ${response.status}.`);
  }

  const xml = await response.text();
  const $ = load(xml, { xmlMode: true });
  const seen = new Set<string>();
  const headlines: WatchlistContractHeadline[] = [];

  $("item").each((_, item) => {
    if (headlines.length >= limit) {
      return false;
    }

    const rawTitle = $(item).find("title").first().text();
    const link = cleanText($(item).find("link").first().text());
    const publishedAt = cleanText($(item).find("pubDate").first().text());
    const { title, source } = splitTitleAndSource(rawTitle);

    if (!title || !link || seen.has(title)) {
      return;
    }

    seen.add(title);
    headlines.push({
      title,
      source,
      publishedAt,
      url: link,
    });
  });

  return headlines;
}
