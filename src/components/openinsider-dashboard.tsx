"use client";

import { useEffect, useState } from "react";
import { OpenInsiderGptResponse, OpenInsiderResponse } from "@/lib/openinsider/types";
import { SimpleBarChart } from "@/components/simple-bar-chart";
import { SimpleLineChart } from "@/components/simple-line-chart";

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

  async function load(next?: { symbol?: string; side?: "all" | "buy" | "sale"; count?: string }) {
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
      setGptData(null);
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
    } catch {
      setGptData(null);
      setError("Analysis request failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

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
          <h2 style={{ marginBottom: 12 }}>GPT analysis</h2>
          <p style={{ color: "#4b5563", marginBottom: 12 }}>
            Model: {gptData.model} | symbols analyzed: {gptData.results.length}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Symbol</th>
                <th align="left">Signal</th>
                <th align="left">Quality</th>
                <th align="left">Direction</th>
                <th align="right">Confidence</th>
                <th align="left">Summary</th>
                <th align="left">Drivers</th>
                <th align="left">Risks</th>
                <th align="left">Rationale</th>
              </tr>
            </thead>
            <tbody>
              {gptData.results.map((entry) => (
                <tr key={entry.symbol}>
                  <td>{entry.symbol}</td>
                  <td>{entry.insiderSignal}</td>
                  <td>{entry.quality}</td>
                  <td>{entry.direction}</td>
                  <td align="right">{entry.confidence.toFixed(2)}</td>
                  <td>{entry.researchSummary}</td>
                  <td>{entry.keyDrivers.join("; ")}</td>
                  <td>{entry.riskFlags.join("; ")}</td>
                  <td>{entry.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <h2 style={{ marginBottom: 12 }}>Ticker summary</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Ticker</th>
                <th align="left">Bias</th>
                <th align="right">Buy</th>
                <th align="right">Sell</th>
                <th align="right">Net</th>
                <th align="right">Insiders</th>
                <th align="right">Ratio</th>
              </tr>
            </thead>
            <tbody>
              {topTickers.map((entry) => (
                <tr key={entry.ticker}>
                  <td>{entry.ticker}</td>
                  <td>{formatBias(entry.activityBias)}</td>
                  <td align="right">{formatMoney(entry.buyValue)}</td>
                  <td align="right">{formatMoney(entry.sellValue)}</td>
                  <td align="right">{formatMoney(entry.netValue)}</td>
                  <td align="right">{entry.uniqueInsiderCount}</td>
                  <td align="right">{formatRatio(entry.buyToSellValueRatio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
          <h2 style={{ marginBottom: 12 }}>Insider summary</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Insider</th>
                <th align="left">Role</th>
                <th align="right">Tickers</th>
                <th align="right">Net</th>
                <th align="right">Trades</th>
              </tr>
            </thead>
            <tbody>
              {topInsiders.map((entry) => (
                <tr key={`${entry.insider}-${entry.relationship}`}>
                  <td>{entry.insider}</td>
                  <td>{entry.relationship}</td>
                  <td align="right">{entry.uniqueTickerCount}</td>
                  <td align="right">{formatMoney(entry.netValue)}</td>
                  <td align="right">{entry.tradeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
          <h2 style={{ marginBottom: 12 }}>Relationship summary</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Role</th>
                <th align="right">Net</th>
                <th align="right">Trades</th>
                <th align="right">Insiders</th>
                <th align="right">Tickers</th>
              </tr>
            </thead>
            <tbody>
              {topRelationships.map((entry) => (
                <tr key={entry.relationship}>
                  <td>{entry.relationship}</td>
                  <td align="right">{formatMoney(entry.netValue)}</td>
                  <td align="right">{entry.tradeCount}</td>
                  <td align="right">{entry.uniqueInsiderCount}</td>
                  <td align="right">{entry.uniqueTickerCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
          <h2 style={{ marginBottom: 12 }}>Ticker research briefs</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Ticker</th>
                <th align="left">Bias</th>
                <th align="right">Acc</th>
                <th align="right">Dist</th>
                <th align="right">Cluster</th>
                <th align="left">Summary</th>
              </tr>
            </thead>
            <tbody>
              {tickerResearch.map((entry) => (
                <tr key={entry.ticker}>
                  <td>{entry.ticker}</td>
                  <td>{formatBias(entry.activityBias)}</td>
                  <td align="right">{entry.accumulationScore.toFixed(1)}</td>
                  <td align="right">{entry.distributionScore.toFixed(1)}</td>
                  <td align="right">{entry.clusterScore.toFixed(2)}</td>
                  <td>{entry.analysisSummary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ border: "1px solid #d1d5db", padding: 16, background: "#fff", overflowX: "auto" }}>
        <h2 style={{ marginBottom: 12 }}>Raw trades</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono), monospace", fontSize: 13 }}>
          <thead>
            <tr>
              <th align="left">Date</th>
              <th align="left">Ticker</th>
              <th align="left">Insider</th>
              <th align="left">Role</th>
              <th align="left">Type</th>
              <th align="right">Shares</th>
              <th align="right">Price</th>
              <th align="right">Value</th>
            </tr>
          </thead>
          <tbody>
            {(data?.trades.slice(0, 50) ?? []).map((trade, index) => (
              <tr key={`${trade.ticker}-${trade.date}-${index}`}>
                <td>{trade.date}</td>
                <td>{trade.ticker}</td>
                <td>{trade.insider}</td>
                <td>{trade.relationship}</td>
                <td>{trade.transactionType}</td>
                <td align="right">{trade.shares.toLocaleString()}</td>
                <td align="right">{trade.averagePrice.toFixed(2)}</td>
                <td align="right">{formatMoney(trade.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
