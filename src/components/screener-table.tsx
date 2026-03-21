"use client";

import {
  createAnalysisQueryKey,
  readCachedScreenerAnalysis,
  writeCachedScreenerAnalysis,
} from "@/lib/client/analysis-cache";
import { isTradingSessionOpen } from "@/lib/client/market-session";
import { ScreenerGptResponse, ScreenerResponse, ScreenerRow, ScreenerSortField } from "@/lib/screener/types";
import { UniverseTier } from "@/lib/universe/types";
import { ScreenerDetailChart } from "@/components/screener-detail-chart";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import styles from "./screener-table.module.css";

const SORT_OPTIONS: Array<{ value: ScreenerSortField; label: string }> = [
  { value: "dailyChangePercent", label: "Day %" },
  { value: "oneMonthChangePercent", label: "1M %" },
  { value: "threeMonthChangePercent", label: "3M %" },
  { value: "sixMonthChangePercent", label: "6M %" },
  { value: "oneYearChangePercent", label: "1Y %" },
  { value: "distanceFrom20Sma", label: "20 SMA %" },
  { value: "distanceFrom50Sma", label: "50 SMA %" },
  { value: "distanceFrom200Sma", label: "200 SMA %" },
  { value: "distanceFrom52WeekHigh", label: "52W High %" },
  { value: "distanceFrom52WeekLow", label: "52W Low %" },
  { value: "atrPercent", label: "ATR %" },
  { value: "realizedVol20", label: "RV20 %" },
  { value: "realizedVol60", label: "RV60 %" },
  { value: "averageDollarVolume20", label: "ADV20" },
  { value: "directionalConvictionScore", label: "Options Conviction" },
  { value: "premiumBuyingScore", label: "Premium Score" },
  { value: "volumeVs20DayAverage", label: "Vol / 20D" },
  { value: "symbol", label: "Symbol" },
];

const TABLE_SORT_FIELDS: Array<{
  label: string;
  field: ScreenerSortField;
  hint?: string;
}> = [
  { label: "Symbol", field: "symbol" },
  { label: "Context", field: "symbol", hint: "symbol" },
  { label: "Price", field: "dailyChangePercent", hint: "day %" },
  { label: "Momentum", field: "oneYearChangePercent", hint: "1Y %" },
  { label: "Trend", field: "distanceFrom20Sma", hint: "20 sma %" },
  { label: "Range", field: "distanceFrom52WeekHigh", hint: "52W high %" },
  { label: "Volatility", field: "atrPercent", hint: "atr %" },
  { label: "Liquidity", field: "averageDollarVolume20", hint: "adv20" },
  { label: "Options", field: "directionalConvictionScore", hint: "options conviction" },
];
const SCREENER_GPT_CACHE_KEY = "wolfdesk.screener.gpt";
const SCREENER_SELECTION_CACHE_KEY = "wolfdesk.screener.selection";

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatRatio(value: number) {
  return `${value.toFixed(2)}x`;
}

function formatMoney(value: number) {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }

  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatSegment(value: string) {
  return value.replaceAll("_", " ");
}

function formatSection(value: "tech" | "leaders" | "defense") {
  if (value === "tech") {
    return "Tech stocks";
  }

  if (value === "leaders") {
    return "Market leaders and benchmarks";
  }

  return "Defense contractors";
}

type SectionKey = "selected" | "tech" | "leaders" | "defense";

function compareNumber(left: number, operator: string, right: number) {
  if (operator === "<") {
    return left < right;
  }

  if (operator === "<=") {
    return left <= right;
  }

  if (operator === ">") {
    return left > right;
  }

  if (operator === ">=") {
    return left >= right;
  }

  return left === right;
}

function normalizeSearchQuery(rawQuery: string) {
  return rawQuery
    .split(",")
    .map((token) => token.trim().toLowerCase().replace(/\s+/g, ""))
    .filter(Boolean);
}

