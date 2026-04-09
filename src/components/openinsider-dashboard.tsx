"use client";

import {
  createAnalysisQueryKey,
  readCachedOpenInsiderAnalysis,
  writeCachedOpenInsiderAnalysis,
} from "@/lib/client/analysis-cache";
import { isTradingSessionOpen } from "@/lib/client/market-session";
import { Fragment, useEffect, useMemo, useState } from "react";
import { OpenInsiderGptResponse, OpenInsiderResponse } from "@/lib/openinsider/types";
import { SimpleBarChart } from "@/components/simple-bar-chart";
import { SimpleLineChart } from "@/components/simple-line-chart";

const OPENINSIDER_GPT_CACHE_KEY = "wolfdesk.openinsider.gpt";

function formatMoney(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatRatio(value: number | null) {
  if (value === null) {
    return "-";
  }

  return `${value.toFixed(2)}x`;
}

function formatBias(value: string) {
  return value.replaceAll("_", " ");
}

async function requestOpenInsider(params: {
  symbol: string;
  side: "all" | "buy" | "sale";
  count: string;
}) {
  const query = new URLSearchParams({
    symbol: params.symbol.trim().toUpperCase(),
    side: params.side,
    count: params.count,
  });
  const response = await fetch(`/api/openinsider?${query.toString()}`);
  return {
    ok: response.ok,
    payload: (await response.json()) as OpenInsiderResponse & { error?: string },
  };
}

export function OpenInsiderDashboard() {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"all" | "buy" | "sale">("buy");
  const [count, setCount] = useState("100");
  const [data, setData] = useState<OpenInsiderResponse | null>(null);
  const [gptData, setGptData] = useState<OpenInsiderGptResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisTopN, setAnalysisTopN] = useState("5");
  const [collapsedTables, setCollapsedTables] = useState({
    gpt: false,
    tickerSummary: false,
    insiderSummary: false,
    relationshipSummary: false,
    researchBriefs: false,
    rawTrades: false,
  });
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const analysisQueryKey = useMemo(
    () => createAnalysisQueryKey(["openinsider", symbol.trim().toUpperCase(), side, count, analysisTopN]),
    [analysisTopN, count, side, symbol],
  );

  useEffect(() => {
    let isActive = true;

    async function loadInitial() {
      try {
        const { ok, payload } = await requestOpenInsider({
          symbol: "",
          side: "buy",
          count: "100",
        });

        if (!isActive) {
          return;
        }

        if (!ok) {
          setData(null);
          setError(payload.error || "Request failed.");
          return;
        }

        setData(payload);
        setGptData(null);
      } catch {
        if (isActive) {
          setData(null);
          setError("Request failed.");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadInitial();

    return () => {
      isActive = false;
    };
  }, []);

  async function load(
    next?: { symbol?: string; side?: "all" | "buy" | "sale"; count?: string },
    options?: { preserveAnalysis?: boolean },
  ) {
    const requestSymbol = next?.symbol ?? symbol;
    const requestSide = next?.side ?? side;
    const requestCount = next?.count ?? count;

    setIsLoading(true);
    setError("");

    try {
      const { ok, payload } = await requestOpenInsider({
        symbol: requestSymbol,
        side: requestSide,
        count: requestCount,
      });

      if (!ok) {
        setData(null);
        setError(payload.error || "Request failed.");
        return;
      }

      setData(payload);

      if (!options?.preserveAnalysis) {
        setGptData(null);
      }
    } catch {
      setData(null);
      setError("Request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  async function analyze() {
    setIsAnalyzing(true);
    setError("");

    try {
      const params = new URLSearchParams({
        symbol: symbol.trim().toUpperCase(),
        side,
        count,
        topN: analysisTopN,
      });
      const response = await fetch(`/api/openinsider/analyze?${params.toString()}`);
      const payload = (await response.json()) as OpenInsiderGptResponse & { error?: string };

      if (!response.ok) {
        setGptData(null);
        setError(payload.error || "Analysis request failed.");
        return;
      }

      setGptData(payload);
      writeCachedOpenInsiderAnalysis(OPENINSIDER_GPT_CACHE_KEY, analysisQueryKey, payload);
    } catch {
      setGptData(null);
      setError("Analysis request failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  useEffect(() => {
    const cached = readCachedOpenInsiderAnalysis(OPENINSIDER_GPT_CACHE_KEY, analysisQueryKey);
    setGptData(cached);
  }, [analysisQueryKey]);

  useEffect(() => {
    if (!isTradingSessionOpen()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (isTradingSessionOpen()) {
        void load(undefined, { preserveAnalysis: true });
      }
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [count, side, symbol]);

  const topTickers = data?.analysis.tickerSummaries.slice(0, 12) ?? [];
  const dailySeries = data?.analysis.dailySeries.slice(-20) ?? [];
  const topInsiders = data?.analysis.insiderSummaries.slice(0, 12) ?? [];
  const topRelationships = data?.analysis.relationshipSummaries.slice(0, 10) ?? [];
  const tickerResearch = data?.analysis.tickerResearchSummaries.slice(0, 12) ?? [];
  const strongestAccumulation = [...tickerResearch]
    .sort((left, right) => right.accumulationScore - left.accumulationScore)
    .slice(0, 8);
  const strongestDistribution = [...tickerResearch]
    .sort((left, right) => right.distributionScore - left.distributionScore)
    .slice(0, 8);

  function toggleTable(key: keyof typeof collapsedTables) {
    setCollapsedTables((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function toggleRow(key: string) {
    setExpandedRows((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  const sectionHeaderStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 } as const;
  const collapseButtonStyle = { minHeight: 36, padding: "0 12px", border: "1px solid #d1d5db", background: "#fff", font: "inherit", color: "#111827" } as const;
  const rowToggleButtonStyle = { minHeight: 30, padding: "0 10px", border: "1px solid #d1d5db", background: "#fff", font: "inherit", color: "#111827" } as const;
  const detailCellStyle = { padding: 0, background: "#f8fafc" } as const;
  const detailWrapStyle = { display: "grid", gap: 14, padding: 16, color: "#1f2937", lineHeight: 1.6 } as const;
  const detailGridStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 } as const;
  const detailLabelStyle = { color: "#6b7280", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" } as const;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section style={{ display: "grid", gap: 12, border: "1px solid #d1d5db", padding: 16, background: "#fff" }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>OpenInsider</h1>
          <p style={{ color: "#4b5563" }}>
            Scrape OpenInsider, study insider buy and sell flows, rank accumulation versus distribution, inspect role concentration, and build ticker-level research briefs.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Symbol</span>
            <input value={symbol} onChange={(event) => setSymbol(event.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Side</span>
            <select value={side} onChange={(event) => setSide(event.target.value as "all" | "buy" | "sale")}>
              <option value="buy">Buy</option>
              <option value="sale">Sale</option>
              <option value="all">All</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span>Rows</span>
            <input value={count} onChange={(event) => setCount(event.target.value)} type="number" min="1" max="1000" />
          </label>
          <button type="button" onClick={() => void load()} style={{ alignSelf: "end", height: 40 }}>
            {isLoading ? "Loading" : "Refresh"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "200px 200px", gap: 12 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span>GPT top N</span>
            <input value={analysisTopN} onChange={(event) => setAnalysisTopN(event.target.value)} type="number" min="1" max="10" />
          </label>
          <button type="button" onClick={() => void analyze()} style={{ alignSelf: "end", height: 40 }}>
            {isAnalyzing ? "Analyzing" : "Run GPT analysis"}
          </button>
        </div>

        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 12 }}>
        <article style={{ border: "1px solid #d1d5db", padding: 12, background: "#fff" }}>
          <div>Trades</div>
          <strong>{data?.analysis.totals.tradeCount ?? 0}</strong>
        </article>
        <article style={{ border: "1px solid #d1d5db", padding: 12, background: "#fff" }}>
          <div>Tickers</div>
          <strong>{data?.analysis.totals.uniqueTickerCount ?? 0}</strong>
        </article>
        <article style={{ border: "1px solid #d1d5db", padding: 12, background: "#fff" }}>
          <div>Insiders</div>
          <strong>{data?.analysis.totals.uniqueInsiderCount ?? 0}</strong>
        </article>
        <article style={{ border: "1px solid #d1d5db", padding: 12, background: "#fff" }}>
          <div>Buy value</div>
          <strong>{formatMoney(data?.analysis.totals.buyValue ?? 0)}</strong>
        </article>
        <article style={{ border: "1px solid #d1d5db", padding: 12, background: "#fff" }}>
          <div>Sell value</div>
          <strong>{formatMoney(data?.analysis.totals.sellValue ?? 0)}</strong>
        </article>
        <article style={{ border: "1px solid #d1d5db", padding: 12, background: "#fff" }}>
          <div>Net value</div>
          <strong>{formatMoney(data?.analysis.totals.netValue ?? 0)}</strong>
        </article>
        <article style={{ border: "1px solid #d1d5db", padding: 12, background: "#fff" }}>
          <div>Buy/Sell ratio</div>
          <strong>{formatRatio(data?.analysis.totals.buyToSellValueRatio ?? null)}</strong>
        </article>
        <article style={{ border: "1px solid #d1d5db", padding: 12, background: "#fff" }}>
          <div>Latest</div>
          <strong>{data?.analysis.totals.latestTradeDate?.slice(0, 10) ?? "-"}</strong>
        </article>
        <article style={{ border: "1px solid #d1d5db", padding: 12, background: "#fff" }}>
          <div>Avg trade</div>
          <strong>{formatMoney(data?.analysis.totals.averageTradeValue ?? 0)}</strong>
        </article>
      </section>

      {gptData ? (
        <section style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={{ margin: 0 }}>GPT analysis</h2>
              <p style={{ color: "#4b5563", margin: "8px 0 0" }}>
                Model: {gptData.model} | symbols analyzed: {gptData.results.length}
              </p>
            </div>
            <button type="button" style={collapseButtonStyle} aria-expanded={!collapsedTables.gpt} onClick={() => toggleTable("gpt")}>
              {collapsedTables.gpt ? "Expand table" : "Collapse table"}
            </button>
          </div>
          {collapsedTables.gpt ? null : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">View</th>
                  <th align="left">Symbol</th>
                  <th align="left">Signal</th>
                  <th align="left">Quality</th>
                  <th align="left">Direction</th>
                  <th align="right">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {gptData.results.map((entry) => {
                  const rowKey = `gpt-${entry.symbol}`;
                  const isExpanded = expandedRows[rowKey] ?? false;

                  return (
                    <Fragment key={rowKey}>
                      <tr>
                        <td>
                          <button type="button" style={rowToggleButtonStyle} aria-expanded={isExpanded} onClick={() => toggleRow(rowKey)}>
                            {isExpanded ? "Hide" : "Show"}
                          </button>
                        </td>
                        <td>{entry.symbol}</td>
                        <td>{entry.insiderSignal}</td>
                        <td>{entry.quality}</td>
                        <td>{entry.direction}</td>
                        <td align="right">{entry.confidence.toFixed(2)}</td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={6} style={detailCellStyle}>
                            <div style={detailWrapStyle}>
                              <div>
                                <div style={detailLabelStyle}>Summary</div>
                                <div>{entry.researchSummary}</div>
                              </div>
                              <div style={detailGridStyle}>
                                <div>
                                  <div style={detailLabelStyle}>Drivers</div>
                                  <div>{entry.keyDrivers.join("; ") || "-"}</div>
                                </div>
                                <div>
                                  <div style={detailLabelStyle}>Risks</div>
                                  <div>{entry.riskFlags.join("; ") || "-"}</div>
                                </div>
                              </div>
                              <div>
                                <div style={detailLabelStyle}>Rationale</div>
                                <div>{entry.rationale}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff" }}>
          <SimpleBarChart
            title="Ticker net value"
            data={topTickers.map((entry) => ({ label: entry.ticker, value: entry.netValue }))}
            currency
          />
        </div>
        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff" }}>
          <SimpleLineChart
            title="Daily net value"
            data={dailySeries.map((entry) => ({ label: entry.date, value: entry.netValue }))}
          />
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff" }}>
          <SimpleBarChart
            title="Accumulation score"
            data={strongestAccumulation.map((entry) => ({ label: entry.ticker, value: entry.accumulationScore }))}
          />
        </div>
        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff" }}>
          <SimpleBarChart
            title="Distribution score"
            data={strongestDistribution.map((entry) => ({ label: entry.ticker, value: entry.distributionScore }))}
          />
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
          <div style={sectionHeaderStyle}>
            <h2 style={{ margin: 0 }}>Ticker summary</h2>
            <button type="button" style={collapseButtonStyle} aria-expanded={!collapsedTables.tickerSummary} onClick={() => toggleTable("tickerSummary")}>
              {collapsedTables.tickerSummary ? "Expand table" : "Collapse table"}
            </button>
          </div>
          {collapsedTables.tickerSummary ? null : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">View</th>
                  <th align="left">Ticker</th>
                  <th align="left">Bias</th>
                  <th align="right">Buy</th>
                  <th align="right">Sell</th>
                  <th align="right">Net</th>
                </tr>
              </thead>
              <tbody>
                {topTickers.map((entry) => {
                  const rowKey = `ticker-${entry.ticker}`;
                  const isExpanded = expandedRows[rowKey] ?? false;

                  return (
                    <Fragment key={rowKey}>
                      <tr>
                        <td>
                          <button type="button" style={rowToggleButtonStyle} aria-expanded={isExpanded} onClick={() => toggleRow(rowKey)}>
                            {isExpanded ? "Hide" : "Show"}
                          </button>
                        </td>
                        <td>{entry.ticker}</td>
                        <td>{formatBias(entry.activityBias)}</td>
                        <td align="right">{formatMoney(entry.buyValue)}</td>
                        <td align="right">{formatMoney(entry.sellValue)}</td>
                        <td align="right">{formatMoney(entry.netValue)}</td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={6} style={detailCellStyle}>
                            <div style={detailWrapStyle}>
                              <div style={detailGridStyle}>
                                <div>
                                  <div style={detailLabelStyle}>Unique insiders</div>
                                  <div>{entry.uniqueInsiderCount}</div>
                                </div>
                                <div>
                                  <div style={detailLabelStyle}>Buy / sell ratio</div>
                                  <div>{formatRatio(entry.buyToSellValueRatio)}</div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
          <div style={sectionHeaderStyle}>
            <h2 style={{ margin: 0 }}>Insider summary</h2>
            <button type="button" style={collapseButtonStyle} aria-expanded={!collapsedTables.insiderSummary} onClick={() => toggleTable("insiderSummary")}>
              {collapsedTables.insiderSummary ? "Expand table" : "Collapse table"}
            </button>
          </div>
          {collapsedTables.insiderSummary ? null : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">View</th>
                  <th align="left">Insider</th>
                  <th align="left">Role</th>
                  <th align="right">Net</th>
                  <th align="right">Trades</th>
                </tr>
              </thead>
              <tbody>
                {topInsiders.map((entry) => {
                  const rowKey = `insider-${entry.insider}-${entry.relationship}`;
                  const isExpanded = expandedRows[rowKey] ?? false;

                  return (
                    <Fragment key={rowKey}>
                      <tr>
                        <td>
                          <button type="button" style={rowToggleButtonStyle} aria-expanded={isExpanded} onClick={() => toggleRow(rowKey)}>
                            {isExpanded ? "Hide" : "Show"}
                          </button>
                        </td>
                        <td>{entry.insider}</td>
                        <td>{entry.relationship}</td>
                        <td align="right">{formatMoney(entry.netValue)}</td>
                        <td align="right">{entry.tradeCount}</td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={5} style={detailCellStyle}>
                            <div style={detailWrapStyle}>
                              <div>
                                <div style={detailLabelStyle}>Unique tickers</div>
                                <div>{entry.uniqueTickerCount}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
          <div style={sectionHeaderStyle}>
            <h2 style={{ margin: 0 }}>Relationship summary</h2>
            <button type="button" style={collapseButtonStyle} aria-expanded={!collapsedTables.relationshipSummary} onClick={() => toggleTable("relationshipSummary")}>
              {collapsedTables.relationshipSummary ? "Expand table" : "Collapse table"}
            </button>
          </div>
          {collapsedTables.relationshipSummary ? null : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">View</th>
                  <th align="left">Role</th>
                  <th align="right">Net</th>
                  <th align="right">Trades</th>
                </tr>
              </thead>
              <tbody>
                {topRelationships.map((entry) => {
                  const rowKey = `relationship-${entry.relationship}`;
                  const isExpanded = expandedRows[rowKey] ?? false;

                  return (
                    <Fragment key={rowKey}>
                      <tr>
                        <td>
                          <button type="button" style={rowToggleButtonStyle} aria-expanded={isExpanded} onClick={() => toggleRow(rowKey)}>
                            {isExpanded ? "Hide" : "Show"}
                          </button>
                        </td>
                        <td>{entry.relationship}</td>
                        <td align="right">{formatMoney(entry.netValue)}</td>
                        <td align="right">{entry.tradeCount}</td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={4} style={detailCellStyle}>
                            <div style={detailWrapStyle}>
                              <div style={detailGridStyle}>
                                <div>
                                  <div style={detailLabelStyle}>Unique insiders</div>
                                  <div>{entry.uniqueInsiderCount}</div>
                                </div>
                                <div>
                                  <div style={detailLabelStyle}>Unique tickers</div>
                                  <div>{entry.uniqueTickerCount}</div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
          <div style={sectionHeaderStyle}>
            <h2 style={{ margin: 0 }}>Ticker research briefs</h2>
            <button type="button" style={collapseButtonStyle} aria-expanded={!collapsedTables.researchBriefs} onClick={() => toggleTable("researchBriefs")}>
              {collapsedTables.researchBriefs ? "Expand table" : "Collapse table"}
            </button>
          </div>
          {collapsedTables.researchBriefs ? null : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">View</th>
                  <th align="left">Ticker</th>
                  <th align="left">Bias</th>
                  <th align="right">Acc</th>
                  <th align="right">Dist</th>
                  <th align="right">Cluster</th>
                </tr>
              </thead>
              <tbody>
                {tickerResearch.map((entry) => {
                  const rowKey = `research-${entry.ticker}`;
                  const isExpanded = expandedRows[rowKey] ?? false;

                  return (
                    <Fragment key={rowKey}>
                      <tr>
                        <td>
                          <button type="button" style={rowToggleButtonStyle} aria-expanded={isExpanded} onClick={() => toggleRow(rowKey)}>
                            {isExpanded ? "Hide" : "Show"}
                          </button>
                        </td>
                        <td>{entry.ticker}</td>
                        <td>{formatBias(entry.activityBias)}</td>
                        <td align="right">{entry.accumulationScore.toFixed(1)}</td>
                        <td align="right">{entry.distributionScore.toFixed(1)}</td>
                        <td align="right">{entry.clusterScore.toFixed(2)}</td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={6} style={detailCellStyle}>
                            <div style={detailWrapStyle}>
                              <div>
                                <div style={detailLabelStyle}>Summary</div>
                                <div>{entry.analysisSummary}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
        <div style={sectionHeaderStyle}>
          <h2 style={{ margin: 0 }}>Raw trades</h2>
          <button type="button" style={collapseButtonStyle} aria-expanded={!collapsedTables.rawTrades} onClick={() => toggleTable("rawTrades")}>
            {collapsedTables.rawTrades ? "Expand table" : "Collapse table"}
          </button>
        </div>
        {collapsedTables.rawTrades ? null : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono), monospace", fontSize: 13 }}>
            <thead>
              <tr>
                <th align="left">View</th>
                <th align="left">Date</th>
                <th align="left">Ticker</th>
                <th align="left">Insider</th>
                <th align="left">Type</th>
                <th align="right">Value</th>
              </tr>
            </thead>
            <tbody>
              {(data?.trades.slice(0, 50) ?? []).map((trade, index) => {
                const rowKey = `trade-${trade.ticker}-${trade.date}-${index}`;
                const isExpanded = expandedRows[rowKey] ?? false;

                return (
                  <Fragment key={rowKey}>
                    <tr>
                      <td>
                        <button type="button" style={rowToggleButtonStyle} aria-expanded={isExpanded} onClick={() => toggleRow(rowKey)}>
                          {isExpanded ? "Hide" : "Show"}
                        </button>
                      </td>
                      <td>{trade.date}</td>
                      <td>{trade.ticker}</td>
                      <td>{trade.insider}</td>
                      <td>{trade.transactionType}</td>
                      <td align="right">{formatMoney(trade.value)}</td>
                    </tr>
                    {isExpanded ? (
                      <tr>
                        <td colSpan={6} style={detailCellStyle}>
                          <div style={detailWrapStyle}>
                            <div style={detailGridStyle}>
                              <div>
                                <div style={detailLabelStyle}>Role</div>
                                <div>{trade.relationship}</div>
                              </div>
                              <div>
                                <div style={detailLabelStyle}>Shares</div>
                                <div>{trade.shares.toLocaleString()}</div>
                              </div>
                              <div>
                                <div style={detailLabelStyle}>Average price</div>
                                <div>{trade.averagePrice.toFixed(2)}</div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
