"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./contract-watchlist-button.module.css";
import {
  CONTRACT_WATCHLIST_EVENT,
  readContractWatchlist,
} from "@/lib/watchlist/contracts";

export function ContractWatchlistButton() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    function refresh() {
      setCount(readContractWatchlist().length);
    }

    refresh();
    window.addEventListener(CONTRACT_WATCHLIST_EVENT, refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener(CONTRACT_WATCHLIST_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <Link href="/watchlist" className={pathname === "/watchlist" ? styles.buttonActive : styles.button}>
      Watchlist
      <span className={styles.count}>{count}</span>
    </Link>
  );
}
