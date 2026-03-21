"use client";

import { ScreenerGptResponse, ScreenerResponse, ScreenerRow, ScreenerSortField } from "@/lib/screener/types";
import { UniverseTier } from "@/lib/universe/types";
import { ScreenerDetailChart } from "@/components/screener-detail-chart";
import { useEffect, useState } from "react";
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

function formatSection(value: "tech" | "leaders") {
  return value === "tech" ? "Tech stocks" : "Market leaders and benchmarks";
}

type SectionKey = "selected" | "tech" | "leaders";

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

export function ScreenerTable() {
  const [tier, setTier] = useState<UniverseTier | "all">("all");
  const [sort, setSort] = useState<ScreenerSortField>("dailyChangePercent");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [historyStart, setHistoryStart] = useState<string>("");
  const [analysis, setAnalysis] = useState<ScreenerGptResponse | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [detail, setDetail] = useState<{
    symbol: string;
    name: string;
    segment: string;
    tier: string;
    snapshot: Record<string, unknown>;
    series: {
      bars: { timestamp: string; close: number; high: number; low: number; volume: number }[];
      sma20: { timestamp: string; value: number | null }[];
      sma50: { timestamp: string; value: number | null }[];
      sma200: { timestamp: string; value: number | null }[];
    };
  } | null>(null);
  const [topN, setTopN] = useState("5");
  const [tableQueries, setTableQueries] = useState<Record<SectionKey, string>>({
    selected: "",
    tech: "",
    leaders: "",
  });
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadRows() {
      setIsLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          tier,
          sort,
          direction,
        });
        const response = await fetch(`/api/screener?${params.toString()}`);
        const payload = (await response.json()) as ScreenerResponse & { error?: string };

        if (!response.ok) {
          if (isActive) {
            setError(payload.error || "Screener request failed.");
            setRows([]);
          }
          return;
        }

        if (isActive) {
          setRows(payload.rows);
          setHistoryStart(payload.historyStart);
          setAnalysis(null);
          setDetail(null);
          setSelectedSymbol("");
          setSelectedRows([]);
          setTableQueries({ selected: "", tech: "", leaders: "" });
        }
      } catch {
        if (isActive) {
          setError("Network request failed.");
          setRows([]);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadRows();

    return () => {
      isActive = false;
    };
  }, [tier, sort, direction]);

  async function runAnalysis() {
    setIsAnalyzing(true);
    setError("");

    try {
      const params = new URLSearchParams({
        tier,
        sort,
        direction,
      });
      if (selectedRows.length) {
        params.set("symbols", selectedRows.join(","));
      } else {
        params.set("topN", topN);
      }
      const response = await fetch(`/api/screener/analyze?${params.toString()}`);
      const payload = (await response.json()) as ScreenerGptResponse & { error?: string };

      if (!response.ok) {
        setAnalysis(null);
        setError(payload.error || "Screener analysis request failed.");
        return;
      }

      setAnalysis(payload);
    } catch {
      setAnalysis(null);
      setError("Screener analysis request failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function loadDetail(symbol: string) {
    setSelectedSymbol(symbol);
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

  const allRowsSelected = rows.length > 0 && selectedRows.length === rows.length;
  const techRows = rows.filter((row) => row.section === "tech");
  const leaderRows = rows.filter((row) => row.section === "leaders");
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
                  <tr
                    key={`${row.section}-${row.symbol}-${row.timeframe}`}
                    className={selectedSymbol === row.symbol ? styles.activeRow : styles.clickableRow}
                    onClick={() => void loadDetail(row.symbol)}
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
          <span>GPT top N fallback</span>
          <input value={topN} onChange={(event) => setTopN(event.target.value)} type="number" min="1" max="10" />
        </label>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={() => void runAnalysis()}>
          {isAnalyzing
            ? "Analyzing..."
            : selectedRows.length
              ? `Run GPT analysis on ${selectedRows.length} selected`
              : `Run GPT analysis on top ${topN}`}
        </button>
        <span className={styles.selectionHint}>
          {selectedRows.length
            ? "Selected rows override the top-N setting."
            : "If no rows are selected, GPT analysis uses the top-N fallback."}
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

      {selectedSymbol ? (
        <div className={styles.detailWrap}>
          <div className={styles.detailHeader}>
            <h2>{selectedSymbol} detail</h2>
            <span>{isLoadingDetail ? "Loading chart..." : detail ? `${detail.name} / ${detail.segment}` : ""}</span>
          </div>

          {detail ? (
            <>
              <ScreenerDetailChart
                symbol={detail.symbol}
                bars={detail.series.bars}
                sma20={detail.series.sma20}
                sma50={detail.series.sma50}
                sma200={detail.series.sma200}
              />
            </>
          ) : null}
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
      {renderSectionTable(leaderRows, "Market leaders and benchmarks", "Magnificent 7 names, sector ETFs, and broad market index proxies for context and relative analysis.", "leaders")}
    </section>
  );
}
