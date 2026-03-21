"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ContractWatchlistButton } from "@/components/contract-watchlist-button";
import { LogoutButton } from "@/components/logout-button";
import styles from "./app-nav.module.css";

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className={styles.shell}>
      <div className={styles.brand}>
        <h1>Wolfdesk</h1>
        <p>Internal market research platform</p>
      </div>
      <nav className={styles.nav}>
        <Link href="/" className={pathname === "/" || pathname === "/screener" ? styles.activeLink : styles.link}>
          Screener
        </Link>
        <Link
          href="/openinsider"
          className={pathname === "/openinsider" ? styles.activeLink : styles.link}
        >
          OpenInsider
        </Link>
        <ContractWatchlistButton />
        <LogoutButton />
      </nav>
    </header>
  );
}