function matchesSearch(row: ScreenerRow, rawQuery: string) {
  const tokens = normalizeSearchQuery(rawQuery);

  if (!tokens.length) {
    return true;
  }
  const searchableText = [
    row.symbol,
    row.name,
    row.section,
    formatSection(row.section),
    row.segment,
    formatSegment(row.segment),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, "");

  return tokens.every((token) => {
    const dorkMatch = token.match(/^([a-z0-9]+)(<=|>=|=|<|>)([0-9.]+)$/i);

    if (!dorkMatch) {
      return searchableText.includes(token);
    }

    const [, field, operator, rawValue] = dorkMatch;
    const targetValue = Number.parseFloat(rawValue);

    if (!Number.isFinite(targetValue)) {
      return false;
    }

    const fieldMap: Partial<Record<string, number>> = {
      price: row.close,
      atr: row.atrPercent,
      adv20: row.averageDollarVolume20,
      conv: row.directionalConvictionScore,
      premium: row.premiumBuyingScore,
      day: row.dailyChangePercent,
      "1m": row.oneMonthChangePercent,
      "3m": row.threeMonthChangePercent,
      "6m": row.sixMonthChangePercent,
      "1y": row.oneYearChangePercent,
    };

    const leftValue = fieldMap[field];

    if (typeof leftValue !== "number") {
      return false;
    }

    return compareNumber(leftValue, operator, targetValue);
  });
}

function readStoredSelectedRows() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SCREENER_SELECTION_CACHE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => String(value).trim().toUpperCase().replace(/[^A-Z0-9.-]/g, ""))
      .filter(Boolean)
      .slice(0, 100);
  } catch {
    return [];
  }
}

function writeStoredSelectedRows(symbols: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SCREENER_SELECTION_CACHE_KEY, JSON.stringify(symbols));
}

type ScreenerTableProps = {
  initialHistoryStartInput: string;
  maxHistoryStartInput: string;
};

