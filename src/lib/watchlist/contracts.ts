"use client";

import { ContractWatchlistEntry } from "@/lib/watchlist/types";

const STORAGE_KEY = "wolfdesk.contract-watchlist";
export const CONTRACT_WATCHLIST_EVENT = "wolfdesk-contract-watchlist";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function sanitizeText(value: unknown, maxLength = 80) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizeNumber(value: unknown, min = 0, max = 1_000_000_000) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(min, Math.min(max, parsed));
}

function isOptionType(value: string): value is ContractWatchlistEntry["optionType"] {
  return value === "call" || value === "put";
}

function isThesisFit(value: string): value is ContractWatchlistEntry["thesisFit"] {
  return value === "aligned" || value === "countertrend" || value === "watch";
}

function isStructure(value: string): value is ContractWatchlistEntry["structure"] {
  return value === "long_call" || value === "call_spread" || value === "long_put" || value === "put_spread" || value === "watchlist";
}

function isLane(value: string): value is ContractWatchlistEntry["lane"] {
  return value === "suggested" || value === "fast_lane";
}

function sanitizeWatchlistEntry(value: unknown): ContractWatchlistEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const symbol = sanitizeText(item.symbol, 48).toUpperCase();
  const underlyingSymbol = sanitizeText(item.underlyingSymbol, 16).toUpperCase();
  const optionType = sanitizeText(item.optionType, 8).toLowerCase();
  const expirationDate = sanitizeText(item.expirationDate, 16);
  const thesisFit = sanitizeText(item.thesisFit, 16).toLowerCase();
  const structure = sanitizeText(item.structure, 24).toLowerCase();
  const lane = sanitizeText(item.lane, 16).toLowerCase();

  const daysToExpiration = sanitizeNumber(item.daysToExpiration, 0, 730);
  const strikePrice = sanitizeNumber(item.strikePrice, 0, 100_000);
  const bid = sanitizeNumber(item.bid, 0, 100_000);
  const ask = sanitizeNumber(item.ask, 0, 100_000);
  const mark = sanitizeNumber(item.mark, 0, 100_000);
  const breakEven = sanitizeNumber(item.breakEven, 0, 100_000);
  const dailyVolume = sanitizeNumber(item.dailyVolume, 0, 100_000_000);
  const bidAskSpreadPercent = sanitizeNumber(item.bidAskSpreadPercent, 0, 10_000);
  const score = sanitizeNumber(item.score, 0, 10_000);
  const addedAt = sanitizeText(item.addedAt, 40) || new Date(0).toISOString();

  if (
    !symbol ||
    !underlyingSymbol ||
    !expirationDate ||
    daysToExpiration === null ||
    strikePrice === null ||
    bid === null ||
    ask === null ||
    mark === null ||
    breakEven === null ||
    dailyVolume === null ||
    bidAskSpreadPercent === null ||
    score === null ||
    !isOptionType(optionType) ||
    !isThesisFit(thesisFit) ||
    !isStructure(structure) ||
    !isLane(lane)
  ) {
    return null;
  }

  return {
    symbol,
    underlyingSymbol,
    optionType,
    expirationDate,
    daysToExpiration,
    strikePrice,
    bid,
    ask,
    mark,
    breakEven,
    dailyVolume,
    bidAskSpreadPercent,
    score,
    thesisFit,
    structure,
    lane,
    addedAt,
  };
}

function sanitizeWatchlistEntries(value: unknown) {
  return Array.isArray(value)
    ? value.map(sanitizeWatchlistEntry).filter((entry): entry is ContractWatchlistEntry => Boolean(entry))
    : [];
}

export function readContractWatchlist(): ContractWatchlistEntry[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    const sanitized = sanitizeWatchlistEntries(parsed);

    if (Array.isArray(parsed) && sanitized.length !== parsed.length) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    }

    return sanitized;
  } catch {
    return [];
  }
}

function writeContractWatchlist(entries: ContractWatchlistEntry[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeWatchlistEntries(entries)));
  window.dispatchEvent(new CustomEvent(CONTRACT_WATCHLIST_EVENT));
}

export function isContractWatched(contractSymbol: string) {
  return readContractWatchlist().some((entry) => entry.symbol === contractSymbol);
}

export function toggleContractWatchlist(entry: ContractWatchlistEntry) {
  const current = readContractWatchlist();
  const exists = current.some((item) => item.symbol === entry.symbol);

  if (exists) {
    writeContractWatchlist(current.filter((item) => item.symbol !== entry.symbol));
    return false;
  }

  writeContractWatchlist([{ ...entry, addedAt: new Date().toISOString() }, ...current]);
  return true;
}

export function removeContractFromWatchlist(contractSymbol: string) {
  const current = readContractWatchlist();
  writeContractWatchlist(current.filter((entry) => entry.symbol !== contractSymbol));
}

export function clearContractWatchlist() {
  writeContractWatchlist([]);
}
