"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./contract-watchlist-button.module.css";
import {
  CONTRACT_WATCHLIST_EVENT,
  clearContractWatchlist,
  readContractWatchlist,
  removeContractFromWatchlist,
} from "@/lib/watchlist/contracts";
import { ContractWatchlistEntry, WatchlistContractGptResponse } from "@/lib/watchlist/types";

type WatchlistJobState = {
  id: string;
  contractSymbol: string;
  underlyingSymbol: string;
  status: "queued" | "running" | "completed" | "failed";
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  model: string | null;
  result: WatchlistContractGptResponse["results"][number] | null;
};

function formatPrice(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatStructure(value: string) {
  return value.replaceAll("_", " ");
}

export function WatchlistPanel() {
  const [entries, setEntries] = useState<ContractWatchlistEntry[]>(() => []);
  const [jobs, setJobs] = useState<WatchlistJobState[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entriesRef = useRef<ContractWatchlistEntry[]>([]);
  const jobsRef = useRef<WatchlistJobState[]>([]);

  useEffect(() => {
    function refresh() {
      setEntries(readContractWatchlist());
    }

    refresh();
    window.addEventListener(CONTRACT_WATCHLIST_EVENT, refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener(CONTRACT_WATCHLIST_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((left, right) => {
        if (left.underlyingSymbol !== right.underlyingSymbol) {
          return left.underlyingSymbol.localeCompare(right.underlyingSymbol);
        }

        return right.score - left.score;
      }),
    [entries],
  );

  const contractListKey = useMemo(
    () => sortedEntries.map((entry) => entry.symbol).join(","),
    [sortedEntries],
  );

  const results = useMemo(
    () =>
      jobs
        .map((job) => job.result)
        .filter((result): result is NonNullable<WatchlistJobState["result"]> => Boolean(result)),
    [jobs],
  );

  const modelUsed = jobs.find((job) => job.model)?.model ?? null;
  const pendingJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");

  useEffect(() => {
    entriesRef.current = sortedEntries;
  }, [sortedEntries]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  async function refreshStatuses() {
    if (!sortedEntries.length) {
      setJobs([]);
      return;
    }

    const params = new URLSearchParams({
      contracts: sortedEntries.map((entry) => entry.symbol).join(","),
    });
    const response = await fetch(`/api/watchlist/analyze/status?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to refresh watchlist statuses.");
    }

    setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
  }

  useEffect(() => {
    void refreshStatuses().catch(() => undefined);
  }, [contractListKey]);

  useEffect(() => {
    if (!pendingJobs.length) {
      return;
    }

    function pumpWorker() {
      const currentPendingJobs = jobsRef.current.filter((job) => job.status === "queued" || job.status === "running");

      if (!currentPendingJobs.length) {
        return;
      }

      void kickWorker(
        entriesRef.current.filter((entry) => currentPendingJobs.some((job) => job.contractSymbol === entry.symbol)),
        currentPendingJobs.map((job) => job.id),
      );
    }

    pumpWorker();

    const interval = window.setInterval(() => {
      pumpWorker();
      void refreshStatuses().catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [pendingJobs.length]);

  async function kickWorker(targetEntries: ContractWatchlistEntry[], jobIds?: string[]) {
    void fetch("/api/watchlist/analyze/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ids: jobIds,
        entriesBySymbol: Object.fromEntries(targetEntries.map((entry) => [entry.symbol, entry])),
      }),
    }).catch(() => undefined);
  }

  async function submitEntries(targetEntries: ContractWatchlistEntry[]) {
    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch("/api/watchlist/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ entries: targetEntries }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Watchlist analysis failed.");
      }

      const jobIds = Array.isArray(payload.jobs) ? payload.jobs.map((job: { id?: string }) => String(job.id ?? "")).filter(Boolean) : [];
      await refreshStatuses();
      kickWorker(targetEntries, jobIds);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Watchlist analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function analyzeWatchlist() {
    await submitEntries(sortedEntries);
  }

  async function analyzeEntry(entry: ContractWatchlistEntry) {
    await submitEntries([entry]);
  }

  function statusForSymbol(symbol: string) {
    return jobs.find((job) => job.contractSymbol === symbol) ?? null;
  }

  return (
    <section className={styles.pageShell}>
      <div className={styles.pageHeader}>
        <div>
          <h1>Watchlist</h1>
          <p>Saved option contracts with contract-level GPT analysis, catalysts, insider context, and action framing.</p>
        </div>
        <div className={styles.headerActions}>
          {sortedEntries.length ? (
            <button type="button" className={styles.analyzeButton} onClick={() => void analyzeWatchlist()} disabled={isAnalyzing}>
              {isAnalyzing ? "Analyzing..." : "Analyze watchlist"}
            </button>
          ) : null}
          {sortedEntries.length ? (
            <button type="button" className={styles.clearButton} onClick={() => clearContractWatchlist()}>
              Remove all
            </button>
          ) : null}
        </div>
      </div>

      <p className={styles.warning}>
        GPT contract analysis may take a few minutes, especially when news, insider context, and broader catalyst research are included.
      </p>

      {sortedEntries.length ? (
        <div className={styles.pageTableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Underlying</th>
                <th>Contract</th>
                <th>Lane</th>
                <th>Structure</th>
                <th>Mark</th>
                <th>Break-even</th>
                <th>DTE</th>
                <th>Score</th>
                <th>Status</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <tr key={entry.symbol}>
                  <td>{entry.underlyingSymbol}</td>
                  <td>
                    <div className={styles.contractCell}>
                      <strong>{entry.symbol}</strong>
                      <span>
                        {entry.optionType} {formatPrice(entry.strikePrice)} {entry.expirationDate}
                      </span>
                    </div>
                  </td>
                  <td>{entry.lane === "fast_lane" ? "Fast lane" : "Suggested"}</td>
                  <td>{formatStructure(entry.structure)}</td>
                  <td>{formatPrice(entry.mark)}</td>
                  <td>{formatPrice(entry.breakEven)}</td>
                  <td>{entry.daysToExpiration}</td>
                  <td>{entry.score.toFixed(1)}</td>
                  <td>
                    <span className={styles.statusPill}>
                      {statusForSymbol(entry.symbol)?.status ?? "not analyzed"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.analyzeButton}
                      onClick={() => void analyzeEntry(entry)}
                      disabled={isAnalyzing}
                    >
                      Analyze
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={() => removeContractFromWatchlist(entry.symbol)}
                      aria-label={`Remove ${entry.symbol} from watchlist`}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.empty}>
          No saved contracts yet. Save them from the suggested contract cards in the screener detail view.
        </p>
      )}

      {sortedEntries.length ? (
        <p className={styles.note}>
          Saved contracts keep their mark, break-even, structure, and score from when they were added.
        </p>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      {(results.length || pendingJobs.length) ? (
        <section className={styles.analysisSection}>
          <div className={styles.analysisHeader}>
            <strong>GPT contract analysis</strong>
            <span>
              Model: {modelUsed ?? "pending"} | completed: {results.length} | pending: {pendingJobs.length}
            </span>
          </div>
          <div className={styles.pageTableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Underlying</th>
                  <th>Contract</th>
                  <th>Decision</th>
                  <th>Bias</th>
                  <th>Confidence</th>
                  <th>Judgment</th>
                  <th>Positive catalysts</th>
                  <th>Negative catalysts</th>
                  <th>Insider / geopolitical</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((savedEntry) => {
                  const job = statusForSymbol(savedEntry.symbol);
                  const entry = job?.result;
                  const companyHeadlines = entry?.companyHeadlines ?? [];
                  const marketHeadlines = entry?.marketHeadlines ?? [];
                  const positiveCatalysts = entry?.positiveCatalysts ?? [];
                  const negativeCatalysts = entry?.negativeCatalysts ?? [];
                  const publishedAt = companyHeadlines[0]?.publishedAt || job?.requestedAt || "";

                  return (
                    <tr key={`analysis-${savedEntry.symbol}`}>
                      <td>{savedEntry.underlyingSymbol}</td>
                      <td className={styles.analysisContract}>
                        <strong>{savedEntry.symbol}</strong>
                        <span>{publishedAt}</span>
                      </td>
                      <td>{entry?.pursueDecision ?? (job?.status === "failed" ? "FAILED" : job?.status ?? "pending")}</td>
                      <td>
                        {entry ? (
                          <div className={styles.biasCell}>
                            <span>ST: {entry.shortTermBias}</span>
                            <span>LT: {entry.longTermBias}</span>
                          </div>
                        ) : (
                          <span className={styles.pendingCell}>
                            {job?.status === "running" ? "Analysis in progress..." : job?.status === "queued" ? "Queued..." : job?.status === "failed" ? "Failed" : "Not requested"}
                          </span>
                        )}
                      </td>
                      <td>{entry ? `${(entry.confidence * 100).toFixed(0)}%` : "-"}</td>
                      <td className={styles.analysisText}>
                        {entry ? (
                          <>
                            <strong>{entry.contractJudgment}</strong>
                            {entry.warnings.length ? <span>Warnings: {entry.warnings.join("; ")}</span> : null}
                            <span>{entry.thesisSummary}</span>
                            <span>{entry.rationale}</span>
                            {entry.verifiedFindings.length ? (
                              <span>
                                Verified: {entry.verifiedFindings.map((item) => `${item.claim} [${item.citations.join(",")}]`).join(" | ")}
                              </span>
                            ) : null}
                            {entry.unverifiedModelContext.length ? (
                              <span>
                                Unverified model context: {entry.unverifiedModelContext.map((item) => `${item.claim} (${item.confidence})`).join(" | ")}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span>{job?.errorMessage || "Waiting for completed analysis."}</span>
                        )}
                      </td>
                      <td className={styles.listCell}>
                        {positiveCatalysts.length ? (
                          <ul>
                            {positiveCatalysts.map((item) => (
                              <li key={`${savedEntry.symbol}-pos-${item}`}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <span>{entry ? "None highlighted." : "-"}</span>
                        )}
                      </td>
                      <td className={styles.listCell}>
                        {negativeCatalysts.length ? (
                          <ul>
                            {negativeCatalysts.map((item) => (
                              <li key={`${savedEntry.symbol}-neg-${item}`}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <span>{entry ? "None highlighted." : "-"}</span>
                        )}
                      </td>
                      <td className={styles.analysisText}>
                        {entry ? (
                          <>
                            <strong>Insider</strong>
                            <span>{entry.insiderTake}</span>
                            <strong>Geopolitical</strong>
                            <span>{entry.geopoliticalTake}</span>
                          </>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                      <td className={styles.analysisText}>
                        {entry ? (
                          <>
                            <strong>{entry.actionPlan}</strong>
                            {companyHeadlines.length ? (
                              <span>
                                Company news: {companyHeadlines.slice(0, 2).map((headline) => headline.title).join(" | ")}
                              </span>
                            ) : null}
                            {marketHeadlines.length ? (
                              <span>
                                Market context: {marketHeadlines.slice(0, 2).map((headline) => headline.title).join(" | ")}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}