export function ScreenerTable({
  initialHistoryStartInput,
  maxHistoryStartInput,
}: ScreenerTableProps) {
  const [tier, setTier] = useState<UniverseTier | "all">("all");
  const [sort, setSort] = useState<ScreenerSortField>("dailyChangePercent");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [historyStart, setHistoryStart] = useState<string>("");
  const [historyStartInput, setHistoryStartInput] = useState<string>(initialHistoryStartInput);
  const [showGraphs, setShowGraphs] = useState(true);
  const [rowGraphVisibility, setRowGraphVisibility] = useState<Record<string, boolean>>({});
  const [analysis, setAnalysis] = useState<ScreenerGptResponse | null>(null);
  const [expandedRowKey, setExpandedRowKey] = useState<string>("");
  const [detail, setDetail] = useState<{
    symbol: string;
    name: string;
    segment: string;
    tier: string;
    snapshot: Record<string, unknown>;
    benchmarkComparisons: Array<{
      symbol: string;
      read: {
        oneMonthSpread: number;
        threeMonthSpread: number;
        sixMonthSpread: number;
        upCaptureSpread: number;
        downCaptureSpread: number;
      };
    }>;
    insights: Array<{
      key: string;
      title: string;
      status: "available" | "needs_options_data" | "needs_event_data";
      summary: string;
      bullets: string[];
    }>;
    optionContracts: {
      underlyingSymbol: string;
      count: number;
      suggested: Array<{
        symbol: string;
        optionType: "call" | "put";
        expirationDate: string;
        daysToExpiration: number;
        strikePrice: number;
        bid: number;
        ask: number;
        mark: number;
        breakEven: number;
        dailyVolume: number;
        bidAskSpreadPercent: number;
        score: number;
        thesisFit: "aligned" | "countertrend" | "watch";
        structure: "long_call" | "call_spread" | "long_put" | "put_spread" | "watchlist";
        rationale: string[];
      }>;
      fastLane: Array<{
        symbol: string;
        optionType: "call" | "put";
        expirationDate: string;
        daysToExpiration: number;
        strikePrice: number;
        bid: number;
        ask: number;
        mark: number;
        breakEven: number;
        dailyVolume: number;
        bidAskSpreadPercent: number;
        score: number;
        thesisFit: "aligned" | "countertrend" | "watch";
        structure: "long_call" | "call_spread" | "long_put" | "put_spread" | "watchlist";
        rationale: string[];
      }>;
    };
    series: {
      bars: { timestamp: string; close: number; high: number; low: number; volume: number }[];
      sma20: { timestamp: string; value: number | null }[];
      sma50: { timestamp: string; value: number | null }[];
      sma200: { timestamp: string; value: number | null }[];
    };
  } | null>(null);
  const [tableQueries, setTableQueries] = useState<Record<SectionKey, string>>({
    selected: "",
    tech: "",
    leaders: "",
    defense: "",
  });
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const loadInFlightRef = useRef(false);
  const hasLoadedRowsRef = useRef(false);
  const analysisQueryKey = useMemo(
    () => createAnalysisQueryKey(["screener", tier, sort, direction, historyStartInput, ...selectedRows.slice().sort()]),
    [direction, historyStartInput, selectedRows, sort, tier],
  );

  async function loadRows(options?: { preserveState?: boolean }) {
    const preserveState = options?.preserveState ?? false;
    const isBackgroundRefresh = preserveState && hasLoadedRowsRef.current;

    if (loadInFlightRef.current) {
      return;
    }

    loadInFlightRef.current = true;
    setIsLoading(true);

    if (!isBackgroundRefresh) {
      setError("");
    }

    try {
      const params = new URLSearchParams({
        tier,
        sort,
        direction,
        historyStart: historyStartInput,
      });
      const response = await fetch(`/api/screener?${params.toString()}`);
      const payload = (await response.json()) as ScreenerResponse & { error?: string };

      if (!response.ok) {
        setError(payload.error || "Screener request failed.");
        return;
      }

      setRows(payload.rows);
      setHistoryStart(payload.historyStart);
      hasLoadedRowsRef.current = true;
      setError("");

      if (!preserveState) {
        setAnalysis(null);
        setDetail(null);
        setExpandedRowKey("");
        const storedSelected = readStoredSelectedRows().filter((symbol) =>
          payload.rows.some((row) => row.symbol === symbol),
        );
        setSelectedRows(storedSelected);
        setTableQueries({ selected: "", tech: "", leaders: "", defense: "" });
        return;
      }

      setSelectedRows((current) => current.filter((symbol) => payload.rows.some((row) => row.symbol === symbol)));

      if (detail && expandedRowKey) {
        const expandedSymbol = expandedRowKey.split(":")[1] ?? "";

        if (!payload.rows.some((row) => row.symbol === expandedSymbol)) {
          setExpandedRowKey("");
          setDetail(null);
        } else {
          void loadDetail(expandedSymbol, expandedRowKey, true);
        }
      }
    } catch {
      setError("Network request failed.");
    } finally {
      loadInFlightRef.current = false;
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, [direction, historyStartInput, sort, tier]);

  useEffect(() => {
    const cached = readCachedScreenerAnalysis(SCREENER_GPT_CACHE_KEY, analysisQueryKey);

    if (cached) {
      setAnalysis(cached);
      return;
    }

    setAnalysis((current) => {
      if (!current) {
        return null;
      }

      return createAnalysisQueryKey([
        "screener",
        tier,
        sort,
        direction,
        historyStartInput,
        ...current.results.map((entry) => entry.symbol).sort(),
      ]) === analysisQueryKey
        ? current
        : null;
    });
  }, [analysisQueryKey, direction, historyStartInput, sort, tier]);

  useEffect(() => {
    if (!selectedRows.length) {
      setAnalysis(null);
    }
  }, [selectedRows]);

  useEffect(() => {
    writeStoredSelectedRows(selectedRows);
  }, [selectedRows]);

  useEffect(() => {
    if (!isTradingSessionOpen()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (isTradingSessionOpen()) {
        void loadRows({ preserveState: true });
      }
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [direction, expandedRowKey, historyStartInput, sort, tier, detail]);

  async function runAnalysis() {
    setIsAnalyzing(true);
    setError("");

    try {
      const params = new URLSearchParams({
        tier,
        sort,
        direction,
        historyStart: historyStartInput,
      });
      if (!selectedRows.length) {
        setAnalysis(null);
        setError("Select at least one row before running GPT analysis.");
        return;
      }
      params.set("symbols", selectedRows.join(","));
      const response = await fetch(`/api/screener/analyze?${params.toString()}`);
      const payload = (await response.json()) as ScreenerGptResponse & { error?: string };

      if (!response.ok) {
        setAnalysis(null);
        setError(payload.error || "Screener analysis request failed.");
        return;
      }

      setAnalysis(payload);
      writeCachedScreenerAnalysis(SCREENER_GPT_CACHE_KEY, analysisQueryKey, payload);
    } catch {
      setAnalysis(null);
      setError("Screener analysis request failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function loadDetail(symbol: string, rowKey: string, preserveExpandedState = false) {
    if (!preserveExpandedState && expandedRowKey === rowKey) {
      setExpandedRowKey("");
      setDetail(null);
      return;
    }

    if (!preserveExpandedState) {
      setExpandedRowKey(rowKey);
    }
    setIsLoadingDetail(true);
    setError("");

    try {
      const response = await fetch(`/api/screener/detail?symbol=${encodeURIComponent(symbol)}`);
      const payload = (await response.json()) as typeof detail & { error?: string };

      if (!response.ok) {
        setDetail(null);
        setError(payload?.error || "Screener detail request failed.");
        return;
      }

      setDetail(payload);
    } catch {
      setDetail(null);
      setError("Screener detail request failed.");
    } finally {
      setIsLoadingDetail(false);
    }
  }

  function toggleSelectedRow(symbol: string) {
    setSelectedRows((current) =>
      current.includes(symbol) ? current.filter((value) => value !== symbol) : [...current, symbol],
    );
  }

  function toggleAllRows() {
    setSelectedRows((current) => (current.length === rows.length ? [] : rows.map((row) => row.symbol)));
  }

  function changeSort(field: ScreenerSortField) {
    if (sort === field) {
      setDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }

    setSort(field);
    setDirection(field === "symbol" ? "asc" : "desc");
  }

  function toggleRowGraph(rowKey: string) {
    setRowGraphVisibility((current) => ({
      ...current,
      [rowKey]: current[rowKey] === false ? true : false,
    }));
  }

  const allRowsSelected = rows.length > 0 && selectedRows.length === rows.length;
  const techRows = rows.filter((row) => row.section === "tech");
  const leaderRows = rows.filter((row) => row.section === "leaders");
  const defenseRows = rows.filter((row) => row.section === "defense");
  const selectedRowSet = new Set(selectedRows);
  const selectedRowsData = rows.filter((row) => selectedRowSet.has(row.symbol));

  function toggleSectionRows(sectionRows: ScreenerRow[]) {
    const symbols = sectionRows.map((row) => row.symbol);
    const allSelected = symbols.every((symbol) => selectedRows.includes(symbol));

    setSelectedRows((current) =>
      allSelected
        ? current.filter((symbol) => !symbols.includes(symbol))
        : Array.from(new Set([...current, ...symbols])),
    );
  }

  function renderSectionTable(
    sectionRows: ScreenerRow[],
    title: string,
    copy: string,
    sectionKey: SectionKey,
  ) {
    const filteredRows = sectionRows.filter((row) => matchesSearch(row, tableQueries[sectionKey]));
    const sectionSelected =
      filteredRows.length > 0 && filteredRows.every((row) => selectedRows.includes(row.symbol));

    return (
      <section className={styles.sectionBlock}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>{title}</h2>
            <p>{copy}</p>
          </div>
          <div className={styles.sectionTools}>
            <label className={styles.searchWrap}>
              <input
                value={tableQueries[sectionKey]}
                onChange={(event) =>
                  setTableQueries((current) => ({
                    ...current,
                    [sectionKey]: event.target.value,
                  }))
                }
                placeholder="symbol, section, price<100, atr<4"
              />
            </label>
            <span className={styles.helpWrap}>
              <button type="button" className={styles.helpButton} aria-label={`Search help for ${title}`}>
                ?
              </button>
              <span className={styles.helpBox}>
                Search syntax
                {"\n"}
                Enter a comma-separated list of tokens.
                {"\n"}
                Whitespace is normalized automatically.
                {"\n"}
                All tokens are combined with AND logic.
                {"\n"}
                {"\n"}
                Token types
                {"\n"}
                1. Plain text token
                {"\n"}
                Matches against symbol, company name, section, and segment text.
                {"\n"}
                {"\n"}
                2. Numeric dork
                {"\n"}
                Format: `field operator value`
                {"\n"}
                Supported operators: `&lt;`, `&lt;=`, `=`, `&gt;=`, `&gt;`
                {"\n"}
                Spaces around the operator are allowed.
                {"\n"}
                {"\n"}
                Supported numeric fields
                {"\n"}
                `price` = close price
                {"\n"}
                `atr` = ATR percent
                {"\n"}
                `adv20` = 20-day average dollar volume
                {"\n"}
                `conv` = options conviction score
                {"\n"}
                `premium` = premium buying score
                {"\n"}
                `day` = daily percent change
                {"\n"}
                `1m` = one month percent change
                {"\n"}
                `3m` = three month percent change
                {"\n"}
                `6m` = six month percent change
                {"\n"}
                `1y` = one year percent change
                {"\n"}
                {"\n"}
                Composition
                {"\n"}
                Mix plain text and dorks in the same query.
                {"\n"}
                Repeat the same field multiple times to create a range filter.
              </span>
            </span>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={sectionSelected}
                    aria-label={`Select all ${title}`}
                    onChange={() => toggleSectionRows(filteredRows)}
                  />
                </th>
                {TABLE_SORT_FIELDS.map((column) => {
                  const isActive = sort === column.field;
                  const arrow = isActive ? (direction === "desc" ? "↓" : "↑") : "";

                  return (
                    <th key={`${title}-${column.label}-${column.field}`}>
                      <button
                        type="button"
                        className={isActive ? styles.sortButtonActive : styles.sortButton}
                        onClick={() => changeSort(column.field)}
                      >
                        <span>{column.label}</span>
                        <span className={styles.sortArrow}>{arrow}</span>
                      </button>
                      {column.hint ? <span className={styles.sortHint}>{column.hint}</span> : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? (
                filteredRows.map((row) => (
                  (() => {
                    const rowKey = `${sectionKey}:${row.symbol}:${row.timeframe}`;
                    const isExpanded = expandedRowKey === rowKey;
                    const detailMatches = detail?.symbol === row.symbol;
                    const shouldShowGraphs = showGraphs && rowGraphVisibility[rowKey] !== false;

                    return (
                      <Fragment key={rowKey}>
                        <tr
                          className={isExpanded ? styles.activeRow : styles.clickableRow}
                          onClick={() => void loadDetail(row.symbol, rowKey)}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedRows.includes(row.symbol)}
                              aria-label={`Select ${row.symbol} for GPT analysis`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleSelectedRow(row.symbol)}
                            />
                          </td>
                          <td>
                            <div className={styles.symbolCell}>
                              <strong>{row.symbol}</strong>
                              <span>{row.name}</span>
                            </div>
                          </td>
                          <td>
                            <div className={styles.metricCell}>
                              <div>
                                <span className={styles.metricLabel}>Section</span>
                                <strong>{formatSection(row.section)}</strong>
                              </div>
                              <div>
                                <span className={styles.metricLabel}>Segment</span>
                                <strong>{formatSegment(row.segment)}</strong>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.metricCell}>
                              <div>
                                <span className={styles.metricLabel}>Close</span>
                                <strong>{row.close.toFixed(2)}</strong>
                              </div>
                              <div>
                                <span className={styles.metricLabel}>Day</span>
                                <strong className={row.dailyChangePercent >= 0 ? styles.positive : styles.negative}>
                                  {formatPercent(row.dailyChangePercent)}
                                </strong>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.metricCell}>
                              <div><span className={styles.metricLabel}>1M</span><strong>{formatPercent(row.oneMonthChangePercent)}</strong></div>
                              <div><span className={styles.metricLabel}>3M</span><strong>{formatPercent(row.threeMonthChangePercent)}</strong></div>
                              <div><span className={styles.metricLabel}>6M</span><strong>{formatPercent(row.sixMonthChangePercent)}</strong></div>
                              <div><span className={styles.metricLabel}>1Y</span><strong>{formatPercent(row.oneYearChangePercent)}</strong></div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.metricCell}>
                              <div><span className={styles.metricLabel}>20</span><strong>{formatPercent(row.distanceFrom20Sma)}</strong></div>
                              <div><span className={styles.metricLabel}>50</span><strong>{formatPercent(row.distanceFrom50Sma)}</strong></div>
                              <div><span className={styles.metricLabel}>200</span><strong>{formatPercent(row.distanceFrom200Sma)}</strong></div>
                              <div><span className={styles.metricLabel}>Stack</span><strong>{row.smaStackAligned ? "Aligned" : "Mixed"}</strong></div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.metricCell}>
                              <div><span className={styles.metricLabel}>52W Hi</span><strong>{formatPercent(row.distanceFrom52WeekHigh)}</strong></div>
                              <div><span className={styles.metricLabel}>52W Lo</span><strong>{formatPercent(row.distanceFrom52WeekLow)}</strong></div>
                              <div><span className={styles.metricLabel}>Breakout</span><strong>{row.breakoutState}</strong></div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.metricCell}>
                              <div><span className={styles.metricLabel}>ATR</span><strong>{formatPercent(row.atrPercent)}</strong></div>
                              <div><span className={styles.metricLabel}>RV20</span><strong>{formatPercent(row.realizedVol20)}</strong></div>
                              <div><span className={styles.metricLabel}>RV60</span><strong>{formatPercent(row.realizedVol60)}</strong></div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.metricCell}>
                              <div><span className={styles.metricLabel}>ADV20</span><strong>{formatMoney(row.averageDollarVolume20)}</strong></div>
                              <div><span className={styles.metricLabel}>Vol/20D</span><strong>{formatRatio(row.volumeVs20DayAverage)}</strong></div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.metricCell}>
                              <div><span className={styles.metricLabel}>Conv</span><strong>{row.directionalConvictionScore.toFixed(1)}</strong></div>
                              <div><span className={styles.metricLabel}>Premium</span><strong>{row.premiumBuyingScore.toFixed(1)}</strong></div>
                              <div><span className={styles.metricLabel}>Bias</span><strong>{row.optionsDirectionalBias}</strong></div>
                              <div><span className={styles.metricLabel}>Struct</span><strong>{row.optionsStructureBias}</strong></div>
                            </div>
                          </td>
                        </tr>

                        {isExpanded ? (
                          <tr className={styles.detailRow}>
                            <td colSpan={10} className={styles.detailCell}>
                              <div className={styles.inlineDetail}>
                                <div className={styles.detailHeader}>
                                  <h2>{row.symbol} detail</h2>
                                  <div className={styles.detailHeaderActions}>
                                    <span>
                                      {isLoadingDetail
                                        ? "Loading chart..."
                                        : detailMatches && detail
                                          ? `${detail.name} / ${detail.segment}`
                                          : ""}
                                    </span>
                                    <label className={styles.detailToggleCheckbox}>
                                      <input
                                        type="checkbox"
                                        checked={shouldShowGraphs}
                                        onChange={() => toggleRowGraph(rowKey)}
                                        onClick={(event) => event.stopPropagation()}
                                      />
                                      <span>Show graph</span>
                                    </label>
                                  </div>
                                </div>

                                {detailMatches && detail ? (
                                  <ScreenerDetailChart
                                    symbol={detail.symbol}
                                    showCharts={shouldShowGraphs}
                                    bars={detail.series.bars}
                                    sma20={detail.series.sma20}
                                    sma50={detail.series.sma50}
                                    sma200={detail.series.sma200}
                                    insights={detail.insights}
                                    optionContracts={detail.optionContracts}
                                  />
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })()
                ))
              ) : (
                <tr>
                  <td colSpan={10} className={styles.empty}>
                    {isLoading ? "Loading screener..." : "No rows matched the current search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.shell}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Universe Screener</p>
          <h1>Daily screener with one-year-plus history.</h1>
        </div>
        <p className={styles.copy}>
          The screener pulls roughly eighteen months of daily history per symbol, computes trend, momentum, range, volatility, and liquidity metrics, and can send the resulting snapshot to GPT for a directional read.
        </p>
      </div>

      <div className={styles.filters}>
        <label>
          <span>Tier</span>
          <select value={tier} onChange={(event) => setTier(event.target.value as UniverseTier | "all")}>
            <option value="all">All</option>
            <option value="tier1">Tier 1</option>
            <option value="tier2">Tier 2</option>
            <option value="tier3">Tier 3</option>
          </select>
        </label>

        <label>
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as ScreenerSortField)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Direction</span>
          <select value={direction} onChange={(event) => setDirection(event.target.value as "asc" | "desc")}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>

        <label>
          <span>History start</span>
          <input
            value={historyStartInput}
            onChange={(event) => setHistoryStartInput(event.target.value)}
            type="date"
            min="2016-01-01"
            max={maxHistoryStartInput}
          />
        </label>

        <label className={styles.inlineCheckbox}>
          <span>Show graphs</span>
          <input
            type="checkbox"
            checked={showGraphs}
            onChange={(event) => setShowGraphs(event.target.checked)}
          />
        </label>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={() => void runAnalysis()} disabled={!selectedRows.length || isAnalyzing}>
          {isAnalyzing ? "Analyzing..." : `Run GPT analysis on ${selectedRows.length} selected`}
        </button>
        <span className={styles.selectionHint}>
          {selectedRows.length
            ? "GPT analysis will run only on the selected rows."
            : "Select one or more rows to enable GPT analysis."}
        </span>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.meta}>
        <article>
          <span>Rows</span>
          <strong>{rows.length}</strong>
        </article>
        <article>
          <span>Timeframe</span>
          <strong>1Day</strong>
        </article>
        <article>
          <span>History start</span>
          <strong>{historyStart ? historyStart.slice(0, 10) : "-"}</strong>
        </article>
        <article>
          <span>Status</span>
          <strong>{isLoading ? "Refreshing" : "Ready"}</strong>
        </article>
      </div>

      {selectedRowsData.length ? (
        renderSectionTable(
          selectedRowsData,
          "Selected rows",
          "Focused working set duplicated here for faster navigation and GPT review.",
          "selected",
        )
      ) : null}

      {analysis ? (
        <div className={styles.analysisWrap}>
          <h2>GPT screener analysis</h2>
          <div className={styles.analysisTableWrap}>
            <table className={styles.analysisTable}>
              <thead>
              <tr>
                <th>Symbol</th>
                <th>Direction</th>
                <th>Confidence</th>
                <th>Options</th>
                <th>Judgment</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {analysis.results.map((entry) => (
                <tr key={entry.symbol}>
                  <td className={styles.analysisSymbol}>{entry.symbol}</td>
                  <td>{entry.direction}</td>
                  <td>{entry.confidence.toFixed(2)}</td>
                  <td>{entry.optionsAction}</td>
                  <td className={styles.analysisJudgment}>{entry.optionsJudgment}</td>
                  <td className={styles.rationale}>{entry.rationale}</td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className={styles.sectionActions}>
        <label className={styles.globalSelect}>
          <input
            type="checkbox"
            checked={allRowsSelected}
            aria-label="Select all screener rows"
            onChange={() => toggleAllRows()}
          />
          <span>Select all rows across both sections</span>
        </label>
      </div>

      {renderSectionTable(techRows, "Tech stocks", "Thematic semiconductor, infrastructure, software, space, power, and quantum names.", "tech")}
      {renderSectionTable(defenseRows, "Defense contractors", "Defense primes, aerospace, military contractors, government software, and defense-sector ETFs.", "defense")}
      {renderSectionTable(leaderRows, "Market leaders and benchmarks", "Magnificent 7 names, sector ETFs, and broad market index proxies for context and relative analysis.", "leaders")}
    </section>
  );
}
