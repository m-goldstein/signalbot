"use client";

import { ContractWatchlistEntry } from "@/lib/watchlist/types";

const STORAGE_KEY = "wolfdesk.contract-watchlist";
export const CONTRACT_WATCHLIST_EVENT = "wolfdesk-contract-watchlist";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
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

    const parsed = JSON.parse(raw) as ContractWatchlistEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeContractWatchlist(entries: ContractWatchlistEntry[]) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
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
