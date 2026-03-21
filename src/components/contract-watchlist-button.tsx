"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./contract-watchlist-button.module.css";
import {
  CONTRACT_WATCHLIST_EVENT,
  clearContractWatchlist,
  ContractWatchlistEntry,
  readContractWatchlist,
  removeContractFromWatchlist,
} from "@/lib/watchlist/contracts";

function formatPrice(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatStructure(value: string) {
  return value.replaceAll("_", " ");
}

export function ContractWatchlistButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [entries, setEntries] = useState<ContractWatchlistEntry[]>(() => []);

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

  return (
    <div className={styles.shell}>
      <button type="button" className={isOpen ? styles.buttonActive : styles.button} onClick={() => setIsOpen((value) => !value)}>
        Watchlist
        <span className={styles.count}>{entries.length}</span>
      </button>

      {isOpen ? (
        <div className={styles.popup}>
          <div className={styles.header}>
            <strong>Saved contracts</strong>
            <div className={styles.headerActions}>
              {sortedEntries.length ? (
                <button type="button" className={styles.clearButton} onClick={() => clearContractWatchlist()}>
                  Remove all
                </button>
              ) : null}
              <button type="button" className={styles.closeButton} onClick={() => setIsOpen(false)}>
                Close
              </button>
            </div>
          </div>

          {sortedEntries.length ? (
            <div className={styles.tableWrap}>
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
        </div>
      ) : null}
    </div>
  );
}
