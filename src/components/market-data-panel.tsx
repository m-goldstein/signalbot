"use client";

import { FormEvent, useState } from "react";
import styles from "@/app/page.module.css";
import { Timeframe } from "@/lib/market-data/types";

type ApiState = {
  error?: string;
  bars?: {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    tradeCount?: number;
    vwap?: number;
  }[];
  symbol?: string;
  timeframe?: Timeframe;
  source?: string;
};

const TIMEFRAMES: Timeframe[] = ["1Day", "1Hour", "15Min", "5Min"];

export function MarketDataPanel() {
  const [symbol, setSymbol] = useState("NVDA");
  const [timeframe, setTimeframe] = useState<Timeframe>("1Day");
  const [limit, setLimit] = useState("20");
  const [state, setState] = useState<ApiState>({});
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setState({});

    const params = new URLSearchParams({
      symbol: symbol.trim().toUpperCase(),
      timeframe,
      limit,
    });

    try {
      const response = await fetch(`/api/market/bars?${params.toString()}`);
      const payload = (await response.json()) as ApiState;

      if (!response.ok) {
        setState({ error: payload.error || "Request failed." });
        return;
      }

      setState(payload);
    } catch {
      setState({ error: "Network request failed." });
    } finally {
      setIsLoading(false);
    }
  }

  const latestBar = state.bars?.[state.bars.length - 1];

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Market Data</p>
          <h2>Initial ticker data probe</h2>
        </div>
        <p className={styles.panelCopy}>
          Fetch normalized OHLCV bars through the provider layer that will later feed feature engineering and signal classification.
        </p>
      </div>

      <form className={styles.controls} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span>Symbol</span>
          <input
            name="symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            placeholder="NVDA"
            autoCapitalize="characters"
          />
        </label>

        <label className={styles.field}>
          <span>Timeframe</span>
          <select
            name="timeframe"
            value={timeframe}
            onChange={(event) => setTimeframe(event.target.value as Timeframe)}
          >
            {TIMEFRAMES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Bars</span>
          <input
            name="limit"
            type="number"
            min="1"
            max="500"
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
          />
        </label>

        <button className={styles.primaryAction} type="submit" disabled={isLoading}>
          {isLoading ? "Loading..." : "Fetch bars"}
        </button>
      </form>

      {state.error ? <p className={styles.errorBox}>{state.error}</p> : null}

      <div className={styles.dataGrid}>
        <article className={styles.metricCard}>
          <span>Source</span>
          <strong>{state.source || "alpaca"}</strong>
        </article>
        <article className={styles.metricCard}>
          <span>Last symbol</span>
          <strong>{state.symbol || symbol.toUpperCase()}</strong>
        </article>
        <article className={styles.metricCard}>
          <span>Returned bars</span>
          <strong>{state.bars?.length ?? 0}</strong>
        </article>
        <article className={styles.metricCard}>
          <span>Latest close</span>
          <strong>{latestBar ? latestBar.close.toFixed(2) : "n/a"}</strong>
        </article>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Open</th>
              <th>High</th>
              <th>Low</th>
              <th>Close</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>
            {state.bars?.length ? (
              state.bars.map((bar) => (
                <tr key={bar.timestamp}>
                  <td>{new Date(bar.timestamp).toLocaleString()}</td>
                  <td>{bar.open.toFixed(2)}</td>
                  <td>{bar.high.toFixed(2)}</td>
                  <td>{bar.low.toFixed(2)}</td>
                  <td>{bar.close.toFixed(2)}</td>
                  <td>{bar.volume.toLocaleString()}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className={styles.emptyState}>
                  Submit a symbol to test the market-data pipeline.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
